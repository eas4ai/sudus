// lib/wake.mjs
import { readLog, range, fixBases, chainStart } from './records.mjs';
import { readRef, catCommit, git, listTree } from './gitx.mjs';
import { readSnapshot } from './snapshots.mjs';
import { loadSettings } from './settings.mjs';
import { lint, readSpec, REQ_TOKEN } from './spec.mjs';
import { readMechanisms, reviewHolds, usableFailReceipt } from './mechanisms.mjs';
import { currentReceipt, attemptState } from './check.mjs';
import { readAdr } from './adr.mjs';
import { readLease, isStale } from './lease.mjs';
import { pendingTransaction } from './tx.mjs';
import { matchGlob, classify } from './paths.mjs';
import { layoutOf, SUDUS, CAIRN } from './layout.mjs';
import { openBreaches, leaseCovers, workspaceDelta, atSnapshot, declaredPaths, isDeclared } from './scope.mjs';
import { missingRefsLine, validateAfterFetch } from './travel.mjs';
import { carriedFindingSources, completeReport, isBugReport, isLegacyReport, attackPairs } from './review.mjs';
import { concernIndex, escalationStates, itemHolds } from './escalate.mjs';
import { readInboxes, inboxState } from './inbox.mjs';

export const ORDER = ['repair', 'recover', 'reconcile', 'scope', 'waiting', 'supersede', 'fix', 'record', 'declare', 'run', 'review mechanism', 'capture', 'review', 'report', 'resolve', 'build', 'done', 'fold', 'promote'];
export const FETCH_LINE = (remote) => `git fetch ${remote} '${SUDUS.log}:${SUDUS.log}' \\\n  '${SUDUS.snapshots}:${SUDUS.snapshots}'`;
export const PREDICATES = {
  repair: 'the named hand-written file reads under its grammar and no unrelated byte changed',
  recover: 'the intent has one terminal domain or abort record and every store matches its resulting identity',
  reconcile: 'the local action lease is gone and the action it named finished or was explicitly abandoned',
  scope: 'every scope-breach record for the path has a developer-approved keep disposition or a restore snapshot equal to its allowed base; an unanswered escalation that concerns the breach is Waiting instead',
  supersede: "every requirement in the open commitment's set has Agreed text whose digest equals the one its start froze, or a superseded record closes the commitment",
  fix: 'a fix record names the item and a workspace snapshot that changes no protected contract of the commitment open when it was recorded (between commitments no contract is frozen and none is measured); its requirement has a current pass at or after it, whether or not the last commitment owns that requirement',
  record: "the action lease covers the path through its target's declared inputs, or the path is clean",
  commit: 'the path is clean, or the action lease covers it; docs/decisions.jsonl is named here whenever it has uncommitted lines',
  declare: 'a mechanism definition names the requirement and no pre-existing undeclared delta was legalized',
  run: 'a current receipt carries a result for the requirement',
  implement: 'a current receipt says pass and review metadata binds the requirement to the current detection and text digests with a fail receipt',
  escalate: 'after three distinct attempts without a pass, an escalation concerns the requirement before a fourth; a receipt where another requirement of the commitment also failed is not an attempt; attempts count from the requirement\'s turn, which begins once every requirement before it in the set passes, and the first receipt of a turn that begins after the start record is not an attempt',
  'review mechanism': 'review metadata binds the requirement to the current detection and text digests with a fail receipt',
  capture: 'an outside record names the item, or an escalation concerns it',
  review: 'a review names the current workspace snapshot and answers every fixed question for every target',
  report: 'a report names the reviewed snapshot through the latest brief and attempts every lens for every target and every interface obligation; a report that stopped on a Sudus bug is not one',
  resolve: 'a resolution, or a decline with its reason, names finding N of its exact source record',
  // Kernel fix round (plan 14 fixture, defect 2): section 5's own predicate table carries
  // backticks around `Current:` and `ask` in these rows (confirmed by direct reading of
  // docs/spec/sudus-v2.md); these strings dropped them. Restored verbatim.
  build: "a realized ADR line names the decision's base and resulting snapshots and the realization check passed",
  done: 'a done record names the commitment and final workspace snapshot',
  fold: 'no commitment is open; every inbox item this clone holds is on the log, or its slug is held by a different item',
  promote: 'no commitment is open; one promotion names a backlog item and decision; `Current:` and a one-item successor start were written transactionally',
  reply: 'a reply record names the open `ask` escalation',
  waiting: 'an answer record names the escalation with ok or instead',
};

async function inProject(cwd) {
  const r = await git(['rev-parse', '--show-toplevel'], { cwd }).catch(() => null);
  return r && r.code === 0;
}

