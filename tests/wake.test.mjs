import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loopRepo, mechanismFor } from './helpers/loop.mjs';
import { makeProject } from './helpers/repo.mjs';
import { declare } from '../lib/mechanisms.mjs';
import { appendDecision } from '../lib/adr.mjs';
import { supersede, start } from '../lib/commitment.mjs';
import { authorize } from '../lib/auth.mjs';
import { git, readRef, catCommit, commitTree, updateRefCAS } from '../lib/gitx.mjs';
import { main } from '../lib/cli.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const cli = async (argv, cwd) => { let out = '', err = ''; const code = await main(argv, { cwd, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } }); return { code, out, err }; };
test('a command typed in a subdirectory runs at the repository top level, and a --file path is read from where it was typed', async () => {
  const r = await loopRepo();
  const sub = join(r.cwd, 'src', 'deep'); await mkdir(sub, { recursive: true });
  // cmdWake prints to process.stdout itself, so wake runs as a child process here.
  const spawnWake = (cwd) => spawnSync(process.execPath, [join(process.cwd(), 'bin/sudus.mjs'), 'wake'], { cwd, encoding: 'utf8' });
  const fromRoot = spawnWake(r.cwd), fromSub = spawnWake(sub);
  assert.equal(fromSub.stderr, ''); assert.equal(fromSub.stdout, fromRoot.stdout); assert.match(fromRoot.stdout, /action: run DEMO-001/);
  await writeFile(join(sub, 'def.json'), JSON.stringify(mechanismFor('DEMO-001')));
  const declared = await cli(['declare', 'demo-001', '--file', 'def.json'], sub);
  assert.equal(declared.err, ''); assert.equal(declared.code, 0);
});
test('record names an untracked file under a declared input and says a build artifact is gitignored instead', async () => {
  const r = await loopRepo();
  await declare(r.cwd, 'demo-001', { ...mechanismFor('DEMO-001'), inputs: ['src', 'flags/DEMO-001'] });
  await r.commit('declare src/ as an input');
  await r.write('src/__pycache__/demo.pyc', 'x');
  const spawnWake = () => spawnSync(process.execPath, [join(process.cwd(), 'bin/sudus.mjs'), 'wake'], { cwd: r.cwd, encoding: 'utf8' }).stdout;
  const w = spawnWake();
  assert.match(w, /action: record src\/__pycache__\/demo.pyc/); assert.match(w, /untracked file under a declared input.*gitignore/);
  await r.write('.gitignore', '__pycache__/\n');
  assert.doesNotMatch(spawnWake(), /__pycache__/);
});
import { check } from '../lib/check.mjs';
import { ulid } from '../lib/canon.mjs';
import { wake, FETCH_LINE, ORDER, readState, verdictOf, PREDICATES, doneRule, predicates } from '../lib/wake.mjs';
import { begin, end } from '../lib/lease.mjs';
import { preflight, dispose } from '../lib/scope.mjs';

test('outside a project wake exits 3 naming the skills', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sudus-none-'));
  assert.deepEqual(await wake(dir), { exit: 3, line: 'sudus: outside a project; run /new-project or /existing-project' });
});

// Deviation from the plan text: tests/helpers/repo.mjs's makeProject (plan 01/03) already
// configures an 'origin' remote at the Git level and lib/init.mjs's DEFAULT_SETTINGS('origin',
// null) defaults settings.authority_remote to 'origin', so a plain loopRepo() already has a
// configured authority remote; the plan's literal test assumed the opposite default (no remote
// until the test adds one) and would have failed its first assertion under the real fixture.
// Split into two repositories instead: one built with authority_remote explicitly null (for the
// 'run sudus init' line) and a plain loopRepo() (for the fetch-command line, which the fixture's
// own default remote already exercises without needing to configure anything by hand).
test('missing durable refs print the exact fetch command from section 4, or name init without a remote', async () => {
  const r1 = await loopRepo({ settings: { authority_remote: null } });
  await git(['update-ref', '-d', 'refs/sudus/log'], { cwd: r1.cwd });
  // Deviation from the plan text: plan 12's lib/travel.mjs (missingRefsLine) now supplies this
  // line, naming every missing durable ref rather than only the first one this loop's own scan
  // happened to reach; its local-only wording is "sudus init  (durable refs ... are missing and no
  // authority remote is configured)", not this file's earlier placeholder text.
  assert.deepEqual(await wake(r1.cwd), { exit: 3, line: 'sudus init  (durable refs refs/sudus/log are missing and no authority remote is configured)' });

  const r2 = await loopRepo();
  await git(['update-ref', '-d', 'refs/sudus/log'], { cwd: r2.cwd });
  const v = await wake(r2.cwd);
  assert.equal(v.exit, 3);
  assert.equal(v.line, "git fetch origin 'refs/sudus/log:refs/sudus/log' \\\n  'refs/sudus/snapshots:refs/sudus/snapshots'");
  assert.equal(FETCH_LINE('origin'), v.line);
});

// Issue #41: a repository never initialized for Sudus has no settings file, and wake named a bare
// `sudus init`, which refuses without --remote or --local-only: a choice the new-project and
// existing-project skills ask the developer to make.
test('wake names the skills, not a bare sudus init, in a repository with no settings file (issue #41)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sudus-test-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  assert.deepEqual(await wake(dir), { exit: 3, line: 'sudus: not initialized; run /new-project or /existing-project' });
});

// Deviation from the plan text: the real 'command-intent' schema (lib/records.mjs) is
// {tx, command, identity, pre, writes} (plan 04's settled shape), not the plan's provisional
// {transaction, command, inputs, expected, writes}; and the real 'superseded' schema carries
// required intent/results fields (fix round 1 finding 8, already applied to every other writer of
// a MULTI_STORE terminal record) plus a ulid-typed `transition` field, not an arbitrary token.
// Both fixtures below are built against the schema actually committed.
test('a pending supersession and an interrupted transaction are not verdicts', async () => {
  const r = await loopRepo();
  await r.add('command-intent', 'tx01', {
    tx: 'tx01', command: 'start', identity: {},
    pre: { refs: { 'refs/sudus/log': null, 'refs/sudus/snapshots': null }, head: null, files: {} },
    writes: [],
  });
  assert.deepEqual(await wake(r.cwd), { exit: 3, line: 'sudus recover tx01' });
  const r2 = await loopRepo();
  await r2.add('superseded', r2.slug, {
    slug: r2.slug, start: r2.startSha, decision: ulid(), transition: ulid(), successor: 'second', carried: [],
    intent: null, results: [],
  });
  assert.deepEqual(await wake(r2.cwd), { exit: 3, line: 'sudus: pending supersession to second; run /existing-project' });
});

test('the precedence order is the one section 5 states', () => {
  assert.deepEqual(ORDER, ['repair', 'recover', 'reconcile', 'scope', 'waiting', 'supersede', 'fix', 'record', 'declare', 'run', 'review mechanism', 'capture', 'review', 'report', 'resolve', 'build', 'done', 'fold', 'promote']);
});

async function treeHash(dir) {
  const h = createHash('sha256');
  for (const e of (await readdir(dir, { recursive: true, withFileTypes: true })).sort((a, b) => (a.parentPath + a.name < b.parentPath + b.name ? -1 : 1))) {
    if (!e.isFile()) continue;
    const p = join(e.parentPath, e.name);
    h.update(p).update(await readFile(p));
  }
  return h.digest('hex');
}

async function looseObjectCount(gitDir) {
  let count = 0;
  for (const d of await readdir(`${gitDir}/objects`, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === 'pack' || d.name === 'info') continue;
    count += (await readdir(`${gitDir}/objects/${d.name}`)).length;
  }
  return count;
}

// Task 22 registers `sudus wake` in lib/cli.mjs; until then r.runWake() exits 1 with "unknown
// command wake" and this test's second assertion fails as the plan's own text anticipates
// ("Expected: PASS once task 22 registers sudus wake; until then the runWake line fails with exit
// 1. Keep the test; it passes from task 22 on."). Committed here regardless, per that instruction.
//
// Fix round 1, item 2: the fixture above (a stray, undeclared file with no receipt at all) never
// reached lib/check.mjs's isCurrent -- readState's currentReceipt only calls it while scanning an
// existing receipt for the requirement, and this fixture had none, so the purity test never
// exercised the actual write path item 1 found (identitiesNow -> writeTreeFromPaths -> `git
// hash-object -w` / `write-tree`). passReq() first gives DEMO-001 a receipt to check currency
// against; dirtying a declared input afterwards (not just leaving it clean) matches the exact
// reproduction ("one wake call after a pass receipt and one edit added three loose objects").
test('wake writes nothing: the Git directory and worktree hash the same before and after', async () => {
  const r = await loopRepo();
  // An automatic gc the fixture's commits start in the background writes and removes pack files
  // while the Git directory is hashed (ENOENT on objects/pack/tmp_idx_*, seen 2026-09-29).
  await git(['config', 'gc.auto', '0'], { cwd: r.cwd });
  await r.passReq('DEMO-001');
  await r.write('src/demo.mjs', 'console.log("hello");\n// dirty\n');   // a declared input, uncommitted
  const gitDir = (await git(['rev-parse', '--absolute-git-dir'], { cwd: r.cwd })).stdout.trim();
  const before = [await treeHash(gitDir), await treeHash(r.cwd)];
  await wake(r.cwd);
  assert.equal(r.runWake().status, 0);
  assert.deepEqual([await treeHash(gitDir), await treeHash(r.cwd)], before);
});

// A direct, narrower check alongside the byte-hash one above: the loose object count under
// .git/objects is unchanged by wake, run twice, with a pass receipt and a dirty declared input in
// play (the exact state that, before item 1's fix, added three loose objects per call).
test('wake adds no loose Git object when checking currency against a dirty declared input', async () => {
  const r = await loopRepo();
  await git(['config', 'gc.auto', '0'], { cwd: r.cwd });   // an automatic gc mid-test packs objects and breaks the count
  await r.passReq('DEMO-001');
  await r.write('src/demo.mjs', 'console.log("hello");\n// dirty\n');
  const gitDir = (await git(['rev-parse', '--absolute-git-dir'], { cwd: r.cwd })).stdout.trim();
  const before = await looseObjectCount(gitDir);
  await wake(r.cwd);
  await wake(r.cwd);
  assert.equal(await looseObjectCount(gitDir), before);
});

// Deviation from the plan text: lib/spec.mjs's parseRoadmap has no check that Current: names an
// existing section, so the plan's own edit ('Current: first\n' alone, with the '## first' section
// removed) produces no lint finding at all under the real lint() -- 'repair' would never fire and
// 'scope' would win instead, failing this test's intent. parseRoadmap does refuse a second
// Requirements: line in one section (its own documented grammar problem), which is used here
// instead to make docs/spec/roadmap.md a genuinely unreadable hand-written input while keeping
// the same "repair precedes scope even with a stray file present" behavior under test.
test('an unreadable hand-written input names repair first', async () => {
  const r = await loopRepo();
  await r.write('src/stray.mjs', 'x\n');                       // would be scope, lower precedence
  await r.write('docs/spec/roadmap.md', 'Current: first\n\n## first\n\nRequirements: DEMO-001\n\nRequirements: DEMO-001\n\nDelivers the demo.\n');
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Resolvable');
  assert.equal(v.action, 'repair');
  assert.match(v.target, /^docs\/spec/);
  assert.equal(v.predicate, 'the named hand-written file reads under its grammar and no unrelated byte changed');
});

