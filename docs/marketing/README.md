# Cat Spotters — marketing one-pagers

Audience-specific versions of the same product story, built on the catspotters.com
design system — the tokens, type and component idiom in
`artifacts/coming-soon/public/index.html` on the `claude/catspotters-coming-soon`
branch, so these pages sit on the site without a seam. Single-theme light by design:
the site commits to the sun-bleached palette, so every colour is painted explicitly.

| File | Becomes | Audience |
|---|---|---|
| `charities.html` | `catspotters.com/forpurpose` | Other cat charities and the purpose sector. Adds the Syros Cats–only side of the app. |
| `boundless-life.html` | `catspotters.com/boundless` | Boundless Life — a pitch for collaboration with their cohorts. |
| `media.html` | `catspotters.com/media` | Editors and journalists. Contains bracketed placeholders for figures and quotes. |
| `workspace.html` | `admin.catspotters.com` | The shared Syros Cats / Fair Shake hub. Design only — not yet wired to auth. |
| `gate.html` | the password screen | What an outside reader meets before a locked document. Design only. |

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
