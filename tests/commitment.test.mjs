// tests/commitment.test.mjs
import { cloneId } from '../lib/inbox.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readLog, decodeRecord } from '../lib/records.mjs';
import { catCommit } from '../lib/gitx.mjs';
import { item, outside, fix, start, openCommitment, CommitmentError } from '../lib/commitment.mjs';
import { project, roadmapWith, OVERVIEW, ROADMAP } from './helpers/commitment-fixture.mjs';

const last = async (cwd, kind) => (await readLog(cwd)).filter((r) => r.kind === kind).at(-1);

test('item records backlog, next-feature and defect items with closed payloads', async () => {
  const repo = await project();
  const b = await item(repo.cwd, { kind: 'backlog', slug: 'greet-twice', source: 'DEMO-001', body: 'Greet twice on request.' });
  const n = await item(repo.cwd, { kind: 'next-feature', slug: 'farewell', source: 'DEMO-001 falsifier', body: 'Add goodbye; changes DEMO-001.' });
  const d = await item(repo.cwd, { kind: 'defect', slug: 'hello-typo', source: 'DEMO-001', body: 'Prints helo.' });
  const rec = await last(repo.cwd, 'item');
  assert.equal(rec.sha, d);
  assert.deepEqual(rec.payload, { kind: 'defect', slug: 'hello-typo', source: 'DEMO-001', body: 'Prints helo.' });
  assert.equal(rec.target, 'hello-typo');
  assert.equal(decodeRecord(await catCommit(repo.cwd, b)).kind, 'item');
  assert.equal(decodeRecord(await catCommit(repo.cwd, n)).payload.kind, 'next-feature');
});

test('item refuses an unknown kind, a taken slug, an empty body, and a defect against a non-Agreed requirement', async () => {
  const repo = await project();
  await item(repo.cwd, { kind: 'backlog', slug: 'taken', source: 'DEMO-001', body: 'x' });
  await assert.rejects(item(repo.cwd, { kind: 'idea', slug: 'a', source: 'DEMO-001', body: 'x' }), /kind/);
  await assert.rejects(item(repo.cwd, { kind: 'backlog', slug: 'taken', source: 'DEMO-001', body: 'x' }), /slug taken is taken/);
  await assert.rejects(item(repo.cwd, { kind: 'backlog', slug: 'b', source: 'DEMO-001', body: '  ' }), /body/);
  await assert.rejects(item(repo.cwd, { kind: 'defect', slug: 'c', source: 'DEMO-003', body: 'x' }), /DEMO-003 is not an Agreed requirement/);
  await assert.rejects(item(repo.cwd, { kind: 'backlog', slug: 'd', source: 'DEMO-999', body: 'x' }), /DEMO-999 is not an Agreed requirement/);
});

test('outside names an item and a reason; it refuses a non-item SHA', async () => {
  const repo = await project();
  const i = await item(repo.cwd, { kind: 'backlog', slug: 'greet-twice', source: 'DEMO-001', body: 'x' });
  await outside(repo.cwd, i, 'Repeating the greeting is not part of printing hello.');
  const rec = await last(repo.cwd, 'outside');
  assert.deepEqual(rec.payload, { item: i, reason: 'Repeating the greeting is not part of printing hello.', evaluation: null });
  await assert.rejects(outside(repo.cwd, rec.sha, 'x'), /not an item record/);
  await assert.rejects(outside(repo.cwd, i, ''), /reason/);
});

test('fix names a defect item and a workspace snapshot under an open commitment', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const d = await item(repo.cwd, { kind: 'defect', slug: 'hello-typo', source: 'DEMO-001', body: 'Prints helo.' });
  await repo.write('src/main.mjs', 'console.log("hello!");\n');
  const sha = await fix(repo.cwd, d);
  const rec = await last(repo.cwd, 'fix');
  assert.equal(rec.sha, sha);
  assert.equal(rec.payload.item, d);
  assert.match(rec.payload.snapshot, /^[0-9a-f]{40}$/);
});

test('fix, outside and promote take the item slug wake prints as well as the sha, and record the sha', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const d = await item(repo.cwd, { kind: 'defect', slug: 'typo', source: 'DEMO-001', body: 'x' });
  const b = await item(repo.cwd, { kind: 'backlog', slug: 'later', source: 'DEMO-001', body: 'y' });
  await outside(repo.cwd, 'later', 'not now');
  await fix(repo.cwd, 'typo');
  const log = await readLog(repo.cwd);
  assert.equal(log.find((r) => r.kind === 'outside').payload.item, b);
  assert.equal(log.find((r) => r.kind === 'fix').payload.item, d);
  await assert.rejects(fix(repo.cwd, 'nope'), /nope is not an item record or item slug; sudus show items lists them/);
});
test('fix refuses a backlog item, no open commitment, and a snapshot that changes protected contract', async () => {
  const repo = await project();
  const b = await item(repo.cwd, { kind: 'backlog', slug: 'greet-twice', source: 'DEMO-001', body: 'x' });
  const d = await item(repo.cwd, { kind: 'defect', slug: 'hello-typo', source: 'DEMO-001', body: 'x' });
  await assert.rejects(fix(repo.cwd, d), /after a first commitment has started/);
  await start(repo.cwd, 'first');
  await assert.rejects(fix(repo.cwd, b), /only a defect item is fixed/);
  await repo.write('AGENTS.md', '# Working agreement\n\nChanged.\n');
  await assert.rejects(fix(repo.cwd, d), (e) => e instanceof CommitmentError && /fix changes protected contract AGENTS.md/.test(e.message));
});

import { frozenSet, currentAuthorization, setCurrent } from '../lib/commitment.mjs';
// Fix round 1 finding 7: protectedDigests is lib/auth.mjs's own function; lib/commitment.mjs no
// longer carries a second, dead-in-production reimplementation of it.
import { protectedDigests, refuseUnauthorizedProtected, AuthError } from '../lib/auth.mjs';
import { readSnapshot } from '../lib/snapshots.mjs';
import { git, readRef } from '../lib/gitx.mjs';
import { sha256 } from '../lib/canon.mjs';