test('a stale lease is reconciled before scope', async () => {
  const r = await loopRepo();
  process.env.SUDUS_SESSION = 'test-session';               // begin (plan 04) records this as the lease's session
  await begin(r.cwd, { action: 'implement', target: 'DEMO-001', touch: [] });
  delete process.env.SUDUS_SESSION;
  await r.write('src/stray.mjs', 'x\n');
  const other = await wake(r.cwd, { session: 'other-session' });
  assert.deepEqual([other.action, other.target], ['reconcile', 'implement DEMO-001']);
  // Deviation from the plan text: wake's 'scope' predicate (Task 7) only reads scope-breach
  // records already on the log; it never runs a live preflight scan itself (wake writes nothing,
  // per Task 4's purity test). A dirty undeclared path with no preflight() call records no breach
  // at all, so the plan's own test as written never produces the breach this test's next
  // assertion (and its "live lease: not stale" comment) assumes exists. A preflight() call is
  // added here, the same one Task 7's own test uses, to record it.
  await preflight(r.cwd, await r.log(), { command: 'check' });
  const same = await wake(r.cwd, { session: null });
  assert.equal(same.action, 'scope');                            // live lease: not stale
  await end(r.cwd);
  await begin(r.cwd, { action: 'implement', target: 'DEMO-009', touch: [] });
  assert.equal((await wake(r.cwd, { session: null })).action, 'reconcile');   // target not in the set
});

test('an undisposed breach is named before an unanswered escalation', async () => {
  const r = await loopRepo();
  await r.write('src/stray.mjs', 'x\n');
  const [b] = await preflight(r.cwd, await r.log(), { command: 'check' });
  await r.escalate('DEMO-001');
  const v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'scope', 'src/stray.mjs']);
  await r.remove('src/stray.mjs');
  await dispose(r.cwd, b, 'restore');
  assert.equal((await wake(r.cwd)).verdict, 'Waiting');
});

test("the breach's own unanswered escalation is Waiting, not scope; an ok answer brings scope back until keep", async () => {
  const r = await loopRepo();
  await r.write('src/stray.mjs', 'x\n');
  const [b] = await preflight(r.cwd, await r.log(), { command: 'check' });
  assert.deepEqual([(await wake(r.cwd)).action, (await wake(r.cwd)).target], ['scope', 'src/stray.mjs']);
  const esc = await r.escalate(`breach:${b}`);
  const w = await wake(r.cwd);
  assert.equal(w.verdict, 'Waiting', JSON.stringify(w));
  await r.answer(esc, 'ok');
  assert.deepEqual([(await wake(r.cwd)).verdict, (await wake(r.cwd)).action], ['Resolvable', 'scope']);
  await dispose(r.cwd, b, 'keep');
  assert.notEqual((await wake(r.cwd)).action, 'scope');
});

test('an escalation without a final answer is Waiting with the five fields verbatim; ask makes reply Resolvable', async () => {
  const r = await loopRepo();
  const esc = await r.escalate('DEMO-001');
  let v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting');
  assert.equal(v.party, 'developer');
  assert.deepEqual(v.escalation, { sha: esc, slug: 'first', question: 'Q?', recommendation: 'R', because: 'B', if_wrong: 'W', instead: 'I', closes: [] });
  await r.answer(esc, 'ask', 'why?');
  v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'reply', 'first']);
  await r.reply(esc);
  assert.equal((await wake(r.cwd)).verdict, 'Waiting');
  await r.answer(esc, 'instead', 'do this');
  assert.notEqual((await wake(r.cwd)).verdict, 'Waiting');
});

// Task 7 (plan 16): developer: absent exits 4 when the open escalation names a floor- or
// veto-outcome measurement (spec section 5's floor-and-veto carve-out: with no developer, the
// floor or a veto is the only path left to the developer, so wake's own Waiting for it is a real
// verdict this run cannot answer, not sitting-and-waiting; section 2's exit-code table gives it
// exit 4, distinct from exit 3's non-verdict states). A raw 'measurement' record is appended
// directly here rather than through lib/evaluate.mjs's real measure() (which needs a full
// typesafeai/harness fixture -- see tests/escalate.test.mjs's repoWithCommitment -- for a real
// floor/veto outcome): wake's own 'waiting' predicate only ever reads the record's `outcome` field
// off the log, so a fixture-shaped draft digest satisfies it without a real evaluation-intent
// record behind it.
//
// `intent` (a ref-typed field, lib/records.mjs) cannot be an arbitrary well-formed sha the way
// `draft_digest` (a digest-typed field, never cross-checked) can: wake()'s own read path runs
// lib/travel.mjs's validateAfterFetch before verdictOf, which walks every ref-typed field of every
// record and names a `sudus push` repair for one that names no record actually in the log (section
// 4, "After fetch, wake validates all cross-references"). It does not check the referenced
// record's *kind*, only that some record with that sha exists, so `r.startSha` (always present,
// any loopRepo() fixture) stands in for it without needing a real evaluation-intent record.
//
// Deviation from the brief's own Step 1 snippet: its measurement literal sets `source: null`, but
// the real 'measurement' schema (lib/records.mjs) types `source` as `oneOf('jev', 'review')`, not
// nullable -- unlike `model`/`composite`/`veto`/`suggested`, which are genuinely nullable. `source:
// null` throws RecordError, not merely fails the eventual assertion, so the fixture below uses
// `source: 'jev'` instead, matching this file's existing schema-fidelity convention (every other
// deviation comment in this file over the real record schemas the plan text approximated).
const measurement = (r, outcome, extra = {}) => ({
  intent: r.startSha, call: null, draft_digest: 'sha256:' + 'b'.repeat(64), source: 'jev', model: null,
  levels: [], composite: null, veto: null, suggested: null, outcome, reason: `${outcome}:fixture`, ...extra,
});

test('developer: absent exits 4 when the open escalation names a floor-outcome measurement', async () => {
  const r = await loopRepo({ settings: { developer: 'absent' } });
  const mSha = await r.add('measurement', r.slug, measurement(r, 'floor', { reason: 'floor:data' }));
  const esc = await r.escalate('DEMO-001', r.slug, mSha);
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting');
  assert.equal(v.exit, 4);
  assert.deepEqual(v.escalation, { sha: esc, slug: 'first', question: 'Q?', recommendation: 'R', because: 'B', if_wrong: 'W', instead: 'I', closes: [] });
});

test('developer: absent exits 4 on any unanswered escalation, since no one can answer it', async () => {
  const r = await loopRepo({ settings: { developer: 'absent' } });
  await r.escalate('DEMO-001');
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting'); assert.equal(v.exit, 4);
});
test('a fourth distinct failing attempt is refused by sudus check until an escalation concerns the requirement', async () => {
  const r = await loopRepo();
  for (let i = 1; i <= 3; i++) { await r.write('src/demo.mjs', `console.log(${i});\n`); await r.commit(`attempt ${i}`); await check(r.cwd, 'DEMO-001'); }
  assert.deepEqual([(await wake(r.cwd)).action, (await wake(r.cwd)).target], ['escalate', 'DEMO-001']);
  await r.write('src/demo.mjs', 'console.log(4);\n'); await r.commit('attempt 4');
  await assert.rejects(check(r.cwd, 'DEMO-001'), /3 distinct failing attempts at DEMO-001 without a pass; a fourth attempt needs an escalation first/);
  await r.escalate('DEMO-001');
  await assert.doesNotReject(check(r.cwd, 'DEMO-001'));
});
// Review of 3.8.2: any escalation naming the requirement after its last pass counted, so one
// answered before the failures began, about something else, let a fourth attempt through.
test('an escalation answered before the three failing attempts does not let a fourth through', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  await r.answer(await r.escalate('DEMO-001'), 'ok');
  for (let i = 1; i <= 3; i++) { await r.write('src/demo.mjs', `console.log(${i});\n`); await r.write('flags/DEMO-001', 'fail\n'); await r.commit(`attempt ${i}`); await check(r.cwd, 'DEMO-001'); }
  assert.deepEqual([(await wake(r.cwd)).action, (await wake(r.cwd)).target], ['escalate', 'DEMO-001']);
  await r.write('src/demo.mjs', 'console.log(4);\n'); await r.commit('attempt 4');
  await assert.rejects(check(r.cwd, 'DEMO-001'), /a fourth attempt needs an escalation first/);
});
test('review mechanism names the latest fail receipt in its reason', async () => {
  const r = await loopRepo();
  const fail = await r.failReq('DEMO-001');
  await r.write('flags/DEMO-001', 'pass\n'); await r.commit('pass'); await check(r.cwd, 'DEMO-001');   // a pass with no mechanism review bound
  const v = await wake(r.cwd);
  assert.equal(v.action, 'review mechanism');
  assert.match(v.reason, new RegExp(`its latest fail receipt is ${fail}`));
});
test('an unresolved finding carried by a supersession stays open in the successor until resolved', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  await r.review([{ n: 1, text: 'carried finding' }]);
  const rev = (await r.log()).findLast((x) => x.kind === 'review').sha;
  const roadmap = await readFile(join(r.cwd, 'docs/spec/roadmap.md'), 'utf8');
  await r.write('docs/spec/roadmap.md', roadmap + '\n## second\n\nRequirements: DEMO-001\n\nAgain.\n'); await r.commit('second section');
  await supersede(r.cwd, 'second', { quote: 'go on', env: {} });
  await authorize(r.cwd, { quote: 'ok', env: {} });
  await start(r.cwd, 'second');
  await r.passReq('DEMO-001'); await r.review(); await r.report();
  const v = await wake(r.cwd);
  assert.equal(v.action, 'resolve', JSON.stringify(v));
  await r.add('resolution', 'second', { source: rev, finding: 1, snapshot: await r.snap(), explanation: 'fixed' });
  assert.notEqual((await wake(r.cwd)).action, 'resolve');
});
test('the same floor escalation with developer: present is ordinary Waiting, no exit code', async () => {
  const r = await loopRepo({ settings: { developer: 'present' } });
  const mSha = await r.add('measurement', r.slug, measurement(r, 'floor', { reason: 'floor:data' }));
  await r.escalate('DEMO-001', r.slug, mSha);
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting');
  assert.equal(v.exit, undefined);
});

// Controller Ruling 18 (binding, spec commit c3956291, postdates the brief's own floor-only text):
// "exit 4 applies when the escalation's measurement outcome is floor OR veto" -- section 5's own
// text agrees ("nothing routes a floor-caught or vetoed draft to the agent... A veto counts
// because section 5 says nothing routes a vetoed draft to the agent, so its Waiting is as
// unanswerable as the floor's"). Extended past the brief's own text and code accordingly.
test('developer: absent exits 4 when the open escalation names a veto-outcome measurement too (Controller Ruling 18)', async () => {
  const r = await loopRepo({ settings: { developer: 'absent' } });
  const mSha = await r.add('measurement', r.slug, measurement(r, 'veto', { veto: 'reach', reason: 'veto:reach' }));
  await r.escalate('DEMO-001', r.slug, mSha);
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting');
  assert.equal(v.exit, 4);
});

