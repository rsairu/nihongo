# AGENTS.md

Notes for AI agents (Claude, Codex, Cursor, etc.) working in this repo.

## Pages

| File | What it is |
| --- | --- |
| `lookup.html` + `lookup.css` | **調べる — the canonical lookup page.** Served at `/` on Vercel (see `vercel.json`). |
| `vocab_clicker.html` + `vocab_clicker.css` | 語彙クリッカー — vocab parser and bubbles, with a compact copy of the lookup panel on the side. |
| `ondoku.html` / `ondoku.js` / `ondoku.css` | 音読タイマー — separate page; doesn't share the lookup code. |

## lookup.html is canonical

The lookup panel (dictionary, 例文, 漢字辞典, 類義語, 漢字表記, 手書き, history tabs, 小6モード)
is **defined by `lookup.html`**. The side panel in `vocab_clicker.html` is a
**picture-in-picture version** of that page. It has the same features and the same markup structure,
but it's smaller, and it sits next to the vocab bubbles.

- Build and change lookup features against `lookup.html` first, then mirror them into the clicker.
- Don't add lookup features only to the clicker. If the clicker needs something lookup.html doesn't have, add it to lookup.html too.
- The clicker can differ **only in presentation**: text-only mode tabs instead of icon tiles, a smaller
  handwriting toggle and pad, and tighter spacing. Behavior and element IDs must match.
- 手書き is an **input method, not a lookup mode**. On both pages it's the round `.handwriting-toggle`
  button (`#helperModeHandwriting`) to the left of the input inside `#helperForm`.
  It must never be a `.helper-mode` tab inside `#helperModes`, because the generic mode-tab listener
  and the toggle listener would both fire and the tab would close as soon as it opened.

## Shared code: why drift breaks things

Both pages load the **same** `config.js`, `gakusei.js` and `vocab_clicker.js`, and the same base `vocab_clicker.css`.
`lookup.css` is layered on top for the full-page look (rules scoped to `.lookup-page` / `.lookup-body`).

- `vocab_clicker.js` looks up elements by ID at load time. If an ID exists in one page's markup but not the
  other's, the script throws partway through on the page that's missing it, and every feature wired after that point stops working.
  **Any element the lookup JS uses must exist in both `lookup.html` and `vocab_clicker.html`.**
- Put base and compact styles in `vocab_clicker.css`. Put full-page overrides in `lookup.css`, scoped under `.lookup-page`.
- Clicker-only code (bubbles, parsing, known words, footer) must guard against its elements being absent,
  because lookup.html doesn't have them.

## Checklist for lookup changes

1. Change `lookup.html` (and `lookup.css` if needed).
2. Mirror the markup into the `.lookup-box` section of `vocab_clicker.html` with the same IDs and structure.
3. Update the 使い方 (`#about`) dialog on both pages if the controls changed.
4. Open both pages and exercise the feature, at desktop and phone widths, with no console errors.
   A quick diff of the panels:
   compare `lookup.html`'s `<main class="lookup-box lookup-page">` with `vocab_clicker.html`'s `<div class="lookup-box">`.
   Expected differences are presentational only (icons, `autofocus`, the wrapper tag and classes).

## Other

- `config.js` holds local settings and keys, and it isn't deployed (see `.vercelignore`). Start from `config.example.js`.
- `known_words.json`, `prompt.txt` and `reading_log.json` drive the vocab-extraction sessions. Don't reformat them.
