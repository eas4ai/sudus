import { canonicalize, parseStrict, sha256 } from './canon.mjs';
import { git, readRef, updateRefCAS, commitTree, catCommits, emptyTree } from './gitx.mjs';
import { layoutOf, envelopeOf, SUDUS, LAYOUTS } from './layout.mjs';

export class RecordError extends Error { constructor(m, reasons = []) { super(reasons.length ? `${m}: ${reasons.join('; ')}` : m); this.name = 'RecordError'; this.reasons = reasons; } }
export const SCHEMA = '1';
export const TARGET_RE = /^(-|[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;

const T = (t) => ({ t });
export const ws = T('ws'), input = T('input'), ref = T('ref'), sha = T('sha'), digest = T('digest'), str = T('str'), token = T('token'),
  int = T('int'), unit = T('unit'), bool = T('bool'), ulid = T('ulid'), b64 = T('b64'), json = T('json');
export const nullable = (of) => ({ t: 'nullable', of }), list = (of) => ({ t: 'list', of }),
  oneOf = (...values) => ({ t: 'enum', values }), obj = (shape) => ({ t: 'obj', shape }),
  // A discriminated union: the shape checked is chosen by the value's own `key` field. Added for
  // lib/auth.mjs's evidence object, whose signed and unsigned-local variants carry different closed
  // key sets (deviation recorded in the plan 03 report: the plan's original `evidence` schema entry
  // did not account for this).
  variant = (key, shapes) => ({ t: 'variant', key, shapes });

const SHA = /^[0-9a-f]{40}$/, DIGEST = /^sha256:[0-9a-f]{64}$/, ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/, B64 = /^[A-Za-z0-9_-]*$/;
export function check(desc, v, path, out) {
  const ok = (cond, what) => { if (!cond) out.push(`${path}: ${what}`); };
  const s = typeof v === 'string';
  switch (desc.t) {
    case 'ws': case 'input': case 'ref': case 'sha': return ok(s && SHA.test(v), 'expected 40 lowercase hex');
    case 'digest': return ok(s && DIGEST.test(v), 'expected sha256:<64 hex>');
    case 'str': return ok(s, 'expected string');
    case 'token': return ok(s && TARGET_RE.test(v), 'expected token');
    case 'int': return ok(Number.isSafeInteger(v) && v >= 0, 'expected non-negative integer');
    case 'unit': return ok(typeof v === 'number' && v >= 0 && v <= 1, 'expected number in [0,1]');
    case 'bool': return ok(typeof v === 'boolean', 'expected boolean');
    case 'ulid': return ok(s && ULID.test(v), 'expected ULID');
    case 'b64': return ok(s && B64.test(v), 'expected unpadded base64url');
    case 'json': return ok(v !== undefined, 'expected JSON value');
    case 'enum': return ok(desc.values.includes(v), `expected one of ${desc.values.join('|')}`);
    case 'nullable': return v === null ? undefined : check(desc.of, v, path, out);
    case 'list': if (!Array.isArray(v)) return ok(false, 'expected array'); return v.forEach((x, i) => check(desc.of, x, `${path}[${i}]`, out));
    case 'obj': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return ok(false, 'expected object');
      const keys = Object.keys(v), want = Object.keys(desc.shape);
      for (const k of want) ok(Object.hasOwn(v, k), `missing ${k}`);
      for (const k of keys) ok(Object.hasOwn(desc.shape, k), `unknown key ${k}`);
      ok(keys.length === want.length, `expected ${want.length} fields, found ${keys.length}`);
      for (const k of want) if (k in v) check(desc.shape[k], v[k], `${path}.${k}`, out);
      return;
    }
    // The two durable refs of one layout, as an intent record captured them: exactly that layout's
    // log and snapshots keys, each a sha or null. A record written under the former layout keeps
    // its refs/cairn/* keys and still reads.
    case 'refpair': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return ok(false, 'expected object');
      const keys = Object.keys(v);
      const L = LAYOUTS.find((l) => keys.length === 2 && keys.includes(l.log) && keys.includes(l.snapshots));
      if (!L) return ok(false, `expected the keys ${SUDUS.log} and ${SUDUS.snapshots}`);
      for (const k of keys) check(nullable(sha), v[k], `${path}.${k}`, out);
      return;
    }
    // Sudus 4.0.0: a kind whose shape changed keeps its former shape readable, so a log written
    // before the change still reads. A payload is valid when it matches one of the shapes; the
    // reasons reported are the first (current) shape's.
    case 'alt': {
      const tries = desc.shapes.map((sh) => { const r = []; check(sh, v, path, r); return r; });
      if (tries.some((r) => r.length === 0)) return;
      out.push(...tries[0]);
      return;
    }
    case 'variant': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return ok(false, 'expected object');
      const tag = v[desc.key];
      if (!Object.hasOwn(desc.shapes, tag)) return ok(false, `unknown ${desc.key} ${JSON.stringify(tag)}`);
      return check(obj(desc.shapes[tag]), v, path, out);
    }
    default: throw new Error(`bad descriptor ${desc.t}`);
  }
}

