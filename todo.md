# bay — roadmap

Split into three files, because "done", "not built" and "built but never run" are three
different states and conflating them is how a green build gets mistaken for a working product.

| | |
|---|---|
| [`todo.completed.md`](todo.completed.md) | What is built and shipped — each entry with the evidence that proves it |
| [`todo.pending.md`](todo.pending.md) | What is not built, sized and ordered |
| [`todo.testing.md`](todo.testing.md) | What exists but has never been exercised, and how to exercise it |

---

## Where this actually stands

**Shipped and verified.** A user gets one binary, installs nothing, and the app fetches ffmpeg
(~57 MB) and narration (~1.2 GB) on request with a progress bar. Plus the `opencut → vii → bay`
rename with its data migrations, live agent editing (Stage 1), a real macOS menu bar and
lifecycle, one discoverable owner of the MCP endpoint, and a deterministic test suite —
386 passing. Detail and evidence in [`todo.completed.md`](todo.completed.md).

**An audit of the zero-install claim found three things it does not cover**, all now recorded:
a render or narration longer than 20 seconds reports a false timeout, the model weights download
with no progress at all, and there is no way to see or reclaim the disk any of it uses. None
stop a user installing and running — they are what happens *after* that.

**The Windows build is green and has never been run.** The CI proves it compiles, starts, and
has no console window; it does not open a window, install anything, or extract an archive. That
distinction is the whole reason [`todo.testing.md`](todo.testing.md) exists.

**Next, in order:** exercise Windows · fix the 20s slow-tool timeout · give the weight download
progress · the text→audio button · document types and Open Recent · the sidecar leak · the
assistant, read-only first.

**Deliberately not doing yet:** Linux, multiple windows, Stage 3 edit-conflict leases, and
vision until the palmier premise is verified.
