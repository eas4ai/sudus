// tests/evaluate.test.mjs
// Plan 15 (measurement core), task 3: policy constants, the Score criteria text, the draft digest
// and the policy digest -- the first exports of lib/evaluate.mjs, rewritten from scratch on this
// plan. The old file's gate-cascade/route/shadow tests are not carried forward (they tested a
// design decisions 55 and 56 superseded); this file's structure is left open for the describe
// blocks tasks 4-10 add back (the floor, the state, the request, the parser, the composite,
// measure() and calibrate() -- ruling 5).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { POLICY, policyDigest } from '../lib/evaluate.mjs';
// Deviation from the brief text: the brief's Step 1 snippet imports normalizeDraft/draftDigest
// directly from '../lib/escalate.mjs'. lib/escalate.mjs exports validateDraft, not a function
// named normalizeDraft -- it never has, on any commit on this branch (git log -- lib/escalate.mjs
// shows no rename). lib/evaluate.mjs re-exports escalate.mjs's validateDraft under the name
// normalizeDraft (`export { validateDraft as normalizeDraft, ... } from './escalate.mjs'`, per
// the brief's own Step 3 code and the interfaces line "re-exported as FIVE_FIELDS" pattern for
// FIELDS) -- escalate.mjs itself is unchanged, exactly as the brief's interfaces line promises.
// Importing normalizeDraft from lib/evaluate.mjs, where that name actually exists, is what the
// test below ("normalizeDraft/draftDigest still come from lib/escalate.mjs, unchanged by this
// plan") is actually proving: that evaluate.mjs's re-export is the same underlying function
// escalate.mjs already had, not a new implementation.
import { normalizeDraft, draftDigest } from '../lib/evaluate.mjs';

const draft = () => ({ commitment: 'auth-tokens', concerns: ['AUTH-003'], question: 'Rotate tokens hourly?',
  recommendation: 'hourly', because: 'observed: node scripts/rotate.mjs prints ok', if_wrong: 'sessions drop',
  instead: 'daily', options: ['hourly', 'daily'], named_paths: ['src/auth/rotate.mjs'], cited_decisions: [] });
const dims = () => ({ evidence: 0.2, reach: 0.2, contract: 0.2, surface: 0.2, ambiguity: 0.2 });
const settings = () => ({ typesafeai: { enabled: true, model: 'jev-1.13.0', weights: dims(), agent_ceiling: 0.35, confidence_floors: dims(),
  min_calibration_agent_predictions: 60, request_cap_bytes: 48000 }, network_exclude: ['fixtures/private/**'] });

describe('policy constants and digests', () => {
  test('the five dimensions and their level-0..4 criteria text are fixed', () => {
    assert.deepEqual(POLICY.DIMENSIONS, ['evidence', 'reach', 'contract', 'surface', 'ambiguity']);
    for (const d of POLICY.DIMENSIONS) assert.equal(POLICY.LEVELS[d].length, 5);
    assert.deepEqual(POLICY.LEVELS.evidence[0], 'none');
    assert.deepEqual(POLICY.LEVELS.evidence[4], 'quotes output and names the test that fails and the falsifier it maps to');
    assert.deepEqual(POLICY.LEVELS.surface[4], 'a network call, credential, or external service');
  });
  test('normalizeDraft/draftDigest still come from lib/escalate.mjs, unchanged by this plan', () => {
    const D = normalizeDraft(draft());
    assert.deepEqual(Object.keys(D).sort(), ['because', 'cited_decisions', 'commitment', 'concerns', 'if_wrong',
      'instead', 'named_paths', 'options', 'question', 'recommendation'].sort());
    assert.match(draftDigest(D), /^sha256:[0-9a-f]{64}$/);
  });
  test('policy digest changes with every covered input and nothing else', () => {
    const base = policyDigest(settings());
    const s1 = settings(); s1.typesafeai.agent_ceiling = 0.4;
    const s2 = settings(); s2.typesafeai.weights.evidence = 0.3;
    const s3 = settings(); s3.typesafeai.confidence_floors.ambiguity = 0.6;
    const s4 = settings(); s4.network_exclude = [];
    const s5 = settings(); s5.typesafeai.model = 'jev-1.14.0';
    const s6 = settings(); s6.typesafeai.enabled = false;
    assert.notEqual(base, policyDigest(s1)); assert.notEqual(base, policyDigest(s2)); assert.notEqual(base, policyDigest(s3));
    assert.notEqual(base, policyDigest(s4)); assert.notEqual(base, policyDigest(s5));
    assert.equal(base, policyDigest(s6), 'enabled is a source choice, not policy');
  });
});

import { kernelFacts, floorReasons, authorityProjection } from '../lib/evaluate.mjs';
import { makeProject } from './helpers/repo.mjs';
import { loopRepo } from './helpers/loop.mjs';
import { appendDecision, adrDigest } from '../lib/adr.mjs';

// A hand-built kernelFacts() result, for floorReasons/authorityProjection unit tests that do not
// need a real repository. kernelFacts() itself is exercised separately below, against a real
// makeProject() fixture.
const facts = (over = {}) => ({ slug: 'auth-tokens', set: [{ requirement: 'AUTH-003', text_digest: 'sha256:' + 'a'.repeat(64) }],
  concerns: [{ id: 'AUTH-003', valid: true }], pathClasses: { 'src/auth/rotate.mjs': 'source' }, attempts: { 'AUTH-003': 1 },
  openObligations: { escalations: 0, findings: 0, defects: 0, breaches: 0 }, decisions: [], lease: { action: 'implement', target: 'AUTH-003' },
  D: normalizeDraft(draft()), ...over });

describe('the narrow floor', () => {
  test('a clean draft does not fire the floor and projects completely', () => {
    assert.deepEqual(floorReasons(facts()), []);
    const A = authorityProjection(facts());
    assert.equal(A.option_index, 0);
    assert.equal(A.option_count, 2);
  });
  // Fix round 1 (Controller Ruling 7): section 10's narrow floor names exactly three conditions
  // (contract, agreement, data) plus the technical no-request cases. Reserved/protected-path
  // writes ('settings', a .sudus/settings.json write; 'reserved', a reserved or kernel-managed
  // path), the fourth-attempt rule and scope rulings are "already enforced by section 2 and
  // section 5 independent of this floor" (docs/spec/sudus-v2.md section 10) -- floorReasons no
  // longer fires on them, so those four assertions (present in the brief's own Step 1 test) are
  // removed along with the reasons themselves. The reasons that remain: data, contract, agreement,
  // missing-recommendation, incomplete-projection.
  test('each floor reason routes with no call', () => {
    assert.deepEqual(floorReasons(facts({ pathClasses: { 'migrations/1.sql': 'data' } })), ['data']);
    assert.deepEqual(floorReasons(facts({ pathClasses: { 'docs/spec/auth.md': 'protected' } })), ['contract']);
    assert.deepEqual(floorReasons(facts({ pathClasses: { 'AGENTS.md': 'protected' } })), ['agreement']);
    assert.deepEqual(floorReasons(facts({ D: { ...normalizeDraft(draft()), recommendation: '  ' } })), ['missing-recommendation']);
    assert.deepEqual(floorReasons(facts({ concerns: [{ id: 'AUTH-999', valid: false }] })), ['incomplete-projection']);
  });
  test('a recommendation not present in options is also incomplete-projection', () => {
    assert.deepEqual(floorReasons(facts({ D: { ...normalizeDraft(draft()), recommendation: 'weekly' } })), ['incomplete-projection']);
  });
  // Fix round 1, Important 1: authorityProjection's protected.contract used to disagree with
  // floorReasons's own 'contract' check for docs/spec/roadmap.md. PROTECTED_EXCEPT (lib/paths.mjs)
  // carves that one path out of classify()'s 'protected' class into 'reserved' (the kernel writes
  // it directly at start and promote), so floorReasons correctly never fires 'contract' for it --
  // both functions must agree that this path is not a contract write.
  test('the roadmap kernel-write exception does not fire contract in either function', () => {
    const f = facts({ pathClasses: { 'docs/spec/roadmap.md': 'reserved' } });
    assert.deepEqual(floorReasons(f), []);
    assert.equal(authorityProjection(f).protected.contract, false);
  });
  // Ruling 5 (plan 15's progress ledger) carries this subject forward by name from the superseded
  // evaluator's test 'an agent-written cited decision reaches A(D) only as id and read flag'
  // (tests/evaluate.test.mjs at b40fd65c, describe('protected(D) and A(D)')): unread decisions are
  // a kernel fact the floor itself sees and exposes -- A(D) carries a cited decision's id and
  // whether the developer has read it, never the agent's own prose, and an unread one must show up
  // as read: false rather than being silently dropped or coerced to true.
  test('an agent-written cited decision reaches A(D) only as id and read flag', () => {
    const A = authorityProjection(facts({ decisions: [{ id: '01J', by: 'agent', read: false, body: 'long agent prose', title: 't' }] }));
    assert.deepEqual(A.cited, [{ id: '01J', read: false }]);
    assert.ok(!JSON.stringify(A).includes('long agent prose'));
  });
  // Deviation from the brief text: the brief's Step 1 snippet builds this fixture's draft with
  // `concerns: []`. lib/escalate.mjs's validateDraft (this module's normalizeDraft) refuses an
  // empty concerns list ("draft needs at least one concern"), so that literal fixture throws
  // DraftError before kernelFacts is ever reached -- it never has, on any commit on this branch,
  // per the same escalate.mjs read noted above. The superseded evaluator's own equivalent test hit
  // this identical wall and used 'cycle' instead (git show b40fd65c:tests/evaluate.test.mjs): the
  // one concern kind that names no record and needs no open commitment, standing in for "no
  // meaningful concern" here too.
  test('kernelFacts reads a real project', async () => {
    const { cwd } = await makeProject();
    const f = await kernelFacts(cwd, normalizeDraft({ ...draft(), commitment: 'none', concerns: ['cycle'], named_paths: [] }));
    assert.equal(f.lease, null);
    assert.deepEqual(f.openObligations, { escalations: 0, findings: 0, defects: 0, breaches: 0 });
  });
  // Review of 4.0.0: the open-findings count settles a finding the way the ledger does. A resolution
  // a 3.x acceptance rejected leaves it open; a decline closes it.
  test('kernelFacts counts a finding whose only fix a 3.x acceptance rejected as open, and a declined one as settled', async () => {
    const r = await loopRepo();
    await r.passReq('DEMO-001'); await r.review();
    const rep = await r.legacyReport([{ n: 1, text: 'f' }, { n: 2, text: 'g' }]);
    const res = await r.resolveFinding(rep, 1);
    await r.accept({ rejected: [res] });
    const facts = () => kernelFacts(r.cwd, normalizeDraft({ ...draft(), commitment: 'first', concerns: ['cycle'], named_paths: [] }));
    assert.equal((await facts()).openObligations.findings, 2);
    await r.declineFinding(rep, 2);
    assert.equal((await facts()).openObligations.findings, 1);
    await r.declineFinding(rep, 1);
    assert.equal((await facts()).openObligations.findings, 0);
  });
  // Fix round 1, Important 2: the only test that touched kernelFacts's own `read: !unread.has(id)`
  // line called authorityProjection directly against a hand-built facts() fixture with `read`
  // supplied literally -- it never exercised kernelFacts's real readAdr/queue computation, so an
  // inverted or otherwise broken unread check would not have failed anything. Built on
  // loopRepo (tests/helpers/loop.mjs), which already wires a started commitment and a decide()
  // step, rather than hand-built facts.
  test('kernelFacts reports a cited decision as unread, then read once the read line lands', async () => {
    const r = await loopRepo();
    const id = await r.decide();
    const D = normalizeDraft({ ...draft(), commitment: r.slug, concerns: [r.reqs[0]], named_paths: [], cited_decisions: [id] });
    const before = await kernelFacts(r.cwd, D);
    assert.deepEqual(before.decisions, [{ id, by: 'agent', read: false, body: 'A map keeps lookups constant.', title: 'Use a map' }]);
    const anyLogSha = (await r.log()).at(-1).sha;
    await appendDecision(r.cwd, { kind: 'read', of: id, record: anyLogSha }, { command: 'decisions --read' });
    const after = await kernelFacts(r.cwd, D);
    assert.equal(after.decisions[0].read, true);
  });
});

