# Importing a Remotion film

Films built in the `productLaunch` Remotion repo are migrated into bay by scraping the rendered
DOM and mapping it onto the project format. The procedure, the full mapping table and the six
ways it goes silently wrong live with the exporter:

    ~/codes/productLaunch/schema-convert.md
    ~/codes/productLaunch/scripts/export-bay.mjs
    ~/codes/productLaunch/scripts/scrape-film-dom.md

Worth knowing from this side, because each one is a bay behaviour an importer has to know:

- Text is **clipped** to its `scale x canvas` box. It does not wrap and it does not shrink.
- Text lays out from the **top** of that box; every other element centres on its anchor.
- `letterSpacing` is in **em** (`bay-text`'s `letter_spacing_is_em_not_pixels`).
- `fontFamily` resolves against **installed system fonts**. Web fonts silently substitute.
- `ShapeKind` is tagged `kind`; `Element` is tagged `type`.
- Every effect needs an `amount` or the inspector cannot tune it.

Two env-gated tests exist to check an import without adding anything to CI:
`bay-project`'s `load_external_project` and `bay-preview`'s `render_external_project`.
