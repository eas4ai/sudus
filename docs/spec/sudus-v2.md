# Sudus 2: feature specification

Prefix: SUDUS
Scope: the Sudus 2 kernel: its records, verdicts, commands, skills and evaluator


Status: Draft, revision 20, 2026-10-13. Nothing here is Agreed until the
developer confirms it.

Revision 20 lets a Consequential decision on a large commitment be measured
(section 10, Limits and failure). The measurement state carries the text of
every frozen requirement, so a commitment with many requirements filled the
request by itself; every measurement on it was `unavailable oversize`, the
agent could cut nothing, and every Consequential decision went to the
developer (issue #69). A request over a limit is now built once more with
the text of only the frozen requirements the draft's concerns name; the
others keep their identifier and text digest. A request that fits is never
trimmed, so earlier measurements and calibration are unchanged. The
developer accepted this on 2026-10-13 ("ok: trim only when over"). The agent
added, beyond that answer: the measurement's reason says the request was
trimmed; a request still over a limit is `unavailable oversize` and its
reason says it was already trimmed; and nothing is rebuilt when the concerns
already name every frozen requirement.

Revision 19 lets a fix revised after its resolution be recorded again
(section 9, After the report). `sudus resolve` refused a finding already
resolved, so when a fix changed after its resolution, the first explanation
stayed the finding's resolution and `sudus done` printed it for a design that
did not ship (issue #66). A second resolution of a resolved finding now
supersedes the earlier one: the latest is the finding's resolution, and the
review report names the ones it supersedes. The resolution record keeps its
shape, so earlier logs and earlier Sudus versions still read it. A resolution
is recorded only while the commitment is open. The issue also asked for an
amendment to the builder's self-review after the report; that is not built,
since a resolution's explanation can name the review statement it reverses.
The developer accepted this on 2026-10-10 ("ok: part 1 only").

Revision 18 lets a second clone capture items while another clone holds the
open commitment (section 4, Inbox; section 8, Capture and promotion). The
log is one append-only chain that is never merged, so a capture appended on a
clone that was not doing the work raced the clone that was: the first push
won, and the repair for the other side dropped its records (issue #35). The
start record now names the clone that started it. While that commitment is
open, `sudus item` on any other clone writes that clone's own inbox,
`refs/sudus/inbox/<clone id>`, which only it appends to and which `sudus
push` publishes. After Done, wake names `fold`, and `sudus fold` appends
each inbox item to the log as an ordinary item. The issue proposed one shared
inbox merged by slug and a direct log append from a clone caught up with the
remote; a caught-up clone cannot see another clone's unpushed records, so
each clone keeps its own inbox and only folding writes the log. The developer
accepted this on 2026-09-26 ("ok").

Revision 17 lets the developer drop items in conversation (section 8,
Capture and promotion). When the developer says to drop backlog or
next-feature items, or confirms a spec change that answers a next-feature
item, the agent records their words once with `sudus retire <item>...
--quote "<their words>"`. A retired item is never promoted, and the
next-feature pass no longer offers it. Before, nothing closed a next-feature
item, so every later pass offered it again, and a backlog item the developer
had dropped still needed an escalation and a second ok (issue #34). The agent
also captures a next-feature item only for a change the developer asked for
or one a real bug needs, never for an edge case or ceremony. The developer
reported that agents captured such items and told the agent to skip them; the
capture rule is the agent's addition. The developer accepted both on
2026-09-26 ("ok").

Revision 16 changes the adversary (section 9); the developer set each rule on
2026-09-25 and accepted the design ("ok"). The adversary is one fresh
subagent in the builder's harness with none of the builder's conversation. It
reads the project and the whole specification and runs nothing: "The
adversery should be read only code review and agent decision review". The
brief lists the receipts, so it knows what already ran, and the decisions the
agent recorded. It attacks through five lenses: the falsifier, the decisions,
security, logic, and complexity and spec adherence. Each finding carries a
severity. It runs once, "right before Done unless there is a Sudus bug
reported and the step requires repeating". The builder resolves or declines
each finding with its reason, and no finding waits on anyone: "The builder is
the decision maker and Sudus will judge". `sudus done` prints the review
report for the developer. Before, the adversary worked in a projection, tried
to make each mechanism pass by building and running, and judged every fix
after the report in acceptance rounds; revision 13's round bound goes with
them, and `sudus accept` and `sudus dispute` are removed.

Revision 15 changes two rules; the developer accepted both on 2026-09-25
("ok"). Attempts at a requirement count from its turn (section 8, Deferral
and attempts). Before, the refresh runs wake named for other requirements'
changes counted as attempts at a requirement no one had worked on, and wake
named `escalate` for it (issue #28). A backlog item may wait by the
developer's ok (section 8, Capture and promotion). An escalation naming
`wait:<item>` answered ok lets wake say Done while the item waits until the
next Done, so the next feature goes ahead of it. Before, Done needed every
backlog item promoted or retired first (issue #29).

Revision 14 lets the developer retire a backlog item that other work already
delivered (section 8, Capture and promotion). An escalation whose concerns
name `retire:<item>` retires the item on the developer's `ok`, and wake stops
naming its promotion; when no commitment is open, the escalation names the
latest one. Before, a backlog item left the backlog only by promotion, a
commitment and a review that changed nothing. Issue #24 asked for it; the
developer accepted this recommendation on 2026-09-24 ("ok on the above all").

Revision 13 bounds acceptance rounds that each end with one narrower finding
(section 5, Waiting and liveness). After three rounds without Done, the
escalation names the open findings and recommends closing them, each captured
as a backlog item; the developer's `ok` closes them, so Done needs no further
round, and `instead` takes another round or supersedes the commitment.
Before, the escalation named no finding and `ok` only restarted the count.
One escalation may name several findings, and an `ok` closes each (section 2,
Finding), and wake prints an `ok closes:` line naming them: the kernel had
closed a finding only for an escalation that named it alone. Issue #23
reported a one-line commitment that took six rounds of mechanism hardening;
the developer accepted this recommendation on 2026-09-24 ("ok").

Revision 12 adds a fifth skill, `report-sudus-issue` (section 11). When
Sudus itself is wrong, the agent reproduces the defect outside the project,
drafts an issue for eas4ai/sudus, and files it only after the developer's
`ok`; it then watches the issue and, when the fix is released, updates the
plugin and tells the developer to reload the session. The working agreement
names the skill. The developer asked for it on 2026-09-24 ("I want to add
instruction to the sudus skill to report issues to the production repo
issues and to monitor for the issue to be closed so that the agent can
update the plugin in real time and promot the user to reload") and chose
that the agent asks before filing ("Yes ask").

Revision 11 removes a setup question. Developer evidence is attested unless
the settings name a signing key, and a developer who wants signed decisions
sets `signing_key` in the settings file (section 2, Settings; section 3,
Project initialization). The developer ruled on 2026-09-24: "Make
attestation default and managed via the settings file. If someone want to
use a key, they can optionally enable it in settings and we can remove that
onboarding step". Developer evidence verifies against the key in force,
the `signing_key` of the settings the latest init or authorization bound,
counting only records whose evidence verifies against the key in force
before them, and never the settings file on disk; while a key is in force,
a settings change, including a new key or none, is signed with it (section
8). The developer
agreed on 2026-09-24 ("ok") after an agent reproduced that an agent could
set its own key or none and approve that change itself. The protected-path
check compares digests before it verifies the latest authorization's
evidence, so a settings change that sets a key is named as a settings
change to authorize.

Revision 10 makes two changes the developer accepted on 2026-09-23 ("I will
accept your recommendation") after an agent reported their cost on a
consumer project. While the latest report has an unresolved finding, a
missing current receipt waits and wake names the next resolution (section 5,
Precedence). A mechanism review binds to what decides what the check
detects, its command, working directory and results mode, so a redeclare
that adds inputs, documents, tool identity or requirements keeps it bound
(sections 2 and 8).

Revision 9 measures a successor's brief from the first start of its
supersession chain (section 9, Brief). The work a successor
carries was committed before its own start, so its changed paths and
interface obligations went unreviewed.

Revision 8 adds the `supersede` action (section 5; section 8, Freshness).
A commitment whose Agreed text was revised under it could never bind a
mechanism review; wake now names the exit.

Revision 7 changes the name. Sudus was Cairn through 2.2.2; the developer
renamed it on 2026-09-23 after the old name collided with an autonomous
penetration-testing tool. The command answers to both names, a project
recorded under the former layout keeps working, and `sudus migrate` moves
it between commitments (section 2, Layouts; section 4, Commands). No
verdict, record shape or document meaning changed.

Revision 6 changes one rule: the developer is never asked to run a command.
The developer answers in conversation; the agent records the answer, quoting
the developer's words, with the developer-only commands. Unsigned evidence is
now the quoted answer, the harness that carried it and the Git author, called
attested evidence. The controlling-terminal confirmation is gone. Revision 5
had "one authorization command at start" run by the developer; the developer
ruled on 2026-09-21: "The user should never be asked to run cli commands for
anything" and "It should be a prompt... the model can run the cli command".

Revision 5 is a consistency revision. It closes the remaining authority,
record, supersession, calibration, egress, scope, initialization and liveness
gaps found in revision 4. It also restores the normative text revision 4
referred to but did not contain. Section 10 is shorter: the composite score,
weights and configurable code tiers are gone, while the two request states and
their questions are explicit again. This revision was drafted by a second
reviewer, corrected against two further reviews, and settled on 2026-09-19 with
three developer decisions: one authorization command at start, command intents
for the four multi-store commands only with a local cycle counter, and readable
canonical JSON record bodies.

This document says what Sudus 2 is, which processes it keeps, what each record
is and where it lives, and what 1.x had that 2 does not. It is a feature
specification: it names behaviors and the reader of each record, not requirement
identifiers. The requirements, with falsifiers, are written from it in the next
step under the policy in section 7.

This document is self-contained. The six process digraphs in `docs/diagrams/`
are part of it: install, new-project, existing-project, next-feature, the shared
spec-phase tail, and the work loop. Where a digraph and this text disagree, this
text is normative.

## 1. Purpose

Sudus keeps agent-led development tied to what the developer agreed to build.
A coding agent from any vendor does the work; Sudus is the referee that reads
the repository, records what was checked, decides what is still current, and
names the next action. Belief that the code matches the agreement lives in the
repository, not in a session, so a new session with no memory can continue.

Sudus 2 keeps seven ideas from 1.x, and little else:

1. A requirement is Agreed only with an observable failure, its falsifier.
2. Work happens one commitment at a time, named in the roadmap.
3. Each requirement is checked by a declared command that tries to falsify it;
   the result is recorded with the identity of everything it ran against. A
   passing check has not falsified the requirement; it has not proven it.
4. Evidence is current only while those identities match; nothing is re-run for
   its own sake and nothing stale counts.
5. Nothing is Done until a reviewer with none of the builder's context has
   looked and every finding is answered. Done means: not falsified by the
   declared checks, and looked at by someone who does not share the builder's
   blind spots.
6. Work outside the commitment is captured, never built.
7. Agreed text changes only by the developer's ruling. The agent stops for the
   developer only when the decision is theirs.

Everything in Sudus 2 serves one of those seven. A behavior that serves none of
them is not in Sudus 2. Where a model is consulted, code owns the invariants and
the model owns only the judgment code cannot make. No model output changes who
decides until code has established that the decision is inside the model's
envelope.

## 2. Definitions

The kernel's terms. A term in this list means this and nothing else.

### Paths and authority

**Reserved paths.** The kernel, not settings, reserves `.sudus/**`,
`docs/spec/**`, `docs/decisions.jsonl` and `AGENTS.md`. No `outside`, `source`,
`interfaces` or `data` entry may match them, and no mechanism may declare them
as an input. `network_exclude` may match them only to add an egress restriction.

Reserved does not mean immutable. It separates two kinds of authority:

- **Developer-owned protected paths** are `.sudus/settings.json`,
  `docs/spec/**` except `docs/spec/roadmap.md`, and `AGENTS.md`. The roadmap
  is edited by the kernel at start and promote, so it is bound structurally
  rather than by digest: lint passes, a section names only Agreed
  requirements, and the start record freezes the set. After project initialization, an accepted
  version of one needs a developer authorization that names its before and
  after digests. Between commitments an agent may prepare uncommitted Draft or
  Observed spec proposals, but one `sudus authorize` at start must bind their
  final digests, with the working agreement's and settings', and `sudus start`
  refuses without that authorization. An active commitment's frozen Agreed
  requirement text is not amended in place; changing it requires closing or
  superseding that commitment and opening a new one.
- **Kernel-managed paths** are `.sudus/mechanisms` and
  `docs/decisions.jsonl`. Only the command assigned to a schema-valid mutation
  may write them. That exact mutation is not a scope breach. A direct edit, an
  extra byte, deletion, reordering, or a write by another command is a breach.
- `.sudus/output/` is kernel-written runtime output, ignored by Git. Any other
  path under `.sudus/**` is refused unless this specification names it.

This split is a kernel invariant. Sudus's own valid bookkeeping cannot create a
Sudus violation merely because it wrote bookkeeping.

**Layouts.** A project's state lives under one of two layouts, read from the
settings file that exists: the Sudus layout (`.sudus/`, `refs/sudus/log`,
`refs/sudus/snapshots`, `refs/sudus/in-progress`, records with the subject
prefix `sudus:` and the trailers `Sudus-Schema` and `Sudus-Digest`) or the
former layout (`.cairn/`, `refs/cairn/*`, `cairn:` records with `Cairn-*`
trailers), which a project initialized before 3.0.0 keeps until `sudus
migrate` moves it. Every command works on either. Both state directories are
reserved in every project. Readers accept both record envelopes whatever the
layout, and a mechanism's output line counts under either prefix, so a
migrated log and an unchanged mechanism read as before. `sudus migrate` runs
only between commitments: it renames the refs, moves the directory and the
matching `.gitignore` lines in one commit, and refuses while a commitment,
lease or transaction is open or the directory has uncommitted changes, and,
with an authority remote, when that remote already holds the moved refs (it
then names the fetch). The records already written keep their envelope. Wake prints one line naming the
move while a project is on the former layout.

Every repository path in settings, mechanisms, records and evaluator drafts is
a UTF-8, slash-separated Git path relative to the worktree. The kernel rejects
absolute paths, a `.git` root, empty components, `.`, `..`, NUL, backslash and
a path that escapes after resolution. Globs match entry paths, never symlink
targets. Only a
requirement header's `Host paths:` field may name an absolute or home-relative
path, and Sudus never copies that target into a snapshot or model request.

### The hand-written tree

**Specification.** The files under `docs/spec/`. The **keystone**
(`docs/spec/overview.md`) says what the software is, the problem it solves, and
what it is not, and holds the **spec map**, one row per **domain** file with its
identifier prefix. The **glossary** (`docs/spec/glossary.md`) holds the
project's terms. The **roadmap** (`docs/spec/roadmap.md`) holds a `Current:` line
naming the current commitment's slug and one section per commitment: a heading
with the slug, a `Requirements:` line, and prose saying what it delivers and
when it is done.

**Requirement.** One block in a domain file: an identifier `[PREFIX-nnn]`, one
obligation with the actor named, a `Falsifier:` line naming the observable state
in which it is violated, a `Mechanism:` line naming the declaration that
observes it, and a `Status:` line. The block grammar is in section 4. A domain
file whose header carries `Scope: every commitment` contributes its Agreed
blocks to a commitment's set when that commitment starts. A header's `Host
paths:` line declares absolute or home-relative paths the software's behavior
depends on; Sudus reads the field and never scans block text for paths.

**Status.** One of `Draft`, `Observed`, `Agreed <date>`, or `Retired <date>`.
Observed text is derived from existing code and is never contract. Agreed means
the developer confirmed the block, or a deference decision quotes the
developer's ruling. Retired identifiers are never reused. Only Agreed blocks
are digested and checked. A commitment may name only Agreed requirements.

**Commitment.** One agreed unit of work: a roadmap section, opened by a start
record and closed by a done or superseded record. A commitment is not a Git
commit and normally spans many. At most one is open.

**Settings.** `.sudus/settings.json`, hand-written, tracked and the only
configuration file. `sudus init` creates or adopts its first protected version
after the developer confirms it. Its fields are:

- `schema`: the settings schema the kernel must understand.
- `authority_remote`: the one remote to which the durable Sudus refs travel,
  confirmed by the developer; `null` means the developer explicitly chose
  local-only operation. `origin` may be proposed but is never assumed.
- `outside`: paths that are nobody's input and never a scope breach.
- `source`: source roots under which neither `outside` nor `documents` may lie.
- `interfaces`: paths whose change is a public-interface change.
- `data`: paths whose change is a persisted-data change and therefore the
  developer's decision.
- `network_exclude`: paths whose bytes Sudus must not place in an evaluator
  request or adversary brief; the brief also tells the adversary not to read
  them. It does not govern the project's ordinary Git remotes or the primary
  coding agent.
- `signing_key`: the developer's public verification key, or `null`, the
  default. With a key in force, developer-only records must verify against
  it. The key in force is the one in the settings the latest init or
  authorization bound, counting only a record whose evidence verifies
  against the key in force before it (with none, a signed record against the
  key it sets); never the file on disk, and never a record's own word. Setting a key is a settings
  change, authorized with a signature from that key; the attested records
  before it stand. While a key is in force, any settings change, including a
  new key or none, is authorized with a signature from it. Revised 2026-09-24: previously `init` asked the
  developer for a key or attested mode. With `null` the project is in
  attested mode: the agent asks the developer in conversation, and the command
  records the developer's answer in their own words, the harness that carried
  the conversation and the Git author; this is evidence, not cryptographic
  authentication. The kernel never prompts. Revised 2026-09-21: previously
  "the command requires an explicit controlling-terminal confirmation", which
  the developer had to type as a command.
- `attribution`: `forbidden` or `allowed`, for the release script.
- `harness`: one entry per supported harness: the model the adversary
  subagent runs as, and the model and transport of the evaluator's review
  source (section 10).
- `adversary_rules`: optional, a list of one-line rules. The host's limits
  for the adversary, such as a path to stay out of. The brief prints them
  under Host rules, so they are part of the
  text its record digests. Every other key is required; this is the one a
  settings file may leave out. Added 2026-09-24 (issue #13).
- `developer`: `present` or `absent`, default `present`. `absent` declares
  that no human will ever answer an escalation; only the narrow evaluator
  floor in section 10 can still name the developer. When it does, the run
  records that floor decision, wake prints it and exits 4 instead of
  waiting (the exit-code table above; section 5 restates this for Waiting
  generally). This is the setting an autonomous benchmark runs with.
- `typesafeai`: the evaluator policy in section 10. `enabled` chooses the
  measurement's source; it does not turn the measurement off (section 10).

Revised 2026-09-19: added the `developer` field and reworded the `typesafeai`
line. Previously this line read "the optional evaluator policy in section
10," which implied the whole measurement could be switched off. It cannot:
section 10 now measures every Consequential draft from Jev or, when
`typesafeai.enabled` is false, from the harness's review model instead, so
`enabled` only picks the source. The developer said the point of the redesign
was "to give the coding model a gut check or additional evaluation capability
to be able to measure the decision," which only works if the measurement
runs either way.

The settings shape is shown once here:

```json
{
  "schema": 1,
  "authority_remote": "origin",
  "outside": ["README.md", "CHANGELOG.md", ".github/**"],
  "source": ["bin/**", "src/**"],
  "interfaces": ["src/api/**"],
  "data": ["src/store/**", "migrations/**"],
  "network_exclude": ["fixtures/private/**", "config/*.secret.*"],
  "signing_key": null,
  "attribution": "forbidden",
  "developer": "present",
  "harness": {
    "claude_code": {
      "adversary_model": "claude-fable-5-1",
      "adversary_transport": "remote"
    },
    "codex": {
      "adversary_model": "gpt-5.6-sol",
      "adversary_transport": "remote"
    },
    "muse": {
      "adversary_model": "muse-spark-1.3",
      "adversary_transport": "remote"
    }
  },
  "typesafeai": {
    "enabled": false,
    "model": "jev-1.13.0",
    "weights": {
      "evidence": 0.2, "reach": 0.2, "contract": 0.2,
      "surface": 0.2, "ambiguity": 0.2
    },
    "agent_ceiling": 0.35,
    "confidence_floors": {
      "evidence": 0.0, "reach": 0.0, "contract": 0.0,
      "surface": 0.0, "ambiguity": 0.0
    },
    "min_calibration_agent_predictions": 60,
    "request_cap_bytes": 48000
  }
}
```

Revised 2026-09-19: the `typesafeai` block previously carried seven fixed
thresholds (`route_confidence`, `sufficient_threshold`, `outside_threshold`,
`contradicts_ceiling`, `reversible_floor`, `observed_floor` and
`max_false_downgrade`) that fed a gate cascade, and a `mode` field defaulted
to `"shadow"`. `.superpowers/bench/results.md` ran that cascade live: 0 of
12 agent-expected drafts reached the agent (the `sufficient` gate alone
rejected every one), which the developer called ritual assent. This block
now carries the composite's `weights`, `agent_ceiling` and
`confidence_floors` (`.superpowers/bench/composite-design.md`, 0.895 route
accuracy at `agent_ceiling: 0.35`). There is no `mode` field: the composite
only ever produces an advisory suggestion (section 10), never a live/shadow
authority switch, so there is nothing left for a mode to withhold.
`max_false_downgrade` moves to a kernel constant (section 10);
`min_calibration_agent_predictions` and `request_cap_bytes` are unchanged.

The kernel refuses an unknown settings schema or field; an invalid glob; an
`outside` path overlapping `source`, `interfaces`, `data`, a reserved path or a
mechanism input; a reserved path under `source`, `interfaces` or `data`; a
`documents` path below `source`; a
secret-shaped field or value other than the public `signing_key`; an invalid
authority remote; an evaluator `weight`, `agent_ceiling` or confidence floor
outside `[0,1]`; `enabled: true` without a model; `request_cap_bytes` above
64,000; a `typesafeai.mode` field at all; or `developer` set to anything but
`"present"` or `"absent"`. `enabled: true` also requires a versioned model
ID, not an alias, since a calibration record is bound to one resolved
model. Unknown values fail closed. The evaluator's `code_tiers` field stays
refused; `weights`, `agent_ceiling` and `confidence_floors` are now required
fields, not refused ones.

Revised 2026-09-19: previously refused "an evaluator threshold outside
`[0,1]`" and "`mode: route` without a current passing calibration," and said
the evaluator's "removed `weights` and `code_tiers` fields are refused rather
than ignored." Those thresholds and the `route` mode are gone (section 10);
`weights` came back with the composite (decision 56) while `code_tiers`
stayed out, so only `code_tiers` is still refused. A later pass over the
same revision removed `mode` outright, including its interim `"observe"`
value: the composite is advisory only (section 10), so `mode` is now itself
an unknown field and refused like any other.

**Working agreement.** `AGENTS.md` at the repository root, copied from the
template the plugin ships. It states the move for each verdict and action. The
kernel does not parse it. During an open commitment a change requires a
developer-authorized next-feature or supersession decision.

### Kernel-written state

**Mechanism.** An entry in `.sudus/mechanisms`, written only by `sudus declare`
and `sudus review mechanism`. It has two separately digested parts:

- The **definition**: command, working directory, `inputs`, `documents`,
  requirements, `results: per-requirement`, and a declared **execution
  identity**. The identity may contain runtime and tool versions, container or
  image identity, and named non-secret environment values. It records declared
  values verbatim, except that the password in a URL's userinfo and the value
  of a password- or token-named query parameter are recorded as `[redacted]`,
  since a connection URL is a common declared value that carries one. It never
  hashes or records undeclared environment values.
- The **review metadata**: for each requirement, the detection digest (the
  digest of the command, working directory and results mode) and the
  definition digest against which it was accepted, the requirement text
  digest, and the fail receipt for its violating example.

A changed command, working directory or results mode unbinds its review
metadata. A change to inputs, documents, execution identity or the
requirement list does not: those decide only when a receipt is current, and a
new requirement needs its own review. Review metadata written before revision
10 names only the definition digest; it binds that definition, and a redeclare
that keeps the command, working directory and results mode carries it over. Undeclared external state,
including installed tools, services, locale and host configuration, can change
a mechanism without staling its receipt; therefore "current" is not a claim of
hermetic execution.

**Command output.** `.sudus/output/`, ignored by Git, with each file named by
the digest in its receipt.

### Snapshots and refs

**Snapshot.** A commit on `refs/sudus/snapshots` whose tree header is the tree
it preserves and whose parent is the preceding snapshot commit. The commit
payload names one of two kinds:

- An **input snapshot** contains exactly one mechanism's declared repository
  inputs as they exist in the working tree. Only receipts may name it.
- A **workspace snapshot** contains the tracked files plus non-ignored
  untracked files in the repository working tree, excluding `.git/**` and
  `.sudus/output/**`. Start, review, report, resolution, acceptance,
  realization, evaluation and done records must name this kind.

Both kinds include dirty bytes without changing the index. The kind is checked
at every reference; a synthetic input tree cannot be compared with a workspace
tree. A snapshot commit, rather than a hexadecimal tree ID in prose, makes the
tree reachable and checkable out.

An input or workspace snapshot refuses a non-ignored untracked path matched by
`network_exclude` or a built-in credential pattern; it never smuggles such a
file onto the shared snapshot ref. The built-ins are `.env`, `.env.*`, private
key extensions (`*.pem`, `*.p12`, `*.pfx`, `*.key`) and conventional SSH
private-key names. A project with another sensitive path must list it.

**Allowed workspace snapshot.** A start snapshot, a workspace snapshot created
after a clean scope preflight, or the result of an approved keep or successful
restore. The first-observed snapshot on an unresolved scope breach is not an
allowed base. Later scope comparisons use the newest allowed workspace
snapshot, never merely the newest snapshot commit.

**Durable refs.** `refs/sudus/snapshots` and `refs/sudus/log`. The kernel alone
writes them, never rewrites them, and advances each with compare-and-swap: the
expected old OID is required and a mismatch refuses the write. The log is a
chain of record commits whose schema is in section 4. Records reference records
by log SHA and code only by a kind-checked snapshot SHA.

**Inbox.** `refs/sudus/inbox/<clone id>`, one per clone: a chain of item
records in the log's own envelope that only that clone appends to, so its push
always fast-forwards. The clone id is a random token in the clone's own
`.git/config` (`sudus.clone`); the worktrees of one repository share it. While
a commitment another clone started is open, `sudus item` writes this clone's
inbox instead of the log. Added 2026-09-26 (revision 18, issue #35).

**Action lease.** `refs/sudus/in-progress`, local to the repository and never
pushed. `sudus begin <action> <target>` creates it with compare-and-swap before
the agent changes a declared input, and prints the sha it wrote; `sudus end`
removes it with compare-and-swap after the action is committed, and refuses
when a passed `--lease <sha>` does not name that printed sha, so a stale end
from another session can never close this one's lease. `sudus end --abandon`
removes it and records the action as explicitly abandoned rather than
finished. `sudus begin --touch <path>`
provisionally adds a path to the target's mechanism inputs for the life of the
lease, so the declaration precedes the change; `sudus end` writes the addition
into the definition, which leaves its review metadata bound as any added input
does, or drops it when the path is unchanged. It carries the action, target,
workspace snapshot at start, timestamp and harness session when available.
While it exists, its target's declared inputs are neither `record` nor `commit`
findings. The separate check lock is `sudus-check.lock` below `git rev-parse
--git-path`; `sudus check` holds it only for the run, so a check can nest inside
an implementation action.

The action lease does not coordinate separate clones. Concurrent clones meet at
the authority remote: a non-fast-forward or failed lease push stops the later
writer before its branch is published.

### Records and evidence

**Receipt.** One mechanism run: the definition digest, an input snapshot, the
observed declared execution identity, whether the command ran or errored, and
per requirement its text digest and result. A **fail receipt** for a requirement
has `ran` and result `fail`; `error` never counts.

**Current.** A receipt is current for a requirement when the input snapshot's
tree, definition digest, requirement text digest, observed execution identity
and readable schema equal those computed now.

**Review.** The builder's claims at a workspace snapshot: what was examined,
answers to the fixed questions in section 9, and findings.

**Brief.** The record `sudus brief` writes for a review: the review it names,
the detected harness and the adversary model its start line names, the brief
digest, and the agent decisions it lists.

**Report.** The adversary's attempts against the work at the reviewed
workspace snapshot, and its findings; or the Sudus bug it stopped on. One
complete report is written per commitment.

**Finding.** A numbered entry on a review or report (or on a Sudus 3
acceptance). A report's finding carries a severity: Critical, Major or Minor.
The builder settles a finding with a **resolution**, which names the snapshot
after a fix and explains it, or a **decline**, which gives its reason for not
fixing it. An escalation may also name a finding, when the builder asks; one
escalation may name several, and the developer's `ok` closes each of them.

**Acceptance.** Written by Sudus 3 only, before revision 16: the adversary's
verdict on each resolution after the report. A 3.x log still holds them; a
resolution one rejected leaves its finding open, and its findings count.

**Escalation, answer and reply.** An escalation has five one-line fields:
question, recommendation, because, if wrong, and instead. Wake prints them
verbatim, and for an escalation that names findings, an `ok closes:` line
naming each, since an ok closes them all. The agent puts them to the developer
in conversation, in plain prose without a choice widget: the problem, then the
recommendation as `ok` with each finding on the `ok closes:` line, the cost if
wrong and the alternative as `instead`, and discussion as `ask`, ending with
`ok | instead | ask`. The developer answers in their own words. The agent
records `ok`, `instead` or `ask`, quoting those words verbatim, with `sudus
answer <slug> ok|instead|ask --quote <words>`; `ask` stays open until an agent
reply. Developer-only commands use the authentication rule in Settings.
Revised 2026-09-21: previously "The developer writes `ok`, `instead <text>` or
`ask <text>` with `sudus answer`".

**Developer evidence.** Every developer-only record carries evidence of the
developer's decision. `signed` evidence is a signature over the purpose,
subject and nonce that verifies against `signing_key`. `attested` evidence is
the developer's words quoted verbatim by the agent that asked, the name of the
harness that carried the conversation (`claude_code`, `codex`, `muse` or
`none`), and the Git author. Records written before revision 6 may carry
`unsigned-local` evidence; the kernel reads them and never writes one again.

**Direction.** The record `sudus authorize instead|ask --quote <words>`
writes when the developer asks for a change or a question before binding:
the kind, the developer's words, the harness and the Git author. It binds
nothing and wake ignores it; it keeps the developer's words in the log.

**Evaluation intent, call and measurement.** The three record kinds that make
the evaluator recoverable. The intent fixes the draft, pre-write identity,
policy and every constructible request digest before network I/O. Each
attempted model call has its own call record. The measurement holds the draft
digest, the source (`jev` or `review`), the resolved model, each of the five
Score dimensions with its level and confidence, the computed composite, which
veto if any fired, the suggestion and the reason. Section 10 defines them.
The suggestion is advisory (section 10): what actually happened is the
agent's own decision, which the ADR schema's `by` field records separately
on the decision itself.

Revised 2026-09-19: this was "Evaluation intent, call and result"; the result
record "applie[d] deterministic gates and name[d] the actual route" over raw
Noul and Choice answers. Section 10 no longer runs that gate cascade; it
scores five dimensions and computes one composite in code, so the third
record now holds a measurement, not a gate result, and what it names is a
suggestion, not a route: a later pass over this same revision corrected an
early draft that still had the composite deciding. "The optional evaluator"
became "the evaluator" because section 10 measures every Consequential draft
from one source or the other; only the source is optional.

**Calibration.** A record over developer-labelled measurements, bound to one
evaluation-policy digest. It states the conditional sample, error count,
confidence bound and pass or fail result. It tunes the composite's `weights`,
`agent_ceiling` and `confidence_floors` offline, from recorded dimension
levels; it does not gate whether the agent may decide.

Revised 2026-09-19: previously "developer-labelled shadow evaluations."
Shadow is no longer the default source of labelled data (section 10), and a
passing calibration is no longer a precondition for the agent to decide; the
developer's benchmark showed that precondition was why no draft ever reached
the agent under the superseded design.

**Item.** A captured idea of kind `backlog`, `next-feature` or `defect`.
Backlog work is already covered by Agreed requirements. A next-feature item
would change Agreed text or the working agreement and names what. A defect names
an Agreed requirement the code violates. Outside, promotion, fix and
retirement records later reference the item.

**Scope breach.** A durable record of the first Sudus observation, while a
commitment is open, that a path differs from the latest allowed workspace
snapshot while no then-active mechanism declared it and `outside` did not list
it. It names that snapshot and the declaration-set digest. A later declaration
cannot clear it. Between commitments no breach is observed: the spec phase
writes the next commitment's mechanisms, tests and declarations before `sudus
start`, and that start's snapshot is the next allowed base. (Revised
2026-09-22: the gap used to be observed against the finished commitment's base,
so every file the spec phase was told to create became a breach.)

**Start.** Opens a commitment at a workspace snapshot. Its **set** is every
requirement in the roadmap section plus every Agreed `Scope: every commitment`
block, each with the exact text digest at that moment. The set and digests are
immutable for the range. A start following a supersession references that
superseded record.

**Done.** Closes a commitment at its final workspace snapshot.

**Superseded.** Closes a commitment without Done after the developer chooses a
successor slug. It names the old start, the developer decision, a transition
ID, the intended successor slug and every carried open record. It does not name
a future start. The successor start later references the superseded record.
Unanswered escalations, unresolved findings and unfixed defect items carry;
receipts remain usable only by their ordinary identity; other items remain
items. While no successor start exists, wake names the pending transition and
the existing-project skill resumes it.

**Range.** The log after a start through its head or closing record. A receipt
is current by its identities, not its position: review metadata may name a fail
receipt written before the start record, as the spec-phase tail produces. A pending
supersession has no open range.

### ADR and other terms

**ADR.** `docs/decisions.jsonl`, append-only and kernel-managed. Each line is
one canonical JSON object written by `sudus decide`, `sudus escalate` when the
floor or a measurement sends a Consequential draft to the developer, `sudus
answer`, `sudus decisions --read`, `sudus
realize`, `sudus supersede`, or `sudus promote`. Kinds are `decision`,
`realized`, `superseded`, `answered` and `read`.
A decision carries `by`, `rests_on`, `wrong_if`, `body`, the workspace
snapshot from which realization will be measured, and the measurement it
read, or `null` when the narrow floor routed it without one. A realized line
names that base and the realized workspace snapshot. A read line names the
read record on the log, which carries the developer's authentication as an
answer record does.

Revised 2026-09-19: "an evaluation downgrades" described the old gate
cascade converting a Consequential draft to Blocking; that cascade is gone
(section 10). "A decision carries ... and the measurement it read" is new
text making explicit what section 4's ADR schema already stores as
`"evaluation":<sha|null>`, so an autonomous run is scoreable from the
decision record alone, as the developer asked. Section 4's schema table
still names that field and the evaluation-intent/call/result rows in the old
vocabulary; this revision did not touch section 4, so the field name and the
result shape there are stale against this section until a later pass renames
them.

The kernel has two decision levels. A Consequential decision is appended to the
ADR and queued while the agent continues. A Blocking decision is an escalation;
its answered line names the answer record. The working agreement may describe
Routine and Judged guidance, but they leave no record.

**Verdict.** What wake prints. `Resolvable` names an action and its predicate.
`Waiting` prints an unanswered escalation's five fields. `Done` means a done
record exists and no promotion waits. Wake is read-only. Outside a project, on
missing durable refs, during a pending supersession, with an interrupted
transaction, or with no commitment started (`sudus: no commitment started; run
/new-project or /existing-project`), it prints one line naming the command or
skill that continues and exits 3; none is a verdict.

| Exit code | When | Is it a verdict? |
|---|---|---|
| 3 | No project, missing durable refs, a pending supersession, an interrupted transaction, or no commitment started | No; wake names the command or skill that continues instead |
| 4 | `developer: absent` and the narrow evaluator floor or a veto (section 10) names the developer for a Consequential decision | Yes; a real Waiting verdict this run cannot answer, so it stops there (section 5) |

Revised 2026-09-19: new table. Wake had only ever needed one non-zero exit
code (3, for a state that is not a verdict at all); `developer: absent`
(section 5) adds a second, for a real Waiting verdict nobody in this run can
answer.

**Predicate.** The exact record state that completes an action. It is printed
with the action.

**Attempt.** A failing receipt at a product digest not seen among failures
since that requirement's last pass. The product digest is the input tree with
declared `documents` paths excluded, so a change only to a document is never a
new attempt.

**Semantic progress.** One of: a start-set requirement gains a current pass; an
unresolved finding, defect or escalation is closed without an equal-or-higher
priority obligation being created; the loop advances from implementation to
review, report or Done; or the developer explicitly authorizes continuation.
A branch commit, timestamp, snapshot, log record or content-identical rewrite
alone is not progress.

The term `next-feature` replaces 1.x's `next-iteration` everywhere: skill, item
kind and flag.

## 3. The processes

Four entry flows, one shared tail and one work loop.

### Install

`install.dot` begins with Node and Git; if either is missing it stops and names
it. The developer installs the plugin for Claude Code, Codex or Muse, or uses
the skills CLI and `/install-sudus`. Installation links
`~/.local/bin/sudus`, registers hooks where the harness supports them, and
lists the five skills. A harness without hooks is instruction-only.

Installation is global and never asks for a project remote. It is complete when
`sudus --help` prints. Inside an initialized project the session-start hook also
prints the current verdict; elsewhere it names `/new-project` or
`/existing-project`.

### Project initialization

New-project and existing-project run `sudus init` before they need settings,
mechanisms or refs. It initializes Git when the new-project directory has none;
validates or creates settings; takes the developer's answer as flags:
`--remote <name>` or `--local-only` for the authority and `--quote <words>`
for the developer's words; writes the init record; and creates the durable
ref roots with compare-and-swap. Evidence is attested unless
`--signing-key <path>` names a public key file; `--attested` names the
default and refuses alongside `--signing-key`. The agent asks the question in
conversation before it runs the command and does not ask about signing; the
command asks nothing itself and refuses, naming the flag, when an answer is
missing. Revised 2026-09-24: previously the developer was also asked for
`--signing-key <path>` or `--attested`, and the command refused without one.
Revised 2026-09-21: previously the command asked its questions at the
controlling terminal. Protection begins at the
settings digest in that record. Initialization makes no evaluator call.

If settings exist but the refs do not, initialization adopts them only with
`--adopt <digest>` naming the digest the developer confirmed in conversation.
If refs exist but settings do not, it refuses and names repair. Re-running
initialization against the same identity is idempotent.

### New project

`new-project.dot` runs only in an empty directory or one holding no source code
or spec (a README, license and Git do not count). Otherwise it switches to
existing-project. After initialization it asks one open question: what is the
software for? It has four developer gates:

1. Restate the answer in the agent's own words; the developer corrects it.
2. Draft five to fifteen glossary terms as one set; the developer corrects by
   exception.
3. Derive the domain partition from the keystone; the developer confirms it.
4. Run the shared spec-phase tail for the requirement blocks.

The keystone states what the software is, its problem and what it is not. Each
domain gets requirements with one actor-named obligation, a falsifier and Draft
status. The roadmap names the first commitment before the shared tail begins.

### Existing project

`existing-project.dot` takes a codebase Sudus has not specified, one whose spec
has drifted, or a pending supersession to one prepared commitment. If wake says
Done, it switches to next-feature. If a commitment is open and the request is
outside it, the developer chooses either to finish it and capture the request,
or to supersede it.

Supersession is two-phase. `sudus supersede <successor-slug>` writes the
developer-quoted Consequential decision and a superseded record that closes the
old range with a transition ID and intended slug. It does not move `Current:`
and cannot name a start that does not exist. Recon and specification then
prepare the successor. The successor's start names the superseded record and
`Current:` moves in the same recoverable start transaction. An interrupted gap
is a pending transition, not a second open commitment.

A Cairn 1.x project (record directories under `.cairn/`, or
`docs/commitments/`) is migrated before initialization, on the developer's ok:
the 1.x record directories are removed, since Sudus 2 reads none of them and
Git history keeps them; the specification is converted in place until
`sudus lint docs/spec` is clean, with no requirement's words changed; each
1.x mechanism's command and inputs are kept in `docs/recon.md` for the tail's
declare step; and after initialization each 1.x item file becomes one item
record. Added 2026-09-22.

Recon precedes questions. Path A, for a repository without a spec, derives the
glossary from code identifiers, writes Observed specs inside the requested blast
radius, and writes one-line rows in the map outside it. Path B reads the current
spec first, then checks every section inside the radius. Both inspect manifests,
entry points, data, tests, CI, scripts, non-spec docs and recent history.
Path B covers every commit since the newest Agreed date.

`docs/recon.md` records every claim as Exists, Documented, Contradicted or
Unverified with a citation and carries unresolved earlier findings. The agent
presents it for correction, asks whether the work is a feature or defect, and
traces modules, tests and spec sections. For each Path B section it records
Holds, Drifted, Still Observed or Missing. Drift presents both sides and the
developer rules: revise the spec, or leave it and create a defect item. Observed
sections the developer confirms become Draft with falsifiers; the rest remain
Observed. A defect commitment names the violated requirement and a mechanism
that reproduces it. The flow then enters the shared tail.

### Next feature

`next-feature.dot` runs only after Done. It reads the spec set, finished roadmap
section, Consequential queue, next-feature items not yet retired and backlog, then
asks one question: the waiting items, a new feature, or both?

For every requested change it traces and cites the blast radius, restates what
changes for whom, quotes any affected Agreed text, gives the alternative and
recommendation, and lets the developer correct the reading. A change already
covered enters the commitment without new text. Otherwise the requirement is
revised under its identifier or added as Draft with at most one Rationale line.
Because no commitment is open, confirmed text can change before the new start.
The flow then enters the shared tail.

### The shared spec-phase tail

`spec-phase.dot` begins with Draft requirements and falsifiers. The agent
proposes the falsifiers as one set and names each mechanism; self-reviews for
contradictions, falsifiers that would miss their violation, and requirements no
mechanism can check; runs `sudus lint docs/spec`; and presents by exception with
an invitation to ask for another explanation. The developer confirms, corrects,
or rules that the recommendation stands. A deference decision quotes that
ruling. Each confirmed block becomes `Status: Agreed <date>`.

The agent writes the roadmap section and moves `Current:`, declares mechanisms
for this commitment's requirements only, demonstrates each on a violating
example, and writes or updates the working agreement. The agent then states
what would be bound: the specification, the working agreement and settings,
each by digest, and what changed in them since the last authorization; asks
the developer for ok, for changes, or for a question; and on ok runs
`sudus authorize --quote <words>`, one command that binds the final digests of
the specification, the working agreement and settings in one authorization
record. A request for changes or a question is recorded with
`sudus authorize instead|ask --quote <words>` as a direction record, binds
nothing, and the agent acts on it and asks again. Revised 2026-09-21:
previously "The developer then runs `sudus authorize`". `sudus start` stages a command intent, commits the prepared contract,
agreement and mechanism bytes, and writes the workspace snapshot and start
record as one recoverable transaction, including the frozen set and optional
supersession link. It installs exact fetch and push
refspecs for `refs/sudus/log` and `refs/sudus/snapshots` on the authority remote
only when one is configured. Wake names the first work-loop action.

### The work loop

`work-loop.dot` begins at wake. Wake names one action and its predicate; the
agent performs that action until the predicate holds, leaves the required code,
snapshot or log record, then wakes again. An unanswered escalation is Waiting
and the agent stops. A pending report is the agent's wait and remains
Resolvable.

When the Done rule holds, wake names `done`. `sudus done` writes the done
record. Terminal output is not durable state: the next invocation renders the
unread queue. With a backlog item waiting, the next wake names `promote` rather
than Done, unless the developer's ok lets the item wait (section 8, Capture and
promotion).

## 4. The record set

A record exists only if this specification names its reader. The kernel parses
two hand-written inputs: specification grammar and settings. Everything else it
uses for authority or Done is either a Git object it wrote or canonical JSON it
wrote.

### Canonical encoding

Every log record is an empty commit with subject `sudus: <kind> <target>`. Kind
and target are restricted ASCII tokens; arbitrary text and paths never appear
in the subject. The commit body is the record: one UTF-8 RFC 8785 canonical
JSON object, readable in `git log`. The commit has exactly two trailers:

```
Sudus-Schema: 1
Sudus-Digest: sha256:<hex of the body bytes>
```

A record written under the former layout has the subject prefix `cairn:` and
the trailers `Cairn-Schema` and `Cairn-Digest`; every reader accepts either
envelope (section 2, Layouts). The trailers carry only the schema and the digest; content never lives in a
trailer. Each kind has a closed object schema: required keys, no unknown or duplicate keys,
fixed scalar types, ordered arrays where order is meaningful, and lowercase
hex of fixed length for SHAs and digests. Arbitrary strings live only as JSON
strings. The parser rejects invalid UTF-8, control characters outside JSON
escapes, noncanonical JSON, a body whose digest does not match the trailer,
wrong field counts and out-of-range numbers. It never delegates content
parsing to `git interpret-trailers`.

The same rules apply to snapshot payloads. ADR lines are canonical JSON written
directly as one line, with embedded newlines escaped. `sudus show` renders
records with their references resolved. The commit is the authority-bearing
form.

### Logical record schemas

The table names logical payload fields. `<ws>` is a workspace snapshot SHA,
`<input>` an input snapshot SHA, and `<sha>` a log record SHA.

| Kind | Required logical fields | Read at |
|---|---|---|
| `init` | settings digest, authority remote or local-only, developer-auth mode | every project command |
| `authorization` | spec digest, agreement digest, settings digest, developer-auth evidence, optional decision ID, intent SHA or null, results | start and protected writes |
| `command-intent` | transaction ID, command, complete input identity, expected pre-identities, ordered planned writes and digests | wake and `recover` until finalized |
| `command-abort` | intent SHA, failure class, verified restored identities | wake and `recover` |
| `start` | slug, `<ws>` roadmap snapshot, repeated `{requirement,text_digest}`, optional `from_superseded:<sha>`, the starting clone's id (absent before revision 18), intent SHA or null, results | every wake; opens the range; routes item capture |
| `receipt` | mechanism, definition digest, `<input>`, `ran|error`, observed declared environment, repeated requirement text digest and `pass|fail|unverified`, output digest, exit code or signal | freshness and attempts |
| `review` | slug, `<ws>`, examined entries, one answer for every fixed question and target, findings | brief, report and Done |
| `brief` | slug, review SHA, harness, adversary model or null, payload digest, the decisions it lists (revision 16; a 3.x brief also holds transport, boundary, projection and exclusion manifest digests) | report validation |
| `report` | slug, `<ws>`, brief SHA, one attempt per lens and target (looked for, found, held), interface attempts, findings with severity, where and remedy, or the Sudus bug it stopped on (revision 16; a 3.x report holds model, transport, session, projection digest and Q1 to Q6 attempts) | Done, resolution and decline |
| `resolution` | source record SHA, finding number, `<ws>`, explanation | Done and the review report |
| `decline` | source record SHA, finding number, the builder's reason | Done and the review report |
| `acceptance` | written by Sudus 3 only: slug, report SHA, `<ws>`, cumulative-delta digest, accepted and rejected resolution SHAs with reasons, new findings | Done: its findings count, and a rejection reopens a finding |
| `escalation` | slug, five fields, concern reference, optional evaluation SHA | every wake until answered |
| `answer` | escalation SHA, `ok|instead|ask`, the developer's words, optional owner label, developer-auth evidence | wake, ADR and calibration |
| `direction` | `instead|ask`, the developer's words, harness, Git author | nothing; the log keeps it |
| `reply` | escalation SHA, text | wake after `ask` |
| `read` | decision ID, developer-auth evidence | queue and ADR |
| `evaluation-intent` | draft digest, `<ws>`, pre-write log head, ADR digest, settings digest, policy digest, source `jev|review`, nullable request digest, session, launch (harness, model, transport, boundary) | measurement recovery |
| `evaluation-call` | intent SHA, source `jev|review`, request digest, `response|failure|indeterminate`, resolved model, transport and session (review source only), raw response bytes or failure class, parsed answers when valid, reported usage | measurement and audit |
| `measurement` | intent SHA, nullable call SHA, draft digest, source `jev|review`, resolved model, the five Score levels with their confidences, composite, veto or null, `suggested: agent|developer` or null, outcome `floor|unavailable|veto|composite|indeterminate`, reason | escalation, decision, calibration |
| `calibration` | policy digest, labelled-through log head, predicted-agent count, false-downgrade count, one-sided confidence bound, criterion, `pass|fail` | policy validation over labelled measurements |
| `item` | `backlog|next-feature|defect`, slug, source requirement or changed contract, body | capture, Done and next-feature |
| `outside` | item SHA, reason, optional evaluation SHA | capture gate |
| `retirement` | item SHAs, developer-auth evidence | promotion, Done and next-feature |
| `promotion` | item SHA, decision ID, intent SHA or null, results | after Done |
| `fix` | item SHA, `<ws>` | Done |
| `scope-breach` | path as JSON string, first-observed `<ws>`, allowed-base `<ws>`, declaration-set digest | every wake until disposition |
| `scope` | breach SHA, `keep|restore`, resulting `<ws>`, escalation and answer SHAs when kept | scope predicate |
| `done` | slug, final `<ws>` | closes the range |
| `superseded` | slug, old start SHA, developer decision ID, transition ID, successor slug, carried record SHAs, intent SHA or null, results | closes old range; successor start |

`docs/spec/roadmap.md` is exempt from scope breaches only outside an open
commitment range: the developer and agent write its next section, and
`sudus start` and `sudus promote` edit it, between commitments. Inside an
open range it is an undeclared change like any other.

An evaluation's raw response is stored byte-for-byte inside its encoded payload;
the parsed answer is separate. Missing, malformed or noncanonical responses
cannot be reconstructed from parsed values. A logical byte string, including a
raw response, is represented inside canonical JSON as unpadded base64url.

### ADR schema

One canonical JSON object per line in `docs/decisions.jsonl`:

- `{"kind":"decision","id":<ulid>,"ts":...,"level":"Consequential","by":"agent|developer|joint","title":...,"rests_on":[...],"wrong_if":...,"body":...,"base_snap":<ws>,"evaluation":<sha|null>,"interfaces":[...]}`
- `{"kind":"realized","id":<ulid>,"ts":...,"of":<id>,"base_snap":<ws>,"snap":<ws>,"subject":...,"interfaces":[...]}`
- `{"kind":"superseded","id":<ulid>,"ts":...,"of":<id>,"by":<id>,"cause":"the stated condition occurred|an unforeseen condition occurred|it was wrong when it was made|the premise was false"}`
- `{"kind":"answered","id":<ulid>,"ts":...,"escalation":<sha>,"answer":<sha>}`
- `{"kind":"read","id":<ulid>,"ts":...,"of":<id>,"record":<sha>}`

`sudus decisions` renders the file. The queue is every decision without a later
read line. `sudus decisions --read <id>` is a developer-only command. A line
written outside its assigned command, a duplicate ID, a noncanonical line, an
unknown key, or a reference to a missing record is a breach.

### Requirement and roadmap grammar

A requirement block begins at `[PREFIX-nnn]` at the margin and ends at the next
blank line. In order it contains the identifier and first text, continuation
text until `Falsifier:`, one-line `Falsifier:`, `Mechanism:` outside the digest,
optional one-line `Rationale:` outside the digest, and `Status:`. Its text digest
is the identifier, obligation text and falsifier after the specified whitespace
normalization. File headers before the first block carry `Prefix:`, optional
`Scope: every commitment`, and optional `Host paths:`. Other prose is ignored.

`sudus lint docs/spec` refuses broken order, duplicate or reused identifiers,
references to absent identifiers, missing falsifiers, an Agreed block without a
mechanism, noncanonical status dates, and a spec map that
does not match domain prefixes. That refusal is the falsifier for this grammar.

The roadmap parser reads only `Current: <slug>` and, below the matching heading,
`Requirements: <identifiers>`. The rest is prose. A section's set is that one
line: lint refuses a second `Requirements:` line, one that ends in a comma, and
a line of bare identifiers right after it, since their identifiers would enter
no set. `sudus start` resolves the whole set and digests it before writing
anything.

### Commands and crash recovery

`sudus begin` and `sudus end` manage the local action lease. `sudus check`
writes receipts. `sudus review`, `brief`, `report`, `resolve` and `decline`
write the review chain. `sudus escalate`, `answer` and `reply` write the decision
chain. `sudus item`, `outside` and `fix` manage items. `sudus decide`, `realize`,
`decisions --read` and `promote` manage the ADR. `sudus authorize` binds the
protected digests in one record; a settings change is a new authorization
naming the new digest; `sudus authorize instead|ask` writes one direction
record and nothing else. `sudus start`, `done` and `supersede` bound commitments. `sudus
migrate` moves a project from the former layout, once, between commitments
(section 2, Layouts). Wake writes
nothing. No command edits a record.

Four commands write to more than one store: `start`, `promote`, `supersede`
and `authorize`. Every other command writes one store and needs no intent. A
multi-store command holds a repository-local transaction lock, first stages
exact bytes, commit metadata and
pre-identities below the Git directory, appends a command-intent, performs the
ordered writes, and appends a terminal domain record naming that intent. Each
step is idempotent on the transaction ID and expected old identity; atomic rename
prevents partial files. Wake names `recover <transaction>` for a nonterminal
intent before any ordinary action. `sudus promote`'s promotion record is one
of these ordered writes, a `plan.writes` log descriptor inside the same
transaction that writes its `start` record, not that transaction's terminal
record.

Recovery completes forward after any planned append-only write beyond the
intent or any external effect has occurred. It may instead restore staged
pre-identities and append a command-abort only when neither has occurred. It
never rewrites an append-only ref. If a conflicting writer makes forward
completion impossible, recovery preserves the intent and records or names the
exact repair before a Blocking escalation; it never asks a human to infer what
happened.

An evaluator intent is written before network I/O. If the process may have sent
a request but no response record exists, recovery writes an `indeterminate`
call and routes to the developer. It never silently calls again and pretends the
new nondeterministic answer was the lost one.

Terminal output is never a completion fact. A done record means done; a later
invocation can render the queue again.

### Travel with the code

Only `refs/sudus/log`, `refs/sudus/snapshots` and the inboxes travel. When
`authority_remote` is non-null, `sudus start` installs the two durable refs'
exact fetch and push refspecs on that remote only, and a fetch refspec for
`refs/sudus/inbox/*`. `sudus push` pushes this clone's own inbox after the
log and before the branch, then fetches every other clone's inbox, so the
clone that holds the commitment sees what they captured. The working
agreement's push command atomically pushes the branch and both refs where the
remote supports atomic push.

Without remote atomicity, Sudus pushes snapshots first, log second and branch
last. A failure stops the sequence. Snapshots ahead of the log and a log ahead
of the branch are safe and retried; the branch is never intentionally advanced
without the records it needs. A bypassing ordinary Git push can still create a
mismatch. After fetch, wake validates all cross-references and names the exact
fetch or push repair; it never guesses. The durable refs are append-only and a
push uses the expected remote OID as a lease.

A clone without the durable refs exits 3 and names:

```
git fetch <authority> 'refs/sudus/log:refs/sudus/log' \
  'refs/sudus/snapshots:refs/sudus/snapshots'
```

Records from 1.x are not read.

## 5. Verdicts, actions, predicates and precedence

Wake prints a verdict, the action or party, one line of reason and the action's
predicate. The table is normative.

| Action | Complete when |
|---|---|
| `repair PATH` | the named hand-written file reads under its grammar and no unrelated byte changed |
| `recover TRANSACTION` | the intent has one terminal domain or abort record and every store matches its resulting identity |
| `reconcile ACTION` | the local action lease is gone and the action it named finished or was explicitly abandoned |
| `scope PATH` | every scope-breach record for the path has a developer-approved keep disposition or a restore snapshot equal to its allowed base; an unanswered escalation that concerns the breach is Waiting instead (added 2026-09-22) |
| `supersede SLUG` | every requirement in the open commitment's set has Agreed text whose digest equals the one its start froze, or a superseded record closes the commitment (added 2026-09-23: the frozen contract is not amended; wake names the exit, restore or supersede, instead of a mechanism review that can never bind) |
| `fix ITEM` | a fix record names the item and a workspace snapshot that changes no protected contract of the commitment open when it was recorded (between commitments no contract is frozen and none is measured); its requirement has a current pass at or after it, whether or not the last commitment owns that requirement |
| `record PATH` | the action lease covers the path through its target's declared inputs, or the path is clean |
| `commit PATH` | the path is clean, or the action lease covers it; `docs/decisions.jsonl` is named here whenever it has uncommitted lines (added 2026-09-22) |
| `declare REQ` | a mechanism definition names the requirement and no pre-existing undeclared delta was legalized |
| `run REQ` | a current receipt carries a result for the requirement |
| `implement REQ` | a current receipt says pass and review metadata binds the requirement to the current detection and text digests with a fail receipt |
| `escalate REQ` | after three distinct attempts without a pass, an escalation concerns the requirement before a fourth; a receipt where another requirement of the commitment also failed is not an attempt; attempts count from the requirement's turn, which begins once every requirement before it in the set passes, and the first receipt of a turn that begins after the start record is not an attempt |
| `review mechanism REQ` | review metadata binds the requirement to the current detection and text digests with a fail receipt |
| `capture ITEM` | an outside record names the item, or an escalation concerns it |
| `review SLUG` | a review names the current workspace snapshot and answers every fixed question for every target |
| `report SLUG` | a report names the reviewed snapshot through the latest brief and attempts every lens for every target and every interface obligation; a report that stopped on a Sudus bug is not one |
| `resolve SLUG N` | a resolution, or a decline with its reason, names finding N of its exact source record |
| `build DECISION` | a realized ADR line names the decision's base and resulting snapshots and the realization check passed |
| `done SLUG` | a done record names the commitment and final workspace snapshot |
| `fold ITEM` | no commitment is open; every inbox item this clone holds is on the log, or its slug is held by a different item (added 2026-09-26, revision 18) |
| `promote` | no commitment is open; one promotion names a backlog item and decision; `Current:` and a one-item successor start were written transactionally |
| `reply SLUG` | a reply record names the open `ask` escalation |

A Consequential decision carries one more requirement this table does not
list as a row, because wake never queues it as a next action the way it
queues `declare` or `run`: before the agent writes the decision, `sudus
measure` runs on the exact draft and writes a current measurement record
(section 2). `sudus decide --consequential` refuses a draft whose
measurement is missing, stale, or built from a different draft digest.
Waiting for a Consequential decision arises only two ways: the narrow floor
in section 10 sends it to the developer before any call is made, or the
agent, having read the measurement, chooses to escalate anyway. A
measurement whose suggestion is `agent` is information, not consent; the
agent may still escalate past it toward the developer, but nothing routes a
floor-caught or vetoed draft to the agent.

Revised 2026-09-19: new. Section 10 replaces a deterministic gate cascade
with one composite measurement the agent itself reads and acts on; this
paragraph is where the decision predicate picks that up, since the
Consequential decision row was never in the action table to begin with.

### Scope is monotonic

Before any state-changing command, the kernel compares the current workspace
with the latest allowed workspace snapshot and the declarations active at that
log head. If it observes an undeclared, non-outside changed path, it records a
scope breach before doing the requested work. `sudus declare` performs this
preflight before it can add an input. Thus a declaration legalizes only future
changes. A path touched under a lease is declared from `sudus begin`, so
implementing a requirement in a new file is not a breach and needs no
developer disposition.

The breach survives rebases and squashes because it is a log fact tied to a
workspace snapshot and declaration-set digest, not a claim about mutable
first-parent chronology. It closes only when the developer approves keeping the
captured bytes or a workspace snapshot restores the path to its allowed base.
If a change is removed before Sudus ever observes it, no built work remains and
there is no breach to preserve.

### Precedence

Wake tests in this order and names the first unmet predicate: unreadable
hand-written input (`repair`); incomplete transaction (`recover`); stale action
lease (`reconcile`); scope breach (`scope`); unanswered escalation (`Waiting`,
or `reply` after `ask`); Agreed text of a set requirement revised under the
open commitment (`supersede`); unfixed defect (`fix`); uncovered dirty input (`record`,
`commit`); missing declaration (`declare`); missing or failing receipt (`run`,
`implement`, or `escalate` after three attempts); stale mechanism review
(`review mechanism`); uncaptured item from the commitment (`capture`); missing
current review (`review`); missing report (`report`); a finding neither
resolved nor declined (`resolve`); unrealized Consequential decision (`build`); Done
rule satisfied without a done record (`done`); closed range with an inbox
item not yet on the log (`fold`); closed range with a backlog item that
neither retired nor waits (`promote`); Done.

While the report has an open finding, a missing current receipt waits: wake
names the next `resolve` instead of `run`, so the checks run once, after the
last finding is resolved or declined, not after every fix. A
current receipt that fails is still `implement`, and three failing attempts are
still `escalate`. The Done rule is unchanged: every requirement needs a current
passing receipt.

### Done

Done requires all of the following:

- Every requirement in the start record's frozen set has a current passing
  receipt whose review metadata binds the current mechanism definition to that
  frozen text digest.
- A review and a complete report exist at the reviewed workspace snapshot.
- Every finding on the review, the report or a Sudus 3 acceptance is resolved,
  declined with its reason, or closed by the developer's ok on an escalation
  naming it. (Revised 2026-09-25, revision 16: previously the latest
  acceptance had to examine the cumulative delta at the final workspace
  snapshot and accept every resolution.)
- No escalation is unanswered, scope breach undisposed, defect unfixed,
  transaction incomplete, action lease stale, Consequential decision
  unrealized, or administrative-cycle escalation unresolved.

Backlog items are not in the rule. When the rule holds, wake names `done`;
`sudus done` writes the record. The next wake renders the queue or names one
promotion, so one commitment is open at a time; a backlog item the
developer's ok let wait is listed, not named (Capture and promotion).

The report is written once at the candidate snapshot. Every later fix is a
resolution, and every finding the builder does not fix is a decline with its
reason. No adversary examines the change after the report: the checks judge
it, since Done needs a current passing receipt for every requirement at the
final snapshot, and `sudus done` prints the review report for the developer.

### Waiting and liveness

Waiting begins when an escalation exists without a final answer. Wake prints
the five fields verbatim; the agent adds nothing. Hooks print the same state and
do not nag.

Settings' `developer` field states whether a human can ever answer that
Waiting. `developer: absent` is what an autonomous benchmark runs with: the
narrow floor in section 10 is the only path left to the developer, since the
agent's own choice to escalate past a `suggested: agent` measurement would
have no one to answer it either. Under `developer: absent` every escalation
is recorded on the log exactly as it would be with a developer present, wake
prints its five fields exactly as Waiting always prints them, and the run
then exits 4 instead of sitting at Waiting for an answer that cannot come:
the floor, a veto, the agent's own escalation after three failed attempts, a
cycle bound, a breach, all alike.
Exit 4 is distinct from wake's exit 3 for a non-verdict state (section 2,
exit-code table): a floor hit or a veto in absent mode is a real Waiting
verdict, just one this run cannot resolve, so it stops there rather than
looping on wake. A veto counts because section 5 says nothing routes a vetoed
draft to the agent, so its Waiting is as unanswerable as the floor's.

Revised 2026-09-19: new. This states what section 5's own Waiting rule does
in the one mode where nobody can end it, which the developer's stated reason
for the evaluator redesign, "The reason I wanted this design was to be able
to use Sudus in an autonomous benchmark," requires: a benchmark run cannot
sit at Waiting forever.

Revised 2026-09-22: previously only the floor or a veto exited 4. An
escalation the agent files after three failed attempts, a cycle bound or a
breach had no one to answer it either and left the run at an exit-0 Waiting
forever, which the purpose above rules out.

The kernel also prevents administrative cycling. It counts each completed
administrative action (`repair`, `recover`, `reconcile`, `scope`, `record`,
`commit`, `declare`, `review mechanism` or `capture`) in a local file below the
Git directory, keyed by action class and target and reset on semantic
progress. The count never travels, because a cycle belongs to one session's
loop; the escalation it produces is a log record and does. A fourth occurrence of the same action class and target, or a
twenty-eighth administrative transition of any class, without semantic progress
creates one Blocking cycle escalation and preserves every pending obligation.
The second bound is three occurrences of each of the nine administrative
classes: the same three-attempt rule the loop applies everywhere, summed over
the classes, so a cycle that rotates targets is caught as soon as one that
repeats them.
These constants are in the kernel, not settings. Revised 2026-09-25
(revision 16): the bound on acceptance rounds (revision 13) is gone with the
rounds themselves.

Before committing a kernel-managed mutation, the kernel evaluates the
post-state. If its specified bookkeeping alone would create a new Sudus
violation of equal or higher precedence, it refuses the mutation, names the
violation and its cause, and counts the refusal as one administrative
occurrence of that action class and target toward the cycle bounds above; the
bounds, not the refusal, write the cycle escalation. This is the liveness
invariant. Revised 2026-09-22: previously "it refuses the mutation and writes
the cycle escalation instead", so one pre-existing untracked file cost the
developer an answer per refusal while nothing had cycled; the developer ruled
"ok" on the change. A synthetic fixture
that repeats administrative actions without semantic progress is a required
regression test.

## 6. Hooks

Where a harness has a per-turn hook, it runs wake before every agent turn and
prints the verdict, action, reason and predicate. A skipped step is therefore in
front of the model. The stop hook prints the same line and is only the fallback
for a harness without a per-turn hook. The session-start hook prints the current
state and, in one line, any missing command link, PATH entry or durable ref; a
project on the former layout (section 2, Layouts) is missing nothing. It
writes nothing: `sudus brief` reads the harness from its environment when it
runs, or from `--harness <name>` naming a settings entry.

No hook refuses a stop, counts refusals, creates a record, edits a file, commits,
pushes, calls a model, or completes an action. The install skill makes the link
and registers hooks once. A harness without hooks relies on the working
agreement.

## 7. Requirements policy

- A requirement describes something a Sudus user can observe: a verdict,
  refusal, record or command output. Kernel internals are tests, not contract.
  The action predicates, precedence, Done rule and schemas replace most of the
  1.x loop requirements.
- A block holds its identifier, obligation, falsifier, mechanism, one optional
  rationale line and status. Git holds its history.
- A falsifier names a mechanism that could observe it before the requirement is
  Agreed. The mechanism counts only after review metadata names a fail receipt
  from the violating example: the check was seen to fail before it was trusted
  to pass.
- Agreement is per block, by direct developer confirmation or a deference
  decision quoting the developer. Promotion never Agrees text.
- A requirement must not restate a record encoding or an internal algorithm.
  Those are tested against the feature behavior and security invariants they
  support.

## 8. What each kept process does

### Freshness

A receipt is current only by the identities in section 2: input snapshot tree,
mechanism definition digest, frozen requirement text digest, observed declared
execution identity and readable schema. A kernel release does not itself stale
evidence. A changed command, working directory or results mode unbinds review
metadata; other definition changes stale receipts only. A mechanism reused for
a revised requirement in a later commitment needs `review mechanism` before its
evidence counts.

A `documents` path must also be an input and must not lie below a `source` root;
`sudus declare` refuses otherwise. Changes only to documents cost a check, not
a mechanism review. A receipt remains current when its ignored output file is
absent on a clone; the output digest lets Sudus report the absence.

### Scope and protected state

Scope uses the monotonic rule in section 5, not branch chronology. Valid
kernel-managed mutations are exempt only for the assigned command and exact
schema. Protected paths need developer authorization. `outside` cannot exempt
either class because the reservation is compiled into the kernel.

An active commitment's frozen contract does not change under it. If the
developer decides Agreed text or the working agreement must change, the current
commitment is finished or superseded and the change is made before the successor
start. When the Agreed text of a set requirement is revised anyway, wake names
`supersede`: receipts and mechanism reviews bind to the text as it reads, the
start record and the Done rule hold the frozen digest, and no review could
satisfy both. The agent restores the text, or supersedes on the developer's
ruling to a successor that freezes the revised text. Settings may change during a commitment only by a new authorization
naming the new digest, committed with the file; the new digest immediately invalidates any
evaluation policy or calibration that depended on the old one.

### Deferral and attempts

An item captured from the commitment's own requirement needs an outside record
or an escalation. A defect against that commitment's requirement is worked
under it and blocks Done; it is not deferred.

After three distinct failing attempts without a pass, a fourth implementation
attempt requires an escalation first. A fail receipt in which another
requirement of the same commitment also failed is not an attempt at this one
(added 2026-09-22: a requirement whose gate includes other requirements'
falsifiers cannot pass until they do). Attempts are counted from the open
commitment's start record; the fail receipts that bind mechanisms during the
spec phase precede it and are not attempts (revised 2026-09-22; previously
every fail receipt in the log counted). Attempts are keyed on product digest,
not input snapshot; a rerun at a seen product digest and a change only to
documents or outside paths are not new attempts. Captured output may be
truncated at a fixed byte cap; the truncation marker lives in the output
bytes themselves, not in a separate receipt field.

Attempts at a requirement are counted from its turn. The turn begins at the
first receipt, at or after the start record, after which every requirement
before it in the frozen set's order last passed. A requirement whose turn has
not begun has no attempts. When the turn begins after the start record, the
requirement's first receipt in the turn is its starting point, not an
attempt. A requirement outside the frozen set has no turn under the open
commitment, and so no attempts under it. The first requirement in order, and one whose earlier requirements
all passed before the start record, count from the start record as before.
(Added 2026-09-25, revision 15: wake works the set in order, and the refresh
runs it named for other requirements' changes, each failing on a violating
example still waiting its turn, counted as attempts; after three, wake named
`escalate` for a requirement no one had worked on. Issue #28.)

### Decisions and realization

Consequential decisions enter the ADR queue and the agent continues. Blocking
decisions are escalations and the developer's answer is the decision. A later
ADR supersession names one of four causes; supersession analytics are never
treated as evaluator labels.

Each Consequential decision names a base workspace snapshot. `build DECISION`
compares that base with the proposed realized workspace snapshot before it
accepts the realized line. A delta touching a `data` path, frozen Agreed text,
the working agreement, protected settings, or any other reserved path stops and
escalates regardless of the evaluation. Named paths in the draft do not limit
the comparison: every changed path in the actual delta is classified.

An interface hit does not automatically make the decision Blocking. The kernel
records it on the decision and on the realized delta; a changed interface
path is an interface obligation the adversary attempts in the report.

The realization check is a postcondition. A measurement only informs the
agent's own decision on a draft; neither the measurement nor the agent's
decision can authorize a privileged realization the code actually performs.

Revised 2026-09-19: previously "The evaluator judges a draft." Section 10 no
longer has the evaluator itself judge or decide anything; it measures, and
the agent decides. This sentence's guarantee is unchanged either way: no
route, high or low, waives the realization check below.

### Escalation

`sudus escalate` and `sudus decide --consequential` accept the same canonical
draft. Only a Consequential draft is measured; every other level uses the
kernel level directly. `sudus measure` (section 5) runs first, from `jev`
when `typesafeai.enabled` or otherwise the harness's review model (section
10); when neither source can be reached the draft is `unavailable <class>`
and routes to the developer like any other technical no-call. Otherwise the
agent reads the measurement, including its advisory `suggested: agent |
developer`, and decides, except at the narrow floor or a veto, or when the
agent itself chooses to escalate anyway; no other level is measured.

The agent runs `sudus answer`, `sudus decisions --read`, `sudus authorize`
and `sudus retire` only after the developer has answered in conversation,
and never asks the developer to run a command. With a signing key in force
their records must verify against it: the key in the settings the latest
verified init or authorization bound, never a key the settings file on disk
names since and never a key an unverified record names. In attested mode the
developer's quoted words, the harness name and the Git author are evidence
only; Sudus says so wherever it reports the decision. With `developer:
absent`, none of this paragraph's questions has anyone to answer it; section
5 states what the floor does instead. Revised 2026-09-21: previously "The
developer runs `sudus answer` and `sudus decisions --read`; the agent never
does", with a controlling-terminal confirmation as the unsigned evidence.
The developer ruled that nobody is ever asked to run a command; the answer
is given in conversation and the agent records it.

Revised 2026-09-19: previously "With evaluation disabled or outside its
envelope, the requested command uses the kernel level. In shadow mode the
developer still decides. In calibrated route mode section 10 may convert a
Consequential escalation into a queued agent decision or a capture." That
described the superseded design, where shadow was the default and only a
passing calibration let any draft reach the agent; the developer's benchmark
showed that gate never opened (0 of 12 agent-expected drafts routed to the
agent). The evaluator is no longer something a draft can fall "outside": it
always measures a Consequential draft, from one source or the other, and
"capture" is no longer an automatic evaluator outcome, only something the
agent may still choose to do with what the measurement told it.

### Capture and promotion

A backlog item is work the Agreed requirements already cover. After Done, the
agent may promote one backlog item by a Consequential decision. Promotion,
roadmap change and successor start form one recoverable transaction, and the
new roadmap section may name only Agreed requirements. A next-feature item waits
for the developer. Defect items are fixed before promotion.

A backlog item that other work already delivered is retired instead. The agent
escalates with the concern `retire:<item>`; the developer's ok retires the
item, wake no longer names its promotion, and `sudus promote` refuses it. An
instead answer leaves it in the backlog. When no commitment is open, after
Done or before a supersession's successor starts, the escalation names the
latest commitment. An ok on an escalation that names the item as
`item:<item>`, the capture gate's concern, does not retire it. Added
2026-09-24 (revision 14).

The developer may rank a new feature above the waiting backlog. After Done,
while no commitment is open, the agent escalates with one `wait:<item>`
concern per waiting item, naming the finished commitment. While a commitment
is open the concern is refused, since the wait would end at that commitment's
own Done. The developer's ok lets wake say Done while those items wait, so
the next feature can be specified and started. Each item stays in the
backlog: `sudus show items` marks it, the Done verdict lists it, and
`sudus promote` still accepts it. The wait ends at the next done record after
the ok: wake then names the item's promotion again. An instead answer leaves
the item first in line; an item captured after the ok is not covered by it.
Added 2026-09-25 (revision 15, issue #29).

The developer may also drop items in conversation. When they say to drop one
or more backlog or next-feature items, or confirm a spec change that answers a
next-feature item, the agent records their words once with `sudus retire
<item>... --quote "<their words>"`. The retirement record names every item
and carries the developer's evidence. A retired item is never promoted, wake
stops naming its promotion, and the next-feature pass no longer offers it. A
defect is fixed, not retired, and a promoted item is not retired. This is the
only way a next-feature item leaves the waiting list. Added 2026-09-26
(revision 17, issue #34).

A clone that did not start the open commitment captures into its own inbox
(section 4, Inbox). `sudus show items` lists an inbox item as not on the log,
and wake never promotes one. After Done, with no commitment open and no
supersession pending, wake names `fold`, and `sudus fold` appends each inbox
item this clone holds, its own and those it fetched, to the log as an
ordinary item record, so promotion, retirement and `wait:` work on it
unchanged. An inbox item whose slug the log already holds with the same kind,
source and body is already folded, and the same item in two inboxes folds
once. An item whose slug the log or an earlier inbox holds with a different
item stays in its inbox, is reported, and does not hold wake. Between
commitments, and under a start written before this revision, which names no
clone, every clone appends items to the log. Added 2026-09-26 (revision 18,
issue #35).

The agent captures a next-feature item only for a change the developer asked
for or one a real bug needs. An edge case or a ceremony step is not captured.
Added 2026-09-26 (revision 17).

Model-recommended capture is fallible. Sudus does not claim a passing mechanism
proves a captured change unnecessary. The item remains visible, the frozen
requirements remain binding, and the adversary can challenge the omission.

### Review and evidence

The builder answers the fixed questions and lists findings. The adversary
attacks the work by reading and lists its own findings. The builder resolves
or declines each finding, and the checks judge every change after the report.
Receipts live on the log; ignored output lives in
`.sudus/output/` and is addressed by digest.

## 9. Self-evaluation and one adversarial review

The loop takes the builder's word at three points: that a falsifier is
observable, that a mechanism failed for the right reason, and that a change
makes its falsifier unreachable. The builder records claims at each point; one
adversary attacks the work right before Done.

### Builder claims

Each question is answered `observed` with a command, path or output, or
`not-checked`. The kernel checks coverage and shape, not truth.

- Q1, per mechanism: which violating example failed the check, which fail
  receipt records it, and what the check printed.
- Q2, per mechanism: why that failure was the stated violation rather than a
  setup error.
- Q3, per implemented requirement: why its falsifier is now unreachable.
- Q4, per implemented requirement: what else the change touched that no check
  covers.
- Q5, per commitment: what could still be wrong while every check passes.
- Q6, per commitment: what was not tested.

### Brief

When the review exists, wake names `report SLUG`. `sudus brief <slug>` writes a
brief record and the brief file. The brief opens with the adversary's role in
the developer's words of 2026-09-25, quoted as written except for two spelling
fixes, and the rules that bind it (Adversary work). It then renders the
roadmap section, frozen requirements and falsifiers, mechanism definitions,
the receipts, builder claims and findings, the agent's decisions, interface
obligations, changed paths and the paths not to read. It ends with the report
the adversary writes: its fields and every required pair as the report spells
it, so the adversary's file reaches `sudus report` unchanged. Settings'
`adversary_rules`, when present, appear under Host rules.
Revised 2026-09-24 (issue #13): previously the brief named none of these. The changed paths and the
interface obligations run from the commitment's start snapshot to the reviewed
snapshot. A successor started after a supersede carries the superseded
commitment's work, so for it both run from the first start of its
supersession chain; `sudus report` and wake's report predicate measure the
interface attempts from the same start.

The receipts are, per requirement, the receipt current at the reviewed
snapshot, the one wake decides with, and the fail receipt its mechanism review
binds, so the adversary knows what already ran. A newer receipt that is not
current, such as a violating example checked after the fix and then restored,
is listed as not current. The agent's decisions are the decision lines the agent added to
`docs/decisions.jsonl` between the start of the supersession chain and the
reviewed snapshot, and the backlog and next-feature items it captured in that
range, with any outside reason. A developer's decision line is a ruling and is
not listed. The brief record names each listed decision, and each is a
required pair. A decision the agent never recorded is the adversary's to find
in the code.

The paths not to read are the tracked files under `network_exclude` or a
built-in credential pattern (section 2), and the patterns themselves. Sudus
places none of their bytes in the brief. The adversary runs in the builder's
own harness and reads the project the builder reads, so it sends nothing to a
model provider the builder does not already use; the list is an instruction,
not a confinement.

Revised 2026-09-25 (revision 16): previously `sudus brief` materialized an
adversary projection, a Git-less copy of the reviewed snapshot without the
excluded paths, for a remote adversary, and the brief invited experiments in
a throwaway repository inside it.

### Adversary work

The agent starts one fresh subagent in its own harness, with none of the
builder's conversation and the brief file as its entire prompt, and waits.
The adversary reads only: it builds nothing, runs no tests or project code,
and starts no subagents. It keeps its scratchpad and its report file outside
the repository. It reads the whole specification, with its glossary and
roadmap, and `docs/decisions.jsonl` before it judges, and it judges the
commitment as part of the whole system. It treats every claim in the
builder's account as something to disprove.

It attempts by reading, through five lenses: the falsifier (one attempt per
requirement), the decisions (one per listed decision), and security, logic,
and complexity and spec adherence (one each per commitment), plus one attempt
per changed interface path. Each attempt says what it looked for, what it
found, and whether the work held. Each finding names where it is, what is
wrong and why, quoting the requirement or decision it contradicts, and has a
severity: Critical (a requirement is unmet, the falsifier is reachable, or a
security exposure ships), Major (an uncovered defect in a touched path, or a
decision that was the developer's) or Minor (an edge the commitment did not
promise, or complexity the next commitment pays for). A remedy is one line
and optional. When the adversary finds a defect in Sudus itself, it stops and
reports only that bug.

`sudus report` refuses a report whose brief is stale, was written by Sudus 3,
or already has a report; one with fields the shape does not name; one that
leaves a required pair or interface unattempted; and one taken once the
workspace differs from the reviewed snapshot. A report that stopped on a
Sudus bug carries no attempts or findings and does not complete the review:
wake names `report` again and quotes the bug, the builder decides what to do
with it, and the review goes on through a new brief. That is the one case in
which the adversary runs twice for a commitment.

Revised 2026-09-25 (revision 16, the developer's rulings): previously a fresh
adversary attempted Q1 to Q6 inside the projection, tried to make each
mechanism pass without the behavior by building and running it, and its
model, transport and session were checked against the brief. The developer:
"The adversery should be read only code review and agent decision review";
"the reviewer should run once right before Done unless there is a Sudus bug
reported and the step rquires repeating"; "it needs access to the
specification to attack the falsifier". The builder's own claims (Q1 to Q6)
are unchanged.

### After the report

Every finding on the review or the report is the builder's to decide. It
fixes the finding and records a resolution at a new workspace snapshot, or it
declines the finding with its reason. When a fix changes after its
resolution, the builder records a resolution again: the latest is the
finding's resolution, and the review report names the earlier ones it
supersedes. A resolution is recorded only while the commitment is open. A
finding of any severity may be
declined, and no verdict waits on the adversary or the developer for either:
the builder is the decision maker, and Sudus judges through its checks. The
fixes make receipts stale, and the run predicate (section 5) names them once
the last finding is settled. An escalation may still name a finding when the
builder chooses to ask; the developer's `ok` closes it. `sudus done` prints
the review report: every finding, its severity and where it is, and what the
builder did with it. The developer reads it before the next feature or
commitment.

Revised 2026-09-25 (revision 16): previously each fix went back to the
adversary in acceptance rounds over the cumulative delta, a resolution
rejected twice escalated, and three rounds without Done escalated (revision
13). The developer: "Declining a Critical needs your ok <-- this is giving the
reviewer the power to stop the builder. We are not doing that. Just as with
the evaluator. The builder is the decision maker and Sudus will judge", and
"Not every commit". A log written before revision 16 still reads: a 3.x
report completes the review, a 3.x acceptance's findings count, and a
resolution one rejected leaves its finding open.

Added 2026-10-10 (revision 19, issue #66, on the developer's ok): previously
a resolved finding refused another resolution, so a fix revised after its
resolution kept the first explanation in the review report.

### Model identity and limits of proof

`sudus brief` detects the harness adapter from its environment or
`--harness`. When settings name an adversary model for that harness, the start
line names it; otherwise the harness's default subagent model runs, printed as
`model: any`. `sudus brief` passes the model string through; it never maps
aliases.

The kernel cannot prove that the adversary read what the brief names, ran
nothing, or has different blind spots from the builder, or that a human did
not relay extra context. The report's shape, the unchanged workspace, the
brief digest and the reasons the builder gave for each decline are the
available evidence.

The cost is one adversary per commitment. A mechanism that passes without the
behavior may survive until Done; the fail-receipt rule, Q1 output and the
falsifier lens reduce, but do not remove, that gap.

## 10. The evaluator: a composite measurement at Consequential

At a Consequential decision the agent drafts its choice. The evaluator is a
measurement the agent takes of that draft to check its own judgment before it
decides. It is not a second decision-maker, an advisor the agent must obey, or
a review queue: the agent still decides, informed by the measurement, except
at the narrow floor below, when a veto fires, or when the agent itself chooses
to escalate after reading the measurement (section 5). Code owns every
authority boundary in both measurement paths this section defines below.

Revised 2026-09-19: this section previously ran up to two model calls per
draft, an option-gate Noul cascade and then a separate owner Choice call, and
defaulted to shadow mode, where authority never left the developer even when
every gate passed. `.superpowers/bench/results.md` ran that design live: 0 of
12 agent-expected drafts reached the agent, because the `sufficient` gate
alone rejected every one; the developer called this ritual assent and said
the evaluator's point was "to give the coding model a gut check or additional
evaluation capability to be able to measure the decision." This revision
replaces the gate cascade with the composite scoring in
`.superpowers/bench/composite-design.md` (0.895 route accuracy in the same
benchmark), makes the agent's own judgment, checked by the measurement, the
decision by default, and adds a second measurement source so the design still
works with `typesafeai.enabled: false`, which is what the developer wants
"to be able to use Sudus in an autonomous benchmark."

### The narrow floor

Before any call, code checks a floor that needs no model judgment: a draft
whose recommended option would change an Agreed requirement's text or its
falsifier, would change the working agreement, or touches data that cannot be
regenerated routes to the developer without a call. Reserved and
protected-path writes, the fourth-attempt rule and scope rulings are
unaffected: they are already enforced by section 2 and section 5 independent
of this floor, so narrowing the floor to these three does not relax them.

A draft code cannot build a request for also gets no call: a missing
recommendation, an incomplete authority projection, a request over
`request_cap_bytes`, a failed call, or an invalid answer route to the
developer as `unavailable <class>`.

### Score dimensions and the composite

One request per draft answers all five Score questions below, each naming a
concrete state field. `evidence` and `ambiguity` read the whole draft;
`reach`, `contract` and `surface` read only the recommended option,
`draft.options[draft.recommendation]`.

| Dimension | State field | Levels 0-4 |
|---|---|---|
| evidence | `draft.because` | 0 none; 1 a claim; 2 names a command or file; 3 quotes output or a diff; 4 quotes output and names the test that fails and the falsifier it maps to |
| reach | recommended `draft.options[n]` | 0 wording or message text; 1 internal structure, nothing visible; 2 behavior inside an agreed requirement; 3 output or flags existing callers depend on; 4 data that cannot be regenerated, a migration, or a rewrite of user files |
| contract | recommended `draft.options[n]` | 0 implements the cited requirement as written; 1 chooses between readings the text allows; 2 adds behavior no requirement names; 3 conflicts with a cited decision; 4 changes a requirement's text or falsifier |
| surface | recommended `draft.options[n]` | 0 no new surface; 1 a new file or module; 2 a new flag or output; 3 a new dependency; 4 a network call, credential, or external service |
| ambiguity | `draft.question` | 0 one reading, the draft names it; 1 two readings, the draft picks one with a reason; 2 two readings, no reason; 3 the question asks the developer to choose a policy; 4 the question cannot be answered without facts the draft lacks |

Code, not the model, computes what happens next from the five levels and
confidences:

- Veto: `reach >= 4`, `contract >= 3` or `surface >= 3` on the recommended
  option forces the developer regardless of weights; the three are checked
  in that order and the measurement records which one decided it. The floor
  above is code-certain and needs no call; the veto is what the model
  itself flags after scoring, so the two catch different risks and neither
  substitutes for the other.
- Otherwise, composite is the weighted mean of the five levels over 4, with
  evidence counted as `(4 - level)` so more evidence lowers the composite:
  `composite = sum(weight_d * level_d / 4)` over evidence, reach, contract,
  surface and ambiguity.
- The composite feeds one suggestion, `suggested: agent | developer`:
  `agent` when `composite <= agent_ceiling` and every dimension's
  confidence meets its `confidence_floors` entry, `developer` otherwise.
  The suggestion is advisory, not a route: only the floor above and a veto
  force the developer. In every other case the agent decides, informed by
  the suggestion and the five raw levels beside it, and the agent may still
  escalate toward the developer at its own judgment after reading the
  measurement, whatever the suggestion says.
- `weights`, `agent_ceiling` and `confidence_floors` live in
  `typesafeai` settings and in the policy digest (section 2); a change to
  any of them resets calibration.
- The decision record names the measurement and the agent's own decision
  beside the suggestion it read, so an autonomous run is scored on where
  the two agree or disagree.
- The five raw levels, their confidences and the suggestion are the
  evaluator assistance the agent sees; none of them is a verdict, which is
  decision 51's original transparency intent carried into the composite it
  once excluded.

### Two sources

The measurement comes from one of two sources, chosen by settings, both
answering the same five dimensions in the same shape:

- `jev`: when `typesafeai.enabled`, `bin/typesafeai.mjs` is the one file that
  sends the request. It reads `TYPESAFEAI_API_KEY` from the environment and
  never stores it. It retries a `408`, `429` or `5xx` response up to two
  extra attempts, with exponential backoff from a 500ms base capped at 5s
  and 25% jitter, honoring a `Retry-After` response header capped at 60s;
  every request carries a default timeout, classified as its own failure
  class distinct from a network failure. A request that exhausts its
  retries or times out is one failed call, `unavailable <class>`, never a
  silent retry past that bound.
- `review`: otherwise, the agent starts the harness's configured review
  model, the adversary model named in `settings.harness` for the running
  harness, through the harness, with none of the agent's own conversation
  context, answering the same five dimensions in the same shape as `jev`
  would. The launch instruction, with its model and transport, and the
  resolved model are recorded on the evaluation records. When no harness can be detected, the draft is
  `unavailable <class>` and routes to the developer like any other
  technical no-call.

State sent to either source carries no policy prose: every question in the
table above names one concrete field, never a paraphrase of a setting or an
explanation of what a route means.

### State sent to the model

The draft is unchanged: `D := <commitment, concerns, question,
recommendation, because, if_wrong, instead, options, named_paths,
cited_decisions>`. The measurement state is `M(D) := <D's five narrative
fields, every option's text with the recommended option and its code, C(c),
A(D)>`, where `C(c)` is the start keystone, commitment and glossary, frozen
requirements (past a request limit, only those the concerns name keep their
text; see Limits and failure), and developer-written cited decisions
(`by: developer`), and
`A(D)` is the closed JSON authority projection of validated IDs, enums,
booleans and counts the old owner call used. Beyond `D`, `C(c)` and `A(D)`,
no agent prose, code, paths, outputs, findings or agent-authored ADR bodies
reach either source: a cited decision the agent wrote reaches the call only
as an id and a read flag in `A(D)`, whether or not the developer has read
it. The five narrative fields are untrusted; the floor and veto run on code-
known facts and on the model's own dimension answers, never on prose the
model was asked to trust. If `A(D)` is incomplete, no call occurs (the
narrow floor's technical case above).

Revised 2026-09-20: previously the recommended option only. The committed
live run through `sudus measure` (tests/bench/results.md) showed the losing
options' text is what lets the model separate reach, contract and surface
(22/24 against 16/24 before the change; an isolated in-tree experiment
measuring this change alone scored 21/24), and the options are part of `D`,
so no new class of input reaches the model.

The recommended option's code is the snapshot's action-lease diff and
complete touched files in path order; reads do not follow symlinks. The
input identity is `(workspace tree, log head, ADR digest, draft digest,
settings digest)`, anchored by a workspace snapshot. Equal identity and
policy digest must yield byte-identical requests to either source; answers
may differ.

### Limits and failure

`jev-1.13.0` permits 64k request tokens and 32k for state plus the longest
question; the kernel enforces `request_cap_bytes`, estimates three bytes per
token, and refuses above 75% of either limit before sending. A request over
either limit is built once more with the text of only the frozen requirements
the draft's concerns name; the others keep their identifier and text digest.
When that request fits, it is sent, and the measurement's reason says so;
when it does not, the draft is `unavailable oversize`. A request that fits
is never trimmed. Added 2026-10-13 (revision 20, issue #69, on the
developer's ok): previously a request over a limit was refused at once. The
review
source's request is the harness's own message; the no-policy-prose and
named-field rules above still bind it, and Sudus does not separately cap its
size beyond the state it sends.

Requests omit `network_exclude`, credential and host bytes, keys and command
output regardless of source. A would-be inclusion is not sent; only
`unavailable excluded` and its path class are recorded.

Every measured draft gets an intent before any call; the intent precedes
network I/O and fixes request digests, so a crash can be recovered (section
4). Each attempted call records its digest, resolved model, raw outcome,
parsed answer and usage before routing. An unknown crash outcome becomes
`indeterminate`, is not retried, and routes to the developer.

### Record and calibration

The final measurement names its intent and call, the five dimension levels
and confidences, the computed composite, which veto if any fired, the
suggestion and the reason. The resulting record points back to both.

There is one operating mode, not a live/shadow choice: the agent always
decides, informed by the measurement, except when the floor or a veto forces
the developer; the measurement record is what makes an autonomous run
scoreable afterward. The developer labels a recorded measurement's outcome
`agent`, `developer` or `unknown`; only the first two calibrate. Calibration
data comes from live records alone: the measurement's suggestion, the
agent's own decision, and the developer's later label when one exists.
`developer: absent` does not change any of this; it only removes the
developer as a destination once the floor or a veto names one (section 5).

The policy digest covers model, schemas, questions, request construction,
the narrow floor, the veto rule, `weights`, `agent_ceiling`,
`confidence_floors`, caps and egress; a change to any of them resets
calibration. `sudus calibrate` uses matching valid measurements labelled by
the developer. Its denominator is labelled cases whose suggestion was
`agent`; a false downgrade is one the developer labelled `developer`. The
one-sided 95% exact binomial upper bound on the false-downgrade rate is a
kernel constant, not a setting, fixed at 5%; the sample floor is
`min_calibration_agent_predictions` (default 60) predicted-agent cases.
Calibration tunes `weights`, `agent_ceiling` and `confidence_floors`; it does
not gate whether the agent may decide, because gating live routing behind a
calibration pass is what produced zero agent routing under the superseded
design. Supersessions are not labels.

Revised 2026-09-19: previously "Unread Consequential decisions at Done
disable the evaluator next commitment until read, routing every draft to the
developer without editing settings." Removed: there is no off switch in this
design and nothing routes; section 5's Done rule already holds an unread
Consequential decision for the developer before the next commitment can
open, so the evaluator needs no second lock.

### Falsifiers

The contract is falsified by: a missing measurement, prior intent or call
record for a measured draft; untrusted state reaching either source; policy
prose, rather than a named state field, reaching a question; nondeterministic
requests at equal identity and policy digest; an `agent` suggestion or a
`developer` suggestion treated as anything but advisory; an agent decision
on a draft the narrow floor should have caught; an agent decision on a draft
carrying a veto; a composite computed anywhere but code, from anything but
the recorded dimension levels; a retried or invented ambiguous result; Sudus
egress of excluded bytes to either source; an accepted protected
realization; or a calibration record whose denominator is not cases whose
suggestion was `agent`.

## 11. Distribution

Sudus ships as one plugin: the command, hooks, five skills (`install-sudus`,
`new-project`, `existing-project`, `next-feature`, `report-sudus-issue`) and
the optional evaluator module. `report-sudus-issue` is for a defect in Sudus
itself: the agent posts an issue or a comment on eas4ai/sudus only after the
developer's `ok`, since it is public and posted under the developer's
account, and keeps the project's code, records and secrets out of it and out
of the searches it sends. The command also answers to its former name, `cairn`, so a shim, hook
or working agreement written before 3.0.0 still runs. Claude Code, Codex and Muse manifests share one version. The skills also
install through the skills CLI. The runtime is Node and Git, with no build,
package dependency or service. Linux and macOS are supported.

The evaluator is opt-in and makes zero, one or two POSTs per admitted draft from
one file. The adversary is a subagent of the current harness that reads the
project and runs nothing. Two durable refs and the clones' inboxes travel to
one confirmed authority remote; the action lease, transaction staging and
cycle counter remain local.

How this repository develops and releases Sudus, including its attribution
check and source-size norms, belongs in its own roadmap rather than this product
specification.

## 12. Removed from 1.x

- The record directories `.cairn/evidence`, `.cairn/reviews`,
  `.cairn/escalations`, `.cairn/backlog`, `.cairn/next-iteration`,
  `.cairn/stops`, `.cairn/queue`, `docs/decisions/`, `docs/commitments/` and
  `docs/audit`. Records are a log ref plus one ADR JSONL file.
- The autonomy and former Jev modes that were Agreed but never built.
- Stop-hook refusal, refusal counts, stop records and `explain`.
- The `Escalate` verdict and `present` action. Waiting prints the recorded fields
  without an agent paraphrase.
- Markdown record parsing, findings sweeps and record formatting rules.
- Copying report findings into a review by number. A resolution references the
  exact source record and finding number.
- A second full report after fixes. The builder resolves or declines each
  finding and the checks judge the fixes (revision 16; before it, cumulative
  acceptance rounds).
- `Revised <date>` history paragraphs inside requirement blocks. Git is history.
- Agreement by promotion. Promotion never Agrees text.
- Decision files at Judged and reversals as an authority label.
- The `reword` action. Attribution is checked at release.
- Kernel release digests as receipt freshness inputs. Schema and declared
  execution identity replace them.
- Command output in Git.
- Naked tree OIDs as durable code references. Typed snapshot commits replace
  them.
- Commit SHAs of the working branch as evidence identity. The branch remains
  rewriteable.
- The shared in-progress/check-lock slot. The action lease and check lock are
  separate.
- Terminal output such as "queue printed" as a completion condition.
- Free-form Git trailers as an authority-bearing serialization.
- The evaluator's composite score, weights and configurable code tiers.
- Product requirements for this repository's release process, attribution
  policy or kernel line ceiling.
- Requirements that expose a kernel internal instead of observable behavior.
  Their identifier-by-identifier cut list is produced with the v2 requirements.

## 13. Decisions in this draft the developer may reverse

1. A defect against the current commitment's requirement is worked, not
   captured.
2. Hooks prompt and never block or write.
3. The kernel has two decision levels; guidance may describe four.
4. `next-iteration` is renamed `next-feature`, including its item kind and flag.
5. Cairn 1.x records are not read; migration happens at a v2 Done.
6. Command output is ignored local data; a receipt can be current without it.
7. This repository develops v2 on its v2 branch and archives 1.x at cutover.
8. One adversarial report per commitment, plus bounded cumulative acceptance;
   there is no per-spec, per-mechanism or per-commit report. (Superseded by
   57.)
9. Promotion never Agrees text and promotes one backlog item at a time.
10. Verdicts are Resolvable, Waiting and Done; Waiting alone is the developer's
    turn.
11. The developer answers in conversation and the agent records the answer
    with `sudus answer`, `sudus decisions --read`, `sudus authorize` and
    `sudus retire`; a quoted answer with the harness and Git author is evidence, not
    authentication.
12. Global install makes the command link and hooks. Project initialization,
    not install, configures a repository.
13. The spec-phase self-review is performed but not recorded.
14. Non-decision records are commits on `refs/sudus/log`; decisions are
    canonical lines in `docs/decisions.jsonl`.
15. Code references are typed commits on `refs/sudus/snapshots`; the working
    branch may be rebased, squashed or amended.
16. The report is written once; resolutions and acceptances cover the cumulative
    post-report delta. (Superseded by 57.)
17. `docs/commitments/` is gone; a roadmap section and start/close records define
    a commitment.
18. The optional Jev evaluator applies only at Consequential and may make an
    option-gate call and a separate owner call. (Superseded by 53.)
19. `.sudus/settings.json` is the only settings file; the TypeSafe key is
    `TYPESAFEAI_API_KEY` in the environment.
20. The adversary model and transport are selected per harness and recorded.
    (Superseded by 58.)
21. Backlog items do not block Done; the next wake promotes at most one.
22. Wake is read-only. Start, done and other commands write state.
23. `sudus escalate` writes the evaluation route it selected; evaluation is its
    own intent/call/result chain.
24. Reading the queue is a developer-authenticated act.
25. The working agreement is protected and changes between commitments or after
    supersession.
26. Deterministic code establishes the evaluator envelope before model judgment;
    every gate fails closed. (Superseded by 54.)
27. Shadow is the evaluator default and route mode requires project-specific,
    policy-matched calibration. (Superseded by 55.)
28. Snapshot commits, not trailer text, keep code trees reachable.
29. The local action lease and check lock are separate and use compare-and-swap.
30. Reserved paths are kernel constants, not settings-derived exemptions.
31. A later declaration never legalizes an earlier observed scope breach.
32. A commitment may close by a superseded record with explicit carry-over.
33. Acceptance examines the whole cumulative delta and may create findings.
    (Superseded by 57.)
34. Realization checks the actual delta against protected categories.
35. Start freezes requirement-set membership and text digests.
36. Mechanism review binds to the detection digest: command, working
    directory and results mode (revision 10; before it, the exact definition
    digest).
37. Execution identity contains only declared, non-secret values; undeclared
    external state weakens freshness.
38. One authority remote is developer-confirmed; pushes are atomic when
    supported and safely ordered otherwise.
39. `network_exclude` bounds Sudus's model egress, not all network activity.
40. Developer-owned protected paths and kernel-managed mutable paths are
    different authority classes.
41. A superseded record names a transition and successor slug; the later start
    points backward to it, avoiding a future-SHA dependency.
42. Calibration is a first-class record bound to an evaluation-policy digest and
    uses a one-sided confidence bound over predicted-agent cases.
43. A remote adversary receives a Git-less, excluded-path projection; the
    report records whether the harness isolated it. (Superseded by 58.)
44. First-observed undeclared work is a log fact, so branch rewriting cannot
    erase it.
45. Evaluator intent precedes network I/O; calls are recorded separately and an
    ambiguous lost response fails closed without retry.
46. Authority-bearing records are canonical JSON in the commit body with a
    digest trailer; arbitrary strings never become trailers.
47. Input and workspace snapshots are distinct kinds and record schemas accept
    only the kind they need.
48. `sudus init` establishes settings, developer-auth mode and remote before a
    project enters the shared spec tail.
49. An active commitment's frozen contract is not amended; a contract change
    requires finish or supersession.
50. Administrative recurrence and acceptance rounds have fixed escalation
    bounds counted locally, and valid Sudus bookkeeping may not generate its
    own violation. (The acceptance-round bound is superseded by 57.)
51. Composite option scores, weights and code tiers are absent; raw gate answers
    are the only evaluator assistance shown. (Superseded by 56.)
52. Only log and snapshots refs travel; the action lease remains local and
    cross-clone conflicts stop at leased push.
53. The evaluator measures every Consequential draft, from Jev when
    `typesafeai.enabled` or the harness's review model otherwise, in one
    composite-scored call, not an option-gate call and a separate owner
    call. Supersedes 18. The developer's reason: "the point was to give the
    coding model a gut check or additional evaluation capability to be able
    to measure the decision."
54. Code still establishes a floor and a veto that fail closed before any
    model judgment, but between them the agent applies one composite
    measurement itself; no gate cascade decides by elimination anymore.
    Supersedes 26. The developer's reason: "the goddamn evaluator was to
    reduce ritual assent."
55. Live composite measurement, not shadow, is the only mode; there is no
    `typesafeai.mode` setting, since the composite never withholds or
    grants authority for a setting to gate, and calibration data comes
    from those same live records, not a separate observation mode.
    Supersedes 27. The developer's reason: "the goddamn evaluator was to
    reduce ritual assent," and the recorded benchmark showed a shadow
    default plus a calibration-gated route mode produced zero agent
    routing at the shipped gates.
56. Composite option scores and weights are back, scored across five
    dimensions with a computed ceiling and confidence floors, because the
    raw-gate-answers-only design in 51 never let a draft reach the agent;
    `code_tiers` stays absent. The composite is advisory, not a router: it
    yields a `suggested: agent | developer` shown beside the five raw
    levels, only the floor and a veto force the developer, and the agent
    decides in every other case. Supersedes 51. The developer's reason:
    "The reason I wanted this design was to be able to use Sudus in an
    autonomous benchmark."
57. One adversarial report per commitment, right before Done; a second only
    after a report that stopped on a Sudus bug. The builder resolves or
    declines each finding, a decline carries its reason, no finding of any
    severity waits on the adversary or the developer, and the checks judge
    the change after the report. `sudus done` prints the review report.
    Supersedes 8, 16, 33 and the acceptance-round bound in 50. The
    developer's reason: "The builder is the decision maker and Sudus will
    judge."
58. The adversary is one fresh, read-only subagent in the builder's harness,
    with none of the builder's conversation and no subagents of its own. It
    reads the project and the whole specification, runs nothing, and attacks
    through five lenses: the falsifier, the decisions, security, logic, and
    complexity and spec adherence. Settings may name its model. Supersedes
    20 and 43. The developer's reason: "The adversery should be read only
    code review and agent decision review."

## 14. Next steps

1. The developer reviews this revision by invariant: authority, path ownership,
   record canonicality, evidence identity, snapshot kind, scope monotonicity,
   commitment exclusivity, adversary coverage, crash recovery, egress and
   liveness.
2. The requirements are derived from this document, each with a falsifier and
   observing mechanism, alongside the 1.x cut list.
3. The record commands and kernel are implemented against those requirements on
   the v2 branch.
4. A synthetic fixture that repeats administrative actions without semantic
   progress must trigger the cycle escalation no later than the twenty-eighth
   administrative transition, and a same-target fixture no later than the
   fourth occurrence.
5. At the first v2 Done, the 1.x line is archived and v2 becomes main.
