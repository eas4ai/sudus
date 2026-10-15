import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, draftDigest, parseConcern, DraftError } from '../lib/escalate.mjs';

export const draft = (over = {}) => ({
  commitment: 'first', concerns: ['DEMO-001'],
  question: 'Should the greeter keep sessions for 30 days?',
  recommendation: 'Yes, 30 days, refreshed on use.',
  because: 'The spec names no length and tests/session.test.mjs assumes 30.',
  if_wrong: 'Users stay logged in on shared machines longer than intended.',
  instead: 'Seven days with no refresh.',
  options: [], named_paths: ['src/demo.mjs'], cited_decisions: [], ...over,
});

test('a complete draft validates, keeps an optional evaluation, and digests deterministically', () => {
  const d = draft();
  assert.equal(validateDraft(d), d);
  assert.equal(validateDraft(draft({ evaluation: 'e'.repeat(40) })).evaluation, 'e'.repeat(40));
  assert.equal(draftDigest(draft()), draftDigest(draft()));
  assert.match(draftDigest(draft()), /^sha256:[0-9a-f]{64}$/);
});

test('each of the five fields must be one non-empty line', () => {
  for (const f of ['question', 'recommendation', 'because', 'if_wrong', 'instead']) {
    assert.throws(() => validateDraft(draft({ [f]: '' })), DraftError);
    assert.throws(() => validateDraft(draft({ [f]: 'two\nlines' })), DraftError);
    assert.throws(() => validateDraft(draft({ [f]: 7 })), DraftError);
  }
});

// Fix round 1 finding 8 (plan 09 review): BAD_CHARS blocked C0 controls and DEL but not U+0085
// (NEL), U+2028 (LINE SEPARATOR), U+2029 (PARAGRAPH SEPARATOR) or the other C1 controls
// (U+0080-U+009F), so a "one non-empty line" field could carry a Unicode line terminator the
// terminal renders as a line break. A tab still survives (Task 8's own byte-for-byte test), and
// an ordinary Unicode character that is not a line terminator, such as U+00A0 (non-breaking
// space), still validates -- only line-breaking code points are refused.
test('a Unicode line terminator (NEL, LINE SEPARATOR, PARAGRAPH SEPARATOR) or another C1 control is refused; a tab and an ordinary Unicode character still validate', () => {
  for (const f of ['question', 'recommendation', 'because', 'if_wrong', 'instead']) {
    for (const ch of ['\u0085', '\u2028', '\u2029', '\u0090']) {
      assert.throws(() => validateDraft(draft({ [f]: `one${ch}line` })), DraftError, `${f} with U+${ch.codePointAt(0).toString(16)}`);
    }
    assert.equal(validateDraft(draft({ [f]: 'a\ttab and a\u00a0non-breaking space' }))[f], 'a\ttab and a\u00a0non-breaking space');
  }
});

test('unknown keys, missing keys, an empty concern list and malformed tokens are refused', () => {
  assert.throws(() => validateDraft({ ...draft(), score: 1 }), /unknown field score/);
  const d = draft(); delete d.options;
  assert.throws(() => validateDraft(d), /missing options/);
  assert.throws(() => validateDraft(draft({ concerns: [] })), /at least one concern/);
  assert.throws(() => validateDraft(draft({ concerns: ['finding:abc#1'] })), /concern token/);
  assert.throws(() => validateDraft(draft({ concerns: ['finding:' + 'a'.repeat(40) + '#0'] })), /concern token/);
  assert.throws(() => validateDraft(draft({ concerns: ['DEMO-001 extra'] })), /concern token/);
  assert.throws(() => validateDraft(draft({ evaluation: 'nope' })), /evaluation must be a log SHA/);
  assert.deepEqual(parseConcern('finding:' + 'a'.repeat(40) + '#3'), { kind: 'finding', ref: 'a'.repeat(40), n: 3 });
  assert.deepEqual(parseConcern('DEMO-001'), { kind: 'requirement', ref: 'DEMO-001', n: null });
  assert.deepEqual(parseConcern('cycle'), { kind: 'cycle', ref: null, n: null });
});

import { loopRepo } from './helpers/loop.mjs';
import { readLog, decodeRecord, KINDS, appendRecord } from '../lib/records.mjs';
import { catCommit } from '../lib/gitx.mjs';
import { escalate, escalationsFor } from '../lib/escalate.mjs';

test('escalate writes an escalation record targeted at the commitment with the five fields, joined concerns and evaluation', async () => {
  for (const k of ['escalation', 'answer', 'reply']) assert.ok(KINDS.has(k), `${k} is a log kind`);
  const r = await loopRepo();
  const sha = await escalate(r.cwd, draft());
  const commit = await catCommit(r.cwd, sha);
  assert.equal(commit.subject, 'sudus: escalation first');
  assert.deepEqual(commit.trailers.map(([k]) => k), ['Sudus-Schema', 'Sudus-Digest']);
  const rec = decodeRecord(commit);
  assert.deepEqual(rec.payload, {
    slug: 'first', question: draft().question, recommendation: draft().recommendation, because: draft().because,
    if_wrong: draft().if_wrong, instead: draft().instead, concerns: 'DEMO-001', evaluation: null,
  });
  const two = await escalate(r.cwd, draft({ concerns: ['DEMO-001', 'contract:AGENTS.md'], evaluation: 'e'.repeat(40) }));
  const p = decodeRecord(await catCommit(r.cwd, two)).payload;
  assert.deepEqual([p.concerns, p.evaluation], ['DEMO-001 contract:AGENTS.md', 'e'.repeat(40)]);
  assert.deepEqual(escalationsFor(await r.log(), 'first').map((e) => e.sha), [sha, two]);
});

test('escalate refuses a closed or foreign commitment and a concern that names nothing in the range', async () => {
  const r = await loopRepo();
  await assert.rejects(escalate(r.cwd, draft({ commitment: 'other' })), /no open commitment other/);
  await assert.rejects(escalate(r.cwd, draft({ concerns: ['ZZZ-999'] })), /ZZZ-999 is not in the frozen set/);
  await assert.rejects(escalate(r.cwd, draft({ concerns: ['finding:' + 'f'.repeat(40) + '#1'] })), /no record f{40} in the open range/);
  const rev = await r.review([{ n: 1, text: 'no empty-input test' }]);
  await assert.rejects(escalate(r.cwd, draft({ concerns: [`finding:${rev}#2`] })), /has no finding 2/);
  await assert.rejects(escalate(r.cwd, draft({ concerns: ['item:' + rev] })), /no item record/);
  assert.match(await escalate(r.cwd, draft({ concerns: [`finding:${rev}#1`] })), /^[0-9a-f]{40}$/);
});
// Review of 3.8.2: a decision: token was checked for its shape only, so an escalation could name
// a decision that never existed.
test('escalate refuses a decision: concern that names no decision in the ADR', async () => {
  const r = await loopRepo();
  await assert.rejects(escalate(r.cwd, draft({ concerns: ['decision:01ARZ3NDEKTSV4RRFFQ69G5FAV'] })), /no decision 01ARZ3NDEKTSV4RRFFQ69G5FAV in docs\/decisions\.jsonl/);
  await r.decide();
  const id = (await readAdr(r.cwd)).find((l) => l.kind === 'decision').id;
  assert.match(await escalate(r.cwd, draft({ concerns: [`decision:${id}`] })), /^[0-9a-f]{40}$/);
});