// Revised 2026-09-22: every unanswered escalation exits 4 under developer: absent, since no one
// can answer any of them; the floor-or-veto-only rule left the agent's own escalations, cycle
// bounds and breaches at an exit-0 Waiting a benchmark run could never leave.
test('developer: absent exits 4 on a plain cycle escalation too', async () => {
  const r = await loopRepo({ settings: { developer: 'absent' } });
  await r.escalate('cycle');
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting');
  assert.equal(v.exit, 4);
});

test("developer: absent exits 4 on the agent's own escalation past a composite measurement as well", async () => {
  const r = await loopRepo({ settings: { developer: 'absent' } });
  const mSha = await r.add('measurement', r.slug, measurement(r, 'composite', { composite: 0.1, suggested: 'agent', reason: 'composite 0.100' }));
  await r.escalate('DEMO-001', r.slug, mSha);
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting');
  assert.equal(v.exit, 4);
});

test('developer: absent exits 4 on an unavailable or an indeterminate measurement escalation as well', async () => {
  const r1 = await loopRepo({ settings: { developer: 'absent' } });
  const m1 = await r1.add('measurement', r1.slug, measurement(r1, 'unavailable', { reason: 'unavailable excluded' }));
  await r1.escalate('DEMO-001', r1.slug, m1);
  assert.equal((await wake(r1.cwd)).exit, 4);

  const r2 = await loopRepo({ settings: { developer: 'absent' } });
  const m2 = await r2.add('measurement', r2.slug, measurement(r2, 'indeterminate', { reason: 'indeterminate: an intent was left open by a crash' }));
  await r2.escalate('DEMO-001', r2.slug, m2);
  assert.equal((await wake(r2.cwd)).exit, 4);
});

test('cmdWake exits 4 through main() and prints the five fields exactly as ordinary Waiting does, not a bare line', async () => {
  const r = await loopRepo({ settings: { developer: 'absent' } });
  const mSha = await r.add('measurement', r.slug, measurement(r, 'floor', { reason: 'floor:data' }));
  const esc = await r.escalate('DEMO-001', r.slug, mSha);
  const out = r.runWake();
  assert.equal(out.status, 4);
  assert.equal(out.stdout, [
    'verdict: Waiting', 'party: developer', `reason: escalation ${esc} awaits an answer`,
    'question: Q?', 'recommendation: R', 'because: B', 'if wrong: W', 'instead: I',
    `predicate: ${PREDICATES.waiting}`, '',
  ].join('\n'));
});

test('an unfixed defect against a set requirement is named before dirty inputs', async () => {
  const r = await loopRepo();
  const item = await r.item('defect', 'DEMO-001', 'wrong-greeting');
  await r.write('src/demo.mjs', 'console.log("hey");\n');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['fix', 'wrong-greeting']);
  await r.commit('fix greeting');
  await r.add('fix', 'wrong-greeting', { item, snapshot: await r.snap() });
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['run', 'DEMO-001'], JSON.stringify(v));   // the fix is recorded; the check is next (issue #64)
  await r.passReq('DEMO-001');
  assert.notEqual((await wake(r.cwd)).action, 'fix');
});

// Issue #26 (3.8.1): the manual orders a defect fix "commit, check, then sudus fix", but the fix
// predicate read "at or after it" as log order alone, so a pass checked before the fix record never
// counted, even when it ran on the inputs the fix record holds, and one more check was needed.
test('a pass checked before the fix record counts when it ran on the inputs the fix holds, and not after the fix is reverted (issue #26)', async () => {
  const r = await loopRepo();
  const item = await r.item('defect', 'DEMO-001', 'wrong-greeting');
  await r.write('src/demo.mjs', 'console.log("hey");\n'); await r.commit('fix greeting');
  await r.passReq('DEMO-001');
  await r.add('fix', 'wrong-greeting', { item, snapshot: await r.snap() });
  let v = await wake(r.cwd);
  assert.notEqual(v.action, 'fix', JSON.stringify(v));
  const after = v.action;
  await r.write('notes/n.md', 'a note\n'); await r.commit('a note');
  v = await wake(r.cwd);
  assert.equal(v.action, after, JSON.stringify(v));   // a path no mechanism reads leaves the pass at the fix

  // A reverted fix: the pass ran on the inputs from before this fix, and the workspace went back to them.
  const item2 = await r.item('defect', 'DEMO-001', 'wrong-greeting-2');
  await r.write('src/demo.mjs', 'console.log("hi");\n'); await r.commit('second fix');
  await r.add('fix', 'wrong-greeting-2', { item: item2, snapshot: await r.snap() });
  await r.write('src/demo.mjs', 'console.log("hey");\n'); await r.commit('revert the second fix');
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target, v.reason], ['fix', 'wrong-greeting-2', 'DEMO-001 has no current pass at or after the fix'], JSON.stringify(v));
});
// Review of 3.8.2: a pass recorded before the defect item itself counted as "at" a fix that
// changed nothing, so a defect was closed with no check run after it was known.
test('a pass recorded before the defect item does not count for its fix; a check after the item does', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  const item = await r.item('defect', 'DEMO-001', 'wrong-greeting');
  await r.add('fix', 'wrong-greeting', { item, snapshot: await r.snap() });
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target, v.reason], ['fix', 'wrong-greeting', 'DEMO-001 has no current pass at or after the fix'], JSON.stringify(v));
  await check(r.cwd, 'DEMO-001');
  v = await wake(r.cwd);
  assert.notEqual(v.action, 'fix', JSON.stringify(v));
});

// Fix round 1, item 4: protectedChanged used to treat every docs/spec/** path as protected, with
// no exception for the roadmap (docs/spec/roadmap.md), so a fix snapshot that happened to also
// touch the roadmap was refused forever -- there was no way to ever satisfy 'fix' again. It now
// classifies with lib/paths.mjs's real classify(), which carries PROTECTED_EXCEPT the same way
// scope.mjs's own preflight() does.
test('a fix snapshot may edit the roadmap (excepted from protected) but a genuinely protected path still refuses it', async () => {
  const r = await loopRepo();
  const item = await r.item('defect', 'DEMO-001', 'wrong-greeting');
  await r.write('src/demo.mjs', 'console.log("hey");\n');
  const roadmap = await readFile(join(r.cwd, 'docs/spec/roadmap.md'), 'utf8');
  await r.write('docs/spec/roadmap.md', roadmap + '\n');
  await r.commit('fix greeting and touch the roadmap');
  await r.add('fix', 'wrong-greeting', { item, snapshot: await r.snap() });
  await r.passReq('DEMO-001');
  assert.notEqual((await wake(r.cwd)).action, 'fix');   // the roadmap edit alone does not block fix

  const item2 = await r.item('defect', 'DEMO-001', 'wrong-greeting-2');
  await r.write('src/demo.mjs', 'console.log("hey");\n');
  await r.write('AGENTS.md', '# Working agreement\nedited\n');
  await r.commit('fix greeting and touch AGENTS.md');
  await r.add('fix', 'wrong-greeting-2', { item: item2, snapshot: await r.snap() });
  await r.passReq('DEMO-001');
  const v = await wake(r.cwd);
  assert.equal(v.action, 'fix');
  assert.match(v.reason, /protected/);
});

// Deviation from the plan text: lib/lease.mjs's real ACTIONS set (plan 04) is
// {implement, build, run, review, declare, repair, promote, resolve, fix, scope}; it has no
// 'build-decision' member, so begin() with that action throws LeaseError. Any action whose
// target names no mechanism's requirements works to keep the lease from covering src/demo.mjs;
// 'build' with the same unrelated ULID target does the same job the plan's fixture intended.
test('a dirty declared input is record without a lease, commit when the lease does not cover it, nothing when it does', async () => {
  const r = await loopRepo();
  await r.write('src/demo.mjs', 'console.log("hey");\n');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target, v.predicate], ['record', 'src/demo.mjs', "the action lease covers the path through its target's declared inputs, or the path is clean"]);
  await begin(r.cwd, { action: 'build', target: '01HZZZZZZZZZZZZZZZZZZZZZZZ', touch: [] });
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['commit', 'src/demo.mjs']);
  await end(r.cwd);
  await begin(r.cwd, { action: 'implement', target: 'DEMO-001', touch: [] });
  assert.notEqual((await wake(r.cwd)).action, 'commit');
  await end(r.cwd);
  await r.commit('clean');
  assert.notEqual((await wake(r.cwd)).action, 'record');
});

// Issue #42: the stale-lease check read a requirement target with /^[A-Z]+-\d+$/, so a prefix with a
// digit (E2E, S3, OAUTH2), which the requirement grammar allows, was never named stale outside the
// commitment, and the lease kept its target's inputs out of record and commit.
test('a lease on a requirement outside the commitment is stale when its prefix holds a digit (issue #42)', async () => {
  const r = await loopRepo();
  for (const target of ['E2E-002', 'API-002']) {
    await begin(r.cwd, { action: 'implement', target, touch: [] });
    const v = await wake(r.cwd);
    assert.deepEqual([v.action, v.target, v.reason], ['reconcile', `implement ${target}`, `the action lease is stale: ${target} is not in the commitment`]);
    await end(r.cwd, { abandon: true });
  }
});

// Issue #39: after the report wake names resolve SLUG N, and the lease for the fix is resolve SLUG.
// No mechanism declares a slug, so that lease covered nothing and every file the fix changed was
// named commit.
test('a resolve lease on the open commitment slug covers the files a fix changes (issue #39)', async () => {
  const r = await loopRepo({ reqs: ['DEMO-001', 'DEMO-002'] });
  await begin(r.cwd, { action: 'resolve', target: 'first', touch: [] });
  await r.write('src/demo.mjs', 'console.log("fixed");\n');
  await r.write('flags/DEMO-002', 'pass\n');
  const covered = await wake(r.cwd);
  assert.notEqual(covered.action, 'commit', covered.reason);
  await end(r.cwd);
  await begin(r.cwd, { action: 'resolve', target: 'second', touch: [] });
  const other = await wake(r.cwd);
  assert.deepEqual([other.action, other.reason.endsWith('the lease for resolve second does not cover it')], ['commit', true]);
});

test('declare is named for the first set requirement no definition names', async () => {
  const r = await loopRepo({ reqs: ['DEMO-001', 'DEMO-002'] });
  assert.notEqual((await wake(r.cwd)).action, 'declare');                   // the fixture declares every requirement it starts
  const st = await readState(r.cwd);
  st.set = [...st.set, { requirement: 'DEMO-003', text_digest: 'sha256:' + '0'.repeat(64) }];
  st.blocks.set('DEMO-003', { textDigest: 'sha256:' + '0'.repeat(64) });   // the text reads as frozen; only the declaration is missing
  const v = await verdictOf(st);
  assert.deepEqual([v.action, v.target], ['declare', 'DEMO-003']);
  assert.equal(v.predicate, 'a mechanism definition names the requirement and no pre-existing undeclared delta was legalized');
});

