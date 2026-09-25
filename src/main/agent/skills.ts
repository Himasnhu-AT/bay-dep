/**
 * bay's skills, written as the project skills of the agent's working directory.
 *
 * Claude Code runs with project settings from this directory and nothing else, so these — and
 * only these — are the skills the in-app agent has. Rewritten on every start: the directory is
 * bay's, the skills ship with the build, and a skill removed or renamed in a new build must not
 * linger from an old one.
 *
 * **Codex gets none written, on purpose.** It does list a project's skills — measured with
 * `codex debug prompt-input` (0.149.1), a `SKILL.md` in `<cwd>/.agents/skills` or
 * `<cwd>/.codex/skills` was listed to the model with its file path — but it loads one by opening
 * that file, and in bay's sandbox it cannot: no shell, and `exec` refuses imports. Measured: asked
 * to read `.agents/skills/talking-head/SKILL.md`, it tried `read_mcp_resource` on the file URL,
 * which bay refused, and quoted nothing. A listed skill it cannot open only sends it looking. So
 * for Codex, main puts each skill the user names into the message itself (`withSkills` in
 * `codex.ts`).
 *
 * No `electron` import, so it runs under `pnpm test`.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BAY_SKILLS, skillMarkdown } from '@shared/skills'

export function installSkills(dir: string): void {
  const root = join(dir, '.claude', 'skills')
  rmSync(root, { recursive: true, force: true })
  for (const skill of BAY_SKILLS) {
    const folder = join(root, skill.slug)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), skillMarkdown(skill))
  }
}
