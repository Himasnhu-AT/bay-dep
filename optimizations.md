# bay — measured optimizations

**Status: measured, not yet implemented.** Written 2026-08-30 against the live server on
`127.0.0.1:7333` (101 tools). Every number here came off the wire, not off a reading of the
source. Nothing in this file has been applied yet; each entry says what it would save and what
would verify it.

This is the register of things that are *expensive but correct*, as distinct from
[`fixes.md`](fixes.md), which is the register of things that are *wrong*.

---

## 1. The MCP tool surface

### How to reproduce every number below

```bash
TOK="$(<"$HOME/Library/Application Support/bay/mcp-token")"
curl -s -X POST http://127.0.0.1:7333/mcp \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' > tools.json
python3 -c "import json;t=json.load(open('tools.json'))['result']['tools'];print(len(t),len(json.dumps({'tools':t})))"
# 101 130928
```

### What it costs

**101 tools, 130,928 bytes of `tools/list`** — about **35k tokens** at ~3.7 chars/token.

Who pays that, and when, depends entirely on the client:

| Client | Cost |
|---|---|
| Claude Code | Tools are **deferred**. 101 names ≈ 1.5 KB; schemas load on demand. You pay only for what you fetch. |
| Claude Desktop, plain MCP clients | All 131 KB sits in the system prompt **on every request**, whether you place text or not. |

That split matters more than any restructuring below, and it points the opposite way from the
obvious instinct — see §1.6.

### 1.1 The tool count is not the cost

Median tool is **687 bytes**. The top 15 are **47.2%** of the payload. 29 tools take no required
argument at all; 46 take exactly one.

```
7746  add_text            4408  add_image           2929  apply_move
6912  add_shape           4142  subtitles_to_video  ...
4832  narrate             3941  group_create         229  speech_status
4677  add_video           3507  animate_many         225  effect_remove
4643  animate             3101  project_create       198  element_delete
```

You could delete forty tools the size of `element_delete` and not save one `add_text`. Any plan
that starts by counting tools is optimising the wrong axis.

### 1.2 Where the bytes actually are: six functions

`tools.rs` is **already DRY**. `visual_properties()`, `role_property()`, `tone_property()`,
`caption_properties()`, `kit_properties()` and `duck_properties()` exist, and `merge()` splices
them in. The role essay appears as a string literal in the source exactly **once**.

The duplication is therefore not a source problem — it is a **wire** problem. Each helper expands
into every tool that uses it, and the wire carries N copies of prose the repository stores one
copy of:

| helper | wire bytes | expanded into | share of payload |
|---|---:|---:|---:|
| `visual_properties()` | 18,351 | 12 tools | 14.0% |
| `caption_properties()` | 6,309 | 3 tools | 4.8% |
| `role_property()` | 4,220 | 6 tools | 3.2% |
| `duck_properties()` | 2,862 | 2 tools | 2.2% |
| `kit_properties()` | 2,765 | 5 tools | 2.1% |
| `tone_property()` | 1,841 | 4 tools | 1.4% |
| **total** | **36,348** | | **27.8%** |

**27.8% of the payload is reachable from six functions.** Editing six function bodies moves 36 KB
of wire. That is the whole optimisation, and it is a morning's work.

Per-property, the same fact:

```
property           total B  tools  B/tool
role                  4220      6     703
move                  3510      3    1170
component             2530      2    1265   <- the single most expensive property per tool
tiltX                 2377      6     396
cover                 2160      5     432
framing               1885      5     377
tone                  1841      4     460
captionStyle          1638      3     546
speakerLabels         1539      3     513
```

The five placement tools (`add_text`, `add_image`, `add_video`, `add_shape`, `group_create`) are
**85% shared block** — 21,522 B of common element properties against 3,843 B of tool-specific
ones.

### 1.3 Verbatim duplication, measured

Exact-match repeated property descriptions: **19,901 B (15.2%)**. Repeated enums (>4 members,
>1 tool): **1,718 B (1.3%)**. Total **21,619 B — 16.5%**, removable without deleting a tool.

```
1496  'cover' block          x5   add_text/image/video/shape/group_create
1392  tiltX/tiltY prose      x5   same five
1288  'framing' prose        x5   same five
1220  'role' essay (610B)    x3   add_image/add_video/text_update
1117  runtime component list x2   runtime_install/runtime_remove
 997  'move' description     x2   animate/apply_move
 926  'tone' essay           x3   add_shape/add_text/text_update
 750  37-member move enum    x3   animate/animate_many/apply_move
```

### 1.4 Merging tools is the weaker lever, by about half

Ten plausible merges, modelled as `sum(members) → largest member + ~260 B discriminator`:

```
add_image+add_video -> add_clip      saves  4148B  (3.2%)
animate+apply_move                   saves  2669B  (2.0%)
6x *_list -> catalog(kind)           saves  1873B  (1.4%)
runtime_install+remove               saves  1381B  (1.1%)
4x *_status -> status(component)     saves   690B  (0.5%)
effect_add/set/remove                saves   370B  (0.3%)
snapshot+contact_sheet               saves   329B  (0.3%)
sfx_list+sfx_search                  saves   188B  (0.1%)
transcript_get+search                saves    44B  (0.03%)
element_delete+ripple_delete         saves   -62B  (costs more merged)
──────────────────────────────────────────────────────────
ALL TEN: -22 tools (-22% of the surface)   saves 11,630 B = 8.9%
versus dedup of prose and enums alone:            21,619 B = 16.5%, zero tools removed
```

Deleting a fifth of the surface buys **half** of what rewording six functions buys.

### 1.5 What merging would cost: the cross-reference graph

**77 of 101 tools (76%) name a sibling tool in their own schema.** The surface is a navigable
graph, not a flat list:

```
29 inbound refs  timeline      14  render      12  narrate
10 duck           7  style_pick, job_status, stock_search      6  check
```

`element_move` says *"use element_trim to change its edges, element_source to change which part
of the footage it shows."* `audio_set` says *"never cut a bed into pieces with stepped gains."*
That prose is most of why the descriptions are long, and it is doing real work — it is the same
discipline as [`fixes.md`](fixes.md), applied at the call site.

A merged `element_edit(op: move|trim|slip|split)` collapses those distinctions into an enum value
where the disambiguating advice has nowhere to live. It trades a **loud** failure (unknown tool
name, caught immediately) for a **silent** one (right tool, wrong `op`, a plausible-looking
result). That is the trade this repository has already refused twice — a validator that accepts a
channel nothing reads, a tile naming an effect nothing renders.

### 1.6 Deferred loading inverts the merge incentive