test('start freezes the roadmap section plus every Scope: every commitment Agreed block, at one workspace snapshot', async () => {
  const repo = await project();
  // Fix round 1 finding 12: strengthens the "start committed the contract bytes" check below.
  // authorize()'s own dirty-path detection (lib/auth.mjs) covers only .sudus/settings.json under
  // .sudus/**, not .sudus/mechanisms/**; a mechanism file left dirty by an agent's own sudus
  // declare (outside this plan's scope to build, but its output already lands here) must still be
  // picked up by start's own broad '.sudus' commit path, not left uncommitted.
  await repo.write('.sudus/mechanisms/greeter.json', '{"left":"dirty by the test, not by authorize"}');
  const calls = [];
  const sha = await start(repo.cwd, 'first', { installRefspecs: async (cwd, remote) => calls.push(remote) });
  const rec = await last(repo.cwd, 'start');
  assert.equal(rec.sha, sha);
  assert.equal(rec.target, 'first');
  // Deviation from the plan text: 'start' is written through withTransaction (a MULTI_STORE
  // command), which unconditionally injects intent and results into the terminal payload
  // (lib/tx.mjs's finish()); the plan's own carried obligation for this task closes the 'start'
  // schema with those two fields. The plan's literal 4-key list is extended to 6 here.
  // Issue #35 (spec revision 18): the start names the clone that started it.
  assert.deepEqual(Object.keys(rec.payload).sort(), ['clone', 'from_superseded', 'intent', 'requirements', 'results', 'slug', 'snapshot']);
  assert.equal(rec.payload.clone, await cloneId(repo.cwd, { create: false }));
  assert.deepEqual(rec.payload.requirements.map((r) => r.requirement), ['CORE-001', 'DEMO-001']);
  assert.deepEqual(rec.payload.requirements, await frozenSet(repo.cwd, 'first'));
  assert.equal(rec.payload.from_superseded, null);
  assert.equal((await readSnapshot(repo.cwd, rec.payload.snapshot, 'workspace')).kind, 'workspace');
  assert.equal(decodeRecord(await catCommit(repo.cwd, sha)).kind, 'start');
  assert.deepEqual(calls, ['origin']);
  const status = (await git(['status', '--porcelain', '--', 'docs/spec', 'AGENTS.md', '.sudus'], { cwd: repo.cwd })).stdout;
  assert.equal(status, '', 'start committed the contract bytes, including a mechanism file authorize never touches');
  assert.deepEqual(openCommitment(await readLog(repo.cwd)).open.sha, sha);
});

// Issue #11: .sudus/output/ holds check output and briefs, kept local by its own .gitignore. The
// start commit names the whole .sudus/ directory, and its ignored files were forced in with it.
test('start leaves check output and briefs under .sudus/output out of its commit', async () => {
  const repo = await project();
  await repo.write('.sudus/output/.gitignore', '*\n');
  await repo.write('.sudus/output/0123456789abcdef', 'raw check output: /home/someone/project HOST=build-3\n');
  await repo.write('.sudus/output/brief-0123.md', 'a brief quoting src/missing-file.mjs\n');
  await start(repo.cwd, 'first');
  const files = (await repo.git('ls-tree', '-r', '--name-only', 'HEAD')).split('\n');
  assert.deepEqual(files.filter((f) => f.startsWith('.sudus/output/')), []);
  assert.ok(files.includes('.sudus/settings.json'), files.join(' '));
  await repo.cleanup();
});

// Review of 3.5.0: a project hit by issue #11 before the fix already tracks .sudus/output/ files;
// a later start must not commit their new content either.
test('start leaves an output file already tracked from an earlier version as it was', async () => {
  const repo = await project();
  await repo.write('.sudus/output/0123456789abcdef', 'old output\n');
  await repo.git('add', '-f', '.sudus/output/0123456789abcdef');
  await repo.git('commit', '-q', '-m', 'tracked by an earlier version');
  await repo.write('.sudus/output/0123456789abcdef', 'new output: /home/someone/project\n');
  await start(repo.cwd, 'first');
  assert.equal(await repo.git('show', 'HEAD:.sudus/output/0123456789abcdef'), 'old output');
  assert.ok(!(await repo.git('show', '--name-only', '--format=', 'HEAD')).includes('.sudus/output/'));
  await repo.cleanup();
});

test('start with a local-only authority remote installs nothing', async () => {
  const repo = await project({ authority_remote: null });
  const calls = [];
  await start(repo.cwd, 'first', { installRefspecs: async () => calls.push(1) });
  assert.deepEqual(calls, []);
});

test('at most one commitment is open', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  await assert.rejects(start(repo.cwd, 'second'), (e) => e instanceof CommitmentError && /commitment first is open; at most one commitment is open/.test(e.message));
  assert.equal((await readLog(repo.cwd)).filter((r) => r.kind === 'start').length, 1);
});

test('start refuses a section naming a non-Agreed requirement, a missing section and a bad slug before writing anything', async () => {
  const repo = await project();
  const before = await readLog(repo.cwd);
  // Fix round 1 finding 8: frozenSet now wraps lib/spec.mjs's requirementSet instead of a
  // duplicate; its SpecError message text ("X is Y, not Agreed" / "no roadmap section X") differs
  // from the plan's own original wording, an accepted consequence of removing the duplicate.
  await assert.rejects(start(repo.cwd, 'drafty'), /DEMO-003 is Draft, not Agreed/);
  await assert.rejects(start(repo.cwd, 'nowhere'), /no roadmap section nowhere/);
  await assert.rejects(start(repo.cwd, 'Bad Slug'), /invalid slug/);
  assert.equal((await readLog(repo.cwd)).length, before.length);
});

test('start refuses without a current authorization, and after a protected file changed since it', async () => {
  const repo = await project();
  await repo.write('AGENTS.md', '# Working agreement\n\nEdited after authorize.\n');
  await assert.rejects(start(repo.cwd, 'first'), /no current authorization/);
  assert.equal(await currentAuthorization(repo.cwd, await readLog(repo.cwd)), null);
  await repo.authorize();
  await assert.doesNotReject(start(repo.cwd, 'first'));
});

test('protectedDigests excludes the roadmap and covers every other spec file, the agreement and settings', async () => {
  const repo = await project();
  const a = await protectedDigests(repo.cwd);
  await repo.write('docs/spec/roadmap.md', (await readFile(join(repo.cwd, 'docs/spec/roadmap.md'), 'utf8')) + '\nMore prose.\n');
  const b = await protectedDigests(repo.cwd);
  assert.equal(a.spec, b.spec);
  await repo.write('docs/spec/glossary.md', '# Glossary\n\nchanged\n');
  assert.notEqual((await protectedDigests(repo.cwd)).spec, a.spec);
  assert.equal(a.agreement, sha256(await readFile(join(repo.cwd, 'AGENTS.md'))));
});

test('setCurrent replaces exactly the Current: line', async () => {
  const text = '# Roadmap\n\nCurrent: first\n\n## first\n\nCurrent: not a header\n';
  assert.equal(setCurrent(text, 'second'), '# Roadmap\n\nCurrent: second\n\n## first\n\nCurrent: not a header\n');
  assert.throws(() => setCurrent('# Roadmap\n', 'x'), /no Current: line/);
});

import { done } from '../lib/commitment.mjs';
import { loopRepo } from './helpers/loop.mjs';
import { authorize } from '../lib/auth.mjs';
import { wake } from '../lib/wake.mjs';