test('no current receipt is run; a current fail is implement; three attempts make escalate', async () => {
  const r = await loopRepo();
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['run', 'DEMO-001']);
  await r.failReq('DEMO-001');
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target, v.predicate], ['implement', 'DEMO-001', PREDICATES.implement]);
  for (const body of ['a', 'b']) { await r.write('src/demo.mjs', `// ${body}\n`); await r.failReq('DEMO-001'); }
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['escalate', 'DEMO-001']);
  const esc = await r.escalate('DEMO-001');
  assert.equal((await wake(r.cwd)).verdict, 'Waiting');
  await r.answer(esc, 'ok');
  assert.equal((await wake(r.cwd)).action, 'implement');
});

test('a current pass whose review metadata is unbound by a changed command is review mechanism', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  assert.equal((await wake(r.cwd)).action, 'review');
  await declare(r.cwd, 'demo-001', { ...mechanismFor('DEMO-001'), command: `${mechanismFor('DEMO-001').command} && true` });
  await r.commit('change the command');
  await r.failReq('DEMO-001');
  await r.write('flags/DEMO-001', 'pass\n'); await r.commit('pass again');
  await check(r.cwd, 'DEMO-001');
  const v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['review mechanism', 'DEMO-001']);
});

test('an item captured from a set requirement needs an outside record or an escalation', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  const item = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['capture', 'nicer-greeting']);
  await r.add('outside', 'nicer-greeting', { item, reason: 'the greeting text is not in DEMO-001', evaluation: null });
  assert.equal((await wake(r.cwd)).action, 'review');
  const item2 = await r.item('next-feature', 'DEMO-001', 'colour');
  await r.escalate(`item:${item2}`);
  assert.equal((await wake(r.cwd)).verdict, 'Waiting');
});

// Issue #23: "an escalation concerns it" holds for an escalation that also names other concerns.
test('an escalation naming an item among other concerns covers its capture', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  const item = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  const e = await r.escalate(`DEMO-001 item:${item}`);
  await r.answer(e, 'ok');
  assert.equal((await wake(r.cwd)).action, 'review');
});

test('review is named until a review at the current workspace answers every fixed question for every target', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['review', 'first']);
  const rev = await r.review();
  assert.equal((await wake(r.cwd)).action, 'report');
  await r.write('src/demo.mjs', 'console.log("hello");\n// note\n'); await r.commit('later edit');
  await check(r.cwd, 'DEMO-001');                                   // keep the receipt current: src/demo.mjs is an input
  assert.equal((await wake(r.cwd)).action, 'review');              // no report yet: the review must be current
  const log = await r.log();
  const partial = { ...log.find((x) => x.sha === rev).payload, snapshot: await r.snap(), answers: [] };
  await r.add('review', 'first', partial);
  v = await wake(r.cwd);
  assert.equal(v.action, 'review');
  assert.match(v.reason, /Q1 for demo-001/);
});

// Deviation from the plan text: the real 'report' schema's interface_attempts entries are
// {path, text} objects, not bare path strings (the same {path,text}/{question,target,text} shape
// its `attempts` list already uses), so the wake predicate below checks `.some(a => a.path === p)`
// rather than the plan's `.includes(p)`, which can never match an object against a string.
test('report is named until a brief and report name the reviewed snapshot with every attempt', async () => {
  const r = await loopRepo({ settings: { interfaces: ['src/api/**'] } });
  await r.write('src/api/index.mjs', 'export const api = 1;\n');
  await r.commit('api');
  await declare(r.cwd, 'demo-001', { ...mechanismFor('DEMO-001'), inputs: ['src/demo.mjs', 'flags/DEMO-001', 'src/api'] });
  await r.commit('declare api');
  await r.passReq('DEMO-001');
  await r.review();
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['report', 'first']);
  const rep = await r.report();
  v = await wake(r.cwd);
  assert.equal(v.action, 'report');
  assert.match(v.reason, /interface src\/api\/index\.mjs/);
  const log = await r.log();
  await r.add('report', 'first', { ...log.find((x) => x.sha === rep).payload, interface_attempts: [{ path: 'src/api/index.mjs', looked_for: 'a caller the change breaks', found: 'none', held: true }] });
  assert.notEqual((await wake(r.cwd)).action, 'report');
});

test('every finding on the review or the report needs a resolution or a decline; an escalation holds it while it waits', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  await r.review([{ n: 1, text: 'builder finding' }]);
  const rep = await r.report([{ n: 1, text: 'adversary finding', severity: 'Critical' }]);
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['resolve', 'first 1']);
  const rev = (await r.log()).find((x) => x.kind === 'review').sha;
  await r.resolveFinding(rev, 1);
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['resolve', 'first 1']);
  assert.match(v.reason, /finding 1 \(Critical\) on the report .* has no resolution and no decline/);
  assert.equal(v.predicate, PREDICATES.resolve);
  await r.escalate(`finding:${rep}#1`);
  assert.equal((await wake(r.cwd)).verdict, 'Waiting');
});

// Review of 4.0.0: a second review before the report hid the first review's findings from the Done
// rule, while sudus done printed them open and a closed commitment could never settle them.
test('a finding on an earlier review of the commitment stays open until resolved or declined, whatever a later review says', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  const first = await r.review([{ n: 1, text: 'the mechanism could pass without the behavior' }]);
  await r.review();
  await r.report();
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['resolve', 'first 1']);
  assert.match(v.reason, new RegExp(`on the review ${first}`));
  assert.deepEqual((await doneRule(await readState(r.cwd))).failed, ['findings']);
  await r.declineFinding(first, 1);
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['done', 'first']);
});

// Sudus 4.0.0 (developer's ruling, 2026-09-25): "The builder is the decision maker and Sudus will
// judge". A decline with its reason closes a finding of any severity; nothing waits on anyone.
test('a decline closes a finding, a Critical one too, and wake moves on without an acceptance', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  await r.review();
  const rep = await r.report([{ n: 1, text: 'a blank name prints a bare comma', severity: 'Critical' }, { n: 2, text: 'no test for a long name', severity: 'Minor' }]);
  await r.declineFinding(rep, 1, 'the falsifier names a missing name, not a blank one');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['resolve', 'first 2']);
  await r.resolveFinding(rep, 2);
  v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'done', 'first']);
  assert.equal((await doneRule(await readState(r.cwd))).holds, true);
});

// A log written before 4.0.0 keeps its meaning: a 3.x acceptance that rejected a resolution
// leaves its finding open, and a 3.x report still counts as the report.
test('a 3.x report still completes the review, and a resolution a 3.x acceptance rejected leaves its finding open', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  await r.review();
  const rep = await r.legacyReport([{ n: 1, text: 'finding' }]);
  const res = await r.resolveFinding(rep, 1);
  assert.equal((await wake(r.cwd)).action, 'done');
  await r.accept({ rejected: [res] });
  const v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['resolve', 'first 1']);
  await r.declineFinding(rep, 1);
  assert.equal((await wake(r.cwd)).action, 'done');
});

// Sudus 4.0.0: an adversary that finds a Sudus bug stops and reports only the bug. That report
// does not complete the review; wake names a new report and quotes the bug.
test('a report that stopped on a Sudus bug does not complete the review; wake names report with the bug', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  await r.review();
  const bug = await r.report([], { bug: 'sudus brief lists no receipt for DEMO-001\nthough one ran' });
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['report', 'first']);
  assert.match(v.reason, new RegExp(`the report ${bug} stopped on a Sudus bug: sudus brief lists no receipt for DEMO-001 though one ran`));
  assert.ok((await doneRule(await readState(r.cwd))).failed.includes('review-report'));
  await r.report();
  v = await wake(r.cwd);
  assert.equal(v.action, 'done');
});

test('after the report, a fix and a change need no acceptance: a stale receipt is run, then Done holds', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  await r.review();
  const rep = await r.report([{ n: 1, text: 'finding' }]);
  await r.write('src/demo.mjs', 'console.log("hello");\n// fixed\n'); await r.commit('fix');
  await r.resolveFinding(rep, 1);
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['run', 'DEMO-001']);
  await check(r.cwd, 'DEMO-001');
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['done', 'first']);
});

// Deviation from the plan text: lib/adr.mjs's real appendDecision(cwd, line, {command}) takes a
// required second {command} argument checked against the line kind's assigned writer list
// (ASSIGNED.decision includes 'decide', ASSIGNED.realized is only 'realize'), and both the
// 'decision' and 'realized' schemas carry a required `interfaces` list field the plan's payloads
// omitted.
test('an unrealized Consequential decision is build until a realized line names it', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001'); await r.review(); await r.report();
  const id = await r.decide();
  await r.commit('record decision');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['build', id]);
  await appendDecision(r.cwd, { kind: 'realized', of: id, base_snap: r.startSnapshot, snap: await r.snap(), subject: 'map in place', interfaces: [] }, { command: 'realize' });
  await r.commit('realized');
  assert.notEqual((await wake(r.cwd)).action, 'build');
});

// Fix round 1, item 5: doneRule's bullet 4 used to select every non-'decision' ADR line (a 'read'
// line included) as closing a Consequential decision, and separately never checked
// level === 'Consequential' at all. A 'read' line (`sudus decisions --read`, a developer
// acknowledgment, not a realization) must not close it; a 'realized' line must.
test('a read line does not close a Consequential decision for the Done rule, but a realized line does', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001'); await r.review(); await r.report();
  const id = await r.decide();
  await r.commit('record decision');
  assert.ok((await doneRule(await readState(r.cwd))).failed.includes('obligations'));
  await appendDecision(r.cwd, { kind: 'read', of: id, record: r.startSha }, { command: 'decisions --read' });
  await r.commit('read decision');
  assert.ok((await doneRule(await readState(r.cwd))).failed.includes('obligations'));   // a read line alone never closes it
  await appendDecision(r.cwd, { kind: 'realized', of: id, base_snap: r.startSnapshot, snap: await r.snap(), subject: 'done', interfaces: [] }, { command: 'realize' });
  await r.commit('realize decision');
  assert.equal((await doneRule(await readState(r.cwd))).holds, true);
});

async function finished() {
  const r = await loopRepo();
  await r.passReq('DEMO-001'); await r.review(); await r.report();
  return r;
}

// Deviation from the plan text: doneRule is `export async function doneRule(st)`, so every call
// below is awaited before reading `.holds`/`.failed`; the plan's own literal test code called
// `doneRule(st).failed` and `doneRule(await readState(...)).holds` without awaiting doneRule
// itself, which reads properties off a pending Promise (always undefined) rather than the
// resolved object.
test('Done rule: a change after the report needs no acceptance; the checks judge it', async () => {
  const r = await finished();
  assert.equal((await doneRule(await readState(r.cwd))).holds, true);
  await r.write('README.md', '# demo, changed after the report\n'); await r.commit('a change after the report');
  assert.equal((await doneRule(await readState(r.cwd))).holds, true);
});
test('Done rule bullet 1: every frozen requirement has a current bound pass', async () => {
  const r = await finished();
  await r.write('src/demo.mjs', 'console.log("changed");\n'); await r.commit('stale the receipt');
  const st = await readState(r.cwd);
  assert.deepEqual((await doneRule(st)).failed, ['evidence']);
  assert.equal((await wake(r.cwd)).action, 'run');
});