import { readAdr } from '../lib/adr.mjs';
import { decideConsequential, escalateConsequential } from '../lib/escalate.mjs';

// Plan 16, Task 4 fix round 1 (Important #1): escalateWithRoute (and its constant `route: 'developer'`
// field) is deleted outright here, not merely left untested -- it had no remaining caller once
// escalateCommand (lib/cli.mjs) was rewritten to call escalateConsequential/escalate() directly, and
// no other module imported it (verified by grep across lib/, bin/, tests/, skills/). Its own two
// tests, which used to live here, are removed with it rather than kept pointing at a deleted export.
// The router design escalateWithRoute embodied (decisions 55/56) was already superseded before this
// plan; escalateConsequential (this file, above) and its own tests are the current, exercised path.

// Deviation from this test's original text (superseded by plan 16 task 3): before this task,
// decideConsequential wrote a decision line straight from the draft's own optional `evaluation`
// field, needing no measurement at all -- "accepts the same canonical draft and writes the same
// line without an evaluation". Task 3 makes currentMeasurement (lib/evaluate.mjs) the sole source
// of the decision line's `evaluation` field (Global Constraints: nothing routes a floor-caught or
// vetoed draft to the agent, and only a composite-outcome measurement permits deciding at all), so
// a draft with no measurement at all -- loopRepo()'s own fixture never calls measure() -- is now
// refused, not decided. The pre-measurement refusals (a malformed field, a concern outside the
// frozen set) still run first, unchanged, since checkConcerns runs before currentMeasurement is
// ever consulted; only the final assertion (a bare decide with no evaluation succeeding) no longer
// holds and is replaced by the new required refusal. Coverage for the successful,
// measurement-backed path is the 'decideConsequential requires a measurement' describe block below.
test('sudus decide --consequential still refuses a malformed draft or an out-of-set concern before ever consulting a measurement; a draft with no measurement at all is refused too', async () => {
  const r = await loopRepo();
  await assert.rejects(decideConsequential(r.cwd, draft({ because: '' })), DraftError);
  await assert.rejects(decideConsequential(r.cwd, draft({ concerns: ['ZZZ-999'] })), /not in the frozen set/);
  await assert.rejects(decideConsequential(r.cwd, draft()), /no measurement/);
});

import { answer, escalationState, unanswered } from '../lib/escalate.mjs';
import { describeEvidence, verifyEvidence } from '../lib/auth.mjs';
import { loadSettings } from '../lib/settings.mjs';
import { ADR_PATH, AdrError } from '../lib/adr.mjs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const asDev = { quote: 'ok', env: {} };

// Fix round 2 finding 14: a signed-project fixture with an open commitment, built the same way
// as tests/cli.test.mjs's own signedCommitmentRepo (round 1, finding 1) -- signedProject-style
// real-key init has no open commitment to escalate against, so the domain spec/roadmap/authorize/
// start steps are added here too. Self-contained (no cleanup registered), matching this file's
// own convention (loopRepo's fixtures are not cleaned up either).
import { makeRepo } from './helpers/repo.mjs';
import { OVERVIEW, DEMO, CORE, ROADMAP } from './helpers/commitment-fixture.mjs';
import { init } from '../lib/init.mjs';
import { authorize } from '../lib/auth.mjs';
import { start } from '../lib/commitment.mjs';

async function signedCommitmentRepo() {
  const { generateKeyPairSync, sign: cryptoSign } = await import('node:crypto');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const sign = async (bytes) => new Uint8Array(cryptoSign(null, bytes, privateKey));
  const repo = await makeRepo();
  await repo.write('AGENTS.md', '# Working agreement\n\nRun sudus wake.\n');
  await repo.write('docs/spec/overview.md', OVERVIEW);
  await repo.write('docs/spec/glossary.md', '# Glossary\n\ngreeter: the program.\n');
  await repo.write('docs/spec/demo.md', DEMO);
  await repo.write('docs/spec/core.md', CORE);
  await repo.write('docs/spec/roadmap.md', ROADMAP);
  await repo.write('src/main.mjs', 'console.log("hello");\n');
  await repo.commit('Add the demo specification');
  await init(repo.dir, { localOnly: true, signingKeyPem: pem, sign, env: {} });
  await authorize(repo.dir, { sign });
  await start(repo.dir, 'first');
  return { cwd: repo.dir, sign };
}

// Fix round 1 finding 2 (Important, plan 09 review): answer() used to append the answer log
// record, then the answered ADR line, with no pre-check -- a malformed docs/decisions.jsonl (an
// unreadable ADR, a held lock, or a liveness refusal) failed the SECOND write after the FIRST
// already landed: the escalation reads as answered (escalationState sees the log record) but no
// answered line exists and no command could ever write one, since answer() itself refuses "no
// unanswered escalation" once the log record exists, and lib/adr.mjs's prepareLine refuses an
// answered line from any command but answer. Reproduced exactly as the review found it: one
// malformed line appended to docs/decisions.jsonl before the call.
test('answer refuses before writing anything when the ADR file is unreadable (finding 2)', async () => {
  const r = await loopRepo();
  await escalate(r.cwd, draft());
  await appendFile(join(r.cwd, ADR_PATH), 'not json\n');
  await assert.rejects(answer(r.cwd, 'first', 'ok', asDev), (e) => e instanceof AdrError && /not canonical JSON/.test(e.message));
  assert.deepEqual((await r.log()).filter((x) => x.kind === 'answer'), []);
  assert.equal(unanswered(await r.log()).length, 1);
});

