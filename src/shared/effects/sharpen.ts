import { EFFECT_EPSILON, num, type EffectSpec } from './spec'

export const order = 30

export const effect: EffectSpec = {
  kind: 'sharpen',
  label: 'Sharpen',
  category: 'blur',
  description:
    'Unsharp mask: raises the contrast of edges. For soft footage or a screen recording that was scaled. Over about 1.5 it draws halos around edges.',
  params: {
    amount: {
      type: 'number', label: 'Amount', min: 0, max: 3, step: 0.01, default: 0.6,
      description: 'Strength. 0 is off, 0.5 is a visible lift, over 1.5 is harsh.'
    },
    radius: {
      type: 'number', label: 'Radius', min: 0.5, max: 10, step: 0.1, default: 1, unit: 'px',
      description: 'How wide an edge it looks for, in timeline pixels. Small for fine detail.'
    }
  },
  isIdentity: (p) => num(p, 'amount') <= EFFECT_EPSILON
}
