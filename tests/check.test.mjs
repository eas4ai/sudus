// tests/check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectMechanism, observeIdentity, runCommand, CheckError } from '../lib/check.mjs';
import { declare } from '../lib/mechanisms.mjs';
import { project, declared, DEFINITION } from './helpers/mechanism-fixture.mjs';

test('selectMechanism finds the one declaration naming the requirement', async () => {
  const repo = await declared();
  const { name } = await selectMechanism(repo.cwd, 'DEMO-001');
  assert.equal(name, 'greeter');
  await assert.rejects(selectMechanism(repo.cwd, 'DEMO-009'), (e) => e instanceof CheckError && /no mechanism declares DEMO-009/.test(e.message));
  await declare(repo.cwd, 'greeter-two', DEFINITION);
  await assert.rejects(selectMechanism(repo.cwd, 'DEMO-001'), /two mechanisms declare DEMO-001: greeter, greeter-two/);
});

test('observeIdentity reads only declared names and records absence as null', async () => {
  const repo = await declared();
  delete process.env.SUDUS_FIXTURE_ENV;
  const a = await observeIdentity(repo.cwd, DEFINITION.identity);
  assert.deepEqual(a, { tools: { node: process.version }, env: { SUDUS_FIXTURE_ENV: null }, image: null });
  process.env.SUDUS_FIXTURE_ENV = 'one';
  const b = await observeIdentity(repo.cwd, DEFINITION.identity);
  assert.equal(b.env.SUDUS_FIXTURE_ENV, 'one');
  assert.equal(Object.keys(b.env).length, 1);
  const c = await observeIdentity(repo.cwd, { tools: { missing: 'no-such-tool-xyz --version' }, env: [], image: 'img:1' });
  assert.deepEqual(c, { tools: { missing: null }, env: {}, image: 'img:1' });
});

// Issue #70: under the Codex sandbox a Node probe such as `npm --version` writing to the socket
// pair Node's spawn gives it printed nothing, so wake read another identity than check had
// recorded. A probe writes into a pipe; its exit status still decides, and stderr still counts.
test('an identity probe writes into a pipe, keeps its exit status, and reads stderr (issue #70)', async () => {
  const repo = await project();
  const r = await observeIdentity(repo.cwd, { tools: {
    stdout: '[ -p /dev/stdout ] && echo pipe || echo socket',
    stderr: '[ -p /dev/stderr ] && echo pipe >&2 || echo socket >&2',
    both: 'echo out; echo err >&2',
    node: `node -e "console.log('v-from-node')"`,
    fails: 'echo nope; exit 3',
  }, env: [], image: null });
  assert.deepEqual(r.tools, { both: 'out\nerr', fails: null, node: 'v-from-node', stderr: 'pipe', stdout: 'pipe' });
});

test('runCommand captures combined output, exit code and signal', async () => {
  const repo = await project();
  const ok = await runCommand(repo.cwd, 'printf a; printf b >&2; exit 3');
  assert.deepEqual([ok.spawned, ok.out.toString(), ok.code, ok.signal], [true, 'ab', 3, null]);
  const killed = await runCommand(repo.cwd, 'kill -TERM $$');
  assert.deepEqual([killed.spawned, killed.code, killed.signal], [true, null, 'SIGTERM']);
  const nodir = await runCommand(repo.cwd + '/does-not-exist', 'true');
  assert.equal(nodir.spawned, false);
});

import { readFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { check, productDigest, outputPresent, OUTPUT_DIR } from '../lib/check.mjs';
import { readLog, decodeRecord } from '../lib/records.mjs';
import { readSnapshot } from '../lib/snapshots.mjs';
import { catCommit } from '../lib/gitx.mjs';
import { readMechanisms } from '../lib/mechanisms.mjs';
import { sha256 } from '../lib/canon.mjs';

async function lastReceipt(cwd) { const log = await readLog(cwd); return log.filter((r) => r.kind === 'receipt').at(-1); }

test('check writes an input snapshot, an output file named by digest, and a receipt', async () => {
  const repo = await declared();
  const sha = await check(repo.cwd, 'DEMO-001');
  const rec = await lastReceipt(repo.cwd);
  assert.equal(rec.sha, sha);
  assert.equal(rec.target, 'greeter');
  const p = rec.payload;
  assert.deepEqual(Object.keys(p).sort(), ['definition_digest', 'exit', 'identity', 'input', 'mechanism', 'output', 'product_digest', 'results', 'status']);
  assert.equal(p.status, 'ran');
  assert.deepEqual(p.exit, { code: 0, signal: null });
  assert.equal(p.definition_digest, (await readMechanisms(repo.cwd)).greeter.definitionDigest);
  const snap = await readSnapshot(repo.cwd, p.input, 'input');
  assert.equal(snap.kind, 'input');
  // Fix round 1 finding 8: only Agreed blocks are digested and checked, so the mechanism's
  // Draft requirement (DEMO-002) never appears in results at all.
  assert.deepEqual(p.results.map((r) => [r.requirement, r.result]), [['DEMO-001', 'pass']]);
  assert.match(p.results[0].text_digest, /^sha256:/);
  const bytes = await readFile(join(repo.cwd, OUTPUT_DIR, p.output.slice(7)));
  assert.equal(bytes.toString(), 'sudus: DEMO-001: pass\n');
  assert.equal(p.output, sha256(bytes));
  assert.equal(await outputPresent(repo.cwd, rec), true);
  assert.equal(decodeRecord(await catCommit(repo.cwd, sha)).kind, 'receipt');
  await assert.doesNotReject(access(join(repo.cwd, OUTPUT_DIR, '.gitignore')));
});

test('a violating example yields a fail receipt: ran and fail', async () => {
  const repo = await declared();
  await repo.write('hello.txt', 'bye\n');
  await check(repo.cwd, 'DEMO-001');
  const p = (await lastReceipt(repo.cwd)).payload;
  assert.equal(p.status, 'ran');
  assert.equal(p.results[0].result, 'fail');
});

test('a command that cannot start is an error receipt with every result unverified', async () => {
  const repo = await declared({ cwd: 'missing-dir' });
  await check(repo.cwd, 'DEMO-001');
  const p = (await lastReceipt(repo.cwd)).payload;
  assert.equal(p.status, 'error');
  // Fix round 1 finding 8: DEMO-002 (Draft) is omitted, not recorded 'unverified'.
  assert.deepEqual(p.results.map((r) => r.result), ['unverified']);
  assert.deepEqual(p.exit, { code: null, signal: null });
});

test('without per-requirement results the exit code decides; a killed command ran', async () => {
  const repo = await declared({ command: 'exit 2', results: null });
  await check(repo.cwd, 'DEMO-001');
  let p = (await lastReceipt(repo.cwd)).payload;
  assert.deepEqual([p.status, p.results[0].result, p.exit.code], ['ran', 'fail', 2]);
  await declare(repo.cwd, 'greeter', { ...DEFINITION, command: 'kill -KILL $$', results: null });
  await check(repo.cwd, 'DEMO-001');
  p = (await lastReceipt(repo.cwd)).payload;
  assert.deepEqual([p.status, p.results[0].result, p.exit.signal], ['ran', 'fail', 'SIGKILL']);
});

test('per-requirement lines: any fail wins, undeclared identifiers are ignored', async () => {
  const repo = await declared({ command: 'echo "sudus: DEMO-001: pass"; echo "sudus: DEMO-001: fail"; echo "sudus: DEMO-777: pass"' });
  await check(repo.cwd, 'DEMO-001');
  const p = (await lastReceipt(repo.cwd)).payload;
  // Fix round 1 finding 8: DEMO-002 (Draft) is omitted, not recorded 'unverified'.
  assert.deepEqual(p.results.map((r) => [r.requirement, r.result]), [['DEMO-001', 'fail']]);
});

test('check refuses a requirement that is not Agreed', async () => {
  const repo = await declared();
  await assert.rejects(check(repo.cwd, 'DEMO-002'), /DEMO-002 is not Agreed/);
});

test('product_digest ignores documents', async () => {
  const repo = await declared();
  await check(repo.cwd, 'DEMO-001');
  const a = (await lastReceipt(repo.cwd)).payload;
  await repo.write('notes.md', 'changed notes\n');
  await check(repo.cwd, 'DEMO-001');
  const b = (await lastReceipt(repo.cwd)).payload;
  assert.notEqual(a.input, b.input);
  assert.equal(a.product_digest, b.product_digest);
  await repo.write('hello.txt', 'hello!\n');
  await check(repo.cwd, 'DEMO-001');
  assert.notEqual((await lastReceipt(repo.cwd)).payload.product_digest, a.product_digest);
});

import { isCurrent, identitiesNow, evidence } from '../lib/check.mjs';
import { commitTree, readRef, updateRefCAS } from '../lib/gitx.mjs';

test('a fresh receipt is current, and stays current when its output file is absent', async () => {
  const repo = await declared();
  await check(repo.cwd, 'DEMO-001');
  const rec = await lastReceipt(repo.cwd);
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), true);
  await rm(join(repo.cwd, OUTPUT_DIR, rec.payload.output.slice(7)));
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), true);
  const ev = await evidence(repo.cwd, await readLog(repo.cwd), 'DEMO-001');
  assert.deepEqual([ev.current, ev.result, ev.outputPresent], [true, 'pass', false]);
});