test('Done rule bullet 2: a review and report exist at the reviewed snapshot', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  assert.deepEqual((await doneRule(await readState(r.cwd))).failed, ['review-report']);
  await r.review();
  assert.deepEqual((await doneRule(await readState(r.cwd))).failed, ['review-report']);
});

test('Done rule bullet 3: every finding is resolved or declined', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001'); await r.review();
  const rep = await r.report([{ n: 1, text: 'f' }, { n: 2, text: 'g' }]);
  assert.deepEqual((await doneRule(await readState(r.cwd))).failed, ['findings']);
  await r.resolveFinding(rep, 1);
  assert.deepEqual((await doneRule(await readState(r.cwd))).failed, ['findings']);
  await r.declineFinding(rep, 2);
  assert.equal((await doneRule(await readState(r.cwd))).holds, true);
});

test('Done rule bullet 4: no escalation, breach, defect, transaction, lease, decision or cycle escalation is open', async () => {
  const r = await finished();
  const esc = await r.escalate('cycle');
  assert.deepEqual((await doneRule(await readState(r.cwd))).failed, ['obligations']);
  assert.equal((await wake(r.cwd)).verdict, 'Waiting');
  await r.answer(esc, 'ok');
  assert.equal((await doneRule(await readState(r.cwd))).holds, true);
  const v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'done', 'first']);
});

// Deviation from the plan text: the real 'promotion' schema (lib/records.mjs) carries required
// intent/results fields (fix round 1 finding 8, the same MULTI_STORE-terminal-record treatment
// 'start' and 'superseded' already got), which the plan's payload omitted.
test('a closed range with a backlog item names promote; without one the verdict is Done', async () => {
  const r = await finished();
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  let v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Done', null, 'first']);
  const item = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  await r.add('outside', 'nicer-greeting', { item, reason: 'later', evaluation: null });
  v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'promote', 'nicer-greeting']);
  await r.item('next-feature', 'DEMO-001', 'colour');
  await r.add('promotion', 'nicer-greeting', { item, decision: ulid(), intent: null, results: [] });
  assert.equal((await wake(r.cwd)).verdict, 'Done');   // a next-feature item waits for the developer
});

// Fix round 1, item 7: the Waiting render no longer appends an `answer: sudus answer ...` line
// (section 6 names verdict, action or party, one reason line and the predicate; Waiting's own
// five fields never claimed an answer line too). Checked here against the exact stdout bytes, not
// just a slice, so a stray extra line would fail this test.
test('sudus wake prints verdict, action or party, one reason line and the predicate; Waiting adds the five fields', async () => {
  const r = await loopRepo();
  let out = r.runWake();
  assert.equal(out.status, 0);
  assert.deepEqual(out.stdout.split('\n').slice(0, 4), ['verdict: Resolvable', 'action: run DEMO-001', 'reason: no current receipt carries a result for DEMO-001', `predicate: ${PREDICATES.run}`]);
  const esc = await r.escalate('DEMO-001');
  out = r.runWake();
  assert.equal(out.status, 0);
  assert.equal(out.stdout, [
    'verdict: Waiting', 'party: developer', `reason: escalation ${esc} awaits an answer`,
    'question: Q?', 'recommendation: R', 'because: B', 'if wrong: W', 'instead: I',
    `predicate: ${PREDICATES.waiting}`, '',
  ].join('\n'));
  const dir = await mkdtemp(join(tmpdir(), 'sudus-none-'));
  const none = spawnSync(process.execPath, [new URL('../bin/sudus.mjs', import.meta.url).pathname, 'wake'], { cwd: dir, encoding: 'utf8' });
  assert.equal(none.status, 3);
  assert.equal(none.stdout, 'sudus: outside a project; run /new-project or /existing-project\n');
});

// Fix round 1, item 11(b), pulled forward as a dependency of item 3: under wake's own cascading
// precedence, 'report' is only ever reached once 'review' has already been satisfied, so its
// unmet(...) message could safely dereference rev.payload unconditionally. lib/cycle.mjs's
// guardKernelWrite (item 3) now asks every predicate about a scratch state independently of that
// cascade, so it can reach 'report' with no review yet; it used to throw a raw TypeError there
// instead of returning a clean unmet.
test('the report and resolve predicates do not crash when asked about a state with no review or report yet', async () => {
  const r = await loopRepo();
  const st = await readState(r.cwd);
  const rv = await predicates.find((p) => p.name === 'report').test(st);
  assert.equal(rv.action, 'report');
  assert.equal(await predicates.find((p) => p.name === 'resolve').test(st), null);
});

// Fix round 1, item 8: a fifth exit-3 case beyond section 2's four. makeProject() (plan 01/03)
// initializes settings, the init record and both durable refs but writes no start record at all --
// exactly the pending-initialization state between `sudus init` and the spec-phase tail's
// `sudus start`. The existing-project skill is what resumes it.
test('a project with durable refs but no start record at all names the pending-initialization skill', async () => {
  const { cwd } = await makeProject();
  assert.deepEqual(await wake(cwd), { exit: 3, line: 'sudus: no commitment started; run /new-project or /existing-project' });
});

// Fix round 1, item 11(a): nothing bound the predicates array's own registration order to ORDER
// itself -- a define() call placed at the wrong point in the file would silently reorder
// precedence with no test failing. 'supersession' is the one predicates entry with no ORDER
// position (it is the exit-3 gate tested between recover and reconcile, not a section 5 action).
test("the predicates array is registered in exactly ORDER's precedence, aside from the supersession exit-3 gate", () => {
  assert.deepEqual(predicates.filter((p) => p.name !== 'supersession').map((p) => p.name), ORDER);
});

// Fix round 1, item 11(f): a corrupted action lease commit (body that is not canonical JSON) used
// to propagate a raw CanonError straight out of readState/wake instead of becoming a clean
// 'repair' verdict, the same way a corrupted settings, mechanisms or ADR read already does.
test('a corrupted action lease is a repair refusal, not a crash', async () => {
  const r = await loopRepo();
  await begin(r.cwd, { action: 'implement', target: 'DEMO-001', touch: [] });
  const leaseSha = await readRef(r.cwd, 'refs/sudus/in-progress');
  const { tree } = await catCommit(r.cwd, leaseSha);
  const badSha = await commitTree(r.cwd, { tree, parents: [], subject: 'sudus: lease implement DEMO-001', body: 'not json', trailers: [] });
  await updateRefCAS(r.cwd, 'refs/sudus/in-progress', badSha, leaseSha);
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Resolvable');
  assert.equal(v.action, 'repair');
});

