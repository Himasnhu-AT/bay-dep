# Style preview media

The agent panel shows each built-in editing style as a tile when the agent calls `search_styles`
(and at the top of a `read_style` card). This folder holds those tiles' media, one folder per
built-in style id (`src/shared/styles/*.ts`):

```
resources/styles/<id>/preview.webm   3–5 s muted loop, before → after
resources/styles/<id>/poster.webp    a still of the "after", shown before the loop plays
```

- **Format:** 16:9, 640×360, WebM (VP9, no audio track), under ~600 KB; poster WebP at the same
  size. The tile crops to 16:9 with `object-fit: cover`.
- **Only those two names are served** (`bay://style-preview/<id>/<file>`, `admitStylePreview` in
  `src/main/serve.ts`) and only those two are packaged (`extraResources` in
  `electron-builder.yml` → `Contents/Resources/styles/`). Anything else here stays in the checkout.
- **Missing media is not an error:** a tile whose poster does not load draws its neutral face
  (title, summary, tags). Under reduced motion the loop never plays; the poster is the tile.
- `src/main/styles/preview-media.test.ts` lists every built-in style still missing either file.
  It reports and passes until the media exists; then set `PREVIEW_MEDIA_REQUIRED = true` in that
  test and a missing file fails `pnpm test` by name.
