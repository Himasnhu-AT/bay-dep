import { num, type EffectSpec } from './spec'

export const order = 60

export const effect: EffectSpec = {
  kind: 'pixelate',
  label: 'Pixelate',
  category: 'stylize',
  description:
    'Mosaic: the picture in square blocks, each the average of what it covers. For hiding a face or a screen, or a retro look. It covers the whole clip — to pixelate one region, crop a copy of the clip on a track above and pixelate that.',
  params: {
    size: {
      type: 'number', label: 'Block size', caption: 'Size', min: 1, max: 400, step: 1, default: 16, unit: 'px',
      description: 'Side of one block, in timeline pixels. 1 is off.'
    }
  },
  isIdentity: (p) => num(p, 'size') <= 1
}
