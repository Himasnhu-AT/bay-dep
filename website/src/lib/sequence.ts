/**
 * The scroll sequence: one real build, one step at a time.
 *
 * A step is a single thing happening. Claude says one sentence, or one tool
 * runs. Never both, and never four calls at once: if two things land on the same
 * scroll the reader cannot tell which one moved the editor, which is the whole
 * point of showing it this way.
 *
 * The build is "Volatility Drag", recorded in ../../docs/native/reel-recipe.md:
 * a 21.429s vertical reel at 1080x1920, 30fps, h264 + AAC, assembled through the
 * MCP tool surface. Every tool name below appears in ../../docs/native/mcp.md.
 *
 * The plate is a re-creation of the interface built from
 * ../../rust/crates/vii-ui/, not a screen capture, and the page says so.
 */

/** The reel's own length, from the recipe. Every time below is in seconds. */
export const REEL = {
  title: "Volatility Drag",
  width: 1080,
  height: 1920,
  fps: 30,
  seconds: 21.429,
  codec: "h264 + AAC",
} as const;

export type ClipKind = "Text" | "Shape" | "Audio";

export type Clip = {
  name: string;
  kind: ClipKind;
  start: number;
  duration: number;
};

export type Lane = {
  label: string;
  clips: Clip[];
};

/**
 * Three element lanes and an audio lane, the shape the app's timeline takes.
 * Clips within a lane never overlap, because a lane holds one clip at a time:
 * that is why the chart sits on its own lane above the panel it is drawn over.
 *
 * A clip appears when the call that creates it runs, matched by name.
 */
export const LANES: Lane[] = [
  {
    label: "Type",
    clips: [
      { name: "Kicker", kind: "Text", start: 0.2, duration: 2.2 },
      { name: "Volatility drag", kind: "Text", start: 2.6, duration: 3.4 },
      { name: "Sigma steps", kind: "Text", start: 6.4, duration: 7.2 },
      { name: "Drag = σ²/2", kind: "Text", start: 14.2, duration: 7.0 },
    ],
  },
  {
    label: "Shapes",
    clips: [
      { name: "Panel", kind: "Shape", start: 5.8, duration: 8.0 },
      { name: "Rule", kind: "Shape", start: 14.2, duration: 7.2 },
    ],
  },
  {
    label: "Chart",
    clips: [{ name: "Bars", kind: "Shape", start: 6.8, duration: 7.0 }],
  },
  {
    label: "Audio",
    clips: [{ name: "Music.mp3", kind: "Audio", start: 0, duration: 21.429 }],
  },
];

export type FrameState = "empty" | "canvas" | "title" | "chart" | "close";

export type Step = {
  /** Which chapter's note is showing while this step is on screen. */
  chapter: number;
  kind: "claude" | "tool" | "key";
  text: string;
  /** The argument summary shown after a tool name. */
  detail?: string;
  /**
   * The chip the app raises: `● Claude · <label>`.
   *
   * Only tools that come back from the planner as commands raise it.
   * `project_create` is answered by the shell before a project is open, and
   * `media_import`, `snapshot` and `render` return before the planner because
   * they touch the disk or the GPU rather than the project model. Putting a chip
   * on a step that would not raise one is the easiest lie on this site to tell.
   */
  chip?: string;
  /**
   * The app's status line, which sits in the toolbar before Save. Only formats
   * the app really produces: `Saved to`, `Exported frame to`, `Exported video
   * to`, `Claude snapshotted`.
   */
  status?: string;
  playhead?: number;
  frame?: FrameState;
  /** Clip names that land on the timeline at this step. */
  adds?: string[];
  /** The clip the inspector is showing from this step on. */
  selects?: string;
  /** Media the app now holds, whether or not the panel lists it. */
  imported?: string;
};

export type Chapter = {
  eyebrow: string;
  title: string;
  body: string;
  /**
   * The same point in one sentence, for a phone. A full paragraph, a 60% editor
   * and a 30% log do not fit in one portrait screen together, and of the three
   * the paragraph is the one that survives being shortened.
   */
  short: string;
};

