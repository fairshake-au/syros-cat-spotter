# Cat Spotters — marketing one-pagers

Three audience-specific versions of the same product story, sharing one house style
(the Purropolis palette used by the Syros Cats proposal at
`proposals.fairshake.au/catspotters`).

| File | Audience | Lead colour |
|---|---|---|
| `charities.html` | Other cat charities and the purpose sector. Adds the Syros Cats–only side of the app. | Aegean |
| `boundless-life.html` | Boundless Life — a pitch for collaboration with their cohorts. | Olive |
| `media.html` | Editors and journalists. Contains bracketed placeholders for figures and quotes. | Terracotta |

## Editing

Edit `style.css` and the `*.body.html` fragments, then rebuild the standalone pages:

```sh
sh build.sh
```

`build.sh` inlines `style.css` at the `<!--STYLE-->` marker so each `.html` is
self-contained and can be published as an artifact or dropped onto the proposals site.
Never edit the built `*.html` files directly — they are overwritten.

## Facts these documents rely on

Per `CLAUDE.md`: sterilisation is **€50–60** per cat; the roles are **spotter** and
**cat guardian**; offline support is partial (photographs, locations and the map work
without a connection, identification does not); the two audiences are complementary;
and nothing here distinguishes what is built today from what is planned.