test('done closes the open commitment at its final workspace snapshot', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  await repo.write('src/main.mjs', 'console.log("hello");\n// final\n');
  const sha = await done(repo.cwd, 'first', { unchecked: true });
  const rec = await last(repo.cwd, 'done');
  assert.equal(rec.sha, sha);
  assert.deepEqual(Object.keys(rec.payload).sort(), ['slug', 'snapshot']);
  assert.equal(rec.payload.slug, 'first');
  assert.equal((await readSnapshot(repo.cwd, rec.payload.snapshot, 'workspace')).kind, 'workspace');
  assert.equal(openCommitment(await readLog(repo.cwd)).open, null);
  // Fix round 1 finding 4: start() no longer moves Current: outside a supersession (the
  // spec-phase-tail workflow, out of this plan's scope, is what is supposed to have already
  // written Current: second before sudus start runs for a plain next commitment); write it here
  // to simulate that precondition rather than relying on start()'s own removed permissiveness.
  await repo.write('docs/spec/roadmap.md', roadmapWith('second'));
  await assert.doesNotReject(start(repo.cwd, 'second'));
});

test('done refuses when no commitment is open or the slug is another commitment', async () => {
  const repo = await project();
  await assert.rejects(done(repo.cwd, 'first'), /no commitment is open/);
  await start(repo.cwd, 'first');
  await assert.rejects(done(repo.cwd, 'second'), /commitment first is open, not second/);
});
test('done refuses while the Done rule fails or an earlier predicate is unmet, naming what wake names', async () => {
  const r = await loopRepo();
  await assert.rejects(done(r.cwd, 'first'), /first is not at Done; wake names run DEMO-001: no current receipt/);
  const d = await item(r.cwd, { kind: 'defect', slug: 'gate-bug', source: 'DEMO-001', body: 'gate invisible' });
  await assert.rejects(done(r.cwd, 'first'), /first is not at Done; wake names fix gate-bug: defect gate-bug against DEMO-001 has no fix record/);
  await fix(r.cwd, d);
  await r.passReq('DEMO-001'); await r.review(); await r.report();
  await assert.doesNotReject(done(r.cwd, 'first'));
});
test('fix records a defect against the last closed commitment\'s own requirement, so a done written before the check is not a deadlock', async () => {
  const r = await loopRepo();
  const d = await item(r.cwd, { kind: 'defect', slug: 'gate-bug', source: 'DEMO-001', body: 'gate invisible' });
  await r.passReq('DEMO-001');
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  assert.equal((await wake(r.cwd)).action, 'fix');
  const other = await item(r.cwd, { kind: 'defect', slug: 'elsewhere', source: 'DEMO-002', body: 'x' }).catch(() => null);
  if (other) await assert.rejects(fix(r.cwd, other), /open the next commitment with \/next-feature, then sudus fix/);
  await fix(r.cwd, d);
  await r.passReq('DEMO-001');
  assert.notEqual((await wake(r.cwd)).action, 'fix');
});

test('every record kind of this plan round-trips through decodeRecord', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const d = await item(repo.cwd, { kind: 'defect', slug: 'typo', source: 'DEMO-001', body: 'x' });
  await outside(repo.cwd, d, 'not this commitment');
  await fix(repo.cwd, d);
  await done(repo.cwd, 'first', { unchecked: true });
  const log = await readLog(repo.cwd);
  for (const kind of ['start', 'item', 'outside', 'fix', 'done']) {
    const rec = log.filter((r) => r.kind === kind).at(-1);
    assert.deepEqual(decodeRecord(await catCommit(repo.cwd, rec.sha)).payload, rec.payload, kind);
  }
});

test('the authorization record carries the three digests by the shared rule', async () => {
  const repo = await project();
  const auth = (await readLog(repo.cwd)).filter((r) => r.kind === 'authorization').at(-1);
  const now = await protectedDigests(repo.cwd);
  assert.deepEqual([auth.payload.spec_digest, auth.payload.agreement_digest, auth.payload.settings_digest], [now.spec, now.agreement, now.settings]);
});

import { supersede, carriedRecords } from '../lib/commitment.mjs';
import { readAdr } from '../lib/adr.mjs';
import { appendRecord } from '../lib/records.mjs';

test('supersede writes the developer-quoted decision and a superseded record, and does not move Current:', async () => {
  const repo = await project();
  const s = await start(repo.cwd, 'first');
  const d = await item(repo.cwd, { kind: 'defect', slug: 'typo', source: 'DEMO-001', body: 'x' });
  const sha = await supersede(repo.cwd, 'second', { quote: 'Drop the greeting work; the name argument matters more.', env: {} });
  const rec = await last(repo.cwd, 'superseded');
  assert.equal(rec.sha, sha);
  // Deviation from the plan text: the already-committed 'superseded' schema (lib/records.mjs) has
  // no `evidence` field -- spec section 2's own Superseded definition names "the old start, the
  // developer decision, a transition ID, the intended successor slug and every carried open
  // record" and nothing else, and section 4's table agrees; the developer's authentication is
  // gated here but not persisted on this record (unlike 'read' and 'answer', which the spec
  // explicitly says do carry it). It does carry intent/results, the same as 'promotion' (Fix round
  // 1 finding 8). The plan's Global Constraints text calling `evidence` "the ninth logical field"
  // conflicts with both the already-committed schema and the spec; followed the schema and spec.
  assert.deepEqual(Object.keys(rec.payload).sort(), ['carried', 'decision', 'intent', 'results', 'slug', 'start', 'successor', 'transition']);
  assert.deepEqual([rec.payload.slug, rec.payload.start, rec.payload.successor, rec.payload.carried], ['first', s, 'second', [d]]);
  assert.match(rec.payload.transition, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  const decision = (await readAdr(repo.cwd)).find((l) => l.id === rec.payload.decision);
  assert.deepEqual([decision.kind, decision.by, decision.body], ['decision', 'developer', 'Drop the greeting work; the name argument matters more.']);
  assert.match(await readFile(join(repo.cwd, 'docs/spec/roadmap.md'), 'utf8'), /^Current: first$/m);
  const state = openCommitment(await readLog(repo.cwd));
  assert.equal(state.open, null);
  assert.equal(state.pending.sha, sha);
  assert.equal(decodeRecord(await catCommit(repo.cwd, sha)).kind, 'superseded');
});

test('the successor start names the superseded record and Current: moves in its own transaction', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const sup = await supersede(repo.cwd, 'second', { quote: 'Switch.', env: {} });
  await assert.rejects(start(repo.cwd, 'drafty'), /pending supersession names successor second, not drafty/);
  const s2 = await start(repo.cwd, 'second');
  const rec = await last(repo.cwd, 'start');
  assert.deepEqual([rec.sha, rec.payload.from_superseded, rec.payload.slug], [s2, sup, 'second']);
  assert.match(await readFile(join(repo.cwd, 'docs/spec/roadmap.md'), 'utf8'), /^Current: second$/m);
  assert.equal(openCommitment(await readLog(repo.cwd)).pending, null);
});