export async function readState(cwd, { now = Date.now(), session = process.env.SUDUS_SESSION ?? null } = {}) {
  const st = { cwd, now, session, unreadable: [] };
  const attempt = async (path, fn) => { try { return await fn(); } catch (e) { st.unreadable.push({ path, reason: e.message }); return null; } };
  const L = layoutOf(cwd);
  st.settings = (await attempt(L.settings, () => loadSettings(cwd)))?.settings ?? null;
  const findings = await attempt('docs/spec', () => lint(cwd));
  // Deviation from the plan text: lib/spec.mjs's lint() (plan 02) reports each finding as
  // {file, line, reason}, not {path, message}; adapted to the real field names.
  if (findings?.length) st.unreadable.push({ path: findings[0].file ?? 'docs/spec', reason: findings[0].reason ?? String(findings[0]) });
  st.mechanisms = (await attempt(L.mechanisms, () => readMechanisms(cwd))) ?? {};
  // The Agreed blocks as they read now, for the supersede predicate's frozen-text comparison. An
  // unreadable spec is already an 'unreadable' entry from lint above, so this read reports nothing.
  st.blocks = await readSpec(cwd).then((sp) => sp.blocks).catch(() => new Map());
  // The task briefing for this plan calls for readAdr(cwd, {verify: true}) on wake's read path
  // (the full cross-reference check, not the cheap structural-only default), so a dangling
  // sha/snapshot reference in the ADR is caught as an unreadable hand-written input.
  st.adr = (await attempt('docs/decisions.jsonl', () => readAdr(cwd, { verify: true }))) ?? [];
  st.log = await readLog(cwd);
  st.range = range(st.log);
  st.start = st.range.start ?? null;
  st.records = st.range.records ?? [];
  st.closed = Boolean(st.range.closed);
  st.slug = st.start?.payload.slug ?? null;
  st.set = st.start?.payload.requirements ?? [];
  // Fix round 1, item 11(f): readLease used to be called directly, so a corrupted lease commit
  // (parseStrict throwing on its body) propagated out of readState as a raw, uncaught exception
  // instead of becoming an 'unreadable' entry (and so a clean 'repair' verdict) the same way a
  // corrupted settings, mechanisms or ADR read already does.
  st.lease = await attempt(L.lease, () => readLease(cwd));
  // Issue #35: the inbox items this clone holds, its own and fetched, for the fold predicate.
  st.inbox = (await attempt(L.inbox, () => readInboxes(cwd))) ?? [];
  // Deviation from the plan text: lib/tx.mjs's pendingTransaction is async (it reads the
  // repository), so its result must be awaited; the plan's literal skeleton assigned the Promise
  // itself, which is always truthy and never has a usable .target or .payload.
  st.tx = await pendingTransaction(cwd, st.log);
  const head = await readRef(cwd, 'HEAD');
  st.dirty = head ? await workspaceDelta(cwd, (await catCommit(cwd, head)).tree) : [];
  // The ADR is appended by decide, answer, realize and decisions --read and committed by nobody
  // but the agent; `--ignored` so a gitignored docs/ still shows it. Wake names the commit.
  st.adrDirty = (await git(['status', '--porcelain=v1', '-z', '--ignored', '--', 'docs/decisions.jsonl'], { cwd })).stdout.length > 0;
  st.current = {};
  // One reading of each mechanism's inputs and tools for the whole pass (lib/check.mjs identitiesNow).
  st.identities = new Map();
  for (const { requirement } of st.set) st.current[requirement] = await currentReceipt(cwd, st.log, requirement, st.identities);
  st.treeOf = async (snap) => (await readSnapshot(cwd, snap, 'workspace')).tree;
  st.atWorkspace = async (snap) => atSnapshot(cwd, await st.treeOf(snap));
  return st;
}


export async function wake(cwd, opts = {}) {
  if (!(await inProject(cwd))) return { exit: 3, line: 'sudus: outside a project; run /new-project or /existing-project' };
  const missing = await missingRefsLine(cwd);
  if (missing) return { exit: 3, line: missing };
  // Kernel fix round 2 (plan 14 fixture, re-review, New Important finding): kernel fix round 1's
  // ruling A ("never on wake's ordinary path") is withdrawn. Section 4 literally names wake as the
  // validator: "A bypassing ordinary Git push can still create a mismatch. After fetch, wake
  // validates all cross-references and names the exact fetch or push repair; it never guesses."
  // Removing the call here did not just drop coverage; a second clone with a genuinely stale
  // refs/sudus/snapshots (log fetched, snapshots left at an older, real commit) fell through to
  // the 'recover' predicate below, which reads that same staleness as transaction drift and names
  // `sudus recover <tx>` for a start that already completed cleanly -- an actively wrong diagnosis,
  // not merely a missed one. validateAfterFetch runs here, before readState/verdictOf's own
  // transaction-drift diagnosis (the 'recover' predicate consumes pendingTransaction, computed
  // inside readState), so a genuine post-fetch gap is named directly and never reaches that
  // misdiagnosis. Round 1's other half still stands and needed no change: validateAfterFetch
  // itself does not report the roadmap Current: line when no start record exists anywhere in the
  // log yet (lib/travel.mjs), so wake right after sudus init still prints the pending-
  // initialization line, and both crash-fixture variants still name sudus recover <tx> (the crash
  // always happens before the first start's terminal record lands, so that exemption still
  // applies at the moment wake is called). sudus show (lib/cli.mjs's requireRefs) and sudus push's
  // own post-push check (lib/travel.mjs's push) keep their own calls too, for the case where
  // neither of those commands is preceded by a fresh sudus wake.
  const repairs = await validateAfterFetch(cwd);
  if (repairs.length) return { exit: 3, line: repairs[0].command };
  return verdictOf(await readState(cwd, opts));
}

export const predicates = [];   // filled by the tasks below, in ORDER
export async function verdictOf(st) {
  for (const p of predicates) {
    const unmet = await p.test(st);
    if (unmet) return unmet.exit ? unmet : { predicate: PREDICATES[unmet.action ?? 'waiting'], ...unmet };
  }
  // Issue #29: a backlog item the developer's ok let wait is listed, not named for promotion.
  const waits = waitingItems(st.log);
  const reason = waits.length ? `done record closes ${st.slug}; ${waits.length} backlog item${waits.length === 1 ? '' : 's'} wait${waits.length === 1 ? 's' : ''} until the next Done by the developer's ok` : `done record closes ${st.slug} and no backlog item waits`;
  return { verdict: 'Done', action: null, target: st.slug, reason, predicate: PREDICATES.done, waits };
}
function waitingItems(log) {
  const promoted = new Set(log.filter((r) => r.kind === 'promotion').map((r) => r.payload.item));
  const holds = itemHolds(log);
  return log.filter((r) => r.kind === 'item' && r.payload.kind === 'backlog' && !promoted.has(r.sha) && !holds.retired(r.sha))
    .flatMap((r) => { const e = holds.waited(r.sha); return e ? [{ slug: r.payload.slug, item: r.sha, escalation: e }] : []; });
}
const define = (name, test) => predicates.push({ name, test });
const unmet = (action, target, reason) => ({ verdict: 'Resolvable', action, target, reason });

