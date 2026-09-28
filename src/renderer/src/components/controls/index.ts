/**
 * bay's value controls: scrubbable numbers, sliders, faders, knobs, colour wheels, timecode and
 * ease editors. Pure components — every one takes its value and callbacks as props; the store
 * wiring (including the live-edit `Gesture`) stays in the panels that use them.
 */
export { NumberField, type NumberFieldProps } from './NumberField'
export { Slider, SliderField, centredRange, type SliderFieldProps, type SliderProps } from './Slider'
export { Fader, type FaderProps } from './Fader'
export { AngleDial, Knob, type AngleDialProps, type KnobProps } from './Knob'
export { ColorWheel, type ColorWheelProps } from './ColorWheel'
export { ColorField, type ColorFieldProps } from './ColorField'
export { TimecodeField, type TimecodeFieldProps } from './TimecodeField'
export { EaseEditor, type EaseEditorProps } from './EaseEditor'
export { type Gesture } from './gesture'
export { MODIFIER_SCALE, modifierScale, type Modifiers } from './values'
