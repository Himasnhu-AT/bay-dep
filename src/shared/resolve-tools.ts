/**
 * Which of the Resolve connector's tools bay's in-app agent is given, by name.
 *
 * The connector (samuelgursky/davinci-resolve-mcp, compound mode) publishes 36 tools, each a
 * group of actions behind an `action` argument. bay's in-app agent has no shell and no
 * filesystem on purpose, and text it reads — a transcript, a clip name, a marker note in someone
 * else's Resolve project — can carry a prompt injection. A tool that runs a script or installs a
 * plugin would hand an injected instruction the whole machine, so those are **withheld**: named
 * here with the reason, absent from the allow-list, and so denied by the CLI and the SDK
 * (`--permission-prompts none`).
 *
 * The list is every tool, not only the allowed ones, so a connector update that adds a 37th
 * shows up as a tool nobody has decided about: the allow-list is built from exact names and
 * cannot let it in. Read from `src/server.py` of connector 2.103.3 (36 `@mcp.tool` functions
 * taking `action`); `resolve-tools.test.ts` holds the names as a literal.
 *
 * **What this cannot do.** A compound tool is allowed or withheld whole. Several allowed tools
 * hold an action that writes a file to a path the caller names (`timeline` `export`, `render`,
 * `project_manager` `export_project`/`archive`, `gallery_stills` `export_stills`, `media_pool`
 * `export_metadata`, `folder` `export`, `project_settings` `export_frame_as_still`,
 * `timeline_item_color` LUT export) or deletes Resolve data (`project_manager` `delete`,
 * `media_pool` `delete_timelines`). Withholding those tools would leave nothing to edit with.
 * bay's own path policy (`src/main/mcp/policy.ts`) does not see these calls — they go from the
 * model's process to the connector, never through bay. Narrowing by action needs a filter in
 * front of the connector; it is not built.
 */

export interface ResolveTool {
  name: string
  /** Whether the in-app agent may call it. */
  allowed: boolean
  /** What the tool can reach, in one line. */
  reach: string
  /** For a withheld tool: why. */
  withheld?: string
}