define('repair', (st) => st.unreadable.length ? unmet('repair', st.unreadable[0].path, st.unreadable[0].reason) : null);
// Deviation from the plan text: st.tx is now the actual (awaited) command-intent record object,
// whose own `target` field (set by readLog/decodeRecord from the record's subject, e.g.
// 'sudus: command-intent tx01') names the transaction id; the plan's `st.tx.payload.transaction`
// read a field the real 'command-intent' schema does not have (its own transaction id field is
// `tx`, carried in the payload, but the record's `target` already names it and is what
// appendRecord's caller passed as the transaction id in the first place).
define('recover', (st) => st.tx ? { exit: 3, line: `sudus recover ${st.tx.target}` } : null);
// Fix round 1, item 8: section 2 names four exit-3 cases (outside a project, missing durable
// refs, a pending supersession, an interrupted transaction); this is a fifth. Ruling: keep it -- a
// project with durable refs but no start record at all is the pending-initialization state (the
// spec-phase tail has not run `sudus start` yet), and the existing-project skill is what resumes
// it, the same as the other four. The line now names the skill in the spec's own exact words,
// rather than the plan's paraphrase.
define('supersession', (st) => {
  if (!st.start) return { exit: 3, line: 'sudus: no commitment started; run /new-project or /existing-project' };
  const sup = st.records.find((r) => r.kind === 'superseded');
  return sup ? { exit: 3, line: `sudus: pending supersession to ${sup.payload.successor}; run /existing-project` } : null;
});

// Deviation from the plan text: the session-staleness leg below delegates to lib/lease.mjs's real
// isStale(lease, env), one of the exports this plan's task briefing names for wake to use, instead
// of the plan's own hand-rolled `l.session && st.session && l.session !== st.session` comparison
// (isStale's own rule differs slightly: it only asks whether the current session is known and
// differs from the lease's, treating a session-less lease as stale under a known session too).
// The other three legs (target not in the commitment, its implement target already passing, or
// the commitment closed) are wake-specific state isStale/reconcilePredicate cannot see, so they
// stay here.
function leaseStale(st) {
  const l = st.lease;
  if (!l) return null;
  if (isStale(l, { SUDUS_SESSION: st.session })) return 'its session ended';
  // Issue #38: a lease taken after the commitment closed prepares the next start, as the working
  // agreement's record move asks; the closed commitment's set and passes do not bind it.
  if (st.closed && l.closed_by === st.range.closer.sha) return null;
  const inSet = st.set.some((x) => x.requirement === l.target);
  // Issue #42: the requirement grammar's own token, so a prefix with a digit (E2E-001) is one too.
  if (REQ_TOKEN.test(l.target) && !inSet) return `${l.target} is not in the commitment`;
  if (l.action === 'implement' && st.current[l.target]?.result === 'pass') return `${l.target} already passes`;
  if (st.closed) return 'the commitment is closed';
  return null;
}
define('reconcile', (st) => { const why = leaseStale(st); return why ? unmet('reconcile', `${st.lease.action} ${st.lease.target}`, `the action lease is stale: ${why}`) : null; });

// Deviation from the plan text: lib/scope.mjs's real openBreaches(log) spreads a scope-breach
// record's own payload fields onto each entry (sha, path, snapshot, base, declarations_digest);
// the field naming the workspace at which the breach was first observed is `snapshot`, not
// `first_observed` as the plan's code read it.
define('scope', (st) => {
  const b = openBreaches(st.log)[0];
  if (!b) return null;
  // The breach's own escalation is open: that is the developer's turn, so Waiting prints it.
  // Naming scope here read as "act now", and the agent filed a second escalation.
  if (openEscalations(st.log).some((o) => o.e.payload.concerns.split(' ').includes(`breach:${b.sha}`))) return null;
  return unmet('scope', b.path, `scope-breach ${b.sha} observed ${b.path} undeclared at ${b.snapshot}`);
});

