![Sudus - Keep agent work tied to what you agreed to build.](../assets/cover.png)

# Using Sudus: a human manual

You do not need to learn Sudus's record formats before you can use it. Your
job is to explain what you want, confirm that the written agreement means
what you think it means, and make the decisions that belong to you. The
agent can handle the files, the records, and the commands.

This manual explains what to expect at each stage, and gives the exact
command for when you want to act directly. Examples using `APP-001` or
`reject-empty-names` are illustrative: substitute the identifier or slug
Sudus actually prints. Run project commands from your project's repository
root.

Inside a repository every command runs at the top level whatever directory
you are in: the paths it prints and takes are repository-relative, except a
`--file` or `--signing-key` path, which is read from where you typed it.
Run `sudus --help` for the full list of commands. It works outside a
project and changes nothing.

Start with the [README](../README.md) for installation and an overview.
For a complete exercise you can run yourself, use the
[worked example](walkthrough.md). This manual is also the complete
reference: every command Sudus ships and every kind of record it writes
are listed near the end.

## Contents

- [Start with a clear goal](#start-with-a-clear-goal)
- [Agree on behavior you can recognize](#agree-on-behavior-you-can-recognize)
- [Let the agent work, and know when it needs you](#let-the-agent-work-and-know-when-it-needs-you)
- [The action lease](#the-action-lease)
- [Answer a decision without guessing](#answer-a-decision-without-guessing)
- [Decisions that did not stop the work](#decisions-that-did-not-stop-the-work)
- [Understand checks and their results](#understand-checks-and-their-results)
- [Review, the adversary, and Done](#review-the-adversary-and-done)
- [Scope: work Sudus did not expect](#scope-work-sudus-did-not-expect)
- [The evaluator: the agent's gut check](#the-evaluator-the-agents-gut-check)
- [Settings](#settings)
- [Turn on the TypeSafe evaluator](#turn-on-the-typesafe-evaluator)
- [Sending the records with the code](#sending-the-records-with-the-code)
- [Moving a project from Cairn](#moving-a-project-from-cairn)
- [Get unstuck](#get-unstuck)
- [Command reference](#command-reference)
- [Record reference](#record-reference)
- [Installation details](#installation-details)
- [Where these explanations come from](#where-these-explanations-come-from)

## Start with a clear goal

Describe an outcome, not a list of implementation steps. For example:

> People keep losing unfinished drafts when they close the app. I want them
> to be able to reopen a draft and continue writing.

For a new project, open the `new-project` skill by name. For existing
software, open `existing-project`. For a project already under Sudus whose
loop reports Done, open `next-feature`, which starts from the agreed
specification instead of reading the whole codebase again. The
existing-project skill instructs the agent to inspect the code first and
cite what it finds, in `docs/recon.md`. A description of what the code
currently does is marked **Observed**. It becomes an agreement about what
the code should do only after you confirm it.

Each of these skills runs `sudus init` the first time your project needs
it. Before that the agent asks you one thing in conversation: whether
Sudus's durable records should travel to a Git remote (naming one, or
explicit local-only operation). You answer once per project, not once per
commitment, and you never type a command. Your decisions are recorded as
attested, in your own words; a signing key is optional and set in the
settings file (see Attested or signed below).

Expect the agent to propose the first **commitment**: one selected piece of
work with a defined result. A commitment is not a Git commit or a promise
about how long the work will take. It names what belongs in the current
task, and at most one commitment is open at a time. You can ask:

> Explain what this commitment includes, what it leaves out, and what I
> will be able to do when it is finished.

The agent records ideas outside that task as items. An item already covered
by the agreed specification is a backlog item; at Done the agent may
promote one by a recorded decision that waits for your review. An item that
would change the agreement is a next-feature item, and waits for you to
open the next feature specification. A defect against the current
commitment's own requirement is neither: it is worked now, because the
agreement already forbids it. When other work already delivered a backlog
item, the agent asks you to retire it instead of promoting it; your `ok`
takes it out of the backlog. When you drop an item in conversation, backlog
or next-feature, or confirm a spec change that answers a next-feature item,
the agent records your words once with `sudus retire`, and the item is not
offered again. The agent captures a next-feature item only for a change you
asked for or one a real bug needs, never for an edge case or ceremony.

This is the new-project skill: from an empty directory to an Agreed first
commitment.

```mermaid
flowchart TB
  start(["Start: /new-project"])
  exists{"Source code or docs/spec/overview.md exists? README, license and Git do not count"}
  switch(["Switch to /existing-project"])
  init["Initialize Git if needed. Ask the developer: authority remote or local-only. sudus init with the answer as flags"]
  ask["One open question: what is the software for?"]
  restate["Gate 1: restate in own words, developer corrects"]
  keystone["Write docs/spec/overview.md: what it is, its problem, what it is not, spec map"]
  glossary["Gate 2: glossary, 5 to 15 terms as one set, developer corrects by exception"]
  partition["Gate 3: derive domains from the keystone, developer confirms the partition"]
  draft["Draft each domain's requirements: one actor-named obligation, Falsifier, Status: Draft"]
  more{"More domains?"}
  roadmap["Roadmap with Current: naming the first commitment"]
  tail[["Gate 4: spec-phase.dot, falsifiers, self-review, lint, confirmation, commitment, mechanisms, agreement, start, wake"]]

  start --> exists
  exists -->|"yes"| switch
  exists -->|"no"| init
  init --> ask
  ask --> restate
  restate --> keystone
  keystone --> glossary
  glossary --> partition
  partition --> draft
  draft --> more
  more -->|"yes"| draft
  more -->|"no"| roadmap
  roadmap --> tail
```

The Graphviz source is docs/diagrams/new-project.dot.

This is the existing-project skill: from an unspecified or drifted
codebase, or a pending supersession, to one prepared commitment.

```mermaid
flowchart TB
  start(["Start: /existing-project"])
  state{"Sudus state?"}
  tonext(["Done: switch to /next-feature, this work is a later commitment"])
  fits{"Request belongs to the open commitment?"}
  continue(["Return to the work loop"])
  midway{"Commitment open: developer chooses"}
  finish(["Finish current commitment, capture request as an item"])
  supersede["sudus supersede SUCCESSOR: close old range with decision, transition id and slug, carry open obligations, do not name a future start or move Current:"]
  pending["Pending successor: resume the transition, the later start points back to the superseded record"]
  legacy{"Cairn 1.x records present?"}
  migrate["Migrate: tell the developer, on ok remove the 1.x record directories (history keeps them), convert the spec in place until sudus lint docs/spec is clean, changing no requirement words, keep 1.x mechanism commands in docs/recon.md"]
  init["Ask the developer: authority remote or local-only. sudus init with the answer as flags"]
  carry["Carry: one sudus item per 1.x item file, remove the item directories"]
  hasspec{"docs/spec/overview.md exists?"}
  readspec["Path B: read glossary, keystone, domains, roadmap, decisions and items first"]
  recon["Recon before questions: manifests, entry points, data, tests, CI, scripts, non-spec docs and recent history"]
  report["docs/recon.md, every row cited: Exists / Documented / Contradicted / Unverified, carry unresolved earlier findings"]
  corrects["Present, developer corrects the reading"]
  ask["One open question: feature to add or defect to fix?"]
  radius["Trace and cite blast radius: modules, tests and spec sections"]
  pathA["Path A: glossary from code identifiers, Observed specs in radius, map rows outside"]
  pathB["Path B: verify every spec section in radius"]
  verdict{"Holds / Drifted / Still Observed / Missing"}
  drift["Raise both sides with citations, developer rules"]
  rule{"Which side is wrong?"}
  specwrong["Spec wrong: revise by developer ruling before successor start"]
  codewrong["Code wrong: spec stands, create defect item"]
  missing["Write missing behavior as Observed"]
  confirm["Confirmed Observed sections become Draft with falsifiers, others remain Observed and are not contract"]
  roadmap["Prepare roadmap section, a defect commitment names the violated requirement and reproducing mechanism"]
  tail[["spec-phase.dot: confirm blocks, declare, agreement, commit, start with supersession link when present, wake"]]

  start --> state
  state -->|"Done"| tonext
  state -->|"open commitment"| fits
  state -->|"pending successor"| pending
  state -->|"not initialized"| legacy
  legacy -->|"yes"| migrate
  legacy -->|"no"| init
  migrate --> init
  init -->|"after a migration"| carry
  carry --> hasspec
  state -->|"initialized, no open range"| hasspec
  fits -->|"yes"| continue
  fits -->|"no"| midway
  midway -->|"finish"| finish
  midway -->|"supersede"| supersede
  supersede --> pending
  pending --> readspec
  init -->|"no 1.x records"| hasspec
  hasspec -->|"yes, path B"| readspec
  hasspec -->|"no, path A"| recon
  readspec --> recon
  recon --> report
  report --> corrects
  corrects --> ask
  ask --> radius
  radius -->|"A"| pathA
  radius -->|"B"| pathB
  pathB --> verdict
  verdict -->|"holds"| confirm
  verdict -->|"drifted"| drift
  verdict -->|"still Observed"| confirm
  verdict -->|"missing"| missing
  drift --> rule
  rule -->|"spec"| specwrong
  rule -->|"code"| codewrong
  specwrong --> confirm
  codewrong --> confirm
  missing --> confirm
  pathA --> confirm
  confirm --> roadmap
  roadmap --> tail
```

The Graphviz source is docs/diagrams/existing-project.dot.

## Agree on behavior you can recognize

A useful requirement describes an observable result. "Make draft saving
robust" leaves too much room for interpretation. "A saved draft can be
reopened with the same text" gives you something you can examine.

Sudus uses two terms you will see often:

| Term | Meaning | Example |
|---|---|---|
| Falsifier | An observation that would show the requirement is not met. | Reopening a saved draft loses part of its text. |
| Mechanism | The declared command that checks the requirement. | A test that saves a draft, reopens it, and compares the text. |

Before agreeing, ask whether the failure example would catch the mistake
you care about. A build succeeding does not, on its own, show that drafts
survive closing the app.

A requirement is one block in a file under `docs/spec/`:

```text
[APP-001] The validator MUST reject an empty name.
Falsifier: The validator accepts an empty string.
Mechanism: names
Status: Draft
```

The identifier's prefix (`APP` above) is fixed by that file's `Prefix:`
header line, at the top of the file. `Status:` is one of `Draft`,
`Observed`, `Agreed <date>`, or `Retired <date>`. Only your confirmation,
directly or through a decision that quotes your ruling, moves a block to
`Agreed <date>`. Only Agreed blocks are checked, and a commitment may name
only Agreed requirements. A `Rationale:` line, at most one, may sit between
`Falsifier:` and `Status:`.

You do not have to correct every item yourself. The agent should present
related requirements and falsifiers together so you can correct the wrong
ones by exception. You do need to confirm the set; silence is not
confirmation. If anything is unclear:

> Explain what each option would change for me, before I decide.

### When the software requires a host path

Most requirements should name repository-relative paths, such as
`src/server.rs`. Some products also depend on a particular host binary or
configuration location outside the repository. Declare those in the
affected spec file's header, before its first requirement:

```text
Host paths: /usr/bin/bwrap, ~/.widget/config.toml
```

The list applies only to that file. Sudus reads this field; it never scans
requirement text for paths, and never copies a host path's target into a
snapshot or a model request.

The spec-phase diagram is the tail that new-project, existing-project and
next-feature all share, from drafted requirements to the first work-loop
action.

```mermaid
flowchart TB
  start(["Enter: initialized project, requirements Draft, each with a falsifier"])
  falsifiers["Propose falsifiers as one set, name the mechanism that observes each"]
  review["Self-review contradictions, ineffective falsifiers, and requirements no mechanism can check, done, not recorded"]
  lint{"sudus lint docs/spec clean?"}
  present["Present by exception, invite another explanation"]
  outcome{"Developer's answer?"}
  explain["Explain another way"]
  correct["Apply corrections"]
  agreed["Confirm each block as Agreed, or record a deference decision"]
  commitment["Write roadmap section: Agreed requirements, delivery, done-when, move Current: in the recoverable start transaction"]
  declare["sudus declare for this commitment only, each mechanism has a failing violating example"]
  agreement["Prepare AGENTS.md from the template for developer authorization"]
  authorize["State what would be bound and ask. On ok, sudus authorize --quote: one record binding the final spec, agreement and settings digests. Changes or a question: authorize instead or ask, binds nothing"]
  startintent["sudus start: verify authorization and write command intent, commit the prepared contract, agreement and mechanisms"]
  startrec["Finish the start transaction: workspace snapshot plus frozen set and digests, include from_superseded when resuming, install exact refspecs when authority remote is configured"]
  done[["Done: wake names the first work-loop action, Consequential decisions wait in the queue"]]

  start --> falsifiers
  falsifiers --> review
  review --> lint
  lint -->|"findings"| falsifiers
  lint -->|"clean"| present
  present --> outcome
  outcome -->|"asks"| explain
  explain --> present
  outcome -->|"corrects"| correct
  correct --> review
  outcome -->|"confirms or rules"| agreed
  agreed --> commitment
  commitment --> declare
  declare --> agreement
  agreement --> authorize
  authorize --> startintent
  startintent --> startrec
  startrec --> done
```

The Graphviz source is docs/diagrams/spec-phase.dot.

## Let the agent work, and know when it needs you

The agent's working agreement (`AGENTS.md`) tells it to run `sudus wake`,
do the action named until its predicate holds, then run it again. You can
also run it to see the current position:

```sh
sudus wake
```

Wake prints a verdict, one line naming the action or party, a reason, and
the predicate that completes the action:

```text
verdict: Resolvable
action: run APP-001
reason: no current receipt carries a result for APP-001
predicate: a current receipt carries a result for the requirement
```

| Verdict | What it means for you |
|---|---|
| `Resolvable` | A named action can be taken now. The reason and predicate say what and why. |
| `Waiting` | An escalation is unanswered. Wake prints its five fields verbatim; only you can close it. |
| `Done` | The open commitment meets every recorded condition, and the backlog holds nothing to promote, or every item it holds waits by your ok until the next Done. |

Outside a project, with the durable refs missing, during a pending
supersession, or with an interrupted transaction, `sudus wake` prints one
line naming the exact command or skill that continues, and exits 3; none
of these is a verdict.

You should not need to type "continue" after every `Resolvable` verdict.
Continuing is the agent's responsibility under the working agreement. Sudus
itself is a command-line tool; it does not keep an agent running or grant
permissions your agent application has withheld.

When returning in a new session, a useful prompt is:

> Read the working agreement and run Sudus's wake command. Explain the
> current goal and continue with the action it names.

Records exist only once committed, or, for a workspace snapshot, once
Sudus has captured the working tree's bytes into one. The agent should
commit the agreement, spec, mechanisms, and its own working code as it
goes; a fresh clone only sees what reached a commit or a Sudus record.

The work loop is what runs on every `sudus wake` cycle: it names one
action with its completion predicate, the agent does it, and it wakes
again.

```mermaid
flowchart TB
  wake(["sudus wake is read-only: print verdict, action or party, reason and predicate. Missing refs, pending transition or recovery: one line, exit 3"])
  verdict{"Verdict?"}
  waiting["Waiting: print the escalation's five fields verbatim; the agent adds nothing to the work, asks the developer in prose and records their answer with sudus answer. Developer: absent: same print, exit 4"]
  answer["The agent asks you in conversation and records your words: sudus answer ok, instead, or ask --quote, signed when a key exists, attested otherwise"]
  reply["reply after ask: a reply record names the escalation"]
  stop[["Done: a done record exists and nothing waits, render unread queue and stop. Backlog waiting: wake names promote, unless your ok let it wait"]]
  act["Do the named action until its predicate holds, actions are listed in precedence order"]
  cannot{"Cannot act, or cycle bound reached?"}
  escalate["Write one evidence-backed escalation. Cycle guard: fourth same-target or 28th admin transition, or third unsuccessful recovery"]
  measure["Consequential decision while acting: sudus measure the draft first. Five Score levels, composite, veto, suggested: advice, not a route"]
  gate{"Floor or veto?"}
  decide["The agent decides: sudus decide --consequential, composite outcome, whatever the suggestion, or escalates anyway"]
  trace["Leave the required trace: branch commit, typed snapshot or canonical log record"]

  wake --> verdict
  verdict -->|"Waiting"| waiting
  waiting --> answer
  answer --> wake
  verdict -->|"Resolvable: reply"| reply
  reply --> wake
  verdict -->|"Done"| stop
  verdict -->|"Resolvable"| act
  act --> cannot
  cannot -->|"can act"| trace
  cannot -->|"cannot or bounded"| escalate
  trace --> wake
  escalate --> wake
  act -->|"Consequential draft"| measure
  measure --> gate
  gate -->|"yes: escalate --consequential"| escalate
  gate -->|"no"| decide
  decide -->|"decision names the measurement"| trace
  decide -.->|"escalate anyway"| escalate
```

Actions are attempted in this order:

| Action | done := |
|---|---|
| repair PATH | hand-written input parses; no unrelated byte changed |
| recover TRANSACTION | intent has a terminal domain or abort record; every store matches its result |
| reconcile ACTION | local action lease is gone; action finished or was abandoned |
| scope PATH | each durable breach is developer-kept or restored to its allowed base; later declaration never clears it; while the breach's own escalation is unanswered, wake says Waiting |
| supersede SLUG | every set requirement's Agreed text still has the digest its start froze, or a superseded record closes the commitment |
| fix ITEM | fix snapshot changes no protected contract; requirement has a current pass |
| record PATH | action lease covers the path, or it is clean |
| commit PATH | path is clean, or the action lease covers it; docs/decisions.jsonl is named here whenever it has uncommitted lines |
| declare REQ | mechanism definition names REQ; no prior undeclared delta was legalized |
| run REQ | current receipt matches input snapshot, definition, text and declared execution identity |
| implement REQ | current pass plus review metadata bound to the current command, working directory, results mode and frozen text, with fail receipt |
| escalate REQ | after three failing attempts in the requirement's turn, an escalation exists before a fourth; a run where a sibling requirement also failed is not an attempt, nor is the first check of a turn that began after the start |
| review mechanism REQ | review metadata binds command, working directory, results mode and text to a fail receipt that ran under them; product inputs unchanged |
| capture ITEM | outside record or escalation names it |
| review SLUG | current workspace snapshot; every fixed question answered for each target |
| report SLUG | a report at the reviewed snapshot through the latest brief; every lens, decision and interface attempted; a report stopped on a Sudus bug is not one |
| resolve SLUG N | a resolution, or a decline with its reason, names N on its exact source record |
| build DECISION | realized line names base and result snapshots; actual delta passes protected-category check |
| done SLUG | Done rule holds; sudus done writes the final record |
| fold ITEM | no commitment is open; every inbox item is on the log, or its slug is held by a different item |
| promote | one backlog item, decision, roadmap move and successor start are one transaction |

The Graphviz source is docs/diagrams/work-loop.dot.

## The action lease

Before changing a file a mechanism declares as its input, the agent claims
it:

```sh
sudus begin implement APP-001
```

This prints a lease sha and creates a local, unpushed ref
(`refs/sudus/in-progress`) naming the action, its target, and the
workspace at that moment. `sudus begin implement APP-001 --touch
src/new-file.mjs` also declares a new file as an input for the life of the
lease, so writing to it is not an undeclared change. The target must be a
requirement that exactly one mechanism declares, because `sudus end`
writes the touch into that mechanism; a touch on a `resolve` or `fix`
lease is refused, since nothing would write it. The fix for a finding
takes `sudus begin resolve <slug>`: a lease on the open commitment's
slug covers the inputs of every mechanism its requirements name. After
committing the work:

```sh
sudus end --lease <the-sha-begin-printed>
```

Passing `--lease` means a stale `end` from a different, dead session can
never close the lease a live session is using. `sudus end --abandon`
releases the lease without claiming any touched path as a real change,
for when the attempt did not pan out.

The lease is local to your clone; it is never pushed and does not
coordinate two clones working at once. Two clones meet at the authority
remote: `sudus push` refuses a non-fast-forward or losing race there,
stopping the later writer before it publishes. When the other clone only
moved ahead, push names the fetch that catches up. When both clones
recorded something, the logs have diverged and are never merged: push
says how many records each side holds that the other lacks, and names the
fetch that keeps the remote's records and drops this clone's, whose work
is then recorded again.

## Answer a decision without guessing

An **escalation** is a decision the agent cannot settle within its
authority or available information. `sudus wake` prints it in full so your
answer survives the current conversation, whatever happens to the chat:

```text
verdict: Waiting
party: developer
reason: three attempts at APP-004 without a pass
question: Should a name containing only spaces be rejected?
recommendation: Reject it.
because: It would look empty to the person reading the name.
if wrong: A caller relying on spaces as a name would need to change.
instead: Keep accepting spaces and reject only the empty string.
predicate: an answer record names the escalation with ok or instead
```

If those consequences are unclear, ask. You are not expected to approve
something because the agent used confident language.

### Your three answer forms

You answer in conversation, in your own words. The agent puts the five
fields to you in plain prose: the problem, then what `ok` accepts (the
recommendation), what `instead` means (the cost if the recommendation is
wrong, and the alternative) and what `ask` is for (you do not understand,
or want to discuss it). It ends with `ok | instead | ask`, waits, and then
records what you said.
Assume Sudus named the escalation `app-002`:

| You say | The agent records | What it authorizes |
|---|---|---|
| "Ok, reject it." | `sudus answer app-002 ok --quote "Ok, reject it."` | Proceed on the recommendation, within the agreed scope. |
| "Keep drafts on this device only." | `sudus answer app-002 instead --quote "Keep drafts on this device only."` | Use your stated direction; update the agreement if the scope changes. |
| "What would syncing change for users?" | `sudus answer app-002 ask --quote "What would syncing change for users?"` | Explain the choice. It does not authorize implementation. |

An `ask` answer keeps the question open. The agent records its explanation
with `sudus reply app-002 "<explanation>"`, and the decision comes back to
you. You can ask again; only `ok` or `instead` closes it. You never type a
command: the agent asks, you answer, the agent records.

### Attested or signed

`sudus answer`, `sudus decisions --read`, `sudus authorize` and `sudus
retire` carry evidence of your decision. By default the project uses
attested mode: the record holds your words as the agent quoted them, the
name of the harness the conversation ran in, and your Git author identity.
That is evidence, not cryptographic proof it was you, and Sudus says so
wherever it reports the decision.

A signing key is optional. To use one, put your public key (PEM) in
`signing_key` in `.sudus/settings.json`. That is a settings change, so the
next `sudus authorize` must carry a signature from that key: the command
prints the exact bytes to sign and the nonce to repeat. From then on every
answer, reading and authorization must be signed; the attested records
before the change stand.

Sudus checks each decision against the key in force: the key in the
settings you last authorized, not whatever the settings file says now. An
agent that edits `signing_key` to its own key, or to `null`, cannot approve
that edit or sign anything after it. Replacing or removing your key takes a
signature from it, so keep the private key: Sudus has no way to remove a
key you can no longer sign with.

Neither mode is a security boundary. An attested record is the agent's
quote of your words. A signature shows only that whoever holds the private
key signed those exact bytes, so it shows the decision was yours only while
the agent cannot read that key. What Sudus relies on is that you gave the
answer yourself, in the conversation.

## Decisions that did not stop the work

Sudus has two levels of decision, both left to the agent's judgment about
which applies:

| Level | What happens |
|---|---|
| Consequential | A costly-to-reverse or boundary-crossing choice is recorded with `sudus decide --consequential` and queued for your review; the agent continues. |
| Blocking | The agent stops and raises an escalation with `sudus escalate`. |

The working agreement may also describe Routine and Judged guidance for the
agent's own use; neither leaves a record.

Read the queue:

```sh
sudus decisions
sudus decisions --read <decision-id> --quote "<your words>"
```

The first command renders every line in `docs/decisions.jsonl`. Reading a
decision carries your evidence, the same as answering an escalation: after
the agent has explained a decision and you have said you read it, the agent
runs `--read` with your words quoted, appending a `read` line rather than
deleting anything. You can ask:

> Show me the queued decisions. For each, explain what was chosen, what it
> changes, and what would make us reconsider it.

A promotion from the backlog is one of these decisions. Read it for the
requirement and falsifier the agent wrote; if you disagree, tell the agent
and it can supersede the commitment before continuing.

When a Consequential decision requires building something, the agent
builds it, commits, and records:

```sh
sudus realize <decision-id> --subject "what was actually built"
```

`build <decision>` stays the wake action until that realized line names
the decision's starting and resulting workspace snapshots, and the
realization check, comparing the two, passes. A change touching a `data`
path, frozen Agreed text, the working agreement, or protected settings
always stops and escalates, whatever the decision said it intended. The
move `sudus migrate` made from `.cairn/` to `.sudus/` is not the
decision's change, even when the decision's starting snapshot predates it;
a moved file changed after the move is judged as the path it is now.

An escalation may also name a finding, when the agent chooses to ask you
about one: `--concern finding:<record sha>#<n>`, one per finding. Your `ok`
closes each finding it names, and wake lists them after "ok closes:".
`instead` with a direction keeps the finding open, and the agent resolves or
declines it that way.

This is next-feature: it starts from Done and specifies the next
commitment.

```mermaid
flowchart TB
  start(["Start: /next-feature"])
  isdone{"sudus wake says Done?"}
  notdone(["Stop: hand the verdict to the working agreement"])
  read["Read the spec set, finished roadmap section, Consequential queue, next-feature items not yet retired and backlog"]
  ask["One open question: waiting items, a new feature, or both? Retire what the developer drops"]

  subgraph change["For each requested change"]
    radius["Trace and cite the blast radius: requirements, mechanisms, code, documents"]
    restate["Restate what changes for whom, quote affected Agreed text, give the alternative and recommendation"]
    corrects["Developer corrects the reading"]
    fits{"Covered by current Agreed requirements?"}
    covered["Put it into the commitment, write no new contract text"]
    revise["Revise under the same identifier or add Draft, Rationale: at most one line"]
    next{"More changes?"}
  end

  tail[["spec-phase.dot: falsifiers, self-review, lint, confirmation, roadmap, declarations, agreement, start, wake"]]

  start --> isdone
  isdone -->|"no"| notdone
  isdone -->|"yes"| read
  read --> ask
  ask --> radius
  radius --> restate
  restate --> corrects
  corrects --> fits
  fits -->|"yes"| covered
  fits -->|"no"| revise
  covered --> next
  revise --> next
  next -->|"yes"| radius
  next -->|"no"| tail
```

The Graphviz source is docs/diagrams/next-feature.dot.

## Understand checks and their results

A **mechanism** is the declared command that checks one or more
requirements. The agent writes its definition as JSON and declares it:

```sh
sudus declare names --file mechanism-names.json
```

```json
{
  "command": "node tests/names.mjs",
  "inputs": ["src/names.mjs", "tests/names.mjs"],
  "requirements": ["APP-001"],
  "results": "per-requirement"
}
```

`inputs` are literal paths, never globs; a directory covers everything
Git tracks beneath it. `documents` (optional) is a subset of `inputs` whose
changes cost a check but never stale a review. A `documents` path may not
also sit below a `source` root in settings. With `"results":
"per-requirement"`, the command must print one line per requirement it
speaks for, `sudus: APP-001: pass` or `sudus: APP-001: fail`; an omitted
requirement stays `unverified`. Without that field, the command's exit
code decides every declared requirement's result: zero is pass, nonzero or
a signal is fail.

Run the check:

```sh
sudus check APP-001
```

This selects the one mechanism declaring APP-001 (two or more is refused;
name one explicitly by fixing the declarations first), runs it against an
input snapshot of exactly its declared inputs, and appends a receipt
record. `sudus show <receipt-sha>` prints it, including the observed exit
code and a digest of the captured output, which lives at
`.sudus/output/<digest>`, ignored by Git.

| Result | What it establishes |
|---|---|
| `pass` | The command reported a pass for this requirement, under its declared reporting rule. |
| `fail` | The command reported a failure. Inspect the output to understand why. |
| `unverified` | This run established no verdict for the requirement. It cannot satisfy Done, and it does not count as a failed attempt. |

A receipt is **current** only while its input snapshot tree, mechanism
definition digest, the requirement's exact text digest, the observed
declared execution identity, and the record schema all still match. Any of
these changing makes wake name `run <REQ>` again; a kernel upgrade, by
itself, does not.

Before a mechanism's evidence counts at all, the agent shows it fail on a
violating example and binds that failure:

```sh
sudus review mechanism APP-001 <the-fail-receipt-sha>
```

This binds the mechanism's review metadata to what decides what the check
detects (its command, working directory and results mode) and the
requirement's current text digest, with that fail receipt as the
demonstration that the check actually catches the violation. The
violating example needs no commit. The agent makes it in the working tree,
runs `sudus check`, binds the fail receipt, and undoes the change: the
receipt's input snapshot keeps the violating bytes, so the only commit is
the bound mechanism file. A revised requirement, or a changed command,
working directory or results mode, unbinds this and `review mechanism REQ`
becomes the next wake action before another check counts. Declaring more
inputs, documents, tool versions or requirements keeps it bound; those only
make receipts stale, so wake names `run` instead. For the same reason, a
fail receipt from before such a redeclare still binds a requirement that
was not bound yet, as long as the command, working directory and results
mode are the same.

## Review, the adversary, and Done

Before Done, the builder answers six fixed questions and lists findings, in
a JSON file the agent writes and records:

```sh
sudus review reject-empty-names --file review.json
```

```json
{
  "examined": ["the empty-name failure before the fix and the pass after it"],
  "answers": [
    { "question": "Q1", "target": "names", "status": "observed", "text": "..." },
    { "question": "Q2", "target": "names", "status": "observed", "text": "..." },
    { "question": "Q3", "target": "APP-001", "status": "observed", "text": "..." },
    { "question": "Q4", "target": "APP-001", "status": "observed", "text": "..." },
    { "question": "Q5", "target": "reject-empty-names", "status": "observed", "text": "..." },
    { "question": "Q6", "target": "reject-empty-names", "status": "not-checked", "text": "" }
  ],
  "findings": []
}
```

| # | Per | Question |
|---|---|---|
| Q1 | mechanism | Which violating example failed the check, which fail receipt records it, and what did the check print? |
| Q2 | mechanism | Why was that failure the stated violation, not a setup error? |
| Q3 | implemented requirement | Why is its falsifier now unreachable? |
| Q4 | implemented requirement | What else did the change touch that no check covers? |
| Q5 | commitment | What could still be wrong while every check passes? |
| Q6 | commitment | What was not tested? |

`answers` needs exactly one entry for every `(question, target)` pair this
commitment has: Q1 and Q2 once for each declared mechanism, Q3 and Q4 once
for each requirement the commitment implements, Q5 and Q6 once for the
commitment itself. Each entry's `status` is `observed`, with `text` naming
a command, path, or output, or `not-checked`, with empty text. `findings`
is a list of `{"n": 1, "text": "..."}`, numbered from 1, or `[]` for none.
Sudus checks this shape, never truth: it cannot tell a careful review from
an empty claim.

Once the review exists, wake names `report reject-empty-names`. The
**adversary** runs once per commitment, here, right before Done. First:

```sh
sudus brief reject-empty-names
```

This writes a brief record and the brief file, and prints the file's path
and the instruction for starting the adversary: one fresh subagent in the
same harness, with none of the builder's conversation, the brief file as
its entire prompt, and the model settings name (`any` when they name none).
The brief tells the adversary to work in the project itself and read only:
to build nothing, run no tests and no project code, and start no subagents.
Sudus cannot enforce this. The harness runs the subagent with its ordinary
permissions, so the read-only role is an instruction, not isolation. The
brief lists the receipts, so it knows what already ran. It reads the whole
specification first and judges the commitment as part of the whole system.

The brief opens with the adversary's role, in your words: it has no stake in
Done, and its job is to prove the commitment is not production ready. It
judges the work through five lenses: the falsifier, the builder's decisions,
security, logic, and complexity and spec adherence. The brief then lists the
roadmap section, the frozen requirements and falsifiers, the mechanism
definitions, the receipts, the builder's claims and findings, the agent's
decisions (its `sudus decide` records and the backlog and next-feature
items it captured in this commitment), the changed paths and interface
paths, and the paths it must not read: tracked files under
`network_exclude` or a credential pattern (`.env`, `.env.*`, private-key
files, conventional SSH key names), and the patterns themselves. It ends
with a Report section that spells the report file's shape and every
required pair, so the file goes to `sudus report` unchanged:

```sh
sudus report reject-empty-names --file report.json
```

```json
{
  "attempts": [
    { "question": "falsifier", "target": "APP-001", "looked_for": "...", "found": "...", "held": true },
    { "question": "security", "target": "reject-empty-names", "looked_for": "...", "found": "...", "held": true },
    { "question": "logic", "target": "reject-empty-names", "looked_for": "...", "found": "...", "held": false },
    { "question": "complexity", "target": "reject-empty-names", "looked_for": "...", "found": "...", "held": true }
  ],
  "interface_attempts": [],
  "findings": [
    { "n": 1, "severity": "Major", "where": "src/names.mjs:14", "text": "...", "remedy": null }
  ],
  "sudus_bug": null
}
```

`attempts` needs one entry for every pair the brief names: `falsifier`
once per requirement, `decision` once per decision the brief lists, and
`security`, `logic` and `complexity` once for the commitment. Each says
what the adversary looked for, what it found, and whether the work held.
`interface_attempts` needs one entry per changed interface path. Each
finding says where, what is wrong and why, and is `Critical` (a
requirement is unmet, the falsifier is reachable, or a security exposure
ships), `Major` (an uncovered defect in a touched path, or a decision that
was yours) or `Minor` (an edge the commitment did not promise, or
complexity the next commitment pays for); `remedy` is one line or `null`.

`sudus report` refuses a report whose brief is stale or already used, one
with fields the shape does not name, and one that leaves a pair or an
interface path without an attempt. It also refuses a report once the
workspace differs from the reviewed snapshot: the adversary reads only, so
the adversary writes its report file outside the repository. There is one
report per commitment, and a review after it is refused: a change after
the report gets a resolution, not a new review.

When the adversary finds a defect in Sudus itself, it stops and reports
only that: `"sudus_bug"` holds the bug and the lists are empty. That
report does not complete the review. Wake names `report` again and quotes
the bug. The agent decides what to do with it (the report-sudus-issue
skill files it after your `ok`), then briefs again when the bug no longer
blocks the review.

The brief's changed paths and interface paths run from the commitment's
start to the reviewed snapshot. A commitment started after a supersede
carries the work of the one it superseded, committed before its own
start, so its brief, its report and wake measure from the first start of
that chain instead.

Every finding, from the review or the report, is the agent's to decide. It
fixes it:

```sh
sudus resolve reject-empty-names 1 "fixed by validating with String.prototype.trim first" --source <sha of the review or report>
```

or declines it with its reason:

```sh
sudus decline reject-empty-names 2 "APP-001 names an empty name, not a long one; the next commitment takes limits"
```

A finding of any severity may be declined, and nothing waits on you for it:
the agent decides, and Sudus judges through its checks. Fixes make the
checks out of date, but wake does not ask for a full run after every fix:
while a finding is open it names the next resolution, and once the last
one is resolved or declined it names each check to run again. A check that
ran and failed is named at once. No adversary judges the fixes: the checks
do.

Done requires a report at the reviewed snapshot and every finding,
anywhere, resolved or declined. When it holds:

```sh
sudus done reject-empty-names
```

`sudus done` prints the **review report**: every finding, its severity and
where it is, and what the agent did with it, fixed with its explanation or
declined with its reason. The agent shows it to you as printed before it
promotes a backlog item or starts the next feature. Ask as well for a
completion report that answers:

> What can I do now? What changed? What was tested? What did the review
> and the report examine? Is anything important still outside this
> agreement?

Try the behavior yourself where that gives you useful information. Sudus
cannot tell a careful review from an empty claim, or a thoughtful
adversary from a rubber stamp; the shape of the record and the reasons
the agent gave are the evidence it can show you.

## Scope: work Sudus did not expect

Before any state-changing command, Sudus compares the working tree with the
newest allowed workspace snapshot. An undeclared, non-`outside` changed
path becomes a durable **scope breach** record, and wake names `scope
<path>` before anything else. A path touched under an active lease is
already declared, so ordinary implementation work under `sudus begin` is
never a breach.

Restore the path to its recorded base and dispose of the breach:

```sh
sudus scope <breach-sha> restore
```

Or, when the work is correct and belongs, ask you to keep it explicitly
with `sudus escalate --concern breach:<breach-sha> ...`, record your ok,
then:

```sh
sudus scope <breach-sha> keep
```

Several breaches from one change take one escalation, with one
`--concern breach:<sha>` each, one ok, and one call that names them all:

```sh
sudus scope <breach-sha> <breach-sha> <breach-sha> keep
```

Your ok keeps the bytes the breach captured. If the path changed after
that, keep refuses; the agent puts the captured bytes back, or restores
the path and asks again about the new bytes as a new breach. After a
supersession, the successor's start writes the roadmap's `Current:` line
itself, after the breach captured the roadmap; keep and restore read a
`Current:` line that names the open commitment as that write, not as a
change to the path.

A later `sudus declare` cannot retroactively clear an existing breach; it
only legalizes future changes.

## The evaluator: the agent's gut check

At a Consequential decision, the agent drafts its choice, then measures it
before deciding: `sudus measure` scores five things about the draft -- how
much evidence backs it, how far the recommended option reaches, how well it
fits the cited requirement's contract, how much new surface it adds, and how
ambiguous the question is -- each 0 to 4, with a confidence. Reach, contract
and surface are judged for the recommended option against the draft's other
options, which the state carries alongside it.
Code, not the model, turns those five numbers into a composite and a
`suggested: agent | developer` reading; the suggestion is advice, not a
route. The agent reads it and decides, except in two cases code always
catches on its own: a draft that would change an Agreed requirement's text
or falsifier, the working agreement, or data that cannot be regenerated
(the floor), or a draft the measurement itself flags as too consequential
(the veto: a wide-reaching, contract-changing, or new-surface option).
Either one sends the draft to you, and `sudus decide --consequential`
refuses it. In every other case the agent may still choose
`sudus escalate --consequential` past a `suggested: agent` reading, at its
own judgment.

Turning on `typesafeai.enabled` in `.sudus/settings.json` picks the
measurement's source: `jev` (`bin/typesafeai.mjs`, reading
`TYPESAFEAI_API_KEY` from the environment and never storing it) when
enabled, or, when it is not, the harness's own configured review model,
started the same way `sudus brief` starts the adversary -- with none of the
agent's own conversation context. Either way, every Consequential draft is
measured; there is no off switch and no shadow mode, because a shadow
default that never let a draft reach the agent was tried and measured at
zero agent routing out of twelve expected cases
(`.superpowers/bench/results.md`).

```sh
sudus calibrate
```

reports how many developer-labelled, `suggested: agent` measurements exist
and how many you later called wrong. It passes when the one-sided 95% upper
bound on that false-downgrade rate stays under the fixed 5% cap.
It tunes `weights`, `agent_ceiling` and `confidence_floors` in
`.sudus/settings.json`; it does not gate whether the agent may decide --
that gate was tried too, and it produced the same zero-routing result. A
project with `developer: absent` (an autonomous benchmark configuration)
has no one to answer an escalation the floor raises; wake prints it
exactly as it always prints Waiting and exits 4 instead of sitting there.

The benchmark under `tests/bench` (24 drafts over one small ledger project;
`SUDUS_BENCH=1 npm run bench` with the key in the environment) scores 22 of
24 against the expected route. The ceiling and weights were chosen on those
same drafts, so the figure is in-sample; rerun it after any change to the
criteria text, the state or the settings defaults.

## Settings

`sudus init` writes `.sudus/settings.json`. Every key is listed here with
its default. The file is protected: after you change it, tell the agent.
It states the change and, on your ok, runs
`sudus authorize --quote "<your words>"` so the new settings digest is
bound to the loop. Until then wake names the repair.

| Key | Default | Meaning |
|---|---|---|
| `schema` | current | The settings schema version; do not edit. |
| `authority_remote` | the remote `init` confirmed, or `null` | The one remote the records may be pushed to (`sudus push`). |
| `outside`, `source`, `interfaces`, `data` | `[]` | Path globs that classify the tree: outside the agreement, source, public interfaces, data that cannot be regenerated. The floor and the scope check read them. |
| `network_exclude` | `[]` | Path globs whose content never reaches any model, on top of the built-in credential patterns. |
| `signing_key` | `null` | `null` means attested mode: your words, quoted by the agent, with the harness name and your Git author. A public key (PEM) means every developer answer and authorization must be signed with its private key; see Attested or signed. |
| `attribution` | `"forbidden"` | Whether commit messages may carry AI attribution; the release script refuses when forbidden and any is found. |
| `developer` | `"present"` | `"absent"` for an autonomous run: any unanswered escalation prints as Waiting and wake exits 4 instead of waiting for an answer no one can give. |
| `adversary_rules` | absent | Optional. One-line rules the machine sets for the adversary, such as a path to stay out of or a file size it should not read. `sudus brief` prints them under Host rules, inside the brief its record digests, so you never edit the brief by hand. |
| `harness` | `{}` | Per-harness review settings: `harness.<name>.adversary_model` (string or `null`) names the model the adversary subagent runs as in `sudus brief`'s start line, and, with `adversary_transport` (`"local"` or `"remote"`), the reviewer the evaluator's review source starts. |
| `typesafeai.enabled` | `false` | `true` sends each Consequential measurement to TypeSafe's jev model; `false` uses your harness's review model through `sudus measure --brief`. |
| `typesafeai.model` | `null` | The versioned model id, required when enabled: `"jev-1.13.0"` at the time of writing. An alias such as `"jev"` is refused. |
| `typesafeai.weights` | 0.2 each | The five dimension weights (`evidence`, `reach`, `contract`, `surface`, `ambiguity`); they must sum to 1. |
| `typesafeai.agent_ceiling` | `0.35` | The composite at or under which the suggestion is `agent`; above it, `developer`. |
| `typesafeai.confidence_floors` | 0 each | Per-dimension minimum confidence for an `agent` suggestion. |
| `typesafeai.min_calibration_agent_predictions` | `60` | Labelled `suggested: agent` cases `sudus calibrate` needs before it reports a pass or fail. |
| `typesafeai.request_cap_bytes` | `48000` | The largest request the evaluator sends; a draft over it is recorded `unavailable oversize` and goes to you. |

The defaults for the ceiling, weights and floors are the ones the in-tree
benchmark (`tests/bench`) scored 22 of 24 with. Change them and rerun it.

### Turn on the TypeSafe evaluator

By default the measurement comes from your harness's own review model and
needs no account. To use TypeSafe's jev model instead:

1. Get an API key from https://typesafe.ai and export it in the shell that
   runs your agent: `export TYPESAFEAI_API_KEY=...`. Sudus reads it from
   the environment only; it never writes it to a file, a record or a log,
   and the key never appears in an error message.
2. In `.sudus/settings.json` set `"typesafeai": { "enabled": true, "model": "jev-1.13.0", ... }`,
   leaving the other keys at their defaults.
3. Tell the agent; on your ok it runs `sudus authorize --quote "<your words>"` to bind the changed settings.
4. At the next Consequential decision the agent runs `sudus measure ...` and
   the call goes to `https://api.typesafe.ai/v1/systemone` with the closed
   state described above; the measurement record holds the five levels, the
   composite, any veto and the suggestion. A transport failure, a rate limit
   after the built-in retries, or an invalid answer is recorded as
   `unavailable <class>` and the draft goes to you; nothing is retried
   silently.

Without a key, `sudus measure --brief` prints a brief and a launch block;
a fresh session of your harness's review model answers it into a JSON file
and `sudus measure <slug> --file <path>` completes the measurement through
the same parser and the same composite. The two sources answer the same
five questions over the same state; on the benchmark they agreed on every
draft compared.

To check the evaluator against the 24-scenario benchmark on your own key:
`SUDUS_BENCH=1 npm run bench` from the checkout, one scenario at a time.

## Sending the records with the code

Only `refs/sudus/log`, `refs/sudus/snapshots` and the clones' inboxes
travel with the code. Set
`authority_remote` during `sudus init` (or change it with a new
`sudus authorize`) to the one remote these should reach; `null` means
explicit local-only operation. Push everything together:

```sh
sudus push
```

This pushes the branch and both durable refs atomically where the remote
supports it, or snapshots first, log second, and branch last otherwise,
stopping the sequence on any failure. Never push `refs/sudus/*` with plain
`git push`; a bypassing push can create a mismatch wake will need to
repair. After a fetch, `sudus wake` validates every cross-reference and
names the exact fetch or push that repairs a gap; it never guesses. A
clone missing the durable refs is told the exact `git fetch` to run, or,
with no remote configured, to run `sudus init`.

### Capturing on a second clone

The log is one chain that is never merged, so only the clone doing the
work appends to it while a commitment is open. The start record names that
clone. On any other clone, for example one where you are thinking through
the next feature, `sudus item` writes the clone's own inbox,
`refs/sudus/inbox/<clone id>`, instead of the log. Only that clone appends
to its inbox, so `sudus push` publishes it without racing the clone doing
the work, and fetches every other clone's inbox. `sudus show items` lists
an inbox item as not on the log. After Done, wake names `fold`, and
`sudus fold` appends each inbox item to the log as an ordinary item, where
promotion and retirement work on it. An inbox item whose slug the log
already holds with a different item is reported and left in the inbox.

## Moving a project from Cairn

Sudus was named Cairn until 3.0.0, and a project that started under that
name keeps its records under `.cairn/` and `refs/cairn/*`. Every command
reads and writes them there; a mechanism that prints `cairn: REQ-001:
pass` still passes; the `cairn` command still runs. The only sign is one
line after the wake verdict:

```
layout: .cairn (the former name); sudus migrate moves it to .sudus between commitments
```

The move is one command, and it is the agent's to run, not yours:

```sh
sudus migrate
```

It runs only between commitments (before the first `sudus start`, or
after Done), because the next start's snapshot is the next allowed base
and the work of the next spec phase is compared against the last done
snapshot only for kernel-managed paths. That snapshot still names the
`.cairn/` mechanism files; their move is the kernel's own and is never a
scope breach, including for a definition redeclared after the move. It refuses while a commitment, an action lease or a transaction is
open, and while anything under `.cairn/` or `.gitignore` is changed and
uncommitted, so that the move is the whole of its commit. It renames the
three refs, moves the directory with `git mv`, rewrites the `.cairn`
lines of `.gitignore`, and commits `sudus: migrate from the .cairn layout
to .sudus`. The records already on the log keep their original subject
and trailers; new ones are written as `sudus:` records, and the log reads
as one. `.cairn/**` stays a reserved path afterwards, so a stray file
there is never plain work.

With an authority remote, `sudus push` publishes the moved refs, and
migrate gives the remote the new fetch and push refspecs. Another clone
that pulls the move sees `.sudus/` on its branch but still holds
`refs/cairn/*`; wake names `sudus migrate` there. Migrate asks the remote
first: when it already holds the moved refs, migrate names the fetch that
brings them, since renaming the clone's own stale refs would make an old
log current; when it does not, migrate moves the refs alone. The remote's
old `refs/cairn/*` are left behind unused.

## Get unstuck

Read the reason and predicate printed below the verdict; they are more
specific than the action word alone.

| Action wake names | What it means, and what to do |
|---|---|
| `repair PATH` | A hand-written file (spec or settings) does not read under its grammar. Fix only what is broken; `sudus lint docs/spec` shows spec problems. |
| `recover TRANSACTION` | A multi-record write (`start`, `promote`, `supersede`, `authorize`) was interrupted. Run `sudus recover <transaction>`. |
| `reconcile ACTION` | A local action lease exists with no matching finished work, usually left by a session that ended. Finish the action and `sudus end`, or `sudus end --abandon`; a dead session's lease needs no `--lease`. |
| `scope PATH` | An undeclared change was observed. Restore it (`sudus scope PATH restore`) or ask to keep it (`sudus escalate`, then `sudus scope PATH keep`); the breach sha wake's reason names works too, and several breaches go in one call before the disposition. |
| `supersede SLUG` | The Agreed text of a requirement in the open commitment was revised under it, and no check or review can bind to both the frozen and the current text. Restore the text the start froze, or ask the developer and `sudus supersede <successor> --quote "..."` so the successor freezes the revised text. |
| `fix ITEM` | A recorded defect is still open: this commitment's own while it is open, any defect between commitments. Write a failing test, fix it, commit, check, then `sudus fix ITEM` (the slug wake prints, or the sha). Once the fix is recorded, a commit that makes the requirement's pass stale makes wake name `run REQ`, not `fix` again: only the check is due. A check that fails names `fix` again. |
| `record PATH` / `commit PATH` | A declared input has uncommitted changes with no covering lease. Lease the action that changes it with `sudus begin <action> <target>` (`record` is not a begin action), then commit; or revert it. An untracked build artifact under a declared input is gitignored instead. |
| `declare REQ` | No mechanism speaks for this requirement yet. `sudus declare` one. |
| `run REQ` | A check is due: `sudus check REQ`. |
| `implement REQ` | The latest receipt is not a current pass. Read it and the captured output, then fix the code under a lease. |
| `escalate REQ` | Three distinct failing attempts with no pass since, counted from the requirement's turn: once every requirement before it in the set passes, and not counting the first check of a turn that began after the start. `sudus escalate` before a fourth. |
| `review mechanism REQ` | The requirement or the mechanism definition changed. Compare the check against the new text, then `sudus review mechanism REQ`; it takes the latest fail receipt that ran under the current command, working directory and results mode, which wake's reason names, unless you pass another. When none did, wake says so: make the violating example fail again and check. |
| `capture ITEM` | An idea outside this commitment needs a disposition: `sudus outside ITEM --reason "..."` (slug or sha), or escalate if it actually belongs. |
| `review SLUG` | Write and record the review, answering all six questions. |
| `report SLUG` | `sudus brief`, start one fresh read-only subagent with none of your context, then `sudus report --file`. Once per commitment, and again only after a report that stopped on a Sudus bug. |
| `resolve SLUG N` | An open finding is the agent's to decide: fix it and `sudus resolve`, or `sudus decline` it with its reason. |
| `build DECISION` | Build what the decision says, commit, then `sudus realize`. |
| `done SLUG` | Every condition holds: `sudus done SLUG`. |
| `fold ITEM` | No commitment is open and an inbox holds an item another clone captured while the commitment was open: `sudus fold` appends every such item to the log. |
| `promote` | No commitment is open and the backlog holds an item. Choose one; `sudus promote ITEM` (slug or sha). It refuses while any defect is unfixed, and while `Current:` names a section that is neither the finished commitment nor the item. An item other work already delivered is retired instead: `sudus escalate --commitment <finished slug> --concern retire:<item sha> ...`, and the developer's `ok` takes it out of the backlog. To rank a new feature above the waiting items, the agent escalates with `--concern wait:<item sha>` per item; your `ok` lets wake say Done while they wait, `sudus show items` marks them, and after the next Done wake names them again. |
| `reply SLUG` | You asked a question with `ask`; the agent owes an explanation: `sudus reply SLUG "..."`. |
| `Waiting` | An escalation needs your answer. With `developer: absent` no one can answer any escalation; wake exits 4 instead of sitting there. |

## Command reference

Run `sudus --help` for the authoritative, exact list; this table explains
each one's purpose. `<sha>` is any record's commit SHA; `sudus show <sha>`
prints one with its references resolved.

| Command | Purpose |
|---|---|
| `show <sha>` | Print one record, with the records and snapshots it references described. |
| `show items` | List every item record: sha, kind, slug, source, body, and whether it was promoted, fixed, retired or waits until the next Done; then every inbox item not yet on the log, with the clone it came from. |
| `lint docs/spec` | Check the specification's grammar: identifiers, falsifiers, mechanisms, statuses, and the spec map. |
| `init --remote <name>\|--local-only [--signing-key <path>] [--adopt <digest>] --quote <words>` | Create or adopt `.sudus/settings.json` and the two durable refs, with the developer's answer as flags; the command asks nothing itself. Attested unless `--signing-key` names a public key file. |
| `migrate` | Move a project from the former layout (`.cairn/`, `refs/cairn/*`) to `.sudus/` and `refs/sudus/*`, once, between commitments; nothing to do on a Sudus project. |
| `authorize [ok\|instead\|ask] --quote <words>` | On ok, bind the current digests of the specification, the working agreement, and settings in one record carrying the developer's evidence; `instead` or `ask` writes a direction record with the developer's words and binds nothing. |
| `decisions [--read <id> --quote <words>]` | Print the ADR file, or mark one decision read, quoting the developer. |
| `recover <transaction>` | Finish or safely abandon an interrupted multi-record write. |
| `begin <action> <target> [--touch <path>]...` | Claim the local action lease before changing a declared input; `--touch` provisionally declares a new path, and needs a target that exactly one mechanism declares; `end` adds it to the inputs only when no declared input already covers it. |
| `end [--abandon] [--lease <sha>]` | Release the action lease; `--lease` refuses a mismatched sha; `--abandon` releases without claiming touched paths. |
| `check <REQ>` | Run the one mechanism declaring `REQ` and record a receipt. |
| `declare <name> --file <path>` | Read a mechanism definition as JSON and write it under that name. |
| `scope <breach-sha or path> keep\|restore` | Dispose of a scope breach: keep the captured work (after a developer `ok`) or restore the path to its allowed base. A path resolves to its one open breach. |
| `start <slug>` | Open the commitment named in the roadmap's `Current:` line, after verifying the authorization; commits the prepared spec, agreement, and mechanisms. |
| `done <slug>` | Close the open commitment. Refuses until wake names `done`, and says what wake names instead (an unfixed defect, an unresolved finding, an unanswered escalation). |
| `supersede <successor> --quote <text>` | Close the open commitment without Done, quoting the developer's ruling, and name the intended successor slug. |
| `promote <item-sha>` | After Done, with the backlog holding this item, open it as the next commitment. |
| `item --backlog\|--defect --slug <s> --from <REQ> --body <text>` | Capture an idea or a defect against an Agreed requirement. |
| `item --next-feature --slug <s> --from <REQ or contract> --body <text>` | Capture a change to Agreed text or a contract path; it waits for the developer. |
| `outside <item-sha> --reason <text>` | Record that a captured item is not this commitment's work. |
| `fold` | After Done, append every inbox item this clone holds, its own and those fetched, to the log as an ordinary item; an item whose slug the log holds with a different item is reported and left in its inbox. |
| `retire <item>... --quote <words>` | Record that the developer dropped one or more backlog or next-feature items, or that a spec change they confirmed answers them, with their words as evidence; a retired item is never promoted or offered again. Refuses a defect and a promoted item. |
| `fix <item-sha>` | Record that a defect item is fixed, naming the workspace snapshot. Runs under the open commitment, or under the last closed one when it raised the defect against its own requirement. |
| `decide --consequential --title <t> --rests-on <REQ,...> --wrong-if <t> --body <t>` | Record a spec-phase deference ruling, before any commitment is open. |
| `decide --consequential --commitment <s> --concern <token>... --question <q> --recommendation <r> --because <b> --if-wrong <w> --instead <i> [--option <t>...] [--path <file>...] [--decision <id>...]` | Record a measured work-loop Consequential decision; the agent continues. Refused without a current `composite`-outcome measurement: `sudus: no measurement for this exact draft; run sudus measure first` when the draft differs from the one measured, or a message naming the floor or veto that caught it. |
| `realize <decision-id> --subject <text>` | Record that a Consequential decision was built. |
| `escalate [--consequential] --commitment <s> --concern <token>... --question <q> --recommendation <r> --because <b> --if-wrong <w> --instead <i> [--option <t>...] [--path <file>...] [--decision <id>...]` | Raise a decision; without `--consequential`, a Blocking one (the agent stops). With `--consequential`, the Consequential draft's own measurement forced it here, or the agent chose to. |
| `calibrate` | Report how many labelled, suggested-agent measurements exist and how many were wrong, against the fixed bound; tunes the composite, never gates it. |
| `measure [--brief] [--harness <name>] --commitment <s> --concern <token>... --question <q> --recommendation <r> --because <b> --if-wrong <w> --instead <i> --option <t>... [--path <file>...] [--decision <id>...]` \| `measure <slug> --file <path>` | Take one measurement of a Consequential draft before `decide` or `escalate`; `--brief` prints a launch block for the review source, `--file` completes it. |
| `answer <slug> ok\|instead\|ask --quote <words> [--escalation <sha>]` | The developer's answer to an escalation, in their own words. |
| `reply <slug> <text> [--escalation <sha>]` | The agent's explanation after a developer `ask`. |
| `review <slug> --file <path>` | Record the builder's review. |
| `review mechanism <REQ> [<fail-receipt>]` | Bind a mechanism's review metadata to its current command, working directory and results mode and the requirement's current text; the latest fail receipt for REQ that ran under them when none is given. |
| `brief <slug> [--harness <name>]` | Write the adversary brief for a reviewed commitment and print how to start the adversary. |
| `report <slug> --file <path>` | Record the adversary's report. |
| `resolve <slug> <n> "<how>" [--source <sha>]` | Record a fix for finding `n` of a specific review or report record. |
| `decline <slug> <n> "<why>" [--source <sha>]` | Record that the agent declines finding `n`, with its reason. |
| `push` | Push the branch, both durable refs and this clone's inbox to the authority remote, then fetch every other clone's inbox. |
| `wake` | Print the current verdict. Writes nothing. |
| `--help` | Print the command list. `sudus <command> --help` (or `-h`) prints that command's usage line and runs nothing. |
| `--version` | Print the version; the first thing to compare with this manual when behavior differs. |

## Record reference

Every durable fact is one of these record kinds, a commit on
`refs/sudus/log`, or a line in `docs/decisions.jsonl`. `sudus show <sha>`
prints any log record. This table names what each kind carries and where
Sudus reads it back; the full field list is in
[the specification](spec/sudus-v2.md#4-the-record-set).

| Kind | Carries | Read at |
|---|---|---|
| `init` | Settings digest, authority remote or local-only, developer-auth mode. | Every project command. |
| `authorization` | Spec, agreement, and settings digests; developer-auth evidence. | `start` and every protected write. |
| `direction` | `instead` or `ask` on an authorization, the developer's words, harness, Git author. | Nothing; the log keeps it. |
| `command-intent` / `command-abort` | A multi-record write's plan, or its verified rollback. | `wake` and `recover`, until finished. |
| `start` | Slug, roadmap workspace snapshot, the frozen requirement set with text digests, and the clone that started it. | Every wake; opens the range; routes item capture. |
| `receipt` | Mechanism and definition digest, input snapshot, per-requirement result and text digest, output digest. | Freshness and attempt counting. |
| `review` | Slug, workspace snapshot, the six answers, findings. | Brief, report, Done. |
| `brief` | Slug, review sha, harness, model, brief digest, the decisions it lists. | Report validation. |
| `report` | Slug, workspace snapshot, brief sha, attempts, interface attempts, rated findings, or the Sudus bug it stopped on. | Done, resolution and decline. |
| `resolution` | Source record sha, finding number, workspace snapshot, explanation. | Done and the review report. |
| `decline` | Source record sha, finding number, the agent's reason. | Done and the review report. |
| `acceptance` | Written by Sudus 3 only: report sha, workspace snapshot, accepted/rejected resolutions, new findings. A rejected resolution leaves its finding open; its findings still count. | Done. |
| `escalation` | Slug, the five fields, concern reference. | Every wake, until answered. |
| `answer` | Escalation sha, `ok`/`instead`/`ask`, the developer's words, developer-auth evidence. | Wake, ADR, calibration. |
| `reply` | Escalation sha, text. | Wake, after `ask`. |
| `read` | Decision id, developer-auth evidence. | Queue and ADR. |
| `evaluation-intent` / `evaluation-call` / `measurement` | The evaluator's fixed request, the one attempted call, and the five scored dimensions, composite, veto and suggestion. | Escalation, decide, queue, calibration. |
| `calibration` | Policy digest, sample, false-downgrade count, bound, pass/fail. | Tuning `weights`, `agent_ceiling` and `confidence_floors`; never a gate. |
| `item` | Kind (backlog/next-feature/defect), slug, source, body. | Capture, Done, next feature. |
| `outside` | Item sha, reason. | Capture gate. |
| `retirement` | Item shas, the developer's evidence. | Promotion, Done, next feature. |
| `promotion` | Item sha, decision id. | After Done. |
| `fix` | Item sha, workspace snapshot. | Done. |
| `scope-breach` / `scope` | Path, first-observed snapshot, allowed base, disposition. | Every wake, until disposed. |
| `done` | Slug, final workspace snapshot. | Closes the range. |
| `superseded` | Slug, old start sha, decision id, successor slug, carried records. | Closes the old range; the successor start. |
| ADR `decision` / `realized` / `superseded` / `answered` / `read` | One canonical JSON line each in `docs/decisions.jsonl`. | `sudus decisions`, wake, calibration. |

## Installation details

See the [README](../README.md#install) for the marketplace and checkout
install paths. In every path, the agent installs the shim `bin/sudus.sh`
at `$HOME/.local/bin/sudus`, once; the shim runs the newest installed
Sudus (`$SUDUS_ROOT` or `$CAIRN_ROOT` when set, else the newest Claude Code or
Codex plugin cache entry under either name or the checkout, by version), so
a plugin update never strands the command. A pin does: `$SUDUS_ROOT` or
`$CAIRN_ROOT` set to a versioned plugin cache entry keeps running that
version after an update. The pin must be an absolute path; a relative one
is refused, since the file it named would depend on the current directory.
When the pinned version is older than the plugin,
the hooks run the plugin's own copy and name the variable to unset. The skill replaces only a symlink an earlier Sudus made or an
older copy of the shim, never another file; no hook writes it. Claude Code and
Codex read `hooks/hooks.json` (SessionStart, UserPromptSubmit, Stop);
Muse reads two entries (SessionStart, Stop) from
`.muse-plugin/plugin.json`. Every hook prints the current wake verdict, in
one line, at most, beyond that. The exception is Codex's stop hook: the
per-turn hook already gives the agent the verdict, so at stop a routine
verdict prints nothing, and only a version problem or a failed wake is
shown, as one `systemMessage` object (Codex reads a Stop hook's output
as JSON). A stop hook registered by hand in Codex takes the argument
`codex`. No hook writes a file, commits, refuses a
stop, or counts anything; a harness without hooks relies entirely on the
working agreement in `AGENTS.md`.

`sudus --root DIR` does not exist in this version; run commands from your
project's repository root. There is no separate status command; `sudus
wake` is how you see the current position.

The following diagram shows the install process, from a harness with no
Sudus to the command, hooks and skills being available.

```mermaid
flowchart TB
  start(["Start: a harness with no Sudus"])
  prereq{"node and git available?"}
  missing(["Stop: name the missing prerequisite"])
  harness{"Which harness?"}
  cc["Claude Code or Codex: install the Sudus plugin, hooks registered by the plugin"]
  muse["Muse: install the Sudus plugin, hooks registered by the plugin"]
  other["Any other agent: install the skills, then run /install-sudus, register hooks where supported"]
  nohooks["No hook system: instruction-only, the working agreement is the enforcement"]
  link["/install-sudus installs the shim bin/sudus.sh at ~/.local/bin/sudus, once; it runs the newest installed Sudus; no project remote is selected here"]
  path{"~/.local/bin on PATH?"}
  addpath["Tell the developer to add it, no hook edits the shell"]
  help{"sudus --help prints the command list?"}
  broken(["Stop: name the failure, link target, PATH or node"])
  project{"Initialized Sudus project?"}
  wake["Session-start hook prints the verdict and predicate"]
  choose["Choose /new-project or /existing-project, the chosen flow runs sudus init"]
  done[["Done: command and skills are available, hooks are registered where supported"]]

  start --> prereq
  prereq -->|"no"| missing
  prereq -->|"yes"| harness
  harness -->|"Claude Code, Codex"| cc
  harness -->|"Muse"| muse
  harness -->|"other"| other
  other -->|"no hooks"| nohooks
  cc --> link
  muse --> link
  other --> link
  nohooks --> link
  link --> path
  path -->|"no"| addpath
  path -->|"yes"| help
  addpath --> help
  help -->|"no"| broken
  help -->|"yes"| project
  project -->|"yes"| wake
  project -->|"no"| choose
  wake --> done
  choose --> done
```

The Graphviz source is docs/diagrams/install.dot.

## Where these explanations come from

This manual describes the source in this checkout. The CLI enforces
record structure, freshness, and precedence; the skills and the working
agreement instruct the agent how to reason and when to stop.

| Behavior explained here | Implementation |
|---|---|
| Verdicts, actions, and precedence | `lib/wake.mjs` |
| The command table and `--help` | `lib/cli.mjs` |
| Requirement grammar and the spec lint | `lib/spec.mjs` |
| Settings validation | `lib/settings.mjs` |
| Mechanisms, receipts, and freshness | `lib/mechanisms.mjs`, `lib/check.mjs` |
| The action lease and crash recovery | `lib/lease.mjs`, `lib/tx.mjs` |
| Commitments, items, and the ADR | `lib/commitment.mjs`, `lib/adr.mjs` |
| Scope breaches | `lib/scope.mjs` |
| Escalations and answers | `lib/escalate.mjs` |
| Review, the brief, and the adversary | `lib/review.mjs` |
| The evaluator | `lib/evaluate.mjs`, `bin/typesafeai.mjs` |
| Pushing the durable refs | `lib/travel.mjs` |
| Starting a project and confirming behavior | `skills/new-project/SKILL.md`, `skills/existing-project/SKILL.md`, `skills/next-feature/SKILL.md` |
| The agent's per-turn and per-project responsibilities | `skills/new-project/templates/AGENTS.md` |
| Reporting a defect in Sudus itself, and updating when it is fixed | `skills/report-sudus-issue/SKILL.md` |

Tests under `tests/` exercise each module named above; run `npm test` in
this checkout.