test('supersede refuses without an open commitment, without the developer quote, or with a bad successor', async () => {
  const repo = await project();
  await assert.rejects(supersede(repo.cwd, 'second', { quote: 'x' }), /no commitment is open/);
  await start(repo.cwd, 'first');
  await assert.rejects(supersede(repo.cwd, 'second', { quote: '' }), /developer's words/);
  await assert.rejects(supersede(repo.cwd, 'Bad', { quote: 'x' }), /invalid slug/);
});

test('carriedRecords carries unanswered escalations and unfixed defects, not answered or fixed ones', async () => {
  const repo = await project();
  const s = await start(repo.cwd, 'first');
  const log0 = await readLog(repo.cwd);
  const open = openCommitment(log0).open;
  const d1 = await item(repo.cwd, { kind: 'defect', slug: 'one', source: 'DEMO-001', body: 'x' });
  const d2 = await item(repo.cwd, { kind: 'defect', slug: 'two', source: 'DEMO-001', body: 'x' });
  await fix(repo.cwd, d2);
  const b = await item(repo.cwd, { kind: 'backlog', slug: 'later', source: 'DEMO-001', body: 'x' });
  const log = await readLog(repo.cwd);
  assert.deepEqual(carriedRecords(log, open), [d1]);
  assert.equal(carriedRecords(log0, open).length, 0);
  assert.equal(s, open.sha);
  assert.equal(log.some((r) => r.sha === b), true);
});

import { promote } from '../lib/commitment.mjs';
import { queue } from '../lib/adr.mjs';

async function finished(repo) {
  await start(repo.cwd, 'first');
  const b = await item(repo.cwd, { kind: 'backlog', slug: 'second', source: 'DEMO-002', body: 'Greet by name.' });
  await done(repo.cwd, 'first', { unchecked: true });
  return b;
}

test('promote writes decision, promotion, Current: move and successor start as one transaction', async () => {
  const repo = await project();
  const b = await finished(repo);
  const calls = [];
  const sha = await promote(repo.cwd, b, { installRefspecs: async (cwd, remote) => calls.push(remote) });
  const log = await readLog(repo.cwd);
  const promotion = log.filter((r) => r.kind === 'promotion').at(-1);
  const startRec = log.at(-1);
  assert.equal(startRec.sha, sha);
  assert.deepEqual([startRec.kind, startRec.payload.slug, startRec.payload.from_superseded], ['start', 'second', null]);
  assert.deepEqual(startRec.payload.requirements.map((r) => r.requirement), ['CORE-001', 'DEMO-002']);
  // Deviation from the plan text: the already-committed 'promotion' schema (lib/records.mjs, Fix
  // round 1 finding 8) carries intent/results, the same as 'superseded' and this task's own
  // 'start'; the plan's literal 2-key list is extended to 4.
  assert.deepEqual(Object.keys(promotion.payload).sort(), ['decision', 'intent', 'item', 'results']);
  assert.equal(promotion.payload.item, b);
  const decision = (await readAdr(repo.cwd)).find((l) => l.id === promotion.payload.decision);
  assert.deepEqual([decision.by, decision.title], ['agent', 'Promote second']);
  assert.deepEqual(await queue(repo.cwd), [decision.id]);
  assert.match(await readFile(join(repo.cwd, 'docs/spec/roadmap.md'), 'utf8'), /^Current: second$/m);
  assert.equal((await git(['status', '--porcelain', '--', 'docs/spec/roadmap.md', 'docs/decisions.jsonl'], { cwd: repo.cwd })).stdout, '');
  assert.deepEqual(calls, ['origin']);
  assert.equal(decodeRecord(await catCommit(repo.cwd, promotion.sha)).kind, 'promotion');
});

test('promote refuses a next-feature item', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const n = await item(repo.cwd, { kind: 'next-feature', slug: 'second', source: 'DEMO-002 falsifier', body: 'x' });
  await done(repo.cwd, 'first', { unchecked: true });
  await assert.rejects(promote(repo.cwd, n), (e) => e instanceof CommitmentError && /next-feature item waits for the developer/.test(e.message));
});