// Issue #57: the answers and replies come from one pass over the log (escalationStates), not a
// scan of the rest of the log for each escalation.
function openEscalations(log) {
  const states = escalationStates(log);
  return log.filter((r) => r.kind === 'escalation').map((e) => {
    const { acts, answers } = states.get(e.sha);
    const final = answers.find((a) => a.payload.kind !== 'ask');
    const lastAsk = answers.at(-1)?.payload.kind === 'ask' ? answers.at(-1) : null;
    const replied = lastAsk && acts.slice(acts.indexOf(lastAsk) + 1).some((x) => x.kind === 'reply');
    return { e, final, lastAsk, replied };
  }).filter((x) => !x.final);
}
// Task 7 (plan 16): section 5's floor-and-veto carve-out -- with developer: absent, nothing
// routes a floor-caught or vetoed Consequential draft to the agent, so the developer is the only
// destination and that destination cannot answer. Wake still records and prints the escalation
// exactly as it does with a developer present (section 5, "Waiting and liveness"); only the exit
// code differs, decided here by reading the named measurement's own `outcome` off the log.
//
// Controller Ruling 18 (binding, spec commit c3956291, postdating the plan 16 task brief's own
// floor-only text and code): exit 4 applies when the escalation's measurement outcome is `floor`
// OR `veto`, not `floor` alone -- "A veto counts because section 5 says nothing routes a vetoed
// draft to the agent, so its Waiting is as unanswerable as the floor's" (section 5). Extended past
// the brief accordingly; named isFloorOrVetoEscalation (not the brief's isFloorEscalation) so the
// name still matches what it checks.
//
// Deliberately excluded, per the brief and section 5's own text: a `composite`-outcome escalation
// (the agent's own choice to escalate past a suggestion) is not exit 4, even though section 5
// notes that choice "would have no one to answer it either" under developer: absent -- the brief
// decides wake does not special-case it, so it stays ordinary Waiting. `unavailable` and
// `indeterminate` outcomes are not the floor or a veto either and get the same ordinary-Waiting
// treatment, unchanged from developer: present.
function isFloorOrVetoEscalation(log, esc) {
  if (!esc.payload.evaluation) return false;
  const m = log.find((x) => x.sha === esc.payload.evaluation && x.kind === 'measurement');
  return !!m && (m.payload.outcome === 'floor' || m.payload.outcome === 'veto');
}
define('waiting', (st) => {
  const o = openEscalations(st.log)[0];
  if (!o) return null;
  if (o.lastAsk && !o.replied) return unmet('reply', o.e.payload.slug, `the developer asked: ${o.lastAsk.payload.text}`);
  const { slug, question, recommendation, because, if_wrong, instead } = o.e.payload;
  // Issue #23 review: an ok closes every finding the escalation names (lib/escalate.mjs disputes),
  // and its five fields need not name them all, so the verdict lists them.
  // Issue #24: a retire concern's ok retires a backlog item, so it is listed the same way.
  // Issue #57: the records the concerns name are looked up in one map, not a scan per concern.
  const bySha = new Map();
  for (const r of st.log) if (!bySha.has(r.sha)) bySha.set(r.sha, r);
  const closes = o.e.payload.concerns.split(' ').flatMap((t) => {
    const retire = /^retire:([0-9a-f]{40})$/.exec(t);
    if (retire) return [`backlog item ${bySha.get(retire[1])?.payload.slug ?? retire[1].slice(0, 12)}`];
    // Issue #29: a wait concern's ok lets the item wait until the next Done.
    const wait = /^wait:([0-9a-f]{40})$/.exec(t);
    if (wait) return [`backlog item ${bySha.get(wait[1])?.payload.slug ?? wait[1].slice(0, 12)} waits until the next Done`];
    const m = /^finding:([0-9a-f]{40})#([1-9][0-9]*)$/.exec(t);
    if (!m) return [];
    const src = bySha.get(m[1]);
    return [`finding ${m[2]} on the ${src ? src.kind : 'record'} ${m[1].slice(0, 12)}`];
  });
  const base = { verdict: 'Waiting', party: 'developer', reason: `escalation ${o.e.sha} awaits an answer`,
    escalation: { sha: o.e.sha, slug, question, recommendation, because, if_wrong, instead, closes }, predicate: PREDICATES.waiting };
  // Revised 2026-09-22: under developer: absent every unanswered escalation exits 4, not only
  // the floor or a veto. An escalation the agent files after three failed attempts, a cycle bound
  // or a breach has no one to answer it either, and sat at an ordinary exit-0 Waiting; "a
  // benchmark run cannot sit at Waiting forever" (spec, Waiting and liveness) decides it.
  if (st.settings && st.settings.developer === 'absent') return { ...base, exit: 4 };
  return base;
});

// An active commitment's frozen contract does not change under it (section 8, invariant 49): a
// contract change requires finish or supersession. When the Agreed text of a set requirement is
// edited anyway, receipts and the mechanism review bind to the text as it reads now while the
// start record and the Done rule hold the frozen digest, so wake named `review mechanism` after
// every review, forever. Wake now names the exit instead: restore the text, or supersede.
define('supersede', (st) => {
  if (st.closed) return null;
  for (const { requirement, text_digest } of st.set) {
    const now = st.blocks.get(requirement)?.textDigest ?? null;
    if (now === text_digest) continue;
    const brief = (d) => d.replace(/^sha256:/, '').slice(0, 12);
    return unmet('supersede', st.slug, `the Agreed text of ${requirement} changed under ${st.slug} (frozen ${brief(text_digest)}, now ${now ? brief(now) : 'missing'}); the frozen contract is not amended: restore the text the start froze, or with the developer's ruling supersede ${st.slug} to a successor that freezes the revised text`);
  }
  return null;
});

