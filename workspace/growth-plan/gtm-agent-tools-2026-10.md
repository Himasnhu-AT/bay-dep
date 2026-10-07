# GTM agent tools for Bay: what on GitHub lets Claude run go-to-market

All star counts, licences, dates and prices below were checked on **2026-10-07** unless a line says
otherwise. "Last commit" is the newest commit on the default branch. "README claims" marks anything
I took from a README and did not confirm in the files. Nothing was installed, run or signed up for;
repos were read from GitHub's API or a shallow clone.

## Verdict

**No. No project on GitHub credibly handles the entire GTM with Claude.** What exists falls into
three kinds, and none of them spans all of it:

| Kind | Best example | What it really is | Why it is not "the whole GTM" |
|---|---|---|---|
| Skill libraries | `coreyhaines31/marketingskills` (53,490 stars), `cgallic/kai-cmo-harness` | Markdown playbooks that make Claude plan and draft well | They write; they do not post, send or measure. The outward step is a separate tool or a person |
| Execution engines | `oneshot-agent/oneshot-gtm`, `Othmane-Khadri/YALC-the-GTM-operating-system` | Find prospects, send email and LinkedIn messages, track replies | B2B outbound only, paid per call or per provider. oneshot-gtm's own README says consumer motions "are not included" |
| Single-purpose connectors | Postiz, Resend MCP, PostHog plugin, Reddit MCPs | One channel each, done properly | One channel each |

The nearest thing to one suite is **Kai** (`cgallic/kai-cmo-harness`): 62 skill folders covering
positioning, launch, Reddit listening, social, newsletter, video scripts and a quality gate. It is
still a drafting-and-gating system, it has 55 stars and one author, and you already had it (see
"What is already installed").

**Smallest stack that covers Bay's GTM (5 pieces, 3 of them new):**

1. `AIDevGTM/gtm-cofounder` — strategy: who it is for, first 50 users, launch order.
2. `coreyhaines31/marketingskills` — the playbook library for everything written.
3. `mvanhorn/last30days-skill` — community and competitor research across Reddit, HN, YouTube, X.
4. Postiz (`gitroomhq/postiz-app` + `postiz-agent`) — scheduling, used in draft mode.
5. Resend MCP (`resend/resend-mcp`) — waitlist and launch email.

Plus what is already on the machine: the PostHog plugin for analytics review, and Bay plus the
installed HyperFrames/Remotion skills for the videos.

**What a human still has to do, whatever is installed:**

- Post on Reddit and Hacker News from his own account, in his own words. Both communities punish
  automated or generated posting, and Reddit's API now needs an approved application (see Safety).
- Run Product Hunt launch day: the listing, the maker comment, answering every comment.
- Build creator relationships. No tool found does creator outreach for a video product well.
- Do the user interviews, and decide pricing and positioning. The tools structure the thinking;
  they have no evidence of their own.
- Approve every outbound message. Every tool here that can send should stay in draft mode.

## Coverage matrix

**does** = produces the finished work for that stage (for publishing and sending stages, it can
perform the action). **partial** = advice or drafts only, or needs a paid service or extra keys.
**–** = not covered.

| Stage | marketing-skills | Kai harness | gtm-cofounder | opendirectory | last30days | claude-seo + claude-blog | Postiz | Resend MCP | PostHog plugin | goose-skills |
|---|---|---|---|---|---|---|---|---|---|---|
| Positioning, ICP research | does | does | **does** (its core) | partial | partial (evidence only) | – | – | – | – | partial (paid) |
| Competitor monitoring | partial (one-off teardown) | partial | partial (market scan) | partial | partial (on demand, no schedule) | partial (SERP, drift) | – | – | – | does (paid) |
| Lead finding, enrichment | partial (needs Apollo/Hunter keys) | partial (B2B) | partial (manual method) | partial (GitHub signals) | – | – | – | – | – | does (paid) |
| Outreach drafting, sequencing | partial (drafts) | partial (drafts) | partial | partial (drafts) | – | – | – | partial (can send) | – | does (paid) |
| Content and SEO | does | does | partial | partial | partial (topic research) | **does** | – | – | – | partial |
| Social posting, scheduling | partial (drafts) | partial (drafts) | – | partial (drafts) | – | – | **does** | – | – | – |
| Community monitoring, reply drafts | partial (guidance) | does (Reddit RSS to Discord drafts) | – | partial (needs Reddit + Gemini keys) | partial (research, no alerts) | – | – | – | – | partial (paid) |
| Launch planning (PH, HN) | does | does | does | does (needs a Gemini key) | partial (prior launches) | – | – | – | – | – |
| CRM hygiene | partial (advice) | partial | – | – | – | – | – | partial (contact list) | – | – |
| Analytics review | partial (tracking plan) | partial | partial | – | – | partial (Search Console) | partial (post stats) | partial (email stats) | **does** | – |
| Email newsletters | partial (drafts) | partial (drafts) | – | partial (drafts) | – | – | – | **does** | – | – |
| Ad creative | partial | partial | – | partial | – | – | – | – | – | does (paid) |

