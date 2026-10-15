// Issue #35 (spec revision 18): the commitment log is one append-only chain that is never merged,
// so a clone that did not hold the open commitment could not capture an item without racing the
// clone that did. An item captured on any other clone while the commitment is open goes to that
// clone's own inbox; after Done, wake names folding it onto the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopRepo } from './helpers/loop.mjs';
import { main } from '../lib/cli.mjs';
import { item } from '../lib/commitment.mjs';
import { wake } from '../lib/wake.mjs';
import { readRef } from '../lib/gitx.mjs';
import { appendRecord } from '../lib/records.mjs';
import { cloneId, readInboxes, fold, holder } from '../lib/inbox.mjs';

const OTHER = 'aaaaaaaaaaaa';
async function run(r, argv) {
  let out = '', err = '';
  const code = await main(argv, { cwd: r.cwd, env: {}, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } });
  return { code, out, err };
}
const idea = (slug, body = 'an idea') => ({ kind: 'next-feature', slug, source: 'contract', body });

test("while another clone holds the open commitment, sudus item writes this clone's inbox, and wake names fold after Done (issue #35)", async () => {
  const r = await loopRepo({ clone: OTHER });
  assert.equal(holder(await r.log()), OTHER);
  const before = (await r.log()).length;
  const c = await run(r, ['item', '--backlog', '--slug', 'nicer-greeting', '--from', 'DEMO-001', '--body', 'a nicer greeting']);
  assert.equal(c.code, 0, c.err);
  const me = await cloneId(r.cwd, { create: false });
  const sha = /^item ([0-9a-f]{40}) nicer-greeting in the inbox of clone ([0-9a-f]{12}): another clone holds the open commitment/.exec(c.out);
  assert.ok(sha && sha[2] === me, c.out);
  assert.equal((await r.log()).length, before, 'nothing was appended to the log');
  assert.equal(await readRef(r.cwd, `refs/sudus/inbox/${me}`), sha[1]);
  // The slug is taken wherever it lives.
  await assert.rejects(item(r.cwd, idea('nicer-greeting')), { message: `item slug nicer-greeting is taken in the inbox of clone ${me}` });
  // Listed, not on the log; fold waits for Done, and wake does not name it while the commitment is open.
  let s = await run(r, ['show', 'items']);
  assert.equal(s.out, `${sha[1]} backlog nicer-greeting from DEMO-001 in the inbox of clone ${me}, not on the log; folded after Done: a nicer greeting\n`);
  await assert.rejects(fold(r.cwd), { message: 'sudus: fold runs after Done; first is not done' });
  assert.notEqual((await wake(r.cwd)).action, 'fold');
  // After Done, wake names fold before any promotion; fold appends an ordinary item record.
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  let v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'fold', 'nicer-greeting'], JSON.stringify(v));
  const f = await run(r, ['fold']);
  assert.equal(f.code, 0, f.err);
  const folded = (await r.log()).at(-1);
  assert.deepEqual([folded.kind, folded.payload], ['item', { kind: 'backlog', slug: 'nicer-greeting', source: 'DEMO-001', body: 'a nicer greeting' }]);
  assert.equal(f.out, `fold ${folded.sha} nicer-greeting from the inbox of clone ${me}\n`);
  s = await run(r, ['show', 'items']);
  assert.equal(s.out, `${folded.sha} backlog nicer-greeting from DEMO-001: a nicer greeting\n`);
  v = await wake(r.cwd);
  assert.deepEqual([v.verdict, v.action, v.target], ['Resolvable', 'promote', 'nicer-greeting']);
  assert.equal((await run(r, ['fold'])).out, 'fold: no inbox item waits\n');
});

test('the clone that holds the commitment, and every clone between commitments, writes the log', async () => {
  const mine = await loopRepo({ clone: 'self' });
  const a = await item(mine.cwd, idea('colour'));
  assert.equal((await mine.log()).at(-1).sha, a);
  const r = await loopRepo({ clone: OTHER });
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  assert.equal(holder(await r.log()), null);
  const b = await item(r.cwd, idea('colour'));
  assert.equal((await r.log()).at(-1).sha, b);
  // A start written before 4.2.0 names no clone, so every clone writes the log as before.
  const old = await loopRepo();
  assert.equal(holder(await old.log()), null);
  const c = await item(old.cwd, idea('colour'));
  assert.equal((await old.log()).at(-1).sha, c);
});

test('fold leaves an item in conflict with the log in its inbox and folds the same item from two inboxes once', async () => {
  const r = await loopRepo({ clone: OTHER });
  await item(r.cwd, idea('colour', 'blue'));
  await item(r.cwd, idea('shape', 'round'));
  // Another clone's fetched inbox holds the same shape item.
  await appendRecord(r.cwd, 'item', 'shape', idea('shape', 'round'), `refs/sudus/inbox/${'b'.repeat(12)}`);
  assert.equal((await readInboxes(r.cwd)).length, 3);
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  // The log already holds a different colour item.
  const onLog = await r.add('item', 'colour', idea('colour', 'red'));
  const me = await cloneId(r.cwd, { create: false });
  const s = await run(r, ['show', 'items']);
  assert.match(s.out, new RegExp(`colour from contract in the inbox of clone ${me}, not on the log, in conflict with ${onLog}, which holds its slug: blue\\n`));
  const f = await run(r, ['fold']);
  const lines = f.out.trim().split('\n');
  assert.equal(lines.length, 2, f.out);
  assert.match(lines[0], /^fold [0-9a-f]{40} shape from the inbox of clone /);
  assert.match(lines[1], new RegExp(`^conflict [0-9a-f]{40} colour from the inbox of clone ${me}: ${onLog} holds its slug with a different item; left in the inbox$`));
  assert.equal((await r.log()).filter((x) => x.kind === 'item' && x.payload.slug === 'shape').length, 1);
  // A conflict does not hold wake on fold.
  assert.notEqual((await wake(r.cwd)).action, 'fold');
});

// Review of 57c1366c (issue #71): an inbox item that names a decision is a different item from one
// that does not, and fold keeps the decision it names.
test('fold keeps the decision an inbox item names, and the decision tells two items apart (issue #71)', async () => {
  const { inboxState } = await import('../lib/inbox.mjs');
  const r = await loopRepo();
  const moved = { kind: 'backlog', slug: 'cache', source: 'DEMO-001', body: 'Cache the greeting.', decision: '01K00000000000000000000000' };
  const plain = { kind: 'backlog', slug: 'cache', source: 'DEMO-001', body: 'Cache the greeting.' };
  assert.equal(inboxState([{ sha: 'a', kind: 'item', payload: plain }], [{ sha: 'b', kind: 'item', payload: moved }])[0].state, 'conflict');
  await appendRecord(r.cwd, 'item', 'cache', moved, `refs/sudus/inbox/${OTHER}`);
  await r.add('done', 'first', { slug: 'first', snapshot: await r.snap() });
  await fold(r.cwd);
  assert.deepEqual((await r.log()).find((x) => x.kind === 'item' && x.payload.slug === 'cache').payload, moved);
});