// Fix round 1 finding 2: a crash between the two writes -- the log record lands, the ADR line
// does not -- is simulated directly (appendRecord bypasses answer()'s own ADR step, the same way
// a real crash would leave the process dead between the two calls). The NEXT sudus answer for
// the same slug completes the missing line instead of refusing "no unanswered escalation"; it
// returns the existing answer's sha rather than writing a duplicate one. A third call, once the
// line exists, refuses normally: there is nothing left to answer or repair.
// Fix round 2 finding 13 (plan 09 re-review, ruling): the completion path used to return the
// completed answer's sha as if it were a success for THIS call, silently dropping the
// developer's own kind/text. Now it completes the dangling line, then refuses the new answer
// with a message naming the completed sha, so nothing is lost silently.
test('a crash between the log record and the ADR line is completed by the next sudus answer for the same slug, which then refuses so nothing is lost (finding 2, finding 13)', async () => {
  const r = await loopRepo();
  const esc = await escalate(r.cwd, draft());
  const evidence = { mode: 'unsigned-local', purpose: 'answer', subject: esc, nonce: 'n', author: { name: 'Dev', email: 'dev@example.test' }, confirmed: true };
  const danglingSha = await r.add('answer', 'first', { escalation: esc, kind: 'ok', text: '', owner: null, evidence });
  assert.equal((await readAdr(r.cwd)).some((l) => l.kind === 'answered'), false);
  assert.equal(escalationState(await r.log(), esc).status, 'answered');
  await assert.rejects(
    answer(r.cwd, 'first', 'instead', { ...asDev, quote: 'Fourteen days instead.' }),
    new RegExp(`sudus: completed the dangling answer ${danglingSha} for first; run the command again$`),
  );
  // No new answer record: the developer's own "instead" text for this call was never recorded.
  assert.deepEqual((await r.log()).filter((x) => x.kind === 'answer').map((x) => x.sha), [danglingSha]);
  const line = (await readAdr(r.cwd)).find((l) => l.kind === 'answered');
  assert.deepEqual([line.escalation, line.answer], [esc, danglingSha]);
  // Now that the line exists, a normal retry (nothing left dangling) refuses normally.
  await assert.rejects(answer(r.cwd, 'first', 'ok', asDev), /no unanswered escalation for first/);
});

// Fix round 2 finding 13, the reviewer's exact reproduction: a dangling answer for escalation A
// exists alongside a genuinely open escalation B. Completing A must not consume the developer's
// answer for B, and B must still be answerable normally afterward.
test('a dangling answer is completed even while another escalation is open; the developer\'s own answer is not applied to the wrong one (finding 13)', async () => {
  const r = await loopRepo();
  const a = await escalate(r.cwd, draft());
  const b = await escalate(r.cwd, draft({ question: 'Second?' }));
  const evidence = { mode: 'unsigned-local', purpose: 'answer', subject: a, nonce: 'n', author: { name: 'Dev', email: 'dev@example.test' }, confirmed: true };
  const danglingSha = await r.add('answer', 'first', { escalation: a, kind: 'ok', text: '', owner: null, evidence });
  assert.deepEqual(unanswered(await r.log()).map((u) => u.sha), [b]);
  await assert.rejects(
    answer(r.cwd, 'first', 'instead', { ...asDev, quote: 'Do X instead.' }),
    new RegExp(`sudus: completed the dangling answer ${danglingSha} for first; run the command again$`),
  );
  // B is still open: the "instead" text was not silently applied to it.
  assert.deepEqual(unanswered(await r.log()).map((u) => u.sha), [b]);
  assert.deepEqual((await r.log()).filter((x) => x.kind === 'answer').map((x) => x.sha), [danglingSha]);
  const line = (await readAdr(r.cwd)).find((l) => l.kind === 'answered');
  assert.deepEqual([line.escalation, line.answer], [a, danglingSha]);
  // B can now be answered normally, on the next call.
  const bSha = await answer(r.cwd, 'first', 'ok', asDev);
  assert.equal(decodeRecord(await catCommit(r.cwd, bSha)).payload.escalation, b);
});

// Fix round 2 finding 14: the completion path wrote the ADR line with no developer evidence at
// all. It must authenticate (and verify) before writing, exactly as the normal path does, so in
// a signed project an unsigned completion attempt is refused, not silently allowed through.
test('the dangling-answer completion path authenticates before writing the ADR line; an unsigned completion in a signed project refuses (finding 14)', async () => {
  const { cwd, sign } = await signedCommitmentRepo();
  const esc = await escalate(cwd, draft());
  const danglingEvidence = { mode: 'unsigned-local', purpose: 'answer', subject: esc, nonce: 'n', author: { name: 'Dev', email: 'dev@example.test' }, confirmed: true };
  const danglingSha = await appendRecord(cwd, 'answer', 'first', { escalation: esc, kind: 'ok', text: '', owner: null, evidence: danglingEvidence });
  await assert.rejects(answer(cwd, 'first', 'ok', {}), /sudus: /);
  assert.equal((await readAdr(cwd)).some((l) => l.kind === 'answered'), false);
  await assert.rejects(
    answer(cwd, 'first', 'ok', { sign }),
    new RegExp(`sudus: completed the dangling answer ${danglingSha} for first; run the command again$`),
  );
  const line = (await readAdr(cwd)).find((l) => l.kind === 'answered');
  assert.deepEqual([line.escalation, line.answer], [esc, danglingSha]);
});

test('answer refuses without developer evidence: no quote, or a blank quote', async () => {
  const r = await loopRepo();
  const sha = await escalate(r.cwd, draft());
  await assert.rejects(answer(r.cwd, 'first', 'ok'), /sudus: /);
  await assert.rejects(answer(r.cwd, 'first', 'ok', { quote: '  ', env: {} }), /sudus: /);
  assert.equal(escalationState(await r.log(), sha).status, 'open');
});

// The stored evidence is lib/auth.mjs's real attested evidence shape: {mode, purpose, subject,
// nonce, quote, harness, author: {name, email}}. answer()'s text field is the same quote (revision
// 6: the developer's quoted words serve both as the record's text and the authentication evidence).
test('ok writes the answer record with the evidence and the answered ADR line', async () => {
  const r = await loopRepo();
  const esc = await escalate(r.cwd, draft());
  const sha = await answer(r.cwd, 'first', 'ok', asDev);
  const rec = decodeRecord(await catCommit(r.cwd, sha));
  assert.equal(rec.target, 'first');
  assert.deepEqual([rec.payload.escalation, rec.payload.kind, rec.payload.text, rec.payload.owner], [esc, 'ok', 'ok', null]);
  assert.equal(rec.payload.evidence.mode, 'attested');
  assert.equal(rec.payload.evidence.quote, 'ok');
  assert.ok(rec.payload.evidence.author.name.length > 0);
  const line = (await readAdr(r.cwd)).find((l) => l.kind === 'answered');
  assert.deepEqual([line.escalation, line.answer], [esc, sha]);
  assert.equal(escalationState(await r.log(), esc).status, 'answered');
  assert.deepEqual(unanswered(await r.log()), []);
  await assert.rejects(answer(r.cwd, 'first', 'instead', { ...asDev, quote: 'no' }), /no unanswered escalation for first/);
});