import { contractState, measureState, EgressError } from '../lib/evaluate.mjs';
import { git as gitCmd } from '../lib/gitx.mjs';
import { declare as declareAuth } from '../lib/mechanisms.mjs';
import { mkdir, writeFile, symlink, mkdtemp, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { appendRecord } from '../lib/records.mjs';
import { writeWorkspaceSnapshot } from '../lib/snapshots.mjs';
import { canonicalize, b64url } from '../lib/canon.mjs';
import { begin } from '../lib/lease.mjs';

// A local write helper (mirrors tests/helpers/repo.mjs's own `write` and tests/helpers/loop.mjs's
// own `write`) for a bare untracked file placed straight into a makeProject() worktree, with no
// project-level fixture wiring of its own -- these tests need one loose file on disk, not a
// second full test-helper module.
async function mkdirAndWrite(cwd, path, content) {
  const full = join(cwd, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

describe('C(c) and M(D)', () => {
  test('contractState carries the rule text nowhere: only keystone, glossary, commitment, requirements and developer-written decisions', async () => {
    const { cwd } = await makeProject({ files: { 'docs/spec/roadmap.md': 'Current: auth-tokens\n\n## auth-tokens\n\nRequirements: AUTH-003\n' } });
    // Starting the commitment for real would need a docs/spec domain file defining AUTH-003 as
    // Agreed, plus authorize() and the full transactional start() -- a matching domain file is not
    // this test's subject (contractState's key set, checked below, is). Appending the 'start'
    // record directly, the same shortcut tests/helpers/loop.mjs's own fixture and
    // tests/snapshots.test.mjs already use, opens the real commitment kernelFacts reads its slug
    // and frozen set from, with no domain file or authorization detour.
    const snapshot = await writeWorkspaceSnapshot(cwd);
    await appendRecord(cwd, 'start', 'auth-tokens', {
      slug: 'auth-tokens', snapshot, from_superseded: null, intent: null, results: [],
      requirements: [{ requirement: 'AUTH-003', text_digest: 'sha256:' + 'a'.repeat(64) }],
    });
    const f = await kernelFacts(cwd, normalizeDraft(draft()));
    const C = await contractState(cwd, f);
    assert.deepEqual(Object.keys(C).sort(), ['commitment', 'decisions', 'glossary', 'keystone', 'requirements']);
  });
  test('M(D) is exactly the five closed parts, no rule and no free context', async () => {
    const { cwd } = await makeProject();
    await mkdirAndWrite(cwd, 'src/auth/rotate.mjs', 'export const rotate = () => {};\n');
    const f = await kernelFacts(cwd, normalizeDraft(draft()));
    const C = await contractState(cwd, f);
    const { state } = await measureState(cwd, normalizeDraft(draft()), 0, C, f);
    assert.deepEqual(Object.keys(state).sort(), ['contract', 'facts', 'five', 'option', 'options']);
    assert.deepEqual(Object.keys(state.five).sort(), ['because', 'if_wrong', 'instead', 'question', 'recommendation']);
    // Fix round 1 (review Important finding 2): the brief's own snippet, and this test until now,
    // only spot-checked state.option's content (text, files) and asserted nothing at all about
    // state.contract's or state.facts's key sets -- a reintroduced rule or context field on either
    // (the exact regression this task exists to prevent) would have passed silently. contract is
    // asserted by reference (measureState assigns it verbatim, never a copy); facts is asserted
    // against a fresh authorityProjection(f) call, the same function measureState itself calls.
    assert.deepEqual(Object.keys(state.option).sort(), ['diff', 'files', 'omitted', 'text']);
    assert.equal(state.contract, C);
    assert.deepEqual(state.facts, authorityProjection(f));
    assert.equal(state.option.text, 'hourly');
    assert.ok(state.option.files.some((x) => x.path === 'src/auth/rotate.mjs'));
    // Controller Ruling 3 (plan 18): state.options is D.options' full text list, in draft order --
    // both the recommended option and every losing option, strings only.
    assert.deepEqual(state.options, draft().options);
  });
  test('an excluded touched path throws EgressError and never reaches state', async () => {
    const { cwd } = await makeProject({ settings: { network_exclude: ['fixtures/private/**'] } });
    await mkdirAndWrite(cwd, 'fixtures/private/key.txt', 'shh');
    const f = await kernelFacts(cwd, normalizeDraft({ ...draft(), named_paths: ['fixtures/private/key.txt'] }));
    const C = await contractState(cwd, f);
    await assert.rejects(measureState(cwd, normalizeDraft({ ...draft(), named_paths: ['fixtures/private/key.txt'] }), 0, C, f), EgressError);
  });
  // Not in the brief's own test list: the Global Constraints call egress of a credential path's
  // content binding, and the brief's given test exercises only the network_exclude branch of
  // egressClass. A CREDENTIAL_PATTERNS entry (lib/paths.mjs) is a project-independent rule, so no
  // settings override is needed to trigger it, unlike the network_exclude case above.
  test('a credential-pattern touched path throws EgressError classed credential, with no settings override needed', async () => {
    const { cwd } = await makeProject();
    await mkdirAndWrite(cwd, 'secret/.env', 'TOKEN=shh');
    const f = await kernelFacts(cwd, normalizeDraft({ ...draft(), named_paths: ['secret/.env'] }));
    const C = await contractState(cwd, f);
    await assert.rejects(
      measureState(cwd, normalizeDraft({ ...draft(), named_paths: ['secret/.env'] }), 0, C, f),
      (e) => e instanceof EgressError && e.klass === 'credential' && e.path === 'secret/.env',
    );
  });
  // Fix round 1 (review Critical finding 1): validateDraft only checks that named_paths entries
  // are strings, not that they are well-formed repository paths, so an agent-authored draft could
  // previously name a path outside the repository (a traversal or an absolute path) or a
  // kernel-reserved path, and measureState read it and returned its real content in M(D). Each of
  // these three now throws EgressError('reserved', p) before writeTreeFromPaths ever runs, and
  // the message names the offending path (not only the klass), so a caller (or a human reading a
  // log) can tell which of several touched paths was refused.
  describe('the touched-path containment check', () => {
    test('a relative traversal outside the repository throws EgressError naming the path', async () => {
      const { cwd } = await makeProject();
      const f = await kernelFacts(cwd, normalizeDraft({ ...draft(), named_paths: ['../outside.txt'] }));
      const C = await contractState(cwd, f);
      await assert.rejects(
        measureState(cwd, normalizeDraft({ ...draft(), named_paths: ['../outside.txt'] }), 0, C, f),
        (e) => e instanceof EgressError && e.klass === 'reserved' && e.path === '../outside.txt' && e.message.includes('../outside.txt'),
      );
    });
    test('an absolute path throws EgressError naming the path', async () => {
      const { cwd } = await makeProject();
      const f = await kernelFacts(cwd, normalizeDraft({ ...draft(), named_paths: ['/etc/passwd'] }));
      const C = await contractState(cwd, f);
      await assert.rejects(
        measureState(cwd, normalizeDraft({ ...draft(), named_paths: ['/etc/passwd'] }), 0, C, f),
        (e) => e instanceof EgressError && e.klass === 'reserved' && e.path === '/etc/passwd' && e.message.includes('/etc/passwd'),
      );
    });
    test('a kernel-reserved path throws EgressError naming the path', async () => {
      const { cwd } = await makeProject();
      const f = await kernelFacts(cwd, normalizeDraft({ ...draft(), named_paths: ['.sudus/log'] }));
      const C = await contractState(cwd, f);
      await assert.rejects(
        measureState(cwd, normalizeDraft({ ...draft(), named_paths: ['.sudus/log'] }), 0, C, f),
        (e) => e instanceof EgressError && e.klass === 'reserved' && e.path === '.sudus/log' && e.message.includes('.sudus/log'),
      );
    });
    test('a kernel-managed path (the ADR file) throws EgressError naming the path', async () => {
      const { cwd } = await makeProject();
      const d = normalizeDraft({ ...draft(), named_paths: ['docs/decisions.jsonl'] });
      const f = await kernelFacts(cwd, d);
      const C = await contractState(cwd, f);
      await assert.rejects(measureState(cwd, d, 0, C, f),
        (e) => e instanceof EgressError && e.klass === 'kernel-managed' && e.path === 'docs/decisions.jsonl');
    });
    test('a protected path (the working agreement) throws EgressError naming the path', async () => {
      const { cwd } = await makeProject();
      const d = normalizeDraft({ ...draft(), named_paths: ['AGENTS.md'] });
      const f = await kernelFacts(cwd, d);
      const C = await contractState(cwd, f);
      await assert.rejects(measureState(cwd, d, 0, C, f),
        (e) => e instanceof EgressError && e.klass === 'protected' && e.path === 'AGENTS.md');
    });
    test('a draft naming only ordinary source paths still builds the state', async () => {
      const { cwd } = await makeProject();
      await mkdirAndWrite(cwd, 'src/auth/rotate.mjs', 'export const rotate = () => {};\n');
      const f = await kernelFacts(cwd, normalizeDraft(draft()));
      const C = await contractState(cwd, f);
      const { state } = await measureState(cwd, normalizeDraft(draft()), 0, C, f);
      assert.ok(state.option.files.some((x) => x.path === 'src/auth/rotate.mjs'));
    });
  });
  // Fix round 1 (review Important finding 3): the brief's own test and the credential test above
  // cover network_exclude and credential; host, output and both key-detection branches were
  // written but untested. One focused test per branch.
  test('a domain Host paths: match throws EgressError classed host', async () => {
    const { cwd } = await makeProject({ files: { 'docs/spec/hosted.md': 'Host paths: web/index.html\n' } });
    await mkdirAndWrite(cwd, 'web/index.html', '<html></html>\n');
    const f = await kernelFacts(cwd, normalizeDraft({ ...draft(), named_paths: ['web/index.html'] }));
    const C = await contractState(cwd, f);
    await assert.rejects(
      measureState(cwd, normalizeDraft({ ...draft(), named_paths: ['web/index.html'] }), 0, C, f),
      (e) => e instanceof EgressError && e.klass === 'host' && e.path === 'web/index.html',
    );
  });
  test('a kernel output path throws EgressError classed output', async () => {
    const { cwd } = await makeProject();
    await mkdirAndWrite(cwd, '.sudus/output/report.txt', 'report\n');
    const f = await kernelFacts(cwd, normalizeDraft({ ...draft(), named_paths: ['.sudus/output/report.txt'] }));
    const C = await contractState(cwd, f);
    await assert.rejects(
      measureState(cwd, normalizeDraft({ ...draft(), named_paths: ['.sudus/output/report.txt'] }), 0, C, f),
      (e) => e instanceof EgressError && e.klass === 'output' && e.path === '.sudus/output/report.txt',
    );
  });
  // TYPESAFEAI_API_KEY is set to an invented, non-real placeholder for the duration of this test
  // only, then restored -- never a real key, per the global constraint, and never printed or
  // written anywhere beyond this in-memory env var and the touched file's own throwaway fixture
  // content.
  test('a touched file containing the TypeSafe key throws EgressError classed key before it reaches state', async () => {
    const { cwd } = await makeProject();
    const prev = process.env.TYPESAFEAI_API_KEY;
    process.env.TYPESAFEAI_API_KEY = 'test-placeholder-key-000';
    try {
      await mkdirAndWrite(cwd, 'src/auth/rotate.mjs', '// test-placeholder-key-000\n');
      const f = await kernelFacts(cwd, normalizeDraft(draft()));
      const C = await contractState(cwd, f);
      await assert.rejects(
        measureState(cwd, normalizeDraft(draft()), 0, C, f),
        (e) => e instanceof EgressError && e.klass === 'key' && e.path === 'src/auth/rotate.mjs',
      );
    } finally {
      if (prev === undefined) delete process.env.TYPESAFEAI_API_KEY; else process.env.TYPESAFEAI_API_KEY = prev;
    }
  });
  test('the key appearing only in the diff (removed since the lease began) throws EgressError classed key on the diff', async () => {
    const { cwd } = await makeProject();
    await mkdirAndWrite(cwd, 'src/auth/rotate.mjs', 'export const rotate = () => {};\n// test-placeholder-key-111\n');
    // Issue #30: begin refuses a --touch whose target no mechanism declares, so AUTH-003 gets one.
    await gitCmd(['add', '-A'], { cwd });
    await gitCmd(['commit', '-q', '-m', 'rotate'], { cwd });
    await declareAuth(cwd, 'auth', { command: 'node -e 0', inputs: ['src/auth/rotate.mjs'], documents: [], requirements: ['AUTH-003'], results: 'per-requirement', identity: {} });
    await begin(cwd, { action: 'implement', target: 'AUTH-003', touch: ['src/auth/rotate.mjs'] });
    const prev = process.env.TYPESAFEAI_API_KEY;
    process.env.TYPESAFEAI_API_KEY = 'test-placeholder-key-111';
    try {
      // The key-bearing line is removed after the lease snapshot was taken: the current file text
      // no longer contains the key (the per-file content check passes), but the diff against the
      // lease's snapshot still shows the removed line, so only the diff check should fire.
      await mkdirAndWrite(cwd, 'src/auth/rotate.mjs', 'export const rotate = () => {};\n');
      const f = await kernelFacts(cwd, normalizeDraft({ ...draft(), named_paths: [] }));
      const C = await contractState(cwd, f);
      await assert.rejects(
        measureState(cwd, normalizeDraft({ ...draft(), named_paths: [] }), 0, C, f),
        (e) => e instanceof EgressError && e.klass === 'key' && e.path === 'diff',
      );
    } finally {
      if (prev === undefined) delete process.env.TYPESAFEAI_API_KEY; else process.env.TYPESAFEAI_API_KEY = prev;
    }
  });
  // Not in the brief's own test list: measureState's Interfaces line and the task's own
  // instructions name `{state, requestBytesEstimate}` as its return shape (the brief's Step 3
  // snippet returns `{ state }` alone); this covers the field the snippet omitted.
  test('measureState also returns a requestBytesEstimate, a positive byte count of the state', async () => {
    const { cwd } = await makeProject();
    await mkdirAndWrite(cwd, 'src/auth/rotate.mjs', 'export const rotate = () => {};\n');
    const f = await kernelFacts(cwd, normalizeDraft(draft()));
    const C = await contractState(cwd, f);
    const { state, requestBytesEstimate } = await measureState(cwd, normalizeDraft(draft()), 0, C, f);
    assert.equal(requestBytesEstimate, Buffer.byteLength(canonicalize(state)));
    assert.ok(requestBytesEstimate > 0);
  });
});

import { buildScoreRequest, requestBytes, requestDigest, sizeCheck } from '../lib/evaluate.mjs';

describe('the Score request', () => {
  test('five questions, each naming its backticked state path with a zero-based option index', () => {
    const req = buildScoreRequest(settings(), { five: { question: 'q', recommendation: 'r', because: 'b', if_wrong: 'w', instead: 'i' }, option: { text: 'r', diff: '', files: [], omitted: [] }, contract: {}, facts: {} }, 0);
    assert.deepEqual(Object.keys(req.questions).sort(), ['ambiguity', 'contract', 'evidence', 'reach', 'surface']);
    assert.match(req.questions.evidence.instructions, /`state\.five\.because`/);
    assert.match(req.questions.ambiguity.instructions, /`state\.five\.question`/);
    // Fix round 1 (review Important 1): a conjunction, not the brief's own alternation
    // regex (`` `state\.option`.*\[0\]|`state\.option` `` reduces to just the second
    // alternative, since alternation is lowest-precedence, so the `[0]` clause was dead --
    // this passed for any instructions text that merely mentioned `state.option` at all).
    // Each of the three option-scoped dimensions must carry both the backticked state path
    // and the literal zero-based index text the recommended option's own array slot uses.
    for (const d of ['reach', 'contract', 'surface']) {
      const t = req.questions[d].instructions;
      assert.ok(t.includes('`state.option`'), `${d} instructions missing the backticked state.option path`);
      assert.ok(t.includes('draft.options[0]'), `${d} instructions missing the zero-based option index`);
      // Controller Ruling 3 (plan 18): reach, contract and surface each also point at the full
      // options list added to the state, so the model can compare the recommended option against
      // the alternatives it names.
      assert.ok(t.includes('`state.options`'), `${d} instructions missing the backticked state.options path`);
    }
    for (const d of ['evidence', 'reach', 'contract', 'surface', 'ambiguity']) assert.deepEqual(req.questions[d].criteria.length, 5);
    assert.equal(req.model, settings().typesafeai.model);
  });
  test('the recommended-option index in the request text tracks n, zero-based, for every option-scoped dimension', () => {
    const state = { five: { question: 'q', recommendation: 'daily', because: 'b', if_wrong: 'w', instead: 'i' }, option: { text: 'daily', diff: '', files: [], omitted: [] }, contract: {}, facts: {} };
    const req = buildScoreRequest(settings(), state, 1);
    // Fix round 1 (review Important 1): the brief's own test checked only 'reach' at n=1;
    // 'contract' and 'surface' interpolate the same ${n} into their own instructions text
    // (lib/evaluate.mjs) and need the same check, or a future edit could drop the index
    // from either one with nothing here to catch it.
    for (const d of ['reach', 'contract', 'surface']) assert.ok(req.questions[d].instructions.includes('draft.options[1]'), `${d} instructions missing draft.options[1]`);
  });
  test('requests round-trip through canonical JSON: equal state yields byte-identical requests', () => {
    const state = { five: { question: 'q', recommendation: 'r', because: 'b', if_wrong: 'w', instead: 'i' }, option: { text: 'r', diff: '', files: [], omitted: [] }, contract: {}, facts: {} };
    const a = buildScoreRequest(settings(), state, 0), b = buildScoreRequest(settings(), state, 0);
    assert.equal(requestBytes(a), requestBytes(b));
    assert.match(requestDigest(a), /^sha256:[0-9a-f]{64}$/);
  });
  test('sizeCheck refuses above 75 percent of either the request or the state-plus-longest-question limit', () => {
    const small = buildScoreRequest(settings(), { five: { question: 'q', recommendation: 'r', because: 'b', if_wrong: 'w', instead: 'i' }, option: { text: 'r', diff: '', files: [], omitted: [] }, contract: {}, facts: {} }, 0);
    assert.equal(sizeCheck(settings(), small), null);
    const big = buildScoreRequest(settings(), { five: { question: 'q', recommendation: 'r', because: 'x'.repeat(200000), if_wrong: 'w', instead: 'i' }, option: { text: 'r', diff: '', files: [], omitted: [] }, contract: {}, facts: {} }, 0);
    assert.equal(sizeCheck(settings(), big), 'oversize');
    assert.equal(sizeCheck({ typesafeai: { ...settings().typesafeai, request_cap_bytes: 10 } }, small), 'oversize');
  });
  // Fix round 1 (review Important 2): the test above only covers a clearly-small request, a
  // clearly-huge one (roughly 2.7x the state limit) and a toy request_cap_bytes: 10 override --
  // none of it lands near either real `> limit` boundary in lib/evaluate.mjs's sizeCheck, so an
  // off-by-one (`>=` vs `>`) or a wrong operand (e.g. dropping `* factor`, an 8x difference)
  // would pass every assertion here unnoticed. This test hits each of sizeCheck's three
  // thresholds exactly, then one byte past it, with every target computed from POLICY.LIMITS
  // and settings() rather than hardcoded, so a limit change moves the test with it.
  test('sizeCheck refuses exactly one byte past each of its three real boundaries', () => {
    const { requestTokens, stateTokens, bytesPerToken, factor } = POLICY.LIMITS;
    const requestLimit = requestTokens * bytesPerToken * factor;
    const stateLimit = stateTokens * bytesPerToken * factor;
    const len = (v) => Buffer.byteLength(canonicalize(v));

    // A minimal, fixed-shape request (not run through buildScoreRequest -- sizeCheck only
    // ever reads request.state and request.questions, per its own implementation, so this
    // is a faithful unit test of sizeCheck itself) with exactly one padded field per check,
    // so each boundary can be hit by padding plain ASCII 'x' characters -- canonicalize adds
    // no escaping for those, so every added character adds exactly one byte, and the padding
    // length needed to land exactly on a limit is `limit - <measured base size>`, never a
    // hardcoded byte count.
    const question = { type: 'score', instructions: 'i', criteria: ['a', 'b', 'c', 'd', 'e'] };
    const emptyState = { five: {}, option: {}, contract: {}, facts: {} };
    const questionBytes = len(question);
    const req = (modelPad, statePad) => ({
      model: 'x'.repeat(modelPad),
      questions: { q: question },
      state: { ...emptyState, pad: 'x'.repeat(statePad) },
    });
    const base = req(0, 0);
    const totalBase = len(base), stateBase = len(base.state);

    // (1) requestTokens * bytesPerToken * factor: request_cap_bytes is raised well above it
    // so Math.min picks this clause, and state stays unpadded so the much smaller
    // state-plus-longest-question check never fires -- only the whole-request clause is
    // under test here.
    const highCap = { typesafeai: { ...settings().typesafeai, request_cap_bytes: requestLimit + 1000 } };
    const padA = requestLimit - totalBase;
    assert.equal(sizeCheck(highCap, req(padA, 0)), null);
    assert.equal(sizeCheck(highCap, req(padA + 1, 0)), 'oversize');

    // (2) stateTokens * bytesPerToken * factor: padded through state.pad so len(state) plus
    // the one question's bytes lands exactly on it; request_cap_bytes is still raised so the
    // whole-request clause cannot be what fires here.
    const padB = stateLimit - questionBytes - stateBase;
    assert.equal(sizeCheck(highCap, req(0, padB)), null);
    assert.equal(sizeCheck(highCap, req(0, padB + 1)), 'oversize');

    // (3) settings.typesafeai.request_cap_bytes at its real value (48000, from this file's
    // own settings() helper, not a toy override) -- no cap override; state is unpadded, so
    // it sits far under the 72000 state limit and the cap is what fires first, the way it
    // does for any project whose settings cap is this far below the token limits.
    const cap = settings().typesafeai.request_cap_bytes;
    const padC = cap - totalBase;
    assert.equal(sizeCheck(settings(), req(padC, 0)), null);
    assert.equal(sizeCheck(settings(), req(padC + 1, 0)), 'oversize');
  });
});

import { parseScoreAnswers } from '../lib/evaluate.mjs';

// Deviation from the brief's Step 1 snippet: the snippet calls `buildScoreRequest(settings(),
// state(), 0)` as if `state()` were an existing zero-arg factory. No such helper exists in this
// file -- the Score-request describe block above builds its own inline state object literal per
// test instead (see e.g. line 370, 389, 398) -- so this file's own `scoreState()` follows that
// same local pattern rather than introducing a new shared fixture name.
const scoreState = () => ({
  five: { question: 'q', recommendation: 'r', because: 'b', if_wrong: 'w', instead: 'i' },
  option: { text: 'r', diff: '', files: [], omitted: [] }, contract: {}, facts: {},
});

// Fix round 1 (controller ruling): a real jev-1.13.0 Score answer carries no `type` field --
// see `realAnswers` below, copied verbatim from a live capture, and the Critical finding in
// task-7-review.md. goodBody's per-dimension objects no longer carry one either, so this fixture
// matches the real wire shape (score, confidence, legend, probabilities) rather than the brief's
// original (incorrect) assumption.
const goodBody = (over = {}) => JSON.stringify({
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

// A real answer object per dimension, copied verbatim from `.superpowers/bench/results.json`'s
// `round3.rows[0]` (scenario A01, jev-1.13.0, a live HTTP 200 response -- the same capture
// `results.md`'s "Data loss note" and this task's own tolerance fix cite). The superseded
// gate-cascade design that produced this capture scored each option separately (`contract_1`,
// `contract_2`, ...); this task's single-recommended-option design asks one question per
// dimension, so `reach`/`contract`/`surface` below are that scenario's own `<dimension>_1`
// object (the recommended option's own slot), renamed onto the current dimension id --
// `evidence` and `ambiguity` keep their original names, since neither was ever option-scoped.
// Scores, confidences, legend text and probabilities are unedited from the capture: this is the
// review's requested "fixture built straight from a real recorded answer," not a hand-written
// approximation of one, and it carries no `type` key because the real object never had one.
const realAnswers = {
  evidence: { score: 3.44, confidence: 0.57, legend: { 0: 'none', 1: 'a claim', 2: 'names a command or file', 3: 'quotes output or a diff', 4: 'quotes output and names the test that fails and the falsifier it maps to' }, probabilities: { 0: 0, 1: 0, 2: 0.03, 3: 0.49, 4: 0.48 } },
  reach: { score: 0.6, confidence: 0.5, legend: { 0: 'wording or message text', 1: 'internal structure, nothing visible', 2: 'behaviour inside an agreed requirement', 3: 'output or flags existing callers depend on', 4: 'data that cannot be regenerated, a migration, or a rewrite of user files' }, probabilities: { 0: 0.77, 1: 0, 2: 0.11, 3: 0.12, 4: 0 } },
  contract: { score: 0.07, confidence: 0.94, legend: { 0: 'implements the cited requirement as written', 1: 'chooses between readings the text allows', 2: 'adds behaviour no requirement names', 3: 'conflicts with a cited decision', 4: "changes a requirement's text or falsifier" }, probabilities: { 0: 0.96, 1: 0.03, 2: 0.01, 3: 0, 4: 0 } },
  surface: { score: 0.53, confidence: 0.56, legend: { 0: 'no new surface', 1: 'a new file or module', 2: 'a new flag or output', 3: 'a new dependency', 4: 'a network call, credential, or external service' }, probabilities: { 0: 0.74, 1: 0, 2: 0.26, 3: 0, 4: 0 } },
  ambiguity: { score: 1.02, confidence: 0.68, legend: { 0: 'one reading, the draft names it', 1: 'two readings, the draft picks one with a reason', 2: 'two readings, no reason', 3: 'the question asks the developer to choose a policy', 4: 'the question cannot be answered without facts the draft lacks' }, probabilities: { 0: 0.18, 1: 0.72, 2: 0.01, 3: 0.07, 4: 0.02 } },
};

describe('Score answer parsing', () => {
  test('parses all five dimensions', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    const r = parseScoreAnswers(req, goodBody());
    assert.deepEqual(Object.keys(r.levels).sort(), ['ambiguity', 'contract', 'evidence', 'reach', 'surface']);
    assert.equal(r.levels.evidence, 3.4); assert.equal(r.confidences.evidence, 0.6);
    assert.equal(r.model, 'jev-1.13.0');
    assert.deepEqual(r.usage, { input_tokens: 10, output_tokens: 2 });
  });
  // Fix round 1: the review's Critical finding -- reproduced against `parseScoreAnswers` before
  // this fix, a body built from this exact real data returned `{"invalid":"answer evidence not
  // type score"}`, rejecting a real, successful API response on the first dimension checked.
  // This is the fixture the review's Critical fix asked for: built straight from a live capture,
  // not from the brief's (incorrect) assumption that a `type` field exists, with float scores
  // (`3.44`, not a rounded `3`) exercised the way the real API actually returns them.
  test('parses a real captured jev-1.13.0 response verbatim: no type field, float scores', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    const body = JSON.stringify({ model: 'jev-1.13.0', answers: realAnswers, usage: { input_tokens: 3975, output_tokens: 124 } });
    const r = parseScoreAnswers(req, body);
    assert.equal(r.invalid, undefined);
    assert.deepEqual(r.levels, { evidence: 3.44, reach: 0.6, contract: 0.07, surface: 0.53, ambiguity: 1.02 });
    assert.deepEqual(r.confidences, { evidence: 0.57, reach: 0.5, contract: 0.94, surface: 0.56, ambiguity: 0.68 });
  });
  test('tolerates a probability sum within 0.02 of 1 (the round-3 data-loss bug, fixed)', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    const body = goodBody({ evidence: { score: 3.4, confidence: 0.6, legend: {}, probabilities: { 0: 0, 1: 0, 2: 0.1, 3: 0.49, 4: 0.4 } } }); // sums to 0.99
    const r = parseScoreAnswers(req, body);
    assert.equal(r.invalid, undefined);
  });
  test('refuses a sum off by more than 0.02', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    const body = goodBody({ evidence: { score: 3.4, confidence: 0.6, legend: {}, probabilities: { 0: 0, 1: 0, 2: 0.1, 3: 0.3, 4: 0.4 } } }); // sums to 0.8
    assert.ok(parseScoreAnswers(req, body).invalid);
  });
  // Fix round 1 (review Important 2): the tolerance's actual boundary was untested -- built from
  // 0.2 four times plus one perturbed value each, so the sum is the direct IEEE 754 double
  // nearest 0.98/1.02/0.979/1.021, not assembled from many small parts that could drift further
  // from it. Reproduced by hand before this fix: with the comparison as `Math.abs(sum - 1) >
  // POLICY.PROB_TOLERANCE` and no epsilon, a sum of the literal double 0.98 computed
  // Math.abs(0.98 - 1) as 0.020000000000000018 -- strictly greater than the double for 0.02 --
  // so the boundary itself was wrongly invalid; TOLERANCE_EPSILON in lib/evaluate.mjs fixes this.
  test('the probability-sum tolerance is inclusive at its edges: 0.98 and 1.02 are valid', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    const low = goodBody({ evidence: { score: 3.4, confidence: 0.6, legend: {}, probabilities: { 0: 0.18, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2 } } }); // sums to 0.98
    const high = goodBody({ evidence: { score: 3.4, confidence: 0.6, legend: {}, probabilities: { 0: 0.22, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2 } } }); // sums to 1.02
    assert.equal(parseScoreAnswers(req, low).invalid, undefined);
    assert.equal(parseScoreAnswers(req, high).invalid, undefined);
  });
  test('the probability-sum tolerance excludes just past its edges: 0.979 and 1.021 are invalid', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    const low = goodBody({ evidence: { score: 3.4, confidence: 0.6, legend: {}, probabilities: { 0: 0.179, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2 } } }); // sums to 0.979
    const high = goodBody({ evidence: { score: 3.4, confidence: 0.6, legend: {}, probabilities: { 0: 0.221, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2 } } }); // sums to 1.021
    assert.ok(parseScoreAnswers(req, low).invalid);
    assert.ok(parseScoreAnswers(req, high).invalid);
  });
  // Fix round 1: the brief's own "wrong type" sub-case (an answer whose `type` was `'noul'`) is
  // dropped -- `type` is no longer part of the shape this parser checks at all (see the
  // controller ruling above), so there is nothing left for that sub-case to exercise. The other
  // four sub-cases from the brief's Step 1 snippet are unchanged.
  test('refuses out-of-range score, confidence, a missing dimension, or malformed JSON', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    assert.ok(parseScoreAnswers(req, 'not json').invalid);
    assert.ok(parseScoreAnswers(req, JSON.stringify({ model: 'jev-1.13.0', answers: {}, usage: {} })).invalid);
    assert.ok(parseScoreAnswers(req, goodBody({ evidence: { score: 5, confidence: 0.6, legend: {}, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 } } })).invalid);
    assert.ok(parseScoreAnswers(req, goodBody({ evidence: { score: 1, confidence: 1.5, legend: {}, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 } } })).invalid);
  });
  // Not in the brief's own test list: the task dispatch's own Global Constraints text separately
  // names "an extra question" and "a probabilities object with a missing or extra key" as
  // defects the parser must catch -- neither is exercised by the brief's Step 1 snippet, whose
  // probabilities check (Object.values(...).length !== 5) would miss a shifted key set entirely.
  // These tests cover them directly.
  test('refuses an answer key the request never asked for', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    const body = goodBody({ sixth: { score: 1, confidence: 0.5, legend: {}, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 } } });
    assert.ok(parseScoreAnswers(req, body).invalid);
  });
  test('refuses a probabilities object with a missing or extra key even when the five values are individually valid', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    // Keys 0,1,2,3,5: five values, each in [0,1], summing to 1 -- would pass a value-count-only
    // check but is missing "4" and carries an extra "5" instead.
    const body = goodBody({ evidence: { score: 3, confidence: 0.6, legend: {}, probabilities: { 0: 0.2, 1: 0.2, 2: 0.2, 3: 0.2, 5: 0.2 } } });
    assert.ok(parseScoreAnswers(req, body).invalid);
  });
  // Fix round 1 (review Important 3): `typeof x !== 'object'` admits arrays; a probabilities
  // array with five individually-valid values used to pass silently. Built by mutating a parsed
  // goodBody() rather than JSON.stringify-ing a literal containing an array in object position,
  // so this exercises exactly the shape `JSON.parse` would hand the parser from a real malformed
  // body (a top-level JSON array under the `probabilities` key), not a JS-only construct.
  test('refuses a probabilities array in place of an object, even with five valid values', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    const bad = JSON.parse(goodBody());
    bad.answers.evidence.probabilities = [0.2, 0.2, 0.2, 0.2, 0.2];
    assert.ok(parseScoreAnswers(req, JSON.stringify(bad)).invalid);
  });
  test('carries usage through when present and valid, and reports null when usage is malformed', () => {
    const req = buildScoreRequest(settings(), scoreState(), 0);
    const bad = JSON.parse(goodBody());
    bad.usage = { input_tokens: -1, output_tokens: 2 };
    const r = parseScoreAnswers(req, JSON.stringify(bad));
    assert.equal(r.invalid, undefined);
    assert.equal(r.usage, null);
  });
});

