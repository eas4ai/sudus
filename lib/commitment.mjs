// lib/commitment.mjs
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { appendRecord, readLog, range, fixBase } from './records.mjs';
import { writeWorkspaceSnapshot, writeWorkspaceSnapshotFromTree, readSnapshot, listPaths, refuseSensitive, ALWAYS_EXCLUDED } from './snapshots.mjs';
import { listTree, writeTreeFromPaths } from './gitx.mjs';
import { parseRoadmap, lint, readSpec, requirementSet, SpecError, REF_RE } from './spec.mjs';
import { classify, KERNEL_MANAGED, matchGlob } from './paths.mjs';
import { layoutOf, SUDUS, CAIRN } from './layout.mjs';
import { loadSettings } from './settings.mjs';
import { canonicalize, ulid } from './canon.mjs';
import { withTransaction, acquireLock } from './tx.mjs';
import { refuseUnauthorizedProtected, authorizations, authenticateDeveloper, verifyEvidence, evidenceSettings, AuthError } from './auth.mjs';
import { readAdr, appendDecision, decisionAppendBytes, unbuiltDecisions, recordedUnder } from './adr.mjs';
import { kernelManagedValid } from './scope.mjs';
import { installRefspecs as installRefspecsReal } from './travel.mjs';
import { readState, verdictOf } from './wake.mjs';
import { writeEscalation, retiredBy, retiredHow } from './escalate.mjs';
import { ledger } from './review.mjs';
import { cloneId, inboxRef, holder, readInboxes } from './inbox.mjs';

export class CommitmentError extends Error { constructor(m) { super(m); this.name = 'CommitmentError'; } }
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KINDS = ['backlog', 'next-feature', 'defect'];
const refuse = (m) => { throw new CommitmentError(m); };

export function openCommitment(log) {
  let open = null, pending = null;
  for (const r of log) {
    if (r.kind === 'start') { open = r; pending = null; }
    else if (r.kind === 'done' && open) open = null;
    else if (r.kind === 'superseded' && open) { pending = r; open = null; }
  }
  return { open, pending };
}

export async function treeDelta(cwd, treeA, treeB) {
  const a = new Map((await listTree(cwd, treeA)).map((e) => [e.path, e.sha]));
  const b = new Map((await listTree(cwd, treeB)).map((e) => [e.path, e.sha]));
  const out = [];
  for (const p of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (a.get(p) !== b.get(p)) out.push({ path: p, before: a.get(p) ?? null, after: b.get(p) ?? null });
  }
  return out;
}

// An item is named by its record sha or its slug: wake names `fix ITEM`, `capture ITEM` and
// `promote` by slug, and the commands took only the sha, which nothing wake prints carries.
async function findItem(log, ref) {
  const it = log.find((r) => r.kind === 'item' && (r.sha === ref || r.payload.slug === ref));
  if (!it) refuse(`${ref} is not an item record or item slug; sudus show items lists them`);
  return it;
}

export async function item(cwd, { kind, slug, source, body, decision }) {
  if (!KINDS.includes(kind)) refuse(`item kind is one of ${KINDS.join(', ')}`);
  if (typeof slug !== 'string' || !SLUG.test(slug)) refuse(`invalid item slug ${slug}`);
  if (typeof body !== 'string' || body.trim() === '') refuse('an item needs a body');
  if (typeof source !== 'string' || source.trim() === '') refuse('an item names its source requirement or the contract it changes');
  if (kind !== 'next-feature') {
    // Fix round 1 finding 8 (Important, quality): reads lib/spec.mjs's own readSpec instead of a
    // second, hand-maintained scan of docs/spec that had drifted from it (first-duplicate-wins
    // here vs. readSpec's own first-wins rule was actually the same by luck, but the NON_DOMAIN
    // exclusion -- overview.md/glossary.md/roadmap.md are never domain files even if one of them
    // happened to contain a line matching /^Prefix:/ -- was not).
    const { blocks } = await readSpec(cwd);
    const b = blocks.get(source);
    if (!b || b.status?.kind !== 'Agreed') refuse(`${source} is not an Agreed requirement`);
  }
  const log = await readLog(cwd);
  if (log.some((r) => r.kind === 'item' && r.payload.slug === slug)) refuse(`item slug ${slug} is taken`);
  const inboxed = (await readInboxes(cwd)).find((r) => r.payload.slug === slug);
  if (inboxed) refuse(`item slug ${slug} is taken in the inbox of clone ${inboxed.clone}`);
  // Issue #35 (spec revision 18): while a commitment another clone started is open, an append to
  // the log would race that clone's unpushed records, so the item goes to this clone's inbox.
  const held = holder(log);
  // Issue #71: a decision moves to the backlog on the log, where wake and Done read it.
  const payload = decision === undefined ? { kind, slug, source, body } : { kind, slug, source, body, decision };
  if (held !== null) {
    const me = await cloneId(cwd);
    if (held !== me && decision !== undefined) refuse(`clone ${held} holds the open commitment; move decision ${decision} to the backlog there`);
    if (held !== me) return appendRecord(cwd, 'item', slug, payload, inboxRef(cwd, me));
  }
  return appendRecord(cwd, 'item', slug, payload);
}

