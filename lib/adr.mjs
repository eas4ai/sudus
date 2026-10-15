// lib/adr.mjs
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { canonicalize, parseStrict, sha256, ulid } from './canon.mjs';
import { readLog } from './records.mjs';
import { readSnapshot, writeWorkspaceSnapshot } from './snapshots.mjs';
import { classify, PathError } from './paths.mjs';
import { loadSettings } from './settings.mjs';
import { recordManagedWrite } from './scope.mjs';
// Fix round 2 finding 1: appendDecision's own single append now takes the same repository-local
// transaction lock withTransaction (lib/tx.mjs) itself takes for a multi-store command's writes,
// so a decide()/realize()/answer()/read() append can never interleave with another one of its own
// kind, or with a start/supersede/promote transaction's own {store:'append'} write to the same
// file. lib/tx.mjs imports withTransaction's own recordManagedWrite from lib/scope.mjs, which in
// turn imports readAdr from this file, completing a cycle; see lib/tx.mjs's own comment on its
// import of lib/scope.mjs for why this is safe under Node's ESM loader (acquireLock, like
// recordManagedWrite, is only ever called from inside a function body, never at module top level).
import { acquireLock } from './tx.mjs';
import { guardKernelWrite } from './cycle.mjs';

export const ADR_PATH = 'docs/decisions.jsonl';
export class AdrError extends Error { constructor(m) { super(m); this.name = 'AdrError'; } }
export const CAUSES = ['the stated condition occurred', 'an unforeseen condition occurred', 'it was wrong when it was made', 'the premise was false'];
export const ASSIGNED = {
  decision: ['decide', 'escalate', 'supersede', 'promote'], realized: ['realize'], superseded: ['decide'],
  answered: ['answer'], read: ['decisions --read'],
};
const KEYS = {
  decision: ['kind', 'id', 'ts', 'level', 'by', 'title', 'rests_on', 'wrong_if', 'body', 'base_snap', 'evaluation', 'interfaces'],
  realized: ['kind', 'id', 'ts', 'of', 'base_snap', 'snap', 'subject', 'interfaces'],
  superseded: ['kind', 'id', 'ts', 'of', 'by', 'cause'],
  answered: ['kind', 'id', 'ts', 'escalation', 'answer'],
  read: ['kind', 'id', 'ts', 'of', 'record'],
};
// Lines that record an act on an existing record: the developer's answer to an escalation, their
// read of a decision, and a decision's realization. None is work for the adversary to examine,
// and each is written after an acceptance in the ordinary course (build follows accept), so a
// workspace that differs from an accepted snapshot only by these lines is still at it.
export const BOOKKEEPING_KINDS = new Set(['answered', 'read', 'realized']);
export function withoutBookkeeping(text) {
  return text.split('\n').filter((raw) => {
    try { return !BOOKKEEPING_KINDS.has(parseStrict(raw).kind); } catch { return true; }
  }).join('\n');
}
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA = /^[0-9a-f]{40}$/;
const breach = (n, m) => { throw new AdrError(`breach: line ${n} ${m}`); };
const isStr = (v) => typeof v === 'string';
const strList = (v) => Array.isArray(v) && v.every(isStr);

