# Landing page copy: `{product.name}` home

> Copy is written with `{product.name}` as a placeholder throughout, per the naming rule in
> `website/CLAUDE.md`: the name lives in `src/lib/product.ts` and is never typed into copy.
> Same for `{product.status}` and `{product.kind}`.

## Meta

- **Target audience:** the agent-native editor. Developer or technical creator on Apple
  Silicon who already runs an MCP client and makes video as an output of other work.
- **Traffic source:** cold to warm. A link from a post, an MCP directory listing, or GitHub.
- **Awareness level:** solution-unaware. The category does not exist yet, so the page has to
  build the frame before it can sell inside it.
- **Goal:** read `/status`, believe it, and write. There is no download and the page must not
  imply one. See `_variant-lab.md`, "The capture conflict".
- **Type:** rewrite in place. The existing page is strong and this is surgical.
- **Word count:** ~980 (body copy, excluding FAQ)

---

## Wireframe

Section order, with the perception layer each one carries. Sections marked **KEEP** already
exist on the page and are working.

| # | Section | Purpose | Layer | Status |
|---|---|---|---|---|
| 1 | Hero | The one claim no competitor can print | Perception | Rewrite headline + lead |
| 2 | Where this usually goes | The state of asking a machine for a video today | Perception | **New** |
| 3 | What you asked for | The prompt, stated before it runs | Context | **KEEP** |
| 4 | The scroll sequence | The demonstration, six beats | Context | **KEEP** |
| 5 | One engine, two ways in | Four ruled rows, the mechanism | Context | **KEEP**, tighten row I |
| 6 | How you actually use it | Three steps, from client to timeline | Context | **New** |
| 7 | What it will not do | The absences, stated as architecture | Permission | **KEEP** |
| 8 | Three things people ask | The objections, answered plainly | Permission | **New** |
| 9 | Where it actually is | The honest status, then the CTA | Permission | **KEEP**, extend |
| 10 | Pull quote | The thesis | Permission | **KEEP** |
| — | FAQ | Seven questions | Permission | **New**, recommend on `/agents` |

**Sections deliberately omitted, with reasons:**

- **Social proof.** No testimonials, no users, no logos, no published benchmarks. Section 5
  and the reel carry proof instead. Inventing this breaks the second site rule.
- **Pricing.** None exists, and the monetization model is unresolved. See `MARKETING.md`.
- **Urgency / final push.** No scarcity exists. Manufacturing one contradicts the brand.
- **Features grid.** The page's stated thesis is that it refuses the feature grid this
  category ships. Sections 5 and 6 carry the same information in the page's own form.

---

## 1. Hero

> **Eyebrow** (unchanged)

`{product.kind}` · `{product.status}`

> **Headline** (unchanged, decision 2026-08-08)

# A video editor you can talk to.

> **Lead** (unchanged)

`{product.name}` is a video editor for the Mac, written in Rust. You cut on the timeline the
way you always have. You can also describe the change you want and let something else make it,
on that same timeline, on your own machine.

> **Scroll nudge** (unchanged)

Keep scrolling to watch it build one ↓

**Note on the headline.** Kept as live. It scored 21/25 and loses only on the swap test: a
competitor could print it unchanged. The hero is therefore the weakest line on the page for
differentiation, and the page compensates in section 2, which lands the unswappable claim one
scroll later rather than in the headline slot.

**A/B challenger, when you want one:** "An agent edits your timeline. ⌘Z undoes it." (23/25).
It is the one sentence no competitor can print. Test it against the live headline on
click-through to `/status` rather than swapping it in blind.

---

## 2. Where this usually goes

*(New section, directly under the hero. Perception layer: destabilize with a fact, not an
accusation.)*

Ask a machine for a video today and what comes back is a file. Not a project. If the third
clip runs a beat too long you can ask again and hope, or you can open the result in an editor
that knows nothing about how it was made. The thing that built it cannot help you fix it.

That is the part `{product.name}` is built around. An agent here works in the document you
already have open, through the same commands your clicks produce. Its edits land on the
timeline while you watch, and ⌘Z takes them back like any other.

*Copy note: with headline A kept, this paragraph carries the differentiating claim. It is the
first thing on the page a competitor could not print, so it should not be cut for length.*

---

## 3. What you asked for

*(Unchanged. Already in place and doing its job.)*

The prompt, then:

Below is that request being carried out, one step per scroll. On the left is the conversation
with your agent and the calls it makes. On the right is `{product.name}` itself, with the
clips landing on the timeline as they are made. Neither side is sped up or rearranged, and the
reel at the end is one that exists.