// Fix round 2, finding 1: a declared input directory that expands to a '__proto__' path used to
// make lib/gitx.mjs's treeShaFromEntries compute a wrong, permanently-mismatched tree sha (or
// silently drop the entry), so isCurrent never found the receipt current again and wake named
// `run DEMO-001` forever, with no way for `sudus check` to clear it. '__proto__' and 'constructor'
// are ordinary path components to Git; declaring the whole 'src' directory (rather than the exact
// file) as the input is what makes resolveInputPaths actually walk into the awkward subdirectory.
test('a declared input directory containing a __proto__ path component is current after passing, not stuck on run', async () => {
  const r = await loopRepo();
  await declare(r.cwd, 'demo-001', { ...mechanismFor('DEMO-001'), inputs: ['src'] });
  await r.write('src/__proto__/x.mjs', 'export const x = 1;\n');
  await r.commit('add an awkward path under the declared input directory');
  await r.passReq('DEMO-001');
  const v = await wake(r.cwd);
  assert.notEqual(v.action, 'run');
});
// Issue #6 (johnwlockwood, 3.0.2): between commitments the fix predicate checks every unfixed
// defect, but the pass table wake built covered only the last commitment's requirement set. A
// defect against a requirement that commitment never owned read an undefined entry, so a later
// passing check never counted and wake named fix forever.
test('a defect against a requirement outside the last commitment\'s set is discharged by a later pass (issue #6)', async () => {
  const { done, item, fix } = await import('../lib/commitment.mjs');
  const { authorize } = await import('../lib/auth.mjs');
  const { check } = await import('../lib/check.mjs');
  const r = await loopRepo({ reqs: ['DEMO-001', 'DEMO-002'] });
  await r.passReq('DEMO-001'); await r.passReq('DEMO-002'); await r.review(); await r.report();
  await done(r.cwd, 'first');
  await item(r.cwd, { kind: 'defect', slug: 'gate', source: 'DEMO-001', body: 'x' });
  // The fix changes an input, so the pass from before it is not at the fix (issue #26).
  await r.write('src/demo.mjs', 'console.log("hey");\n'); await r.commit('fix gate');
  await fix(r.cwd, 'gate');
  const roadmap = await readFile(join(r.cwd, 'docs/spec/roadmap.md'), 'utf8');
  await r.write('docs/spec/roadmap.md', roadmap.replace('Current: first', 'Current: second') + '\n## second\n\nRequirements: DEMO-002\n\nOnly the name.\n'); await r.commit('second');
  await authorize(r.cwd, { quote: 'ok', env: {} });
  await start(r.cwd, 'second');
  await done(r.cwd, 'second', { unchecked: true });
  assert.match((await wake(r.cwd)).reason, /the fix of gate is recorded and no current receipt carries a result for DEMO-001/);
  await check(r.cwd, 'DEMO-001');
  const v = await wake(r.cwd);
  assert.notEqual(v.reason, 'the fix of gate is recorded and no current receipt carries a result for DEMO-001', JSON.stringify(v));
  assert.notEqual(v.target, 'gate', JSON.stringify(v));
});
// Issue #64 (eas4ai, 4.2.13): a defect whose fix was recorded was named `fix` again whenever its
// requirement's pass went stale, as after any commit to the mechanism's inputs. The manual's fix
// move then records the fix a second time; the one step left is a check, and wake names it.
async function fixedBetweenCommitments() {
  const { done, item, fix } = await import('../lib/commitment.mjs');
  const { check } = await import('../lib/check.mjs');
  const r = await loopRepo({ reqs: ['DEMO-001', 'DEMO-002'] });
  await r.passReq('DEMO-001'); await r.passReq('DEMO-002'); await r.review(); await r.report();
  await done(r.cwd, 'first');
  await item(r.cwd, { kind: 'defect', slug: 'gate', source: 'DEMO-001', body: 'x' });
  await r.write('src/demo.mjs', 'console.log("hey");\n'); await r.commit('fix gate');
  await check(r.cwd, 'DEMO-001');
  await fix(r.cwd, 'gate');
  assert.equal((await wake(r.cwd)).verdict, 'Done');
  return r;
}
test('between commitments a recorded fix whose pass went stale names run REQ, a check alone clears it, and a failing check is fix again (issue #64)', async () => {
  const { check } = await import('../lib/check.mjs');
  const r = await fixedBetweenCommitments();
  await r.write('src/demo.mjs', 'console.log("hey there");\n'); await r.commit('a source change');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target, v.reason, v.predicate], ['run', 'DEMO-001', 'the fix of gate is recorded and no current receipt carries a result for DEMO-001', PREDICATES.run], JSON.stringify(v));
  await check(r.cwd, 'DEMO-001');
  assert.equal((await wake(r.cwd)).verdict, 'Done');   // no second `sudus fix`
  // A check that fails says the fix no longer holds: that is the defect, not a check to run.
  await r.write('flags/DEMO-001', 'fail\n'); await r.commit('the defect returns');
  await check(r.cwd, 'DEMO-001');
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target, v.reason], ['fix', 'gate', 'DEMO-001 has no current pass at or after the fix'], JSON.stringify(v));
});
test('under a commitment that owns the requirement, a stale pass after a recorded fix is the run predicate\'s, which waits on an open finding (issue #64)', async () => {
  const { authorize } = await import('../lib/auth.mjs');
  const { check } = await import('../lib/check.mjs');
  const r = await fixedBetweenCommitments();
  const roadmap = await readFile(join(r.cwd, 'docs/spec/roadmap.md'), 'utf8');
  await r.write('docs/spec/roadmap.md', roadmap.replace('Current: first', 'Current: second') + '\n## second\n\nRequirements: DEMO-001 DEMO-002\n\nMore demo.\n'); await r.commit('second');
  await authorize(r.cwd, { quote: 'ok', env: {} });
  await start(r.cwd, 'second');
  await check(r.cwd, 'DEMO-001'); await check(r.cwd, 'DEMO-002');
  await r.review(); const rep = await r.report([{ n: 1, text: 'a finding' }]);
  await r.write('src/demo.mjs', 'console.log("hey again");\n'); await r.commit('work on the finding');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['resolve', 'second 1'], JSON.stringify(v));   // the checks run once, after the last finding
  await r.resolveFinding(rep, 1);
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target, v.reason], ['run', 'DEMO-001', 'no current receipt carries a result for DEMO-001'], JSON.stringify(v));
});
// Report of 2026-09-23 (a consumer project, 3.0.3): an Agreed requirement's text was revised under
// the open commitment. Receipts and the mechanism review bound to the revised text, wake's review
// predicate and the Done rule held the frozen digest, and wake named `review mechanism` after
// every review. The frozen contract is not amended (invariant 49): wake names the exit.
test('Agreed text revised under an open commitment is supersede, not review mechanism forever', async () => {
  const { check } = await import('../lib/check.mjs');
  const { reviewMechanism } = await import('../lib/mechanisms.mjs');
  const { authorize } = await import('../lib/auth.mjs');
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  const spec = await readFile(join(r.cwd, 'docs/spec/demo.md'), 'utf8');
  await r.write('docs/spec/demo.md', spec.replace('prints hello for DEMO-001.', 'prints hello for DEMO-001 within 1 ms.'));
  await r.commit('raise the bound under the open commitment');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['supersede', 'first'], JSON.stringify(v));
  assert.match(v.reason, /the Agreed text of DEMO-001 changed under first .*restore the text the start froze, or with the developer's ruling supersede first/);
  // Re-checking and re-reviewing against the revised text does not change the verdict.
  await r.write('flags/DEMO-001', 'fail\n'); await r.commit('flag fail');
  await reviewMechanism(r.cwd, 'demo-001', 'DEMO-001', await check(r.cwd, 'DEMO-001'));
  await r.write('flags/DEMO-001', 'pass\n'); await r.commit('flag pass');
  await check(r.cwd, 'DEMO-001');
  assert.equal((await wake(r.cwd)).action, 'supersede');
  // Restoring the frozen text is one exit: one review against the frozen text, and the loop moves on.
  await r.write('docs/spec/demo.md', spec); await r.commit('restore the frozen text');
  v = await wake(r.cwd);
  assert.notEqual(v.action, 'supersede', JSON.stringify(v));
  await r.write('flags/DEMO-001', 'fail\n'); await r.commit('flag fail again');
  await reviewMechanism(r.cwd, 'demo-001', 'DEMO-001', await check(r.cwd, 'DEMO-001'));
  await r.write('flags/DEMO-001', 'pass\n'); await r.commit('flag pass again');
  await check(r.cwd, 'DEMO-001');
  v = await wake(r.cwd);
  assert.ok(!['supersede', 'review mechanism'].includes(v.action), JSON.stringify(v));
  // Superseding with the developer's ruling is the other.
  await r.write('docs/spec/demo.md', spec.replace('prints hello for DEMO-001.', 'prints hello for DEMO-001 within 1 ms.'));
  await r.commit('raise the bound again');
  await authorize(r.cwd, { quote: 'ok', env: {} });
  await supersede(r.cwd, 'second', { quote: 'raise the bound to 1 ms now', env: {} });
  assert.deepEqual(await wake(r.cwd), { exit: 3, line: 'sudus: pending supersession to second; run /existing-project' });
});

// A consumer project with 23 requirements and up to 31 receipts each spent 30 s in one wake:
// every receipt currentReceipt tried recomputed the mechanism's input tree and ran every tool
// version probe again (313 readings, 626 probes through rustup). The reading is taken once per
// mechanism definition per wake, however many receipts are stale.
test('wake reads a mechanism input tree and probes its tools once, however many stale receipts it walks', async () => {
  const r = await loopRepo();
  const probes = join(await mkdtemp(join(tmpdir(), 'sudus-probes-')), 'count');
  const probe = `node -e "require('fs').appendFileSync('${probes}', 'x'); console.log('probe 1')"`;
  await declare(r.cwd, 'demo-001', { ...mechanismFor('DEMO-001'), identity: { tools: { probe }, env: [], image: null } });
  await r.commit('declare the probe');
  for (const flag of ['fail', 'pass', 'fail']) { await r.write('flags/DEMO-001', `${flag}\n`); await r.commit(flag); await check(r.cwd, 'DEMO-001'); }
  await r.write('flags/DEMO-001', 'changed\n'); await r.commit('no receipt is current now');
  await writeFile(probes, '');
  const st = await readState(r.cwd);
  assert.equal(st.current['DEMO-001'], null);
  assert.equal(await readFile(probes, 'utf8'), 'x', 'one probe for three stale receipts');
});

// Spec revision 10, part A (the developer: "I will accept your recommendation", 2026-09-23): a
// fix for a finding makes receipts stale, and naming a full check run before every next
// resolution cost an agent twenty runs for twenty findings. While the latest report has an
// unresolved finding, a stale receipt waits; a current receipt that fails does not.
test('while a report has an unresolved finding, wake names resolve before a stale run, and run once the last finding is resolved', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  await r.review();
  const rep = await r.report([{ n: 1, text: 'the greeting ignores a blank name' }, { n: 2, text: 'no test for a long name' }]);
  await r.write('src/demo.mjs', 'console.log("hello, world");\n'); await r.commit('fix finding 1');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['resolve', `${r.slug} 1`], JSON.stringify(v));
  await r.resolveFinding(rep, 1);
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['resolve', `${r.slug} 2`], JSON.stringify(v));
  await r.resolveFinding(rep, 2);
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['run', 'DEMO-001'], JSON.stringify(v));
  await check(r.cwd, 'DEMO-001');
  assert.equal((await wake(r.cwd)).action, 'done');
});

test('a current receipt that fails is named at once even while findings are unresolved', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  await r.review();
  await r.report([{ n: 1, text: 'a finding' }]);
  await r.failReq('DEMO-001');
  const v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['implement', 'DEMO-001'], JSON.stringify(v));
});

// Spec revision 10, part B: a redeclare that only adds inputs or tool probes left every review
// unbound, and rebinding cost an agent nine commits. A review binds to what decides detection:
// the command, the working directory and the results mode.
test('a redeclare that adds an input or a tool probe keeps the mechanism review bound; a changed command unbinds it', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001');
  await r.write('src/extra.mjs', 'export const extra = 1;\n'); await r.commit('an input the check reads');
  const def = mechanismFor('DEMO-001');
  await declare(r.cwd, 'demo-001', { ...def, inputs: [...def.inputs, 'src/extra.mjs'], identity: { tools: { node: 'node --version' }, env: [], image: null } });
  await r.commit('declare the input and the tool');
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['run', 'DEMO-001'], JSON.stringify(v));
  await check(r.cwd, 'DEMO-001');
  assert.notEqual((await wake(r.cwd)).action, 'review mechanism');
  await declare(r.cwd, 'demo-001', { ...def, command: `${def.command} && true` });
  await r.commit('change the command');
  v = await wake(r.cwd);
  assert.equal(v.action, 'run', JSON.stringify(v));
  await check(r.cwd, 'DEMO-001');
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['review mechanism', 'DEMO-001'], JSON.stringify(v));
});

// Issue #24: a backlog item another commitment already delivered left the backlog only by
// promotion, a commitment and review that changed nothing. The developer's ok on an escalation
// naming retire:<item> retires it; an ok on a capture escalation (item:<item>) does not.
import { escalate, answer } from '../lib/escalate.mjs';
import { promote } from '../lib/commitment.mjs';

const retireDraft = (item, over = {}) => ({ commitment: 'first', concerns: [`retire:${item}`], question: 'Retire nicer-greeting?', recommendation: 'Retire it: the defect fix already delivered it.', because: 'the greeting fix landed under this commitment', if_wrong: 'the nicer greeting is never built', instead: 'promote it', options: [], named_paths: [], cited_decisions: [], ...over });

test('after Done, the ok on a retire escalation takes a backlog item out of the backlog', async () => {
  const r = await finished();
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  const item = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  const e = await escalate(r.cwd, retireDraft(item));
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting');
  assert.deepEqual(v.escalation.closes, ['backlog item nicer-greeting']);
  await answer(r.cwd, 'first', 'ok', { quote: 'ok, retire it', env: {} });
  await r.commit('the answered line');
  assert.equal((await wake(r.cwd)).verdict, 'Done');
  await assert.rejects(promote(r.cwd, item), { message: `item nicer-greeting was retired by the developer's ok on escalation ${e}` });
  let out = '';
  assert.equal(await main(['show', 'items'], { cwd: r.cwd, stdout: { write: (s) => { out += s; } } }), 0);
  assert.equal(out, `${item} backlog nicer-greeting from DEMO-001 retired by ${e}: an idea\n`);
  await assert.rejects(escalate(r.cwd, retireDraft(item)), { message: `sudus: item nicer-greeting was retired by the developer's ok on escalation ${e}` });
});

test('an instead answer on a retire escalation keeps the item in the backlog', async () => {
  const r = await finished();
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  const item = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  await escalate(r.cwd, retireDraft(item));
  await answer(r.cwd, 'first', 'instead', { quote: 'no, build it', env: {} });
  await r.commit('the answered line');
  const v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'promote', 'nicer-greeting']);
});