// Fix round 1 finding 11 (Important, quality): validateLine's `sha`/`ws` checks used to run
// unconditionally, and readAdr called them for every line on every call -- one git readSnapshot
// per decision/realized line, every time anything read the ADR, so a plain append (which reads
// the whole file first to know its existing ids and line count) cost O(existing lines) git calls
// just to add one. `verify` now gates only the two checks that need an external read (a real
// readLog for `sha`, a real readSnapshot for `ws`); the structural checks above (canonical JSON,
// closed schema, id format and uniqueness, ts format, and the cross-ADR-line `ref` checks, which
// only ever look at the `ids` map already being built as this file's own lines are read) always
// run, verify or not. A `sha`/`ws` field's own FORMAT is still checked either way, only the
// "does this actually exist" half is deferred.
async function validateLine(cwd, obj, n, ids, logShas, verify) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) breach(n, 'is not an object');
  const keys = KEYS[obj.kind];
  if (!keys) breach(n, `has unknown kind ${JSON.stringify(obj.kind)}`);
  for (const k of Object.keys(obj)) if (!keys.includes(k)) breach(n, `has unknown key ${k}`);
  for (const k of keys) if (!Object.hasOwn(obj, k)) breach(n, `lacks ${k}`);
  if (!isStr(obj.id) || !ULID.test(obj.id)) breach(n, 'has a malformed id');
  if (ids.has(obj.id)) breach(n, `is a duplicate id ${obj.id}`);
  if (!isStr(obj.ts) || Number.isNaN(Date.parse(obj.ts))) breach(n, 'has a malformed ts');
  const ref = (id, field, kind) => {
    const t = ids.get(id);
    if (!t) breach(n, `${field} names missing ${id}`);
    if (kind && t.kind !== kind) breach(n, `${field} names a ${t.kind}, not a ${kind}`);
    return t;
  };
  const sha = (s, field) => {
    if (!isStr(s) || !SHA.test(s)) breach(n, `${field} names a missing record`);
    if (verify && !logShas.has(s)) breach(n, `${field} names a missing record`);
  };
  const ws = async (s, field) => {
    if (!isStr(s) || !SHA.test(s)) breach(n, `${field} is not a workspace snapshot`);
    if (!verify) return;
    try { await readSnapshot(cwd, s, 'workspace'); } catch { breach(n, `${field} is not a workspace snapshot`); }
  };
  switch (obj.kind) {
    case 'decision':
      if (obj.level !== 'Consequential') breach(n, 'has a level other than Consequential');
      if (!['agent', 'developer', 'joint'].includes(obj.by)) breach(n, 'has an unknown by');
      if (!isStr(obj.title) || !isStr(obj.wrong_if) || !isStr(obj.body) || !strList(obj.rests_on) || !strList(obj.interfaces)) breach(n, 'has a wrongly typed field');
      await ws(obj.base_snap, 'base_snap');
      if (obj.evaluation !== null) sha(obj.evaluation, 'evaluation');
      break;
    case 'realized': {
      const d = ref(obj.of, 'of', 'decision');
      if (obj.base_snap !== d.base_snap) breach(n, 'base_snap differs from the decision base');
      if (!isStr(obj.subject) || !strList(obj.interfaces)) breach(n, 'has a wrongly typed field');
      await ws(obj.snap, 'snap');
      break;
    }
    case 'superseded':
      ref(obj.of, 'of', 'decision'); ref(obj.by, 'by', 'decision');
      if (!CAUSES.includes(obj.cause)) breach(n, 'names an unknown cause');
      break;
    case 'answered': sha(obj.escalation, 'escalation'); sha(obj.answer, 'answer'); break;
    case 'read': ref(obj.of, 'of', 'decision'); sha(obj.record, 'record'); break;
  }
}

