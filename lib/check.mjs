// lib/check.mjs
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { readMechanisms, MechanismError } from './mechanisms.mjs';

export class CheckError extends Error {}

export async function selectMechanism(cwd, REQ) {
  const all = await readMechanisms(cwd);
  // Deviation from the plan text: readMechanisms (Task 1) orders its object by sorting the
  // .json filenames, which is not the same order as sorting the plain mechanism names ('-' sorts
  // before '.', so 'greeter-two.json' < 'greeter.json' but 'greeter' < 'greeter-two'). Sort the
  // selected names themselves so a multi-mechanism refusal always lists them alphabetically.
  const names = Object.keys(all).filter((n) => all[n].definition.requirements.includes(REQ)).sort();
  if (names.length === 0) throw new CheckError(`no mechanism declares ${REQ}`);
  if (names.length > 1) throw new CheckError(`${names.length === 2 ? 'two' : names.length} mechanisms declare ${REQ}: ${names.join(', ')}`);
  return { name: names[0], entry: all[names[0]] };
}

// Fix round 1 finding 5 (Important): the command's combined stdout/stderr used to accumulate in
// an ever-growing `chunks` array with no bound, so a command that prints without limit could
// exhaust memory before the receipt was even written. `push` below caps what is ever held (and
// later written to `.sudus/output/` by writeOutput) at OUTPUT_CAP bytes, appending one marker line
// -- itself the "recorded truncation flag" -- the first time a chunk would cross the cap; every
// following chunk is dropped without allocating anything for it. The child's stdout/stderr streams
// stay subscribed either way, so a truncated run still drains them instead of stalling the child
// on a full pipe.
export const OUTPUT_CAP = 8 * 1024 * 1024;
// Issue #45: result lines are read from the whole output as it streams, not from the capped copy
// kept for diagnosis, so a fail printed after the cap still overrides an earlier pass. Each stream
// has its own line scanner (UTF-8 decoded across chunk boundaries); a line longer than
// LINE_MEMORY is dropped, since no result line is that long, which keeps the scanner bounded.
const LINE_MEMORY = 64 * 1024;
function lineScanner(seen, wanted) {
  const decoder = new StringDecoder('utf8');
  let partial = '', overlong = false;
  const take = (line) => {
    const m = LINE.exec(line.endsWith('\r') ? line.slice(0, -1) : line);
    if (!m || !wanted.has(m[1])) return;
    const r = seen.get(m[1]) ?? { pass: false, fail: false };
    r[m[2]] = true;
    seen.set(m[1], r);
  };
  const feed = (text) => {
    const lines = (partial + text).split('\n');
    partial = lines.pop();
    for (const line of lines) { if (!overlong) take(line); overlong = false; }
    if (partial.length > LINE_MEMORY) { partial = ''; overlong = true; }
  };
  return { write: (c) => feed(decoder.write(c)), end: () => { feed(decoder.end()); if (!overlong) take(partial); } };
}
// `results`: the requirement ids whose result lines to record (review of 4.2.7: recording every id
// seen let a command grow memory past the cap with lines for undeclared ids). Identity probes pass
// none and record none. `args` are the shell's positional parameters, $1 and on.
export function runCommand(cwd, command, { cap = OUTPUT_CAP, results = [], args = [] } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    const seen = new Map();
    let written = 0, truncated = false;
    const push = (c) => {
      if (truncated) return;
      const room = cap - written;
      if (c.length <= room) { chunks.push(c); written += c.length; return; }
      if (room > 0) chunks.push(c.subarray(0, room));
      chunks.push(Buffer.from(`sudus: output truncated at ${cap} bytes\n`));
      truncated = true;
    };
    let child;
    try {
      child = spawn('sh', ['-c', command, ...(args.length ? ['sh', ...args] : [])], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ spawned: false, out: Buffer.alloc(0), code: null, signal: null, truncated: false, seen }); }
    const wanted = new Set(results);
    const scanOut = lineScanner(seen, wanted), scanErr = lineScanner(seen, wanted);
    child.stdout.on('data', (c) => { scanOut.write(c); push(c); });
    child.stderr.on('data', (c) => { scanErr.write(c); push(c); });
    child.on('error', () => resolve({ spawned: false, out: Buffer.concat(chunks), code: null, signal: null, truncated, seen }));
    child.on('close', (code, signal) => { scanOut.end(); scanErr.end(); resolve({ spawned: true, out: Buffer.concat(chunks), code, signal, truncated, seen }); });
  });
}

