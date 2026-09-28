/**
 * bay's value controls: scrubbable numbers, sliders, faders, knobs, colour wheels, timecode and
 * ease editors. Pure components — every one takes its value and callbacks as props; the store
 * wiring (including the live-edit `Gesture`) stays in the panels that use them.
 */
export { NumberField, type NumberFieldProps } from './NumberField'
export { Slider, SliderField, centredRange, type SliderFieldProps, type SliderProps } from './Slider'
export { type Gesture } from './gesture'
export { MODIFIER_SCALE, modifierScale, type Modifiers } from './values'
