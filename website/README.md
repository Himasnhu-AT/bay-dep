# website

The product site for Bay. Next.js 16 (app router), React 19, Tailwind v4, pnpm.

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build
pnpm lint
```

## Documents

| File | What it covers |
|---|---|
| [PROJECT.md](./PROJECT.md) | What the site is for, what is built, what is not. |
| [CLAUDE.md](./CLAUDE.md) | The working contract. Read before editing. |
| [DESIGN.md](./DESIGN.md) | Tokens, type scale, spacing, components, motion, contrast. |
| [VOICE.md](./VOICE.md) | How the copy sounds, how things are named, status words. |

## Layout

```
src/app/            routes: /, /agents, /status
src/components/     layout.tsx (the primitives), SiteNav, SiteFooter, Reveal
src/lib/product.ts  the name, kind, status, domain, contact, optional download
```

The theme lives in the `@theme` block in `src/app/globals.css`. Use the utilities it
generates rather than raw hex values, and add anything new to DESIGN.md in the same
commit.

The product name is read from `src/lib/product.ts` and appears nowhere else, so renaming
the app is one edit to one file.