test('identity 1: the input snapshot tree', async () => {
  const repo = await declared();
  await check(repo.cwd, 'DEMO-001');
  const rec = await lastReceipt(repo.cwd);
  await repo.write('hello.txt', 'hello there\n');
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), false);
  await repo.write('hello.txt', 'hello\n');
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), true);
});

test('identity 2: the definition digest', async () => {
  const repo = await declared();
  await check(repo.cwd, 'DEMO-001');
  const rec = await lastReceipt(repo.cwd);
  await declare(repo.cwd, 'greeter', { ...DEFINITION, command: 'node check.mjs --strict' });
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), false);
});

test('identity 3: the requirement text digest', async () => {
  const repo = await declared();
  await check(repo.cwd, 'DEMO-001');
  const rec = await lastReceipt(repo.cwd);
  const spec = await readFile(join(repo.cwd, 'docs/spec/demo.md'), 'utf8');
  await repo.write('docs/spec/demo.md', spec.replace('prints anything other than hello', 'prints anything but hello'));
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), false);
});

test('identity 4: the observed declared execution identity', async () => {
  const repo = await declared();
  delete process.env.SUDUS_FIXTURE_ENV;
  await check(repo.cwd, 'DEMO-001');
  const rec = await lastReceipt(repo.cwd);
  process.env.SUDUS_FIXTURE_ENV = 'changed';
  try { assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), false); } finally { delete process.env.SUDUS_FIXTURE_ENV; }
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), true);
});

test('identity 5: a readable schema', async () => {
  const repo = await declared();
  await check(repo.cwd, 'DEMO-001');
  const rec = await lastReceipt(repo.cwd);
  const c = await catCommit(repo.cwd, rec.sha);
  const trailers = c.trailers.map(([k, v]) => [k, k === 'Sudus-Schema' ? '2' : v]);
  const head = await readRef(repo.cwd, 'refs/sudus/log');
  const sha = await commitTree(repo.cwd, { tree: c.tree, parents: [head], subject: c.subject, body: c.body, trailers });
  await updateRefCAS(repo.cwd, 'refs/sudus/log', sha, head);
  assert.equal(await isCurrent(repo.cwd, { sha, payload: rec.payload }, 'DEMO-001'), false);
});

