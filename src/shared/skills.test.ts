/**
 * bay's agent skills. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BAY_SKILLS, SKILL_SLUG, insertSkill, leadingSkill, skillMarkdown, skillSegments } from './skills'
import { composeMessage } from './pins'
import { TOOLS } from './mcp'

test('every skill has a name the CLI accepts, and no two share one', () => {
  const slugs = BAY_SKILLS.map((skill) => skill.slug)
  for (const slug of slugs) assert.match(slug, SKILL_SLUG, slug)
  assert.equal(new Set(slugs).size, slugs.length)
})

test('a SKILL.md carries the name and a one-line description in its frontmatter', () => {
  const skill = BAY_SKILLS.find((s) => s.slug === 'motion-graphics')!
  const md = skillMarkdown(skill)
  assert.match(md, /^---\nname: motion-graphics\ndescription: ".+"\n---\n\n/)
  assert.ok(md.includes(skill.body))
  // A double quote in a description would close the YAML scalar early.
  const quoted = skillMarkdown({ ...skill, description: 'Say "hi" to it' })
  assert.match(quoted, /description: "Say 'hi' to it"/)
})

test('every tool a skill names is a real bay tool', () => {
  // A skill that tells the agent to call something that does not exist is a failure it will
  // only discover mid-edit, in front of the user.
  const names = new Set(TOOLS.map((tool) => tool.name))
  for (const skill of BAY_SKILLS) {
    for (const [, tool] of skill.body.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)) {
      assert.ok(names.has(tool!), `${skill.slug} names "${tool}", which is not a bay tool`)
    }
  }
})

test('a message starting with a known skill is split into the skill and the rest', () => {
  const found = leadingSkill('/captions from the srt I dropped in')
  assert.equal(found?.skill.slug, 'captions')
  assert.equal(found?.rest, 'from the srt I dropped in')
  assert.equal(leadingSkill('/captions')?.rest, '')
  // Not a skill: an unknown name, a path, or a slash later in the text.
  assert.equal(leadingSkill('/etc/hosts is odd'), null)
  assert.equal(leadingSkill('/nonsense do it'), null)
  assert.equal(leadingSkill('please /captions'), null)
})

test('pins go after a skill, so the CLI still sees /skill first', () => {
  const pins = [{ kind: 'range', fromFrame: 30, toFrame: 60 } as const]
  const message = composeMessage('/captions only this bit', pins, 30)
  assert.match(message, /^\/captions I have pinned these/)
  assert.ok(message.endsWith('only this bit'))
  // Positive control: without a skill, the context block leads as before.
  assert.match(composeMessage('only this bit', pins, 30), /^I have pinned these/)
})

test('choosing a skill adds it where the user is typing, next to any others', () => {
  // The bug: "…using /motion-graphics and /captions" became "/captions …using … and" — the
  // second skill replaced the first and jumped to the front.
  assert.equal(insertSkill('', 'captions'), '/captions ')
  assert.equal(
    insertSkill('edit this video using /motion-graphics and', 'captions'),
    'edit this video using /motion-graphics and /captions '
  )
  // Already mentioned: unchanged, not duplicated.
  assert.equal(insertSkill('use /captions here', 'captions'), 'use /captions here')
})

test('every skill mentioned is found where it was written, and only real skills count', () => {
  const parts = skillSegments('edit this video using /motion-graphics and /captions, then /nope')
  assert.deepEqual(
    parts.map((part) => (part.skill ? `[${part.skill.slug}]` : part.text)),
    ['edit this video using ', '[motion-graphics]', ' and ', '[captions]', ', then /nope']
  )
  // A slash inside a word or a path is not a skill.
  assert.deepEqual(skillSegments('see in/out and /etc/hosts').map((p) => p.skill), [undefined])
})
