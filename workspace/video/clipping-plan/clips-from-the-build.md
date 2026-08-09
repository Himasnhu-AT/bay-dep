# Clipping plan — from the uncut build

> **Dry run. Nothing here is cleared for publishing.** No footage exists yet, so every timestamp
> below is a locator into `../long-form/the-uncut-build.md` rather than into a file. Replace each
> one with a real in/out from the capture before anything is exported.
>
> **Source safety:** every clip scores 5. The source is footage of your own software on your own
> machine, with no guest, no customer, and no third-party material. Nothing here needs approval
> from anyone else. That will stop being true the moment a clip contains someone else's voice.

---

## Scored candidates

| # | Locator | Hook | Standalone | Proof | Tension | Safety | **Total** | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | Long-form § "you take it back" | 5 | 5 | 5 | 5 | 5 | **25** | ✅ Lead clip |
| 2 | A real failure, if one happens | 5 | 4 | 5 | 5 | 5 | **24** | ✅ Conditional, see below |
| 3 | Long-form § "the calls start landing" | 4 | 5 | 5 | 3 | 5 | **22** | ✅ Produce |
| 4 | Long-form § "it renders" through to the file | 3 | 4 | 5 | 3 | 5 | **20** | ✅ Produce |
| 5 | Cold open, the prompt typed live | 4 | 4 | 3 | 3 | 5 | **19** | ✅ Produce, as a reply asset |
| 6 | Media panel showing three demo tiles | 3 | 2 | 4 | 4 | 5 | **18** | ⚠️ Borderline, see below |

Threshold is 18/25. Rejected candidates are in `_kill-list.md`.

---

## Production rows

| Clip | Length | Surface | Hook | Adaptation |
|---|---|---|---|---|
| **1. The undo** | 12 to 18s | X, home page, README | ⌘Z takes back an edit you did not make | Tightest possible. Drag, undo, stop. No setup, no close card. This is the one that gets quoted |
| **2. The recovered failure** | 20 to 30s | X, as a standalone post | A tool call failed on camera | Only if it genuinely happens. Caption the failure, keep the recovery, cut nothing in between |
| **3. The calls landing** | 25 to 40s | X, README | The timeline filling with nobody touching it | Both panes, no zoom. Let the pace of the calls carry it |
| **4. Render to file** | 20 to 30s | X, replies | From tool call to a file in Finder | Ends on the file's size and duration in Finder. Caption any time removed |
| **5. The prompt** | 8 to 12s | Replies, when someone asks what you typed | The whole instruction, in one line | Silent, no card. It exists to answer a question, not to be posted cold |

---

## Notes on the two awkward ones

**Clip 2 cannot be planned, only caught.** It scores 24 and it is the second most persuasive
thing that could end up on camera, because the audience has watched a hundred demos where the
failure was edited out. It is listed so that if it happens you keep the take instead of
instinctively re-rolling. **Do not stage it.** A re-created failure is a re-creation, and this
is the one project that cannot afford one.

**Clip 6 is a published defect on camera.** The media panel lists three demo tiles rather than
your imports, which is in `parity-status.md` under open issues. Showing it deliberately is
on-brand and it scores just past the line, but it needs the fix landing soon after or it becomes
the clip people quote back. **Recommendation: hold it.** Post it the day the fix ships, as a
before and after. The same footage is worth more then, and it costs nothing to wait.

---

## Sequencing

Do not publish these on a schedule. Publish clip 1 with the loop, and hold the rest as replies
and follow-ups over the following two weeks, so the channel has something to say when someone
asks a question rather than posting into silence.

| Week | Post |
|---|---|
| 1 | The 60s loop, with clip 1 as the reply when someone asks about undo |
| 2 | Clip 3, on its own, with the tool list |
| 2 | Clip 4, if anyone asks whether it really encodes |
| 3+ | Clip 2, whenever it happens. Clip 6, the day its fix ships |
| Hold | Clip 5, purely reactive |

---

## Before any export

- [ ] Real in/out timestamps replace every locator above
- [ ] Menu bar checked: no badges, no personal wifi name, no low battery, no revealing clock
- [ ] No file paths on screen that expose anything you would not put in a commit
- [ ] Every caption re-read against `website/VOICE.md`
- [ ] Any removed time captioned on screen with the real number
- [ ] Tool count, if spoken or captioned anywhere, is **24**