// lib/auth.mjs's authenticateDeveloper produces one of two differently-shaped evidence objects
// (section 2 Settings: "With a key ... with null, ... records the Git author"); see the `variant`
// deviation note above.
// Spec revision 6, "Developer evidence": the null-key path is now attested (a quote, the agent's
// harness and the Git author), not a terminal confirmation. 'unsigned-local' stays in the schema,
// read-only, so a record written before this change still decodes; nothing writes it again.
const evidence = variant('mode', {
  signed: { mode: oneOf('signed'), purpose: str, subject: str, nonce: str, signature: b64 },
  attested: { mode: oneOf('attested'), purpose: str, subject: str, nonce: str, quote: str, harness: str, author: obj({ name: str, email: str }) },
  'unsigned-local': { mode: oneOf('unsigned-local'), purpose: str, subject: str, nonce: str, author: obj({ name: str, email: str }), confirmed: bool },
});
const finding = obj({ n: int, text: str });
// Sudus 4.0.0 (spec revision 16): the adversary's report reads by five lenses, each attempt says
// what it looked for, what it found and whether the work held, and a finding carries its severity.
const LENS = oneOf('falsifier', 'decision', 'security', 'logic', 'complexity');
const heldAttempt = { looked_for: str, found: str, held: bool };
const ratedFinding = obj({ n: int, severity: oneOf('Critical', 'Major', 'Minor'), where: str, text: str, remedy: nullable(str) });
const reqDigest = obj({ requirement: token, text_digest: digest });
// Fix round 1 finding 9: `identity` is nullable -- HEAD before any commit, or a file that does
// not exist, is a real, representable identity, not an encoding error.
const storeIdentity = obj({ store: str, identity: nullable(str) });
const verdict = obj({ resolution: ref, reason: str });
const question = oneOf('Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6');
// Plan 15 Task 2: the five composite Score dimensions section 10 names, shared by 'measurement's
// levels list and its veto field.
export const DIMENSION = oneOf('evidence', 'reach', 'contract', 'surface', 'ambiguity');
// Fix round 1 finding 4/9: every planned write now carries a digest (file: its bytes; branch: its
// planned paths and message; snapshot: a fixed marker, since a snapshot's content is only known at
// apply time; log: its planned kind, target and payload), and the shape is chosen by `store`, the
// same discriminated-union pattern `evidence` already uses. `payload` on a log write is `json`
// since a record payload's own shape depends on its kind, checked separately when the write
// actually runs (lib/tx.mjs's applyWrites calls appendRecord, which re-validates it against
// SCHEMAS[kind] on its own terms).
// Fix round 2 finding 1 (Important): 'append' is the same shape as 'file' (a path and a digest of
// the staged bytes) -- what differs is only how applyWrites (lib/tx.mjs) applies those bytes
// (appended to whatever the file currently holds, never overwriting it), which this record-level
// schema has no reason to know about.
const writeEntry = variant('store', {
  file: { store: oneOf('file'), path: str, digest },
  append: { store: oneOf('append'), path: str, digest },
  branch: { store: oneOf('branch'), paths: list(str), message: str, digest },
  snapshot: { store: oneOf('snapshot'), digest },
  log: { store: oneOf('log'), kind: token, target: token, payload: json, digest },
});
// Fix round 1 finding 9: the two durable refs are a fixed, known key set (never an open map), so
// `pre`'s `refs` field is an obj descriptor; `files` stays `json` because its keys are the plan's
// own declared file paths, which are open-ended by nature (a plan can touch any number of files).
const refPair = { t: 'refpair' };
const preShape = obj({ refs: refPair, head: nullable(sha), files: json });
export const SCHEMAS = {
  'init': { settings_digest: digest, authority_remote: nullable(str), auth_mode: oneOf('signed', 'attested', 'unsigned-local') },
  // Spec revision 6, "Direction": `sudus authorize instead|ask` writes this instead of binding the
  // three protected digests -- the developer's own words, redirecting or questioning the agent's
  // recommendation, with no nonce or subject to verify later (nothing protected changes).
  'direction': { purpose: oneOf('authorize'), kind: oneOf('instead', 'ask'), text: str, harness: str, author: obj({ name: str, email: str }) },
  // `intent` deviation: the plan's Task 1 record-shapes note lists `intent: string|null` on the
  // authorization payload (set by plan 04's transaction wrapper), but the schema entry already
  // committed on this branch (plan 01/02) omitted it. Added here since Task 4's authorize() writes it.
  // Fix round 1 finding 3: `results: list(storeIdentity)` added -- withTransaction's `finish` now
  // injects it into every terminal payload the same way it injects `intent`, naming each planned
  // write's actual resulting identity so a later drift can be detected by comparing against it.
  'authorization': { spec_digest: digest, agreement_digest: digest, settings_digest: digest, evidence, decision: nullable(ulid), intent: nullable(ref), results: list(storeIdentity) },
  // `command-intent`/`command-abort` deviation: plan 01's schema entries (input_identity,
  // pre_identities: list(storeIdentity), planned_writes: list({store,digest}); restored:
  // list(storeIdentity)) were a provisional guess never exercised by any committed code or test.
  // Plan 04's actual record-shapes note (this plan's Task 1 section) and its Tasks 2-5 tests fix a
  // different, already-settled shape: command-intent carries {tx, command, identity, pre, writes}.
  // Fix round 1 finding 9: `tx` stays `token`, not `ulid` -- reverting it would mean every test
  // fixture that stages or recovers a transaction with a readable name like 'TXCRASH' would have to
  // become an opaque ulid() everywhere that name is threaded through (recover, stagingDir, repair
  // messages), a wide, purely cosmetic rewrite for a Minor finding with no correctness stake
  // (`token` already refuses anything TARGET_RE does, matching every real `tx = ulid()` this
  // module itself generates); `writes` is now the `writeEntry` variant above (finding 4), and
  // `pre` is the mostly-obj `preShape` above; `identity` stays `json` because it is genuinely
  // different per command -- authorize's is {spec,agreement,settings,head}, and start/promote/
  // supersede (plan 06) will each define their own, unknowable from this plan.
  'command-intent': { tx: token, command: oneOf('start', 'promote', 'supersede', 'authorize'), identity: json, pre: preShape, writes: list(writeEntry) },
  // Fix round 1 finding 2/3: `restored` is `list(storeIdentity)`, one entry per re-read store
  // (refs/sudus/log, refs/sudus/snapshots, HEAD, each planned file), not a copy of the pre-capture
  // taken before the intent, which the log ref can never truthfully equal again (it is append-only
  // and the intent's own record already advanced it); `results` mirrors the terminal payload's own
  // field so recoverPredicate/pendingTransaction can read one field name off either kind of closing
  // record. An abort's own writes never landed, so its `results` is always the empty list.
  'command-abort': { intent: ref, failure_class: token, restored: list(storeIdentity), results: list(storeIdentity) },
  // Fix round 1 finding 8, scoped: 'promotion' and 'superseded' below get intent/results now (no
  // other file constructs either kind). 'start' does NOT -- tests/snapshots.test.mjs constructs raw
  // 'start' payloads without them, and that file is outside this fix round's authorized scope
  // (lib/tx.mjs, lib/lease.mjs, lib/auth.mjs, lib/records.mjs, lib/cli.mjs and tests
  // tx/lease/auth/records/cli only). Closing 'start' here would refuse that file's fixtures with no
  // way to fix them in-scope. Left as plan 01 defined it; plan 06, which actually builds `start`,
  // must add intent/results (and update tests/snapshots.test.mjs's fixtures) when it runs `start`
  // through withTransaction, the same way this report closes 'promotion' and 'superseded' now.
  // Carried obligation from plan 04 (this branch's Task 1 note): 'start' was left open pending
  // plan 06, which writes it through withTransaction. Closed here with intent/results the same way
  // 'promotion' and 'superseded' already were (Fix round 1 finding 8) -- a transaction-written
  // terminal record always names its intent.
  // Issue #35 (spec revision 18): the start names the clone that started it, so a capture on any
  // other clone goes to that clone's inbox instead of racing the log. A start written before 4.2.0
  // has no clone and still reads.
  'start': [
    { slug: token, snapshot: ws, requirements: list(reqDigest), from_superseded: nullable(ref), clone: token, intent: nullable(ref), results: list(storeIdentity) },
    { slug: token, snapshot: ws, requirements: list(reqDigest), from_superseded: nullable(ref), intent: nullable(ref), results: list(storeIdentity) },
  ],
  // Deviation from the plan text: this entry was plan 01's provisional guess (field names
  // snapshot/outcome/environment/output_digest/exit_code/signal), never exercised by any
  // committed code or test (confirmed by grep: no other file referenced those field names).
  // Plan 05's Task 3 payload (lib/check.mjs's check()) uses a different, now-settled shape, and
  // its own Step 4 anticipates exactly this: "align plan 01's table to this list (it is the
  // writer's list)". Updated here, at first use, the same way plan 04's report already updated
  // command-intent/command-abort. `identity` and the nested `exit` object use `json`/`obj` since
  // their key sets are open (tool/env names) or free-shaped, the same pattern already used for
  // command-intent's `identity`, `pre` and `writes` fields above.
  'receipt': { mechanism: token, definition_digest: digest, input: input, product_digest: digest, status: oneOf('ran', 'error'), identity: json, results: list(obj({ requirement: token, text_digest: digest, result: oneOf('pass', 'fail', 'unverified') })), output: digest, exit: obj({ code: nullable(int), signal: nullable(str) }) },
  'review': { slug: token, session: nullable(str), snapshot: ws, examined: list(str), answers: list(obj({ question, target: str, status: oneOf('observed', 'not-checked'), text: str })), findings: list(finding) },
  // Fix round 1 item 1 (Critical): harness/model/transport/boundary added so the brief record
  // carries the actual launch instruction sudus brief chose. report() reads them from here, not
  // from a harness name the report body itself supplies, which previously let any report escape
  // the model/transport check by naming an unpinned or unconfigured harness.
  // Sudus 4.0.0: a brief and a report take the first shape; the second is the 3.x shape, which a
  // log written before 4.0.0 still holds (a projection, a launch model and transport, a session).
  'brief': [
    { slug: token, review: ref, harness: str, model: nullable(str), payload_digest: digest, decisions: list(str) },
    { slug: token, review: ref, harness: str, model: nullable(str), transport: nullable(oneOf('local', 'remote')), boundary: oneOf('enforced', 'unenforced'), projection_digest: digest, payload_digest: digest, exclusions_digest: digest },
  ],
  'report': [
    { slug: token, snapshot: ws, brief: ref, attempts: list(obj({ question: LENS, target: str, ...heldAttempt })), interface_attempts: list(obj({ path: str, ...heldAttempt })), findings: list(ratedFinding), sudus_bug: nullable(str) },
    { slug: token, session: nullable(str), snapshot: ws, brief: ref, model: str, transport: oneOf('local', 'remote'), boundary: oneOf('enforced', 'unenforced'), builder_model: nullable(str), projection_digest: digest, attempts: list(obj({ question, target: str, text: str })), findings: list(finding), interface_attempts: list(obj({ path: str, text: str })) },
  ],
  'resolution': { source: ref, finding: int, snapshot: ws, explanation: str },
  // Sudus 4.0.0: the builder declines a finding with its reason instead of fixing it.
  'decline': { source: ref, finding: int, reason: str },
  'acceptance': { slug: token, session: nullable(str), report: ref, snapshot: ws, delta_digest: digest, accepted: list(verdict), rejected: list(verdict), findings: list(finding) },
  'escalation': { slug: token, question: str, recommendation: str, because: str, if_wrong: str, instead: str, concerns: str, evaluation: nullable(ref) },
  'answer': { escalation: ref, kind: oneOf('ok', 'instead', 'ask'), text: str, owner: nullable(str), evidence },
  'reply': { escalation: ref, text: str },
  'read': { decision: ulid, evidence },
  // Plan 15 Task 2: one call per draft now (not owner+option), so the intent carries one
  // `request_digest` and the `source` it targets. `source` is non-nullable: both records settle it
  // from settings.typesafeai.enabled before the floor is even checked, so it is always known,
  // whether or not a call ever happens (plan commit de6a2791).
  'evaluation-intent': { draft_digest: digest, snapshot: ws, log_head: ref, adr_digest: digest, settings_digest: digest, policy_digest: digest, source: oneOf('jev', 'review'), request_digest: nullable(digest),
    session: nullable(str), launch: nullable(obj({ harness: str, model: nullable(str), transport: nullable(oneOf('local', 'remote')), boundary: oneOf('enforced', 'unenforced') })) },
  // `call` (owner/option) and `not_sent` are gone -- a call record is written only for an attempted
  // call; a floor or `unavailable` draft gets no call record at all, only an intent and a
  // measurement. `source` names which of jev/review answered; `transport`/`session` (review source
  // only) are the same self-answer refusal lib/review.mjs's report() already applies.
  'evaluation-call': { intent: ref, source: oneOf('jev', 'review'), request_digest: digest, outcome: oneOf('response', 'failure', 'indeterminate'), model: nullable(str), transport: nullable(oneOf('local', 'remote')), session: nullable(str), raw: nullable(b64), failure_class: nullable(str), answers: nullable(list(obj({ id: str, value: json }))), usage: nullable(obj({ input_tokens: int, output_tokens: int })) },
  // 'measurement' replaces 'evaluation': no more gates/route/would_route/owner_call/option_call.
  // Carries the five composite-Score levels with their confidences, the composite itself, which
  // veto if any, the advisory `suggested`, an `outcome` naming which branch decided, and a
  // human-readable `reason`.
  'measurement': { intent: ref, call: nullable(ref), draft_digest: digest, source: oneOf('jev', 'review'), model: nullable(str), levels: list(obj({ dimension: DIMENSION, level: json, confidence: unit })), composite: nullable(unit), veto: nullable(oneOf('reach', 'contract', 'surface')), suggested: nullable(oneOf('agent', 'developer')), outcome: oneOf('floor', 'unavailable', 'veto', 'composite', 'indeterminate'), reason: str },
  'calibration': { policy_digest: digest, log_head: ref, predicted_agent: int, false_downgrades: int, bound: unit, criterion: str, result: oneOf('pass', 'fail') },
  // Issue #71 (spec revision 21): a backlog item may name the carried decision it takes over. An
  // item without one keeps the first shape, so earlier logs and Sudus versions still read it.
  'item': [
    { kind: oneOf('backlog', 'next-feature', 'defect'), slug: token, source: str, body: str },
    { kind: oneOf('backlog'), slug: token, source: str, body: str, decision: ulid },
  ],
  'outside': { item: ref, reason: str, evaluation: nullable(ref) },
  // Issue #34 (spec revision 17): the developer's words, said in conversation, retire one or more
  // backlog or next-feature items.
  'retirement': { items: list(ref), evidence },
  // Fix round 1 finding 8: `intent`/`results` added, the same reason as 'start' above -- promote
  // is one of the four MULTI_STORE commands, so its terminal record goes through the same
  // withTransaction `finish` step.
  'promotion': { item: ref, decision: ulid, intent: nullable(ref), results: list(storeIdentity) },
  'fix': { item: ref, snapshot: ws },
  'scope-breach': { path: str, snapshot: ws, base: ws, declarations_digest: digest },
  'scope': { breach: ref, disposition: oneOf('keep', 'restore'), snapshot: ws, escalation: nullable(ref), answer: nullable(ref) },
  'done': { slug: token, snapshot: ws },
  // Fix round 1 finding 8: `intent`/`results` added, the same reason as 'start' above -- supersede
  // is one of the four MULTI_STORE commands.
  'superseded': { slug: token, start: ref, decision: ulid, transition: ulid, successor: token, carried: list(ref), intent: nullable(ref), results: list(storeIdentity) },
};
export const KINDS = new Set(Object.keys(SCHEMAS));
// A kind's payload descriptor: one shape, or (a list in SCHEMAS) any of several.
export function payloadShape(kind) {
  const s = SCHEMAS[kind];
  return Array.isArray(s) ? { t: 'alt', shapes: s.map((x) => obj(x)) } : obj(s);
}