// --- Task 8: the veto and the composite -----------------------------------------------------
// Section 10: code, not the model, computes what happens next from the five levels and
// confidences. computeVeto checks reach, then contract, then surface against fixed thresholds;
// computeComposite is the weighted mean over the five dimensions (evidence inverted); and
// computeSuggested is the composite-vs-ceiling-and-confidence-floors advisory. `levels` here are
// parseScoreAnswers's own `score` floats (e.g. 1.02), not rounded integers -- the boundary test
// below (`reach: 3.99`) is exactly why the veto compares floats, not `>= 4` on a rounded level.
import { computeVeto, computeComposite, computeSuggested } from '../lib/evaluate.mjs';

const levels = (over = {}) => ({ evidence: 3, reach: 1, contract: 0, surface: 0, ambiguity: 1, ...over });
const conf = (over = {}) => ({ evidence: 0.8, reach: 0.8, contract: 0.8, surface: 0.8, ambiguity: 0.8, ...over });

describe('veto and composite', () => {
  test('veto checks reach, then contract, then surface, in that order', () => {
    assert.equal(computeVeto(levels({ reach: 4 })), 'reach');
    assert.equal(computeVeto(levels({ reach: 4, contract: 3 })), 'reach', 'reach is checked first');
    assert.equal(computeVeto(levels({ contract: 3 })), 'contract');
    assert.equal(computeVeto(levels({ contract: 3, surface: 3 })), 'contract');
    assert.equal(computeVeto(levels({ surface: 3 })), 'surface');
    assert.equal(computeVeto(levels()), null);
    assert.equal(computeVeto(levels({ reach: 3.99 })), null, 'reach needs >= 4, not >= 3');
  });
  test('composite: weight_d * level_d / 4, evidence inverted, summed with no renormalization', () => {
    const c = computeComposite(levels(), dims());
    // evidence term (4-3)/4=0.25, reach 1/4=0.25, contract 0, surface 0, ambiguity 1/4=0.25; * 0.2 each, summed
    assert.ok(Math.abs(c - 0.2 * (0.25 + 0.25 + 0 + 0 + 0.25)) < 1e-9);
  });
  // A local settings shape, not the file's top-level settings() helper: that helper's
  // confidence_floors is dims() (0.2 for every dimension), which would clear even the
  // 'under one confidence floor' case below (0.3 >= 0.2) and defeat the test's own point.
  // 0.5 floors, matching the brief, keep conf()'s 0.8 default well clear and 0.3 clearly under.
  const suggestSettings = () => ({ typesafeai: { agent_ceiling: 0.35, confidence_floors: { evidence: 0.5, reach: 0.5, contract: 0.5, surface: 0.5, ambiguity: 0.5 } } });
  // Fix round 1 (review Minor 4): the old version of this test asserted
  // `computeComposite(levels(), dims()) === computeComposite(levels(), dims())`, which is just a
  // determinism check -- computeComposite never takes a confidences parameter at all, so no
  // confidence value was ever varied to demonstrate it has no effect. This version computes the
  // composite once (still with no confidences involved, since the signature has none), then
  // feeds that same composite through computeSuggested under two confidence sets that flip the
  // suggestion (one clears every floor, one does not) -- and confirms the composite value itself
  // never moves. If a future refactor ever let confidence data reach computeComposite's math,
  // the two computeSuggested calls below would see two different composite numbers, not just two
  // different verdicts, and the final assert.equal(c1, c2) would fail.
  test('composite ignores confidence entirely; only the levels feed it', () => {
    const lv = levels(), w = dims();
    const c1 = computeComposite(lv, w);
    const c2 = computeComposite(lv, w);
    assert.equal(c1, c2);
    const s = suggestSettings();
    assert.equal(computeSuggested(c1, conf(), s), 'agent');
    assert.equal(computeSuggested(c2, conf({ ambiguity: 0.1 }), s), 'developer', 'confidence flips the suggestion');
    assert.equal(c1, c2, 'but never the composite value itself');
  });
  test('suggested is agent only when composite <= agent_ceiling and every confidence clears its floor', () => {
    const s = suggestSettings();
    assert.equal(computeSuggested(0.2, conf(), s), 'agent');
    assert.equal(computeSuggested(0.4, conf(), s), 'developer', 'over the ceiling');
    assert.equal(computeSuggested(0.2, conf({ ambiguity: 0.3 }), s), 'developer', 'under one confidence floor');
  });
  // Fix round 1 (Controller Ruling 11, review Important 1): the boundary tests above and below
  // used to feed computeSuggested a hand-typed literal `0.35` -- that never exercises
  // computeComposite's own summation at all, so it could not catch the real bug: `reduce`'s
  // left-to-right float addition is not associative, and for real weight/level inputs whose
  // exact rational composite is precisely the ceiling, the accumulated float can land a few ulps
  // above it, flipping the suggestion from the spec-required 'agent' to 'developer'. These three
  // tests pipe real levels and weights through computeComposite instead, so they actually
  // exercise the summation the bug lived in.
  test('a real computed composite, at the exact ceiling with equal weights, still suggests agent', () => {
    // Equal weights (0.2 each): choosing raw levels so every dimension's normalized term equals
    // the ceiling itself (0.35) makes the weighted mean exactly 0.35 by construction, whatever
    // the weight distribution, since sum(weight_d * 0.35) = 0.35 * sum(weight_d) = 0.35 * 1.
    // term_evidence = (4-level)/4 = 0.35 -> level = 2.6; term_d = level/4 = 0.35 -> level = 1.4
    // for reach/contract/surface/ambiguity.
    const c = computeComposite({ evidence: 2.6, reach: 1.4, contract: 1.4, surface: 1.4, ambiguity: 1.4 }, dims());
    assert.equal(c, 0.35);
    assert.equal(computeSuggested(c, conf(), suggestSettings()), 'agent');
  });
  test('Controller Ruling 11: a real computed composite at the exact ceiling, with unequal weights that drift a few ulps over it in unrounded float summation, still suggests agent', () => {
    // The review's own reproduction: these weights sum to exactly 1 and this composite's true
    // rational value is exactly 0.35 (28/80), but reduce's unrounded left-to-right float
    // summation lands on 0.35000000000000003 -- a few ulps over the ceiling, which uncorrected
    // flipped computeSuggested to 'developer' for a draft spec requires to read 'agent'.
    const weights = { evidence: 0.023, reach: 0.742, contract: 0.098, surface: 0.057, ambiguity: 0.08 };
    const lv = { evidence: 0.5, reach: 0.95, contract: 2.94, surface: 3.44, ambiguity: 1.63 };
    const c = computeComposite(lv, weights);
    assert.equal(c, 0.35, 'rounded to six decimals, the ulp drift is gone');
    assert.equal(computeSuggested(c, conf(), suggestSettings()), 'agent');
  });
  test('a real computed composite one 1e-6 step past the ceiling still suggests developer: rounding absorbs only float noise, not a genuine excess', () => {
    // All weight on one dimension isolates a single term, with no summation to drift at all:
    // term = level/4 = 0.350001 needs level = 1.400004. 0.350001 is exactly one step above the
    // ceiling at the same 1e-6 granularity computeComposite itself rounds to, proving the
    // rounding fix only ever absorbs float-summation noise (~1e-16), never a real excess at its
    // own resolution.
    const weights = { evidence: 0, reach: 1, contract: 0, surface: 0, ambiguity: 0 };
    const c = computeComposite({ evidence: 0, reach: 1.400004, contract: 0, surface: 0, ambiguity: 0 }, weights);
    assert.equal(c, 0.350001);
    assert.equal(computeSuggested(c, conf(), suggestSettings()), 'developer');
  });
  test('boundary: a confidence exactly at its floor still passes', () => {
    const s = suggestSettings();
    // s.typesafeai.confidence_floors is 0.5 for every dimension (suggestSettings, above).
    assert.equal(computeSuggested(0.2, conf({ ambiguity: 0.5 }), s), 'agent', 'confidence exactly at its floor still clears it');
  });
});