// Issue #71 (spec revision 21): a decision a supersession carried, which the open commitment rests
// on nowhere, moves to the backlog as an item naming it. The item self-promotes after Done like any
// backlog item, and the decision no longer holds build or Done. The slug, source and body default
// from the decision: its source is the first Agreed requirement it rests on, else the first Agreed
// requirement of the commitment it was recorded under.
export async function moveDecision(cwd, id, opts = {}) {
  // Checked and appended under the transaction lock, so two moves cannot both take one decision
  // over (review of 57c1366c).
  const release = await acquireLock(cwd, ulid());
  try { return await moveDecisionLocked(cwd, id, opts); } finally { release(); }
}
async function moveDecisionLocked(cwd, id, { slug, source, body }) {
  const log = await readLog(cwd);
  const { open } = openCommitment(log);
  if (!open) refuse(`no commitment is open; decision ${id} moves to the backlog while the commitment that superseded its own is open`);
  const adr = await readAdr(cwd);
  const line = adr.find((l) => l.kind === 'decision' && l.id === id);
  if (!line) refuse(`no decision ${id}`);
  const u = unbuiltDecisions(adr, log, open.payload.requirements).find((x) => x.line.id === id);
  if (!u) refuse(`decision ${id} is already realized, superseded or in the backlog`);
  if (!u.carried) refuse(`decision ${id} was recorded under ${open.payload.slug}; build it`);
  if (u.held) refuse(`${open.payload.slug} rests on a requirement decision ${id} names; build it`);
  if (source === undefined) {
    const { blocks } = await readSpec(cwd);
    const under = recordedUnder(adr, log, id);
    const start = under && log.find((r) => r.sha === under.payload.start);
    // A source outside the open set first: an item from a set requirement must say why it is outside.
    const underReqs = start ? start.payload.requirements.map((x) => x.requirement) : [];
    const inSet = new Set(open.payload.requirements.map((x) => x.requirement));
    source = [...line.rests_on, ...underReqs.filter((r) => !inSet.has(r)), ...underReqs.filter((r) => inSet.has(r))].find((r) => blocks.get(r)?.status?.kind === 'Agreed');
    if (source === undefined) refuse(`decision ${id} names no Agreed requirement; give the one its work belongs to with --from`);
  }
  return item(cwd, { kind: 'backlog', slug: slug ?? `decision-${id.toLowerCase()}`, source, body: body ?? `${line.title}. ${line.body}`.replace(/\s+/g, ' ').trim(), decision: id });
}

export async function outside(cwd, itemSha, reason, { evaluation = null } = {}) {
  const it = await findItem(await readLog(cwd), itemSha);
  if (typeof reason !== 'string' || reason.trim() === '') refuse('outside needs a reason');
  return appendRecord(cwd, 'outside', it.payload.slug, { item: it.sha, reason, evaluation });
}

// Issue #34 (spec revision 17): nothing closed a next-feature item, and a backlog item the
// developer had already dropped in conversation still needed an escalation round. `sudus retire`
// records the developer's words once for every item they named. A retired item is never promoted
// and no longer waits. A defect is fixed, not retired.
export async function retire(cwd, refs, { quote, sign, nonce, env } = {}) {
  if (!Array.isArray(refs) || refs.length === 0) refuse('retire needs one or more item slugs or shas');
  if (typeof quote !== 'string' || quote.trim() === '') refuse("retire needs the developer's words: --quote \"<text>\"");
  const log = await readLog(cwd);
  const items = [];
  for (const ref of refs) {
    const it = await findItem(log, ref);
    if (items.includes(it)) refuse(`item ${it.payload.slug} is named twice`);
    if (it.payload.kind === 'defect') refuse(`item ${it.payload.slug} is a defect; a defect is fixed, not retired`);
    if (log.some((r) => r.kind === 'promotion' && r.payload.item === it.sha)) refuse(`item ${it.payload.slug} was promoted; it is not retired`);
    const by = retiredBy(log, it.sha);
    if (by) refuse(`item ${it.payload.slug} was retired by ${retiredHow(log, by)}`);
    items.push(it);
  }
  await loadSettings(cwd);
  // Revision 11: the developer's words are checked against the key in force, not the file on disk.
  const settings = await evidenceSettings(cwd, log);
  const subject = canonicalize({ items: items.map((it) => it.sha) });
  const evidence = await authenticateDeveloper(cwd, settings, { purpose: 'retire', subject, sign, quote, nonce, env });
  if (!verifyEvidence(settings, evidence, { purpose: 'retire', subject })) refuse('developer evidence does not verify');
  return appendRecord(cwd, 'retirement', items[0].payload.slug, { items: items.map((it) => it.sha), evidence });
}

export async function protectedDelta(cwd, snapA, snapB) {
  const { settings } = await loadSettings(cwd);
  const a = await readSnapshot(cwd, snapA, 'workspace');
  const b = await readSnapshot(cwd, snapB, 'workspace');
  return (await treeDelta(cwd, a.tree, b.tree)).map((d) => d.path).filter((p) => classify(p, settings) === 'protected');
}

