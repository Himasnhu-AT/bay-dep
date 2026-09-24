# The demo

Rebuilds bay's demo video, and records bay building it. Both are real: every step is a tool call
against a running editor over MCP, and the recording is of that editor's own window.

It doubles as the hardest dogfood test in the repo. Five defects were found by running it that
398 unit tests and thirty probes never reached — a crash at 1080p, tool calls delivered to the
wrong window, a Retina backing-scale mismatch, overlays capturing as opaque white, and
compositions missing from every export. Each of them renders as a *wrong picture* rather than an
error, which is why nothing below this level could see them.

```bash
pnpm build

open -na "node_modules/.pnpm/electron@*/node_modules/electron/dist/Electron.app" \
  --args "$PWD" --remote-debugging-port=9222 --user-data-dir=/tmp/bay-demo \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --disable-background-timer-throttling

node script/demo/record.mjs /tmp/bay-recording 10 &   # optional: film it
node script/demo/build-demo.mjs                        # the agent builds the video
kill %1

ffmpeg -framerate 10 -i /tmp/bay-recording/f%05d.png \
  -vf "scale=1920:-2:flags=lanczos,format=yuv420p" \
  -c:v libx264 -crf 20 -preset slow -r 30 /tmp/bay-mcp-demo.mp4
```

`BAY_MCP_SOCKET` overrides the socket if the app runs on another profile. `GSAP` overrides the
vendored copy of GSAP — vendored because bay blocks remote origins, so a CDN tag renders as a
still frame with nothing in any log.

**Launch it with `open`, not by exec'ing the binary.** A GUI app started from a shell with no
window server exits 133 with an empty log, which is indistinguishable from a crash on startup.

**The recorder captures the app's own window over CDP**, not the screen, so no desktop or cursor
drifts into frame and it keeps working on a machine nobody is sitting at.
