# Voice and naming

How the site talks, and what things are called. [DESIGN.md](./DESIGN.md) covers how it
looks. Read both before adding a page.

The one rule: **write the sentence a person would say out loud to a friend who asked what
the app does.** The studio's whole position is that it is not doing the AI-hype thing, so
the copy cannot sound like the AI-hype thing. Marketing register is off-brand here in a
way it would not be for other companies.

## Naming

### The product

This site sells one thing, and its name is a variable rather than a literal. It lives in
`src/lib/product.ts` along with what kind of thing it is, its status, its domain and its
contact address. Read it from there in copy, metadata, and page titles. Never type it into
a component, a class name, or a string that would need finding again if it changed.

The name is unsettled and may still be revisited, which is the whole reason for the rule.
Renaming the app should be one edit to one file.

Names are chosen for what the thing is, in plain words. Not invented compounds, not a word
with a letter removed, not anything with AI, Pro, or Studio in it. A name a person could
say to a colleague without explaining the spelling. Lowercase names stay lowercase, even
at the start of a heading; do not sentence-case them for tidiness.

### The studio

The studio is credited once, in the footer, and linked. It is not a parent brand this site
is a division of, and no page argues on its behalf. A visitor here came for the app.

### Pages and routes

Route slugs are one lowercase word: `/agents`, `/status`. There is no catalogue to sit under, so the
home page is the product page and every other route is a chapter of it.

### Headings

Sentence case everywhere. "What we believe", not "What We Believe". Headlines end in a
full stop when they are a sentence, which they usually are.

## Status vocabulary

The workspace rule is that documents distinguish what is designed from what is shipped,
and the site is a document. `status` in `src/lib/product.ts` is one of four words,
and it describes the app today:

- **Shipping**: a person can download it and use it for its actual job.
- **In beta**: usable, out in the world, still moving.
- **In development**: real and running, not ready for a stranger.
- **Early**: a start, and honest about it.

Do not promote the app because a page looks unbalanced. An empty download slot is a better
problem than a promise that does not hold.

## Copy rules

These come from the humanizer pass and they apply to every word on the site.

**No em dashes or en dashes.** Use a full stop, a comma, a colon, or restructure the
sentence. This is the single most reliable tell that a machine wrote something, and it is
worth the small inconvenience. The one exception is the browser title template in
`layout.tsx`, where the dash separates two names rather than punctuating a sentence.

**No rule of three.** "Native. Private. Quiet." reads as a slogan generator. Say the one
thing that is true and specific instead.

**No promotional adjectives.** Nothing is seamless, powerful, beautiful, blazing fast, or
revolutionary. Describe the mechanism and let the reader draw the conclusion: "the
cleaned-up text appears in whatever field you were already typing in" does more work than
"a magical dictation experience".

**No -ing tails.** "Running locally, ensuring your privacy" is padding. End the sentence.

**No negative parallelism.** Not "it's not just an editor, it's a workflow". Say what it
is.

**Prefer is and has.** "Write is a freewriting app" beats "Write serves as a freewriting
solution".

**Second person, present tense.** "You hold the right command key and talk." Not "users
can hold" and not "will be able to hold".

**Concrete over abstract.** A hotkey, a file path, a format, a number. Say that projects are files in a folder any other
program can open, because that is checkable, and "open standards" is not.

**Contractions are fine.** People use them.

Typographic apostrophes and quotes (`’`, `“`, `”`) are correct in rendered copy and are
not an AI tell in a design context; use the JSX entities or the characters directly.

### Before you commit copy

Read it aloud. Then check: any dashes, any triples, any sentence that could describe a
different app if you swapped the name out. The last one is the useful test. If the
paragraph would work for a competitor's product, it is not saying anything.

## What leaves the Mac

Every page that says what the app keeps to itself says the same thing, because a claim that
drifts between pages is a claim nobody can check. As of 2026-09-29 (the owner's decision):

- **Stays on the Mac:** projects, media, renders, file paths, prompts and your email address.
  Say "stays on your Mac", not "private" or "secure".
- **Leaves it:** anonymous usage events and crash reports, sent to this site. Both are on by
  default, and each has its own switch in Preferences › Privacy. Say all three parts (what,
  that it is on by default, where to switch it off) whenever you mention either. They carry
  a random install ID rather than a name or address.
- **Never write** "no telemetry", "nothing leaves your machine", "no analytics" about the app.
  "No analytics" is still true of this website, which loads nothing from anyone on arrival.

Access: anyone can download the app, and it asks you to sign in with Google on first launch;
any Google account with a verified address gets in. There is no waitlist, invitation or
referral, so do not write "request access", "by invitation" or "releasing soon".

## Metadata

Every page exports `metadata` with a `title` and a `description`. The description is one
plain sentence about that page, written to the same rules, because it shows up in search
results and in link previews where nothing else on the page does.