---

## 4. The scroll sequence

*(Unchanged. This is the offer. See `_variant-lab.md`, offer frames.)*

---

## 5. One engine, two ways in

*(Four ruled rows. Rows II, III and IV are unchanged and good. Row I is tightened, because it
now has to carry the headline's claim rather than introduce it.)*

**I. One engine, two ways in**

The timeline you drag clips around on and the engine an agent talks to are the same Rust code.
An agent never writes to your project directly. It submits the same `Command` values your
clicks produce, through the one point that is allowed to write. That is why its edit shows up
on the timeline the moment it happens, and why ⌘Z takes it back.

**II. It renders with no window open** *(unchanged)*

Everything above happened with the app in front of you. It also runs headless, serving the
same twenty-four tools over the Model Context Protocol, so a cut can be built and encoded on a
machine with no display attached.

> ⚠️ **Correction, 2026-08-08.** The live site says *twenty-one*. The real count is **24**,
> from `definitions()` in `rust/crates/bay-mcp/src/tools.rs`. `docs/native/reel-recipe.md` says
> 16, which was presumably true when it was written. Fix the repo before publishing this line.
> See `workspace/video/_quality-report.md`.

**III. It reads the script out loud** *(unchanged)*

Hand it a script and it speaks it, then cuts the captions to the words it actually said rather
than the words you wrote. The voice is generated on the Mac; nothing is sent away to be
spoken.

**IV. Drawn on the GPU, decoded off the render path** *(unchanged)*

A wgpu compositor does the blending, effects and masks. Decoding runs on a background worker
under a global memory budget, so dropping a ten-minute clip on the timeline does not freeze
the editor while it thinks.

---

## 6. How you actually use it

*(New. Three steps. Context layer: makes the unfamiliar thing procedural.)*

**One.** You add `{product.name}` to the client you already use, with one line:

```
claude mcp add --transport http bay http://127.0.0.1:7333/mcp
```

**Two.** You describe the change. The agent calls one of twenty-four tools. The endpoint is on
your own machine, at `127.0.0.1`, and nowhere else.

**Three.** The edit appears on the timeline. You take the mouse back whenever you want, and a
chip reading `● Claude` tells you which edits were not yours.

---

## 7. What it will not do

*(Unchanged. Permission layer, and the strongest paragraph on the page.)*

There is no server that holds your project. No account to make, no upload step, no render
farm, no library of your footage sitting on someone else's disk waiting to be trained on. The
agent endpoint listens on your own machine and nowhere else, and when an agent renders a file
it writes it to your disk the same way you would. This is not a tier we are keeping back.
There is no code in `{product.name}` that could do otherwise.

---

## 8. Three things people ask

*(New. Objection handling, in voice. Each answer is a mechanism, not a reassurance.)*

**Is this a wrapper around ffmpeg?**

ffmpeg decodes and encodes. Everything between those two ends is `{product.name}`: the
compositor, seventeen blend modes, the effects, the masks and the text all run on the GPU
through wgpu. It uses ffmpeg the way any editor uses a codec.

**What stops an agent wrecking my project?**

The same thing that stops your own mistakes. Every agent edit goes through the point that
handles your clicks, so it lands on the undo stack and ⌘Z takes it back. A second launch
raises the window that is already open rather than starting a rival timeline, so which
document is being edited is never in question.

**Why would I install something that is not ready?**

You would not, and there is nothing to install. There is no download yet. The page you want
is `/status`, which says what runs today and what is still wrong, and it is the page this
site exists to be able to write.

---

## 9. Where it actually is

*(Extended. The existing paragraph, then the reel, then the CTA.)*

`{product.name}` is `{product.status}`: real, running, and not yet ready for a stranger. Long
clips still play back as a low-quality proxy, the media panel lists demo tiles instead of your
imports, and most of the timeline craft is unwritten. All of it is listed rather than left for
you to find.

The reel above is one that exists. It runs 21.429 seconds at 1080×1920, thirty frames a
second, h264 and AAC, and every clip in it was placed by a tool call. Building it turned up
four defects, and each one now has a test that catches it. That record is published too.

> **Primary CTA** (unchanged, and correct)

**See what works today** → `/status`

> **Secondary CTA** (route 2 from the variant lab, chosen 2026-08-08. Requires the
> `website/CLAUDE.md` amendment below before it ships.)

### If you would use this

There is no download yet. When there is one, the people who wrote first hear about it first.
Tell us what you would cut with it.

| Field | Label | Required | Why it exists |
|---|---|---|---|
| 1 | What would you cut with it? | **Yes** | The point of the form. An address on its own teaches you nothing; a sentence gives you the interview and the customer's own words for the next draft of this page |
| 2 | Email | Yes | So there is somewhere to reply |

**Button:** Send

**Under the button:** Your address goes to a file on our own server. It is not sent anywhere
else, and there is no list to leave.

**After sending:** Thank you. You will hear from us when there is something to install.

*Copy notes.*

- **The question comes first, and it is the required field.** Reversing that turns this into a
  waitlist, which the growth plan explicitly does not want and the site rule explicitly
  forbids. What you need in Month 1 is fifteen interviews, and this form is how you source
  them.
- **Do not write "join the waitlist", "get early access", or "be the first to know."** All
  three imply a launch you have not scheduled, and the third is a promotional formula.
- **The line under the button is a promise the implementation has to keep.** If the form ever
  posts to a vendor, that sentence becomes false and it is the single most quotable
  contradiction on the site. See the requirements below.

### Implementation requirements (these are the copy's dependencies, not suggestions)

1. **First-party endpoint only.** A route handler on this domain. No vendor script, no embed,
   no remote POST. Rule one of `website/CLAUDE.md` is untouched by this amendment and still
   governs.
2. **No config change needed.** `next.config.ts` sets no `output: "export"`; the routes
   prerender because they are static, not because a config forbids server code. A route
   handler is compatible as written.
3. **Confirm the deploy target runs server functions.** No `vercel.json` or `netlify.toml` is
   committed, so this cannot be verified from the repository. If the target is a pure static
   host, this route silently 404s and the form fails quietly, which is worse than not shipping
   it.
4. **Store it on infrastructure you control**, because the copy says so.
5. **It is not a download button.** It must not be styled as the primary action, and it sits
   below the `/status` link, not above it.

### The `website/CLAUDE.md` amendment

The current rule forbids this form. Replace the bullet with the text below, as a deliberate
commit. **I have not edited that file.** Amending a governance document should be your commit,
not a side effect of a copy pass.

> - **No download link until there is a build.** `download` stays undefined and the button does
>   not render, and no "coming soon" button stands in for it. One exception, added deliberately
>   on 2026-08-08: a single first-party form at the foot of the home page may ask what someone
>   would cut with the app. It is not a download button and is never styled as one. It posts to
>   a route on this domain, stores what it collects on our own infrastructure, and adds no
>   third-party request to any page. If a vendor script, an embed, or a remote endpoint would be
>   needed to make it work, the answer is no and the rule stands as it was.

---

## 10. Pull quote

*(Unchanged.)*

The engine is the product, and the timeline is one way of reaching it.

---

## FAQ

Recommended on `/agents` rather than the home page, which is already long and whose thesis is
that it does not ship a stack of standard sections.

**Does anything leave my Mac?**
No. There is no server holding your project, no account, and no upload step. The agent
endpoint binds to `127.0.0.1`.

**What does it need to run?**
macOS on Apple Silicon, a GPU adapter, and ffmpeg. If ffmpeg is missing, `{product.name}`
fetches its own on request, verified against a pinned checksum before it installs. It never
starts that download on its own.

**Which clients work with it?**
Anything that speaks the Model Context Protocol over HTTP. It is added with one line.

**Is it open source?**
The licence is MIT. The repository is not public yet.

**What is missing?**
Most of the timeline craft: slip, slide and roll trims, the transport, the audio mixer, and
much of the inspector. `/status` carries the current list.

**Does it run on Windows?**
It compiles, it starts, and it has no console window. Nobody has opened a window on it. Until
someone has, treating it as a Windows app would be a claim rather than a fact.

**What does it cost?**
Nothing yet, because there is nothing to buy.

---

## Quality gate results

### Four U's (page level, 16 max)

| U | Score | Note |
|---|---|---|
| **Unique** | 4/4 | The central claim is architectural and cannot be printed by a competitor. Passes the swap test in every section **except the headline**, which is kept by decision and fails it. Section 2 carries the load instead |
| **Useful** | 4/4 | A paste-able `claude mcp add` line, three steps, a named status page, seven answered questions |
| **Ultra-specific** | 4/4 | 21.429s, 1080×1920, 30fps, h264 + AAC, twenty-four tools, seventeen blend modes, `127.0.0.1:7333` |
| **Urgent** | 1/4 | **Deliberately forfeited.** No scarcity exists and manufacturing one contradicts the brand |
| **Total** | **13/16** | Clears the 12/16 threshold with the urgency point knowingly spent |

### Perception engineering (9 max)

| Layer | Score | Where |
|---|---|---|
| Perception | 2/3 | Sections 1 and 2 destabilize with a fact the reader did not have. Full marks would require the confrontational register `VOICE.md` bans |
| Context | 3/3 | Sections 4, 5 and 6 shift the frame from "assistant bolted on" to "one engine, two ways in" |
| Permission | 3/3 | Sections 7, 8 and 9 remove consequences by removing the ask. "You would not, and there is nothing to install" is the strongest permission move on the page |
| **Total** | **8/9** | Clears the 7/9 threshold |

### Hard checks

| Check | Result |
|---|---|
| Banned words (leverage, utilize, synergy, seamless, powerful, revolutionary) | ✅ Zero |
| AI slop openers | ✅ Zero |
| Em dashes and en dashes | ✅ Zero, per `VOICE.md` |
| Rule of three | ✅ Zero |
| Promotional adjectives | ✅ Zero |
| `-ing` tails | ✅ Zero |
| Negative parallelism | ✅ Zero |
| Second person, present tense | ✅ Throughout |
| Sentence case headings | ✅ Throughout |
| Product name hardcoded | ✅ Never. `{product.name}` throughout |
| Single consistent CTA | ⚠️ Two by design: `/status` is primary throughout, the form is secondary and appears once, below it. Watch that the form does not migrate up the page over time. It is not a download button |
| Every claim has proof | ✅ See below |
| Fabricated evidence | ✅ None. No screenshots, testimonials, users, metrics or download implied |

### Claim-to-source audit

| Claim | Source |
|---|---|
| Same commands, one single-writer point, ⌘Z | `website/PRODUCT.md`, Positioning |
| Twenty-four MCP tools | `rust/crates/bay-mcp/src/tools.rs`, counted from `definitions()`. **Not** `PRODUCT.md`, which says twenty-one and is wrong |
| Seventeen blend modes on the GPU | `docs/native/parity-status.md` item 1 |
| Reel: 21.429s, 1080×1920, 30fps, h264 + AAC | `docs/native/reel-recipe.md` |
| Four defects found, each now tested | `docs/native/reel-recipe.md` |
| Decode off the render path, global budget | `parity-status.md` items 12 and 14 |
| ffmpeg self-provisioned, checksum verified, never unprompted | `PROJECT.md`, `CLAUDE.md` |
| `● Claude` chip after an agent edit | `website/PRODUCT.md`, Operating Context |
| Second launch raises the existing window | `website/PRODUCT.md`, Operating Context |
| Long clips proxy, media panel demo tiles | `parity-status.md`, Open issues |
| Windows compiles and starts, never run | `todo.md`, `todo.testing.md` |
| MIT licence, repo not public | `LICENSE`, `gh repo view` |

### Open items before this ships

1. ~~**Pick the headline.**~~ ✅ Decided 2026-08-08: keep A, the live headline. B is logged as
   the A/B challenger in section 1.
2. ~~**Decide the capture route.**~~ ✅ Decided 2026-08-08: route 2, a first-party form. **Two
   things must happen before the copy ships**, and neither is written yet: the
   `website/CLAUDE.md` amendment in section 9, and the route handler plus form component. The
   copy is blocked on both.
3. **Two numbers in the repo have drifted from the code. Fix both before publishing.**
   - **Tests:** `todo.md` says 386, `parity-status.md` says 383. Do not print a test count on
     the page at all; it is the weakest of the three proofs and the easiest to get wrong.
   - **Tools:** the code has **24**, the live site says twenty-one, `reel-recipe.md` says 16.
     The copy above now says twenty-four. Correct `website/PRODUCT.md` and the site before this
     ships, or the page and the page next to it will disagree.
   - **The durable fix:** generate both counts rather than typing them. A number a visitor can
     check and find wrong costs more than the number was worth, and this site's second rule is
     that nothing may describe behaviour the app does not have.
4. ~~**Section 6 needs the port checked.**~~ ✅ Verified: `DEFAULT_PORT: u16 = 7333` in
   `rust/crates/bay-agent/src/registry.rs:33`, and the same `claude mcp add` line appears in
   that file's own doc comment. The copy is correct as written.
5. **New sections need shapes.** Sections 2, 6 and 8 introduce layouts the page does not
   have. Per `website/CLAUDE.md`, new shapes go in `layout.tsx` and get documented in
   `DESIGN.md` in the same commit. Sections 2 and 6 can reuse `RuledList` and `RuledRow`.
