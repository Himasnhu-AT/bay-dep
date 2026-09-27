Turn this 25-minute conference talk into one vertical short (45–55 seconds) for developers on TikTok, Reels and Shorts. The talk is "raylib: a 12-year adventure as a solo maintainer" by Ramon Santamaria at FOSDEM 2026 (raylib.mp4 in the media pool).

The story to find is in his own words, and it is a good arc:
- 12 years ago he had to teach game programming to art students with no programming knowledge, so he wrote a tiny library as a weekend project.
- It grew for 12 years, mostly unpaid.
- Only recently, for the first time in 12 years, could he work on it full time.
- What kept him going, and his lesson: keep it simple, and enjoy genuinely what you do.
Pick the strongest lines from the transcript. Use his words verbatim; don't invent any.

The recording is a conference composite, not a talking head. The slides fill most of the frame, and he is a small camera box in the bottom-right corner (about x 1420–1900, y 790–1060 in the 1920×1080 source), over a grey background. Lay it out for 9:16:
- Put the slide, cropped to just the slide, across the top.
- Put the speaker box, cropped tight and enlarged, below it.
- Put word-by-word subtitles in the Spotlight design where they read clearly on a phone.
- Measure the exact crop boxes with preview_frame first.
It is fine if the enlarged speaker is a little soft.

Make it hold attention:
- It opens on the hook line within the first second.
- Pauses and false starts are cut.
- Nothing sits still for more than about 3 seconds: alternate punch-ins on the speaker box, change slides, or add a short top-band graphic for the key phrases.
- The payoff ("for the first time in 12 years" / the lesson) lands around 60% of the way through.
- The last 2 seconds carry a small credit line: "FOSDEM 2026 · Ramon Santamaria · CC BY 2.0".

When it's built and checked, export it with export_timeline to /Users/himanshu/Movies/bay-rnd/talk-to-short/after.mp4 (mp4, 1080×1920, quality best, loudness streaming). Poll track_export until complete. Then tell me beat by beat what you kept, where each cut is in the source, and anything you couldn't do.
