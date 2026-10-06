import type { EffectSpec } from './spec'

export const order = 110

export const effect: EffectSpec = {
  kind: 'mirror',
  label: 'Mirror',
  category: 'distort',
  description:
    'Reflects one side of the picture onto the other across a line, making it symmetrical. For a kaleidoscope-style or music-video look. To turn the whole picture around use flip.',
  params: {
    centre: {
      type: 'number', label: 'Mirror line', caption: 'Line', min: 0, max: 1, step: 0.01, default: 0.5,
      description: 'Where the line sits across the clip, 0..1. 0.5 is the middle.'
    },
    vertical: {
      type: 'boolean', label: 'Top and bottom', caption: 'Vertical', default: false,
      description: 'false mirrors left and right across a vertical line; true mirrors top and bottom.'
    },
    reverse: {
      type: 'boolean', label: 'Keep the other side', caption: 'Reverse', default: false,
      description: 'false keeps the left (or top) side and reflects it; true keeps the right (or bottom).'
    }
  },
  // A reflection always replaces part of the picture, wherever the line is.
  isIdentity: () => false
}