// Fix round 1 item 2 (Important, review-1.md finding 2): the ref-typed (another log record) and
// snapshot-typed (ws/input, a durable snapshot commit) fields of a kind's payload, derived
// straight from SCHEMAS so a caller like lib/travel.mjs's validateAfterFetch never has to
// hand-maintain a field-name list that can silently drift as a kind gains or loses fields.
// Unwraps `nullable` and `list` wrappers of any depth; a `list(ref)` field (e.g.
// superseded.carried) is reported with list: true so the caller iterates its array value instead
// of treating it as a scalar. Only top-level payload fields are walked -- a ref or snapshot sha
// nested inside an `obj` or `variant` field (command-intent's pre.refs, for instance) is a
// transaction bookkeeping detail, not a record's own reference to another record.
export function refFieldsOf(kind) {
  // A field any shape of the kind declares; one a record lacks is simply absent from it.
  const shape = Array.isArray(SCHEMAS[kind]) ? Object.assign({}, ...SCHEMAS[kind]) : SCHEMAS[kind];
  const snapshotFields = [], recordFields = [];
  if (!shape) return { snapshotFields, recordFields };
  for (const [name, desc] of Object.entries(shape)) {
    let d = desc, list = false;
    while (d.t === 'nullable' || d.t === 'list') { if (d.t === 'list') list = true; d = d.of; }
    if (d.t === 'ws' || d.t === 'input') snapshotFields.push({ name, list });
    else if (d.t === 'ref') recordFields.push({ name, list });
  }
  return { snapshotFields, recordFields };
}

