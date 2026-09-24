/**
 * The scroll sequence: one real edit, one step at a time.
 *
 * A step is a single thing happening in the agent panel: you send the request,
 * the agent says one sentence, or one tool runs. Never two at once: if two
 * things land on the same scroll the reader cannot tell which one moved the
 * editor, which is the whole point of showing it this way.
 *
 * The edit is real. On 2026-09-24 four stock clips from Pexels (see
 * website/CREDITS.md), an original music bed and an original surf bed were
 * cut into "First light",
 * 18.9s at 1920x1080 and 30fps, in the current app, by calling its own tools in
 * exactly this order, and exported through its loudness-mastered path. Every
 * tool name, argument, frame number and result below is what that session
 * produced, with two shortenings the caption states: file paths and ids are
 * shown by name, and the export's 36 progress polls are shown as two. The
 * agent's sentences were written for the session, and the caption says so.
 *
 * Every tool name here is one in ../../src/shared/tools, and the repository's
 * test suite fails if one is not (src/shared/website-plate.test.ts).
 *
 * The preview's pictures are frames bay itself rendered at each state of the
 * edit (public/plate/still-*.avif), exported one frame at a time while walking
 * the undo history back. The clips' filmstrips are frames of the source files.
 *
 * Time is in frames at the timeline's 30fps, the way the app counts it.
 */

export const REEL = {
  title: "First light",
  width: 1920,
  height: 1080,
  fps: 30,
  frames: 567,
  seconds: 18.9,
  codec: "H.264 + AAC",
  file: "~/Movies/bay/plate-coast2.mp4",
} as const;

/** How many frames the timeline shows across its width, as the app's zoom had it. */
export const VIEW_FRAMES = 600;

export type ClipKind = "video" | "audio" | "brf";
export type TrackId = "V1" | "A1" | "V2" | "A2" | "A3";

export type Clip = {
  id: string;
  /** The asset's name, which is what the app prints on the clip. */
  name: string;
  kind: ClipKind;
  track: TrackId;
  from: number;
  duration: number;
  /** The source's own length in seconds, for the inspector. */
  sourceSeconds: number;
  /** A filmstrip of the source range, public/plate/strip-<name>.avif. */
  strip?: string;
  /** The asset behind a sound item: a video file's sound still says it came from video. */
  assetKind?: "video" | "audio";
  /** Frames of source the waveform's peaks cover, to map them onto the clip as the app does. */
  sourceFrames?: number;
  fadeIn?: number;
  fadeOut?: number;
};

/** The app lists tracks in creation order: V1 and A1 come with a project, V2 and A2 arrive. */
export const TRACKS: { id: TrackId; kind: "video" | "audio" }[] = [
  { id: "V1", kind: "video" },
  { id: "A1", kind: "audio" },
  { id: "V2", kind: "video" },
  { id: "A2", kind: "audio" },
  { id: "A3", kind: "audio" },
];

/** Where each clip lands when it is placed: at its full source length, before its trim. */
export const CLIPS: Clip[] = [
  { id: "music", name: "coast-bed.m4a", kind: "audio", assetKind: "audio", track: "A1", from: 0, duration: 909, sourceSeconds: 30, sourceFrames: 909 },
  { id: "shore", name: "shore.mp4", kind: "video", track: "V1", from: 0, duration: 751, sourceSeconds: 25, strip: "shore" },
  { id: "walk", name: "walk.mp4", kind: "video", track: "V1", from: 135, duration: 183, sourceSeconds: 6, strip: "walk" },
  { id: "rocks", name: "rocks.mp4", kind: "video", track: "V1", from: 279, duration: 374, sourceSeconds: 12, strip: "rocks" },
  { id: "topview", name: "topview.mp4", kind: "video", track: "V1", from: 423, duration: 2088, sourceSeconds: 70, strip: "topview" },
  { id: "title", name: "Title", kind: "brf", track: "V2", from: 0, duration: 144, sourceSeconds: 4.8 },
  { id: "surf", name: "surf.m4a", kind: "audio", assetKind: "audio", track: "A2", from: 0, duration: 720, sourceSeconds: 24, sourceFrames: 720 },
  { id: "walksound", name: "walk.mp4", kind: "audio", assetKind: "video", track: "A3", from: 135, duration: 144, sourceSeconds: 6, sourceFrames: 144 },
];