export const CHAPTERS: Chapter[] = [
  {
    eyebrow: "One",
    short: "The first call makes somewhere to work, on your own machine.",
    title: "It reads the request and opens a project",
    body: "Your instruction went to your own agent, in your own client. Bay is not in that conversation. It is listening on one port, on this machine, for the calls that come out of it, and the first one makes somewhere to work.",
  },
  {
    eyebrow: "Two",
    short: "The file is read off your disk. Nothing is uploaded.",
    title: "The music comes in off your disk",
    body: "Nothing is uploaded and nothing is copied to a server. The file is read from where it already sits on your disk, and from here the agent can cut to it. The media panel on the left is what the editor is holding.",
  },
  {
    eyebrow: "Three",
    short: "One call, one element, one lane. The chip names the tool that just ran.",
    title: "Type and shapes arrive, one call at a time",
    body: "Each call places one element on one lane, and you watch the lane fill. An infographic reel is type and shapes cut to music, so that is what arrives. The chip in the corner is the app naming the tool that just ran.",
  },
  {
    eyebrow: "Four",
    short: "Keyframes with easing, on the same channels the inspector edits.",
    title: "It sets them moving",
    body: "Keyframes with easing, on the same channels the inspector edits. The bars grow from a fixed edge rather than scaling from the middle, and each reveal is timed to finish on the beat instead of starting on it.",
  },
  {
    eyebrow: "Five",
    short: "It asks for a frame and gets an image back, before it renders anything.",
    title: "Then it looks at what it made",
    body: "The agent asks for a frame and gets an image back. This is the part that matters: every defect this reel turned up was caught by looking at a rendered frame, not by a test. A model that cannot see its own output is guessing.",
  },
  {
    eyebrow: "Six",
    short: "The audio is mixed in, and an ordinary MP4 lands in an ordinary folder.",
    title: "Sound, and then a file on your disk",
    body: "The audio lane is mixed into the export rather than dropped from it, and the encode runs through the same path the editor uses. What lands is an ordinary MP4 in an ordinary folder.",
  },
  {
    eyebrow: "Seven",
    short: "Its edit was never a special kind of edit, so undo needed no new feature.",
    title: "And ⌘Z takes it back",
    body: "An agent never touches the project. It hands over the same commands your own clicks produce, applied at one single writer. That is the whole architecture in one keystroke: its edit was never a special kind of edit, so undo was never a feature anyone had to add for it.",
  },
];