test('isCurrent accepts precomputed identities and refuses another requirement', async () => {
  const repo = await declared();
  await check(repo.cwd, 'DEMO-001');
  const rec = await lastReceipt(repo.cwd);
  const now = await identitiesNow(repo.cwd, 'DEMO-001');
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001', now), true);
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-002', now), false);
});

import { attempts } from '../lib/check.mjs';

test('attempts with since ignores receipts before the start record', () => {
  const receipt = (sha, digest, result) => ({ sha, kind: 'receipt', payload: { status: 'ran', product_digest: digest, results: [{ requirement: 'DEMO-001', result }] } });
  const log = [receipt('r1', 'sha256:a', 'fail'), receipt('r2', 'sha256:b', 'fail'), { sha: 'S', kind: 'start', payload: {} }, receipt('r3', 'sha256:c', 'fail')];
  assert.equal(attempts(log, 'DEMO-001'), 3);
  assert.equal(attempts(log, 'DEMO-001', { since: 'S' }), 1, 'the spec-phase binding receipts before start are not attempts');
  assert.equal(attempts(log, 'DEMO-001', { since: 'missing' }), 0);
});

test('attempts ignores a receipt in which a sibling requirement of the commitment also failed', () => {
  const receipt = (sha, digest, results) => ({ sha, kind: 'receipt', payload: { status: 'ran', product_digest: digest, results } });
  const both = (d) => [{ requirement: 'DEMO-001', result: 'fail' }, { requirement: 'DEMO-002', result: 'fail' }];
  const alone = (d) => [{ requirement: 'DEMO-001', result: 'fail' }, { requirement: 'DEMO-002', result: 'pass' }];
  const log = [receipt('r1', 'sha256:a', both()), receipt('r2', 'sha256:b', both()), receipt('r3', 'sha256:c', alone()), receipt('r4', 'sha256:d', [{ requirement: 'DEMO-001', result: 'fail' }, { requirement: 'OTHER-001', result: 'fail' }])];
  assert.equal(attempts(log, 'DEMO-001'), 4);
  assert.equal(attempts(log, 'DEMO-001', { siblings: ['DEMO-001', 'DEMO-002'] }), 2, 'the two runs where DEMO-002 also failed are not attempts; OTHER-001 is not a sibling');
});

// Issue #28 (spec revision 15): attempts count from the requirement's turn. Mechanism M checks
// DEMO-001 and DEMO-003, N checks DEMO-002; the set's order is DEMO-001, DEMO-002, DEMO-003.
test('attempts count from the turn: refresh runs before every earlier requirement passes, and the first receipt of a turn begun after the start, are not attempts', () => {
  const m = (sha, digest, one, three) => ({ sha, kind: 'receipt', payload: { status: 'ran', product_digest: digest, results: [{ requirement: 'DEMO-001', result: one }, { requirement: 'DEMO-003', result: three }] } });
  const n = (sha, digest, two) => ({ sha, kind: 'receipt', payload: { status: 'ran', product_digest: digest, results: [{ requirement: 'DEMO-002', result: two }] } });
  const S = { sha: 'S', kind: 'start', payload: {} };
  const opts = { since: 'S', siblings: ['DEMO-001', 'DEMO-002', 'DEMO-003'], before: ['DEMO-001', 'DEMO-002'] };
  const noTurn = [S, m('r1', 'sha256:a', 'pass', 'fail'), m('r2', 'sha256:b', 'pass', 'fail'), m('r3', 'sha256:c', 'pass', 'fail')];
  assert.equal(attempts(noTurn, 'DEMO-003', opts), 0, 'DEMO-002 never passed, so DEMO-003 has had no turn');
  assert.equal(attempts(noTurn, 'DEMO-003', { since: 'S' }), 3, 'without the order, the three refresh runs count');
  const turn = [S, m('r1', 'sha256:a', 'pass', 'fail'), n('r2', 'sha256:b', 'pass'), m('r3', 'sha256:c', 'pass', 'fail'), m('r4', 'sha256:d', 'pass', 'fail'), m('r5', 'sha256:e', 'fail', 'fail'), m('r6', 'sha256:f', 'pass', 'fail')];
  assert.equal(attempts(turn.slice(0, 4), 'DEMO-003', opts), 0, 'r3 is the first receipt of the turn that began at r2: its starting point');
  assert.equal(attempts(turn.slice(0, 5), 'DEMO-003', opts), 1);
  assert.equal(attempts(turn.slice(0, 6), 'DEMO-003', opts), 1, 'a receipt where a sibling also fails is still not an attempt');
  assert.equal(attempts(turn, 'DEMO-003', opts), 2);
  const already = [m('r0', 'sha256:z', 'pass', 'fail'), n('r00', 'sha256:y', 'pass'), S, m('r1', 'sha256:a', 'pass', 'fail')];
  assert.equal(attempts(already, 'DEMO-003', opts), 1, 'every earlier requirement passed before the start, so the turn began at the start and counts as before');
  assert.equal(attempts([S, m('r1', 'sha256:a', 'fail', 'pass')], 'DEMO-001', { since: 'S', siblings: opts.siblings, before: [] }), 1, 'the first requirement in order counts from the start as before');
});