No column is all "does". The four bold cells are where a tool is the clear best for its row.

## Top picks, ranked for Bay

### 1. gtm-cofounder — the strategy half

- **Repo:** https://github.com/AIDevGTM/gtm-cofounder
- **What it is:** 19 numbered skills for technical founders of developer tools and AI products,
  from a five-question founder brief to a prioritised roadmap, then positioning, first 50 users,
  launch, pricing. Pure Markdown: each skill is one `SKILL.md`, no scripts.
- **Plugs into Claude Code:** `/plugin marketplace add AIDevGTM/gtm-cofounder`, or
  `npx skills add AIDevGTM/gtm-cofounder`.
- **Licence:** MIT. **Stars:** 310. **Last commit:** 2026-10-05. Open issues + PRs: 4.
- **Setup:** S. No keys, no cost.
- **Outside-world actions:** none. It writes files under `docs/gtm-cofounder/`.
- **Why it fits Bay:** it is written for exactly this founder (solo, technical, no commercial
  co-founder) and it tells you what *not* to work on yet. README says it is "not marketing tactics
  or SEO skills", which is honest and matches the files.
- **This week:** run `00-start-here` then `01-strategy-and-roadmap` against Bay and compare its
  "Now" move with `_90-day-plan.md`.

### 2. marketingskills — the playbook library

- **Repo:** https://github.com/coreyhaines31/marketingskills
- **What it is:** 50 skill folders (counted) with a shared `product-marketing` context every other
  skill reads first. Relevant to Bay: `launch`, `directory-submissions`, `community-marketing`,
  `influencer-marketing`, `social`, `video`, `competitors`, `programmatic-seo`, `emails`, `pricing`.
  Also ~65 single-file Node CLIs in `tools/clis/` (Resend, Buffer, Search Console, Ahrefs, Apollo…).
- **Plugs into Claude Code:** `/plugin marketplace add coreyhaines31/marketingskills` then
  `/plugin install marketing-skills`, or `npx skills add coreyhaines31/marketingskills --skill launch social`.
- **Licence:** MIT. **Stars:** 53,490. **Last commit:** 2026-10-06. Open issues + PRs: 153.
- **Setup:** S for the skills. The CLIs need each service's own key.
- **Outside-world actions:** the skills, none. The CLIs can send email (`resend.js send`), schedule
  posts (`buffer.js`) and start cold-email campaigns (`instantly.js`) if given keys. They run only
  when Claude is told to; there is no approval step built in.
- **Caveat:** the repo is funded by "Verified Partners" whose tools are listed in the registry. The
  README says partners never influence core skills; I did not audit that.
- **Why it fits Bay:** widest and best-maintained set of written-work skills; the `launch` and
  `directory-submissions` skills cover Product Hunt, HN and the directory long tail.
- **This week:** install only `product-marketing`, `launch`, `directory-submissions`,
  `community-marketing` and `influencer-marketing`. Fill the product-marketing context from
  `website/VOICE.md` so every later draft inherits Bay's voice rules.

### 3. last30days — community and competitor research

- **Repo:** https://github.com/mvanhorn/last30days-skill
- **What it is:** one skill plus a Python engine that searches Reddit, HN, YouTube, X, TikTok,
  GitHub and others for the last 30 days on a topic and returns a cited brief with real upvote
  counts and top comments.