// --- Task 9: measure() -- identity, the intent, the jev call, finalize, crash recovery ---------
import { measure, recoverMeasurement, DraftError } from '../lib/evaluate.mjs';
import { readLog, decodeRecord } from '../lib/records.mjs';
import { unb64url } from '../lib/canon.mjs';
import { start } from '../lib/commitment.mjs';
import { loadSettings } from '../lib/settings.mjs';
import { catCommit } from '../lib/gitx.mjs';

// goodBody (Task 7, above) is the same five-dimension answer body this task's transport stubs
// need; reused here rather than redefined (Minor 6, review round: the two were byte-for-byte
// duplicates).
const transport = (bodies) => async () => { const b = bodies.shift(); if (b instanceof Error) throw b; return { status: 200, body: b, model: 'jev-1.13.0' }; };
// Deviation from the brief text, in two parts -- both reproduced by running the brief's literal
// fixture before this fix (task-9-report.md's RED section):
//
// 1. `settings.data` is not set, and defaults to `[]` (lib/init.mjs's DEFAULT_SETTINGS). Against
//    the real classify() (lib/paths.mjs), 'migrations/1.sql' only classifies 'data' when a `data`
//    glob actually matches it (`if (any(settings.data ?? [])) return 'data';`), the same way every
//    other real-repo fixture in this codebase that needs a 'data' path sets one
//    (tests/helpers/commitment-fixture.mjs: `data: ['migrations/**']`; tests/commitment.test.mjs's
//    own 'a data path' case relies on the same fixture). Without it, "the floor writes an intent
//    and a measurement with no call at all" below would see 'migrations/1.sql' classify 'plain',
//    floorReasons would return [], and the whole test would exercise the jev call path instead of
//    the floor.
// 2. The brief's roadmap-only `files` override cites AUTH-003 as a requirement but never defines
//    it anywhere docs/spec can see: real `start()` (lib/commitment.mjs's prepareStart) runs
//    lib/spec.mjs's lint() first and refuses with "reference to absent identifier AUTH-003", and
//    even past that, prepareStart also refuses without a current authorization
//    (`currentAuthorization`) -- `sudus authorize` was never run. This codebase's own working
//    pattern for a real (non-hand-appended) start() is tests/helpers/commitment-fixture.mjs's
//    project(): a domain file (Prefix + an Agreed block with a mechanism, since an Agreed block
//    with no mechanism is its own lint finding), an overview.md spec-map row naming it, and
//    `repo.authorize()` after the files are committed. Followed here for the one AUTH-003
//    requirement this task's fixtures actually need, rather than switching to a hand-appended
//    'start' record (tests/helpers/loop.mjs's own, different way of avoiding this same machinery)
//    -- measure() reads the commitment through kernelFacts either way, but the real start() is
//    what the brief's own import of `start` from lib/commitment.mjs calls for.
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
// Fix round 1 (controller ruling, task-10-review.md "Important"): `minCalibrationAgentPredictions`
// defaults to 60 (unchanged for every caller that doesn't pass it -- the measure() tests above
// never do) but lets the calibration tests below configure a small real floor instead of building
// enough real measure()+escalate()+answer() cycles to clear the actual default of 60. readLog(cwd)
// re-reads and re-decodes the whole log on every call inside measure()/escalate()/answer(), so
// each additional cycle's cost grows with the log built so far -- a real n=60 buildup is
// super-linear in wall time (confirmed: two n=30 buildups in the original test cost ~60s and
// ~61.5s respectively, not the same ~30s each a linear cost would predict), which is why a small
// configured floor plus a small real sample proves the same join/counting behavior in a fraction
// of the time.
// Task 6 (plan 16) extends this fixture's second parameter to also accept a settings-override
// object (e.g. `{ harness: { claude_code: { adversary_model, adversary_transport } } }`, the
// pinned-launch test needs) alongside its existing numeric use (min_calibration_agent_predictions,
// the calibration tests above). Kept backward compatible by branching on typeof: every existing
// numeric caller (`repoWithCommitment(true, 5)`, `repoWithCommitment(true, 3)`) is unaffected, and
// an object caller gets its extra top-level settings keys merged in alongside `data`/`typesafeai`
// (makeProject's own settings merge is a shallow spread over DEFAULT_SETTINGS, so a sibling key
// like `harness` merges cleanly without touching `data`/`typesafeai`).
async function repoWithCommitment(enabled = true, extra = 60, files = {}) {
  const minCalibrationAgentPredictions = typeof extra === 'number' ? extra : 60;
  const extraSettings = typeof extra === 'object' && extra !== null ? extra : {};
  const p = await makeProject({ settings: { data: ['migrations/**'], typesafeai: { enabled, model: 'jev-1.13.0', weights: dims(), agent_ceiling: 0.35, confidence_floors: dims(), min_calibration_agent_predictions: minCalibrationAgentPredictions, request_cap_bytes: 48000 }, ...extraSettings },
    files: {
      'docs/spec/overview.md': OVERVIEW_WITH_AUTH,
      'docs/spec/auth.md': AUTH_DOMAIN,
      'docs/spec/roadmap.md': 'Current: auth-tokens\n\n## auth-tokens\n\nRequirements: AUTH-003\n',
      ...files,
    } });
  await p.authorize();
  await start(p.cwd, 'auth-tokens');
  return p.cwd;
}