export async function fix(cwd, itemSha) {
  const log = await readLog(cwd);
  const it = await findItem(log, itemSha);
  if (it.payload.kind !== 'defect') refuse('only a defect item is fixed');
  let { open } = openCommitment(log);
  if (open) {
    // "A defect against that commitment's requirement is worked under it" (spec, Deferral and
    // attempts): while a commitment is open, only a defect against one of its requirements is
    // fixed under it. A defect against any other requirement used to be accepted here, recorded
    // as fixed with nothing ever checked.
    if (!open.payload.requirements.some((q) => q.requirement === it.payload.source)) refuse(`defect ${it.payload.slug} is against ${it.payload.source}, which commitment ${open.payload.slug} does not own; it is fixed under a commitment that owns ${it.payload.source}, or between commitments`);
  } else {
    // Between commitments any defect is fixed: "Defect items are fixed before promotion" (spec,
    // Capture and promotion), and promote refuses while one is unfixed, so the fix must be
    // recordable with nothing open. No contract is frozen between commitments (lib/records.mjs
    // fixBase), so no protected delta is measured: issue #4 and the supersede gap both refused a
    // fix for spec edits the next start was about to authorize.
    if (!log.some((r) => r.kind === 'start')) refuse('a fix is recorded after a first commitment has started');
  }
  const snapshot = await writeWorkspaceSnapshot(cwd);
  const changed = open ? await protectedDelta(cwd, open.payload.snapshot, snapshot) : [];
  if (changed.length) refuse(`fix changes protected contract ${changed[0]}`);
  return appendRecord(cwd, 'fix', it.payload.slug, { item: it.sha, snapshot });
}

const ROADMAP = 'docs/spec/roadmap.md';

export function setCurrent(text, slug) {
  const m = /^Current:[ \t]*.*$/m.exec(text);
  if (!m) throw new CommitmentError(`${ROADMAP} has no Current: line`);
  return text.slice(0, m.index) + `Current: ${slug}` + text.slice(m.index + m[0].length);
}

// Fix round 1 finding 8 (Important, quality): this duplicated lib/spec.mjs's own requirementSet
// (roadmap-section-plus-scopeEvery-Agreed-blocks resolution, exactly what "the frozen set" is)
// with a diverging duplicate-id rule (see readSpec's own comment above item()) and no NON_DOMAIN
// exclusion. Now a thin wrapper: requirementSet does the resolution, and its {id, textDigest}
// shape is remapped to the record schema's {requirement, text_digest} field names. Its SpecError
// messages ("no roadmap section X", "X is Y, not Agreed") differ from the plan's own wording
// ("roadmap has no section X", "X is Y; a commitment names only Agreed requirements"); this is a
// deliberate consequence of using the shared, canonical implementation rather than a second one
// tuned to match the plan's exact prose -- tests/commitment.test.mjs's two matching assertions
// were updated to requirementSet's real message text.
export async function frozenSet(cwd, slug, opts = {}) {
  let set;
  try { set = await requirementSet(cwd, slug, opts); }
  catch (e) { if (e instanceof SpecError) refuse(e.message); throw e; }
  return set.map(({ id, textDigest }) => ({ requirement: id, text_digest: textDigest }));
}

// Fix round 1 finding 7 (Important, quality): this was a second, hand-maintained reimplementation
// of lib/auth.mjs's protectedDigests, never actually called by anything in this module (start's
// own authorization gate goes through currentAuthorization -> refuseUnauthorizedProtected, which
// uses auth.mjs's own protectedDigests internally) -- dead in production, and a second place the
// digest rule could silently drift from the one refuseUnauthorizedProtected actually enforces.
// Deleted outright; callers (including this module's own tests) import protectedDigests from
// lib/auth.mjs directly.

// Carried obligation 2: `sudus start` must call refuseUnauthorizedProtected (lib/auth.mjs) before
// writing anything and refuse without a current authorization. Rather than reimplementing that
// chain-verification logic (forged-record detection, signature re-verification; see lib/auth.mjs's
// own extensive comments), currentAuthorization delegates to it directly: any refusal from
// refuseUnauthorizedProtected means "no current authorization", matching this function's
// null-on-failure contract, and prepareStart below calls this function early, before any write.
// Fix round 1 finding 9 (Important, quality): the bare `catch { return null }` turned every
// exception from refuseUnauthorizedProtected into "no current authorization", including a
// structural breach (a forged second 'init' record on refs/sudus/log) and a SettingsError from a
// broken .sudus/settings.json -- both real problems a developer needs to see and fix, not ones
// `sudus authorize` can solve. Only a genuine "nothing to verify" or "no longer matches" state maps
// to null; anything else (including a breach, and any non-AuthError at all) is rethrown.
// Fix round 2 finding 6 (Minor): classified by AuthError's own `code` field (lib/auth.mjs) instead
// of matching on message text -- the message wording can change without silently breaking this
// classification the way a regex would.
export async function currentAuthorization(cwd, log) {
  try { await refuseUnauthorizedProtected(cwd, log); }
  catch (e) {
    if (e instanceof AuthError && (e.code === 'no-authorization' || e.code === 'unverified')) return null;
    throw e;
  }
  return authorizations(log).at(-1) ?? null;
}