// Review of revision 15: a requirement outside the open commitment's frozen set (a defect against
// an earlier commitment's requirement) is not named by wake while the commitment is open, so it
// has no turn under it. Its fails in a shared mechanism's refresh runs, made by the in-set
// requirement's work, counted as attempts, and check refused it as a fourth attempt.
import { attemptState } from '../lib/check.mjs';

test('a requirement outside the frozen set has no attempts under the open commitment', () => {
  const m = (sha, digest, one, two) => ({ sha, kind: 'receipt', payload: { status: 'ran', product_digest: digest, results: [{ requirement: 'DEMO-001', result: one }, { requirement: 'DEMO-002', result: two }] } });
  const start = { sha: 'S', kind: 'start', payload: { slug: 'second', requirements: [{ requirement: 'DEMO-002', text_digest: 'sha256:t' }] } };
  const log = [start, m('r1', 'sha256:a', 'fail', 'pass'), m('r2', 'sha256:b', 'fail', 'pass'), m('r3', 'sha256:c', 'fail', 'pass')];
  assert.deepEqual(attemptState(log, 'DEMO-001'), { tried: 0, escalated: false, needed: false });
  assert.equal(attemptState(log, 'DEMO-002').tried, 0, 'the in-set requirement passes');
  assert.equal(attemptState([start, m('r1', 'sha256:a', 'pass', 'fail'), m('r2', 'sha256:b', 'pass', 'fail'), m('r3', 'sha256:c', 'pass', 'fail')], 'DEMO-002').needed, true, 'the in-set requirement is still gated');
});

test('attempts counts distinct failing product digests since the last pass', async () => {
  const repo = await declared();
  const count = async () => attempts(await readLog(repo.cwd), 'DEMO-001');
  assert.equal(await count(), 0);
  await repo.write('hello.txt', 'bye\n');
  await check(repo.cwd, 'DEMO-001');
  assert.equal(await count(), 1);
  await check(repo.cwd, 'DEMO-001');
  assert.equal(await count(), 1, 'a rerun at a seen input snapshot is not an attempt');
  await repo.write('notes.md', 'edited notes\n');
  await check(repo.cwd, 'DEMO-001');
  assert.equal(await count(), 1, 'a change only to documents is not an attempt');
  await repo.write('hello.txt', 'nope\n');
  await check(repo.cwd, 'DEMO-001');
  assert.equal(await count(), 2);
  await repo.write('hello.txt', 'bye\n');
  await check(repo.cwd, 'DEMO-001');
  assert.equal(await count(), 2, 'a return to a tried input is not an attempt');
  await declare(repo.cwd, 'greeter', { ...DEFINITION, cwd: 'missing' });
  await check(repo.cwd, 'DEMO-001');
  assert.equal(await count(), 2, 'an error receipt is not an attempt');
  await declare(repo.cwd, 'greeter', DEFINITION);
  await repo.write('hello.txt', 'still wrong\n');
  await check(repo.cwd, 'DEMO-001');
  assert.equal(await count(), 3);
  await repo.write('hello.txt', 'hello\n');
  await check(repo.cwd, 'DEMO-001');
  assert.equal(await count(), 0, 'a pass resets the count');
});