describe('measure()', () => {
  test('jev: intent precedes the one call; the measurement carries the composite and suggestion', async () => {
    const cwd = await repoWithCommitment();
    const r = await measure(cwd, draft(), { transport: transport([goodBody()]) });
    assert.equal(r.outcome, 'composite'); assert.equal(r.suggested, 'agent'); assert.equal(r.veto, null);
    const log = await readLog(cwd);
    assert.deepEqual(log.slice(-3).map((x) => x.kind), ['evaluation-intent', 'evaluation-call', 'measurement']);
    const [intent, call, m] = log.slice(-3);
    assert.equal(intent.payload.source, 'jev'); assert.equal(call.payload.source, 'jev'); assert.equal(call.payload.outcome, 'response');
    assert.equal(Buffer.from(unb64url(call.payload.raw)).toString(), goodBody());
    assert.equal(m.payload.intent, intent.sha); assert.equal(m.payload.call, call.sha);
    assert.equal(m.payload.levels.length, 5);
    // Deviation from the brief text: the brief's own snippet calls `decodeRecord(rec)` on `rec`
    // straight out of `readLog(cwd)`'s own output -- but readLog's entries are already-decoded
    // `{sha, kind, target, payload, parent}` objects (lib/records.mjs's readLog), not the raw
    // `{subject, body/bodyBytes, trailers}` commit shape decodeRecord actually takes (lib/
    // records.mjs's decodeRecord, unchanged by this task); readLog already runs decodeRecord
    // internally while building that array, so calling it a second time on the wrong shape would
    // either throw for the wrong reason (proving nothing about this task's own writes) or, if
    // patched to accept it, be circular. Re-fetching each record's real commit via catCommit and
    // decoding that is the faithful version of the same check: a genuine round trip through the
    // envelope and schema validation against exactly what appendRecord wrote to the log ref.
    for (const rec of log.slice(-3)) {
      const commit = await catCommit(cwd, rec.sha);
      assert.doesNotThrow(() => decodeRecord(commit));
    }
  });
  // Review of 3.8.2: a 200 response that echoed the bearer key was recorded whole in
  // evaluation-call.raw, which travels with refs/sudus/log; only error bodies were redacted.
  test('a response that echoes the key is recorded without it, on a valid answer and on a model mismatch', async () => {
    const prev = process.env.TYPESAFEAI_API_KEY;
    process.env.TYPESAFEAI_API_KEY = 'test-placeholder-key-222';
    try {
      const recorded = async (cwd) => (await readLog(cwd)).map((r) => JSON.stringify(r.payload) + (r.payload.raw ? Buffer.from(unb64url(r.payload.raw)).toString() : '')).join('\n');
      const a = await repoWithCommitment();
      const echo = JSON.stringify({ ...JSON.parse(goodBody()), echo: 'Bearer test-placeholder-key-222' });
      assert.equal((await measure(a, draft(), { transport: transport([echo]) })).outcome, 'composite');
      const b = await repoWithCommitment();
      const wrong = async () => ({ status: 200, body: '{"model":"test-placeholder-key-222"}', model: 'test-placeholder-key-222' });
      assert.equal((await measure(b, draft(), { transport: wrong })).outcome, 'unavailable');
      for (const cwd of [a, b]) {
        const text = await recorded(cwd);
        assert.ok(!text.includes('test-placeholder-key-222'), text);
        assert.ok(text.includes('[redacted]'));
      }
    } finally {
      if (prev === undefined) delete process.env.TYPESAFEAI_API_KEY; else process.env.TYPESAFEAI_API_KEY = prev;
    }
  });
  test('a veto forces developer even with a low composite', async () => {
    const cwd = await repoWithCommitment();
    const body = goodBody({ contract: { score: 3.5, confidence: 0.9, legend: {}, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0.5, 4: 0.5 } } });
    const r = await measure(cwd, draft(), { transport: transport([body]) });
    assert.equal(r.outcome, 'veto'); assert.equal(r.veto, 'contract'); assert.equal(r.suggested, null);
  });
  // Issue #12: a recommendation that is not one --option word for word floored as a bare
  // incomplete-projection, which cost the developer an answer and named nothing to fix.
  test('a recommendation that is not one option word for word is refused before any record', async () => {
    const cwd = await repoWithCommitment();
    const head = (await readLog(cwd)).length;
    let called = false;
    const never = async () => { called = true; };
    await assert.rejects(measure(cwd, { ...draft(), recommendation: 'Rotate hourly: it keeps sessions short.' }, { transport: never }),
      (e) => e instanceof DraftError && e.message === 'sudus: measure: --recommendation must repeat one --option word for word; it is none of "hourly", "daily"');
    await assert.rejects(measure(cwd, { ...draft(), options: [] }, { transport: never }),
      (e) => e instanceof DraftError && e.message === 'sudus: measure: name each choice with --option; --recommendation must repeat one of them word for word');
    assert.equal(called, false);
    assert.equal((await readLog(cwd)).length, head);
  });
  // Issue #16: a directory in --path was refused as a "special file".
  test('a directory in --path is refused by name before any record', async () => {
    const cwd = await repoWithCommitment();
    await mkdirAndWrite(cwd, 'scripts/run.sh', 'echo\n');
    const head = (await readLog(cwd)).length;
    await assert.rejects(measure(cwd, { ...draft(), named_paths: ['scripts', 'src/auth/rotate.mjs'] }, { transport: async () => {} }),
      (e) => e instanceof DraftError && e.message === 'sudus: measure: --path scripts is a directory; name the files the decision touches');
    assert.equal((await readLog(cwd)).length, head);
  });
  // Review of 3.5.0: the directory check followed symlinks, so a symlink to a directory, which
  // measure has always read as a link, was refused.
  test('a symlink to a directory in --path is read as a link, not refused', async () => {
    const cwd = await repoWithCommitment();
    await mkdirAndWrite(cwd, 'scripts/run.sh', 'echo\n');
    await symlink('scripts', join(cwd, 'link-to-scripts'));
    const r = await measure(cwd, { ...draft(), named_paths: ['link-to-scripts'] }, { transport: transport([goodBody()]) });
    assert.equal(r.outcome, 'composite');
  });
  // Review of 3.8.2: lstat follows parent directories, so a named path under a directory symlink
  // that points out of the repository put the outside file's text in the request.
  test('a --path under a directory symlink out of the repository is excluded before anything is read', async () => {
    const cwd = await repoWithCommitment();
    const outside = await mkdtemp(join(tmpdir(), 'sudus-outside-'));
    await writeFile(join(outside, 'file.txt'), 'OUTSIDE-BYTES\n');
    await symlink(outside, join(cwd, 'linkdir'));
    let sent = null;
    const r = await measure(cwd, { ...draft(), named_paths: ['linkdir/file.txt'] }, { transport: async (req) => { sent = req; return { status: 200, body: goodBody(), model: 'jev-1.13.0' }; } });
    assert.equal(sent, null);
    assert.deepEqual([r.outcome, r.reason], ['unavailable', 'unavailable excluded: reserved linkdir/file.txt']);
  });
  // Review of 3.8.2: on a case-insensitive filesystem (macOS by default) a case variant of an
  // excluded path opened the excluded file while the network_exclude glob missed it. Runs where
  // the test directory ignores case; elsewhere the variant names no file at all.
  test('a case variant of a network_exclude path is excluded under its stored name', async (t) => {
    const cwd = await repoWithCommitment(true, { network_exclude: ['secret/**'] }, { 'secret/plain.txt': 'EXCLUDED-BYTES\n' });
    try { await lstat(join(cwd, 'SECRET/plain.txt')); } catch { t.skip('the test directory is case-sensitive'); return; }
    let sent = null;
    const r = await measure(cwd, { ...draft(), named_paths: ['Secret/plain.txt'] }, { transport: async (req) => { sent = req; return { status: 200, body: goodBody(), model: 'jev-1.13.0' }; } });
    assert.equal(sent, null);
    assert.deepEqual([r.outcome, r.reason], ['unavailable', 'unavailable excluded: network_exclude secret/plain.txt']);
  });
  test('an incomplete-projection floor names the concern and the decision that caused it', async () => {
    const cwd = await repoWithCommitment();
    const r = await measure(cwd, { ...draft(), concerns: ['AUTH-003', 'AUTH-999'], cited_decisions: ['01J0000000000000000000ABCD'] }, { transport: async () => {} });
    assert.equal(r.outcome, 'floor'); assert.equal(r.reason, 'floor:incomplete-projection');
    assert.equal(r.detail, 'concern AUTH-999 names nothing in this commitment; decision 01J0000000000000000000ABCD was not found');
    assert.equal((await readLog(cwd)).at(-1).payload.reason, 'floor:incomplete-projection');
  });
  test('the floor writes an intent and a measurement with no call at all', async () => {
    const cwd = await repoWithCommitment();
    let called = false;
    const r = await measure(cwd, { ...draft(), named_paths: ['migrations/1.sql'] }, { transport: async () => { called = true; } });
    assert.equal(called, false); assert.equal(r.outcome, 'floor'); assert.equal(r.reason, 'floor:data');
    const log = await readLog(cwd);
    assert.deepEqual(log.slice(-2).map((x) => x.kind), ['evaluation-intent', 'measurement']);
    assert.equal(log.at(-2).payload.source, 'jev', 'source is settled from settings before the floor is checked, never null');
    assert.equal(log.at(-2).payload.request_digest, null);
    assert.equal(log.at(-1).payload.call, null); assert.equal(log.at(-1).payload.source, 'jev'); assert.deepEqual(log.at(-1).payload.levels, []);
  });
  test('a failed transport call is unavailable <class>, recorded and routed', async () => {
    const cwd = await repoWithCommitment();
    const e = new Error('overloaded'); e.klass = 'overloaded';
    const r = await measure(cwd, draft(), { transport: transport([e]) });
    assert.equal(r.outcome, 'unavailable'); assert.equal(r.reason, 'unavailable overloaded');
    const call = (await readLog(cwd)).findLast((x) => x.kind === 'evaluation-call');
    assert.equal(call.payload.outcome, 'failure'); assert.equal(call.payload.failure_class, 'overloaded');
  });
  test('an invalid answer is unavailable invalid, never agent or developer by suggestion', async () => {
    const cwd = await repoWithCommitment();
    const bad = JSON.stringify({ model: 'jev-1.13.0', answers: {}, usage: {} });
    const r = await measure(cwd, draft(), { transport: transport([bad]) });
    assert.equal(r.outcome, 'unavailable'); assert.equal(r.suggested, null);
  });
  test('review source: writes the intent and returns pending, no call, no measurement yet', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { env: { CLAUDECODE: '1' } });
    assert.equal(r.pending, 'review');
    const log = await readLog(cwd);
    assert.deepEqual(log.map((x) => x.kind).slice(-1), ['evaluation-intent']);
    assert.equal(log.at(-1).payload.source, 'review'); assert.ok(log.at(-1).payload.request_digest);
  });
  // Fix (Critical C1, final-review.md): detectHarness (lib/review.mjs) throws a bare ReviewError
  // when no harness can be detected -- an `env` object that carries none of --harness,
  // SUDUS_HARNESS, or a recognized harness env var (CLAUDECODE/CODEX_HOME/MUSE_SESSION). Section
  // 10 requires this to be a recorded `unavailable <class>` measurement, the same as any other
  // technical no-call, never an uncaught exception past measure(). A controlled, empty `env: {}`
  // is passed explicitly so this test does not depend on -- and cannot be fooled by -- whatever
  // harness variables the real process happens to export (this review's own reproduction found
  // exactly two pre-existing tests that only passed because CLAUDECODE was set in the dev shell).
  test('review source: no harness detectable is a recorded unavailable measurement, not a crash', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { env: {} });
    assert.equal(r.outcome, 'unavailable'); assert.equal(r.reason, 'unavailable no-harness'); assert.equal(r.suggested, null);
    const log = await readLog(cwd);
    assert.deepEqual(log.slice(-2).map((x) => x.kind), ['evaluation-intent', 'measurement']);
    const [intent, m] = log.slice(-2);
    assert.equal(intent.payload.source, 'review'); assert.equal(intent.payload.launch, null); assert.equal(intent.payload.request_digest, null);
    assert.equal(m.payload.call, null, 'no call record'); assert.equal(m.payload.source, 'review');
    assert.equal(m.payload.outcome, 'unavailable'); assert.equal(m.payload.reason, 'unavailable no-harness'); assert.equal(m.payload.suggested, null);
  });
  test('identity is captured before any write; equal identity and policy yield byte-identical requests', async () => {
    const cwd = await repoWithCommitment();
    const a = []; const t = () => async (req) => { a.push(req); return { status: 200, body: goodBody(), model: 'jev-1.13.0' }; };
    await measure(cwd, draft(), { transport: t() });
    const b = []; const t2 = () => async (req) => { b.push(req); return { status: 200, body: goodBody(), model: 'jev-1.13.0' }; };
    await measure(cwd, draft(), { transport: t2() });
    assert.equal(JSON.stringify(a[0]), JSON.stringify(b[0]));
  });
  test('an unknown crash outcome leaves the intent open; recovery marks indeterminate, never retries', async () => {
    const cwd = await repoWithCommitment();
    const crash = new Error('crash'); // no .klass: an unknown outcome
    await assert.rejects(measure(cwd, draft(), { transport: transport([crash]) }));
    let log = await readLog(cwd);
    assert.equal(log.at(-1).kind, 'evaluation-intent');
    let calls = 0;
    const sha = await recoverMeasurement(cwd, { transport: async () => { calls++; } });
    log = await readLog(cwd);
    assert.equal(calls, 0); assert.equal(log.at(-1).sha, sha);
    assert.equal(log.at(-1).payload.outcome, 'indeterminate'); assert.equal(log.at(-1).payload.suggested, null);
    assert.equal(log.at(-2).payload.outcome, 'indeterminate'); assert.equal(log.at(-2).payload.raw, null);
    assert.equal(await recoverMeasurement(cwd), null, 'idempotent');
  });
  // Ruling 5(c)'s other named crash-recovery subject: an intent with a call record already written
  // but no measurement -- the window between the call landing and finalizeMeasurement's own write.
  // Not in the brief's own Step 1 snippet (which only covers the no-call-record half above); built
  // directly on appendRecord/the lower-level primitives measure() itself uses, reproducing exactly
  // the state a crash in that second window would leave, since a real process crash cannot be
  // staged from inside a single measure() call.
  test('a crash after the call record lands but before the measurement still finalizes indeterminate, from the existing call, not a new one', async () => {
    const cwd = await repoWithCommitment();
    const D = normalizeDraft(draft());
    const { settings, digest: settingsDigest } = await loadSettings(cwd);
    const f = await kernelFacts(cwd, D);
    const n = D.options.indexOf(D.recommendation);
    const C = await contractState(cwd, f);
    const { state } = await measureState(cwd, D, n, C, f);
    const request = buildScoreRequest(settings, state, n);
    const logHead = (await readLog(cwd)).at(-1).sha;
    const intentSha = await appendRecord(cwd, 'evaluation-intent', f.slug, {
      draft_digest: draftDigest(D), snapshot: await writeWorkspaceSnapshot(cwd), log_head: logHead,
      adr_digest: await adrDigest(cwd), settings_digest: settingsDigest, policy_digest: policyDigest(settings),
      source: 'jev', request_digest: requestDigest(request), session: null, launch: null,
    });
    const callSha = await appendRecord(cwd, 'evaluation-call', f.slug, {
      intent: intentSha, source: 'jev', request_digest: requestDigest(request), outcome: 'response', model: 'jev-1.13.0',
      transport: null, session: null, raw: b64url(Buffer.from(goodBody(), 'utf8')), failure_class: null,
      answers: null, usage: { input_tokens: 10, output_tokens: 2 },
    });
    const sha = await recoverMeasurement(cwd);
    const log = await readLog(cwd);
    assert.equal(sha, log.at(-1).sha);
    assert.equal(log.at(-1).kind, 'measurement');
    assert.equal(log.at(-1).payload.call, callSha, 'reuses the existing call record instead of writing a new one');
    assert.equal(log.at(-1).payload.outcome, 'indeterminate');
    assert.equal(log.filter((x) => x.kind === 'evaluation-call').length, 1, 'no duplicate call record from recovery');
    assert.equal(await recoverMeasurement(cwd), null, 'idempotent');
  });
  test('a pending review intent is left alone by recovery, not marked indeterminate', async () => {
    const cwd = await repoWithCommitment(false);
    await measure(cwd, draft(), { env: { CLAUDECODE: '1' } });
    assert.equal(await recoverMeasurement(cwd), null);
    const log = await readLog(cwd);
    assert.equal(log.at(-1).kind, 'evaluation-intent');
  });
  // Not in the brief's own test list: self-review completeness (every outcome branch, both
  // sources). measureState's own EgressError is exercised directly by the C(c)/M(D) describe block
  // above; this covers measure()'s own handling of it -- no call record, and the class/path kept in
  // the reason (section 10: "only `unavailable excluded` and its path class are recorded").
  test('an excluded touched path is unavailable excluded, naming the class and path, and writes no call', async () => {
    const cwd = await repoWithCommitment();
    let called = false;
    const r = await measure(cwd, { ...draft(), named_paths: ['secret/.env'] }, { transport: async () => { called = true; } });
    assert.equal(called, false);
    assert.equal(r.outcome, 'unavailable');
    assert.equal(r.reason, 'unavailable excluded: credential secret/.env');
    const log = await readLog(cwd);
    assert.deepEqual(log.slice(-2).map((x) => x.kind), ['evaluation-intent', 'measurement']);
    assert.equal(log.at(-2).payload.request_digest, null);
    assert.equal(log.at(-1).payload.call, null);
  });
  // sizeCheck's own boundaries are unit-tested directly in "the Score request" describe block
  // above; this is measure()'s own wiring of an oversize request into 'unavailable oversize' with
  // no call and no request digest recorded.
  // Issue #17: the reason says which limit broke, by how much, and where the bytes are.
  test('an oversize request is unavailable oversize, names its size, the cap and the largest named file, and writes no call', async () => {
    const cwd = await repoWithCommitment();
    await mkdirAndWrite(cwd, 'src/auth/rotate.mjs', 'export const rotate = () => {};\n');
    await mkdirAndWrite(cwd, 'src/auth/keys.mjs', 'export const keys = [];\n' + '// padding\n'.repeat(100));
    let called = false;
    const r = await measure(cwd, { ...draft(), because: 'x'.repeat(200000), named_paths: ['src/auth/rotate.mjs', 'src/auth/keys.mjs'] }, { transport: async () => { called = true; } });
    assert.equal(called, false);
    assert.equal(r.outcome, 'unavailable');
    const named = 'export const rotate = () => {};\n'.length + 'export const keys = [];\n'.length + '// padding\n'.length * 100;
    assert.match(r.reason, new RegExp(`^unavailable oversize: the request is \\d+ bytes, over its cap of 48000; the named paths' contents are ${named} bytes, the largest src/auth/keys.mjs at ${named - 'export const rotate = () => {};\n'.length}$`));
    const log = await readLog(cwd);
    assert.equal(log.at(-1).payload.reason, r.reason);
    assert.deepEqual(log.slice(-2).map((x) => x.kind), ['evaluation-intent', 'measurement']);
    assert.equal(log.at(-2).payload.request_digest, null, 'an oversize request is never recorded as sent');
    assert.equal(log.at(-1).payload.call, null);
  });
  // Spec revision 20 (issue #69): a commitment's own requirements filled the request, so every
  // measurement on it was unavailable oversize and decide --consequential could never run.
  const LARGE_IDS = Array.from({ length: 23 }, (_, i) => `AUTH-${String(i + 1).padStart(3, '0')}`);
  const largeCommitment = () => ({
    'docs/spec/auth.md': 'Prefix: AUTH\n\n' + LARGE_IDS.map((id) => `[${id}] Tokens rotate on schedule ${id}. ${'The schedule holds under load and across restarts. '.repeat(45)}\nFalsifier: tokens for ${id} are not rotated on schedule.\nMechanism: rotate\nStatus: Agreed 2026-09-19\n`).join('\n'),
    'docs/spec/roadmap.md': `Current: auth-tokens\n\n## auth-tokens\n\nRequirements: ${LARGE_IDS.join(', ')}\n`,
  });
  const sent = (bodies, requests) => async (request) => { requests.push(request); return { status: 200, body: bodies.shift(), model: 'jev-1.13.0' }; };
  test('a request over the cap is sent with the text of only the requirements its concerns name, and the reason says so (issue #69)', async () => {
    const cwd = await repoWithCommitment(true, 60, largeCommitment());
    await mkdirAndWrite(cwd, 'src/auth/rotate.mjs', 'export const rotate = () => {};\n');
    const requests = [];
    const r = await measure(cwd, draft(), { transport: sent([goodBody()], requests) });
    assert.equal(requests.length, 1);
    const reqs = requests[0].state.contract.requirements;
    assert.deepEqual(reqs.map((x) => x.id), LARGE_IDS);
    assert.ok(reqs.every((x) => /^sha256:/.test(x.text_digest)));
    assert.deepEqual(reqs.filter((x) => x.obligation !== null || x.falsifier !== null).map((x) => x.id), ['AUTH-003']);
    assert.match(reqs.find((x) => x.id === 'AUTH-003').obligation, /^Tokens rotate on schedule AUTH-003\./);
    assert.equal(sizeCheck(settings(), requests[0]), null);
    assert.equal(r.outcome, 'composite');
    assert.match(r.reason, /^composite \S+ <= 0\.35, confidences ok; sent with requirement text for AUTH-003 only \(the full request: the request is \d+ bytes, over its cap of 48000; the named paths' contents are \d+ bytes, the largest src\/auth\/rotate\.mjs at \d+\)$/);
    const log = await readLog(cwd);
    assert.equal(log.at(-1).payload.reason, r.reason);
    assert.equal(log.at(-3).payload.request_digest, requestDigest(requests[0]), 'the intent fixes the digest of the request sent');
    // The agent can now record the decision itself, as the working agreement's Consequential step says.
    const { decideConsequential } = await import('../lib/escalate.mjs');
    await assert.doesNotReject(decideConsequential(cwd, draft()));
    const { readAdr } = await import('../lib/adr.mjs');
    assert.equal((await readAdr(cwd)).at(-1).evaluation, r.measurementSha);
  });
  test('a request still over the cap with the concerns\' requirement text only is unavailable oversize and says so (issue #69)', async () => {
    const cwd = await repoWithCommitment(true, 60, largeCommitment());
    await mkdirAndWrite(cwd, 'src/auth/rotate.mjs', 'export const rotate = () => {};\n' + '// padding\n'.repeat(5000));
    let called = false;
    const r = await measure(cwd, draft(), { transport: async () => { called = true; } });
    assert.equal(called, false);
    assert.equal(r.outcome, 'unavailable');
    assert.match(r.reason, /^unavailable oversize: the request is \d+ bytes, over its cap of 48000; the named paths' contents are \d+ bytes, the largest src\/auth\/rotate\.mjs at \d+; with requirement text for AUTH-003 only$/);
    assert.equal((await readLog(cwd)).at(-2).payload.request_digest, null);
  });
  test('a request that fits carries every frozen requirement\'s text (issue #69)', async () => {
    const cwd = await repoWithCommitment();
    await mkdirAndWrite(cwd, 'src/auth/rotate.mjs', 'export const rotate = () => {};\n');
    const requests = [];
    const r = await measure(cwd, draft(), { transport: sent([goodBody()], requests) });
    assert.deepEqual(requests[0].state.contract.requirements.map((x) => [x.id, x.obligation]), [['AUTH-003', 'Tokens rotate on a fixed schedule.']]);
    assert.doesNotMatch(r.reason, /sent with/);
  });
  // measure()'s own model-mismatch cross-check (res.model !== request.model): a defensive failure
  // class distinct from a transport-level failure or an invalid-answer parse, recorded as a real
  // evaluation-call (outcome: failure) the same way a transport failure is.
  test('a response naming a different model than requested is unavailable model_mismatch, recorded as a call failure', async () => {
    const cwd = await repoWithCommitment();
    const t = () => async () => ({ status: 200, body: goodBody(), model: 'jev-9.9.9' });
    const r = await measure(cwd, draft(), { transport: t() });
    assert.equal(r.outcome, 'unavailable'); assert.equal(r.reason, 'unavailable model_mismatch: got jev-9.9.9');
    const call = (await readLog(cwd)).findLast((x) => x.kind === 'evaluation-call');
    assert.equal(call.payload.outcome, 'failure'); assert.equal(call.payload.failure_class, 'model_mismatch');
    assert.equal(call.payload.model, 'jev-9.9.9', 'the actually-returned model is preserved for the audit trail');
  });
  // Both sources hit the floor the same way (section 10: the floor runs "before any call", for
  // either source) -- the given test list only exercises it under jev; this confirms the review
  // source never reaches its own 'pending' return once the floor has already decided the draft.
  test('the floor fires for the review source too, before any pending review return', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, { ...draft(), named_paths: ['migrations/1.sql'] });
    assert.equal(r.outcome, 'floor'); assert.equal(r.reason, 'floor:data');
    assert.equal(r.pending, undefined);
    const log = await readLog(cwd);
    assert.deepEqual(log.slice(-2).map((x) => x.kind), ['evaluation-intent', 'measurement']);
    assert.equal(log.at(-2).payload.source, 'review');
  });
  // Egress exclusion runs before the jev/review fork (measureState is called once, ahead of the
  // `source === 'review'` pending return), so it is the one 'unavailable' outcome both sources can
  // reach -- 'oversize' cannot (sizeCheck only runs `if (source === 'jev')`, per section 10's own
  // "Sudus does not separately cap [the review request's] size beyond the state it sends"), and a
  // transport failure/invalid answer/model mismatch cannot (review never calls a transport at all
  // from inside this function). Completes both-source coverage of the 'unavailable' branch.
  test('an excluded touched path is unavailable excluded for the review source too, with no call and no pending review return', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, { ...draft(), named_paths: ['secret/.env'] });
    assert.equal(r.outcome, 'unavailable'); assert.equal(r.reason, 'unavailable excluded: credential secret/.env');
    assert.equal(r.pending, undefined);
    const log = await readLog(cwd);
    assert.deepEqual(log.slice(-2).map((x) => x.kind), ['evaluation-intent', 'measurement']);
    assert.equal(log.at(-2).payload.source, 'review');
    assert.equal(log.at(-1).payload.call, null);
  });
});