- **Plugs into Claude Code:** `/plugin install last30days` after adding the marketplace, or
  `npx skills add`.
- **Licence:** MIT. **Stars:** 63,638. **Last commit:** 2026-10-06. Open issues + PRs: 68.
- **Setup:** S. README claims Reddit, HN, Polymarket and GitHub work with no keys; X, YouTube and
  TikTok unlock through a setup wizard (an xAI key, a ScrapeCreators key, or browser cookies).
- **Outside-world actions:** read-only scraping. No posting. **Risk:** the X path can read cookies
  from your logged-in browser; scraping with your own session breaks X's terms and can get the
  account limited. Use the keyless sources, or an API key, not cookies from the account Bay will
  post from.
- **Why it fits Bay:** answers "where do people complain about Descript/CapCut/Premiere this month,
  and in which subreddits" with links, which is the input for every community post and comparison
  page. It also covers the competitor-monitoring row if run weekly.
- **This week:** `/last30days AI video editor Claude Code MCP` and
  `/last30days Descript alternatives`, and keep the two briefs as the source list for replies you
  write by hand.

### 4. Postiz — social scheduling, in draft mode

- **Repos:** https://github.com/gitroomhq/postiz-app (the app) and
  https://github.com/gitroomhq/postiz-agent (CLI + skill + Claude Code plugin).
- **What it is:** a social scheduler for 28+ channels (README claims; includes X, LinkedIn, Reddit,
  YouTube, Bluesky, Threads) with a public API, an MCP server and an agent CLI.
- **Plugs into Claude Code:** it is in Anthropic's official plugin catalog, which is already added
  on this machine (`postiz`). Also `/plugin marketplace add gitroomhq/postiz-agent`.
- **Licence:** app AGPL-3.0; agent repo's LICENSE file is AGPL-3.0 text (GitHub reports
  "NOASSERTION"). **Stars:** 36,784 / 504. **Last commit:** 2026-10-06 / 2026-09-22.