test('between commitments any defect is fixed and wake names it before promote; an open commitment fixes only its own', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');   // first owns DEMO-001 only
  const d = await item(repo.cwd, { kind: 'defect', slug: 'elsewhere', source: 'DEMO-002', body: 'x' });
  await assert.rejects(fix(repo.cwd, d), /defect elsewhere is against DEMO-002, which commitment first does not own/);
  await done(repo.cwd, 'first', { unchecked: true });
  const v = await wake(repo.cwd);
  assert.deepEqual([v.action, v.target], ['fix', 'elsewhere'], JSON.stringify(v));
  await fix(repo.cwd, 'elsewhere');
  const after = await wake(repo.cwd);
  // The fix is recorded; the check is the step left, and wake names it (issue #64).
  assert.deepEqual([after.action, after.target, after.reason], ['run', 'DEMO-002', 'the fix of elsewhere is recorded and no current receipt carries a result for DEMO-002'], JSON.stringify(after));
});
// Issue #4 (johnwlockwood, 3.0.0): a fix recorded between commitments was judged against the newest
// start, so the next commitment's own contract changes (a new spec file, an edited overview) revoked
// it, and a new fix was refused for the same delta. The base is the contract in force when the fix
// was recorded: the last start before it, or that commitment's done snapshot once it had closed.
test('a fix recorded between commitments survives the next commitment\'s contract changes, and a later fix is judged against the last done (issue #4)', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  await item(repo.cwd, { kind: 'defect', slug: 'gate', source: 'DEMO-001', body: 'x' });
  await done(repo.cwd, 'first', { unchecked: true });
  await fix(repo.cwd, 'gate');
  // The next commitment changes protected contract: a spec edit and the roadmap's Current: line.
  await repo.write('docs/spec/overview.md', OVERVIEW + '\nSecond phase.\n');
  await repo.write('docs/spec/roadmap.md', roadmapWith('second'));
  await repo.commit('second phase spec');
  await authorize(repo.cwd, { quote: 'ok', env: {} });
  await start(repo.cwd, 'second');
  await done(repo.cwd, 'second', { unchecked: true });
  const v = await wake(repo.cwd);
  // The fix stands; what wake names next is the pass DEMO-001 still lacks, never the revocation.
  assert.deepEqual([v.action, v.target, v.reason], ['run', 'DEMO-001', 'the fix of gate is recorded and no current receipt carries a result for DEMO-001'], JSON.stringify(v));
  await item(repo.cwd, { kind: 'defect', slug: 'later', source: 'DEMO-002', body: 'y' });
  await assert.doesNotReject(fix(repo.cwd, 'later'));
  assert.notEqual((await wake(repo.cwd)).reason, 'the fix snapshot changes a protected path');
});
// Second adversarial review, liveness area: a defect carried across a supersede could never be
// fixed. The gap after a supersede is where the spec phase edits Agreed text before the successor
// start, yet the fix was still measured against the superseded start's snapshot and refused for
// those edits; under the successor it was refused as not owned. No contract is frozen between
// commitments, so no protected delta is measured there.
test('a defect carried across a supersede is fixed in the gap, after the spec edits the supersede was for', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  await item(repo.cwd, { kind: 'defect', slug: 'greet-typo', source: 'DEMO-001', body: 'x' });
  await supersede(repo.cwd, 'second', { quote: 'move to the name argument now', env: {} });
  await repo.write('docs/spec/overview.md', OVERVIEW + '\nRevised for second.\n');
  await repo.write('docs/spec/roadmap.md', roadmapWith('second'));
  await repo.commit('spec edits for second');
  await authorize(repo.cwd, { quote: 'ok', env: {} });
  await assert.doesNotReject(fix(repo.cwd, 'greet-typo'));
  await start(repo.cwd, 'second');
  await done(repo.cwd, 'second', { unchecked: true });
  const v = await wake(repo.cwd);
  assert.notEqual(v.reason, 'the fix snapshot changes a protected path', JSON.stringify(v));
});
test('promote refuses a developer-set Current: naming another slug instead of overwriting it', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001'); await r.review(); await r.report();
  await r.item('backlog', 'DEMO-001', 'do-more'); await outside(r.cwd, 'do-more', 'later');
  await done(r.cwd, 'first');
  const roadmap = await readFile(join(r.cwd, 'docs/spec/roadmap.md'), 'utf8');
  await r.write('docs/spec/roadmap.md', roadmap.replace('Current: first', 'Current: something-else') + '\n## do-more\n\nRequirements: DEMO-001\n\nMore.\n'); await r.commit('developer names the next section');
  await authorize(r.cwd, { quote: 'ok', env: {} });
  await assert.rejects(promote(r.cwd, 'do-more'), /roadmap names something-else as Current:, not the finished commitment first or do-more/);
  assert.match((await readFile(join(r.cwd, 'docs/spec/roadmap.md'), 'utf8')), /Current: something-else/);
});
test('a promoted commitment can reach Done: the promote decision does not stop on the roadmap line its own start wrote', async () => {
  const r = await loopRepo();
  await r.passReq('DEMO-001'); await r.review(); await r.report();
  await r.item('backlog', 'DEMO-001', 'do-more'); await outside(r.cwd, 'do-more', 'later');
  await done(r.cwd, 'first');
  const roadmap = await readFile(join(r.cwd, 'docs/spec/roadmap.md'), 'utf8');
  await r.write('docs/spec/roadmap.md', roadmap + '\n## do-more\n\nRequirements: DEMO-001\n\nMore.\n'); await r.commit('do-more section');
  await authorize(r.cwd, { quote: 'ok', env: {} });
  await promote(r.cwd, 'do-more');
  const id = (await readAdr(r.cwd)).findLast((l) => l.kind === 'decision').id;
  await assert.doesNotReject(realize(r.cwd, id, { subject: 'promoted' }));
});
test('promote refuses while a defect item is unfixed', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const b = await item(repo.cwd, { kind: 'backlog', slug: 'second', source: 'DEMO-002', body: 'x' });
  await item(repo.cwd, { kind: 'defect', slug: 'typo', source: 'DEMO-001', body: 'x' });
  await done(repo.cwd, 'first', { unchecked: true });
  await assert.rejects(promote(repo.cwd, b), /defect item typo is unfixed; defects are fixed before promotion/);
});

test('promote refuses while a commitment is open, a section naming Draft text, an already promoted item, and a non-item', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const b = await item(repo.cwd, { kind: 'backlog', slug: 'drafty', source: 'DEMO-001', body: 'x' });
  await assert.rejects(promote(repo.cwd, b), /commitment first is open/);
  await done(repo.cwd, 'first', { unchecked: true });
  await assert.rejects(promote(repo.cwd, b), /DEMO-003 is Draft/);
  const b2 = await item(repo.cwd, { kind: 'backlog', slug: 'second', source: 'DEMO-002', body: 'x' });
  const s = await promote(repo.cwd, b2);
  await done(repo.cwd, 'second', { unchecked: true });
  await assert.rejects(promote(repo.cwd, b2), /already promoted/);
  await assert.rejects(promote(repo.cwd, s), /not an item record/);
});

import { realize, RealizationError } from '../lib/commitment.mjs';
import { decide, appendDecision } from '../lib/adr.mjs';
import { recordManagedWrite } from '../lib/scope.mjs';

const buildDraft = { title: 'Split main', rests_on: ['DEMO-001'], wrong_if: 'the split hides the greeting', body: 'Move the greeting into a module.' };

test('realize records base and realized snapshots for a plain delta and the interface hits it touched', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const id = await decide(repo.cwd, buildDraft);
  await repo.write('src/greet.mjs', 'export const greet = () => "hello";\n');
  await repo.write('src/api/index.mjs', 'export { greet } from "../greet.mjs";\n');
  const rid = await realize(repo.cwd, id, { subject: 'Greeting module and API export' });
  const line = (await readAdr(repo.cwd)).find((l) => l.id === rid);
  const decision = (await readAdr(repo.cwd)).find((l) => l.id === id);
  assert.deepEqual([line.kind, line.of, line.base_snap, line.interfaces], ['realized', id, decision.base_snap, ['src/api/index.mjs']]);
  assert.equal((await readSnapshot(repo.cwd, line.snap, 'workspace')).kind, 'workspace');
});

const appendNewline = (path) => async (repo) => repo.write(path, (await readFile(join(repo.cwd, path), 'utf8')) + '\n');
for (const [name, path, change, cls] of [
  ['a data path', 'migrations/001.sql', (repo) => repo.write('migrations/001.sql', 'create table t;\n'), 'data'],
  ['frozen Agreed text', 'docs/spec/demo.md', appendNewline('docs/spec/demo.md'), 'protected'],
  ['the working agreement', 'AGENTS.md', appendNewline('AGENTS.md'), 'protected'],
  ['protected settings', '.sudus/settings.json', appendNewline('.sudus/settings.json'), 'protected'],
  ['another reserved path', '.sudus/notes.txt', (repo) => repo.write('.sudus/notes.txt', 'x\n'), 'reserved'],
]) {
  test(`realize stops on ${name} in the actual delta`, async () => {
    const repo = await project();
    await start(repo.cwd, 'first');
    const id = await decide(repo.cwd, { ...buildDraft, named_paths: ['src/greet.mjs'] });
    await repo.write('src/greet.mjs', 'export const greet = () => "hello";\n');
    await change(repo);
    await assert.rejects(realize(repo.cwd, id, { subject: 's' }), (e) => e instanceof RealizationError && e.paths.some((p) => p.path === path && p.class === cls) && /the decision is the developer's/.test(e.message));
    assert.equal((await readAdr(repo.cwd)).some((l) => l.kind === 'realized'), false);
  });
}

test('the ADR line the decision itself appended is not a stop; a second realization and an unknown id are refused', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const id = await decide(repo.cwd, buildDraft);
  await realize(repo.cwd, id, { subject: 'no code change' });
  await assert.rejects(realize(repo.cwd, id, { subject: 'again' }), /already realized/);
  await assert.rejects(realize(repo.cwd, '01ARZ3NDEKTSV4RRFFQ69G5FAV', { subject: 'x' }), /no decision/);
});