// Issue #68: wake names promote for any backlog item, but a backlog item captured with
// `sudus item --backlog` has no roadmap section, and promote refused it. `section`, from promote,
// is the section to add when the roadmap has none for the slug: it names the item's source, an
// Agreed requirement at capture. writeStart writes it with the Current: move, so the section is
// part of the promotion's one recoverable transaction.
async function prepareStart(cwd, slug, log, { section = null } = {}) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) refuse(`invalid slug ${slug}`);
  const { open, pending } = openCommitment(log);
  if (open) refuse(`commitment ${open.payload.slug} is open; at most one commitment is open`);
  if (pending && pending.payload.successor !== slug) refuse(`pending supersession names successor ${pending.payload.successor}, not ${slug}`);
  const findings = await lint(cwd);
  if (findings.length) refuse(`docs/spec does not lint: ${JSON.stringify(findings[0])}`);
  let roadmapText = await readFile(join(cwd, ROADMAP), 'utf8');
  const sectionAdded = section !== null && !parseRoadmap(roadmapText).sections[slug];
  if (sectionAdded) roadmapText = roadmapText.replace(/\n*$/, '\n') + `\n## ${slug}\n\nRequirements: ${section.requirements.join(', ')}\n\n${section.text}\n`;
  const set = await frozenSet(cwd, slug, { roadmapText });
  if (!(await currentAuthorization(cwd, log))) refuse('no current authorization binds the specification, working agreement and settings; ask the developer and record the answer with sudus authorize --quote <words>');
  const { settings } = await loadSettings(cwd);
  return { pending, set, roadmapText, sectionAdded, settings };
}

// Deviation from the plan text: lib/tx.mjs's withTransaction (already committed, plan 04) does not
// accept an arbitrary `plan` object naming only the caller's own fields -- it requires
// plan.identity, plan.writes (an ordered list of {store, ...} descriptors: 'file', 'branch',
// 'snapshot' or 'log') and plan.terminal ({kind, target, payload}), and it unconditionally injects
// intent/results into the appended terminal record after running plan.writes and an optional fn.
// A 'file' write's bytes must be fully known before staging (before any write in the transaction
// executes), so a write whose content depends on another write's own result (e.g. a snapshot sha)
// cannot be expressed as a 'file' descriptor. Roadmap and ADR content that must reference such a
// result is therefore written directly to the working tree before the transaction starts (the same
// pattern lib/auth.mjs's authorize() already uses: it writes nothing itself and just detects which
// protected paths are already dirty), and the transaction's own 'branch' write commits whatever is
// then on disk for the given paths via `git commit --only`, which needs no bytes staged up front.
// This mirrors the spec's own crash-recovery text ("stages exact bytes ... before ... performs the
// ordered writes") for the writes that tx.mjs can express; the roadmap/ADR bytes are not part of
// its own pre/post identity tracking, an accepted, already-precedented limitation (authorize()'s
// 'branch' write has the same property).
// Fix round 1 finding 4 (Minor): this moved Current: for any slug that differed from the
// roadmap's own Current: line, not only a supersession successor's start -- a plain start()
// (never following a supersede()) silently retargeted Current: to whatever slug was asked for,
// even though the spec-phase-tail workflow (outside this plan) is what is supposed to have
// already written Current: to name that section before sudus start ever runs. Current: now moves
// only when this call is the successor of a pending supersession (prepared.pending is set); any
// other mismatch refuses instead of silently rewriting the roadmap.
// Fix round 1 findings 2 and 12: writeStart is now the one place either start() or promote()
// builds and runs the successor-start transaction (finding 12: promote no longer duplicates this
// body). The roadmap's Current: edit is a {store:'file'} write like any other planned write --
// known before staging (setCurrent's own throw, e.g. "no Current: line", now happens before
// withTransaction is ever entered, the same as every other precondition in prepareStart) -- rather
// than a direct pre-transaction writeFile with no crash-recovery coverage of its own (finding 2).
// `extraFileWrites`/`extraWrites` let promote() add its ADR {store:'append'} write and 'promotion'
// {store:'log'} write (also both now known before staging; see decisionAppendBytes and promote's
// own comment) without this function needing to know anything about the ADR or promotion at all.
async function writeStart(cwd, slug, prepared, subject, command, { moveCurrent = false, extraFileWrites = [], extraWrites = [], extraIdentity = {}, failAfterWrite = -1 } = {}) {
  const { pending, set, roadmapText, sectionAdded = false } = prepared;
  const current = parseRoadmap(roadmapText).current;
  const fileWrites = [...extraFileWrites];
  if (current !== slug && !moveCurrent) refuse(`roadmap names ${current} as Current:, not ${slug}; start only the section the spec-phase tail already named Current:, or write Current: ${slug} in docs/spec/roadmap.md first`);
  if (current !== slug || sectionAdded) fileWrites.push({ store: 'file', path: ROADMAP, bytes: setCurrent(roadmapText, slug) });
  const paths = ['docs/spec', 'AGENTS.md', layoutOf(cwd).dir];
  if (fileWrites.some((w) => w.path === 'docs/decisions.jsonl') || await access(join(cwd, 'docs/decisions.jsonl')).then(() => true, () => false)) paths.push('docs/decisions.jsonl');
  const writes = [...extraWrites, ...fileWrites, { store: 'branch', paths, message: subject }, { store: 'snapshot' }];
  const snapshotIndex = writes.length - 1;
  // Fix round 2 finding 5 (Minor): extraIdentity lets promote() (below) put its item SHA back into
  // the transaction's own identity, lost when this function became the one shared place both
  // start() and promote() build their plan from.
  const identity = { command, slug, from_superseded: pending ? pending.sha : null, ...extraIdentity };
  const plan = {
    identity,
    writes,
    // Issue #35: the start names this clone, which holds the log until the commitment's Done.
    terminal: { kind: 'start', target: slug, payload: { slug, snapshot: { stepRef: snapshotIndex }, requirements: set, from_superseded: pending ? pending.sha : null, clone: await cloneId(cwd) } },
  };
  const r = await withTransaction(cwd, { command, plan, failAfterWrite }, null);
  return r.terminalSha;
}