// Fix round 1 covering tests.
import { OUTPUT_CAP } from '../lib/check.mjs';

test('finding 1: a directory input stays current after check; an ignored untracked file under it does not affect currency', async () => {
  const repo = await declared({ inputs: [...DEFINITION.inputs, 'src'] });
  await repo.write('.gitignore', 'ignored.txt\n');
  await repo.write('src/a.js', 'export const a = 1;\n');
  await check(repo.cwd, 'DEMO-001');
  const rec = await lastReceipt(repo.cwd);
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), true);
  await repo.write('src/ignored.txt', 'untracked and gitignored\n');
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), true);
  await repo.write('src/b.js', 'export const b = 2;\n');
  assert.equal(await isCurrent(repo.cwd, rec, 'DEMO-001'), false, 'a real, non-ignored addition under the directory does stale it');
});

test('finding 5: a command that prints more than the output cap is truncated, with a marker line recorded', async () => {
  const repo = await project();
  assert.equal(OUTPUT_CAP, 8 * 1024 * 1024);
  const small = await runCommand(repo.cwd, "head -c 500 /dev/zero | tr '\\000' 'a'", { cap: 100 });
  assert.equal(small.spawned, true);
  assert.equal(small.truncated, true);
  const text = small.out.toString('utf8');
  assert.equal(text, 'a'.repeat(100) + 'sudus: output truncated at 100 bytes\n');
  const untruncated = await runCommand(repo.cwd, 'printf abc', { cap: 100 });
  assert.deepEqual([untruncated.truncated, untruncated.out.toString()], [false, 'abc']);
});

test('finding 5: check truncates a command that exceeds the real 8 MiB cap and records the marker in the output file', async () => {
  const command = "printf 'sudus: DEMO-001: pass\\n'; head -c 9000000 /dev/zero | tr '\\000' 'x'";
  const repo = await declared({ command });
  await check(repo.cwd, 'DEMO-001');
  const p = (await lastReceipt(repo.cwd)).payload;
  const bytes = await readFile(join(repo.cwd, OUTPUT_DIR, p.output.slice(7)));
  const marker = `sudus: output truncated at ${OUTPUT_CAP} bytes\n`;
  assert.equal(bytes.length, OUTPUT_CAP + marker.length);
  assert.equal(bytes.toString('utf8').slice(-marker.length), marker);
  // the line printed before the cap was hit is still matched correctly
  assert.equal(p.results[0].result, 'pass');
});

test('finding 6: isCurrent propagates an unexpected error instead of reporting it as staleness', async () => {
  const repo = await declared();
  await check(repo.cwd, 'DEMO-001');
  // A null receipt makes `receipt.sha` throw a plain TypeError while evaluating catCommit's
  // arguments, inside the second try block. Before this fix, the blanket `catch { return false }`
  // there reported this as ordinary staleness instead of surfacing the caller's own bug.
  await assert.rejects(isCurrent(repo.cwd, null, 'DEMO-001'), TypeError);
});

