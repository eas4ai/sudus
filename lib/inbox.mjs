// lib/inbox.mjs: issue #35 (spec revision 18). The commitment log is one append-only chain that is
// never merged, so a clone that was not doing the open commitment's work could not capture an item
// without racing the clone that was: the first push won, and the repair for the other side dropped
// its records. Each clone therefore owns an inbox, refs/sudus/inbox/<clone id>, a chain of item
// records only that clone appends to, so its push always fast-forwards. While a commitment is open,
// an item captured on any clone but the one that started it goes to that clone's inbox. After
// Done, `sudus fold` appends each inbox item to the log as an ordinary item record, so promotion,
// retirement and every other item rule work on it unchanged.
import { randomBytes } from 'node:crypto';
import { git, catCommits } from './gitx.mjs';
import { layoutOf } from './layout.mjs';
import { readLog, appendRecord, decodeRecord, range } from './records.mjs';

export class InboxError extends Error { constructor(m) { super(m); this.name = 'InboxError'; } }
const CLONE = /^[0-9a-f]{12}$/;

// The clone's id, a random token in the clone's own .git/config: a new clone gets a new one, and
// the worktrees of one repository, which share its refs, share it. `create` makes one when the
// clone has none yet; a read that must not write (wake, show items) passes create: false.
export async function cloneId(cwd, { create = true } = {}) {
  const r = await git(['config', '--local', '--get', 'sudus.clone'], { cwd, expect: [0, 1] });
  const have = r.stdout.trim();
  if (r.code === 0 && CLONE.test(have)) return have;
  if (!create) return null;
  const id = randomBytes(6).toString('hex');
  await git(['config', '--local', 'sudus.clone', id], { cwd });
  return id;
}

export const inboxRef = (cwd, id) => `${layoutOf(cwd).inbox}/${id}`;

// The clone that holds the log: the one that started the latest commitment, until that
// commitment's done record. A superseded commitment's clone holds it until the successor starts.
// Between commitments, and under a start written before 4.2.0, no clone holds it and every clone
// appends to the log as before.
export function holder(log) {
  let start = null;
  for (const r of log) {
    if (r.kind === 'start') start = r;
    else if (r.kind === 'done' && start && r.payload.slug === start.payload.slug) start = null;
  }
  return start?.payload.clone ?? null;
}

// Every inbox this clone holds, its own and those fetched from the authority remote, as item
// records with the clone they came from: inboxes in clone-id order, each oldest first. Read apart
// from readLog, whose one-entry cache holds the log. A record of any other kind in an inbox is
// not an item and is skipped.
export async function readInboxes(cwd) {
  const L = layoutOf(cwd);
  const refs = (await git(['for-each-ref', '--format=%(refname) %(objectname)', `${L.inbox}/`], { cwd })).stdout.split('\n').filter(Boolean).sort();
  const out = [];
  for (const line of refs) {
    const [ref, head] = line.split(' ');
    const clone = ref.slice(L.inbox.length + 1);
    const shas = (await git(['rev-list', '--first-parent', '--reverse', head], { cwd })).stdout.trim().split('\n').filter(Boolean);
    const commits = await catCommits(cwd, shas);
    shas.forEach((sha, i) => {
      const { kind, target, payload } = decodeRecord(commits[i]);
      if (kind === 'item') out.push({ sha, kind, target, payload, clone });
    });
  }
  return out;
}

// Each inbox item against the log: `folded` when the log holds an item with its slug, kind,
// source, body and decision; `conflict` when the log, or an earlier inbox item, holds a different item under
// its slug; otherwise `waiting` to be folded. The same item captured in two inboxes folds once.
export function inboxState(log, inbox) {
  const same = (a, b) => a.kind === b.kind && a.source === b.source && a.body === b.body && a.decision === b.decision;
  const onLog = new Map(log.filter((r) => r.kind === 'item').map((r) => [r.payload.slug, r]));
  const claimed = new Map();
  return inbox.map((it) => {
    const slug = it.payload.slug;
    const on = onLog.get(slug);
    if (on) return { item: it, state: same(on.payload, it.payload) ? 'folded' : 'conflict', with: on.sha };
    const first = claimed.get(slug);
    if (first) return { item: it, state: same(first.payload, it.payload) ? 'duplicate' : 'conflict', with: first.sha };
    claimed.set(slug, it);
    return { item: it, state: 'waiting', with: null };
  });
}

// True while a commitment is open or a supersession from it waits for its successor: the log's
// latest start has no done record.
function underway(log) {
  const r = range(log);
  return Boolean(r.start) && !r.records.some((x) => x.kind === 'done' && x.payload.slug === r.start.payload.slug);
}

// `sudus fold`: after Done, append every waiting inbox item to the log as an ordinary item record,
// oldest inbox first. A conflicting item stays in its inbox and is reported.
export async function fold(cwd) {
  const log = await readLog(cwd);
  if (underway(log)) throw new InboxError(`sudus: fold runs after Done; ${range(log).start.payload.slug} is not done`);
  const states = inboxState(log, await readInboxes(cwd));
  const folded = [];
  for (const s of states.filter((x) => x.state === 'waiting')) {
    const { kind, slug, source, body, decision } = s.item.payload;
    const payload = decision === undefined ? { kind, slug, source, body } : { kind, slug, source, body, decision };
    folded.push({ slug, clone: s.item.clone, sha: await appendRecord(cwd, 'item', slug, payload) });
  }
  return { folded, conflicts: states.filter((x) => x.state === 'conflict') };
}
