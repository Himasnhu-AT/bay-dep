# The State of AI Video Editing & Creation — August 2026

Research report for **bay** (native macOS, Rust engine, MCP-exposed, headless MP4 rendering)

---

## 1. Executive summary

The market has split into four layers, and bay sits at the intersection of two of them:

1. **Agentic editors of real footage** (Descript Underlord, Eddie AI, Mosaic, Captions/Mirage, Adobe's Firefly AI Assistant) — the closest analogs to "give it a task."
2. **Generative studios** (Runway Aleph 2.0/Edit Studio, Google Flow + Veo 3.1, Sora 2 [sunsetting], LTX Studio, Higgsfield) — create or transform pixels, weak at assembling *your* footage into a finished piece.
3. **Repurposers/consumer AI editors** (OpusClip, Captions, CapCut, Kapwing, InVideo, Revid, Argil) — narrow tasks done at volume, cloud-only, credit-metered.
4. **Programmable/agent-addressable infrastructure** (Remotion, Revideo, Shotstack, Creatomate, JSON2Video, Editframe, fal, and a fast-growing crop of **video-editing MCP servers**: Kinocut, Kerf, mcpCut, FableCut, OpenChatCut, AVE, X-Cut).

Two headline findings for bay:

- **The "agentic editor" thesis is validated and crowded at the cloud layer.** Descript's Underlord v2 is explicitly a multi-model agent ("Cursor for editing"), Mosaic (YC W25, $3.8M seed Apr 2026) ships "video editing agents" with API + Claude Code/OpenClaw agent skills, and Adobe announced a Firefly AI Assistant that orchestrates multi-step workflows across Premiere/Firefly/Photoshop ([Adobe blog, Apr 15 2026](https://blog.adobe.com/en/publish/2026/04/15/adobe-extends-leadership-video-unleashing-new-ai-powered-creation-firefly-reinventing-color-editors-in-premiere)).
- **"Local-first + MCP-native" is no longer a unique claim — but it is still an open race.** As of Aug 2026 there are direct precedents: **Kerf** (desktop editor with embedded MCP server, task queue, revertible history), **AVE** (local-first Mac AI editor, $79 lifetime, connects Claude Code/Codex), **Kinocut** (guardrailed local FFmpeg MCP server, 190 tools), **mcpCut**, **FableCut**, **OpenChatCut**. None has meaningful distribution yet. Defensibility must come from *execution quality* (render engine, taste, verification loop), not the architecture idea alone.

---

## 2. Capability matrix — top 10 tools

Legend: ● strong / ◐ partial / ○ none. "Agent-addressable" = API/MCP an external agent can drive.

| Tool | Task→finished video | Edits real footage | Interaction model | Local/private | Agent-addressable (API/MCP) | Multicam | Filler/silence removal | Text-based transcript edit | Auto-captions styled | Auto-reframe 9:16 | Viral clip finding | Script-to-video (gen) | Pricing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Descript Underlord v2** | ● (talk content) | ● | Chat + transcript + timeline | ○ cloud | ○ | ● | ● | ● (best in class) | ● | ◐ | ◐ | ◐ | $16–35/mo + AI credits |
| **Eddie AI v3** | ◐ (rough cuts → NLE) | ● | Chat + "Night Shift" batch; exports to Premiere/Resolve/FCP | ◐ desktop app, cloud AI | ○ | ● (6-cam) | ● | ◐ | ● | ○ | ◐ | ○ | Pay-as-you-go credits ($10/1k) |
| **Mosaic** | ● (workflows) | ● | Node canvas + timeline + chat | ○ cloud | ● API, webhooks, agent skills | ○ | ● | ◐ | ● | ● | ● | ◐ | Free canvas, ~$25/mo runs |
| **Captions (Mirage)** | ● (talking-head/social) | ● | One-tap styles + chat editor | ○ cloud | ◐ (Mirage API) | ○ | ● | ◐ | ● (100+ styles) | ● | ◐ | ● (avatars) | $10–25/mo credits |
| **Adobe Premiere + Firefly** | ◐ (assistant coming) | ● | Timeline + AI assistant (soon) | ◐ local edit, cloud AI | ◐ (ExtendScript/UXP, no MCP) | ● | ◐ | ● | ● | ● | ○ | ◐ (Firefly b-roll, Gen Extend 2s) | CC subscription + gen credits |
| **Runway Aleph 2.0 / Edit Studio** | ○ (transforms clips) | ● (pixel-level, 2–30s) | Prompt + keyframe anchors | ○ cloud | ◐ (API enterprise-only since Jan 2026) | ○ | ○ | ○ | ○ | ◐ | ○ | ● | $12+/mo; 28 credits/sec |
| **Google Flow + Veo 3.1** | ◐ (gen scenes, ~8s chained) | ○ | Prompt + Scenebuilder + Flow Agent | ○ cloud | ● (Gemini/Vertex API) | ○ | ○ | ○ | ○ | ● native 9:16 | ○ | ● (best gen quality + native audio) | Google AI plans, credits |
| **OpusClip (ClipAnything)** | ● (long→shorts only) | ● | Upload + prompt | ○ cloud | ◐ (Business API) | ○ | ◐ | ◐ | ● | ● | ● (multimodal, best in class) | ○ | Free–$29/mo |
| **CapCut** | ◐ (auto-edit, templates) | ● | Timeline + AI tools | ◐ local edit; cloud AI w/ ToS risk | ○ | ○ | ● | ◐ | ● | ● | ● | ● (Veo/Sora/Seedance in-app) | Free; Pro ~$8–15/mo + credits |
| **Kinocut / Kerf / AVE (MCP local cohort)** | ◐ (agent-dependent) | ● | MCP tools driven by Claude/Cursor; Kerf/AVE add GUI | ● fully local | ● MCP-native | ○ | ◐ | ◐ | ◐ | ◐ | ○ | ○ | Free/OSS; AVE $79 lifetime |

---

## 3. Per-tool notes (with sources)

### Agentic / task-driven editors

**Descript Underlord v2** — The most genuinely agentic shipping editor. Chat commands execute chains ("remove filler, tighten pauses, caption, pull 3 vertical clips"), presents a Project Brief/plan before cutting, self-corrects, and lets users pick the underlying model (Claude Opus/Haiku 4.5, Gemini 3.0 Pro, GPT 5.2) ([changelog](https://descript.canny.io/changelog/announcingunderlord-v2)). A 31-min interview edited in ~4 min in tests ([review](https://withhimanshu.com/descript-review/)). Failure modes: generic show-notes/social copy, credit anxiety (400–1,500 AI credits/mo), degrades on non-formulaic content, mandatory human review ([prizmad](https://prizmad.com/review/descript), [aivyber](https://aivyber.cz/en/descript-underlord-review-2026-ai-video-editor/)).

**Eddie AI v3** — The "AI assistant editor for pros." Desktop app (Mac/Win); Night Shift ingests a shoot folder overnight: sorts A/B-roll, syncs 6-cam multicam, logs clips, builds 6 rough cuts of varying length, texts you when done; exports native Premiere/Resolve/FCP timelines ([CineD](https://www.cined.com/eddie-ai-v3-released-night-shift-overnight-editing-workflow/), [heyeddie.ai](https://www.heyeddie.ai/features/nightshift)). Deliberately a *pre-editor*, not a finisher; pacing described as "robotic" and it requires an NLE downstream ([Filmora review](https://filmora.wondershare.com/video-editor-review/eddie-ai-review.html)). Pricing moved to credits ($10/1k, never expire).

**Mosaic** — Closest philosophical competitor. Node-based canvas of "Tiles" (cut, caption, dub, reframe, clip-extraction) chained into agents that get "80–90% of the way," then a timeline for polish; exports to Resolve/Premiere/FCP; API + webhooks + **one-click agent skills for Claude Code/OpenClaw**; building toward a fully autonomous agent that defines its own workflow and pulls web assets ([Launch HN](https://brianlovin.com/hn/45980760), [mosaic.so](https://mosaic.so/), [MakerStack review: 7/10, "output quality needs polishing"](https://makerstack.co/reviews/mosaic-review/)). Their stated mission — "codify the language of video and imbue that as taste into agents" — is exactly bay's fight.

**Captions (by Mirage)** — 20M+ users. "AI Edit" produces a fully edited video in one pass (cuts, zooms, B-roll, music, styled captions, 20+ named styles); chat-based editing; eye-contact correction; Mirage Avatar X generates whole-frame expressive presenters; every layer stays live/editable in their own browser/cloud rendering engine; Mirage Agent "plans, creates, edits, and designs" ([mirage.app](https://mirage.app/), [prizmad](https://prizmad.com/review/captions-ai)). Weaknesses: cloud-only, credit metering, creator-content bias.

**Adobe (Premiere + Firefly)** — Generative Extend (≤2s video / 10s audio, labeled in-timeline), Firefly Boards→Premiere b-roll generation, new Color Mode, and the announced **Firefly AI Assistant** that orchestrates multi-step workflows across CC apps ([Adobe blog](https://blog.adobe.com/en/publish/2026/04/15/adobe-extends-leadership-video-unleashing-new-ai-powered-creation-firefly-reinventing-color-editors-in-premiere)). An editor's hands-on of Adobe "Quick Cut": it cut away to B-roll during a subject's emotional choke-up "because nothing was happening… Technically right. Emotionally catastrophic" ([Open Your AIs](https://openyourais.com/blog/adobe-quick-cut-ai-editor-honest-director-review/)).

### Generative studios

**Runway Aleph 2.0 + Edit Studio** (launched May 21, 2026) — in-context *pixel* editing of existing footage: relight, product swap, background replacement, propagated across ≤10 cuts, keyframe-anchor images, image preview before generating; 2–30s clips at ≤1080p; 28 credits/sec; API went Enterprise-only Jan 2026 ([runway.com](https://runway.com/news/introducing-aleph-2-and-edit-studio), [Pexo explainer](https://pexo.ai/blog/what-is-runway-aleph-2-0-6791)). Complementary to bay, not substitutive: it can't assemble a timeline.

**Google Flow + Veo 3.1** — best generation quality; native synced audio/dialogue, true 4K + native 9:16 (Jan 2026), ingredients-to-video (4 ref images), and **Flow Agent** (I/O 2026): project-memory Gemini assistant for planning/asset management ([aiflowmatrix](https://aiflowmatrix.com/google-flow-explained/), [Litmus](https://litmustools.com/review/veo/)). Still ~8s clips chained to ~60s; "fine-cut editing tools aren't mature… Premiere or DaVinci is still necessary."

**OpenAI Sora 2** — API had create/edit/extend/characters/batch, but **the entire Sora 2 API and consumer apps shut down Sept 24, 2026** (apps already dead Apr 26, 2026) ([OpenAI docs](https://developers.openai.com/api/docs/guides/video-generation), [dev.to guide](https://dev.to/owen_fox/sora-2-video-api-developer-guide-access-pricing-code-examples-2al)). Lesson for bay: cloud-model dependencies churn violently; abstract them.

**LTX Studio** (Lightricks) — script→storyboard→shot-level direction with persistent characters, keyframed cameras, timeline assembly; open-weights LTX-Video model self-hostable; G2 ~4.4 but Trustpilot 1.5 over opaque "computing seconds" billing and failed generations burning credits ([recatools](https://recatools.com/ai-directory/ltx-studio/)). **Higgsfield** — $300M ARR in 11 months via multi-model routing (Kling 3.0, Seedance 2.0, etc.) + Vibe Motion (Claude-powered prompt→motion-graphics, live-tweakable canvas); Forbes documented misleading marketing, throttled "unlimited" plans, creator payout problems ([Forbes, Feb 11 2026](https://www.forbes.com/sites/rashishrivastava/2026/02/11/racist-videos-and-payment-problems-the-dark-side-of-this-ai-startups-super-fast-growth/)).

### Repurposers / consumer

**OpusClip ClipAnything** — the viral-clip benchmark: multimodal (visual, audio sentiment, facial expression) clip detection beyond transcripts; Virality Score 0–99; prompt-to-clip; AI B-roll; XML export to Premiere/Resolve; $15–29/mo. Users discard 20–40% of clips; 22% one-star Trustpilot on billing; projects deleted 3 days after cancellation ([OnyxRanked](https://onyxranked.com/opus-clip-review-2026/), [BIGVU](https://bigvu.tv/blog/opus-clips-worth-the-hype/)). **CapCut** — full pipeline (Smart Cut, auto-edit 1hr→10 clips w/ engagement scoring, OmniHuman avatars, Veo 3.1/Sora 2 in-app) at $8–15/mo, but June 2025 ToS grants ByteDance a perpetual, sublicensable license incl. AI training on cloud-uploaded content, no opt-out — a standing privacy argument for bay ([Pexo](https://pexo.ai/blog/capcut-ai-video-generator-review-4093)). **InVideo / Revid / Kapwing / Argil** — script/prompt-to-video at volume; InVideo is the cautionary tale: "the GPT creates prompts outside the practical limits of what the generation engine can produce… every failed attempt costs credits" ([Future Stack](https://future-stack-reviews.com/invideo-ai-review/), [Techreviewer](https://techreviewer.co/products/invideo)). Argil notably ships a clean per-unit API (160 credits/video-min) ([docs](https://docs.argil.ai/resources/api-pricings)).

### Programmable / MCP layer (bay's direct territory)

- **Remotion** rebranded around "**Video tools for the agent era** — make videos agentically" ([GitHub](https://github.com/remotion-dev/remotion)); Claude Code skill packs exist. **Revideo** (MIT fork of Motion Canvas) targets headless pipelines. **Shotstack/Creatomate/JSON2Video/Editframe** are JSON-in-MP4-out cloud APIs — "an LLM produces structured JSON far more reliably than a full render script" ([Wireflow](https://www.wireflow.ai/blog/best-remotion-for-coding-agents-tools-in-2026)). **fal** = 1,000+ generative models behind one API.
- **MCP-native editors (the cohort bay must beat):**
  - **Kinocut** (ex-mcp-video, Apache-2.0): local FFmpeg MCP server, ~190 typed tools, preflight validation, "Video Receipts" provenance, quality gates ([GitHub](https://github.com/KyaniteLabs/kinocut)).
  - **Kerf**: cross-platform desktop editor with *embedded* MCP server — agent drives the same engine as the GUI, sees frames, task queue with human apply/dismiss, fully revertible attributed history, no re-encode until export ([GitHub](https://github.com/orellbuehler/kerf)).
  - **AVE**: local-first Mac-native AI editor; Ask/Plan modes, connects Claude Code/Codex; $79 lifetime ([aivideoeditor.app](https://www.aivideoeditor.app/)).
  - **mcpCut** (journaled immutable ops, FFmpeg/MLT), **FableCut** (project.json *is* the interface; revision-counter conflict safety), **OpenChatCut**, **X-Cut** (skill-based agent on Remotion rendering) — all 2025–26 open-source entrants.

---

## 4. Top 10 capabilities bay must have to compete

Ranked by how consistently they define "give it a task, it accomplishes it" across winners:

1. **Transcript-first editing core** — transcription with word-level timestamps as the primary edit substrate (cut = delete words). This is Descript's moat and every agentic editor's foundation; it also powers bay's word-synced captions.
2. **Filler-word / silence / retake removal with pause intelligence** — the single most-used AI edit; must distinguish dramatic pauses from dead air (the #1 category complaint is auto-cutters "destroying comedic timing," [Creator's Assistant](https://www.thecreatorsassistant.com/best-ai-tools-youtube-video-editing)).
3. **Plan → preview → approve → apply loop** — Underlord v2 presents a plan and checks in; Kerf uses a task queue; Eddie delivers 6 alternative cuts. An agent that renders irreversibly without checkpoints will not be trusted.
4. **Styled auto-captions** (templates, karaoke/word-highlight, brand fonts) — table stakes across Captions, OpusClip, CapCut; bay's TTS word-sync is a natural fit.
5. **Auto-reframe 16:9→9:16 with subject/face tracking** — every repurposer has it; agent must output all aspect variants from one timeline.
6. **Viral-moment / highlight detection on long footage** — multimodal (not transcript-only, per ClipAnything) scene + energy + sentiment scoring, promptable ("find the moment where X").
7. **B-roll suggestion & insertion** — from the user's own library (Eddie's tagging) and/or generative/stock sources; the visual layer that separates "rough cut" from "watchable."
8. **Multicam sync + speaker-aware switching** — Eddie's headline pro feature and Underlord's; audio-waveform sync plus active-speaker cut logic.
9. **Music with beat-aware placement + auto-ducking** — Eddie and Captions both ship ducking; cutting to beats is a cheap, high-perceived-quality win.
10. **Verified headless render pipeline** — self-verification (probe output, check duration/AV sync/caption presence, re-open project) before declaring done. Kinocut's "Video Receipts" and Timeline Studio's revision-checks/transactions/semantic-diffs pattern ([dev.to](https://dev.to/martindelophy/from-natural-language-to-an-editable-video-inside-timeline-studios-agent-skill-4f08)) show the bar: agents must never hand back silently-broken media.

Also expected but second-order: eye-contact correction, voice-clone overdub for flubbed lines, color match across clips, brand kits (logo/fonts/colors auto-applied), scene detection, translation/dubbing.

## 5. Top 5 differentiation opportunities for bay

1. **The trustworthy agent loop as product, not feature.** Nobody has nailed: agent proposes → human sees a *diff of the timeline* (not just a rendered blob) → approve/undo per operation → attributed, revertible history. Kerf and FableCut sketch this in OSS; Descript approximates it in cloud. A Rust engine with immutable op-journal + instant preview + per-edit undo is a genuine UX moat, and directly answers the "AI acts confident even when wrong" complaint.
2. **Local-first as a professional/legal wedge, not a hobbyist one.** CapCut's ToS grab, ByteDance/cloud-training fears, and NDA/client-footage workflows make "footage never leaves the machine" a *sales* argument (Reelify and DaVinci's on-device Neural Engine both market exactly this). Bay should pair local analysis (Whisper, scene detection, VAD) with *optional, explicit* cloud generation calls — the AVE "local by default, external AI only when the job calls for it" pattern, executed better.
3. **MCP-native + headless render = the video backend for every agent.** Cloud APIs (Shotstack et al.) are agent-addressable but generic and non-private; local MCP servers (Kinocut) are FFmpeg wrappers without a real compositor. A *real* engine (keyframes, text, shapes, TTS, captions) exposed as typed MCP tools, driveable from Claude Code/Cursor/OpenClaw, is currently unoccupied at production quality. Ship agent skills + a CLI twin (mcpCut/Kinocut pattern) for distribution.
4. **Encoded taste.** The universal critique: AI edits are technically right, emotionally wrong (Adobe Quick Cut cutting away from a tearful pause). Opportunity: style-transfer from reference videos ("edit like this channel"), retention-aware pacing rules, emotional-beat detection, and named editorial styles — Mosaic explicitly says taste is the frontier, and nobody has shipped it.
5. **Deterministic, credit-free economics.** The single loudest complaint category across InVideo, LTX, CapCut, Higgsfield, Descript is metered credits burned on failed/unwanted generations. A local engine renders for free. "Iterate infinitely, pay nothing per attempt" (license or one-time price, à la AVE's $79 lifetime) is both a pricing and a *trust* differentiator — iteration speed is how taste actually gets applied.

**Defensibility assessment (Aug 2026):** local-first and MCP-native are each independently replicated (DaVinci = local AI, no agent surface; Mosaic = agent surface, no local; Kerf/AVE/Kinocut = both, but early/OSS/thin engines). The combination is defensible only via (a) engine quality (real compositing/keyframes/TTS-caption sync that FFmpeg wrappers can't match), (b) the verification/trust loop, and (c) speed of iteration on Apple Silicon. Expect Adobe and Blackmagic to ship agent surfaces within 12 months; the window is now.

## 6. User-complaint themes (with quotes/paraphrases)

1. **Credit-burn & opaque billing** — "credit balances spent on unusable output… charged for generations that failed or froze, with refunds declined" (InVideo, [toolproven](https://toolproven.com/reviews/invideo)); unexpected $100–250 sessions ([Techreviewer](https://techreviewer.co/products/invideo)); LTX's Trustpilot 1.5 over "computing seconds"; OpusClip deleting projects 3 days post-cancellation; Higgsfield throttling "unlimited" plans ([Forbes](https://www.forbes.com/sites/rashishrivastava/2026/02/11/racist-videos-and-payment-problems-the-dark-side-of-this-ai-startups-super-fast-growth/)).
2. **AI lacks taste / kills timing** — "Quick Cut cut away to B-roll during the pause because 'nothing was happening.' Technically right. Emotionally catastrophic" ([Open Your AIs](https://openyourais.com/blog/adobe-quick-cut-ai-editor-honest-director-review/)); "anchor cuts are triggered by emotional beats, not time intervals — that's still human work"; auto-cutters "destroy comedic timing" ([Creator's Assistant](https://www.thecreatorsassistant.com/best-ai-tools-youtube-video-editing)).
3. **Overpromising interfaces** — "the GPT creates prompts outside the practical limits of what the generation engine can produce… users pay before the product proves it can deliver" (InVideo Trustpilot paraphrase); "AI acts like it knows what it's doing. It presents cuts with certainty, even when it's wrong — dangerous for beginners."
4. **Slop backlash** — Roku's 24/7 AI channel: "not a single soul asked for this" ([NME](https://www.nme.com/news/film/ai-slop-film-channel-ridiculed-for-being-devoid-of-sauce-and-creativity-3961882)); YouTube demonetizing "inauthentic" mass-produced content ([NPR](https://www.npr.org/2025/08/28/nx-s1-5493485/ai-slop-videos-youtube-tiktok)); Singapore's AI film mocked for inconsistent faces and a 7-star flag ([TOC](https://theonlinecitizen.com/2026/08/13/netizens-mock-ai-slop-movie-s-potential-as-future-torture-as-viewers-flag-glitches-in-singapore-ai-film)). Editing *real footage* well is the anti-slop position.
5. **Output needs review anyway** — 20–40% of OpusClip clips discarded; Eddie's cuts need NLE finishing; "Underlord is autocorrect for editing… you still review before anything goes live" ([withhimanshu](https://withhimanshu.com/descript-review/)). Reddit: "the AI is a great sous-chef, but it doesn't have your taste buds."
6. **Privacy / rights fears** — CapCut's perpetual sublicensable cloud-content license with no opt-out; creators explicitly seeking on-device tools for NDA'd client footage (Reelify's whole pitch; Resolve's "nothing leaves the machine" praised in reviews).
7. **Fragile edges** — audio drift, codec failures, silent scheduler failures (OpusClip TikTok posting), misspelled on-screen text in ~30% of renders (InVideo), lip-sync drift — agents must verify outputs, not assume success.

---

**Bottom line:** the "give it a task" category is real, funded, and converging from three directions (Descript from transcripts, Mosaic from workflows, Adobe from incumbency). Bay's winning shape in Aug 2026 is: a *real* local render engine + typed MCP surface + plan/preview/undo trust loop + zero marginal cost per iteration + encoded editorial taste — shipped fast, before the incumbents bolt agent surfaces onto their moats.
