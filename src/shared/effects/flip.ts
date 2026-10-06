import { flag, type EffectSpec } from './spec'

export const order = 100

export const effect: EffectSpec = {
  kind: 'flip',
  label: 'Flip',
  category: 'distort',
  description:
    'Flips the picture left-to-right, top-to-bottom, or both. For matching screen direction between two shots, or correcting a mirrored recording. Text in the shot reads backwards after a horizontal flip.',
  params: {
    horizontal: {
      type: 'boolean', label: 'Horizontal', default: true,
      description: 'Swap left and right.'
    },
    vertical: {
      type: 'boolean', label: 'Vertical', default: false,
      description: 'Swap top and bottom.'
    }
  },
  isIdentity: (p) => !flag(p, 'horizontal') && !flag(p, 'vertical')
}
