# Fair Shake proposals site

A small Cloudflare Worker that serves static proposal pages at `proposals.fairshake.au`. Each proposal lives at its own path under `public/`.

## Syros Cat Spotter proposal

`public/catspotters/index.html` is the **master copy** of the proposal, served live at [proposals.fairshake.au/catspotters](https://proposals.fairshake.au/catspotters/). It is the single source of truth for this document — edit it, and nowhere else.

Two other files are kept in step with it, by hand, not by any build step:

- `docs/syros-cats-proposal.md` (repo root) — a Markdown mirror of the same content, easier to read and edit in a normal editor. When you change the master copy, update this too.
- `docs/proposal-numbered.txt` (repo root) — a plain-text export with every paragraph numbered, for comment rounds ("Reference these numbers when commenting, e.g. '14: this is wrong because...'"). Regenerate it from the master copy after any change that affects the numbered blocks.
- `docs/proposal.pdf` (repo root) — a generated PDF of the master copy, for anyone who wants a document rather than a web page. Regenerate with headless Chrome after any change:

  ```
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless --no-pdf-header-footer \
    --print-to-pdf=docs/proposal.pdf "file://$PWD/infra/proposals-site/public/catspotters/index.html"
  ```

  Before publishing, check the PDF actually renders correctly: render a few pages to PNG (e.g. `pdftoppm -r 60 -png`) and look at the first page, a middle page and the last page. Check margins are consistent, there's no white border or stray background, and nothing is cut off — a white-border bug got past a previous round because this check wasn't done.

## Syros Cats questions page

`src/questions.html` is a page of questions for Syros Cats, served by `src/worker.js` at `/catspotters/questions/<token>`. Answers save to the `ANSWERS` KV namespace, with no sign-in. The token is the Worker secret `QUESTIONS_TOKEN`, not in this repo, because the repo is public and the token is what keeps the answers private. A request without it gets a 404.

When a question is added or removed, update `src/questionIds.json` too: the Worker refuses ids that aren't on that list.

Read the answers with `curl <page link>/api/answers`. They can include names and email addresses, so delete them from KV once they're recorded.

To try it locally, put `QUESTIONS_TOKEN=<32 or more characters>` in `.dev.vars` and run `npx wrangler dev`.

## Publishing

```
npx wrangler deploy
```

from this directory. **Only publish with Samuel's explicit go-ahead** — this deploys straight to the live site with no review step in between.