// --- Task 1 (plan 16): measure() records session on every intent, and launch for the review
// source. Deviation from the brief text: the brief's snippet calls the fixture `scoreBody()`;
// this file's own five-dimension answer body (Task 7, above) is named `goodBody()` -- reused here,
// not redefined, the same as the existing `measure()` describe block above does.
describe('measure() records session and launch on the intent', () => {
  test('jev: session is recorded, launch is null', async () => {
    const cwd = await repoWithCommitment();
    await measure(cwd, draft(), { transport: transport([goodBody()]), session: 'sess-agent' });
    const intent = (await readLog(cwd)).findLast((x) => x.kind === 'evaluation-intent');
    assert.equal(intent.payload.session, 'sess-agent'); assert.equal(intent.payload.launch, null);
  });
  test('review: launch is the detected harness', async () => {
    const cwd = await repoWithCommitment(false);
    await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    const intent = (await readLog(cwd)).findLast((x) => x.kind === 'evaluation-intent');
    assert.equal(intent.payload.session, 'sess-agent');
    assert.deepEqual(intent.payload.launch, { harness: 'claude_code', model: null, transport: null, boundary: 'unenforced' });
  });
  test('a floor hit still records session', async () => {
    const cwd = await repoWithCommitment();
    await measure(cwd, { ...draft(), named_paths: ['migrations/1.sql'] }, { session: 'sess-agent' });
    const intent = (await readLog(cwd)).findLast((x) => x.kind === 'evaluation-intent');
    assert.equal(intent.payload.session, 'sess-agent'); assert.equal(intent.payload.launch, null);
  });
});

// --- Task 6 (plan 16): completeReviewMeasurement -- sudus measure <slug> --file <path> ----------
// Section 9's report() refusal, mirrored for the review source's measurement completion: the
// session that wrote the brief may not answer it, and a body model/transport that disagrees with
// the intent's own recorded launch (when the launch pinned one) is refused the same way. Reuses
// parseScoreAnswers and finalizeMeasurement exactly as the jev path in measure() does.
import { completeReviewMeasurement } from '../lib/evaluate.mjs';

// Deviation from the brief text: the brief's own Step 1 snippet spreads `...over` inside the
// `answers` object (`ambiguity: {...}, ...over } });`), not at the top level of the returned
// body. reviewBody({ session: 'sess-agent' })/({ model: 'some-other-model' })/({ model: 'anything'
// }) -- exactly the three overrides the brief's own tests below pass -- were each meant to replace
// a top-level field (session, model), but landed as a bogus sixth key inside `answers` instead,
// which parseScoreAnswers's own "an extra question" guard (lib/evaluate.mjs) rejects as `answer
// session not requested` / `answer model not requested` before either refusal check or the
// intended-acceptance path is ever reached (reproduced: every one of the three tests that pass an
// override failed before this fix -- two "Missing expected rejection" where the real bug masked
// the intended refusal behind an unrelated invalid-answer outcome, one composite/unavailable
// mismatch where the fourth test's "accepts any model" body was itself rejected as invalid). Moved
// to the top level, where `model`/`session`/`transport` actually live on this schema.
const reviewBody = (over = {}) => ({ model: 'claude-fable-5-1', session: 'sess-reviewer', transport: 'remote',
  usage: { input_tokens: 5, output_tokens: 1 },
  answers: { evidence: { type: 'score', score: 3, confidence: 0.7, probabilities: { 0: 0, 1: 0, 2: 0.1, 3: 0.6, 4: 0.3 } },
    reach: { type: 'score', score: 0.5, confidence: 0.6, probabilities: { 0: 0.6, 1: 0.2, 2: 0.1, 3: 0.1, 4: 0 } },
    contract: { type: 'score', score: 0.1, confidence: 0.9, probabilities: { 0: 0.9, 1: 0.1, 2: 0, 3: 0, 4: 0 } },
    surface: { type: 'score', score: 0, confidence: 0.8, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0, 4: 0 } },
    ambiguity: { type: 'score', score: 1, confidence: 0.5, probabilities: { 0: 0.3, 1: 0.4, 2: 0.2, 3: 0.1, 4: 0 } } }, ...over });