// Fix round 1, item 11(d): shared by protectedChanged (below) and interfaceObligations, which
// duplicated this same before/after tree-diff.
async function snapshotDelta(st, fromSnap, toSnap) {
  const a = new Map((await listTree(st.cwd, await st.treeOf(fromSnap))).map((e) => [e.path, e.sha]));
  const b = new Map((await listTree(st.cwd, await st.treeOf(toSnap))).map((e) => [e.path, e.sha]));
  return [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p));
}
// Fix round 1, item 4: the plan's own three-way literal check (AGENTS.md, .sudus/settings.json, a
// docs/spec/ prefix) treats every docs/spec/** path as protected, but lib/paths.mjs's real
// classify() carries the roadmap's own exception (PROTECTED_EXCEPT: docs/spec/roadmap.md is
// edited by the kernel at start and promote, bound structurally rather than by digest, per section
// 2's Settings note) -- so a fix snapshot that only touches the roadmap was refused forever, with
// no way to ever pass 'fix'. classify(p, st.settings) is the same protected/kernel-managed/
// reserved/... classification scope.mjs's own preflight() uses, so this agrees with it instead of
// carrying a second, narrower copy of the protected-path rule.
async function protectedChanged(st, fromSnap, toSnap) {
  const changed = await snapshotDelta(st, fromSnap, toSnap);
  return changed.filter((p) => classify(p, st.settings) === 'protected');
}
define('fix', async (st) => {
  // Open: the commitment's own defects. Closed: every unfixed defect, since "Defect items are
  // fixed before promotion" and promote refuses on one wake never named.
  const mine = (r) => r.kind === 'item' && r.payload.kind === 'defect' && (st.closed || st.set.some((x) => x.requirement === r.payload.source));
  // Issue #57: positions, each item's last fix and each fix's base are read in one pass each,
  // not with a scan of the log per defect.
  const at = positions(st.log), bases = fixBases(st.log), lastFix = new Map();
  for (const r of st.log) if (r.kind === 'fix') lastFix.set(r.payload.item, r);
  for (const it of st.log.filter(mine)) {
    const fix = lastFix.get(it.sha);
    if (!fix) return unmet('fix', it.payload.slug, `defect ${it.payload.slug} against ${it.payload.source} has no fix record`);
    // Issue #4: the base is the contract frozen when the fix was recorded, not the newest start;
    // between commitments none is, and no protected delta is measured.
    const base = bases.get(fix.sha);
    if (base !== null && (await protectedChanged(st, base, fix.payload.snapshot)).length) return unmet('fix', it.payload.slug, 'the fix snapshot changes a protected path');
    // Issue #6: st.current covers the last commitment's set; between commitments a defect may be
    // against a requirement it never owned, so the pass is looked up for that requirement itself.
    if (!(it.payload.source in st.current)) st.current[it.payload.source] = await currentReceipt(st.cwd, st.log, it.payload.source, st.identities);
    const pass = st.current[it.payload.source];
    // Issue #64: with the fix recorded and no current receipt, a check is the one step left, but
    // wake named `fix` again after every commit to the requirement's inputs, and the manual's fix
    // move records the fix a second time. While a commitment is open the requirement is in its
    // set, and the run predicate names the check, waits on an open finding or escalates; between
    // commitments that predicate stands aside, so this one names the check.
    if (!pass) {
      if (!st.closed) continue;
      return unmet('run', it.payload.source, `the fix of ${it.payload.slug} is recorded and no current receipt carries a result for ${it.payload.source}`);
    }
    const passAt = at.get(pass.sha) ?? -1;
    // Review of 3.8.2: a pass from before the defect item was known is not at its fix.
    if (pass.result !== 'pass' || passAt < at.get(it.sha) || (passAt < at.get(fix.sha) && !(await inputsAt(st, st.log[passAt], fix.payload.snapshot)))) return unmet('fix', it.payload.slug, `${it.payload.source} has no current pass at or after the fix`);
  }
  return null;
});
// Issue #26: "a current pass at or after it" read as log order alone refused the manual's own
// order (commit, check, then `sudus fix`). A pass recorded before the fix record is at the fix
// when no input its mechanism declares differs between the fix record's snapshot and the
// workspace: the pass is current, so it ran on the inputs the fix record holds. A fix reverted
// afterwards differs there, and a pass from before it does not count.
async function inputsAt(st, receipt, snap) {
  const m = st.mechanisms[receipt.payload.mechanism];
  if (!m) return false;
  const delta = await workspaceDelta(st.cwd, await st.treeOf(snap));
  return !delta.some(({ path }) => isDeclared(path, m.definition.inputs));
}

define('record', (st) => {
  const declared = declaredPaths(st.mechanisms, null);
  const open = st.closed || !st.slug ? null : { slug: st.slug, requirements: st.set.map((x) => x.requirement) };
  for (const { path, change } of st.dirty) {
    if (!isDeclared(path, declared)) continue;
    if (!st.lease) return unmet('record', path, change === 'added'
      ? `${path} is an untracked file under a declared input and no action lease covers it; commit it under a lease, remove it, or gitignore it if it is a build artifact`
      : `${path} is a declared input with uncommitted changes and no action lease; lease the action that changes it, or commit or revert it`);
    if (!leaseCovers(st.lease, st.mechanisms, path, open)) return unmet('commit', path, `${path} is dirty and the lease for ${st.lease.action} ${st.lease.target} does not cover it`);
  }
  if (st.adrDirty) return unmet('commit', 'docs/decisions.jsonl', 'docs/decisions.jsonl has uncommitted lines; commit it (git add -f when docs/ is ignored)');
  return null;
});

const mechanismsFor = (st, req) => Object.entries(st.mechanisms).filter(([, m]) => m.definition.requirements.includes(req));
define('declare', (st) => {
  if (st.closed) return null;
  const missing = st.set.find((x) => mechanismsFor(st, x.requirement).length === 0);
  return missing ? unmet('declare', missing.requirement, `no mechanism definition names ${missing.requirement}`) : null;
});

function lastPassIndex(st, req) {
  return st.log.findLastIndex((r) => r.kind === 'receipt' && r.payload.status === 'ran' && r.payload.results.some((x) => x.requirement === req && x.result === 'pass'));
}
define('run', (st) => {
  if (st.closed) return null;
  // Spec revision 10: while the report has an open finding, a receipt that a fix made stale waits
  // and wake names the next resolution; the checks run once, after the last finding is resolved or
  // declined. A current receipt that fails is named at once.
  const resolving = Boolean(completeReport(st.records)) && openFindings(st).length > 0;
  for (const { requirement: req } of st.set) {
    const c = st.current[req];
    if (c && c.status === 'ran' && c.result === 'pass') continue;
    const { tried, needed } = attemptState(st.log, req);
    if (needed) return unmet('escalate', req, `${tried} distinct failing attempts at ${req} without a pass`);
    if (!c && resolving) continue;
    if (!c) return unmet('run', req, `no current receipt carries a result for ${req}`);
    return unmet('implement', req, `the current receipt for ${req} says ${c.status === 'ran' ? c.result : 'error'}`);
  }
  return null;
});