export function encodeRecord(kind, target, payload, layout = SUDUS) {
  if (!KINDS.has(kind)) throw new RecordError(`unknown record kind ${kind}`);
  if (typeof target !== 'string' || !TARGET_RE.test(target)) throw new RecordError(`invalid target token ${JSON.stringify(target)}`);
  const reasons = []; check(payloadShape(kind), payload, kind, reasons);
  if (reasons.length) throw new RecordError(`invalid ${kind} record`, reasons);
  const body = canonicalize(payload);
  return { subject: `${layout.name}: ${kind} ${target}`, body, trailers: [[layout.schemaTrailer, SCHEMA], [layout.digestTrailer, sha256(body)]] };
}
// The integrity envelope every kernel-written commit shares: exactly the two trailers, a
// readable schema version, a body digest that matches Sudus-Digest, and canonical JSON.
// decodeRecord and lib/snapshots.mjs's readSnapshot both call this so the rule is checked once.
export function verifyEnvelope(commit) {
  const tr = commit.trailers;
  const env = tr.length === 2 ? envelopeOf(tr) : null;
  if (!env) throw new RecordError(`expected exactly the two trailers ${SUDUS.schemaTrailer} and ${SUDUS.digestTrailer}`);
  if (tr[0][1] !== SCHEMA) throw new RecordError(`unreadable schema ${tr[0][1]}`);
  const bytes = commit.bodyBytes ?? Buffer.from(commit.body, 'utf8');
  if (tr[1][1] !== sha256(bytes)) throw new RecordError(`body digest does not match ${env.digestTrailer}`);
  try { return parseStrict(bytes); } catch (e) { throw new RecordError(`body: ${e.message}`); }
}
export function decodeRecord(commit) {
  const m = /^(?:sudus|cairn): (\S+) (\S+)$/.exec(commit.subject);
  if (!m) throw new RecordError(`not a record subject: ${commit.subject}`);
  const [, kind, target] = m;
  if (!KINDS.has(kind)) throw new RecordError(`unknown record kind ${kind}`);
  if (!TARGET_RE.test(target)) throw new RecordError(`invalid target token ${target}`);
  const payload = verifyEnvelope(commit);
  const reasons = []; check(payloadShape(kind), payload, kind, reasons);
  if (reasons.length) throw new RecordError(`invalid ${kind} record`, reasons);
  return { kind, target, payload };
}