/**
 * Waveform peaks, measured with ffmpeg into columns and kept at the sources'
 * own level, because the app draws amplitude rather than a normalised shape:
 * the music bed peaks near -16.5 dBFS before mastering, the surf bed near
 * -7.6 and the walking shot's own waves near -6.6.
 */
export const PEAKS: Record<string, { scale: number; peaks: number[] }> = {
  music: {
    scale: 0.15,
    peaks: [
      5, 6, 10, 35, 42, 35, 32, 92, 87, 49, 45, 78, 78, 43, 34, 89, 75, 43, 34, 81, 59, 33, 28, 77, 62, 40, 28, 84,
      57, 38, 35, 80, 60, 34, 30, 82, 63, 40, 28, 90, 58, 38, 34, 88, 56, 35, 26, 86, 45, 32, 24, 80, 41, 34, 24, 81,
      38, 32, 21, 75, 42, 36, 26, 91, 41, 35, 33, 86, 47, 40, 32, 100, 48, 47, 31, 91, 41, 34, 23, 93, 36, 44, 20, 79,
      33, 27, 17, 82, 34, 38, 19, 82, 31, 34, 23, 93, 39, 36, 30, 85, 36, 38, 86, 96, 42, 43, 89, 68, 39, 32, 77, 71,
      36, 27, 81, 72, 38, 24, 78, 63, 28, 26, 87, 57, 40, 30, 87, 60, 48, 42, 80, 72, 49, 38, 95, 61, 50, 40, 84, 65,
      42, 37, 80, 54, 43, 30, 84, 50, 33, 29, 74, 50, 37, 24, 83, 50, 44, 33, 85, 51, 39, 27, 79, 47, 45, 28, 85, 49,
      49, 27, 86, 41, 32, 20, 91, 44, 31, 19, 83, 32, 30, 15, 77, 27, 29, 15, 61, 22, 23, 14, 39, 15, 14, 8, 22, 7, 8,
      2, 1, 0,
    ],
  },
  surf: {
    scale: 0.42,
    peaks: [
      3, 7, 12, 23, 36, 44, 60, 55, 84, 74, 99, 87, 67, 50, 38, 37, 37, 29, 36, 32, 25, 29, 28, 26, 31, 30, 26, 35, 45,
      30, 32, 41, 33, 46, 62, 60, 60, 70, 83, 74, 99, 86, 88, 73, 78, 43, 54, 46, 39, 33, 29, 37, 29, 27, 38, 33, 26,
      35, 32, 31, 26, 26, 29, 35, 34, 38, 39, 58, 56, 73, 97, 76, 100, 87, 88, 81, 68, 66, 53, 50, 42, 32, 35, 34, 27,
      33, 32, 30, 36, 27, 32, 36, 26, 30, 27, 32, 33, 39, 55, 50, 55, 73, 62, 79, 96, 94, 67, 76, 85, 68, 51, 36, 28,
      22, 15, 15, 10, 7, 5, 2,
    ],
  },
  walksound: {
    scale: 0.47,
    peaks: [
      82, 58, 59, 98, 56, 76, 52, 54, 52, 62, 60, 74, 84, 54, 72, 100, 65, 52, 74, 53, 58, 57, 47, 55, 56, 59, 59,
      55, 59, 62, 53, 57, 64, 62, 50, 61, 58, 57, 71, 65, 68, 41, 51, 56, 66, 40, 65, 54, 74, 66, 68, 57, 56, 48,
      37, 63, 52, 38, 62, 78,
    ],
  },
};

/** What the preview shows: nothing yet, or one of the frames bay rendered at that state. */
export const STILLS = [
  "raw-60",
  "graded-60",
  "raw-200",
  "final-40",
  "final-135",
  "v1-400",
  "final-400",
  "final-200",
] as const;
export type Frame = "empty" | (typeof STILLS)[number];