async function readRaw(cwd) {
  try { return await readFile(join(cwd, ADR_PATH), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
}

// `verify: true` is the on-demand, full check for a lint-style caller: every line's sha/snapshot
// references are actually read back and confirmed to exist, at the cost of one readLog and one
// readSnapshot per snapshot-bearing line. The default (`verify: false`) does none of that -- pure
// structural validation, no git calls beyond reading docs/decisions.jsonl itself.
export async function readAdr(cwd, { verify = false } = {}) {
  const text = await readRaw(cwd);
  if (text !== '' && !text.endsWith('\n')) throw new AdrError('breach: the last line is not newline-terminated');
  const lines = text === '' ? [] : text.slice(0, -1).split('\n');
  const logShas = verify ? new Set((await readLog(cwd)).map((r) => r.sha)) : null;
  const ids = new Map();
  const out = [];
  for (const [i, raw] of lines.entries()) {
    let obj;
    try { obj = parseStrict(raw); } catch { breach(i + 1, 'is not canonical JSON'); }
    if (canonicalize(obj) !== raw) breach(i + 1, 'is not canonical JSON');
    await validateLine(cwd, obj, i + 1, ids, logShas, verify);
    ids.set(obj.id, obj);
    out.push(obj);
  }
  return out;
}

// appendDecision/decisionFileBytes read the log exactly once: readAdr(cwd) here (default,
// non-verify) never touches it, and the one readLog below is used only to fully verify (sha/ws,
// verify: true) the single new line being written -- the only line whose references actually need
// confirming right now, not the whole file's history all over again.
async function prepareLine(cwd, line, { command }) {
  const writers = ASSIGNED[line.kind];
  if (!writers) throw new AdrError(`unknown ADR kind ${JSON.stringify(line.kind)}`);
  if (!writers.includes(command)) {
    const list = writers.length > 1 ? writers.slice(0, -1).join(', ') + ' or ' + writers.at(-1) : writers[0];
    throw new AdrError(`${line.kind} lines are written only by ${list}, not ${command}`);
  }
  const existing = await readAdr(cwd);
  const obj = { ...line, id: line.id ?? ulid(), ts: line.ts ?? new Date().toISOString() };
  const ids = new Map(existing.map((l) => [l.id, l]));
  const logShas = new Set((await readLog(cwd)).map((r) => r.sha));
  await validateLine(cwd, obj, existing.length + 1, ids, logShas, true);
  return obj;
}

// Fix round 1 finding 2 (Important): lib/commitment.mjs's start/supersede/promote used to write
// the ADR decision line directly (via appendDecision, straight to disk) *before* entering
// withTransaction -- outside its staged bytes and pre-identities entirely. A crash, or any
// refusal, after that write but before the transaction completed left an orphan queued decision
// with no corresponding start/superseded/promotion record, and every retry of the same command
// queued another one.
//
// Fix round 2 finding 1 (Important): this used to compute the ADR file's new *whole-file* bytes
// (the existing content it read here, plus the new line), for the caller to stage as a {store:
// 'file'} write -- but that read happens outside withTransaction's lock, and preIdentities
// (lib/tx.mjs) captures the "pre" digest only once the lock is finally taken, later. A line another
// command appends in that window becomes the recorded pre digest, and the staged whole-file bytes
// then silently overwrite it with no conflict detected (the write's own digest check compares
// against that same, already-stale pre). Renamed to decisionAppendBytes and narrowed to return
// only the new line's own bytes -- no read of the file's existing content at all -- so the caller
// stages it as a {store: 'append'} write (lib/tx.mjs) instead: applied under the transaction's
// lock, added to whatever the file actually holds when the write runs, never a whole-file
// overwrite built from a stale read.
export async function decisionAppendBytes(cwd, line, { command }) {
  const obj = await prepareLine(cwd, line, { command });
  return { id: obj.id, bytes: canonicalize(obj) + '\n' };
}

// Fix round 2 finding 1: this single append had no lock at all -- decide()/realize()/answer()/
// read() could interleave their own reads-then-appends with each other, or with a start/supersede/
// promote transaction's own {store:'append'} write to the same file, with nothing serializing
// them. Wrapped in the same repository-local transaction lock lib/tx.mjs's withTransaction itself
// takes, so this single-store append and any multi-store transaction's own append never race.
//
// Plan 08 task 24: guardKernelWrite runs before the append lands, checked as action 'decide' (the
// plan's own single insertion text for this module, unconditional on the actual writing command)
// so the liveness invariant refuses an append whose own bytes would create a scope or repair
// violation instead of writing it.
export async function appendDecision(cwd, line, { command }) {
  const release = await acquireLock(cwd, ulid());
  try {
    const obj = await prepareLine(cwd, line, { command });
    const existing = await readFile(join(cwd, ADR_PATH)).catch((e) => { if (e.code === 'ENOENT') return Buffer.alloc(0); throw e; });
    const appended = canonicalize(obj) + '\n';
    await guardKernelWrite(cwd, ADR_PATH, Buffer.concat([existing, Buffer.from(appended)]), { action: 'decide' });
    await mkdir(dirname(join(cwd, ADR_PATH)), { recursive: true });
    await appendFile(join(cwd, ADR_PATH), appended);
    await recordManagedWrite(cwd, ADR_PATH, await readFile(join(cwd, ADR_PATH)));   // fix round 1 item 2
    return obj.id;
  } finally { release(); }
}

export async function queue(cwd) {
  const lines = await readAdr(cwd);
  const read = new Set(lines.filter((l) => l.kind === 'read').map((l) => l.of));
  return lines.filter((l) => l.kind === 'decision' && !read.has(l.id)).map((l) => l.id);
}

export async function adrDigest(cwd) { return sha256(await readRaw(cwd)); }

// Fix round 1 finding 12 (Minor): classify() calls validatePath internally and throws the raw
// PathError from lib/paths.mjs on a malformed named_paths entry (a NUL byte, a backslash, an
// absolute path, ...) -- every other refusal from this module is an AdrError, and a caller
// catching AdrError specifically (as lib/commitment.mjs's supersede/promote/realize and this
// file's own appendDecision callers do) would let a malformed path slip past as an unwrapped
// exception of a different class.
// Fix (Minor, final-review.md, replacing a stale fix-round-3 comment naming the deleted
// escalateWithRoute/route mode): reads settings through plain loadSettings (lib/settings.mjs) --
// no calibration option, no route-mode gate; route mode is gone. decide() is not the only way a
// Consequential decision completes: it is called directly for the spec-phase deference shape
// (--title/--rests-on/--wrong-if/--body), and by decideConsequential (lib/escalate.mjs) for a
// measured work-loop draft once sudus measure has produced a current `outcome: composite`
// measurement -- decideConsequential refuses otherwise, routing the caller to
// escalateConsequential (sudus escalate --consequential) instead.
export async function decide(cwd, { title, rests_on, wrong_if, body, by = 'agent', evaluation = null, named_paths = [] }, command = 'decide') {
  const { settings } = await loadSettings(cwd);
  let interfaces;
  try { interfaces = named_paths.filter((p) => classify(p, settings) === 'interface').sort(); }
  catch (e) { if (e instanceof PathError) throw new AdrError(e.message); throw e; }
  const base_snap = await writeWorkspaceSnapshot(cwd);
  return appendDecision(cwd, { kind: 'decision', level: 'Consequential', by, title, rests_on, wrong_if, body, base_snap, evaluation, interfaces }, { command });
}

// Issue #71 (spec revision 21): the Consequential decisions with no realized or superseded line
// that no backlog item has taken over, each with whether a supersession carried it and whether the
// commitment whose frozen set is `set` must build it. A decision is carried when its line precedes
// the latest supersession's own decision line. A carried decision holds only a commitment whose set
// names a requirement it rests on; the others move to the backlog. A supersession whose decision
// line is missing carries nothing.
export function unbuiltDecisions(adr, log, set) {
  const closed = new Set(adr.filter((l) => l.kind === 'realized' || l.kind === 'superseded').map((l) => l.of));
  const at = new Map(adr.map((l, i) => [l.id, i]));
  // An item takes a decision over only where sudus item --decision could write it: the decision was
  // carried and the commitment open at the item rests on none of its requirements. The first such
  // item does; another item naming a decision closes nothing (review of 57c1366c).
  let cut = -1, open = null;
  for (const r of log) {
    if (r.kind === 'start') open = new Set(r.payload.requirements.map((x) => x.requirement));
    else if (r.kind === 'done') open = null;
    else if (r.kind === 'superseded') { open = null; cut = at.get(r.payload.decision) ?? -1; }
    else if (r.kind === 'item' && r.payload.decision !== undefined && open !== null && !closed.has(r.payload.decision)) {
      const l = adr[at.get(r.payload.decision) ?? -1];
      if (l?.kind === 'decision' && l.level === 'Consequential' && at.get(l.id) < cut && !l.rests_on.some((x) => open.has(x))) closed.add(l.id);
    }
  }
  const inSet = new Set(set.map((x) => x.requirement));
  const out = [];
  adr.forEach((l, i) => {
    if (l.kind !== 'decision' || l.level !== 'Consequential' || closed.has(l.id)) return;
    const carried = i < cut;
    out.push({ line: l, carried, held: !carried || l.rests_on.some((x) => inSet.has(x)) });
  });
  return out;
}
// The superseded record that closed the commitment a carried decision was recorded under: the
// first supersession whose own decision line follows the decision's line.
export function recordedUnder(adr, log, id) {
  const at = new Map(adr.map((l, i) => [l.id, i]));
  const mine = at.get(id) ?? -1;
  return log.find((r) => r.kind === 'superseded' && (at.get(r.payload.decision) ?? -1) > mine) ?? null;
}

export async function supersedeDecision(cwd, of, by, cause) {
  return appendDecision(cwd, { kind: 'superseded', of, by, cause }, { command: 'decide' });
}