test('Fix round 1 finding 5: realize stops on a hand-edited mechanism file that no longer validates under readMechanisms', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const id = await decide(repo.cwd, buildDraft);
  // A direct edit under .sudus/mechanisms/ that readMechanisms itself refuses (schema 1 missing):
  // section 2 calls this a breach ("A direct edit ... is a breach"), so realize must never let it
  // through as if it were a normal, valid kernel-managed mutation.
  await repo.write('.sudus/mechanisms/bad.json', '{}');
  await assert.rejects(realize(repo.cwd, id, { subject: 'hand-edited mechanism' }),
    (e) => e instanceof RealizationError && e.paths.some((p) => p.path === '.sudus/mechanisms/bad.json' && p.class === 'reserved'));
  assert.equal((await readAdr(repo.cwd)).some((l) => l.kind === 'realized'), false);
});

test('Fix round 2 finding 4: realize uses the shared, ledger-based kernelManagedValid (lib/scope.mjs), accepting a mechanism write the ledger actually recorded', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const id = await decide(repo.cwd, buildDraft);
  const bytes = Buffer.from('{"schema":1}\n');
  await repo.write('.sudus/mechanisms/greeter.json', bytes);
  await recordManagedWrite(repo.cwd, '.sudus/mechanisms/greeter.json', bytes);
  await assert.doesNotReject(realize(repo.cwd, id, { subject: 'ledger-recorded mechanism write' }));
});

test('a realization that touches a data path escalates with concern decision:<id>, refuses until the developer answers ok, then records', async () => {
  const r = await loopRepo({ settings: { data: ['data/**'] } });
  const id = await r.decide();
  await r.write('data/rows.csv', 'a,b\n');
  await assert.rejects(realize(r.cwd, id, { subject: 's' }), /touches data\/rows.csv \(data\); the decision is the developer's; escalation [0-9a-f]{40} written, their ok lets sudus realize proceed/);
  const esc = (await r.log()).findLast((x) => x.kind === 'escalation');
  assert.equal(esc.payload.concerns, `decision:${id}`);
  assert.equal((await wake(r.cwd)).verdict, 'Waiting');
  await assert.rejects(realize(r.cwd, id, { subject: 's' }), /awaits their answer/);
  assert.equal((await r.log()).filter((x) => x.kind === 'escalation').length, 1, 'one escalation, not one per attempt');
  await r.answer(esc.sha, 'ok');
  await assert.doesNotReject(realize(r.cwd, id, { subject: 's' }));
  assert.notEqual((await wake(r.cwd)).action, `build ${id}`);
});
test('Fix round 1 finding 12: realize takes no durable snapshot when the stop check does not pass', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const id = await decide(repo.cwd, { ...buildDraft, named_paths: ['src/greet.mjs'] });
  await repo.write('src/greet.mjs', 'export const greet = () => "hello";\n');
  const before = await readRef(repo.cwd, 'refs/sudus/snapshots');
  await repo.write('AGENTS.md', (await readFile(join(repo.cwd, 'AGENTS.md'), 'utf8')) + '\n');
  await assert.rejects(realize(repo.cwd, id, { subject: 'stopped' }), RealizationError);
  assert.equal(await readRef(repo.cwd, 'refs/sudus/snapshots'), before, 'no new snapshot commit was left behind by the stopped attempt');
});

// Fix round 1

import { recover } from '../lib/tx.mjs';

test('Fix round 1 finding 1: promote crashed after each write recovers to exactly one promotion and one start record', async () => {
  // Fix round 1 finding 2 folded the ADR line and the roadmap's Current: edit into the same
  // transaction's plan.writes (promotion log, ADR file, roadmap file, branch, snapshot: 5 writes),
  // so this now covers 5 crash points, not the 3 from before that fix.
  for (let n = 0; n < 5; n++) {
    const repo = await project();
    const b = await finished(repo);
    await assert.rejects(promote(repo.cwd, b, { failAfterWrite: n }), new RegExp(`simulated crash after write ${n}`));
    const beforeRecover = await readLog(repo.cwd);
    const intent = beforeRecover.findLast((r) => r.kind === 'command-intent');
    assert.ok(intent, `write ${n}: the intent record exists even after the crash`);
    const r = await recover(repo.cwd, intent.target);
    assert.equal(r.completed, 'forward', `write ${n}: recovery completes forward`);
    const log = await readLog(repo.cwd);
    assert.equal(log.filter((x) => x.kind === 'promotion').length, 1, `write ${n}: exactly one promotion record`);
    assert.equal(log.filter((x) => x.kind === 'start' && x.payload.slug === 'second').length, 1, `write ${n}: exactly one successor start record`);
    assert.equal((await readAdr(repo.cwd)).length, 1, `write ${n}: exactly one ADR line, not one per crash-and-recover attempt`);
    assert.match(await readFile(join(repo.cwd, 'docs/spec/roadmap.md'), 'utf8'), /^Current: second$/m, `write ${n}: Current: moved exactly once`);
  }
});

test('Fix round 2 finding 5: promote\'s transaction identity names the item SHA', async () => {
  const repo = await project();
  const b = await finished(repo);
  await promote(repo.cwd, b);
  const intent = (await readLog(repo.cwd)).findLast((r) => r.kind === 'command-intent' && r.payload.command === 'promote');
  assert.ok(intent, 'a promote command-intent record was written');
  assert.equal(intent.payload.identity.item, b);
});

test('Fix round 1 finding 2: promote on a roadmap with no Current: line leaves no ADR line', async () => {
  const repo = await project();
  const b = await finished(repo);
  await repo.write('docs/spec/roadmap.md', ROADMAP.replace('Current: first\n\n', ''));
  await assert.rejects(promote(repo.cwd, b), /has no Current: line/);
  assert.deepEqual(await readAdr(repo.cwd), []);
});

test('Fix round 1 finding 6: supersede refuses the open commitment naming itself as successor', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  await assert.rejects(supersede(repo.cwd, 'first', { quote: 'x', env: {} }), /successor first is the same as the open commitment first/);
});