// Item 10 (fix round 1): closed by ruling, no change. The review-metadata binding below is
// already covered by the definition digest; a declared input's own bytes, including a pass/fail
// flag, are expected to differ from the fail receipt's recorded product once a requirement is
// fixed, so no separate product-digest check is added. See plan-08-report.md for the earlier attempt.
function reviewBound(st, req) {
  const frozen = st.set.find((x) => x.requirement === req)?.text_digest;
  return mechanismsFor(st, req).some(([, m]) => {
    const rv = m.review?.[req];
    if (!reviewHolds(rv, m, req) || rv.textDigest !== frozen) return false;
    const fr = st.log.find((r) => r.sha === rv.failReceipt);
    return Boolean(fr && fr.kind === 'receipt' && fr.payload.status === 'ran' && fr.payload.results.some((x) => x.requirement === req && x.result === 'fail'));
  });
}
define('review mechanism', async (st) => {
  if (st.closed) return null;
  const stale = st.set.find((x) => !reviewBound(st, x.requirement));
  if (!stale) return null;
  // Issue #31: name only a fail receipt review mechanism accepts; one that ran under another
  // command, working directory, results mode or text was named, and every first try failed.
  const req = stale.requirement;
  const fr = await usableFailReceipt(st.cwd, st.log, st.mechanisms, req, stale.text_digest, mechanismsFor(st, req).map(([n]) => n));
  const hint = fr.sha ? `; its latest fail receipt is ${fr.sha}`
    : fr.any ? `; no fail receipt for ${req} ran under the current command, working directory, results mode and text: make its violating example fail, run sudus check ${req}, then review mechanism ${req} with that receipt`
    : '; no fail receipt exists yet, run sudus check against a violating example first';
  return unmet('review mechanism', stale.requirement, `review metadata for ${stale.requirement} is missing or bound to another command, working directory, results mode or text digest${hint}`);
});

define('capture', (st) => {
  if (st.closed) return null;
  // Issue #57: outside records and capture escalations are gathered once, not scanned per item.
  const outside = new Set(st.log.filter((r) => r.kind === 'outside').map((r) => r.payload.item));
  const byToken = concernIndex(st.log);
  for (const it of st.records.filter((r) => r.kind === 'item' && r.payload.kind !== 'defect' && st.set.some((x) => x.requirement === r.payload.source))) {
    const covered = outside.has(it.sha) || byToken.has(`item:${it.sha}`);
    if (!covered) return unmet('capture', it.payload.slug, `item ${it.payload.slug} surfaced from ${it.payload.source} and nothing says why it is outside`);
  }
  return null;
});

function requiredQuestions(st) {
  const mech = [...new Set(st.set.flatMap((x) => mechanismsFor(st, x.requirement).map(([n]) => n)))];
  return [...mech.flatMap((m) => [['Q1', m], ['Q2', m]]), ...st.set.flatMap((x) => [['Q3', x.requirement], ['Q4', x.requirement]]), ['Q5', st.slug], ['Q6', st.slug]];
}
export const latest = (st, kind) => st.records.filter((r) => r.kind === kind).at(-1) ?? null;
define('review', async (st) => {
  if (st.closed) return null;
  const rev = latest(st, 'review');
  if (!rev) return unmet('review', st.slug, `no review names a workspace snapshot for ${st.slug}`);
  const missing = requiredQuestions(st).find(([q, t]) => !rev.payload.answers.some((a) => a.question === q && a.target === t));
  if (missing) return unmet('review', st.slug, `the review answers nothing for ${missing[0]} for ${missing[1]}`);
  if (!completeReport(st.records) && !(await st.atWorkspace(rev.payload.snapshot))) return unmet('review', st.slug, 'the workspace differs from the reviewed snapshot and no report exists yet');
  return null;
});

// Measured from the first start of the supersession chain, as the brief and the report measure it
// (issue #8): a successor carries the work committed before its own start.
async function interfaceObligations(st, rev) {
  const changed = await snapshotDelta(st, chainStart(st.log, st.start).payload.snapshot, rev.payload.snapshot);
  const globs = st.settings?.interfaces ?? [];
  return changed.filter((p) => globs.some((g) => matchGlob(g, p)));
}
// Deviation from the plan text: the real 'brief' schema's own digest field is projection_digest
// (not projection) and the real 'report' schema's is also projection_digest, so the brief/report
// cross-check below compares those field names, not the plan's `projection`.
// Fix round 2, finding 4: corrected. Guards against being reached with no review at all (`rev`
// null). Under wake's own cascading precedence, and under lib/cycle.mjs's guardKernelWrite's
// firstUnmetIndex (which stops at the first unmet predicate in ORDER other than Waiting, not
// every one), 'report' is never actually reached with a null `rev` in practice -- 'review' would
// already be that first unmet predicate. This guard is defensive: cheap, harmless, and exercised
// directly by tests/wake.test.mjs's own unit test of the predicate, not by a real code path that
// needs it today. Kept so `rev.payload.snapshot` inside the later unmet(...) message cannot throw if a
// future caller ever asks this predicate about a state out of the usual cascading order.
define('report', async (st) => {
  if (st.closed) return null;
  const rev = latest(st, 'review');
  if (!rev) return unmet('report', st.slug, `no review exists yet for ${st.slug}`);
  const rep = completeReport(st.records);
  if (!rep) {
    // Sudus 4.0.0: an adversary that finds a Sudus bug stops and reports it instead. The builder
    // decides what to do with the bug; the review needs a new brief and a new adversary.
    const last = latest(st, 'report');
    if (last && isBugReport(last)) return unmet('report', st.slug, `the report ${last.sha} stopped on a Sudus bug: ${last.payload.sudus_bug.replace(/\s+/g, ' ').trim()}; brief again when the bug no longer blocks the review`);
    return unmet('report', st.slug, `no report names the reviewed snapshot ${rev.payload.snapshot} through a current brief`);
  }
  const brief = st.records.find((r) => r.kind === 'brief' && r.sha === rep.payload.brief);
  if (!brief || brief.payload.review !== rev.sha || rep.payload.snapshot !== rev.payload.snapshot || (isLegacyReport(rep) && rep.payload.projection_digest !== brief.payload.projection_digest)) return unmet('report', st.slug, `no report names the reviewed snapshot ${rev.payload.snapshot} through a current brief`);
  // A 3.x report attempted the six questions; a 4.0.0 report attempts the five lenses.
  const pairs = isLegacyReport(rep) ? requiredQuestions(st) : attackPairs({ slug: st.slug, requirements: st.set.map((x) => x.requirement) }, brief.payload.decisions);
  const q = pairs.find(([q, t]) => !rep.payload.attempts.some((a) => a.question === q && a.target === t));
  if (q) return unmet('report', st.slug, `the report has no attempt at ${q[0]} for ${q[1]}`);
  const iface = (await interfaceObligations(st, rev)).find((p) => !rep.payload.interface_attempts.some((a) => a.path === p));
  if (iface) return unmet('report', st.slug, `the report has no caller-level attempt at interface ${iface}`);
  return null;
});