export const STEPS: Step[] = [
  // One
  {
    chapter: 0,
    kind: "claude",
    text: "Empty vertical project first, then I will lay the type in before anything moves.",
    frame: "empty",
    playhead: 0,
  },
  {
    chapter: 0,
    kind: "tool",
    text: "project_create",
    detail: "1080×1920 · 30fps",
    frame: "canvas",
  },

  // Two
  {
    chapter: 1,
    kind: "claude",
    text: "Reading the music in off your disk so I can cut to it later.",
  },
  {
    chapter: 1,
    kind: "tool",
    text: "media_import",
    detail: "Music.mp3",
    imported: "Music.mp3",
  },

  // Three
  {
    chapter: 2,
    kind: "claude",
    text: "Type first, then the panel the chart sits on. Each one gets its own lane.",
  },
  {
    chapter: 2,
    kind: "tool",
    text: "add_text",
    detail: "Kicker",
    chip: "add_text",
    adds: ["Kicker"],
    frame: "title",
    playhead: 1.2,
  },
  {
    chapter: 2,
    kind: "tool",
    text: "add_text",
    detail: "Volatility drag",
    chip: "add_text",
    adds: ["Volatility drag"],
    selects: "Volatility drag",
    playhead: 3.4,
  },
  {
    chapter: 2,
    kind: "tool",
    text: "add_text",
    detail: "Sigma steps",
    chip: "add_text",
    adds: ["Sigma steps"],
    playhead: 7.1,
  },
  {
    chapter: 2,
    kind: "tool",
    text: "add_text",
    detail: "Drag = σ²/2",
    chip: "add_text",
    adds: ["Drag = σ²/2"],
    playhead: 15.0,
  },
  {
    chapter: 2,
    kind: "claude",
    text: "Now the panel behind the chart, the bars themselves, and the rule that closes it out.",
  },
  {
    chapter: 2,
    kind: "tool",
    text: "add_shape",
    detail: "Panel",
    chip: "add_shape",
    adds: ["Panel"],
    playhead: 6.6,
  },
  {
    chapter: 2,
    kind: "tool",
    text: "add_shape",
    detail: "Bars",
    chip: "add_shape",
    adds: ["Bars"],
    playhead: 7.4,
  },
  {
    chapter: 2,
    kind: "tool",
    text: "add_shape",
    detail: "Rule",
    chip: "add_shape",
    adds: ["Rule"],
    playhead: 15.2,
  },

  // Four
  {
    chapter: 3,
    kind: "claude",
    text: "Now the motion. The bars grow from the baseline, timed to arrive on a beat rather than set off on one.",
  },
  {
    chapter: 3,
    kind: "tool",
    text: "animate",
    detail: "8 curves, eased",
    chip: "animate",
    frame: "chart",
    playhead: 9.6,
  },

  // Five
  {
    chapter: 4,
    kind: "claude",
    text: "Before I render, here is the frame at 9.6 seconds. The track behind the bars reads light enough for the short column to be short against.",
  },
  {
    chapter: 4,
    kind: "tool",
    text: "snapshot",
    detail: "00:09.60",
    status: "Claude snapshotted 9.60s",
  },

  // Six
  {
    chapter: 5,
    kind: "claude",
    text: "Music underneath, then I will encode it.",
  },
  {
    chapter: 5,
    kind: "tool",
    text: "add_audio",
    detail: "Music.mp3",
    chip: "add_audio",
    adds: ["Music.mp3"],
    playhead: 10.7,
  },
  {
    chapter: 5,
    kind: "tool",
    text: "render",
    detail: "h264 + AAC",
    status: "Exported video to ~/Movies/volatility-drag.mp4",
    frame: "close",
    playhead: 21.429,
  },
  {
    chapter: 5,
    kind: "claude",
    text: "Done. 21.4 seconds, written to ~/Movies/volatility-drag.mp4.",
  },

  // Seven
  {
    chapter: 6,
    kind: "key",
    text: "⌘Z",
    frame: "chart",
    playhead: 9.6,
  },
];

/** Everything the editor is showing after `step` scroll steps. */
export function stateAt(step: number) {
  const i = Math.max(0, Math.min(step, STEPS.length - 1));
  const clips = new Set<string>();
  const media = new Set<string>();
  let status: string | undefined;
  let playhead = 0;
  let frame: FrameState = "empty";
  let selected: string | undefined;
  let canUndo = false;

  for (let n = 0; n <= i; n++) {
    const s = STEPS[n];
    s.adds?.forEach((c) => clips.add(c));
    if (s.imported) media.add(s.imported);
    if (s.status) status = s.status;
    if (s.playhead !== undefined) playhead = s.playhead;
    if (s.frame) frame = s.frame;
    if (s.selects) selected = s.selects;
    if (s.chip) canUndo = true;
  }

  return {
    clips,
    media,
    status,
    playhead,
    frame,
    selected,
    canUndo,
    // The chip belongs to the step you are on, then it clears, the way it clears
    // after 2.5 seconds in the app.
    chip: STEPS[i].chip,
    undoPressed: STEPS[i].kind === "key",
    chapter: STEPS[i].chapter,
  };
}

/** The instruction shown above the figure. */
export const PROMPT =
  "Build the volatility drag reel. Vertical, about twenty seconds, house type on the dark ground, bars that land on the beat. Show me a frame before you render it.";