describe('completeReviewMeasurement', () => {
  test('records the composite from the five levels, exactly like the jev path', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    const c = await completeReviewMeasurement(cwd, r.slug, reviewBody());
    assert.equal(c.outcome, 'composite'); assert.ok(typeof c.composite === 'number');
    const call = (await readLog(cwd)).findLast((x) => x.kind === 'evaluation-call');
    assert.equal(call.payload.source, 'review'); assert.equal(call.payload.session, 'sess-reviewer'); assert.equal(call.payload.model, 'claude-fable-5-1');
  });
  test('refuses the session that started the brief', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    await assert.rejects(completeReviewMeasurement(cwd, r.slug, reviewBody({ session: 'sess-agent' })), /session/);
  });
  test('refuses a model or transport that disagrees with the launch, when one was pinned', async () => {
    const cwd = await repoWithCommitment(false, { harness: { claude_code: { adversary_model: 'claude-fable-5-1', adversary_transport: 'remote' } } });
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    await assert.rejects(completeReviewMeasurement(cwd, r.slug, reviewBody({ model: 'some-other-model' })), /model/);
  });
  test('a null-pinned launch (harness entry null or absent) accepts any model', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    const c = await completeReviewMeasurement(cwd, r.slug, reviewBody({ model: 'anything' }));
    assert.equal(c.outcome, 'composite');
  });
  test('an invalid answer set is unavailable invalid, same as the jev path', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    const bad = reviewBody(); delete bad.answers.surface;
    const c = await completeReviewMeasurement(cwd, r.slug, bad);
    assert.equal(c.outcome, 'unavailable'); assert.equal(c.suggested, null);
  });
  test('refuses when there is no pending review intent for the slug', async () => {
    const cwd = await repoWithCommitment(false);
    await assert.rejects(completeReviewMeasurement(cwd, 'auth-tokens', reviewBody()), /no pending/);
  });
  // Fix round 1 (Important 2, task-6-review.md): re-submitting --file against an intent that
  // already completed must be refused with a message distinct from "never had one at all"
  // (the test immediately above), and must not write a second measurement.
  test('refuses re-submitting --file against an already-completed review intent, with a distinct message, and writes no second measurement', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    const first = await completeReviewMeasurement(cwd, r.slug, reviewBody());
    assert.equal(first.outcome, 'composite');
    await assert.rejects(completeReviewMeasurement(cwd, r.slug, reviewBody()), (e) => {
      assert.ok(e instanceof MeasurementError);
      assert.match(e.message, /already completed/);
      assert.doesNotMatch(e.message, /no pending/);
      return true;
    });
    const log = await readLog(cwd);
    assert.equal(log.filter((x) => x.kind === 'measurement').length, 1, 'no second measurement was written');
    assert.equal(log.filter((x) => x.kind === 'evaluation-call').length, 1, 'no second call was written');
  });
  // Not in the brief's own test list (self-review completeness):
  //
  // 1. The written measurement record's own payload, not just the call -- the brief's own first
  //    test only asserts the call's source/session/model; this asserts the measurement is
  //    otherwise indistinguishable in shape from a jev one (this task's own Global Constraints:
  //    "indistinguishable ... except source, its call record's transport/session, and model")
  //    except for those three fields, plus that the call's answers/usage/raw made it to the log.
  test('the written measurement and call carry the same shape a jev completion would, only source/session/transport/model differ', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    const c = await completeReviewMeasurement(cwd, r.slug, reviewBody());
    const log = await readLog(cwd);
    const call = log.findLast((x) => x.kind === 'evaluation-call');
    const m = log.findLast((x) => x.kind === 'measurement');
    assert.equal(call.payload.intent, r.intentSha); assert.equal(call.payload.request_digest, requestDigest(r.request));
    assert.equal(call.payload.outcome, 'response'); assert.equal(call.payload.transport, 'remote');
    assert.equal(call.payload.answers.length, 5); assert.deepEqual(call.payload.usage, { input_tokens: 5, output_tokens: 1 });
    assert.equal(Buffer.from(unb64url(call.payload.raw)).toString(), JSON.stringify(reviewBody()));
    assert.equal(m.payload.intent, r.intentSha); assert.equal(m.payload.call, call.sha); assert.equal(m.payload.source, 'review');
    assert.equal(m.payload.model, 'claude-fable-5-1'); assert.equal(m.payload.levels.length, 5);
    assert.equal(m.sha, c.measurementSha);
  });
  // 2. Malformed-body defense (self-review's own named scenario): a body missing model/session/
  //    transport entirely at the top level (not just a missing answer) still resolves to a clean
  //    'unavailable invalid' measurement, never an uncaught RecordError from the evaluation-call/
  //    measurement schemas' nullable(str)/nullable(oneOf(...)) fields rejecting a raw `undefined`.
  test('a body missing model/session/transport entirely is unavailable invalid, not a thrown schema error', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    const c = await completeReviewMeasurement(cwd, r.slug, {});
    assert.equal(c.outcome, 'unavailable'); assert.equal(c.suggested, null);
    const call = (await readLog(cwd)).findLast((x) => x.kind === 'evaluation-call');
    assert.equal(call.payload.model, null); assert.equal(call.payload.transport, null); assert.equal(call.payload.session, null);
  });
  // 4. Fix (Important I1, final-review.md): a non-object body (JSON `null`, a number, an array)
  // used to raw-crash with an uncaught TypeError, not a MeasurementError -- the three refusal
  // checks (session/model/transport) read body.model/body.transport/body.session directly, before
  // reviewField's coercion ever runs. Guarded with the same isPlainObject check parseScoreAnswers
  // already uses, before any property of `body` is read.
  test('a null --file body refuses with a MeasurementError naming the defect, not a raw TypeError', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    await assert.rejects(completeReviewMeasurement(cwd, r.slug, null), (e) => {
      assert.ok(e instanceof MeasurementError, `expected MeasurementError, got ${e}`);
      assert.match(e.message, /not a JSON object/);
      return true;
    });
    const log = await readLog(cwd);
    assert.equal(log.some((x) => x.kind === 'evaluation-call' || x.kind === 'measurement'), false, 'nothing written for a malformed body');
  });
  test('an array --file body refuses with a MeasurementError naming the defect, not a raw TypeError', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    await assert.rejects(completeReviewMeasurement(cwd, r.slug, []), (e) => {
      assert.ok(e instanceof MeasurementError, `expected MeasurementError, got ${e}`);
      assert.match(e.message, /not a JSON object/);
      return true;
    });
    const log = await readLog(cwd);
    assert.equal(log.some((x) => x.kind === 'evaluation-call' || x.kind === 'measurement'), false, 'nothing written for a malformed body');
  });
  // 3. A record appended between the brief (measure()'s pending intent) and the file completion
  //    (an unrelated backlog item, standing in for anything else the loop might do meanwhile)
  //    does not block completeReviewMeasurement from finding its own intent -- the "stale intent"
  //    self-review scenario: staleness against the ADR/log is currentMeasurement's own later gate
  //    (Task 2), not this function's; a genuinely pending review intent is still completable no
  //    matter what else landed in the log after it.
  test('an unrelated record appended after the brief does not block completion', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    await appendRecord(cwd, 'item', 'auth-tokens', { kind: 'backlog', slug: 'idea-1', source: 'AUTH-003', body: 'an idea' });
    const c = await completeReviewMeasurement(cwd, r.slug, reviewBody());
    assert.equal(c.outcome, 'composite');
  });
  // Fix (Important I2, final-review.md): mirrors currentMeasurement's own fix round 1 (I1) --
  // `range()` returns the trailing records of the last-started commitment whether or not it later
  // closed, so without the `!r.closed` guard a closed commitment's own records still looked like
  // "current" scope. A `done` appended after the review brief (the draft left pending, never
  // followed through -- a realistic abandoned-review scenario) must refuse completion, the same
  // way currentMeasurement already reports "missing" for the same commitment, and must write
  // nothing (no orphaned evaluation-call/measurement trailing `done` in the log).
  test('completing a review measurement after done is refused, and writes nothing', async () => {
    const cwd = await repoWithCommitment(false);
    const r = await measure(cwd, draft(), { session: 'sess-agent', env: { SUDUS_HARNESS: 'claude_code' } });
    await appendRecord(cwd, 'done', 'auth-tokens', { slug: 'auth-tokens', snapshot: await writeWorkspaceSnapshot(cwd) });
    await assert.rejects(completeReviewMeasurement(cwd, r.slug, reviewBody()), (e) => {
      assert.ok(e instanceof MeasurementError, `expected MeasurementError, got ${e}`);
      assert.match(e.message, /no pending/);
      return true;
    });
    const log = await readLog(cwd);
    assert.equal(log.some((x) => x.kind === 'evaluation-call' || x.kind === 'measurement'), false, 'no measurement was written after done');
  });
});

// Issue #67: after Done, measure recorded a review intent and printed the command that completes
// it, and that command found no pending measurement. A measurement serves decide --consequential
// or escalate --consequential, and both need an open commitment, so between commitments measure
// refuses before it writes a record, for either source.
import { done as doneCommitment, item as recordItem } from '../lib/commitment.mjs';
describe('measure between commitments (issue #67)', () => {
  test('after a real done, a draft about a new defect is refused and nothing is recorded', async () => {
    const r = await loopRepo({ reqs: ['DEMO-001'] });
    await r.passReq('DEMO-001'); await r.review(); await r.report();
    await doneCommitment(r.cwd, 'first');
    const defect = await recordItem(r.cwd, { kind: 'defect', slug: 'demo-defect', source: 'DEMO-001', body: 'a defect' });
    const before = (await readLog(r.cwd)).length;
    const d = { ...draft(), commitment: 'first', concerns: [`item:${defect}`], named_paths: ['src/demo.mjs'] };
    await assert.rejects(measure(r.cwd, d, { session: 'sess-agent', harness: 'codex', env: {} }),
      (e) => e instanceof DraftError && /no commitment is open/.test(e.message));
    assert.equal((await readLog(r.cwd)).length, before);
  });
  test('the jev source is refused too, without a call', async () => {
    const cwd = await repoWithCommitment();
    await appendRecord(cwd, 'done', 'auth-tokens', { slug: 'auth-tokens', snapshot: await writeWorkspaceSnapshot(cwd) });
    const before = (await readLog(cwd)).length;
    let calls = 0;
    await assert.rejects(measure(cwd, draft(), { transport: async () => { calls++; throw new Error('no call expected'); } }), /no commitment is open/);
    assert.equal(calls, 0);
    assert.equal((await readLog(cwd)).length, before);
  });
  // Review of the 4.3.0 candidate: the refusal ran before recovery, so a jev intent a crash left
  // open inside the last commitment was never finalized (4.2.15 finalized it at the next measure,
  // and after a successor starts recovery reads only the successor's range). Recovery runs first.
  test('a measure refused after done still finalizes an intent a crash left open', async () => {
    const cwd = await repoWithCommitment();
    await assert.rejects(measure(cwd, draft(), { transport: transport([new Error('crash')]) }), /crash/);
    const intent = (await readLog(cwd)).at(-1);
    assert.equal(intent.kind, 'evaluation-intent');
    await appendRecord(cwd, 'done', 'auth-tokens', { slug: 'auth-tokens', snapshot: await writeWorkspaceSnapshot(cwd) });
    let calls = 0;
    await assert.rejects(measure(cwd, draft(), { transport: async () => { calls++; throw new Error('no call expected'); } }), /no commitment is open/);
    const m = (await readLog(cwd)).at(-1);
    assert.equal(calls, 0);
    assert.equal(m.kind, 'measurement'); assert.equal(m.payload.intent, intent.sha); assert.equal(m.payload.outcome, 'indeterminate');
  });
});

// --- Task 10: calibration over recorded measurements ------------------------------------------
// Section 10, "Record and calibration" / "The policy digest ... a change to any of them resets
// calibration": upperBound (the unchanged one-sided exact binomial bound) and calibrate(cwd),
// which scores the labelled sample against it and writes a 'calibration' record.
import { upperBound, calibrate } from '../lib/evaluate.mjs';
import { escalate, answer } from '../lib/escalate.mjs';
import { writeFileSync } from 'node:fs';