export async function start(cwd, slug, { installRefspecs = installRefspecsReal, failAfterWrite = -1 } = {}) {
  const log = await readLog(cwd);
  const prepared = await prepareStart(cwd, slug, log);
  const sha = await writeStart(cwd, slug, prepared, `Start commitment ${slug}`, 'start', { moveCurrent: !!prepared.pending, failAfterWrite });
  if (prepared.settings.authority_remote !== null) await installRefspecs(cwd, prepared.settings.authority_remote);
  return sha;
}

// `unchecked` is for fixtures that test the record plumbing around done (start, promote,
// supersede) without building a commitment to Done; sudus done itself never passes it.
export async function done(cwd, slug, { unchecked = false } = {}) {
  const log = await readLog(cwd);
  const { open } = openCommitment(log);
  if (!open) refuse('no commitment is open');
  if (open.payload.slug !== slug) refuse(`commitment ${open.payload.slug} is open, not ${slug}`);
  if (!unchecked) {
    // The Done rule, and every violation wake tests before it (an unfixed defect, an unanswered
    // escalation, a scope breach, a stale lease, ...). Without this a done record went through
    // with an unfixed defect against the commitment's own requirement, which wake then named as
    // fix on a closed commitment that no command could fix, and with findings unresolved.
    const v = await verdictOf(await readState(cwd));
    const atDone = v.verdict === 'Resolvable' && v.action === 'done' && v.reason.startsWith('the Done rule holds');
    if (!atDone) refuse(v.verdict === 'Waiting' ? `${slug} is not at Done: ${v.reason}` : `${slug} is not at Done; wake names ${v.action} ${v.target}: ${v.reason}`);
  }
  const snapshot = await writeWorkspaceSnapshot(cwd);
  return appendRecord(cwd, 'done', slug, { slug, snapshot });
}

// Fix round 1 finding 3 (Important): slicing the log to "after open.sha" dropped an open record
// that was itself already carried once, by an earlier supersession: its item/escalation/review
// record sits before the CURRENT open commitment's own start (it was created under an even
// earlier one), so it never appeared in `after` and was reported as not carried on the second
// supersession even though it was still genuinely unfixed/unanswered/unresolved. Scans the whole
// log instead, the same way promote's own unfixed-defect scan (above) already does; `open` is
// still accepted (matching the plan's declared signature and every existing caller) but no longer
// used to bound the scan.
export function carriedRecords(log, open) {
  const has = (kind, pred) => log.some((r) => r.kind === kind && pred(r));
  // Issue #22: findings carry by the superseded commitment's own ledger -- its range and what an
  // earlier supersession carried into it -- where a rejected resolution leaves a finding open and
  // the developer's ok on a dispute settles it. Counting any resolution record across the whole
  // log dropped a finding whose only fix was rejected and carried an unrelated commitment's.
  // Sudus 4.0.0: a declined finding is settled too; the builder decided it.
  const unsettled = new Set(ledger(log, open.payload.slug).filter((f) => f.status === 'open').map((f) => f.source));
  const carried = [];
  for (const r of log) {
    if (r.kind === 'escalation' && !has('answer', (a) => a.payload.escalation === r.sha && ['ok', 'instead'].includes(a.payload.kind))) carried.push(r.sha);
    else if (r.kind === 'item' && r.payload.kind === 'defect' && !has('fix', (f) => f.payload.item === r.sha)) carried.push(r.sha);
    else if (unsettled.has(r.sha)) carried.push(r.sha);
  }
  return carried;
}