/** The rocks clip's grade, as the inspector's Grade section shows it. */
export type Grade = {
  temp: number;
  tint: number;
  saturation: number;
  /** The wheels, as the inspector's single slider shows each: the mean of r, g and b. */
  lift: number;
  gamma: number;
  gain: number;
  vignette: number;
};

export type Step = {
  chapter: number;
  kind: "user" | "say" | "tool" | "changes";
  text: string;
  /** A tool's arguments, as the card shows them when opened. */
  args?: string;
  /** A tool's result, shown open on the export's last poll. */
  result?: string;
  /** Clips placed at this step. */
  adds?: string[];
  /** Timing a step changes on clips already placed. */
  set?: Record<string, Partial<Pick<Clip, "from" | "duration" | "fadeIn" | "fadeOut">>>;
  keys?: Record<string, number[]>;
  grade?: Record<string, Grade>;
  selects?: string;
  playhead?: number;
  frame?: Frame;
  media?: number;
  /** The walking shot's sound is detached from its picture from here on. */
  detached?: boolean;
  /** Cuts, by frame, that carry a transition from here on. */
  transitions?: number[];
  /** Which part of the inspector is in view for the selection: it scrolls to what the step changed. */
  panel?: "grade" | "transform" | "audio";
};

export type Chapter = {
  eyebrow: string;
  title: string;
  body: string;
  /** The same point in one sentence, for a phone. */
  short: string;
};

export const CHAPTERS: Chapter[] = [
  {
    eyebrow: "One",
    title: "You ask, in the editor",
    short: "Four stock clips, a music bed, a surf bed, and one request.",
    body: "Four clips of a coast at dawn from Pexels, a music bed and a bed of surf. You type into the agent panel; the agent is your own Claude Code, limited to the editor’s tools, and its first call brings the files in from your disk.",
  },
  {
    eyebrow: "Two",
    title: "It finds the beat and cuts to it",
    short: "detect_beats finds 100 bpm, and each clip is trimmed to eight beats.",
    body: "The music goes down first and detect_beats reads its grid: 100 bpm, a beat every 18 frames. Each clip lands at full length and is trimmed to eight beats, so every cut falls on a detected beat.",
  },
  {
    eyebrow: "Three",
    title: "It matches the exposure and the colour",
    short: "A grade per clip: the dark opening lifted, the bright aerial brought down.",
    body: "The dark opening and the bright aerial need to meet. Each clip gets its own grade, the fields the inspector’s Grade section edits, drawn on the GPU the same in the preview and the export.",
  },
  {
    eyebrow: "Four",
    title: "Movement, a title, and dissolves",
    short: "Keyframed pushes and a drift, a .brf title, and a dissolve on every cut.",
    body: "Keyframes give the still shots slow movement; the diamonds on a clip are its keys. The title is a .brf module, motion graphics written as code. Then a one-beat dissolve on each cut, centred on the beat.",
  },
  {
    eyebrow: "Five",
    title: "It looks, and fixes what it sees",
    short: "preview_frame showed the rocks still blue, so it warmed them and looked again.",
    body: "preview_frame renders a frame and hands it back as an image. The title read clear; the rocks still sat blue beside the warm shots, so the agent warmed them and looked again.",
  },
  {
    eyebrow: "Six",
    title: "Sound, a file, and one Revert",
    short: "Surf under everything, real waves on the walk, a mastered MP4, one Revert.",
    body: "The walking shot’s real waves move to their own track, start half a second early, and the music and surf duck under them. The export is mastered to −14 LUFS, and the turn ends with one Revert for all of it.",
  },
];

/** What you typed, in the panel and on the page above the figure. */
export const PROMPT =
  "Cut these four clips into a calm twenty-second piece to coast-bed.m4a, on the beat, with dissolves between them. Match the exposure and warm them up, give the still shots some slow movement, put a title on the opening, and lay surf under all of it, with the real waves heard on the walking shot. Check a frame before you export.";