describe('calibration', () => {
  test('exact one-sided bound, unchanged from the superseded design', () => {
    assert.ok(Math.abs(upperBound(0, 60) - (1 - Math.pow(0.05, 1 / 60))) < 1e-9);
    assert.ok(upperBound(0, 60) < 0.05); assert.ok(upperBound(0, 30) > 0.05);
    assert.ok(upperBound(1, 60) > upperBound(0, 60));
  });
  // Issue #47: the CDF started from (1-p)^n, which underflows to 0 for a large sample, so every
  // term after it was 0 too and bisection returned a bound below the observed error rate.
  test('the bound holds for large samples: never below the observed error rate, and monotone in errors (issue #47)', () => {
    assert.ok(Math.abs(upperBound(2000, 20000) - 0.10355738442430919) < 1e-6, String(upperBound(2000, 20000)));
    for (const [errors, n] of [[0, 60], [1, 60], [3, 100], [50, 1000], [2000, 20000], [100, 100000], [9999, 10000]]) {
      assert.ok(upperBound(errors, n) >= errors / n, `${errors}/${n}`);
    }
    for (let e = 0; e < 40; e++) assert.ok(upperBound(e + 1, 5000) > upperBound(e, 5000), String(e));
    assert.equal(upperBound(20000, 20000), 1);
  });
  // Controller Ruling 3: the labelled sample is the subset that can exist under the current
  // record set -- measurements whose `suggested` was 'agent' that were nonetheless escalated and
  // later answered with --owner. This helper drives exactly that path: measure() an agent-
  // suggested draft, escalate it anyway (naming the measurement), then answer with an owner label.
  // Deviation from the brief text: the brief's own snippet calls `answer(cwd, sha, 'ok', '',
  // { owner: ownerLabel })`, passing escalate()'s return value (the escalation's own record sha)
  // as answer()'s `slug` argument. Real answer() (lib/escalate.mjs) takes the commitment slug
  // there and resolves the open escalation for it internally via pickOpen(log, slug,
  // opts.escalation) -- passing a 40-hex escalation sha as `slug` matches no escalation's
  // payload.slug ('auth-tokens', the commitment), reproduced verbatim as "sudus: no unanswered
  // escalation for <sha>" before this fix. Fixed to the commitment slug plus `escalation: sha` in
  // opts, the same targeted-answer shape tests/escalate.test.mjs's own passing calls use
  // (`answer(r.cwd, 'first', 'ok', '', { ...asDev, escalation: b })`). Also adds `confirm: async
  // () => true`, this fixture's project being unsigned-local (no signing_key): without it,
  // answer()'s authenticateDeveloper falls back to lib/auth.mjs's ttyConfirm, which opens
  // /dev/tty and throws "no controlling terminal" in this non-interactive test run -- the same
  // `asDev` fixture tests/escalate.test.mjs already uses for every passing answer() call.
  async function labelled(cwd, n, ownerLabel) {
    for (let i = 0; i < n; i++) {
      const r = await measure(cwd, { ...draft(), question: `q${i}` }, { transport: transport([goodBody()]) });
      assert.equal(r.suggested, 'agent');
      const sha = await escalate(cwd, { ...draft(), question: `q${i}`, evaluation: r.measurementSha });
      await answer(cwd, draft().commitment, 'ok', { owner: ownerLabel, escalation: sha, quote: 'ok', env: {} });
    }
  }
  // Fix round 1 (controller ruling, task-10-review.md "Important"): this test used to build 60
  // real labelled cycles (twice: 30, then 30 more) to reach an actual pass through the real
  // exact-binomial bound, at a combined cost of ~121.5s of the suite's ~250s calibration total.
  // That specific arithmetic -- upperBound(0,60) clears 0.05, upperBound(0,30) does not -- is
  // already proven purely, with no I/O, by the "exact one-sided bound" test above; re-deriving it
  // through real git history added wall time with no new information the pure test didn't already
  // give. What a real-record test still needs to prove, and what the pure test cannot: that
  // calibrate()'s `sample`/`errors`/`bound`/`pass` and its written 'calibration' record are wired
  // to the real log (real measure() -> escalate() -> answer() records), not just to the formula in
  // isolation, and that the configured `min_calibration_agent_predictions` setting -- not a
  // hardcoded 60 -- is what gates `pass` on the sample-size side. Both are provable with a small
  // real sample against a small configured floor: floor=5 here, 4 cases (below floor, `pass`
  // false regardless of the bound), then a 5th (floor met; `pass` still false here because
  // upperBound(0,5) is nowhere near 0.05 -- reaching an actual pass is what the pure test above
  // already establishes, not this test's job). Also covers the Minor finding: every one of the
  // 'calibration' record's seven payload fields is asserted against the real written record.
  test('calibrate() counts real labelled cases against the configured floor and records all seven payload fields', async () => {
    const cwd = await repoWithCommitment(true, 5);
    await labelled(cwd, 4, 'agent');
    let c = await calibrate(cwd);
    assert.deepEqual([c.sample, c.errors, c.pass], [4, 0, false], 'below the configured floor of 5');
    await labelled(cwd, 1, 'agent');
    c = await calibrate(cwd);
    assert.equal(c.sample, 5); assert.equal(c.errors, 0);
    assert.equal(c.bound, upperBound(0, 5), "calibrate()'s bound is the real upperBound(errors, sample)");
    assert.equal(c.pass, false, 'floor met, but the bound at n=5 is nowhere near 0.05 -- reaching an actual pass is the pure bound test\'s job');
    const log = await readLog(cwd);
    const rec = log.at(-1);
    const { settings } = await loadSettings(cwd);
    assert.equal(rec.kind, 'calibration');
    assert.equal(rec.payload.policy_digest, policyDigest(settings));
    assert.equal(rec.payload.log_head, log.at(-2).sha);
    assert.equal(rec.payload.predicted_agent, 5);
    assert.equal(rec.payload.false_downgrades, 0);
    assert.ok(rec.payload.bound >= 0 && rec.payload.bound <= 1);
    assert.equal(rec.payload.bound, upperBound(0, 5));
    assert.equal(rec.payload.criterion, 'false_downgrade_bound<=0.05 min_calibration_agent_predictions>=5');
    assert.equal(rec.payload.result, 'fail');
  });
  test('denominator is suggested-agent labelled cases only; unknown labels are excluded', async () => {
    const cwd = await repoWithCommitment();
    await labelled(cwd, 3, 'agent'); await labelled(cwd, 2, 'unknown'); await labelled(cwd, 1, 'developer');
    const c = await calibrate(cwd);
    assert.deepEqual([c.sample, c.errors], [4, 1]);
  });
  // Fix round 1 (controller ruling, task-10-review.md "Important"): this test used to build 60
  // real labelled cycles (~125.75s) and require an actual `pass: true` before flipping a setting,
  // but the test's own claim is only that a policy-relevant settings change resets the sample back
  // to 0 -- a policy_digest mismatch on the recorded evaluation-intent, unrelated to how large the
  // sample was or whether it had already reached a pass. A handful of records demonstrates the
  // reset exactly as well as sixty, at a fraction of the cost.
  test('a policy change resets calibration', async () => {
    const cwd = await repoWithCommitment(true, 3);
    await labelled(cwd, 3, 'agent');
    assert.equal((await calibrate(cwd)).sample, 3);
    const { settings } = await loadSettings(cwd);
    settings.typesafeai.agent_ceiling = 0.4;
    writeFileSync(join(cwd, '.sudus/settings.json'), JSON.stringify(settings, null, 2));
    assert.equal((await calibrate(cwd)).sample, 0);
  });
  test('floor and vetoed measurements never enter the denominator (suggested is null)', async () => {
    const cwd = await repoWithCommitment();
    const r = await measure(cwd, { ...draft(), named_paths: ['migrations/1.sql'] });
    assert.equal(r.suggested, null);
    const sha = await escalate(cwd, { ...draft(), evaluation: r.measurementSha });
    await answer(cwd, draft().commitment, 'ok', { owner: 'developer', escalation: sha, quote: 'ok', env: {} });
    assert.deepEqual((await calibrate(cwd)).sample, 0);
  });
});

// --- Plan 16 Task 2: currentMeasurement -- missing, stale, or a different draft digest ---------
// Section 5 (docs/spec/sudus-v2.md): "`sudus decide --consequential` refuses a draft whose
// measurement is missing, stale, or built from a different draft digest." currentMeasurement is
// that check, consumed by plan 16 tasks 3 (decide --consequential), 4 (escalate) and 6.
//
// Deviation from the brief text: the brief's own Step 1 snippet calls the jev answer fixture
// `scoreBody()`; this file's actual five-dimension answer body (Task 7, above) is `goodBody()` --
// reused here, not redefined, the same as every other measure()-based describe block in this file.
import { currentMeasurement, MeasurementError, finalizeMeasurement } from '../lib/evaluate.mjs';
import { decide } from '../lib/adr.mjs';

describe('currentMeasurement', () => {
  test('missing: no measurement for this draft at all', async () => {
    const cwd = await repoWithCommitment();
    await assert.rejects(currentMeasurement(cwd, normalizeDraft(draft())),
      (e) => e instanceof MeasurementError && /no measurement/.test(e.message) && !/stale|digest|finished/.test(e.message));
  });
  test('a fresh measurement for the exact draft is current', async () => {
    const cwd = await repoWithCommitment();
    const r = await measure(cwd, draft(), { transport: transport([goodBody()]) });
    const m = await currentMeasurement(cwd, normalizeDraft(draft()));
    assert.equal(m.sha, r.measurementSha);
  });
  // Fix round 1 (Critical C1, review of commit bd51dcbf): the reviewer's own reproduction. Draft A
  // is measured; draft B (a different draft in the same open commitment, never measured) must
  // read "missing," not "digest" -- the first version keyed "digest" off "some measurement exists
  // in this commitment," which fired here even though draft B itself was never touched. This test
  // replaces the old (buggy) "a different draft digest ... is not found" test, which asserted the
  // pre-fix "digest" behavior for exactly this scenario; the genuine digest condition (this
  // draft's own measurement shadowed by a later one for a different draft) is covered by its own
  // test below.
  test('missing: a different, never-measured draft in the same open commitment reads missing, not digest (reviewer\'s reproduction)', async () => {
    const cwd = await repoWithCommitment();
    await measure(cwd, draft(), { transport: transport([goodBody()]) });
    await assert.rejects(currentMeasurement(cwd, normalizeDraft({ ...draft(), because: 'a different reason, never measured' })),
      (e) => e instanceof MeasurementError && /no measurement/.test(e.message) && !/stale|digest|finished/.test(e.message));
  });
  // Fix round 1 (Critical C1): the genuine digest condition -- this draft really was measured
  // (its own intent and measurement both exist), but a *different* draft was measured more
  // recently in the same commitment, so the latest measurement in scope now belongs to someone
  // else. Distinct from "missing" (this draft never had an intent at all, tested above) and from
  // "stale" (the chain broke on a non-measurement record, tested below).
  test('digest: a different draft was measured more recently, shadowing this one', async () => {
    const cwd = await repoWithCommitment();
    await measure(cwd, draft(), { transport: transport([goodBody()]) });
    await measure(cwd, { ...draft(), because: 'a wholly different draft, also measured' }, { transport: transport([goodBody()]) });
    await assert.rejects(currentMeasurement(cwd, normalizeDraft(draft())),
      (e) => e instanceof MeasurementError && e.message === 'sudus: the latest measurement is for a different draft; run sudus measure for this draft');
  });
  // Fix round 1 (C1, the "not finished" half): this draft's own intent exists, but no measurement
  // names it yet -- a review source still pending (measure() returns before writing a
  // measurement). Distinct wording from "no intent at all" so the agent can tell "never measured"
  // from "measurement started but has not finished" (the review's own C1 finding: for a pending
  // review draft, "run sudus measure again" is actively wrong guidance -- measure() already ran).
  test('missing: this draft was measured but the measurement has not finished yet (review still pending)', async () => {
    const cwd = await repoWithCommitment(false);
    const pending = await measure(cwd, draft(), { env: { CLAUDECODE: '1' } });
    assert.equal(pending.pending, 'review');
    await assert.rejects(currentMeasurement(cwd, normalizeDraft(draft())),
      (e) => e instanceof MeasurementError && e.message === 'sudus: the measurement for this draft has not finished yet; run sudus measure again once it has');
  });
  test('stale: anything else appended to the log after the intent invalidates it', async () => {
    const cwd = await repoWithCommitment();
    await measure(cwd, draft(), { transport: transport([goodBody()]) });
    await appendRecord(cwd, 'item', 'auth-tokens', { kind: 'backlog', slug: 'idea-1', source: 'AUTH-003', body: 'an idea' });
    await assert.rejects(currentMeasurement(cwd, normalizeDraft(draft())), /stale/);
  });
  // Controller Ruling 17 (binding): a decision is an ADR line (docs/decisions.jsonl), not a log
  // record -- appendDecision (lib/adr.mjs) writes straight to that file, never through
  // appendRecord/refs/sudus/log, so no scan of readLog(cwd)'s output can ever see it. Proves
  // currentMeasurement catches this via the intent's own recorded adr_digest instead: measure,
  // then decide (no log record at all is appended), then currentMeasurement must still say stale.
  test('stale: a decision recorded since the draft was measured invalidates it, even with the log itself unchanged', async () => {
    const cwd = await repoWithCommitment();
    await measure(cwd, draft(), { transport: transport([goodBody()]) });
    await decide(cwd, { title: 'Use a map', rests_on: [], wrong_if: 'the map is slow', body: 'A map keeps lookups constant.' });
    await assert.rejects(currentMeasurement(cwd, normalizeDraft(draft())),
      (e) => e instanceof MeasurementError && e.message === 'sudus: a decision has been recorded since this draft was measured; run sudus measure again');
  });
  test('re-measuring after a stale hit produces a new current one', async () => {
    const cwd = await repoWithCommitment();
    await measure(cwd, draft(), { transport: transport([goodBody()]) });
    await appendRecord(cwd, 'item', 'auth-tokens', { kind: 'backlog', slug: 'idea-1', source: 'AUTH-003', body: 'an idea' });
    const r2 = await measure(cwd, draft(), { transport: transport([goodBody()]) });
    const m = await currentMeasurement(cwd, normalizeDraft(draft()));
    assert.equal(m.sha, r2.measurementSha);
  });
  // Not in the brief's own test list: a floor outcome writes a measurement with no call record at
  // all (measure()'s own floor branch, Task 9 above) -- familyIsOnlyThingAfter's `family` array
  // must still treat that measurement as current (nothing but itself follows its intent) rather
  // than always expecting exactly a call then a measurement.
  test('a floor measurement (no call record at all) is still current when nothing follows it', async () => {
    const cwd = await repoWithCommitment();
    const d = { ...draft(), named_paths: ['migrations/1.sql'] };
    const r = await measure(cwd, d);
    assert.equal(r.outcome, 'floor');
    const m = await currentMeasurement(cwd, normalizeDraft(d));
    assert.equal(m.sha, r.measurementSha);
  });
  // Self-review completeness: the current case for the review source too, not only jev. measure()
  // itself only writes the intent for review (it returns `{pending: 'review', ...}` before any
  // measurement exists -- plan 16 tasks 3/4 finish that path), so a review-source measurement is
  // built the same way finalizeMeasurement's own docstring says it will be reused: a real intent
  // from measure(), then finalizeMeasurement directly, with call: null (review never calls a
  // transport).
  test('a review-source measurement (no call, no transport) is current when nothing follows it', async () => {
    const cwd = await repoWithCommitment(false);
    const D = normalizeDraft(draft());
    const pending = await measure(cwd, draft(), { env: { CLAUDECODE: '1' } });
    assert.equal(pending.pending, 'review');
    const { settings } = await loadSettings(cwd);
    const { measurementSha } = await finalizeMeasurement(cwd, pending.slug, pending.intentSha, {
      call: null, draftDigestValue: draftDigest(D), source: 'review', levels: dims(), confidences: dims(), settings, outcome: 'composite',
    });
    const m = await currentMeasurement(cwd, D);
    assert.equal(m.sha, measurementSha);
  });
  // Fix round 1 (Important I1, review of commit bd51dcbf): scope must honor `range().closed` the
  // way `rangeOpen`/`openRange` do elsewhere in this codebase, not just `r.start` truthiness --
  // `range()` finds the *last* `start` record regardless of whether that commitment later closed,
  // so a closed commitment's own trailing records (including a real, otherwise-current
  // measurement) must not be selected as scope. A closed commitment has no current measurement:
  // missing.
  test('a closed commitment has no current measurement (missing), even though a current-looking measurement trails inside it', async () => {
    const cwd = await repoWithCommitment();
    const r = await measure(cwd, draft(), { transport: transport([goodBody()]) });
    assert.equal(r.outcome, 'composite');
    await appendRecord(cwd, 'done', 'auth-tokens', { slug: 'auth-tokens', snapshot: await writeWorkspaceSnapshot(cwd) });
    await assert.rejects(currentMeasurement(cwd, normalizeDraft(draft())),
      (e) => e instanceof MeasurementError && /no measurement/.test(e.message) && !/stale|digest|finished/.test(e.message));
  });
});