// Deviation from the plan text, two parts:
// 1. withTransaction's real contract (see writeStart's own note above) means the decision's ADR
//    line -- which must embed base_snap, a snapshot store's own result -- cannot be expressed as a
//    'file' write inside this same transaction (a write's bytes must be known before staging, and
//    a same-transaction snapshot's result is only known after). base_snap is instead taken directly
//    before the transaction starts (as the plan's own code already did, just not inside `fn`), and
//    appendDecision (Task 1) writes the ADR line straight to disk the same way; the transaction's
//    'branch' write then commits whatever is on disk for docs/decisions.jsonl via `git commit
//    --only`, needing no bytes staged up front. No 'snapshot' write is needed for supersede's own
//    terminal record -- unlike 'start' and 'promotion', the 'superseded' schema carries no
//    snapshot field (spec section 4's table: "slug, old start SHA, developer decision ID,
//    transition ID, successor slug, carried record SHAs").
// 2. authenticateDeveloper/verifyEvidence added explicitly (the plan's own code called
//    authenticateDeveloper with no `subject` at all, which would confirm-prompt with a literal
//    "undefined" in the text, and never re-verified the result the way authorize()/readDecision()
//    do); {sign, nonce, env} are accepted as passthrough options the same way those two functions
//    take them, so a caller (CLI or test) can supply non-interactive evidence. Spec revision 6:
//    the same `quote` is both the decision's own text (below) and, in attested mode, the developer
//    evidence authenticateDeveloper builds from it -- there is no separate confirm callback.
export async function supersede(cwd, successor, { quote, sign, nonce, env, failAfterWrite = -1 } = {}) {
  if (typeof successor !== 'string' || !SLUG.test(successor)) refuse(`invalid slug ${successor}`);
  const log = await readLog(cwd);
  const { open } = openCommitment(log);
  if (!open) refuse('no commitment is open to supersede');
  // Fix round 1 finding 6 (Minor): the open commitment's own slug was accepted as its own
  // successor, which would supersede a commitment with itself.
  if (successor === open.payload.slug) refuse(`successor ${successor} is the same as the open commitment ${open.payload.slug}`);
  if (typeof quote !== 'string' || quote.trim() === '') refuse("supersede needs the developer's words: quote: \"<text>\"");
  await loadSettings(cwd);
  // Revision 11: the developer's words are checked against the key in force, not the file on disk.
  const settings = await evidenceSettings(cwd, log);
  const subject = canonicalize({ from: open.payload.slug, to: successor });
  const evidence = await authenticateDeveloper(cwd, settings, { purpose: 'supersede', subject, sign, quote, nonce, env });
  if (!verifyEvidence(settings, evidence, { purpose: 'supersede', subject })) refuse('developer evidence does not verify');
  const carried = carriedRecords(log, open);
  const transition = ulid();
  const base_snap = await writeWorkspaceSnapshot(cwd);
  // Fix round 1 finding 2 (Important), refined by fix round 2 finding 1: the ADR line's bytes are
  // computed here, in memory, by decisionAppendBytes (lib/adr.mjs) -- no disk write yet, and no
  // read of the file's existing content either. Staged as a {store: 'append'} write below (never
  // {store: 'file'}): appended, under the transaction's lock, to whatever docs/decisions.jsonl
  // actually holds when the write runs, so a concurrent command's own append in the window between
  // this call and the transaction completing is preserved rather than overwritten.
  const { id: decision, bytes: adrBytes } = await decisionAppendBytes(cwd, {
    kind: 'decision', level: 'Consequential', by: 'developer', title: `Supersede ${open.payload.slug} with ${successor}`,
    rests_on: [`start ${open.sha}`], wrong_if: 'the developer did not choose this successor', body: quote, base_snap, evaluation: null, interfaces: [],
  }, { command: 'supersede' });
  const plan = {
    identity: { command: 'supersede', slug: open.payload.slug, successor },
    writes: [
      { store: 'append', path: 'docs/decisions.jsonl', bytes: adrBytes },
      { store: 'branch', paths: ['docs/decisions.jsonl'], message: `Supersede commitment ${open.payload.slug} with ${successor}` },
    ],
    terminal: { kind: 'superseded', target: open.payload.slug, payload: { slug: open.payload.slug, start: open.sha, decision, transition, successor, carried } },
  };
  const r = await withTransaction(cwd, { command: 'supersede', plan, failAfterWrite }, null);
  return r.terminalSha;
}

// Fix round 1 finding 1 (Critical): recover() always finishes with fn: null (lib/tx.mjs:
// `finish(cwd, s, tx, intent.sha, null)` in its forward-completion branch), so anything written
// only inside withTransaction's own `fn` callback -- as the 'promotion' record was here -- never
// runs again during recovery. An interrupted promote (crash after the branch or snapshot write,
// before the terminal 'start' record) recovered forward with a successor start and no promotion
// record at all. The fix: 'promotion' is now a plan.writes 'log' descriptor, fully known before
// staging (its own payload never needs a same-transaction result), so applyWrites' idempotent
// log-write branch (kind+target+payload match against the log slice after this transaction's own
// intent) replays it correctly on every recovery path, the same way the branch and snapshot writes
// already do. `intent` is nullable(ref) on the 'promotion' schema and stays null here: the real
// intentSha is only known once the transaction's own command-intent record exists, after every
// plan.writes entry (including this one) is already staged.
export async function promote(cwd, itemSha, { installRefspecs = installRefspecsReal, failAfterWrite = -1 } = {}) {
  const log = await readLog(cwd);
  const it = await findItem(log, itemSha);
  itemSha = it.sha;
  const { open, pending } = openCommitment(log);
  if (open) refuse(`commitment ${open.payload.slug} is open; promote runs only after done`);
  if (pending) refuse(`a supersession to ${pending.payload.successor} is pending; start it first`);
  if (it.payload.kind === 'next-feature') refuse('a next-feature item waits for the developer; it is never promoted');
  if (it.payload.kind !== 'backlog') refuse('only a backlog item is promoted');
  if (log.some((r) => r.kind === 'promotion' && r.payload.item === itemSha)) refuse(`item ${it.payload.slug} was already promoted`);
  const retired = retiredBy(log, itemSha);
  if (retired) refuse(`item ${it.payload.slug} was retired by ${retiredHow(log, retired)}`);
  const unfixed = log.filter((r) => r.kind === 'item' && r.payload.kind === 'defect' && !log.some((f) => f.kind === 'fix' && f.payload.item === r.sha));
  if (unfixed.length) refuse(`defect item ${unfixed[0].payload.slug} is unfixed; defects are fixed before promotion`);
  const slug = it.payload.slug;
  // Issue #68: a section promote adds says what it delivers with the item's body on one line, on the
  // developer's ok. A body naming an identifier the specification does not define would fail lint,
  // so that section says less; the body is in the promotion decision either way.
  const { blocks } = await readSpec(cwd);
  const said = it.payload.body.replace(/\s+/g, ' ').trim();
  const text = [...said.matchAll(REF_RE)].every((m) => blocks.has(m[1]))
    ? `Delivers backlog item ${slug}: ${said}`
    : `Delivers backlog item ${slug} (${itemSha.slice(0, 12)}); its body is in the promotion decision.`;
  const prepared = await prepareStart(cwd, slug, log, { section: { requirements: [it.payload.source], text } });
  // Current: names the finished commitment (promote moves it to the item) or already the item.
  // Any other slug is the developer's own next spec phase, which promote used to overwrite.
  const current = parseRoadmap(prepared.roadmapText).current;
  const finished = log.filter((r) => r.kind === 'start').at(-1)?.payload.slug ?? null;
  if (current !== null && current !== slug && current !== finished) refuse(`roadmap names ${current} as Current:, not the finished commitment ${finished} or ${slug}; the developer's next section is started with sudus start ${current}, not promoted`);
  const base_snap = await writeWorkspaceSnapshot(cwd);
  // Fix round 1 finding 2 (Important), refined by fix round 2 finding 1: the ADR line's bytes,
  // like supersede's own (above), are computed here without writing anything and without reading
  // the file's existing content, then staged as a {store: 'append'} write inside writeStart's plan
  // below -- never a {store: 'file'} whole-file overwrite.
  const { id: decision, bytes: adrBytes } = await decisionAppendBytes(cwd, {
    kind: 'decision', level: 'Consequential', by: 'agent', title: `Promote ${slug}`, rests_on: [`item ${itemSha}`],
    wrong_if: 'the item is not covered by the Agreed requirements its roadmap section names', body: it.payload.body, base_snap, evaluation: null, interfaces: [],
  }, { command: 'promote' });
  // Fix round 1 finding 12: calls the shared writeStart (above) instead of duplicating its body.
  // promote always moves Current: (it is the only way a successor commitment starts without a
  // supersession), and adds its own ADR append write and 'promotion' log write (Fix round 1
  // finding 1: a plan.writes descriptor, not an fn side effect) alongside the ones writeStart
  // always makes.
  const sha = await writeStart(cwd, slug, prepared, `Promote ${slug}`, 'promote', {
    moveCurrent: true,
    extraFileWrites: [{ store: 'append', path: 'docs/decisions.jsonl', bytes: adrBytes }],
    extraWrites: [{ store: 'log', kind: 'promotion', target: slug, payload: { item: itemSha, decision, intent: null, results: [] } }],
    extraIdentity: { item: itemSha },
    failAfterWrite,
  });
  if (prepared.settings.authority_remote !== null) await installRefspecs(cwd, prepared.settings.authority_remote);
  return sha;
}