const SHORE: Grade = { temp: -250, tint: 0, saturation: 0.9, lift: 0.023, gamma: 0.127, gain: 0, vignette: 0.25 };
const ROCKS_V1: Grade = { temp: 600, tint: 0.05, saturation: 0.85, lift: 0, gamma: 0, gain: 0.013, vignette: 0.3 };
const ROCKS_V2: Grade = { temp: 1600, tint: 0.05, saturation: 0.75, lift: 0, gamma: 0, gain: 0.02, vignette: 0.3 };

export const STEPS: Step[] = [
  // One
  { chapter: 0, kind: "user", text: PROMPT, frame: "empty", playhead: 0, media: 0 },
  { chapter: 0, kind: "say", text: "Bringing the four clips, the music and the surf in first." },
  {
    chapter: 0,
    kind: "tool",
    text: "import_media",
    args: '{ "paths": [ "…/shore.mp4", "…/walk.mp4", "…/rocks.mp4", "…/topview.mp4", "…/coast-bed.m4a", "…/surf.m4a" ] }',
    media: 6,
  },

  // Two
  { chapter: 1, kind: "say", text: "Music first, so there is a grid to cut to." },
  {
    chapter: 1,
    kind: "tool",
    text: "place_asset",
    args: '{ "assetId": "coast-bed.m4a", "atFrame": 0 }',
    adds: ["music"],
    selects: "music",
  },
  { chapter: 1, kind: "tool", text: "detect_beats", args: '{ "itemId": "coast-bed.m4a", "markers": "downbeats" }' },
  {
    chapter: 1,
    kind: "say",
    text: "100 bpm: a beat every 18 frames, the first at frame 27. One clip every eight beats, cutting at 135, 279 and 423 and ending on the beat at 567.",
  },
  {
    chapter: 1,
    kind: "tool",
    text: "place_asset",
    args: '{ "assetId": "shore.mp4", "atFrame": 0 }',
    adds: ["shore"],
    selects: "shore",
  },
  {
    chapter: 1,
    kind: "tool",
    text: "edit_item",
    args: '{ "sourceStartSeconds": 3, "durationInFrames": 135 }',
    set: { shore: { duration: 135 } },
  },
  {
    chapter: 1,
    kind: "tool",
    text: "place_asset",
    args: '{ "assetId": "walk.mp4", "atFrame": 135 }',
    adds: ["walk"],
    selects: "walk",
  },
  {
    chapter: 1,
    kind: "tool",
    text: "edit_item",
    args: '{ "sourceStartSeconds": 0.6, "durationInFrames": 144 }',
    set: { walk: { duration: 144 } },
  },
  {
    chapter: 1,
    kind: "tool",
    text: "place_asset",
    args: '{ "assetId": "rocks.mp4", "atFrame": 279 }',
    adds: ["rocks"],
    selects: "rocks",
  },
  {
    chapter: 1,
    kind: "tool",
    text: "edit_item",
    args: '{ "sourceStartSeconds": 1.2, "durationInFrames": 144 }',
    set: { rocks: { duration: 144 } },
  },
  {
    chapter: 1,
    kind: "tool",
    text: "place_asset",
    args: '{ "assetId": "topview.mp4", "atFrame": 423 }',
    adds: ["topview"],
    selects: "topview",
  },
  {
    chapter: 1,
    kind: "tool",
    text: "edit_item",
    args: '{ "sourceStartSeconds": 12, "durationInFrames": 144 }',
    set: { topview: { duration: 144 } },
  },
  {
    chapter: 1,
    kind: "tool",
    text: "edit_item",
    args: '{ "durationInFrames": 567, "fadeOutFrames": 36 }',
    set: { music: { duration: 567, fadeOut: 36 } },
  },
  { chapter: 1, kind: "tool", text: "set_playhead", args: '{ "frame": 60 }', playhead: 60, frame: "raw-60" },

  // Three
  {
    chapter: 2,
    kind: "say",
    text: "The opening is far darker than the aerial at the end. Lifting the shore’s shadows and mids, bringing the aerial down a little, and warming the cool shots so the four sit together.",
  },
  {
    chapter: 2,
    kind: "tool",
    text: "edit_item",
    args: '{ "grade": { "temperature": -250, "saturation": 0.9, "lift": { … }, "gamma": { "r": 0.14, … } } }',
    frame: "graded-60",
    grade: { shore: SHORE },
    selects: "shore",
    panel: "grade",
  },
  { chapter: 2, kind: "tool", text: "edit_item", args: '{ "grade": { "temperature": 350, "saturation": 1.05, … } }' },
  {
    chapter: 2,
    kind: "tool",
    text: "edit_item",
    args: '{ "grade": { "temperature": 600, "tint": 0.05, "saturation": 0.85, … } }',
    grade: { rocks: ROCKS_V1 },
  },
  {
    chapter: 2,
    kind: "tool",
    text: "edit_item",
    args: '{ "grade": { "temperature": 400, "saturation": 0.9, "gain": { "g": -0.05, … } } }',
  },

  // Four
  {
    chapter: 3,
    kind: "say",
    text: "Slow movement on the still shots: a push on the shore and on the rocks, and a drift across the aerial. Then the title over the opening.",
  },
  {
    chapter: 3,
    kind: "tool",
    text: "edit_item",
    args: '{ "keyframes": { "scale": [ 1 → 1.06, "inOut" ] } }',
    keys: { shore: [0, 135] },
    selects: "shore",
    panel: "transform",
  },
  {
    chapter: 3,
    kind: "tool",
    text: "edit_item",
    args: '{ "keyframes": { "scale": [ 1 → 1.08, "inOut" ] } }',
    keys: { rocks: [0, 144] },
  },
  {
    chapter: 3,
    kind: "tool",
    text: "edit_item",
    args: '{ "scale": 1.1, "keyframes": { "left": [ 60 → −60 ] } }',
    keys: { topview: [0, 144] },
  },
  {
    chapter: 3,
    kind: "tool",
    text: "write_brf",
    args: '{ "name": "Title", "atFrame": 0 }',
    adds: ["title"],
    selects: "title",
    media: 7,
  },
  { chapter: 3, kind: "tool", text: "set_playhead", args: '{ "frame": 40 }', playhead: 40, frame: "final-40" },
  { chapter: 3, kind: "say", text: "Dissolves on the three cuts, one beat long, centred on the beat." },
  {
    chapter: 3,
    kind: "tool",
    text: "add_transition",
    args: '{ "kind": "cross-dissolve", "durationInFrames": 18 }',
    transitions: [135],
  },
  {
    chapter: 3,
    kind: "tool",
    text: "add_transition",
    args: '{ "kind": "cross-dissolve", "durationInFrames": 18 }',
    transitions: [135, 279],
  },
  {
    chapter: 3,
    kind: "tool",
    text: "add_transition",
    args: '{ "kind": "cross-dissolve", "durationInFrames": 18 }',
    transitions: [135, 279, 423],
  },
  { chapter: 3, kind: "tool", text: "set_playhead", args: '{ "frame": 135 }', playhead: 135, frame: "final-135" },

  // Five
  {
    chapter: 4,
    kind: "say",
    text: "Checking the title against the brightest part of the sky before going further.",
  },
  { chapter: 4, kind: "tool", text: "preview_frame", args: '{ "frame": 40 }' },
  { chapter: 4, kind: "say", text: "The title reads clear of the sky. Now the rocks, mid-push." },
  { chapter: 4, kind: "tool", text: "preview_frame", args: '{ "frame": 400 }', frame: "v1-400", playhead: 400 },
  {
    chapter: 4,
    kind: "say",
    text: "The rocks still read blue beside the two warm shots before them. Warming them further and taking a little more saturation out of the water.",
  },
  {
    chapter: 4,
    kind: "tool",
    text: "edit_item",
    args: '{ "grade": { "temperature": 1600, "saturation": 0.75, "gain": { … } } }',
    grade: { rocks: ROCKS_V2 },
    selects: "rocks",
    panel: "grade",
    frame: "final-400",
  },
  { chapter: 4, kind: "tool", text: "set_playhead", args: '{ "frame": 400 }', playhead: 400 },
  { chapter: 4, kind: "tool", text: "preview_frame", args: '{ "frame": 400 }' },
  { chapter: 4, kind: "say", text: "That sits with the walking shot now." },

  // Six
  {
    chapter: 5,
    kind: "say",
    text: "Surf under the whole piece, low. The walking shot has the only real waves, so its sound goes on its own track, starts half a second before the picture, and the music and the surf both duck under it.",
  },
  {
    chapter: 5,
    kind: "tool",
    text: "place_asset",
    args: '{ "assetId": "surf.m4a", "atFrame": 0 }',
    adds: ["surf"],
    selects: "surf",
    panel: "audio",
  },
  {
    chapter: 5,
    kind: "tool",
    text: "edit_item",
    args: '{ "durationInFrames": 567, "volume": 0.5, "fadeInFrames": 30, "fadeOutFrames": 36 }',
    set: { surf: { duration: 567, fadeIn: 30, fadeOut: 36 } },
  },
  {
    chapter: 5,
    kind: "tool",
    text: "detach_audio",
    args: '{ "itemIds": [ "walk.mp4" ] }',
    adds: ["walksound"],
    detached: true,
  },
  {
    chapter: 5,
    kind: "tool",
    text: "edit_item",
    args: '{ "audioLeadFrames": 15, "fadeInFrames": 6 }',
    set: { walksound: { fadeIn: 6 } },
  },
  { chapter: 5, kind: "tool", text: "edit_item", args: '{ "duck": { "keyTrackId": "A3", "amountDb": 8 } }' },
  { chapter: 5, kind: "tool", text: "edit_item", args: '{ "duck": { "keyTrackId": "A3", "amountDb": 10 } }' },
  { chapter: 5, kind: "tool", text: "set_playhead", args: '{ "frame": 200 }', playhead: 200, frame: "final-200" },
  {
    chapter: 5,
    kind: "say",
    text: "detach_audio warned that the walking shot’s waves now cut hard where the dissolves used to cross-fade them. The clips either side are silent, so a fade does the same job: nine frames out, into the next dissolve.",
  },
  {
    chapter: 5,
    kind: "tool",
    text: "edit_item",
    args: '{ "fadeOutFrames": 9 }',
    set: { walksound: { fadeOut: 9 } },
    selects: "walksound",
    panel: "audio",
  },
  { chapter: 5, kind: "say", text: "Exporting to your Movies folder, mastered to streaming loudness." },
  {
    chapter: 5,
    kind: "tool",
    text: "export_timeline",
    args: '{ "format": "mp4", "loudness": "streaming", "quality": "best" }',
  },
  { chapter: 5, kind: "tool", text: "track_export", args: '{ "jobId": "081ef89c…" }' },
  {
    chapter: 5,
    kind: "tool",
    text: "track_export",
    args: '{ "jobId": "081ef89c…" }',
    result:
      '"stage": "done", "percent": 100, "outputPath": "…/plate-coast2.mp4", "message": "Mastered to −14.1 LUFS (target −14.0), true peak −1.4 dBTP (ceiling −1.0), measured on the encoded file after 2 passes."',
  },
  {
    chapter: 5,
    kind: "say",
    text: `Done. 18.9 seconds at 1920 × 1080, written to ${REEL.file}.`,
  },
  { chapter: 5, kind: "changes", text: "14 changes" },
];

