# Stage assessment — bay

**Date:** 2026-08-08 · **Source:** repo audit + founder answers · **Read with:** `../../MARKETING.md`

## The inputs

| Input | Value | How it was established |
|---|---|---|
| Revenue | $0 | No download, no pricing, no payment path anywhere in the repo |
| Team | 1 | Single git author, solo commit history across 99 commits |
| Marketing time | 15+ hrs/week | Founder, 2026-08-08 |
| Budget | $0/month, time only | Founder, 2026-08-08 |
| Business model | Open core: free app, paid options | Founder, 2026-08-08 |
| Channels active | None | No social accounts, no list, no published content, no launch |
| Analytics | None, and forbidden | `website/PRODUCT.md` brand commitment: no third-party runtime requests |
| Email capture | None | Only contact route is a `mailto:` in the site footer |
| Repo | Private, 0 stars | `gh repo view` |
| PMF | No, and not yet testable | No user has run the app. There is nothing to retain |

## Stage: **Pre-Launch ($0)**

Not "early". Early stage assumes a product a stranger can obtain. bay's own docs say the
status is *In development: real and running, not ready for a stranger*, and that there is no
download. Every pre-launch rule applies, including the uncomfortable ones.

**The goal of this stage is one thing:** find out whether the agent-native editor wedge is
real, before spending another quarter of engineering on parity features that serve the
crowded secondary market.

## What is genuinely strong here

1. **The wedge is unoccupied.** "The timeline and the agent are the same document, one
   engine, on your machine" is not a claim any competitor can make by adding a feature. It
   is architecture. That is rare this early.
2. **The honesty asset is a moat, not a liability.** `docs/native/parity-status.md` and
   `todo.testing.md` — publishing "the Windows build is green and has never been run" —
   is exactly the register the ICP trusts and the register no funded competitor will match.
3. **A real end-to-end proof already exists.** The "Volatility Drag" reel was built entirely
   through MCP tool calls and is documented frame by frame in `docs/native/reel-recipe.md`.
4. **Time is not the constraint.** 15+ hrs/week is a lot at this stage.

## What is actually blocking growth

Ranked. The first is the whole game.

1. **Nobody has ever seen it work.** `PRODUCT.md` states plainly: no screenshots, no
   recordings, no renders, no frames of the app exist. The product's entire claim is
   visual and behavioural, and there is zero visual evidence of it. This is the constraint.
   Everything downstream is blocked on it.
2. **There is no way to hear from anyone.** No list, no waitlist, no signal. A visitor who
   wants this cannot tell you so, except by writing an email unprompted.
3. **The repo is private.** For a developer tool whose ICP discovers things on GitHub and in
   MCP directories, the single biggest free distribution asset is switched off.
4. **The monetization model contradicts the architecture, and is unresolved.** Open core
   with no accounts, no server, and no telemetry rules out seat-based SaaS and metering.
   This does not block this quarter, but it blocks the pricing page, and it should be
   decided before any copy touches it.
5. **Measurement is constrained by a brand commitment you should keep.** No analytics is
   correct and on-brand. It means the plan must use first-party counting, and must not
   pretend to precision it cannot have.

## The real constraint, named

**Knowledge, not time or money.** You do not know whether anyone outside this machine wants
an agent-driven editor badly enough to install a pre-release binary. 15 hours a week spent
on parity features answers nothing about that. The plan below spends them on finding out.

## Stage transition checklist (Pre-Launch → Early)

Track these. Do not declare the transition early.

- [ ] Waitlist, deposits, demos, or referrals show real demand
- [ ] 10+ customer interviews confirm the pain with concrete past behaviour, not opinion
- [ ] Landing page conversion is credible for its traffic source
- [ ] A stranger can obtain and run the product (notarized build exists)
- [ ] Evidence labelled: observed behaviour, customer quote, or hypothesis