export class RealizationError extends CommitmentError {
  constructor(message, paths) { super(message); this.paths = paths; }
}
const STOPS = ['data', 'protected', 'reserved'];

// Fix round 1 finding 5 (Minor): a kernel-managed path (.sudus/mechanisms/**, docs/decisions.jsonl)
// in the delta was always skipped, unconditionally -- so a decision could realize a hand-edited,
// invalid mechanism definition or a corrupted ADR file and the check would never notice, exactly
// the mutation section 2 calls a breach ("A direct edit ... by another command is a breach").
// Correct: a kernel-managed path is allowed through only when it still validates; otherwise every
// kernel-managed path in the delta stops as 'reserved', the same class an ordinary invalid
// reserved-path edit gets.
//
// Fix round 2 finding 4 (Minor): this module's own kernelManagedValid duplicated lib/scope.mjs's
// exported one, and had already drifted from it -- lib/scope.mjs's version (after plan 07's own
// fix round) checks the write against the local sudus-managed ledger (recordManagedWrite) or an
// exact match with the allowed base's bytes, not merely "does it still parse under its reader";
// a hand edit that happens to be schema-valid JSON is a breach even though it would have passed
// this module's own, looser check. Deleted; lib/scope.mjs's kernelManagedValid is imported and
// used directly, with `base.tree` (the decision's own base snapshot, already read below) as its
// baseTree argument -- the same role `tree` (the allowed-base snapshot) plays in
// lib/scope.mjs's own preflight() call to the same function.
export async function realizationDelta(cwd, decision) {
  const { settings } = await loadSettings(cwd);
  const base = await readSnapshot(cwd, decision.base_snap, 'workspace');
  const { tracked, untracked } = await listPaths(cwd);
  refuseSensitive(untracked, settings.network_exclude ?? []);
  // Fix round 2 finding 3 (Minor): the stop check used to run against this uncommitted tree, and
  // the durable snapshot was then taken separately, afterwards, by writeWorkspaceSnapshot's own
  // fresh re-read of the working tree -- two different reads of the same worktree at two different
  // moments, so the tree actually recorded as `snap` was never guaranteed to be the one the stop
  // check had actually cleared. One tree is built here and reused for both: the delta/stop check
  // below, and (only if it passes) the durable snapshot commit itself, via
  // writeWorkspaceSnapshotFromTree (lib/snapshots.mjs), which commits exactly this tree rather than
  // re-reading the working tree a second time.
  const realizedTree = await writeTreeFromPaths(cwd, { paths: [...tracked, ...untracked], exclude: ALWAYS_EXCLUDED });
  let delta = await treeDelta(cwd, base.tree, realizedTree);
  // A decision whose base precedes the open commitment's start (promote's own decision names a
  // base taken before its transaction moved the roadmap's Current: line) would see the start's
  // own writes as its realization and stop on docs/spec/roadmap.md every time, so a promoted
  // commitment could never reach Done. A path whose realized bytes are exactly what the start
  // snapshot holds was written by the start, not by the realization.
  const open = range(await readLog(cwd)).start;
  if (open && open.payload.snapshot !== decision.base_snap) {
    const startTree = (await readSnapshot(cwd, open.payload.snapshot, 'workspace')).tree;
    const atStart = new Map((await listTree(cwd, startTree)).map((e) => [e.path, `${e.mode} ${e.sha}`]));
    const now = new Map((await listTree(cwd, realizedTree)).map((e) => [e.path, `${e.mode} ${e.sha}`]));
    delta = delta.filter(({ path }) => !(atStart.has(path) && atStart.get(path) === now.get(path)));
  }
  // sudus migrate moves .cairn/ to .sudus/. A decision whose base precedes the move saw each
  // moved file twice, its .cairn/ path deleted and its .sudus/ path added, and stopped on both as
  // protected or reserved changes the decision never made. A .cairn/ path that is gone while
  // .sudus/ holds its counterpart is the move, and so is a .sudus/ path whose bytes are the base's
  // at its .cairn/ path. A counterpart changed after the move stays in the delta and is judged
  // below as the path it is now.
  const within = (dir, p) => p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : null;
  if (layoutOf(cwd) === SUDUS && delta.some(({ path }) => within(CAIRN.dir, path) !== null)) {
    const realized = new Set((await listTree(cwd, realizedTree)).map((e) => e.path));
    const atBase = new Map((await listTree(cwd, base.tree)).map((e) => [e.path, e.sha]));
    delta = delta.filter(({ path, before, after }) => {
      const former = within(CAIRN.dir, path), current = within(SUDUS.dir, path);
      if (former !== null && after === null && realized.has(`${SUDUS.dir}/${former}`)) return false;
      if (current !== null && before === null && atBase.get(`${CAIRN.dir}/${current}`) === after) return false;
      return true;
    });
  }
  const stops = [], interfaces = [];
  for (const { path } of delta) {
    if (KERNEL_MANAGED.some((g) => matchGlob(g, path))) {
      if (!(await kernelManagedValid(cwd, path, base.tree))) stops.push({ path, class: 'reserved' });
      continue;
    }
    const c = classify(path, settings);
    if (STOPS.includes(c)) stops.push({ path, class: c });
    else if (c === 'interface') interfaces.push(path);
  }
  const snap = stops.length ? null : await writeWorkspaceSnapshotFromTree(cwd, realizedTree);
  return { snap, delta, stops, interfaces, realizedTree };
}