test('Fix round 1 finding 3: an item still open from an earlier supersession is carried again by the next one', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const d = await item(repo.cwd, { kind: 'defect', slug: 'typo', source: 'DEMO-001', body: 'x' });
  const sup1 = await supersede(repo.cwd, 'second', { quote: 'Switch once.', env: {} });
  const rec1 = (await readLog(repo.cwd)).find((r) => r.sha === sup1);
  assert.deepEqual(rec1.payload.carried, [d], 'the defect, still unfixed, carries on the first supersession');
  await start(repo.cwd, 'second');
  const sup2 = await supersede(repo.cwd, 'third', { quote: 'Switch again.', env: {} });
  const rec2 = (await readLog(repo.cwd)).find((r) => r.sha === sup2);
  assert.deepEqual(rec2.payload.carried, [d], 'the same defect, still unfixed, carries on the second supersession too');
});

test('Fix round 1 finding 8: a non-domain file that happens to contain a Prefix: line is never read as a domain file', async () => {
  const repo = await project();
  // The old specBlocks treated any docs/spec/*.md file with a line matching /^Prefix:/m as a
  // domain file; lib/spec.mjs's readSpec instead excludes overview.md/glossary.md/roadmap.md by
  // name (NON_DOMAIN) regardless of their prose. A stray "Prefix:" line in overview.md's prose
  // must not make DEMO-001 resolve through a bogus second definition, and must not itself
  // register as an Agreed requirement source.
  await repo.write('docs/spec/overview.md', OVERVIEW + '\nPrefix: not a real domain header\n');
  await repo.write('AGENTS.md', '# Working agreement\n\nRun sudus wake.\n');
  await repo.commit('add a stray Prefix line to overview.md');
  await repo.authorize();
  const b = await item(repo.cwd, { kind: 'backlog', slug: 'still-works', source: 'DEMO-001', body: 'x' });
  assert.ok(b);
  const set = await frozenSet(repo.cwd, 'first');
  assert.deepEqual(set.map((r) => r.requirement), ['CORE-001', 'DEMO-001']);
});

test('Fix round 1 finding 9: a forged second init record surfaces as its own breach message, not a generic no-authorization one', async () => {
  const repo = await project();
  const settingsDigest = (await protectedDigests(repo.cwd)).settings;
  await appendRecord(repo.cwd, 'init', 'project', { settings_digest: settingsDigest, authority_remote: 'origin', auth_mode: 'unsigned-local' });
  const log = await readLog(repo.cwd);
  await assert.rejects(currentAuthorization(repo.cwd, log), /is a second record of kind init on refs\/sudus\/log.*this is a breach/s);
  await assert.rejects(start(repo.cwd, 'first'), /is a second record of kind init on refs\/sudus\/log.*this is a breach/s);
});

test('Fix round 2 finding 6: currentAuthorization classifies AuthError by its code, not by matching message text', async () => {
  const repo = await project();
  // No authorization at all yet: refuseUnauthorizedProtected's own AuthError carries
  // code: 'no-authorization' -- verified directly here, then through currentAuthorization's
  // null-on-failure contract.
  await repo.write('AGENTS.md', '# Working agreement\n\nEdited after authorize.\n');
  const log1 = await readLog(repo.cwd);
  await assert.rejects(refuseUnauthorizedProtected(repo.cwd, log1), (e) => e instanceof AuthError && e.code === 'no-authorization');
  assert.equal(await currentAuthorization(repo.cwd, log1), null);
  // A forged second init record: code: 'breach', rethrown rather than reported as no
  // authorization.
  await repo.authorize();
  const settingsDigest = (await protectedDigests(repo.cwd)).settings;
  await appendRecord(repo.cwd, 'init', 'project', { settings_digest: settingsDigest, authority_remote: 'origin', auth_mode: 'unsigned-local' });
  const log2 = await readLog(repo.cwd);
  await assert.rejects(refuseUnauthorizedProtected(repo.cwd, log2), (e) => e instanceof AuthError && e.code === 'breach');
  await assert.rejects(currentAuthorization(repo.cwd, log2), (e) => e instanceof AuthError && e.code === 'breach');
});

test('Fix round 1 finding 10: a plain start crashed after each write recovers to exactly one start record', async () => {
  for (let n = 0; n < 2; n++) {
    const repo = await project();
    await assert.rejects(start(repo.cwd, 'first', { failAfterWrite: n }), new RegExp(`simulated crash after write ${n}`));
    const log0 = await readLog(repo.cwd);
    const intent = log0.findLast((r) => r.kind === 'command-intent');
    assert.ok(intent, `write ${n}: the intent record exists even after the crash`);
    const r = await recover(repo.cwd, intent.target);
    assert.equal(r.completed, 'forward', `write ${n}: recovery completes forward`);
    const log = await readLog(repo.cwd);
    assert.equal(log.filter((x) => x.kind === 'start' && x.payload.slug === 'first').length, 1, `write ${n}: exactly one start record`);
  }
});

test('Fix round 1 findings 2, 10: a supersession successor start crashed after each write recovers to exactly one start record and Current: moved exactly once', async () => {
  for (let n = 0; n < 3; n++) {
    const repo = await project();
    await start(repo.cwd, 'first');
    await supersede(repo.cwd, 'second', { quote: 'Switch.', env: {} });
    await assert.rejects(start(repo.cwd, 'second', { failAfterWrite: n }), new RegExp(`simulated crash after write ${n}`));
    const log0 = await readLog(repo.cwd);
    const intent = log0.findLast((r) => r.kind === 'command-intent');
    assert.ok(intent, `write ${n}: the intent record exists even after the crash`);
    const r = await recover(repo.cwd, intent.target);
    assert.equal(r.completed, 'forward', `write ${n}: recovery completes forward`);
    const log = await readLog(repo.cwd);
    assert.equal(log.filter((x) => x.kind === 'start' && x.payload.slug === 'second').length, 1, `write ${n}: exactly one successor start record`);
    assert.match(await readFile(join(repo.cwd, 'docs/spec/roadmap.md'), 'utf8'), /^Current: second$/m, `write ${n}: Current: moved exactly once`);
  }
});

test('Fix round 1 findings 2, 10: supersede crashed after each write recovers to exactly one superseded record and one ADR line', async () => {
  for (let n = 0; n < 2; n++) {
    const repo = await project();
    await start(repo.cwd, 'first');
    await assert.rejects(supersede(repo.cwd, 'second', { quote: 'Switch.', env: {}, failAfterWrite: n }), new RegExp(`simulated crash after write ${n}`));
    const log0 = await readLog(repo.cwd);
    const intent = log0.findLast((r) => r.kind === 'command-intent');
    assert.ok(intent, `write ${n}: the intent record exists even after the crash`);
    const r = await recover(repo.cwd, intent.target);
    assert.equal(r.completed, 'forward', `write ${n}: recovery completes forward`);
    const log = await readLog(repo.cwd);
    assert.equal(log.filter((x) => x.kind === 'superseded').length, 1, `write ${n}: exactly one superseded record`);
    assert.equal((await readAdr(repo.cwd)).length, 1, `write ${n}: exactly one ADR line, not one per crash-and-recover attempt`);
  }
});

