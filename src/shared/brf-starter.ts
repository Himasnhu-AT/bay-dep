/**
 * The module "New motion graphic" starts from: the first example in `bay://guide/brf` (the guide's
 * "The module" section), so a person and an agent begin from the same page. Held equal to the
 * guide, and run on every frame, by `brf-starter.test.ts` — a starter that fails to compile would
 * be the first thing a new user sees.
 */
export const BRF_STARTER = `import { interpolate, spring } from 'bay'

export const vars = { title: 'Launch day', accent: '#11D1A0' }

export default ({ t, vars }) => (
  <scene duration={4}>
    <rect x="50%" y="56%" w="40%" h={8} radius={4} fill={vars.accent} sx={spring(t, { delay: 0.3 })} />
    <text x="50%" y="48%" size="8%" weight={900} opacity={interpolate(t, [0, 0.4], [0, 1])}>
      {vars.title}
    </text>
  </scene>
)
`