export const LOG_REF = 'refs/sudus/log';

// `ref` names another chain to append to: a clone's inbox (issue #35) is a chain of item records
// in the same envelope as the log.
export async function appendRecord(cwd, kind, target, payload, ref = layoutOf(cwd).log) {
  const L = layoutOf(cwd);
  const { subject, body, trailers } = encodeRecord(kind, target, payload, L);
  const head = await readRef(cwd, ref);
  const sha = await commitTree(cwd, { tree: await emptyTree(cwd), parents: head ? [head] : [], subject, body, trailers });
  await updateRefCAS(cwd, ref, sha, head);
  return sha;
}
// The log is append-only and its head names its whole content, so one process reads a given
// head once: every later readLog for the same cwd and head returns the same decoded records
// (a fresh array each time, so a caller's own splice or sort cannot leak into the next read).
// A record appended by this or any other process moves the head, which misses the cache.
const logCache = new Map();
// `ref` names another log to read (migrate reads the former layout's log before moving it).
export async function readLog(cwd, ref = layoutOf(cwd).log) {
  const head = await readRef(cwd, ref);
  if (!head) return [];
  const key = `${cwd}\0${head}`;
  const hit = logCache.get(key);
  if (hit) return hit.map((r) => ({ ...r }));
  const shas = (await git(['rev-list', '--first-parent', '--reverse', head], { cwd })).stdout.trim().split('\n');
  const commits = await catCommits(cwd, shas);
  const out = shas.map((sha, i) => {
    const c = commits[i];
    const { kind, target, payload } = decodeRecord(c);
    return { sha, kind, target, payload, parent: c.parents[0] ?? null };
  });
  logCache.clear(); logCache.set(key, out);
  return out.map((r) => ({ ...r }));
}
// The contract a fix is judged against: the start snapshot of the commitment open when the fix
// was recorded, or null between commitments, where no contract is frozen: the spec phase edits
// Agreed text and the roadmap there before the next start authorizes them, and (2.2.2) no scope
// breach is observed in that gap either. `upto` is the fix record's index; omitted, it is the base
// for a fix recorded now. Issue #4: judging every fix against the newest start let a later
// commitment's own spec edits revoke an earlier fix; the second adversarial review found the
// done-snapshot variant of the rule still stranded a defect carried across a supersede.
export function fixBase(log, upto = log.length) {
  let base = null;
  for (const r of log.slice(0, upto)) {
    if (r.kind === 'start') base = r.payload.snapshot;
    else if (r.kind === 'done' || r.kind === 'superseded') base = null;
  }
  return base;
}
// Issue #57: fixBase at every fix record in one pass, fix sha -> fixBase(log, <its index>), for
// wake's fix predicate, which judged each defect's fix with its own scan of the log.
export function fixBases(log) {
  const out = new Map();
  let base = null;
  for (const r of log) {
    const kind = r.kind;
    if (kind === 'fix') { if (!out.has(r.sha)) out.set(r.sha, base); }
    else if (kind === 'start') base = r.payload.snapshot;
    else if (kind === 'done' || kind === 'superseded') base = null;
  }
  return out;
}
export function range(log) {
  let i = log.length - 1;
  while (i >= 0 && log[i].kind !== 'start') i--;
  const start = i >= 0 ? log[i] : null, records = log.slice(i + 1);
  // closer: the done or superseded record that closed the range, which a lease taken after it names.
  const closer = start === null ? null : records.find((r) => (r.kind === 'done' || r.kind === 'superseded') && r.payload.slug === start.payload.slug) ?? null;
  return { start, records, closed: closer !== null, closer };
}
// The start a commitment's work is measured from (issue #8): a start after a supersede carries
// the superseded commitment's work, all of it committed before the successor started, so the
// chain is followed back through each superseded record to the first start it carries.
export function chainStart(log, start) {
  const bySha = new Map(log.map((r) => [r.sha, r]));
  let s = start;
  while (s?.payload.from_superseded) {
    const prev = bySha.get(bySha.get(s.payload.from_superseded)?.payload.start);
    if (prev?.kind !== 'start') break;
    s = prev;
  }
  return s;
}
// What the supersession that opened this commitment carried in (issue #32): a start after a
// supersede names it in from_superseded. That supersession's list already holds what an earlier
// one carried and was still unsettled, so no other supersession is read; reading every one in the
// log put findings carried into another, finished commitment into this one's ledger.
export function carriedInto(log, start) {
  const sup = start?.payload.from_superseded ? log.find((x) => x.sha === start.payload.from_superseded && x.kind === 'superseded') : null;
  return new Set(sup ? sup.payload.carried : []);
}
