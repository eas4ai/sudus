// What `sudus wake` printed, read into one record, and what the band above the prompt and the
// face say about it. Pure functions: no engine, no I/O, so tests/mod-verdict.test.ts runs them alone.

import type { Expression } from './figure.ts'

export type Verdict =
  | {
      kind: 'verdict'
      verdict: 'Resolvable' | 'Waiting' | 'Done'
      action: string | null
      target: string | null
      party: string | null
      question: string | null
      reason: string
      predicate: string
      layout: string | null
      exit: number
    }
  | { kind: 'line'; line: string; exit: number }
  | { kind: 'missing'; detail: string }
  | { kind: 'none' }

// A working tree with neither .sudus/settings.json nor .cairn/settings.json does not use Sudus:
// wake is not run there, the band draws nothing and the pane says so.
export const SETTINGS_FILES: readonly string[] = ['.sudus/settings.json', '.cairn/settings.json']

// Whether the session's directory belongs to a Sudus project: a settings file of either layout in
// it or an ancestor, up to the working tree's root, the first directory holding .git (a directory
// in the main tree, a file in a linked worktree, whose own branch may be the only one on Sudus).
export async function usesSudus(cwd: string, exists: (path: string) => Promise<boolean>): Promise<boolean> {
  let dir = cwd.replace(/\/+$/, '')
  for (;;) {
    for (const f of SETTINGS_FILES) if (await exists(`${dir}/${f}`)) return true
    if (dir === '' || await exists(`${dir}/.git`)) return false
    dir = dir.slice(0, dir.lastIndexOf('/'))
  }
}

// Whether `$.process.run` rejected because the command cannot start, the one case the mod runs
// this plugin's own copy instead; a command that is only slow is reported, never replaced.
export function cannotStart(err: unknown): boolean {
  return /failed to start|\bENOENT\b/.test(String(err))
}

// The actions wake names with more than one word (lib/wake.mjs ORDER), read whole before the target.
export const MULTI_WORD_ACTIONS: readonly string[] = ['review mechanism']

function splitAction(act: string): [string, string | null] {
  const multi = MULTI_WORD_ACTIONS.find(a => act === a || act.startsWith(`${a} `))
  const sp = multi !== undefined ? multi.length : act.indexOf(' ')
  return sp < 0 ? [act, null] : [act.slice(0, sp), act.slice(sp + 1) || null]
}

// Wake prints `key: value` lines: verdict; `action: <word> <target>` for Resolvable,
// `commitment: <slug>` for Done, `party:` and the escalation's `question:` for Waiting; reason,
// predicate, and a `layout:` line on a project still on the former layout. An exit of 3 is one
// line naming a repair or a skill; 4 is Waiting with no developer to answer.
export function parseWake(stdout: string, exitCode: number): Verdict {
  const lines = stdout.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0)
  const fields = new Map<string, string>()
  for (const line of lines) {
    const m = /^([a-z]+): (.*)$/.exec(line)
    if (m) fields.set(m[1]!, m[2]!)
  }
  const verdict = fields.get('verdict')
  if (verdict === 'Resolvable' || verdict === 'Waiting' || verdict === 'Done') {
    const act = fields.get('action') ?? null
    const [action, actionTarget] = act === null ? [null, null] : splitAction(act)
    return {
      kind: 'verdict',
      verdict,
      action,
      target: fields.get('commitment') ?? actionTarget,
      party: fields.get('party') ?? null,
      question: fields.get('question') ?? null,
      reason: fields.get('reason') ?? '',
      predicate: fields.get('predicate') ?? '',
      layout: fields.get('layout') ?? null,
      exit: exitCode,
    }
  }
  const line = lines.find(l => l.startsWith('sudus:')) ?? lines[0]
  if (line !== undefined) return { kind: 'line', line, exit: exitCode }
  return { kind: 'missing', detail: `sudus wake printed nothing (exit ${exitCode})` }
}

// The face for a verdict: thinking while a turn runs; idle with work to do or no Sudus project;
// unsure while the developer owes an answer; mad when no one can answer; sick on a repair or
// outside a project; sleepy when wake cannot be reached; happy at Done.
export function expressionOf(v: Verdict, isTurnRunning: boolean): Expression {
  if (isTurnRunning) return 'thinking'
  if (v.kind === 'none') return 'idle'
  if (v.kind === 'missing') return 'sleepy'
  if (v.kind === 'line') return 'sick'
  if (v.verdict === 'Done') return 'happy'
  if (v.verdict === 'Waiting') return v.exit === 4 ? 'mad' : 'unsure'
  return 'idle'
}