// Issue #46: spec item 37 says execution identity holds only non-secret values. The name screening
// in lib/mechanisms.mjs passes a connection URL such as DATABASE_URL, whose value can carry a
// password, and the receipt is a commit that travels to the authority remote. The password in a
// URL's userinfo, and the value of a password- or token-named query parameter, are replaced before
// the identity is recorded or compared; both sides of a currency check are redacted alike.
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/?#@]*:)[^\s/?#@]+@/gi;
const SECRET_PARAM = /([?&;](?:password|passwd|pwd|pass|secret|token|access_token|api_key|apikey|key)=)[^&;#\s]+/gi;
export const redactIdentityValue = (v) => (typeof v === 'string' ? v.replace(URL_PASSWORD, '$1[redacted]@').replace(SECRET_PARAM, '$1[redacted]') : v);

// Issue #70: Node gives a child's stdout and stderr as a socket pair. Under the Codex sandbox, a
// Node program writing to that socket through process.stdout loses the output and still exits 0,
// so `npm --version` read as "" in wake (read-only, run inside the sandbox) and as "11.3.0" in
// check (which writes .git, so Codex runs it outside), and no receipt was ever current. A probe
// writes into a pipe instead; cat copies it out. The probe's exit status is kept, so a tool that
// fails still reads as null. Mechanism commands run as before: their receipts record a signal.
const PIPED = 'exec 3>&1; s=$( { { sh -c "$1" 2>&1 3>&- 4>&-; echo "$?" >&4; } | cat >&3; } 4>&1 ); exit "$s"';
export async function observeIdentity(cwd, identity) {
  const tools = {};
  for (const name of Object.keys(identity.tools).sort()) {
    const r = await runCommand(cwd, PIPED, { args: [identity.tools[name]] });
    tools[name] = r.spawned && r.code === 0 ? redactIdentityValue(r.out.toString('utf8').trim()) : null;
  }
  const env = {};
  for (const name of identity.env) env[name] = Object.hasOwn(process.env, name) ? redactIdentityValue(process.env[name]) : null;
  return { tools, env, image: identity.image };
}

export { MechanismError };

import { access, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalize, sha256 } from './canon.mjs';
import { requirementDigest } from './mechanisms.mjs';
import { withCheckLock } from './lease.mjs';
import { writeInputSnapshot, readSnapshot } from './snapshots.mjs';
import { listTree } from './gitx.mjs';
import { layoutOf, LAYOUTS } from './layout.mjs';
import { appendRecord, readLog, range } from './records.mjs';

export const OUTPUT_DIR = '.sudus/output';
// A mechanism written under the former name still prints `cairn: REQ: pass`; both prefixes count.
const LINE = /^(?:sudus|cairn): ([A-Z][A-Z0-9]*-[0-9]{3,}): (pass|fail)$/;

export async function productDigest(cwd, tree, documents) {
  const under = (p) => documents.some((d) => p === d || p.startsWith(d + '/'));
  const entries = (await listTree(cwd, tree)).filter((e) => !under(e.path)).map((e) => [e.path, e.mode, e.sha]);
  return sha256(canonicalize(entries));
}

export const outputPath = (cwd, digest) => join(cwd, layoutOf(cwd).output, digest.slice('sha256:'.length));

async function writeOutput(cwd, bytes) {
  const digest = sha256(bytes);
  const outputDir = join(cwd, layoutOf(cwd).output);
  await mkdir(outputDir, { recursive: true });
  // Fix round 1 finding 11 (Minor): write .gitignore only when it is not already there, instead
  // of on every check, so a developer's own edits to it (or its mtime) are not silently clobbered
  // by the next check.
  const gitignore = join(outputDir, '.gitignore');
  try { await access(gitignore); } catch { await writeFile(gitignore, '*\n'); }
  const tmp = join(outputDir, `.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tmp, bytes);
  await rename(tmp, outputPath(cwd, digest));
  return digest;
}

export async function outputPresent(cwd, receipt) {
  try { await access(outputPath(cwd, receipt.payload.output)); return true; } catch { return false; }
}

// Fix round 1 finding 10 (Minor): a line is matched after stripping one trailing CR, so a command
// that ends its lines \r\n (e.g. run through a Windows-style tool, or plain `printf '...\r\n'`)
// still matches instead of silently landing on 'unverified' because the CR sat between "pass"/"fail"
// and the regex's end-of-line anchor.
function resultFor(def, run, id) {
  if (!run.spawned) return 'unverified';
  if (def.results === 'per-requirement') {
    const mine = run.seen.get(id);
    if (!mine) return 'unverified';
    return mine.fail ? 'fail' : 'pass';
  }
  return run.code === 0 ? 'pass' : 'fail';
}

// "After three distinct failing attempts without a pass, a fourth implementation attempt requires
// an escalation first" (spec, Deferral and attempts). Wake's run predicate names `escalate` from
// this; check refuses from it too, since the receipt is what an attempt leaves and it used to be
// written without limit while wake already said escalate.
export function attemptState(log, REQ) {
  const r = range(log);
  if (!r.start || r.closed) return { tried: 0, escalated: false, needed: false };
  const set = r.start.payload.requirements.map((x) => x.requirement);
  const k = set.indexOf(REQ);
  // Review of revision 15: a requirement outside the frozen set (a defect against an earlier
  // commitment's requirement) is not named by wake while this commitment is open, so it has no
  // turn under it and no attempts; its fails in a shared mechanism's refresh runs used to count.
  if (k < 0) return { tried: 0, escalated: false, needed: false };
  const { count: tried, third } = attemptWalk(log, REQ, { since: r.start.sha, siblings: set, before: set.slice(0, k) });
  // Review of 3.8.2: any escalation naming REQ after its last pass counted, even one answered
  // before the failures began, about something else, or under a closed commitment. The escalation
  // the fourth attempt needs comes after the third.
  const escalated = third >= 0 && log.slice(third + 1).some((x) => x.kind === 'escalation' && x.payload.concerns.split(' ').includes(REQ));
  return { tried, escalated, needed: tried >= 3 && !escalated };
}

// Issue #44: check snapshots the inputs, then runs the command in the live workspace, and nothing
// tied what the command read to the snapshot. An edit made while it ran was tested, the snapshot
// held the bytes before it, and once the edit was reverted the pass stood current for bytes the
// command never saw. After the run, still under the check lock, the declared inputs, the
// requirement texts and the mechanism definition are read again; if any differs from what the run
// started with, every result of the run is unverified and this line says why. An edit made and
// reverted within the run is not seen here; running on a fixed copy of the inputs would close
// that, and is a larger change than this check.
export const CHANGED_DURING_RUN = 'sudus: the declared inputs, a requirement text or the mechanism definition changed while the command ran; every result of this run is unverified';
async function changedDuringRun(cwd, { name, entry, tree, texts }) {
  try {
    const now = (await readMechanisms(cwd))[name];
    if (!now || now.definitionDigest !== entry.definitionDigest) return true;
    const paths = await resolveInputPaths(cwd, entry.definition.inputs);
    if (await treeIdentityReadOnly(cwd, { paths, exclude: ALWAYS_EXCLUDED }) !== tree) return true;
    for (const { id, textDigest } of texts) if ((await requirementDigest(cwd, id)).textDigest !== textDigest) return true;
    return false;
  } catch (e) { if (expected(e)) return true; throw e; }
}

export async function check(cwd, REQ) {
  const target = await requirementDigest(cwd, REQ);
  if (!target.agreed) throw new CheckError(`${REQ} is not Agreed; only Agreed requirements are checked`);
  const before = attemptState(await readLog(cwd), REQ);
  if (before.needed) throw new CheckError(`${before.tried} distinct failing attempts at ${REQ} without a pass; a fourth attempt needs an escalation first: sudus escalate --commitment <slug> --concern ${REQ} ...`);
  const { name, entry } = await selectMechanism(cwd, REQ);
  const def = entry.definition;
  return withCheckLock(cwd, async () => {
    const input = await writeInputSnapshot(cwd, { mechanism: name, inputs: def.inputs });
    const { tree } = await readSnapshot(cwd, input, 'input');
    const product = await productDigest(cwd, tree, def.documents);
    const identity = await observeIdentity(cwd, def.identity);
    // Fix round 1 finding 8 (Minor): "Only Agreed blocks are digested and checked" (spec section
    // 2) -- a non-Agreed declared requirement (e.g. Draft) is omitted from the receipt entirely,
    // not recorded with result 'unverified'. Its text is never even digested. Issue #44: the texts
    // are read before the run, so the receipt binds the text in force when the command started.
    const texts = [];
    for (const id of def.requirements) {
      const { textDigest, agreed } = await requirementDigest(cwd, id);
      if (agreed) texts.push({ id, textDigest });
    }
    const runCwd = def.cwd ? join(cwd, def.cwd) : cwd;
    let run = { spawned: false, out: Buffer.alloc(0), code: null, signal: null, seen: new Map() };
    try { await access(runCwd); run = await runCommand(runCwd, def.command, { results: texts.map((t) => t.id) }); } catch { /* status error */ }
    const changed = await changedDuringRun(cwd, { name, entry, tree, texts });
    const output = await writeOutput(cwd, changed ? Buffer.concat([run.out, Buffer.from(`${CHANGED_DURING_RUN}\n`)]) : run.out);
    const results = texts.map(({ id, textDigest }) => ({ requirement: id, text_digest: textDigest, result: changed ? 'unverified' : resultFor(def, run, id) }));
    const payload = {
      mechanism: name, definition_digest: entry.definitionDigest, input, product_digest: product,
      status: run.spawned ? 'ran' : 'error', identity, results, output,
      exit: { code: run.spawned ? run.code : null, signal: run.spawned ? run.signal : null },
    };
    return appendRecord(cwd, 'receipt', name, payload);
  });
}

import { treeIdentityReadOnly, catCommit, GitError } from './gitx.mjs';
import { resolveInputPaths, ALWAYS_EXCLUDED, SnapshotError } from './snapshots.mjs';

// Fix round 1 finding 1 (Critical): identity 1 (the input snapshot tree) is now recomputed with
// the same resolution writeInputSnapshot used to build the recorded snapshot -- resolveInputPaths
// expands a directory input through `git ls-files`, dropping ignored untracked files, the same way
// writeWorkspaceSnapshot and writeInputSnapshot already do -- instead of calling writeTreeFromPaths
// directly on the raw declared paths, which lstat-s each entry and throws on a directory. `exclude:
// ALWAYS_EXCLUDED` matches writeSnapshot's own call so the two trees are built the same way and can
// be compared by tree SHA.
//
// Fix round 1, item 1 (Critical, this branch's own review): identitiesNow's only production
// caller is isCurrent (below), a currency *check* -- it has no business writing anything, but
// writeTreeFromPaths writes every blob and the tree itself to the object database (`hash-object
// -w`, `write-tree`) as a side effect. Reproduced: one wake() call after a pass receipt and one
// edit to a declared input added three loose objects, breaking wake's read-only contract (wake
// reaches this through readState -> currentReceipt -> isCurrent). Switched to
// lib/gitx.mjs's treeIdentityReadOnly, which resolves and hashes the exact same entries
// (byte-identical tree sha, verified against writeTreeFromPaths/write-tree for a multi-level
// path set) without writing anything. The real writer path (lib/snapshots.mjs's
// writeInputSnapshot, used by check()) is untouched and still writes durably, as it must.
//
// `memo`, a Map one read-only pass owns (wake's readState), holds one reading of each mechanism
// definition's input tree and tool identities: the requirements it declares share it. Without it a
// consumer project spent 30 s in one wake, re-hashing inputs and re-running tool version probes
// for every stale receipt of every requirement.
export async function identitiesNow(cwd, REQ, memo = null) {
  const { name, entry } = await selectMechanism(cwd, REQ);
  const { textDigest } = await requirementDigest(cwd, REQ);
  const key = `${name}\0${entry.definitionDigest}`;
  let reading = memo?.get(key);
  if (!reading) {
    reading = (async () => {
      const paths = await resolveInputPaths(cwd, entry.definition.inputs);
      const tree = await treeIdentityReadOnly(cwd, { paths, exclude: ALWAYS_EXCLUDED });
      return { tree, identity: await observeIdentity(cwd, entry.definition.identity) };
    })();
    memo?.set(key, reading);
  }
  const { tree, identity } = await reading;
  return { mechanism: name, definitionDigest: entry.definitionDigest, textDigest, tree, identity };
}

// The identities a receipt for REQ must carry now, or null when REQ has no mechanism, text or
// input tree to read (the reasons isCurrent reports as not current).
export async function currentIdentities(cwd, REQ, memo = null) {
  try { return await identitiesNow(cwd, REQ, memo); } catch (e) { if (expected(e)) return null; throw e; }
}

// Fix round 1 finding 6 (Important): each of the three try/catch blocks below used to catch
// *any* thrown error and report "not current". That is right for the specific ways a receipt or
// its referents can legitimately be gone or mismatched (no mechanism still declares REQ, the
// requirement left docs/spec, the receipt's sha or its input snapshot no longer resolves, the
// snapshot's kind or envelope is wrong) -- but it also hid a real bug (finding 1's GitError from a
// directory input) as ordinary staleness. `expected` names exactly the error classes each call can
// throw for a legitimate "not current" reason; anything else -- a TypeError from a real defect,
// for instance -- now propagates instead of being swallowed.
const expected = (e) => e instanceof CheckError || e instanceof MechanismError || e instanceof SnapshotError || e instanceof GitError;

export async function isCurrent(cwd, receipt, REQ, now) {
  now = now ?? await currentIdentities(cwd, REQ);
  if (!now) return false;
  // The payload's own fields first: a receipt for another definition, text or tool set is not
  // current, and saying so reads nothing from Git.
  const p = receipt.payload;
  if (p.mechanism !== now.mechanism || p.definition_digest !== now.definitionDigest) return false;
  const r = p.results.find((x) => x.requirement === REQ);
  if (!r || r.text_digest !== now.textDigest) return false;
  if (canonicalize(p.identity) !== canonicalize(now.identity)) return false;
  let commit;
  try { commit = await catCommit(cwd, receipt.sha); } catch (e) { if (expected(e)) return false; throw e; }
  const trailers = Object.fromEntries(commit.trailers);
  if (!LAYOUTS.some((l) => trailers[l.schemaTrailer] === '1' && trailers[l.digestTrailer] === sha256(commit.body))) return false;
  let snap;
  try { snap = await readSnapshot(cwd, p.input, 'input'); } catch (e) { if (expected(e)) return false; throw e; }
  return snap.tree === now.tree;
}

// The newest receipt for REQ that is current: wake decides with it, and the brief names it (issue
// #33). isCurrent's fourth argument is the identities a current receipt must carry (identitiesNow),
// read once here for every receipt of the requirement, not a timestamp.
export async function currentReceipt(cwd, log, REQ, memo = null) {
  const now = await currentIdentities(cwd, REQ, memo);
  if (!now) return null;
  // Newest first, by index: a reversed copy of the log cost a pass over it on every lookup, once
  // per requirement and per defect source on each wake (issue #57), where the walk itself
  // usually stops at the first receipts it reaches.
  for (let i = log.length - 1; i >= 0; i--) {
    const r = log[i];
    if (r.kind !== 'receipt') continue;
    const res = r.payload.results.find((x) => x.requirement === REQ);
    if (!res) continue;
    if (await isCurrent(cwd, r, REQ, now)) return { sha: r.sha, status: r.payload.status, result: res.result };
  }
  return null;
}

export function latestReceipt(log, REQ) {
  return log.filter((r) => r.kind === 'receipt' && r.payload.results.some((x) => x.requirement === REQ)).at(-1) ?? null;
}

export async function evidence(cwd, log, REQ) {
  const receipt = latestReceipt(log, REQ);
  if (!receipt) return { receipt: null, current: false, result: null, outputPresent: false };
  const result = receipt.payload.results.find((x) => x.requirement === REQ).result;
  return { receipt, current: await isCurrent(cwd, receipt, REQ), result, outputPresent: await outputPresent(cwd, receipt) };
}

// `since`: a record SHA (the open commitment's start); receipts before it are not attempts.
// The deliberate fail receipts that bind mechanisms during the spec phase precede start and
// used to count, so a requirement could escalate on its first real attempt.
// `siblings`: the commitment's other requirement ids. A fail receipt in which one of them also
// failed is not an attempt at REQ: a requirement whose gate includes other requirements'
// falsifiers cannot pass until they do, and counting those runs escalated it for nothing.
export function attempts(log, REQ, opts = {}) {
  return attemptWalk(log, REQ, opts).count;
}
// `third`: the log index of the receipt that made the third distinct failing attempt since the
// last pass, or -1.
// `before`: the requirements ahead of REQ in the frozen set's order (issue #28, spec revision 15).
// Attempts count from REQ's turn, which begins at the first receipt, at or after `since`, where
// every requirement in `before` last passed; a requirement whose turn never begins has none.
// When the turn begins after `since`, REQ's first receipt in it is its starting point, not an
// attempt: that is the refresh wake named for other requirements' changes, which used to count
// against a requirement no one had worked on. With `before` empty, or every requirement in it
// already passing at `since`, counting starts at `since` as before.
function attemptWalk(log, REQ, { since = null, siblings = [], before = [] } = {}) {
  const seen = new Set();
  const latest = new Map();
  const passing = () => before.every((q) => latest.get(q) === 'pass');
  let counting = since === null, turn = counting && passing(), exempt = false, third = -1;
  log.forEach((rec, i) => {
    if (rec.kind === 'receipt' && rec.payload.status === 'ran') for (const x of rec.payload.results) if (before.includes(x.requirement)) latest.set(x.requirement, x.result);
    if (!counting) { if (rec.sha === since) { counting = true; turn = passing(); } return; }
    if (rec.kind !== 'receipt' || rec.payload.status !== 'ran') return;
    if (!turn) { if (!passing()) return; turn = true; exempt = true; }
    const r = rec.payload.results.find((x) => x.requirement === REQ);
    if (!r) return;
    if (exempt) { exempt = false; if (r.result === 'fail') return; }
    if (r.result === 'pass') { seen.clear(); third = -1; }
    else if (r.result === 'fail') {
      if (rec.payload.results.some((x) => x.requirement !== REQ && siblings.includes(x.requirement) && x.result === 'fail')) return;
      seen.add(rec.payload.product_digest);
      if (seen.size === 3 && third < 0) third = i;
    }
  });
  return { count: seen.size, third };
}