- **Setup:** M on Postiz Cloud ($29/month Standard, 7-day trial; "every plan includes the MCP
  server, CLI and API" — postiz.com/pricing). L self-hosted: free, but you run Postgres, Redis and
  Temporal (README) and register your own developer app on each network.
- **Outside-world actions:** publishes publicly to every connected account. The CLI has a real
  draft type (`postiz posts:create ... -t draft`) and `posts:status <id> --status schedule` to
  promote one, so "Claude drafts, Himanshu promotes" is a supported flow, not a convention.
- **ToS risk:** scheduling your own posts through official APIs is allowed on X, LinkedIn and
  Bluesky. **Do not connect Reddit.** Scheduled promotional Reddit posts are what subreddit rules
  and Reddit's spam policy target. X's API is now pay-per-use with no free tier; third-party
  write-ups put a post at $0.015 and a post with a link at $0.20 (opentweet.io, not confirmed on
  X's own pricing page).
- **Why it fits Bay:** build-in-public on one or two channels is in the plan, and Bay produces the
  video clips those posts need.
- **This week:** start the cloud trial, connect one channel, and have Claude create a week of
  drafts from the defect write-ups in `_skill-routing.md`. Promote each by hand. Decide on
  self-hosting only if the habit sticks.

### 5. Resend MCP — waitlist and launch email

- **Repo:** https://github.com/resend/resend-mcp
- **What it is:** Resend's official MCP server: send email, manage contacts, segments and
  broadcasts, read delivery events.
- **Plugs into Claude Code:** in the official plugin catalog (`resend`), or as a hosted remote MCP
  with OAuth, or local stdio with `RESEND_API_KEY`.
- **Licence:** MIT. **Stars:** 576. **Last commit:** 2026-10-06. Open issues + PRs: 17.
- **Setup:** S, plus DNS records for a sending domain. Free tier: 3,000 transactional emails a
  month (100 a day), 1,000 marketing contacts, 3 domains (resend.com/pricing).
- **Outside-world actions:** sends real email, including broadcasts to a whole list. Broadcasts can
  be created without being sent; keep Claude to create and let a person press send.
- **Compliance:** fine for people who signed up (state what they will receive at sign-up, include
  an unsubscribe link and a postal address — CAN-SPAM; in the EU, consent under GDPR/ePrivacy).
  **Not** for cold email to creators: it is a transactional/marketing sender, cold sending risks
  the domain and breaks Resend's acceptable-use rules (not re-read today).
- **Why it fits Bay:** sign-in is mandatory in Bay, so there is already a verified-email audience
  to announce to, subject to what the sign-in screen promised about email.
- **This week:** verify the sending domain and draft (not send) the "a stranger can install it now"
  announcement as a broadcast.

### 6. opendirectory — launch kits, taken individually

- **Repo:** https://github.com/Varnan-Tech/opendirectory
- **What it is:** 66 skill folders "for founders who hate marketing" (README claims 64). The useful
  ones for Bay: `producthunt-launch-kit`, `show-hn-writer` (README claims it draws on 250 top HN
  posts), `oss-launch-kit`, `where-your-customer-lives`, `hackernews-intel` (HN keyword watch into
  a local SQLite cache with Slack alerts), `reddit-icp-monitor`.
- **Plugs into Claude Code:** `npx "@opendirectory.dev/skills"` installs single skills.
- **Licence:** MIT. **Stars:** 672. **Last commit:** 2026-08-14 (slowing). Open issues + PRs: 3.
- **Setup:** S to M. Many skills reference `GEMINI_API_KEY` in their own files; `reddit-icp-monitor`
  needs Reddit OAuth credentials; `oss-launch-kit` references `OPENAI_API_KEY`.
- **Outside-world actions:** `reddit-post-engine` can post to Reddit through Composio's Reddit
  connector. **Do not use that path.** The drafting half is fine.
- **Why it fits Bay:** the only library with HN- and Product-Hunt-specific launch skills.
- **This week:** nothing. Take `show-hn-writer` and `producthunt-launch-kit` when the launch is
  two weeks out, per the plan's "held until a stranger can install it".

### 7. Kai harness — already half here

- **Repo:** https://github.com/cgallic/kai-cmo-harness
- **What it is:** 62 skill folders (README claims 54 `kai-*`), a knowledge base of playbooks and
  channel guides, and Python quality gates (Four U's scoring, banned words, SEO lint).
  `kai-reddit-listen` reads subreddit RSS, filters by keyword, scores with an LLM and posts drafted
  replies to a Discord webhook; the README says it has no Reddit posting, voting or messaging, and
  the listener code I read only fetches `/new.rss`. The listener's LLM call uses the OpenAI client.
- **Licence:** mixed. Plugin payload (`harness/`, `knowledge/`, `plugins/`, `scripts/quality_gates/`,
  `scripts/reddit_monitor/`) is MIT; the rest, including `scripts/social/` and `scripts/publish/`,
  is Elastic License 2.0 since 2026-08-08. GitHub reports "NOASSERTION".
- **Stars:** 55. **Last commit:** 2026-10-02. Open issues + PRs: 3. One author, sells a service on top.
- **Setup:** S (it was installed before).
- **Why it fits / does not:** the gate and the Reddit listener are the two parts nothing else in
  this list replaces. The rest overlaps picks 1 and 2 with far less scrutiny.
- **This week:** decide whether it stays. See the next section.

## What is already installed, and where it lands on the matrix

| On the machine | Origin | Matrix rows it covers | State |
|---|---|---|---|
| `content-strategy`, `copywriting` skills (v1.1.0) | Almost certainly `coreyhaines31/marketingskills` — same frontmatter shape and wording; not in the skill lock file, so this is inference | Content, positioning copy | Old. Upstream skills are at 2.x |
| `landing-page`, `pricing-page` skills | Origin not identified (no lock entry, no source URL in the files) | Content | Working |
| 18 `seo-*` subagents in `~/.claude/agents` | `AgriciDaniel/claude-seo` (MIT, 18,421 stars, last commit 2026-10-04) | Content and SEO, analytics (Search Console) | **Orphaned.** The 31 `seo-*` skills were removed on 2026-09-08 (`~/.claude/removed-skills-manifest.txt`), and the agents call `~/.claude/skills/seo/bin/claude-seo`, which is no longer there |
| `~/.claude/kai/` (knowledge, harness, scripts incl. `reddit_monitor`) | `cgallic/kai-cmo-harness` | Would cover most rows as drafts | **Half removed.** 53 `kai-*` skills were removed on 2026-09-08; the knowledge base remains. `_skill-routing.md` in this folder routes the whole plan through `/kai-*` commands that no longer exist |
| `posthog` plugin 1.1.64 + `posthog-analytics` skill | Anthropic official marketplace; the skill is custom | Analytics review | Working. Bay's own telemetry goes to its website, not PostHog, so this covers the site only if the site sends to PostHog |
| `outreach` MCP (`fetch_leads`, `find_threads`, `daily_brief`…) | **His own project**, `Himasnhu-AT/portfolio` → `outreach-mcp`. Not a third-party tool | Community monitoring (HN only) | Built to rank freelance leads from HN hiring threads. Its `search_posts`/`find_threads` could watch HN for Bay's keywords; its README says other platforms are "one file each" |
| `humanizer`, `humanize-email`, `no-ai-slop` | Mixed | Quality gate on drafts | Working. Overlaps Kai's gate |
| `hyperframes*`, `remotion`, `faceless-explainer`, `motion-promo`, product-launch-video | `heygen-com/hyperframes`, `remotion-dev/skills`, `memex-lab/product-launch-video-skill` | Video for launch and social | Working. Bay itself is the better tool for this and is the demo |
| `agent-browser`, `claude-in-chrome` | `vercel-labs/agent-browser`; Anthropic | Directory submissions, form filling with a person watching | Working |
| Official plugin catalog (cached) | `anthropics/claude-plugins-official` | Lists `postiz`, `resend`, `exa`, `hunter`, `apollo`, `hubspot-sales`, `vibe-prospecting` | Picks 4 and 5 install from here in one command |

Two things to settle before adding anything: reinstall or delete the SEO set (the agents are dead
weight as they stand), and either reinstall Kai or rewrite `_skill-routing.md` against picks 1–2.
Recommending `claude-seo` again would be recommending something he removed a month ago; with three
site pages and no traffic, the plan's own "nothing to audit" still holds.

## Gaps no project covers well for a video product

- **Creator and YouTuber outreach.** GitHub searches for creator-outreach tooling returned only
  zero-star student projects. `marketingskills/influencer-marketing` and Kai's `kai-influencer` are
  planning documents. Finding 30 developer-creators who edit their own videos, watching their last
  three uploads, and writing each a specific note is manual work; Claude can draft from a transcript
  he supplies. `ericosiu/ai-marketing-skills` (MIT, 3,609 stars, last commit 2026-09-22) has
  `yt-competitive-analysis` for finding outlier videos and channels, which helps choose who to write to.
- **Demo-video distribution.** Nothing uploads to YouTube and cross-posts with platform-specific
  cuts in one flow. Postiz schedules the posts; the cuts, titles and thumbnails are separate.
  `ZubeidHendricks/youtube-mcp-server` (MIT, 579 stars, last commit not checked beyond push date
  2026-08-08) manages uploads; I did not read its code.
- **Short-form repurposing.** This is Bay's own job (`find_highlights`, `add_subtitles`, `set_canvas`,
  `export_timeline` are in its catalog). Every repurposing skill found either writes scripts only or
  shells out to ffmpeg. Using Bay for it is also the most credible marketing asset available.
- **Mention monitoring with alerts.** last30days is on demand; Kai's listener is Reddit only. A
  scheduled "Bay / competitor mentioned on HN, Reddit, YouTube comments" feed does not exist as one
  open project. F5Bot's free tier (below) fills most of it with no code.
- **Product Hunt.** Only read-only MCP servers exist (0–2 stars each). There is no launch
  automation, and PH's rules would not allow the part worth automating.
- **CRM for a B2C tool.** Everything is built for B2B pipelines. A spreadsheet of interviewees and
  creators is the right size; `twentyhq/twenty` (57,993 stars, custom licence) is too much.

## Closed or commercial alternatives worth knowing

| Product | What it does | Price (checked 2026-10-07) | Note |
|---|---|---|---|
| F5Bot | Email alerts for keywords on Reddit, HN, Lobsters | Free tier; $9.99 and $49.99/month (f5bot.com) | Best value in this report. Covers the monitoring gap today |
| Octolens | Mentions across Reddit, HN, X, YouTube, GitHub, LinkedIn; has API and MCP | $159/month Pro, $499/month Scale, billed annually (octolens.com/pricing) | Out of budget; shows what the paid version of the gap costs |
| Postiz Cloud | Hosted scheduler | $29 / $39 / $49 / $99 per month | Same code as the open-source app |
| GooseWorks | The paid API behind `goose-skills` (scraping, enrichment, ad generation) | $29 / $59 / $149 per month; README and pricing page mention 1,000 free credits via your own agent | Skills are MIT but 117 of 295 skill files reference the GooseWorks service. Ads-first, wrong stage |
| OneShot | The paid API behind `oneshot-gtm` | Per call, settled in USDC on Base (README); no price list read | B2B outbound, wallet setup. Poor fit |
| Resend | Email | Free 3,000/month; $20/month for 50,000 | Pick 5 |
| Composio | Hosted connectors for 1,000+ apps incl. Reddit posting | Not checked | Its Reddit write path is the one to avoid |
| Typefully | X/LinkedIn writing and scheduling with an API | **Could not read the pricing page** | Simpler than Postiz if X is the only channel |
| Clay, Apollo, Instantly, Smartlead, 11x, Artisan | B2B enrichment and AI SDR | Not checked | Wrong motion for a prosumer creative tool |

## Safety notes

**Run draft-only, with a person approving every send:**

- Postiz: create as `draft`, promote by hand. Never give an unattended loop the schedule command.
- Resend MCP: allow create and update; the person sends broadcasts.
- `marketingskills/tools/clis/*`: do not put Instantly, Lemlist or Buffer keys in the environment
  unless a send is intended.
- Any Reddit MCP with write tools (`jordanburke/reddit-mcp-server` has `create_post` and
  `reply_to_post`, with a "safe mode" rate limiter). Use the read tools only.

**Automations that risk the account:**

- **Reddit.** Per secondary sources (redditapis.com and an r/redditdev mirror, not Reddit's own
  page today), new API credentials have needed a reviewed application since 2025-11-11 under the
  Responsible Builder Policy, and automated accounts carry a visible label since 2026-03-31.
  `jordanburke/reddit-mcp-server`'s README confirms unauthenticated API access now returns 403.
  An agent posting replies that mention Bay is the textbook case for a site-wide ban and for
  subreddit bans that outlive the account. Read with tools, write by hand.
- **Hacker News.** No posting API. The guidelines forbid asking for votes and, as I recall them,
  generated comments (not re-read today). A flagged Show HN cannot be repeated, and the plan
  already treats the first launch as a one-shot.
- **LinkedIn.** `stickerdaniel/linkedin-mcp-server` (Apache-2.0, 3,765 stars) drives your real
  logged-in browser session and can send messages and connection requests. LinkedIn's User
  Agreement prohibits automated access; restrictions land on the personal profile. Avoid.
- **X.** Scheduling your own posts through the API is fine. Automated replies, follows or DMs, and
  cookie-based scraping from the main account, are not.
- **Cold email to creators.** CAN-SPAM requires a real sender, a postal address and a working
  opt-out. EU and UK recipients who are individuals generally need consent. Addresses scraped from
  YouTube "About" pages break YouTube's terms. Low volume, written by hand, from a personal mailbox,
  to people whose work he actually watched, is both the compliant version and the effective one.
- **Product Hunt.** Asking for upvotes or coordinating them gets a launch demoted.

**Supply-chain note.** Skills are instructions the agent follows with his permissions, and several
of these repos ship scripts and install pages the agent is told to fetch (`goose-skills` installs
from a remote `install.md`). Install named skills, not whole libraries, and read a skill before the
first run. The in-app Bay agent is unaffected: it loads only Bay's own skills.

## Appendix A — notable discards

| Repo | Stars | Last commit / push | Why not |
|---|---|---|---|
| `oneshot-agent/oneshot-gtm` | 691 | 2026-10-06 | Well built, MIT, but B2B outbound through a paid USDC-settled API; README excludes consumer motions |
| `Othmane-Khadri/YALC-the-GTM-operating-system` | 317 | 2026-08-20 | "Open-source Clay alternative": LinkedIn + email campaigns via Unipile, Crustdata, Instantly. README says the company has moved to a closed 2.0 |
| `gooseworks-ai/goose-skills` | 1,234 | 2026-10-06 | MIT wrapper around a paid service; ads and lead generation first |
| `gtmagents/gtm-agents` | 412 | 2026-04-03 | Six months without a commit, 100 open issues + PRs; B2B sales/CS agents |
| `zapier/gtm-cheat-codes` | 342 | 2026-06-29 | For GTM teams with a CRM and Zapier; assumes a sales org |
| `Infrasity-Labs/dev-gtm-claude-skills` | 139 | 2026-06-29 | Developer-marketing audits (docs, llms.txt, blog counts). Live data needs DataForSEO, Clay or Apify. 183 MB repo that bundles other people's skill sets |
| `kostja94/marketing-skills` | 1,016 | 2026-10-06 | 172 Markdown skills, no code. Overlaps marketingskills with less adoption |
| `irinabuht12-oss/marketing-skills` | 3,728 | 2026-09-24 | No licence file. Funnel for the same vendor's hosted ads MCP (`google-ads-meta-ads-mcp`, `Ryze-AI-Adgent/open-seo-mcp-skills`) |
| `ericosiu/ai-marketing-skills` | 3,609 | 2026-09-22 | Agency-scale workflows (Gong, RB2B, outbound). Kept only as a pointer for its YouTube analysis skills |
| `Cold-IQ/ColdIQ-s-GTM-Skills` | 295 | 2026-09-01 | No licence; cold-email templates and Clay workflows for B2B |
| `LeadMagic/gtm-skills` | 60 | 2026-10-01 | Vendor skills for a B2B enrichment product |
| `anthropics/knowledge-work-plugins` (marketing plugin) | 26,439 | marketing folder 2026-09-21 | Apache-2.0, sound, but built for Cowork teams: 8 skills wired to Slack, HubSpot, Canva, Ahrefs, Amplitude, Similarweb connectors he does not use |
| `AgriciDaniel/claude-seo`, `claude-blog`, `claude-ads` | 18,421 / 2,335 / 9,760 | 2026-10-04 / 09-11 / 09-10 | Good and MIT. SEO was installed and removed; ads is the wrong stage; blog is worth revisiting when there are posts to write |
| `zubair-trabzada/geo-seo-claude`, `TheCraigHewitt/seomachine` | 10,948 / 7,479 | 2026-10-05 / 10-06 | AI-search audits and a WordPress long-form workspace. Nothing to audit yet |
| `karanb192/reddit-mcp-buddy` | 846 | 2026-08-04 | Fine read-only Reddit MCP; last30days covers the same need with more sources |
| `stickerdaniel/linkedin-mcp-server` | 3,765 | 2026-10-06 | Account risk, see Safety |
| `iPythoning/b2b-sdr-agent-template` and the other "AI SDR" results | 190 and below | various | Export-sales SDRs, n8n demos, or abandoned (2024–2025) |
| HN, Bluesky, Product Hunt, Beehiiv, Typefully, Buffer MCP servers | 0–49 each | mostly 2025 | Thin, stale, or single-author with no users. `pskill9/hn-server` (40 stars) last pushed 2024-12-31 |
| `PostHog/mcp` | 151 | archived | Archived; the official plugin he has replaces it |
| `sales-skills/sales` | — | — | Named in Composio's June 2026 round-up; the URL returns 404 |
| `ComposioHQ/awesome-claude-skills`, `VoltAgent/awesome-agent-skills`, `punkpeye/awesome-mcp-servers` | 76,603 / 35,281 / 95,880 | 2026-09-18 / 10-06 / 09-27 | Indexes, not tools. Used the search results they surface; did not read their marketing sections line by line |

## Appendix B — searches run (all 2026-10-07)

`gh search repos`, sorted by stars unless noted:

- Suites: `kai cmo harness`, `claude marketing skills`, `marketing skills claude code`, `gtm claude`,
  `gtm agent`, `gtm engineer claude code`, `ai sdr`, `marketing agent mcp`, `claude skills growth`,
  `claude-seo`, `claude-ads`, `user:AgriciDaniel`, `knowledge-work-plugins`, `ai cmo open source`,
  `marketing claude agent sdk`, `sales-skills`, `topic:claude-skills marketing`,
  `topic:gtm topic:claude-code`, `topic:marketing topic:claude-code`,
  `claude code plugins marketplace marketing`, `awesome claude skills`, `awesome mcp servers`.
- Community and launch: `outreach agent claude`, `reddit monitoring agent`, `reddit mcp server`,
  `hacker news mcp`, `product hunt launch skill`, `product hunt mcp`, `launch agent claude skills`,
  `launch strategy skill`, `social listening mcp`, `reply guy agent reddit`,
  `build in public skill claude`, `last30days`, `competitor monitoring agent`, `reddit skill claude code`.
- Social and email: `social media scheduling mcp`, `postiz`, `twitter mcp server`,
  `x mcp xdevplatform`, `linkedin mcp server`, `bluesky mcp`, `discord mcp server`, `typefully mcp`,
  `buffer mcp server`, `resend mcp`, `beehiiv mcp`, `listmonk mcp`, `newsletter agent claude`,
  `social media agent claude code`, `x twitter skill claude code posting`.
- Sales stack connectors: `hubspot mcp`, `apollo mcp server`, `clay mcp`, `instantly mcp`,
  `lemlist mcp`, `smartlead mcp`, `twenty crm mcp`, `cold email skill claude`.
- SEO and analytics: `posthog mcp`, `google search console mcp`, `ahrefs mcp`, `semrush mcp`,
  `programmatic seo claude`, `geo ai visibility skill`, `mcp marketing server meta ads google ads`.
- Video-specific: `youtube mcp server`, `youtube creator outreach`, `influencer outreach agent`,
  `youtube skill claude code`, `short form clips opus clip open source`,
  `content repurpose skill claude`.
- Founder-specific: `indie hacker marketing skills claude`, `founder marketing agent skills`,
  `developer marketing skills` (no results for any of the three).

Web: two searches for 2026 write-ups (surfaced Composio's "Top 10 sales and GTM skills", 2026-06-08,
which named goose-skills, ColdIQ, ericosiu and the missing `sales-skills/sales`); one each for
Reddit's Responsible Builder Policy and X API pricing; pricing pages for Postiz, GooseWorks,
Octolens, F5Bot, Resend, Typefully.

Local, read-only: `~/.claude/skills`, `~/.claude/agents`, `~/.claude/plugins` (installed list,
marketplaces, catalog cache), `~/.claude/kai`, `~/.claude/removed-skills-manifest.txt`,
`~/.agents/.skill-lock.json`, the `outreach` server entry and its README.

## What I could not verify

- Whether any of these tools works. Nothing was installed or run; every behaviour above is from
  README text or source files read, and is labelled where it is only a README claim.
- Issue quality. Only the open issues + PRs count was read, not the issues.
- `sales-skills/sales` (404), Typefully's prices (page returned no pricing), X's API prices (from
  third-party blogs only), Composio's and OneShot's prices (not looked up).
- Reddit's and Hacker News's current rules from their own pages. Reddit's is from secondary
  sources; HN's is from memory.
- Resend's acceptable-use wording on cold email, and the exact effort of self-hosting Postiz.
- The origin of the `landing-page` and `pricing-page` skills, and (strictly) of `content-strategy`
  and `copywriting`, which match marketingskills by shape but are not in the lock file.
- The code of `youtube-mcp-server`, `claude-blog`, `geo-seo-claude`, `seomachine`,
  `knowledge-work-plugins`, `resend-mcp` and `linkedin-mcp-server`: READMEs and file listings only.
- Whether marketingskills' partner funding affects its recommendations.