export async function realize(cwd, decisionId, { subject }) {
  if (typeof subject !== 'string' || subject.trim() === '') refuse('realize needs a subject');
  const adr = await readAdr(cwd);
  const decision = adr.find((l) => l.kind === 'decision' && l.id === decisionId);
  if (!decision) refuse(`no decision ${decisionId}`);
  if (adr.some((l) => l.kind === 'realized' && l.of === decisionId)) refuse(`decision ${decisionId} is already realized`);
  let { snap, stops, interfaces, realizedTree } = await realizationDelta(cwd, decision);
  if (stops.length) {
    // "A delta touching a data path, frozen Agreed text, the working agreement, protected settings,
    // or any other reserved path stops and escalates" (spec, Decisions and realization). The
    // escalation concerns `decision:<id>`; the developer's ok answer is the decision, and this
    // command then records the realization. It used to refuse without writing anything, so a
    // decision whose realization touched such a path could never be closed and wake named
    // `build <id>` forever.
    const list = stops.map((s) => `${s.path} (${s.class})`).join(', ');
    const log = await readLog(cwd);
    const token = `decision:${decisionId}`;
    const escs = log.filter((r) => r.kind === 'escalation' && r.payload.concerns.split(' ').includes(token));
    const approved = escs.some((e) => log.some((a) => a.kind === 'answer' && a.payload.escalation === e.sha && a.payload.kind === 'ok'));
    if (!approved) {
      const open = escs.find((e) => !log.some((a) => a.kind === 'answer' && a.payload.escalation === e.sha && a.payload.kind !== 'ask'));
      if (open) throw new RealizationError(`realization of ${decisionId} touches ${list}; the decision is the developer's and escalation ${open.sha} awaits their answer`, stops);
      const slug = range(log).start?.payload.slug ?? 'none';
      const sha = await writeEscalation(cwd, slug, {
        question: `Realizing decision ${decisionId} (${decision.title}) changes ${list}. Accept that realization?`,
        recommendation: 'Accept it only if those changes are the decision itself; otherwise revise the realization so it leaves them alone',
        because: 'a data, protected or reserved path changed on the way to realizing a Consequential decision, and such a change is the developer\'s to make',
        if_wrong: 'an accepted realization records those changes as the decision\'s; a refused one leaves build open until the realization is revised',
        instead: 'revise the realization and run sudus realize again', concerns: [token],
      });
      throw new RealizationError(`realization of ${decisionId} touches ${list}; the decision is the developer's; escalation ${sha} written, their ok lets sudus realize proceed`, stops);
    }
    snap = await writeWorkspaceSnapshotFromTree(cwd, realizedTree);
  }
  return appendDecision(cwd, { kind: 'realized', of: decisionId, base_snap: decision.base_snap, snap, subject, interfaces }, { command: 'realize' });
}