test('ask stays open until a reply and writes no answered line; every kind needs --quote; kinds are closed', async () => {
  const r = await loopRepo();
  const esc = await escalate(r.cwd, draft());
  await assert.rejects(answer(r.cwd, 'first', 'instead', { ...asDev, quote: '' }), /needs --quote/);
  await assert.rejects(answer(r.cwd, 'first', 'maybe', { ...asDev, quote: 'x' }), /must be ok, instead or ask/);
  await answer(r.cwd, 'first', 'ask', { ...asDev, quote: 'Why 30 and not 14?' });
  const log = await r.log();
  assert.equal(escalationState(log, esc).status, 'asked');
  assert.deepEqual(unanswered(log).map((u) => [u.target, u.awaiting]), [['first', 'reply']]);
  assert.equal((await readAdr(r.cwd)).some((l) => l.kind === 'answered'), false);
  await assert.rejects(answer(r.cwd, 'first', 'ok', asDev), /awaits the agent's reply/);
});

test('two open escalations: the oldest is answered first unless --escalation names the other', async () => {
  const r = await loopRepo();
  const a = await escalate(r.cwd, draft());
  const b = await escalate(r.cwd, draft({ question: 'Second?' }));
  const s2 = await answer(r.cwd, 'first', 'ok', { ...asDev, escalation: b });
  assert.equal(decodeRecord(await catCommit(r.cwd, s2)).payload.escalation, b);
  const s1 = await answer(r.cwd, 'first', 'ok', asDev);
  assert.equal(decodeRecord(await catCommit(r.cwd, s1)).payload.escalation, a);
});

// Fix round 1 finding 6 (plan 09 review): escalate.mjs's own describeEvidence read ev.author as
// a string, but the answer record's real stored evidence (authenticateDeveloper's return value,
// stored as-is since Task 4) has author: {name, email} -- so calling it on a real stored record
// produced "..., author [object Object]: evidence, not authentication". lib/auth.mjs already
// exports a describeEvidence that reads the real shape; checked here against a real stored answer
// record instead of a hand-built flat object.
test('describeEvidence (lib/auth.mjs) reads a real stored answer record: attested is evidence, not authentication', async () => {
  const r = await loopRepo();
  const esc = await escalate(r.cwd, draft());
  const sha = await answer(r.cwd, 'first', 'ok', asDev);
  const rec = decodeRecord(await catCommit(r.cwd, sha));
  assert.equal(describeEvidence(rec.payload.evidence), 'attested: "ok" through none by Sudus Test <test@example.invalid>; evidence, not authentication');
});

// Fix round 1 finding 7 (plan 09 review): answer() now re-checks its evidence with
// verifyEvidence right after authenticateDeveloper, the same defence-in-depth authorize() and
// readDecision() already apply. The review notes no live hole exists today (authenticateDeveloper
// itself already verifies a signature and always returns confirmed: true for unsigned-local, so
// no public-API path can make it return evidence verifyEvidence rejects); this is a positive
// regression check that the added call does not itself break the happy path, and that the
// evidence answer() stores is exactly what lib/auth.mjs's own verifyEvidence accepts.
test('the evidence answer() stores verifies with lib/auth.mjs verifyEvidence, the same check answer() now runs before writing', async () => {
  const r = await loopRepo();
  const esc = await escalate(r.cwd, draft());
  const sha = await answer(r.cwd, 'first', 'ok', asDev);
  const rec = decodeRecord(await catCommit(r.cwd, sha));
  const { settings } = await loadSettings(r.cwd);
  assert.equal(verifyEvidence(settings, rec.payload.evidence, { purpose: 'answer', subject: esc }), true);
});

import { reply } from '../lib/escalate.mjs';

test('reply names the open ask; after it the escalation awaits the developer again', async () => {
  const r = await loopRepo();
  const esc = await escalate(r.cwd, draft());
  await assert.rejects(reply(r.cwd, 'first', 'Because the fixture says so.'), /no open ask/);
  await answer(r.cwd, 'first', 'ask', { ...asDev, quote: 'Why 30?' });
  await assert.rejects(reply(r.cwd, 'first', ''), /reply needs text/);
  const sha = await reply(r.cwd, 'first', 'Because the fixture says so.');
  assert.deepEqual(decodeRecord(await catCommit(r.cwd, sha)).payload, { escalation: esc, text: 'Because the fixture says so.' });
  const log = await r.log();
  assert.equal(escalationState(log, esc).status, 'open');
  assert.deepEqual(unanswered(log).map((u) => u.awaiting), ['answer']);
  await assert.rejects(reply(r.cwd, 'first', 'Again.'), /no open ask/);
  await answer(r.cwd, 'first', 'instead', { ...asDev, quote: 'Fourteen days.' });
  assert.equal(escalationState(await r.log(), esc).final.payload.text, 'Fourteen days.');
});

import { escalate as escalateDraft, disputes } from '../lib/escalate.mjs';

// Sudus 4.0.0 removed `sudus dispute`: the builder declines a finding itself. An escalation may
// still name a finding when the builder chooses to ask, and the developer's ok closes it.
const disputeFields = (record, n) => ({
  commitment: 'first', concerns: [`finding:${record}#${n}`],
  question: `Is finding ${n} a defect?`, recommendation: 'No: the check reads the declared fixture.',
  because: 'hello.txt is in the mechanism inputs.', if_wrong: 'A hidden input goes undeclared.', instead: 'Declare it and re-run.',
  options: [], named_paths: [], cited_decisions: [],
});
const dispute = (cwd, d) => escalateDraft(cwd, d);

// Fix round 1 finding 5 (plan 09 review, ruling): a dispute is settled ONLY by the developer's
// ok answer, not by any non-ask final answer. An `instead` answer is the developer declining the
// agent's reading and directing different work; treating it as "the finding is answered" would
// close a finding the developer just refused to dismiss. Matches the codebase's only other
// precedent, lib/scope.mjs's keep disposition, which requires "an escalation answered ok".
test('an escalation naming finding N on its exact source record is settled only by the developer\'s ok answer', async () => {
  const r = await loopRepo();
  const rev = await r.review([{ n: 1, text: 'reads an undeclared fixture' }, { n: 2, text: 'no test for empty input' }]);
  await assert.rejects(dispute(r.cwd, disputeFields(rev, 3)), /has no finding 3/);
  const sha = await dispute(r.cwd, disputeFields(rev, 1));
  assert.equal(decodeRecord(await catCommit(r.cwd, sha)).payload.concerns, `finding:${rev}#1`);
  assert.equal(disputes(await r.log(), rev, 1), null);
  await answer(r.cwd, 'first', 'ask', { ...asDev, quote: 'Which fixture?' });
  assert.equal(disputes(await r.log(), rev, 1), null);
  await reply(r.cwd, 'first', 'hello.txt');
  await answer(r.cwd, 'first', 'ok', asDev);
  const log = await r.log();
  assert.equal(disputes(log, rev, 1), sha);
  assert.equal(disputes(log, rev, 2), null);
});

test('an instead answer keeps the dispute open: it directs the resolution but does not settle it', async () => {
  const r = await loopRepo();
  const rev = await r.review([{ n: 1, text: 'reads an undeclared fixture' }]);
  const sha = await dispute(r.cwd, disputeFields(rev, 1));
  await answer(r.cwd, 'first', 'instead', { ...asDev, quote: 'Declare hello.txt as an input and re-run.' });
  assert.equal(escalationState(await r.log(), sha).status, 'answered');
  assert.equal(disputes(await r.log(), rev, 1), null);
});

import { concerns, escalatedRequirement } from '../lib/escalate.mjs';

test('an escalation concerning a requirement is found by identifier, answered or not', async () => {
  const r = await loopRepo({ reqs: ['DEMO-001', 'DEMO-002'] });
  assert.equal(escalatedRequirement(await r.log(), 'DEMO-001'), false);
  const sha = await escalate(r.cwd, draft({ question: 'Three attempts failed; change the falsifier?' }));
  let log = await r.log();
  assert.equal(escalatedRequirement(log, 'DEMO-001'), true);
  assert.equal(escalatedRequirement(log, 'DEMO-002'), false);
  assert.deepEqual(concerns(log, 'DEMO-001').map((e) => e.sha), [sha]);
  assert.deepEqual(concerns(log, 'DEMO-00'), []);
  await answer(r.cwd, 'first', 'ok', asDev);
  log = await r.log();
  assert.equal(escalatedRequirement(log, 'DEMO-001'), true);
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { wake, render } from '../lib/wake.mjs';
const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/sudus.mjs', import.meta.url));

// Courtesy update, not one of the plan 09 review's 12 items: another (already-committed) fix
// round on lib/wake.mjs, "Fix round 1 item 7: Waiting's render drops the answer line section 6
// does not name, tested byte for byte", removed the trailing `answer: sudus answer ...` line from
// render()'s Waiting output (section 6's own contract is verdict, action or party, one reason
// line and the predicate; that line named a command the five fields never claimed to include).
// The five-fields-verbatim assertion below this plan actually owns is unaffected and still holds
// byte for byte; only the now-removed trailing line's own assertion is dropped, so this file's
// suite is green again against the current, stable lib/wake.mjs contract.
test('the five fields reach the terminal byte for byte: double spaces, trailing space, quotes and a tab survive', async () => {
  const r = await loopRepo();
  const fields = {
    question: 'Keep  "sessions" for 30 days?', recommendation: 'Yes, 30 days, refreshed on use. ',
    because: 'tests/session.test.mjs\tassumes 30.', if_wrong: 'Shared machines stay logged in.', instead: 'Seven days.',
  };
  await escalate(r.cwd, draft(fields));
  const expected = Buffer.from(
    `question: ${fields.question}\nrecommendation: ${fields.recommendation}\nbecause: ${fields.because}\nif wrong: ${fields.if_wrong}\ninstead: ${fields.instead}\n`, 'utf8');
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting');
  assert.ok(Buffer.from(render(v), 'utf8').indexOf(expected) >= 0, 'render carries the exact bytes');
  const { stdout } = await run(process.execPath, [BIN, 'wake'], { cwd: r.cwd, encoding: 'buffer' });
  assert.ok(stdout.indexOf(expected) >= 0, 'stdout carries the exact bytes');
});

import { parseEscalateArgs, cliEscalate, cliAnswer, cliReply } from '../lib/escalate.mjs';

const argv = ['--commitment', 'first', '--concern', 'DEMO-001', '--question', draft().question, '--recommendation', draft().recommendation,
  '--because', draft().because, '--if-wrong', draft().if_wrong, '--instead', draft().instead, '--path', 'src/demo.mjs'];

test('the escalate command parses the five fields and concern tokens into the canonical draft', () => {
  assert.deepEqual(parseEscalateArgs(argv), draft());
  assert.throws(() => parseEscalateArgs(argv.slice(0, -4)), /missing --instead/);
  assert.throws(() => parseEscalateArgs([...argv, '--bogus', 'x']), /unknown flag --bogus/);
  assert.deepEqual(parseEscalateArgs([...argv, '--concern', 'cycle']).concerns, ['DEMO-001', 'cycle']);
});

test('escalate, answer and reply commands print one line and use exit codes 0 and 1', async () => {
  const r = await loopRepo();
  const e = await cliEscalate(r.cwd, argv);
  assert.equal(e.code, 0);
  assert.match(e.out, /^sudus: escalation first [0-9a-f]{40}\n$/);
  const bad = await cliAnswer(r.cwd, ['first', 'ok'], { env: {} });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^sudus: .*\n$/);
  const ask = await cliAnswer(r.cwd, ['first', 'ask', '--quote', 'Why?'], { env: {} });
  assert.match(ask.out, /^sudus: answer first [0-9a-f]{40}\n$/);
  const rp = await cliReply(r.cwd, ['first', 'Because.']);
  assert.match(rp.out, /^sudus: reply first [0-9a-f]{40}\n$/);
});

// Issue #27, kept after 4.0.0 removed `sudus dispute`: one escalation may name several findings of
// the same record, and one ok closes them all.
test('one escalation names several findings with repeated --concern, and one ok closes them all', async () => {
  const r = await loopRepo();
  const rev = await r.review([1, 2, 3, 4].map((n) => ({ n, text: `gap ${n}` })));
  const base = ['--commitment', 'first', '--question', 'Close these as answered?', '--recommendation', 'Close them; they are backlog item X.', '--because', 'the gaps predate the commitment', '--if-wrong', 'a gap ships', '--instead', 'fix them now'];
  const d = await cliEscalate(r.cwd, [...base, ...[1, 2, 3].flatMap((n) => ['--concern', `finding:${rev}#${n}`])]);
  assert.equal(d.code, 0, d.out);
  const esc = d.out.trim().split(' ').at(-1);
  const v = await wake(r.cwd);
  assert.equal(v.verdict, 'Waiting');
  assert.deepEqual(v.escalation.closes, [1, 2, 3].map((n) => `finding ${n} on the review ${rev.slice(0, 12)}`));
  assert.equal((await cliAnswer(r.cwd, ['first', 'ok', '--quote', 'ok, close them'], { env: {} })).code, 0);
  const after = await readLog(r.cwd);
  assert.deepEqual([1, 2, 3, 4].map((n) => disputes(after, rev, n)), [esc, esc, esc, null]);
});

// Fix round 1 finding 12 (plan 09 review, new): a CAS refusal on refs/sudus/log (two writers
// racing to extend the same log) used to reach the CLI as a bare
// "sudus: refusing refs/sudus/log: expected <sha>" with no guidance and no automatic retry. Six
// cliEscalate calls race concurrently from the same starting log state, sharing one --concern so
// checkConcerns has nothing else to refuse on; git's ref CAS guarantees at least one of six
// simultaneous writers to the same ref from the same expected old value loses. Every loser's
// message now ends with "; run the command again" (one line, no automatic retry); every winner's
// escalation record is still written normally.
test('a CAS refusal on refs/sudus/log from escalate, answer or reply ends its message with "; run the command again" (finding 12)', async () => {
  const r = await loopRepo();
  const argvFor = (i) => ['--commitment', 'first', '--concern', 'DEMO-001', '--question', `Racer ${i}?`,
    '--recommendation', 'R', '--because', 'B', '--if-wrong', 'W', '--instead', 'I'];
  const results = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => cliEscalate(r.cwd, argvFor(i))));
  const winners = results.filter((x) => x.code === 0);
  const losers = results.filter((x) => x.code === 1);
  assert.ok(winners.length >= 1, 'at least one racer wrote its escalation');
  assert.ok(losers.length >= 1, 'at least one racer lost the CAS race');
  for (const loser of losers) assert.match(loser.out, /^sudus: refusing refs\/sudus\/log: expected [0-9a-f]{40}; run the command again\n$/);
  for (const winner of winners) assert.match(winner.out, /^sudus: escalation first [0-9a-f]{40}\n$/);
});