/** The Changes card the turn ended with: its count and first four lines, word for word. */
export const CHANGES = {
  count: 14,
  lines: ["Imported “shore.mp4”", "Imported “walk.mp4”", "Imported “rocks.mp4”", "Imported “topview.mp4”"],
};

const QUIET = new Set(["preview_frame", "set_playhead", "detect_beats", "track_export", "export_timeline"]);

/** Everything the editor is showing after `step` scroll steps. */
export function stateAt(step: number) {
  const i = Math.max(0, Math.min(step, STEPS.length - 1));
  const clips = new Map<string, Clip>();
  const keys: Record<string, number[]> = {};
  const grades: Record<string, Grade> = {};
  let playhead = 0;
  let frame: Frame = "empty";
  let selected: string | undefined;
  let media = 0;
  let edited = false;
  let detached = false;
  let transitions: number[] = [];
  let panel: Step["panel"];

  for (let n = 0; n <= i; n++) {
    const s = STEPS[n];
    for (const id of s.adds ?? []) {
      const c = CLIPS.find((x) => x.id === id);
      if (c) clips.set(id, { ...c });
    }
    for (const [id, patch] of Object.entries(s.set ?? {})) {
      const c = clips.get(id);
      if (c) clips.set(id, { ...c, ...patch });
    }
    if (s.keys) Object.assign(keys, s.keys);
    if (s.grade) Object.assign(grades, s.grade);
    if (s.playhead !== undefined) playhead = s.playhead;
    if (s.frame) frame = s.frame;
    if (s.selects) {
      selected = s.selects;
      panel = s.panel;
    } else if (s.panel) panel = s.panel;
    if (s.transitions) transitions = s.transitions;
    if (s.media !== undefined) media = s.media;
    if (s.detached) detached = true;
    if (s.kind === "tool" && !QUIET.has(s.text)) edited = true;
  }

  const present = [...clips.values()];
  const trackIds = new Set(present.map((c) => c.track));

  return {
    clips,
    keys,
    grades,
    playhead,
    frame,
    selected: selected ? clips.get(selected) : undefined,
    media,
    edited,
    detached,
    transitions,
    panel,
    duration: present.reduce((m, c) => Math.max(m, c.from + c.duration), 0),
    tracks: TRACKS.filter((t) => t.id === "V1" || t.id === "A1" || trackIds.has(t.id)),
    running: STEPS[i].kind !== "changes",
    chapter: STEPS[i].chapter,
  };
}