test('finding 8: a Draft requirement is never digested into the receipt', async () => {
  const repo = await declared();
  await check(repo.cwd, 'DEMO-001');
  const p = (await lastReceipt(repo.cwd)).payload;
  assert.equal(p.results.some((r) => r.requirement === 'DEMO-002'), false);
  assert.deepEqual(p.results.map((r) => r.requirement), ['DEMO-001']);
});

test('finding 10: a CRLF result line still matches after stripping the trailing CR', async () => {
  const repo = await declared({ command: 'printf "sudus: DEMO-001: pass\\r\\n"' });
  await check(repo.cwd, 'DEMO-001');
  const p = (await lastReceipt(repo.cwd)).payload;
  assert.equal(p.results[0].result, 'pass');
});

test('finding 11: an existing .sudus/output/.gitignore is not rewritten by check', async () => {
  const repo = await declared();
  await repo.write(`${OUTPUT_DIR}/.gitignore`, 'custom\n');
  await check(repo.cwd, 'DEMO-001');
  assert.equal(await readFile(join(repo.cwd, OUTPUT_DIR, '.gitignore'), 'utf8'), 'custom\n');
});

// Issue #46: spec item 37 says execution identity holds only non-secret values, but the name
// screening passes a connection URL such as DATABASE_URL, and its value went into the receipt, a
// commit on the log that travels to the authority remote, with the password in it.
test('a declared connection URL or probe output records no password in the receipt, and the receipt stays current (issue #46)', async () => {
  const { isCurrent } = await import('../lib/check.mjs');
  const url = 'postgres://review:synthetic-password@example.invalid/db?sslmode=require&password=synthetic-other';
  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  const p = await declared({ identity: { tools: { probe: 'echo mysql://root:synthetic-probe@db.invalid/app' }, env: ['DATABASE_URL'], image: null } });
  try {
    await check(p.cwd, 'DEMO-001');
    const r = (await readLog(p.cwd)).filter((x) => x.kind === 'receipt').at(-1);
    assert.equal(r.payload.identity.env.DATABASE_URL, 'postgres://review:[redacted]@example.invalid/db?sslmode=require&password=[redacted]');
    assert.equal(r.payload.identity.tools.probe, 'mysql://root:[redacted]@db.invalid/app');
    const body = (await catCommit(p.cwd, r.sha)).body;
    for (const secret of ['synthetic-password', 'synthetic-other', 'synthetic-probe']) assert.ok(!body.includes(secret), secret);
    assert.equal(await isCurrent(p.cwd, r, 'DEMO-001'), true);
  } finally {
    if (prior === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior;
    await p.cleanup();
  }
});

// Issue #45: result lines were parsed only from the output kept under the 8 MiB diagnostic cap, so
// a fail printed after the cap was never read and an earlier pass stood as the result.
test('a fail printed after the output cap overrides an earlier pass (issue #45)', async () => {
  const { OUTPUT_CAP, isCurrent } = await import('../lib/check.mjs');
  const p = await declared();
  try {
    await p.write('check.mjs', `console.log('sudus: DEMO-001: pass');\nawait new Promise((resolve, reject) => process.stdout.write('x'.repeat(${OUTPUT_CAP + 65536}) + '\\n', (e) => (e ? reject(e) : resolve())));\nconsole.log('sudus: DEMO-001: fail');\nprocess.exitCode = 1;\n`);
    await check(p.cwd, 'DEMO-001');
    const r = (await readLog(p.cwd)).filter((x) => x.kind === 'receipt').at(-1);
    assert.equal(r.payload.results[0].result, 'fail');
    assert.match(await readFile(join(p.cwd, '.sudus/output', r.payload.output.slice(7)), 'utf8'), /output truncated/);
    assert.equal(await isCurrent(p.cwd, r, 'DEMO-001'), true);
  } finally { await p.cleanup(); }
});

test('a result line split across writes and ended with CRLF is read (issue #45)', async () => {
  const p = await declared();
  try {
    await p.write('check.mjs', `process.stdout.write('noise\\nsudus: DEMO-');\nawait new Promise((r) => setTimeout(r, 50));\nprocess.stdout.write('001: pa');\nawait new Promise((r) => setTimeout(r, 50));\nprocess.stdout.write('ss\\r\\n');\n`);
    await check(p.cwd, 'DEMO-001');
    const r = (await readLog(p.cwd)).filter((x) => x.kind === 'receipt').at(-1);
    assert.equal(r.payload.results[0].result, 'pass');
  } finally { await p.cleanup(); }
});

// Issue #44: check snapshots the inputs, then runs the command in the live workspace. An edit made
// while the command ran was tested, the snapshot recorded the bytes before it, and once the edit
// was reverted the pass stood current for bytes the command never saw.
test('an input changed while the command runs leaves every result unverified, never a pass for untested bytes (issue #44)', async () => {
  const { isCurrent, CHANGED_DURING_RUN } = await import('../lib/check.mjs');
  const { access: exists } = await import('node:fs/promises');
  const p = await declared();
  try {
    await p.write('hello.txt', 'broken\n');
    await p.write('check.mjs', `import { writeFileSync, readFileSync, existsSync } from 'node:fs';
writeFileSync('.sudus/output/check-started', '1');
for (let i = 0; i < 500 && !existsSync('.sudus/output/check-go'); i++) await new Promise((r) => setTimeout(r, 10));
const ok = readFileSync('hello.txt', 'utf8').trim() === 'hello';
console.log('sudus: DEMO-001: ' + (ok ? 'pass' : 'fail'));
console.log('sudus: DEMO-002: pass');
`);
    await p.write('.sudus/output/fixture-marker', '');   // the checker writes its barrier file there
    const pending = check(p.cwd, 'DEMO-001');
    let started = false;
    for (let i = 0; i < 400 && !started; i++) { try { await exists(join(p.cwd, '.sudus/output/check-started')); started = true; } catch { await new Promise((r) => setTimeout(r, 10)); } }
    assert.ok(started, 'the checker reached its barrier');
    await p.write('hello.txt', 'hello\n');
    await p.write('.sudus/output/check-go', '1');
    await pending;
    const r = (await readLog(p.cwd)).filter((x) => x.kind === 'receipt').at(-1);
    assert.deepEqual(r.payload.results.map((x) => [x.requirement, x.result]), [['DEMO-001', 'unverified']]);   // DEMO-002 is not Agreed in the fixture
    assert.ok((await readFile(join(p.cwd, '.sudus/output', r.payload.output.slice(7)), 'utf8')).includes(CHANGED_DURING_RUN));
    await p.write('hello.txt', 'broken\n');
    assert.equal(await isCurrent(p.cwd, r, 'DEMO-001'), true, 'the snapshot still matches the reverted bytes');
    assert.notEqual(r.payload.results[0].result, 'pass');
  } finally { await p.cleanup(); }
});

// Review of 4.2.7 (Codex): the stream scanner kept every requirement id it saw, so a command that
// printed result lines for many undeclared ids grew memory past the output cap, and identity probes
// scanned output they never use. Only the declared ids are recorded, and probes record none.
test('runCommand records results only for the ids it is asked about, and none by default (issue #45 follow-up)', async () => {
  const { runCommand } = await import('../lib/check.mjs');
  const cmd = `node -e "for (let i = 0; i < 2000; i++) console.log('sudus: X-' + String(i).padStart(4, '0') + ': pass'); console.log('sudus: DEMO-001: fail')"`;
  const asked = await runCommand(process.cwd(), cmd, { results: ['DEMO-001', 'DEMO-002'] });
  assert.deepEqual([...asked.seen.keys()], ['DEMO-001']);
  assert.deepEqual(asked.seen.get('DEMO-001'), { pass: false, fail: true });
  assert.equal((await runCommand(process.cwd(), cmd)).seen.size, 0);
});