// --- Task 3 (plan 16): decideConsequential requires a current, composite-outcome measurement ---
// Section 5's floor-and-veto carve-out ("nothing routes a floor-caught or vetoed draft to the
// agent") means only a composite-outcome measurement permits `decideConsequential`; floor, veto,
// unavailable and indeterminate all mean code, not the agent, already decided the draft is the
// developer's. `suggested` is advisory only and is never checked here.
import { measure, recoverMeasurement } from '../lib/evaluate.mjs';
import { makeProject } from './helpers/repo.mjs';

const AUTH_DOMAIN = `Prefix: AUTH

[AUTH-003] Tokens rotate on a fixed schedule.
Falsifier: tokens are not rotated on schedule.
Mechanism: rotate
Status: Agreed 2026-09-19
`;
const OVERVIEW_WITH_AUTH = `# Keystone

## Spec map

| File | Prefix |
|---|---|
| auth.md | AUTH |
`;
const dims = () => ({ evidence: 0.2, reach: 0.2, contract: 0.2, surface: 0.2, ambiguity: 0.2 });

// Built the same way tests/evaluate.test.mjs's own repoWithCommitment is (that helper is local
// and unexported there, so it is not reused directly): a real domain/roadmap/overview fixture for
// AUTH-003, authorized and started on commitment 'auth-tokens', with typesafeai enabled so
// measure() takes the jev call path this describe block's tests need.
async function repoWithCommitment() {
  const p = await makeProject({
    settings: { data: ['migrations/**'], typesafeai: { enabled: true, model: 'jev-1.13.0', weights: dims(),
      agent_ceiling: 0.35, confidence_floors: dims(), min_calibration_agent_predictions: 60, request_cap_bytes: 48000 } },
    files: {
      'docs/spec/overview.md': OVERVIEW_WITH_AUTH,
      'docs/spec/auth.md': AUTH_DOMAIN,
      'docs/spec/roadmap.md': 'Current: auth-tokens\n\n## auth-tokens\n\nRequirements: AUTH-003\n',
    },
  });
  await p.authorize();
  await start(p.cwd, 'auth-tokens');
  return p.cwd;
}