/** `m:ss:ff`, the app's timecode. */
export function timecode(frames: number, fps = REEL.fps) {
  const f = Math.round(frames);
  const s = Math.floor(f / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}:${String(f % fps).padStart(2, "0")}`;
}

/**
 * The playhead as a function of scroll progress through the sequence, 0 to 1.
 *
 * Within each step's band it travels from where it was to where that step puts
 * it over the first 60% of the band, then holds, so it moves while you scroll
 * and rests while you read. Used twice, and the two must agree: to write the
 * CSS scroll-driven keyframes, and by the rAF fallback where those do not run.
 */
const TRAVEL = 0.6;

function playheadTargets() {
  const out: number[] = [];
  let p = 0;
  for (const s of STEPS) {
    if (s.playhead !== undefined) p = s.playhead;
    out.push(p);
  }
  return out;
}

export function playheadAt(progress: number) {
  const targets = playheadTargets();
  const n = STEPS.length;
  const x = Math.min(0.999999, Math.max(0, progress)) * n;
  const i = Math.floor(x);
  const from = i === 0 ? targets[0] : targets[i - 1];
  const t = Math.min(1, (x - i) / TRAVEL);
  return from + (targets[i] - from) * (1 - Math.pow(1 - t, 3));
}

/** The playhead's scroll-driven keyframes, as a translate of a layer as wide as the lanes. */
export function playheadKeyframes() {
  const targets = playheadTargets();
  const n = STEPS.length;
  const pct = (f: number) => `${((f / VIEW_FRAMES) * 100).toFixed(3)}%`;
  const lines: string[] = [];
  const at = (p: number, f: number) => lines.push(`${(p * 100).toFixed(3)}% { translate: ${pct(f)} 0; }`);
  for (let i = 0; i < n; i++) {
    const from = i === 0 ? targets[0] : targets[i - 1];
    at(i / n, from);
    // Points on the way, so the linear keyframe interpolation follows the ease.
    for (const t of [0.25, 0.5, 0.75, 1]) {
      at((i + t * TRAVEL) / n, from + (targets[i] - from) * (1 - Math.pow(1 - t, 3)));
    }
  }
  at(1, targets[n - 1]);
  return `@keyframes plate-playhead { ${lines.join(" ")} }`;
}