// Every review's findings, every report's and a 3.x acceptance's, plus those a supersession carried
// in: the sources lib/review.mjs's ledger reads. Review of 4.0.0: only the latest review's were
// read here, so a second review before the report hid the first one's findings from the Done rule
// while sudus done printed them open, and a closed commitment left them open for good.
function findingSources(st) {
  return [...carriedFindingSources(st.log, st.range), ...st.records.filter((r) => r.kind === 'review' || r.kind === 'report' || r.kind === 'acceptance')];
}
function openFindings(st) {
  // Resolutions and declines are read log-wide: a carried finding's may sit in an earlier range.
  // A resolution a 3.x acceptance rejected leaves its finding open.
  const rejected = new Set(st.log.filter((r) => r.kind === 'acceptance').flatMap((a) => a.payload.rejected.map((x) => x.resolution)));
  const pending = new Set(openEscalations(st.log).map((o) => o.e.sha));
  // Issue #57: what closes or holds each finding is gathered in one pass each, not a scan of the
  // log per finding. A finding is keyed <source sha>#<n>; both parts are a sha and an integer.
  const closed = new Set();
  for (const r of st.log) if ((r.kind === 'resolution' && !rejected.has(r.sha)) || r.kind === 'decline') closed.add(`${r.payload.source}#${r.payload.finding}`);
  const states = escalationStates(st.log), byToken = concernIndex(st.log);
  const out = [];
  for (const src of findingSources(st)) for (const f of src.payload.findings) {
    // Issue #20: an escalation holds a finding while it waits, and the developer's ok closes it.
    const named = byToken.get(`finding:${src.sha}#${f.n}`) ?? [];
    const settled = named.some((e) => states.get(e.sha).ok) || named.some((e) => pending.has(e.sha));
    if (!closed.has(`${src.sha}#${f.n}`) && !settled) out.push({ source: src, n: f.n, severity: f.severity ?? null });
  }
  return out;
}
// Sudus 4.0.0: the builder decides every finding. It fixes it and records a resolution, or
// declines it with its reason; no verdict waits on the adversary or the developer for either.
define('resolve', (st) => {
  if (st.closed) return null;
  const f = openFindings(st)[0];
  if (!f) return null;
  return unmet('resolve', `${st.slug} ${f.n}`, `finding ${f.n}${f.severity ? ` (${f.severity})` : ''} on the ${f.source.kind} ${f.source.sha} has no resolution and no decline`);
});

// Fix round 1, item 5: shared by 'build' (below) and doneRule's bullet 4. Only a 'realized' or
// 'superseded' line closes a Consequential decision for this purpose; a 'read' line (kind !==
// 'decision', which the old doneRule code below used to select on) records only that the
// developer looked at it, never that it was realized.
function closedDecisionIds(adr) {
  return new Set(adr.filter((l) => l.kind === 'realized' || l.kind === 'superseded').map((l) => l.of));
}
define('build', (st) => {
  const closedIds = closedDecisionIds(st.adr);
  const open = st.adr.find((l) => l.kind === 'decision' && l.level === 'Consequential' && !closedIds.has(l.id));
  return open ? unmet('build', open.id, `decision ${open.id} (${open.title}) has no realized line`) : null;
});

export async function doneRule(st) {
  const failed = [];
  if (!st.set.every((x) => st.current[x.requirement]?.result === 'pass' && st.current[x.requirement].status === 'ran' && reviewBound(st, x.requirement))) failed.push('evidence');
  const rev = latest(st, 'review'), rep = completeReport(st.records);
  if (!rev || !rep || rep.payload.snapshot !== rev.payload.snapshot) failed.push('review-report');
  else if (openFindings(st).length) failed.push('findings');
  // Fix round 1, item 5: this used to select every non-'decision' ADR line (including 'read' and
  // 'answered', neither of which closes a Consequential decision) and never checked
  // level === 'Consequential' at all -- a 'read' line (from `sudus decisions --read`, a mere
  // developer acknowledgment) wrongly closed an unrealized decision, and the missing level check
  // meant nothing there actually distinguished a Consequential decision from any other line kind
  // that happened to carry an `of` field. Shares closedDecisionIds with the 'build' predicate
  // above, so both bullets agree on what closes a decision.
  const closedIds = closedDecisionIds(st.adr);
  if (openEscalations(st.log).length || openBreaches(st.log).length || st.tx || leaseStale(st) || st.adr.some((l) => l.kind === 'decision' && l.level === 'Consequential' && !closedIds.has(l.id))
    || unfixedDefects(st.log).some((r) => st.set.some((x) => x.requirement === r.payload.source))) failed.push('obligations');
  return { holds: failed.length === 0, failed };
}
define('done', async (st) => {
  if (st.closed) return null;
  const { holds, failed } = await doneRule(st);
  return holds ? unmet('done', st.slug, `the Done rule holds for ${st.slug} and no done record exists`) : unmet('done', st.slug, `the Done rule fails on ${failed.join(', ')} although every earlier predicate holds`);
});