// Distinct from this file's own top-level `draft()` (commitment 'first', concern 'DEMO-001',
// which repoWithCommitment's fixture above knows nothing about) -- named `mdraft` (measurement
// draft) to avoid redeclaring `draft`, and shaped to match repoWithCommitment's own commitment and
// requirement, the same as tests/evaluate.test.mjs's local draft().
const mdraft = (over = {}) => ({ commitment: 'auth-tokens', concerns: ['AUTH-003'], question: 'Rotate tokens hourly?',
  recommendation: 'hourly', because: 'observed: node scripts/rotate.mjs prints ok', if_wrong: 'sessions drop',
  instead: 'daily', options: ['hourly', 'daily'], named_paths: ['src/auth/rotate.mjs'], cited_decisions: [], ...over });

const transport = (bodies) => async () => { const b = bodies.shift(); if (b instanceof Error) throw b; return { status: 200, body: b, model: 'jev-1.13.0' }; };

// The same five-dimension jev answer shape tests/evaluate.test.mjs's own goodBody() uses (Fix
// round 1 there: a real jev-1.13.0 answer carries no `type` field) -- its defaults keep the
// composite well under the 0.35 ceiling (composite 0.115, suggested 'agent'), matching the
// baseline every override below starts from.
const scoreBody = (over = {}) => JSON.stringify({
  model: 'jev-1.13.0',
  answers: {
    evidence: { score: 3.4, confidence: 0.6, legend: {}, probabilities: { 0: 0, 1: 0, 2: 0.1, 3: 0.5, 4: 0.4 } },
    reach: { score: 0.6, confidence: 0.5, legend: {}, probabilities: { 0: 0.7, 1: 0, 2: 0.1, 3: 0.2, 4: 0 } },
    contract: { score: 0.1, confidence: 0.9, legend: {}, probabilities: { 0: 0.9, 1: 0.1, 2: 0, 3: 0, 4: 0 } },
    surface: { score: 0, confidence: 0.8, legend: {}, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0, 4: 0 } },
    ambiguity: { score: 1.0, confidence: 0.5, legend: {}, probabilities: { 0: 0.3, 1: 0.4, 2: 0.2, 3: 0.1, 4: 0 } },
    ...over,
  },
  usage: { input_tokens: 10, output_tokens: 2 },
});