The server's own documented happy path — `project_create → fonts_check → media_import → add_* →
animate → snapshot → check → render` — is **18 tools = 50,347 B = 38%** of the payload. The other
83 tools are **62%** carried and unused on that path.

Under a client with tool search, many narrow tools mean you pay only for what you touch. A few
wide tools mean you always pay the union. `add_image` + `add_video` → `add_clip` saves 3.2%
globally but makes the schema you fetch **to place one image** about 60% larger.

**If bay's primary client is an agent with tool search, optimise for narrow-and-many** and spend
the effort on §2.1 and §2.2 instead. The 131 KB is a Claude-Desktop problem, and the fix for it is
wording, not topology.

---

## 2. The optimizations, ranked

### 2.1 Shorten the six shared helpers — up to ~14% of payload, zero client risk

Highest leverage in the repository per line changed. The prose in `visual_properties()`,
`caption_properties()`, `role_property()`, `duck_properties()`, `kit_properties()` and
`tone_property()` is *project-wide vocabulary* that the model re-reads 12, 3, 6, 2, 5 and 4 times
respectively.

Two ways to cut it, both safe:

- **Trim in place.** The `tiltX` description spends 348 B teaching perspective ("6-12 is a room;
  past 30 is a special effect"). It is good writing and it does not need to appear six times.
- **Hoist to the `instructions` block.** `role`, `tone`, the 37-move registry and `framing` are
  vocabulary, not parameters. The server already ships an instructions block; it is sent once.
  Leave `role: {enum: [...]}` in each tool with a one-line pointer.

Halving the six helpers is ~18 KB, ~14% of the payload, from six function bodies.

**Verified by:** re-running the `tools/list` measurement above; a test asserting
`len(json.dumps(all_definitions()))` stays under a ceiling, so this cannot silently regrow.

> **Do not reach for `$ref`/`$defs` to do this.** Client support for resolving refs inside
> `inputSchema` is inconsistent and has not been verified end-to-end here. A ref the client does
> not resolve is a parameter the model cannot see. Prove it against every target client before
> betting 28% of the surface on it.

### 2.2 Cap the catalog responses — bigger than everything in §1 combined

Response payloads, measured on read-only calls:

```
apply_move  {}   ->  13,446 B    <- one call, 10% of the entire tool payload
looks_list  {}   ->  14,334 B    <- 11%
runtime_status   ->   3,672 B
formats_list     ->   1,533 B
sfx_list         ->   1,529 B
fonts_list       ->   1,531 B
project_info     ->     441 B
```

Two catalog calls cost more context than twenty tool schemas, and `timeline` gets called dozens of
times across a session. On a real project this is the dominant line item, not the 131 KB paid once.

`apply_move{}` and `looks_list{}` dump their whole registry unpaginated. Both should summarise by
default (id + one line) and take a name for detail.

**Verified by:** a test asserting each catalog response stays under a byte ceiling at default args.

### 2.3 Retire the four genuine duplicate surfaces

These are not judgment calls — the server documents each pair as the same operation, and the
schemas are strict supersets:

| superset | contains | duplicated |
|---|---|---:|
| `add_video` | all 20 params of `add_image` | 4,193 B |
| `animate` | all 5 params of `apply_move` | 2,180 B |
| `project_create` | all 3 params of `style_pick` | 877 B |
| `subtitles_to_video` | all 3 params of `style_pick` | 877 B |
| `gen_video` | all 9 params of `gen_image` | 900 B |

Plus two already merged in function but with both surfaces retained:

- `duck(bedId, …)` **is** `audio_set(elementId, duckUnder: […])` — `duck_properties()` is spliced
  into both, at 2,862 B.
- `audio_probe(mediaId)` **is** `media_import(mediaId)` — `media_import`'s own description says
  *"Same answer as audio_probe."*

Keeping both surfaces is defensible as discoverability. Keeping both *and* paying for the full
parameter essay twice is not. Where a pair survives, the second one should carry a one-line
description pointing at the first.

### 2.4 Move `installable_detail()` out of two schemas and into a response

`component` costs **2,530 B across 2 tools — 1,265 B each**, the most expensive property per tool
in the surface. It is the full six-component install catalog with sizes and rationale, and it is
carried by `runtime_install` *and* `runtime_remove`.

That catalog is an answer to *"what can I install?"*, which is `runtime_status`'s job. Reduce the
schemas to `component: {enum: [...]}` and let `runtime_status` carry the prose. **~2.2 KB (1.7%)
for near-zero loss** — you cannot install a component without knowing it exists, and finding out
is one call.

### 2.5 Ship presets over the gating that already exists

`definitions_with(&settings)` already filters `all_definitions()` through
`bay_settings::McpSettings::allows(name)`, and `all_tool_names()` exists to give the settings pane
a row per tool. The machinery for shrinking the surface is **already built and already enforced
headlessly**, which is exactly where CLAUDE.md says that decision belongs.

What is missing is not machinery but **defaults**: named profiles (`edit`, `dialogue`, `deliver`,
`everything`) so a user does not tick 101 boxes. A `dialogue` profile that drops the 40-odd tools
for stock, generation, plan/critic/tournament and shapes would cut the Desktop cost roughly in
half with no code beyond a table.

---

## 3. What not to do, and why

- **Do not merge `element_delete` and `element_ripple_delete`.** Measured, it costs **62 bytes
  more** merged. The two-name split is a safety property: the destructive-with-shift version
  having its own name is the point.
- **Do not merge the `element_*` verbs.** See §1.5. The failure mode changes from loud to silent,
  and it takes the cross-reference prose with it.
- **Do not make the tool list vary with project state.** It is tempting — no project means
  `add_text` cannot work — and `notifications/tools/list_changed` exists. But the tool list is part
  of the cached prompt prefix, so mutating it mid-session invalidates the cache for the whole
  conversation, and it makes agent runs non-reproducible. The cost lands in exactly the long
  editing session the feature was meant to help.
- **Do not treat a shorter description as free.** The long descriptions are why an agent picks
  `element_source` over `element_move`. Cut repetition and prose that repeats what an enum already
  says; keep every sentence that names a neighbouring tool or a failure this repository has
  actually had.

---

## 4. Expected result

| change | saving | risk |
|---|---:|---|
| §2.1 shorten six helpers | ~18 KB (14%) | none — single-source already |
| §2.4 `component` → response | ~2.2 KB (1.7%) | none |
| §2.3 retire duplicate surfaces | ~9 KB (7%) | low — documented duplicates |
| §2.5 named profiles | up to ~50% for Desktop users | none — opt-in |
| §2.2 cap catalogs | ~27 KB **per pair of calls** | none |

**These do not add up cleanly.** §2.1 and §2.3 overlap — `add_image` and `add_video` both carry
`visual_properties()`, so shortening the helper first makes retiring the duplicate pair cheaper,
and doing them in the other order makes §2.1 look smaller. Taken together the realistic figure is
**131 KB → ~105 KB**, not the 102 KB the column sums to. Re-measure after each step rather than
trusting the arithmetic.

That is a fifth of the wire without removing a single capability, and the per-session response
saving from §2.2 is larger than all of it. The tool count stays at or near 101, which — per §1.6 —
is the right answer for an agent client with tool search, and was never the thing costing anything.