// What the band above the prompt says, for a person rather than for the agent: the state in a
// word and its colour, then what happens next in plain words, with no record hashes or kernel
// terms. The agent reads wake itself; the pane keeps the reason and the predicate for anyone who
// wants them. Only a question the developer owes an answer to gets a line of its own.
export type Band = { label: string; color: 'green' | 'yellow' | 'cyan' | 'red'; subject: string; lines: string[] }

// A 40-hex record or snapshot hash cut to the 7 characters Git shows.
export const shortHashes = (text: string): string => text.replace(/\b([0-9a-f]{7})[0-9a-f]{33}\b/g, '$1')

// A finding's target is "<commitment> <n>".
const finding = (t: string): string => {
  const m = /^(\S+) (\d+)$/.exec(t)
  return m ? `review finding ${m[2]} on ${m[1]}` : t
}

// What each action wake names means, as the next step in plain words (lib/wake.mjs ORDER and the
// actions its predicates name besides).
const NEXT: Record<string, (target: string) => string> = {
  repair: t => `repairing ${t}`,
  recover: () => 'finishing an interrupted Sudus command',
  reconcile: () => 'closing a step that did not finish',
  scope: t => `settling a change to ${t} outside the plan`,
  supersede: t => `replacing ${t}, whose agreed text changed`,
  fix: t => `fixing the defect ${t}`,
  record: t => `committing ${t} before the checks run`,
  commit: t => `committing ${t}`,
  declare: t => `writing the check for ${t}`,
  run: t => `running the check for ${t}`,
  implement: t => `making ${t} pass`,
  escalate: t => `preparing a question for you about ${finding(t)}`,
  'review mechanism': t => `reviewing the check for ${t}`,
  capture: t => `recording ${t}`,
  review: t => `reviewing the work on ${t}`,
  report: t => `independent review of ${t}`,
  resolve: t => `fixing ${finding(t)}`,
  accept: t => `independent check of the fixes on ${t}`,
  build: () => 'carrying out a recorded decision',
  backlog: () => 'moving a set-aside decision to the backlog',
  done: t => `closing ${t}`,
  fold: t => `bringing in ${t}, captured on another clone`,
  promote: t => `starting the next commitment, ${t}`,
  reply: t => `answering your question about ${t}`,
}

export function nextStepOf(action: string | null, target: string | null): string {
  const t = target ?? ''
  const say = action === null ? undefined : NEXT[action]
  return shortHashes(say ? say(t) : `${action ?? ''} ${t}`.trim())
}

// A one-line refusal or repair hint, without the `sudus: ` prefix or the command it names for the
// agent: "sudus: no commitment started; run /new-project" reads "no commitment started".
const plainLine = (line: string): string => shortHashes(line.replace(/^(sudus|cairn): /, '').replace(/;\s*(run|see) .*$/, ''))

export function bandOf(v: Verdict): Band | undefined {
  if (v.kind === 'none') return undefined
  if (v.kind === 'missing') return { label: 'Not answering', color: 'red', subject: /cannot start/.test(v.detail) ? 'the sudus command cannot start' : 'sudus wake did not finish', lines: [] }
  if (v.kind === 'line') return { label: v.exit === 3 ? 'Setup' : 'Problem', color: 'red', subject: plainLine(v.line), lines: [] }
  if (v.verdict === 'Done') return { label: 'Done', color: 'cyan', subject: v.target ?? '', lines: [] }
  if (v.verdict === 'Waiting') {
    if (v.exit === 4) return { label: 'Stuck', color: 'yellow', subject: 'a question waits and no developer is here to answer it', lines: v.question ? [shortHashes(v.question)] : [] }
    return { label: 'Your answer needed', color: 'yellow', subject: '', lines: v.question ? [shortHashes(v.question)] : [] }
  }
  return { label: 'Working', color: 'green', subject: nextStepOf(v.action, v.target), lines: [] }
}

// Whether a Bash command can change the verdict: any sudus or cairn invocation, or a git commit.
export function changesVerdict(command: string): boolean {
  return /(^|[\s;&|(])(sudus|cairn)(\s|$)/.test(command) || /\bgit\s+(commit|checkout|switch|reset|revert|merge|rebase|pull|stash)\b/.test(command)
}
