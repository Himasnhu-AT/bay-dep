/**
 * An agent conversation as files a person can read and a bug report can carry.
 *
 * Two views of one conversation, because they differ in the way that matters when something went
 * wrong: the panel's log is what the *user* saw (pins as chips, skills highlighted), and Claude
 * Code's own session file is what the *model* saw (pinned context spelled out, skill bodies
 * injected, every tool result in full). A transcript that only had one of them could not answer
 * "did the agent misread me, or did I send it something other than I thought?".
 */

import type { AgentEntry } from './agent'

/** The panel's log as markdown: turns, tool calls with arguments and results, proposals. */
export function transcriptMarkdown(projectName: string, log: readonly AgentEntry[], exportedAt: string): string {
  const out: string[] = [`# bay agent transcript — ${projectName}`, '', `_Exported ${exportedAt}_`, '']
  const fence = (text: string, lang = ''): string[] => ['```' + lang, text, '```']
  for (const entry of log) {
    switch (entry.kind) {
      case 'user':
        out.push('## You', '')
        if (entry.pins && entry.pins.length > 0) {
          out.push(`Pinned: ${entry.pins.map((pin) => '`' + JSON.stringify(pin) + '`').join(', ')}`, '')
        }
        out.push(entry.text, '')
        break
      case 'assistant':
        out.push('## Agent', '', entry.text, '')
        break
      case 'thought':
        out.push(...entry.text.split('\n').map((line) => `> ${line}`), '')
        break
      case 'tool':
        out.push(`**Tool** \`${entry.tool}\` — ${entry.state}`, '', ...fence(JSON.stringify(entry.args, null, 2), 'json'), '')
        if (entry.result) out.push('<details><summary>Result</summary>', '', ...fence(entry.result), '', '</details>', '')
        break
      case 'proposal':
        out.push(`### Proposal: ${entry.proposal.question}`, '')
        for (const option of entry.proposal.options) {
          out.push(`- **${option.label}** — ${option.summary}`)
          for (const op of option.operations) out.push(`  - \`${op.tool} ${JSON.stringify(op.args)}\``)
        }
        out.push('')
        break
      case 'error':
        out.push(`**Error:** ${entry.text}`, '')
        break
      case 'changes':
        out.push(`### Changes${entry.state === 'applied' ? '' : ` (${entry.state})`}`, '')
        if (entry.note) out.push(`_${entry.note}_`, '')
        for (const line of entry.lines) out.push(`- ${line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : '~'} ${line.text}`)
        out.push('')
        break
    }
  }
  return out.join('\n')
}

/**
 * The folder Claude Code keeps a working directory's sessions in, under `~/.claude/projects`.
 * Every character that is not a letter or digit becomes `-` — read off a real path, not a guess:
 * `/Users/x/Library/Application Support/bay/agent-workspace` is kept as
 * `-Users-x-Library-Application-Support-bay-agent-workspace`.
 */
export function claudeProjectFolder(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

/** A filesystem-safe folder name for one export. */
export function transcriptFolderName(projectName: string, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const name = projectName.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'project'
  return `bay-transcript-${name}-${stamp}`
}