describe('decideConsequential requires a measurement', () => {
  test('refuses with no measurement at all', async () => {
    const cwd = await repoWithCommitment();
    await assert.rejects(decideConsequential(cwd, mdraft()), /no measurement/);
  });
  // Deviation from the brief's own Step 1 snippet: the snippet's override
  // (`evidence: { score: 4, confidence: 0.9, ... } // pushes composite high -> suggested
  // developer`) does not do what its comment claims against the real computeComposite
  // (lib/evaluate.mjs): evidence is the one inverted dimension (`(4 - level) / 4`, "more evidence
  // should lower the composite"), so evidence level 4 ("quotes output and names the test that
  // fails", POLICY.LEVELS.evidence[4]) is the SAFEST case and contributes a term of 0, not a high
  // one -- it lowers the composite (0.085 with every other dimension left at scoreBody()'s
  // defaults), the opposite direction from the snippet's own comment. Nor is a single dimension's
  // override enough on its own regardless of direction: with the other four terms fixed at
  // scoreBody()'s defaults (weighted sum 0.085), even the most extreme legal value of any one
  // dimension (0 or 4, keeping reach/contract/surface under their veto thresholds) cannot add
  // enough to clear the 0.35 ceiling (max one-dimension contribution is 0.2). Two dimensions are
  // overridden instead: evidence to its worst case (score 0, "none", term (4-0)/4 = 1) and
  // ambiguity to its worst case (score 4, term 4/4 = 1) -- neither is a veto dimension (only
  // reach>=4, contract>=3, surface>=3 veto), so composite = 0.2*(1+0.15+0.025+0+1) = 0.435,
  // cleanly over the 0.35 ceiling -> suggested 'developer', outcome 'composite', no veto.
  test('names the measurement on the ADR line; suggested is not checked', async () => {
    const cwd = await repoWithCommitment();
    const body = scoreBody({
      evidence: { score: 0, confidence: 0.9, legend: {}, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0, 4: 0 } },
      ambiguity: { score: 4, confidence: 0.9, legend: {}, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 } },
    });
    const r = await measure(cwd, mdraft(), { transport: transport([body]) });
    assert.equal(r.outcome, 'composite');
    assert.equal(r.suggested, 'developer');
    const id = await decideConsequential(cwd, mdraft());
    const line = (await readAdr(cwd)).findLast((l) => l.kind === 'decision');
    assert.equal(line.id, id); assert.equal(line.evaluation, r.measurementSha); assert.equal(line.by, 'agent');
    // Issue #71: the requirement among its concerns, so a supersession carries it by requirement.
    assert.deepEqual(line.rests_on, [mdraft().because, 'AUTH-003']);
  });
  test('refuses a floor-outcome or vetoed measurement: decide is not the floor-caught path', async () => {
    const cwd = await repoWithCommitment();
    await measure(cwd, { ...mdraft(), named_paths: ['migrations/1.sql'] });
    await assert.rejects(decideConsequential(cwd, { ...mdraft(), named_paths: ['migrations/1.sql'] }), /routes to the developer|floor/);
    const cwd2 = await repoWithCommitment();
    const vetoBody = scoreBody({ contract: { score: 3.5, confidence: 0.9, legend: {}, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0.5, 4: 0.5 } } });
    await measure(cwd2, mdraft(), { transport: transport([vetoBody]) });
    await assert.rejects(decideConsequential(cwd2, mdraft()), /routes to the developer|veto/);
  });
  test('refuses a stale measurement, exactly as currentMeasurement does', async () => {
    const cwd = await repoWithCommitment();
    await measure(cwd, mdraft(), { transport: transport([scoreBody()]) });
    await escalate(cwd, { commitment: 'auth-tokens', concerns: ['AUTH-003'], question: 'q', recommendation: 'r', because: 'b', if_wrong: 'w', instead: 'i', options: [], named_paths: [], cited_decisions: [] });
    await assert.rejects(decideConsequential(cwd, mdraft()), /stale/);
  });
  // Self-review completeness (not in the brief's own Step 1 snippet): the mirror image of "names
  // the measurement" above -- scoreBody()'s own defaults already suggest 'agent' (composite
  // 0.115, well under the 0.35 ceiling), proving a composite measurement is accepted with either
  // suggestion, not only the counter-intuitive 'developer' one the brief's own test covers.
  test('a composite measurement suggesting agent is accepted too, and named the same way', async () => {
    const cwd = await repoWithCommitment();
    const r = await measure(cwd, mdraft(), { transport: transport([scoreBody()]) });
    assert.equal(r.outcome, 'composite'); assert.equal(r.suggested, 'agent');
    const id = await decideConsequential(cwd, mdraft());
    const line = (await readAdr(cwd)).findLast((l) => l.kind === 'decision');
    assert.equal(line.id, id); assert.equal(line.evaluation, r.measurementSha); assert.equal(line.by, 'agent');
  });
  // Self-review completeness: 'unavailable' (a failed transport call) is one of the four
  // non-composite outcomes the Global Constraints name explicitly ("floor, veto, unavailable and
  // indeterminate all mean code ... decided the draft is the developer's"), not covered by the
  // brief's own floor/veto test above. Built the same way tests/evaluate.test.mjs's own
  // 'a failed transport call is unavailable <class>' test is.
  test('refuses an unavailable measurement (a failed transport call)', async () => {
    const cwd = await repoWithCommitment();
    const e = new Error('overloaded'); e.klass = 'overloaded';
    const r = await measure(cwd, mdraft(), { transport: transport([e]) });
    assert.equal(r.outcome, 'unavailable');
    await assert.rejects(decideConsequential(cwd, mdraft()), /routes to the developer|unavailable/);
  });
  // Self-review completeness: 'indeterminate' (an unknown crash outcome, never retried, per
  // section 10's "Limits and failure") is the fourth named non-composite outcome. measure() itself
  // rejects on an unknown-klass transport error, leaving the intent dangling; recoverMeasurement
  // (lib/evaluate.mjs, unchanged by this task) finalizes it indeterminate on the next call, the
  // same crash-recovery path tests/evaluate.test.mjs's own measure() describe block covers.
  test('refuses an indeterminate measurement (an unrecovered crash, now finalized)', async () => {
    const cwd = await repoWithCommitment();
    const crash = new Error('crash'); // no .klass: an unknown outcome
    await assert.rejects(measure(cwd, mdraft(), { transport: transport([crash]) }));
    await recoverMeasurement(cwd);
    await assert.rejects(decideConsequential(cwd, mdraft()), /routes to the developer|indeterminate/);
  });
  // Self-review completeness: 'digest' -- this draft really was measured, but a different draft
  // was measured more recently in the same open commitment, shadowing it -- is the third named
  // MeasurementError condition alongside 'missing' and 'stale', both already covered above. The
  // exact currentMeasurement message passes through decideConsequential unchanged.
  test('refuses a digest mismatch (a different draft measured more recently), the MeasurementError message passed through unchanged', async () => {
    const cwd = await repoWithCommitment();
    await measure(cwd, mdraft(), { transport: transport([scoreBody()]) });
    await measure(cwd, mdraft({ because: 'a wholly different draft, also measured' }), { transport: transport([scoreBody()]) });
    await assert.rejects(decideConsequential(cwd, mdraft()),
      (e) => e.message === 'sudus: the latest measurement is for a different draft; run sudus measure for this draft');
  });
});