test('Fix round 1 finding 4: start refuses to move Current: outside a supersession, and still moves it for a pending successor', async () => {
  const repo = await project();
  await assert.rejects(start(repo.cwd, 'second'), /roadmap names first as Current:, not second/);
  await start(repo.cwd, 'first');
  const sup = await supersede(repo.cwd, 'second', { quote: 'Switch.', env: {} });
  const s2 = await start(repo.cwd, 'second');
  assert.equal((await readLog(repo.cwd)).find((r) => r.sha === s2).payload.from_superseded, sup);
  assert.match(await readFile(join(repo.cwd, 'docs/spec/roadmap.md'), 'utf8'), /^Current: second$/m);
});

// Fix round 3

import { stage, preIdentities, readStaging, applyWrites, writeAtomic, effectsHappened } from '../lib/tx.mjs';
import { decisionAppendBytes } from '../lib/adr.mjs';
import { writeWorkspaceSnapshot } from '../lib/snapshots.mjs';
import { preflight } from '../lib/scope.mjs';

test('Fix round 3 finding 1: a crash between an append landing and markDone, followed by a foreign append, then recovery, leaves exactly one copy of the line and a readable ADR', async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const b = await item(repo.cwd, { kind: 'backlog', slug: 'second', source: 'DEMO-002', body: 'Greet by name.' });
  await done(repo.cwd, 'first', { unchecked: true });
  // The same shape of ADR append write promote() itself stages.
  const base_snap = await writeWorkspaceSnapshot(repo.cwd);
  const { bytes: adrBytes } = await decisionAppendBytes(repo.cwd, {
    kind: 'decision', level: 'Consequential', by: 'agent', title: 'Promote second', rests_on: [`item ${b}`],
    wrong_if: 'the item is not covered', body: 'Greet by name.', base_snap, evaluation: null, interfaces: [],
  }, { command: 'promote' });
  const plan = { identity: { i: 1 }, writes: [{ store: 'append', path: 'docs/decisions.jsonl', bytes: adrBytes }],
    terminal: { kind: 'authorization', target: 'protected', payload: {} } };
  const pre = await preIdentities(repo.cwd, plan);
  await stage(repo.cwd, 'TXCRASH1', plan, pre);
  // Simulate a real crash between the bytes reaching disk and markDone recording write 0 as done:
  // the bytes land, but done/0 is never written.
  writeAtomic(join(repo.cwd, 'docs/decisions.jsonl'), adrBytes);
  // A foreign command's own append -- decide(), which takes the same lock but this manual staging
  // never held it -- lands before recovery resumes.
  await decide(repo.cwd, { title: 'Unrelated', rests_on: ['DEMO-001'], wrong_if: 'x', body: 'x' });
  // Recovery resumes: applyWrites re-enters write 0, since done/0 was never written.
  await applyWrites(repo.cwd, await readStaging(repo.cwd, 'TXCRASH1'));
  const text = await readFile(join(repo.cwd, 'docs/decisions.jsonl'), 'utf8');
  assert.equal(text.split(adrBytes).length - 1, 1, 'exactly one copy of the promote decision line');
  const lines = await readAdr(repo.cwd); // throws AdrError on a duplicate id, or any other breach
  assert.equal(lines.length, 2, 'the foreign decision and the promote decision, each once');
});

test('Fix round 3 finding 2: after promote, the scope preflight records no breach for docs/decisions.jsonl', async () => {
  const repo = await project();
  const b = await finished(repo);
  await promote(repo.cwd, b);
  const shas = await preflight(repo.cwd, await readLog(repo.cwd), { command: 'item' });
  assert.deepEqual(shas, []);
  assert.equal((await readLog(repo.cwd)).some((r) => r.kind === 'scope-breach'), false);
});

test("Fix round 3 finding 3: effectsHappened treats a concurrent append to a planned append path as this transaction's own effect only when its staged bytes are present", async () => {
  const repo = await project();
  await start(repo.cwd, 'first');
  const base_snap = await writeWorkspaceSnapshot(repo.cwd);
  const { bytes: adrBytes } = await decisionAppendBytes(repo.cwd, {
    kind: 'decision', level: 'Consequential', by: 'agent', title: 'Not yet written', rests_on: ['DEMO-001'],
    wrong_if: 'x', body: 'x', base_snap, evaluation: null, interfaces: [],
  }, { command: 'decide' });
  const plan = { identity: { i: 1 }, writes: [{ store: 'append', path: 'docs/decisions.jsonl', bytes: adrBytes }],
    terminal: { kind: 'authorization', target: 'protected', payload: {} } };
  const pre = await preIdentities(repo.cwd, plan);
  await stage(repo.cwd, 'TXEFFECT', plan, pre);
  // s.done is {} here and stays that way in this in-memory object even after applyWrites runs
  // below (markDone only writes to disk); reusing this same `s` for both effectsHappened calls
  // means the first check in effectsHappened (Object.keys(s.done).length) never short-circuits,
  // so both calls actually exercise the append-containment path this finding is about.
  const s = await readStaging(repo.cwd, 'TXEFFECT');
  // A concurrent command's own append changes docs/decisions.jsonl's digest, without our own
  // staged bytes ever landing: the old digest-comparison test misread this as "this transaction's
  // effect already happened". Uses appendDecision directly (not decide(), which also takes its
  // own fresh workspace snapshot as a side effect -- a real, but unrelated, effectsHappened signal
  // this test does not want to trip) with the same base_snap, so only docs/decisions.jsonl changes.
  await appendDecision(repo.cwd, {
    kind: 'decision', level: 'Consequential', by: 'agent', title: 'Someone else entirely', rests_on: ['DEMO-001'],
    wrong_if: 'x', body: 'x', base_snap, evaluation: null, interfaces: [],
  }, { command: 'decide' });
  const fakeIntent = { sha: '0'.repeat(40) };
  assert.equal(await effectsHappened(repo.cwd, s, await readLog(repo.cwd), fakeIntent), false,
    "a foreign append to the same path is not this transaction's own effect");
  // Land our own staged bytes for real; effectsHappened now recognizes them as this
  // transaction's own effect.
  await applyWrites(repo.cwd, s);
  assert.equal(await effectsHappened(repo.cwd, s, await readLog(repo.cwd), fakeIntent), true,
    'once our own staged bytes are actually present in the file, effectsHappened recognizes them');
});