// Issue #35 (spec revision 18): after Done, an item another clone captured while this commitment
// was open waits in that clone's inbox; wake names folding it onto the log before any promotion,
// so the backlog promotion reads is whole. An item in conflict with the log is not waited on.
define('fold', (st) => {
  if (!st.closed || st.records.some((r) => r.kind === 'superseded')) return null;
  const waiting = inboxState(st.log, st.inbox).find((s) => s.state === 'waiting');
  return waiting ? unmet('fold', waiting.item.payload.slug, `inbox item ${waiting.item.payload.slug} from clone ${waiting.item.clone} is not on the log and no commitment is open`) : null;
});

define('promote', (st) => {
  if (!st.closed || st.records.some((r) => r.kind === 'superseded')) return null;
  const promoted = new Set(st.log.filter((r) => r.kind === 'promotion').map((r) => r.payload.item));
  // Issue #24: the developer's ok on a retire escalation takes an item out of the backlog.
  // Issue #29: the ok on a wait escalation lets the item wait until the next Done.
  const holds = itemHolds(st.log);
  const item = st.log.find((r) => r.kind === 'item' && r.payload.kind === 'backlog' && !promoted.has(r.sha) && !holds.retired(r.sha) && !holds.waited(r.sha));
  return item ? unmet('promote', item.payload.slug, `backlog item ${item.payload.slug} waits for promotion and no commitment is open`) : null;
});

// Fix round 1, item 7: dropped the trailing `answer: sudus answer ...` line -- section 6's own
// contract is verdict, action or party, one reason line and the predicate; an `answer:` line
// names a command Waiting's own five fields never claimed to include. The working agreement tells
// the developer the command to run.
export function render(v) {
  if (v.exit === 3) return v.line + '\n';
  if (v.verdict === 'Waiting') {
    const e = v.escalation;
    const closes = e.closes?.length ? [`ok closes: ${e.closes.join(', ')}`] : [];
    return ['verdict: Waiting', 'party: developer', `reason: ${v.reason}`, `question: ${e.question}`, `recommendation: ${e.recommendation}`, `because: ${e.because}`, `if wrong: ${e.if_wrong}`, `instead: ${e.instead}`, ...closes, `predicate: ${v.predicate}`].join('\n') + '\n';
  }
  const action = v.verdict === 'Done' ? `commitment: ${v.target}` : `action: ${v.action} ${v.target}`;
  // Issue #29: Done lists the backlog items that wait by the developer's ok, so none is lost.
  const waits = v.waits?.length ? [`waits: ${v.waits.map((w) => `${w.slug} (escalation ${w.escalation.slice(0, 12)})`).join(', ')}; wake names their promotion after the next Done`] : [];
  return [`verdict: ${v.verdict}`, action, `reason: ${v.reason}`, ...waits, `predicate: ${v.predicate}`].join('\n') + '\n';
}
export async function cmdWake(cwd) {
  const v = await wake(cwd);
  process.stdout.write(render(v));
  // One line, after the verdict, while a project still uses the former layout: the verdict and
  // every command are unchanged by it, and migrate runs only between commitments.
  if (layoutOf(cwd) === CAIRN) process.stdout.write(`layout: ${CAIRN.dir} (the former name); sudus migrate moves it to ${SUDUS.dir} between commitments\n`);
  return v.exit === 3 ? 3 : v.exit === 4 ? 4 : 0;
}

// Fix round 1, item 6: semantic progress is exactly the spec's four clauses ("a start-set
// requirement gains a current pass; an unresolved finding, defect or escalation is closed without
// an equal-or-higher priority obligation being created; the loop advances ...; or the developer
// explicitly authorizes continuation") -- a scope breach is not in that list. `obligations` used
// to include openBreaches(st.log).length, so disposing a breach (keep or restore) lowered the
// count and progressMade below read that as progress on its own, resetting the cycle counter for
// something the spec never names as a progress trigger.
//
// Fix round 1, item 11(e): the `head` field was carried on every summary but progressMade (below)
// never reads it; dropped.
// Each record's position, the first when a sha repeats (as log.findIndex by sha finds it).
function positions(log) {
  const at = new Map();
  log.forEach((r, i) => { if (!at.has(r.sha)) at.set(r.sha, i); });
  return at;
}
// Defect items with no fix record, the fixes gathered once rather than scanned for each defect.
function unfixedDefects(log) {
  const fixed = new Set(log.filter((r) => r.kind === 'fix').map((r) => r.payload.item));
  return log.filter((r) => r.kind === 'item' && r.payload.kind === 'defect' && !fixed.has(r.sha));
}
export function progressSummary(st) {
  const passes = st.set.filter((x) => st.current[x.requirement]?.result === 'pass').map((x) => x.requirement).sort();
  const rep = completeReport(st.records), rev = latest(st, 'review');
  const phase = st.closed ? 3 : rep ? 2 : rev ? 1 : 0;
  const defects = unfixedDefects(st.log).length;
  const obligations = openFindings(st).length + defects + openEscalations(st.log).length;
  const answered = st.log.filter((r) => r.kind === 'answer' && r.payload.kind !== 'ask').length;
  return { passes, obligations, phase, answered, slug: st.slug };
}
export function progressMade(before, after) {
  if (!before) return false;
  // A new commitment is progress: the loop advanced through Done (or a supersession) and opened
  // another. Its phase restarts at 0, which read as no progress, so administrative counts from
  // the closed commitment carried over and tripped a cycle escalation on the new one's first
  // ordinary action (second adversarial review, two-commitments area).
  if (after.slug !== before.slug) return true;
  if (after.passes.some((p) => !before.passes.includes(p))) return true;
  if (after.obligations < before.obligations) return true;
  if (after.phase > before.phase) return true;
  if (after.answered > before.answered) return true;
  return false;
}