export const RESOLVE_TOOLS: readonly ResolveTool[] = [
  // ── Withheld: runs code, or installs something Resolve will run ─────────────────────────────
  {
    name: 'script_plugin',
    allowed: false,
    reach: 'writes Lua/Python scripts into Resolve’s Scripts folder and runs them',
    withheld:
      '`execute` and `run_inline` run arbitrary Python as a subprocess, or Lua through fusion.RunScript/Execute: a shell by another name'
  },
  {
    name: 'fuse_plugin',
    allowed: false,
    reach: 'writes .fuse (Lua) plugins into Fusion’s Fuses folder; reads and removes them',
    withheld: 'installs Lua that Fusion loads and runs at its next start'
  },
  {
    name: 'dctl',
    allowed: false,
    reach: 'writes .dctl shader source into Resolve’s LUT and ACES folders; reads and removes them',
    withheld: 'installs an extension: source the caller wrote, compiled and run by Resolve on the GPU'
  },
  {
    name: 'fusion_comp',
    allowed: false,
    reach: 'edits a Fusion node graph: tools, inputs, expressions, settings files, render',
    withheld:
      'a Fusion comp is a program: `bulk_set_expressions` sets expressions (Lua), `add_tool` can add script-running and file-writing tools (Fuse, RunCommand, Saver), and `group_settings_*` read and write files at any path'
  },
  {
    name: 'timeline_item_fusion',
    allowed: false,
    reach: 'adds, imports, exports and deletes Fusion comps on a timeline item',
    withheld:
      '`import_comp` loads a .comp file from any path — a comp carries expressions and render scripts — and `export_comp` writes one to any path'
  },
  // ── Withheld: not editing, and wider than a project ─────────────────────────────────────────
  {
    name: 'media_storage',
    allowed: false,
    reach: 'lists volumes and the files of any folder on disk; imports from them',
    withheld:
      'a directory listing of the whole disk is a filesystem tool, which the in-app agent does not have; import goes through `media_pool` by the path of a file bay already knows'
  },
  {
    name: 'layout_presets',
    allowed: false,
    reach: 'saves, loads, deletes, imports and exports Resolve UI layout presets by file path',
    withheld: 'changes the user’s Resolve workspace, not the project, and reads/writes preset files at any path'
  },
  {
    name: 'render_presets',
    allowed: false,
    reach: 'imports and exports render and burn-in presets by file path; deletes burn-in presets',
    withheld: 'app-wide presets read from and written to any path; rendering itself needs only `render`'
  },
  {
    name: 'project_manager_cloud',
    allowed: false,
    reach: 'creates, loads, imports and restores Blackmagic Cloud projects',
    withheld: 'reaches the network (Blackmagic Cloud) with settings the caller writes'
  },
  {
    name: 'project_manager_database',
    allowed: false,
    reach: 'lists Resolve’s project databases and switches the current one',
    withheld: 'switching database closes the user’s project and can point Resolve at a network database'
  },
  {
    name: 'setup',
    allowed: false,
    reach: 'reads and writes the connector’s own saved defaults (analysis, markers, update policy)',
    withheld: 'persistent connector configuration, kept across conversations; not part of any edit'
  },
  // ── Allowed ─────────────────────────────────────────────────────────────────────────────────
  {
    name: 'resolve_control',
    allowed: true,
    reach:
      'launches and quits Resolve, switches page, polls background jobs, api_truth ledger; also user-preference presets by path, a loopback-only control panel, and the connector’s update check (GitHub releases, no caller data)'
  },
  {
    name: 'project_manager',
    allowed: true,
    reach: 'lists, creates, loads, saves, closes and deletes projects; imports, exports, archives and restores by path'
  },
  { name: 'project_manager_folders', allowed: true, reach: 'navigates, creates and deletes Project Manager folders' },
  {
    name: 'project_settings',
    allowed: true,
    reach: 'project name, settings (frame rate, resolution), presets, colour groups; inserts audio, exports a still by path'
  },
  {
    name: 'render',
    allowed: true,
    reach: 'render jobs, formats, codecs, presets; renders to a target folder the caller names'
  },
  {
    name: 'media_pool',
    allowed: true,
    reach: 'bins, clips and timelines: imports media and timelines by path, creates timelines from clips, relinks, deletes'
  },
  { name: 'folder', allowed: true, reach: 'a bin’s clips and subfolders; transcription and Resolve AI analysis; exports a bin by path' },
  {
    name: 'media_pool_item',
    allowed: true,
    reach: 'a clip’s metadata, properties, colour, proxy and replacement media (by path), marks'
  },
  { name: 'media_pool_item_markers', allowed: true, reach: 'markers and flags on a media pool clip' },
  {
    name: 'media_analysis',
    allowed: true,
    reach:
      'runs ffmpeg/whisper locally over clips, writes reports under its own analysis folder, publishes metadata and markers; reaches an HTTP transcription service only if the connector’s environment names one'
  },
  { name: 'timeline_versioning', allowed: true, reach: 'archives, lists, diffs and restores timeline versions' },
  {
    name: 'edit_engine',
    allowed: true,
    reach: 'plans and executes selects, tighten, silence-ripple and swap edits; execute builds a new timeline, behind a confirm token'
  },
  {
    name: 'timeline',
    allowed: true,
    reach: 'tracks, items, ranges, titles, generators, settings; imports and exports timelines (AAF, EDL, FCPXML, DRT) by path'
  },
  { name: 'timeline_markers', allowed: true, reach: 'markers and playhead on the current timeline; thumbnails' },
  { name: 'timeline_frame', allowed: true, reach: 'captures one rendered timeline frame as an image' },
  { name: 'timeline_ai', allowed: true, reach: 'subtitles from audio, scene-cut detection, Dolby Vision analysis, grabbing stills' },
  {
    name: 'timeline_item',
    allowed: true,
    reach: 'one item’s properties: transform, crop, composite, audio, retime, keyframes, enable'
  },
  { name: 'timeline_item_markers', allowed: true, reach: 'markers, flags and clip colour on a timeline item' },
  {
    name: 'timeline_item_color',
    allowed: true,
    reach: 'an item’s grade: CDL, versions, LUTs (applied and exported by path), DRX stills, colour AI tools'
  },
  { name: 'timeline_item_takes', allowed: true, reach: 'takes on a timeline item' },
  { name: 'gallery', allowed: true, reach: 'gallery albums: names, current album, new albums' },
  { name: 'gallery_stills', allowed: true, reach: 'stills in an album: labels, import and export by path, grab-and-export, delete' },
  { name: 'graph', allowed: true, reach: 'colour node graph: LUT by path, node cache and enable, apply a DRX grade, reset grades' },
  { name: 'color_group', allowed: true, reach: 'colour groups: names, clips, pre- and post-clip graphs' },
  { name: 'knowledge', allowed: true, reach: 'the connector’s own guidance documents; needs no Resolve connection' }
]

/** The connector tools the in-app agent may call, by the connector’s own names. */
export const RESOLVE_ALLOWED_TOOLS: readonly string[] = RESOLVE_TOOLS.filter((tool) => tool.allowed).map((tool) => tool.name)

/** The ones it may not, each with its reason. */
export const RESOLVE_WITHHELD_TOOLS: readonly ResolveTool[] = RESOLVE_TOOLS.filter((tool) => !tool.allowed)

/**
 * The allow-list entries for a Resolve server named `server`: one exact `mcp__<server>__<tool>`
 * per allowed tool.
 *
 * Never the bare `mcp__<server>`: Claude Code reads that as every tool the server publishes,
 * which would let in the withheld ones and anything a connector update adds.
 */
export function resolveAllowedToolNames(server: string): string[] {
  return RESOLVE_ALLOWED_TOOLS.map((tool) => `mcp__${server}__${tool}`)
}
