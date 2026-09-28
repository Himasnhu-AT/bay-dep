# Generating images and video

Read this before any `generate_image` or `generate_video` call. Generation costs the user money,
takes minutes for video, and the model cannot see the edit it is for — the prompt is the only
thing that tells it.

## Cost first

1. Plan every generation the request needs: which shots, which model, which duration.
2. Run each call with `validateOnly: true`. It checks the options and returns
   `estimatedCostUsd`, and starts nothing.
3. Tell the user the plan and the estimated total in one message, and wait for their go-ahead
   — once for the request, not per call. If they already gave a budget or said go ahead, work
   within it; ask again only if the work would go past it.
4. Generate. Follow every job with one `track_generation` call before your final answer — it
   waits until the job lands. Read its `findings`: a blocking one means nothing was imported.
5. Never regenerate something that already landed. `track_generation` with no jobId lists
   recent jobs; a finished job returns its asset again rather than importing twice. If tracking
   fails or times out, look for the job before submitting a new paid request.

## One shot per line

Break the script into lines, and give each line one shot. A shot that must cover two ideas is two
shots. Write the list first (line → shot → still or clip → duration), and show it to the user with
the cost.

## Duration

Estimate how long each line takes to say before generating video to it:

- Normal speech is about 2.5 words per second (150 words a minute); brisk social delivery about
  3 words per second. Numbers count as the words they are spoken as ("2026" is four words).
- Pick the shortest duration the model offers that covers the line: Veo takes 4, 6 or 8 s (1080p
  and 4K are 8 s only); Kling takes 5 or 10 s. You can trim a generated clip; you cannot extend it.
- A line longer than the longest clip is two shots.

## References: decide what the reference is for

A call takes one `referenceAssetId`. Decide which job it does, and say so in the prompt:

- **Identity** — keep this person or product. "Keep the woman's face, hair and clothes from the
  reference exactly." Use a clear, well-lit image of the subject.
- **Style** — keep the look, not the content. "Match the reference's palette, lighting and film
  grain; the scene itself is new."
- **Continuity** — this shot follows that one. For video, the reference is the **first frame**:
  animate an approved still rather than describing it again in text.

Build continuity from one source. Generate and approve a hero still first; derive every other
view directly from it, one step away. Deriving view 3 from view 2 from view 1 lets small changes
pile up until the person no longer looks like themselves.

Exact product, logo, packaging and UI come from files the user supplies — use them as the
reference, never ask the model to invent a brand.

## Framing for the edit

- Match `aspectRatio` to the timeline (9:16 for vertical) so nothing is cropped later.
- When captions will occupy the lower third, keep the subject out of it. Say it as camera
  directions: "head and shoulders in the upper half of the frame, empty space below the chest".
  Never ask the model to draw the captions.
- Leave room where graphics will go: "subject on the right third, plain wall on the left".
- For talking or reacting shots, the subject faces the lens with the head straight, mid-action
  rather than frozen.

## Writing the prompt

- Be concrete: subject, action, camera (distance, angle, movement), light, setting, palette. A
  few specific details beat a list of adjectives.
- Describe what the camera sees, not metaphors — a model draws a metaphor literally.
- Say what to leave out, as a plain list: "no text, no captions, no logos, no watermark, no
  extra people". For video put it in `negativePrompt`.
- bay draws its own text and captions; never ask a model to render words on screen.

## Placing the result

`track_generation` with `place: true` and `atFrame` puts it on the timeline when it lands. Trim
with `edit_item`; mute a generated clip's own sound unless you asked for it.

## Verify

- [ ] Cost stated and agreed before the first paid call.
- [ ] Every job tracked to completion; findings read.
- [ ] `frame_grid` over the placed shots: identity holds across shots, subjects clear of the
      caption area, no generated text or logos.
- [ ] Tell the user what was generated and roughly what it cost.