test('only a backlog item that waits is retired, and only a retire concern may name a finished commitment', async () => {
  const r = await finished();
  const idea = await r.item('next-feature', 'DEMO-001', 'colour');
  await assert.rejects(escalate(r.cwd, retireDraft(idea)), { message: 'sudus: item colour is a next-feature item; only a backlog item is retired by escalation; when the developer drops it, record their words with sudus retire colour --quote "<their words>"' });
  await assert.rejects(escalate(r.cwd, retireDraft('a'.repeat(40))), { message: `sudus: no item record ${'a'.repeat(40)}` });
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  const item = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  await assert.rejects(escalate(r.cwd, retireDraft(item, { commitment: 'other' })), { message: 'sudus: other is not the latest commitment' });
  await assert.rejects(escalate(r.cwd, retireDraft(item, { concerns: [`retire:${item}`, 'DEMO-001'] })), { message: 'sudus: no open commitment first' });
  await r.add('promotion', 'nicer-greeting', { item, decision: ulid(), intent: null, results: [] });
  await assert.rejects(escalate(r.cwd, retireDraft(item)), { message: 'sudus: item nicer-greeting was promoted; it is not retired' });
});

test('the ok on a capture escalation naming an item leaves it in the backlog', async () => {
  const r = await finished();
  const item = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  const e = await r.escalate(`item:${item}`);
  await r.answer(e, 'ok');
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  const v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'promote', 'nicer-greeting']);
});

// Issue #34 (spec revision 17): nothing closed a next-feature item, so every later next-feature
// pass offered it again, and a backlog item the developer had already dropped needed a second
// prompt. `sudus retire` records the developer's words once for every item they named.
import { retire } from '../lib/commitment.mjs';

test("the developer's words retire next-feature and backlog items at once (issue #34)", async () => {
  const r = await finished();
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  const idea = await r.item('next-feature', 'contract', 'colour');
  const item = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  const v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'promote', 'nicer-greeting']);
  let out = '', err = '';
  const io = { cwd: r.cwd, env: {}, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } };
  assert.equal(await main(['retire', 'colour', 'nicer-greeting', '--quote', 'skip these'], io), 0, err);
  const sha = /^retire ([0-9a-f]{40}) colour nicer-greeting\n$/.exec(out)?.[1];
  assert.ok(sha, out);
  const rec = (await r.log()).find((x) => x.sha === sha);
  assert.equal(rec.kind, 'retirement');
  assert.deepEqual(rec.payload.items, [idea, item]);
  assert.deepEqual([rec.payload.evidence.mode, rec.payload.evidence.purpose, rec.payload.evidence.quote], ['attested', 'retire', 'skip these']);
  assert.equal((await wake(r.cwd)).verdict, 'Done');
  out = '';
  assert.equal(await main(['show', 'items'], io), 0);
  assert.equal(out, `${idea} next-feature colour from contract retired by ${sha}: an idea\n${item} backlog nicer-greeting from DEMO-001 retired by ${sha}: an idea\n`);
  const how = `was retired by the developer's words in retirement ${sha}`;
  await assert.rejects(promote(r.cwd, item), { message: `item nicer-greeting ${how}` });
  await assert.rejects(escalate(r.cwd, retireDraft(item)), { message: `sudus: item nicer-greeting ${how}` });
  await assert.rejects(retire(r.cwd, ['colour'], { quote: 'skip it', env: {} }), { message: `item colour ${how}` });
});

test('retire refuses a defect, a promoted item, a repeat, an unknown item and missing words, and writes nothing', async () => {
  const r = await finished();
  const idea = await r.item('next-feature', 'contract', 'colour');
  await r.item('defect', 'DEMO-001', 'crash');
  const item = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  await r.add('promotion', 'nicer-greeting', { item, decision: ulid(), intent: null, results: [] });
  const before = (await r.log()).length;
  const words = { quote: 'skip it', env: {} };
  await assert.rejects(retire(r.cwd, [], words), { message: 'retire needs one or more item slugs or shas' });
  await assert.rejects(retire(r.cwd, ['colour'], { env: {} }), { message: 'retire needs the developer\'s words: --quote "<text>"' });
  await assert.rejects(retire(r.cwd, ['colour', 'crash'], words), { message: 'item crash is a defect; a defect is fixed, not retired' });
  await assert.rejects(retire(r.cwd, ['colour', 'nicer-greeting'], words), { message: 'item nicer-greeting was promoted; it is not retired' });
  await assert.rejects(retire(r.cwd, ['colour', idea], words), { message: 'item colour is named twice' });
  await assert.rejects(retire(r.cwd, ['nope'], words), { message: 'nope is not an item record or item slug; sudus show items lists them' });
  assert.equal((await r.log()).length, before);
  let err = '';
  const io = { cwd: r.cwd, env: {}, stdout: { write: () => {} }, stderr: { write: (s) => { err += s; } } };
  assert.notEqual(await main(['retire', '--quote', 'skip it'], io), 0);
  assert.match(err, /retire needs one or more item slugs or shas/);
  assert.notEqual(await main(['retire', 'colour', '--quote', 'skip it', '--bogus'], io), 0);
  assert.equal((await r.log()).length, before);
});

// Issue #28 (spec revision 15): attempts at a requirement count from its turn. Before, the refresh
// runs wake named for other requirements' changes, each failing on DEMO-004's untouched
// violation, counted as attempts, and wake named escalate for a requirement no one had worked on.
import { attemptState as attemptsAt } from '../lib/check.mjs';
import { render as renderVerdict } from '../lib/wake.mjs';

test("a refresh run wake named for other requirements' changes is not an attempt at a requirement no one has worked on", async () => {
  const r = await loopRepo({ reqs: ['DEMO-001', 'DEMO-002', 'DEMO-003', 'DEMO-004'] });
  await r.failReq('DEMO-004');   // its violation is checked once, then waits its turn
  const passed = [];
  for (const q of ['DEMO-001', 'DEMO-002', 'DEMO-003']) {
    await r.passReq(q);
    passed.push(q);
    await r.write('src/demo.mjs', `console.log("hello ${passed.length}");\n`); await r.commit(`implement ${q}`);   // the shared input changed
    for (const p of passed) await check(r.cwd, p);   // the refresh runs wake would name
  }
  let v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['run', 'DEMO-004'], 'the shared input changed under DEMO-004');
  await check(r.cwd, 'DEMO-004');   // fails on the untouched violation
  assert.equal(attemptsAt(await r.log(), 'DEMO-004').tried, 0, 'no attempt at DEMO-004 has been made');
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['implement', 'DEMO-004']);
  for (const i of [1, 2]) {
    await r.write('src/demo.mjs', `console.log("try ${i}");\n`); await r.commit(`attempt ${i} at DEMO-004`);
    for (const p of passed) await check(r.cwd, p);
    await check(r.cwd, 'DEMO-004');
  }
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['implement', 'DEMO-004'], 'two attempts failed; a third is allowed');
  await r.write('src/demo.mjs', 'console.log("try 3");\n'); await r.commit('attempt 3 at DEMO-004');
  for (const p of passed) await check(r.cwd, p);
  await check(r.cwd, 'DEMO-004');
  v = await wake(r.cwd);
  assert.deepEqual([v.action, v.target], ['escalate', 'DEMO-004']);
});

// Issue #29 (spec revision 15): after Done, the developer's ok on an escalation naming
// wait:<item> lets wake say Done while the backlog item waits, so the next feature goes ahead of
// it. The item stays in the backlog, Done lists it, show items marks it, and after the next Done
// wake names its promotion again.
const waitDraft = (items, over = {}) => ({ commitment: 'first', concerns: items.map((i) => `wait:${i}`), question: 'Start the next feature before the waiting items?', recommendation: 'Yes: the feature first, the items after its Done.', because: 'the developer ranks the feature above them', if_wrong: 'the items wait one more commitment', instead: 'promote the oldest item first', options: [], named_paths: [], cited_decisions: [], ...over });

test('after Done, the ok on a wait escalation lets wake say Done while the backlog items wait, listed and still shown', async () => {
  const r = await finished();
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  const a = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  const b = await r.item('backlog', 'DEMO-001', 'louder-greeting');
  const e = await escalate(r.cwd, waitDraft([a, b]));
  let v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting');
  assert.deepEqual(v.escalation.closes, ['backlog item nicer-greeting waits until the next Done', 'backlog item louder-greeting waits until the next Done']);
  await answer(r.cwd, 'first', 'ok', { quote: 'ok, the feature first', env: {} });
  await r.commit('the answered line');
  v = await wake(r.cwd);
  assert.equal(v.verdict, 'Done');
  assert.deepEqual(v.waits, [{ slug: 'nicer-greeting', item: a, escalation: e }, { slug: 'louder-greeting', item: b, escalation: e }]);
  assert.equal(v.reason, "done record closes first; 2 backlog items wait until the next Done by the developer's ok");
  assert.match(renderVerdict(v), new RegExp(`\\nwaits: nicer-greeting \\(escalation ${e.slice(0, 12)}\\), louder-greeting \\(escalation ${e.slice(0, 12)}\\); wake names their promotion after the next Done\\npredicate: `));
  let out = '';
  assert.equal(await main(['show', 'items'], { cwd: r.cwd, stdout: { write: (s) => { out += s; } } }), 0);
  assert.equal(out, `${a} backlog nicer-greeting from DEMO-001 waits until the next Done by ${e}: an idea\n${b} backlog louder-greeting from DEMO-001 waits until the next Done by ${e}: an idea\n`);
  await assert.rejects(escalate(r.cwd, waitDraft([a])), { message: `sudus: item nicer-greeting already waits until the next Done by the developer's ok on escalation ${e}` });
  await r.item('backlog', 'DEMO-001', 'later-idea');
  v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'promote', 'later-idea'], 'an item captured after the ok is not covered by it');
});

test('the wait lapses at the next Done: wake names the promotion again', async () => {
  const r = await finished();
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  const a = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  await escalate(r.cwd, waitDraft([a]));
  await answer(r.cwd, 'first', 'ok', { quote: 'ok', env: {} });
  await r.commit('the answered line');
  assert.equal((await wake(r.cwd)).verdict, 'Done');
  await r.write('docs/spec/roadmap.md', 'Current: second\n\n## first\n\nRequirements: DEMO-001\n\nDelivers the demo.\n\n## second\n\nRequirements: DEMO-001\n\nThe feature.\n');
  await r.commit('the next feature');
  const { requirements } = (await r.log()).find((x) => x.sha === r.startSha).payload;
  await r.add('start', 'second', { slug: 'second', snapshot: await r.snap(), from_superseded: null, intent: null, results: [], requirements });
  await r.add('done', 'second', { slug: 'second', snapshot: await r.snap() });
  const v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'promote', 'nicer-greeting']);
});