// --- Task 4 (plan 16): escalateConsequential requires a current measurement, any outcome -------
// Unlike decideConsequential (above), escalateConsequential does not require outcome ===
// 'composite': a floor-caught or vetoed draft has nowhere else to go but the developer (section
// 5's floor-and-veto carve-out), and the agent may also choose to escalate past a `suggested:
// agent` composite on its own judgment (section 10: "The suggestion is advisory, not a route").
// It still requires a *current* measurement -- the same MeasurementError conditions
// (missing/unfinished, stale, digest mismatch) decideConsequential already surfaces above.
//
// Deviation from the brief's own Step 1 snippet: the snippet's two success tests use this file's
// top-level `draft()` (commitment 'first', concern 'DEMO-001', loopRepo's own fixture), but pass
// it to `repoWithCommitment()` (commitment 'auth-tokens', requirement 'AUTH-003') -- those two
// fixtures never match each other (checkConcerns would refuse 'DEMO-001 is not in the frozen set'
// and openRange would refuse 'no open commitment first'). `mdraft()`, this file's own draft
// shaped for repoWithCommitment (the same local convention decideConsequential's own tests, just
// above, already use for the identical reason), is used instead. The "regardless of outcome" test
// uses a floor outcome (named_paths: ['migrations/1.sql'], the same fixture decideConsequential's
// own floor test above uses) as its concrete non-composite case.
describe('escalateConsequential', () => {
  test('names the current measurement on the escalation, regardless of outcome (here: a floor outcome)', async () => {
    const cwd = await repoWithCommitment();
    const r = await measure(cwd, { ...mdraft(), named_paths: ['migrations/1.sql'] });
    assert.equal(r.outcome, 'floor');
    const sha = await escalateConsequential(cwd, { ...mdraft(), named_paths: ['migrations/1.sql'] });
    const esc = (await readLog(cwd)).find((x) => x.sha === sha);
    assert.equal(esc.kind, 'escalation');
    assert.equal(esc.payload.evaluation, r.measurementSha);
  });
  test('the agent may escalate past a suggested: agent composite measurement (its own choice)', async () => {
    const cwd = await repoWithCommitment();
    const r = await measure(cwd, mdraft(), { transport: transport([scoreBody()]) });
    assert.equal(r.outcome, 'composite');
    assert.equal(r.suggested, 'agent');
    const sha = await escalateConsequential(cwd, mdraft());
    const esc = (await readLog(cwd)).find((x) => x.sha === sha);
    assert.equal(esc.payload.evaluation, r.measurementSha);
  });
  test('refuses with no current measurement, exactly like decideConsequential', async () => {
    const cwd = await repoWithCommitment();
    await assert.rejects(escalateConsequential(cwd, mdraft()), /no measurement/);
  });
  test('the plain escalate() (used by dispute, cycle escalations, scope rulings) is unaffected: no measurement required', async () => {
    const cwd = await repoWithCommitment();
    const sha = await escalate(cwd, { commitment: 'auth-tokens', concerns: ['AUTH-003'], question: 'q', recommendation: 'r',
      because: 'b', if_wrong: 'w', instead: 'i', options: [], named_paths: [], cited_decisions: [] });
    assert.match(sha, /^[0-9a-f]{40}$/);
  });
});

// Review of revision 15 (issue #29): a concern token named twice in one draft listed its item
// twice on wake's "ok closes:" line, as if the ok covered two items.
test('a draft that repeats a concern token is refused', () => {
  const a = 'a'.repeat(40);
  assert.throws(() => validateDraft(draft({ concerns: [`wait:${a}`, `wait:${a}`] })), { message: `sudus: concern token wait:${a} is repeated` });
  assert.throws(() => validateDraft(draft({ concerns: ['DEMO-001', `finding:${a}#1`, 'DEMO-001'] })), { message: 'sudus: concern token DEMO-001 is repeated' });
  assert.equal(validateDraft(draft({ concerns: [`finding:${a}#1`, `finding:${a}#2`] })).concerns.length, 2, 'two findings of one record are two tokens');
});

// Wake calls waitedBy for every backlog item between commitments. It found the ok again for each
// record before it, a scan of the log each time, so its work grew with the square of the log. The
// work is counted as reads of each record's kind and sha, which the scans read first.
test('waitedBy reads the log a bounded number of times, however far the ok sits from the escalation', async () => {
  const { waitedBy } = await import('../lib/escalate.mjs');
  let reads = 0;
  const hex = (n) => n.toString(16).padStart(40, '0');
  const rec = (sha, kind, payload) => ({ get sha() { reads++; return sha; }, get kind() { reads++; return kind; }, target: '-', payload });
  const item = rec(hex(1), 'item', { kind: 'backlog', slug: 'later', source: 'DEMO-001', body: 'an idea' });
  const esc = rec(hex(2), 'escalation', { slug: 'first', concerns: `wait:${hex(1)}` });
  const filler = Array.from({ length: 500 }, (_, i) => rec(hex(1000 + i), 'receipt', {}));
  const log = [item, esc, ...filler, rec(hex(3), 'answer', { escalation: hex(2), kind: 'ok' })];
  reads = 0;
  assert.equal(waitedBy(log, hex(1)), hex(2));
  assert.ok(reads < 10 * log.length, `${reads} reads of ${log.length} records`);
  log.push(rec(hex(4), 'done', { slug: 'first' }));
  assert.equal(waitedBy(log, hex(1)), null);
});

// Issue #57: wake asks for every escalation's state and every backlog item's retirement and wait.
// Asked one at a time, each scanned the log, so the work grew with the escalations times the log.
// Reads of each record's kind and sha are counted at k and 2k items: one pass per call doubles
// them, a scan per item quadruples them, whatever the constant.
test('unanswered and itemHolds read the log in proportion to its length, not its items times its length', async () => {
  const { unanswered, itemHolds, retiredBy, waitedBy } = await import('../lib/escalate.mjs');
  let reads = 0;
  const hex = (n) => n.toString(16).padStart(40, '0');
  const rec = (sha, kind, payload) => ({ get sha() { reads++; return sha; }, get kind() { reads++; return kind; }, target: '-', payload });
  // Item i has a retire (even i) or wait (odd i) escalation, answered ok (i % 3 === 1), asked
  // (i % 3 === 2) or not answered (i % 3 === 0).
  const build = (k) => {
    const log = [];
    for (let i = 0; i < k; i++) {
      const item = hex(10 * i + 1), esc = hex(10 * i + 2);
      log.push(rec(item, 'item', { kind: 'backlog', slug: `later-${i}`, source: 'DEMO-001', body: 'an idea' }));
      log.push(rec(esc, 'escalation', { slug: 'first', concerns: `${i % 2 ? 'wait' : 'retire'}:${item}` }));
      if (i % 3) log.push(rec(hex(10 * i + 3), 'answer', { escalation: esc, kind: i % 3 === 1 ? 'ok' : 'ask' }));
    }
    return log;
  };
  const count = (log) => {
    reads = 0;
    const open = unanswered(log);
    const holds = itemHolds(log);
    const held = log.filter((r) => r.payload.kind === 'backlog').map((r) => [holds.retired(r.sha), holds.waited(r.sha)]);
    return { reads, open, held };
  };
  const small = count(build(100)), large = count(build(200));
  assert.ok(large.reads < 3 * small.reads, `${small.reads} reads at 100 items, ${large.reads} at 200`);
  assert.equal(small.open.length, 67, 'every escalation without an ok or instead answer is unanswered');
  assert.deepEqual(small.open.filter((u) => u.awaiting === 'reply').length, 33, 'an asked escalation awaits a reply');
  assert.deepEqual(small.held[4], [hex(42), null], 'an ok on retire:<item> retires it');
  assert.deepEqual(small.held[1], [null, hex(12)], 'an ok on wait:<item> lets it wait');
  assert.deepEqual(small.held[0], [null, null], 'an unanswered retire escalation retires nothing');
  assert.deepEqual(small.held[5], [null, null], 'an asked wait escalation lets nothing wait');
  const log = build(10);
  assert.equal(retiredBy(log, hex(41)), hex(42));
  assert.equal(waitedBy(log, hex(11)), hex(12));
});