test('an instead answer on a wait escalation keeps the promotion named, and only a waiting backlog item may wait', async () => {
  const r = await finished();
  const idea = await r.item('next-feature', 'DEMO-001', 'colour');
  await assert.rejects(escalate(r.cwd, waitDraft([idea])), { message: 'sudus: item colour is a next-feature item; only a backlog item waits' });
  const early = await r.item('backlog', 'DEMO-001', 'early-idea');
  await assert.rejects(escalate(r.cwd, waitDraft([early])), { message: 'sudus: item early-idea waits after Done; first is open' });
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  const a = await r.item('backlog', 'DEMO-001', 'nicer-greeting');
  await escalate(r.cwd, waitDraft([a]));
  await answer(r.cwd, 'first', 'instead', { quote: 'no, the item first', env: {} });
  await r.commit('the answered line');
  const v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'promote', 'early-idea'], 'nothing waits: the oldest backlog item is named');
  const e = await escalate(r.cwd, retireDraft(a));
  await answer(r.cwd, 'first', 'ok', { quote: 'retire it', env: {} });
  await r.commit('the answered line');
  await assert.rejects(escalate(r.cwd, waitDraft([a])), { message: `sudus: item nicer-greeting was retired by the developer's ok on escalation ${e}` });
});

// Issue #31: after a redeclare that only added a requirement, wake named review mechanism with the
// latest fail receipt, which review mechanism refused on the whole definition digest. The receipt
// binds now, since its command, working directory and results mode are the current ones; and when
// no fail receipt ran under them, wake says a new violating example is needed instead of naming one.
import { parseDomainFile as parseDomain } from '../lib/spec.mjs';
import { writeWorkspaceSnapshot as snapshotNow } from '../lib/snapshots.mjs';
import { reviewMechanism as bindReview } from '../lib/mechanisms.mjs';
import { appendRecord as appendLogRecord } from '../lib/records.mjs';

test('wake names a fail receipt from before a redeclare that kept the command, and review mechanism binds it', async () => {
  const { cwd, write, commit } = await makeProject({ settings: { outside: ['README.md'], source: ['src/**'] } });
  const reqs = ['A-001', 'A-002', 'A-003'];
  const line = (q) => `process.stdout.write('sudus: ${q}: '+require('fs').readFileSync('flags/${q}','utf8').trim()+'\\n');`;
  const mech = (rs, command = `node -e "${reqs.map(line).join('')}"`) => ({ command, inputs: ['src/demo.mjs', 'flags'], documents: [], requirements: rs, results: 'per-requirement', identity: {} });
  await write('docs/spec/overview.md', '# Demo\n\nA demo program.\n\n| Domain | Prefix | File |\n|---|---|---|\n| a | A | a.md |\n');
  await write('docs/spec/glossary.md', '# Glossary\n\n- demo: the sample program.\n');
  await write('docs/spec/roadmap.md', `Current: first\n\n## first\n\nRequirements: ${reqs.join(' ')}\n\nDelivers the demo.\n`);
  await write('docs/spec/a.md', 'Prefix: A\n\n' + reqs.map((q) => `[${q}] The demo prints hello for ${q}.\nFalsifier: the flag file for ${q} says fail.\nMechanism: m\nStatus: Agreed 2026-09-19\n`).join('\n'));
  await write('README.md', '# demo\n'); await write('src/demo.mjs', 'console.log("hello");\n');
  for (const q of reqs) await write(`flags/${q}`, 'fail\n');
  await commit('Demo project');
  await declare(cwd, 'm', mech(['A-001', 'A-002'])); await commit('declare m');
  const old = await check(cwd, 'A-001');
  await bindReview(cwd, 'm', 'A-001', old); await commit('A-001 reviewed');
  await declare(cwd, 'm', mech(reqs)); await commit('add A-003, same command');
  const fail3 = await check(cwd, 'A-003');
  await bindReview(cwd, 'm', 'A-003', fail3); await commit('A-003 reviewed');
  const { blocks } = parseDomain(await readFile(join(cwd, 'docs/spec/a.md'), 'utf8'));
  await appendLogRecord(cwd, 'start', 'first', { slug: 'first', snapshot: await snapshotNow(cwd), from_superseded: null, intent: null, results: [], requirements: blocks.map((b) => ({ requirement: b.id, text_digest: b.textDigest })) });
  for (const q of reqs) await write(`flags/${q}`, 'pass\n');
  await commit('implement all three');
  await check(cwd, 'A-001');
  let v = await wake(cwd);
  assert.deepEqual([v.action, v.target], ['review mechanism', 'A-002']);
  assert.match(v.reason, new RegExp(`; its latest fail receipt is ${fail3}$`), 'the latest usable fail receipt: A-003\'s binding check also failed A-002');
  let out = '', err = '';
  assert.equal(await main(['review', 'mechanism', 'A-002'], { cwd, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } }), 0, err);
  await commit('A-002 reviewed');
  assert.notEqual((await wake(cwd)).action, 'review mechanism');
  await declare(cwd, 'm', mech(reqs, `node -e "${reqs.map(line).join('')}void 0;"`)); await commit('another command, the same output');
  await check(cwd, 'A-001');
  v = await wake(cwd);
  assert.deepEqual([v.action, v.target], ['review mechanism', 'A-001']);
  assert.match(v.reason, /; no fail receipt for A-001 ran under the current command, working directory, results mode and text: make its violating example fail, run sudus check A-001, then review mechanism A-001 with that receipt$/);
  err = '';
  assert.equal(await main(['review', 'mechanism', 'A-001'], { cwd, stdout: { write: () => {} }, stderr: { write: (s) => { err += s; } } }), 1);
  assert.match(err, /^sudus: no fail receipt for A-001 ran under the current command, working directory, results mode and text; make its violating example fail/);
});

// Issue #57: progressSummary counts open findings, open escalations and unfixed defects on every
// wake. Each finding, escalation and defect scanned the log, so the work grew with them times the
// log. Reads of each record's kind and sha are counted at k and 2k of each: one pass per check
// doubles them, a scan per finding quadruples them.
test('progressSummary reads the log in proportion to its length, not its findings and escalations times its length', async () => {
  const { progressSummary } = await import('../lib/wake.mjs');
  const { range } = await import('../lib/records.mjs');
  let reads = 0;
  const hex = (n) => n.toString(16).padStart(40, '0');
  const rec = (sha, kind, payload) => ({ get sha() { reads++; return sha; }, get kind() { reads++; return kind; }, target: '-', payload });
  // Each round: a review with two findings, the first resolved and the second named by an
  // escalation answered ok (odd rounds) or left unanswered (even rounds); a defect item, fixed in
  // odd rounds.
  const build = (k) => {
    const log = [rec(hex(1), 'start', { slug: 'first', requirements: [], from_superseded: null })];
    for (let i = 0; i < k; i++) {
      const rev = hex(100 * i + 2), esc = hex(100 * i + 3), def = hex(100 * i + 4);
      log.push(rec(rev, 'review', { slug: 'first', findings: [{ n: 1, text: 'one' }, { n: 2, text: 'two' }] }));
      log.push(rec(hex(100 * i + 5), 'resolution', { source: rev, finding: 1 }));
      log.push(rec(esc, 'escalation', { slug: 'first', concerns: `finding:${rev}#2` }));
      if (i % 2) log.push(rec(hex(100 * i + 6), 'answer', { escalation: esc, kind: 'ok' }));
      log.push(rec(def, 'item', { kind: 'defect', slug: `bug-${i}`, source: 'DEMO-001' }));
      if (i % 2) log.push(rec(hex(100 * i + 7), 'fix', { item: def }));
    }
    return log;
  };
  const count = (log) => {
    const r = range(log);
    const st = { log, range: r, start: r.start, records: r.records, closed: r.closed, set: [], current: {}, slug: 'first' };
    reads = 0;
    const summary = progressSummary(st);
    return { reads, summary };
  };
  const small = count(build(100)), large = count(build(200));
  assert.ok(large.reads < 3 * small.reads, `${small.reads} reads at 100 rounds, ${large.reads} at 200`);
  // Every finding is resolved or held by its escalation; 50 escalations and 50 defects stay open.
  assert.equal(small.summary.obligations, 100);
  assert.equal(small.summary.answered, 50);
});

// Issue #57 review: the fix predicate judged each defect's fix with its own scans of the log (its
// last fix, its base, its position), and the Waiting verdict looked up each record its escalation
// names with a scan. Reads of kind and sha are counted at k and 2k defects and concerns.
test('the fix predicate and the Waiting verdict read the log in proportion to its length', async () => {
  const { predicates } = await import('../lib/wake.mjs');
  let reads = 0;
  const hex = (n) => n.toString(16).padStart(40, '0');
  const rec = (sha, kind, payload) => ({ get sha() { reads++; return sha; }, get kind() { reads++; return kind; }, target: 'first', payload });
  const fixPredicate = predicates.find((p) => p.name === 'fix'), waiting = predicates.find((p) => p.name === 'waiting');
  const digest = 'sha256:' + '0'.repeat(64);
  // Between commitments: k defects, each fixed, then a pass for their requirement.
  const defects = (k) => {
    const log = [rec(hex(1), 'start', { slug: 'first', snapshot: hex(500000), requirements: [], from_superseded: null, intent: null, results: [] }),
      rec(hex(2), 'done', { slug: 'first', snapshot: hex(500000) })];
    for (let i = 0; i < k; i++) log.push(rec(hex(10 * i + 3), 'item', { kind: 'defect', slug: `bug-${i}`, source: 'DEMO-001', body: 'bug' }),
      rec(hex(10 * i + 4), 'fix', { item: hex(10 * i + 3), snapshot: hex(500000) }));
    log.push(rec(hex(500001), 'receipt', { mechanism: 'demo', definition_digest: digest, input: hex(500000), product_digest: digest, status: 'ran', identity: {},
      results: [{ requirement: 'DEMO-001', text_digest: digest, result: 'pass' }], output: digest, exit: { code: 0, signal: null } }));
    return log;
  };
  const fixReads = async (k) => {
    const st = { log: defects(k), closed: true, set: [], current: { 'DEMO-001': { sha: hex(500001), result: 'pass' } } };
    reads = 0;
    assert.equal(await fixPredicate.test(st), null, 'every defect has a fix and a later pass');
    return reads;
  };
  const f100 = await fixReads(100), f200 = await fixReads(200);
  assert.ok(f200 < 3 * f100, `fix predicate: ${f100} reads at 100 defects, ${f200} at 200`);
  // One open escalation naming k backlog items to retire.
  const named = (k) => {
    const log = Array.from({ length: k }, (_, i) => rec(hex(i + 1), 'item', { kind: 'backlog', slug: `later-${i}`, source: 'DEMO-001', body: 'idea' }));
    log.push(rec(hex(k + 1), 'escalation', { slug: 'first', question: 'q', recommendation: 'r', because: 'b', if_wrong: 'i', instead: 's', evaluation: null,
      concerns: Array.from({ length: k }, (_, i) => `retire:${hex(i + 1)}`).join(' ') }));
    return log;
  };
  const waitReads = async (k) => {
    const st = { log: named(k), settings: { developer: 'present' } };
    reads = 0;
    const v = await waiting.test(st);
    assert.equal(v.escalation.closes.length, k);
    assert.equal(v.escalation.closes[k - 1], `backlog item later-${k - 1}`);
    return reads;
  };
  const w100 = await waitReads(100), w200 = await waitReads(200);
  assert.ok(w200 < 3 * w100, `Waiting: ${w100} reads at 100 concerns, ${w200} at 200`);
});
