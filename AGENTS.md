# AGENTS.md

Notes for AI agents (Claude, Codex, Cursor, etc.) working in this repo.

## Pages

| File | What it is |
| --- | --- |
| `lookup.html` + `lookup.css` | **調べる — the canonical lookup page.** Served at `/` on Vercel (see `vercel.json`). |
| `vocab_clicker.html` + `vocab_clicker.css` | 語彙クリッカー — vocab parser and bubbles, with a compact copy of the lookup panel on the side. |
| `ondoku.html` / `ondoku.js` / `ondoku.css` | 音読タイマー — separate page; doesn't share the lookup code. |
| `history.html` + `history.js` + `history.css` | 履歴 — every word ever looked up, 50 per page. Linked from the end of the history tabs. Loads only `store.js`, not the lookup code. |

## lookup.html is canonical

The lookup panel (dictionary, 例文, 漢字辞典, 類義語, 使い分け, 漢字表記, 手書き, history tabs, 小6モード)
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

Both pages load the **same** `config.js`, `gakusei.js`, `prompts.js`, `store.js` and `vocab_clicker.js` (in that order), and the same base `vocab_clicker.css`.
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

## Prompts

- Every prompt the lookup panel sends lives in `prompts.js`, together with `PROMPT_SETTINGS` (model, max_tokens, temperature per mode).
  `vocab_clicker.js` sends them through `requestPrompt(kind, prompt, signal)` and parses the replies.
- Each prompt asks for labeled lines (`読み:`, `類義:`, `例A:` …) and the matching `parse…Response` in `vocab_clicker.js` reads those labels.
  The comment above each prompt names its parser and labels. Reword freely; change a label only together with its parser.
- もしかして: 辞書 and 漢字表記 both start with `候補:` (`buildSuggestionRules`, read by `parseSuggestion`). It's filled only when Q isn't an established word or spelling (typo, wrong kanji, bad conversion like 賞も無い). Then the answer is just `{ suggestion }`: the parsers drop any other lines, and `renderDictEntry` / `renderKanjiEntry` show 「見つかりませんでした。もしかして：〇〇」, where 〇〇 is a button that calls `helperLookup` in the same mode. That `{ suggestion }` is what gets cached and saved for the bad query, never a guessed definition or spelling. A lookup that ends in a suggestion cancels the 読書モード cooldown it started (`releaseReadingCooldown`), so tapping the suggestion isn't blocked.
- New mode: add its builder and a `PROMPT_SETTINGS` entry to `prompts.js`, not to `vocab_clicker.js`.
- The proxy caps max_tokens at 1024 (`api/claude.js`). 小6モード's rewrite lives in `gakusei.js`, because the proxy uses it too.

## Saved lookups (store.js / api/store.js)

- Every answer and every looked-up word is saved. On load, the last 10 words come back as history tabs and their answers fill the caches, so reopening a saved word costs no API call.
- `store.js` exposes `window.LookupStore`. Hosted, it calls `api/store.js` (Supabase, gated by the same `ACCESS_CODE`). On localhost / file:// it uses this browser's localStorage instead.
- `vocab_clicker.js` saves from one place: `cacheModeEntry` → `persistModeEntry` (plus the 英訳 update in `ensureHelperEnglish`). A new fetch path must go through `cacheModeEntry` or it won't be saved.
- Saved keys match the in-memory cache keys: the word, `cmpCacheKey(query)` for 使い分け, one row per character for 漢字辞典. 小6モード answers are stored with `level = 'gakusei'`.
- `helperLookup` records the word (`record_lookup`). Re-running the word already on screen in another tab adds the mode without bumping `lookup_count`.
- The history page's × (`.history-delete`, with a confirm) calls `LookupStore.deleteLookup(query)`: it removes the history row and that word's saved answers, keeping 漢字辞典 rows because they're per character and shared. Hosted, that's the `delete` action → `delete_lookup` in `db/schema.sql`. A tab already open on lookup.html keeps the word in memory until reload.
- `lookup.html?q=語&mode=dict` opens a word directly (used by the history page); the query string is removed after it opens.
- Schema: `db/schema.sql`. Server env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ACCESS_CODE`. The browser never sees the Supabase key; RLS has no policies, so only the server key can read or write.

## Settings menu and 読書モード

- The ⚙ button (`#settingsBtn`) at the right of the topbar opens a dropdown (`#settingsMenu`), not a page. It's on both pages with the same IDs.
  It holds 文字の大きさ (`#fontDecBtn` / `#fontResetBtn` / `#fontIncBtn`), 小6モード (`#gakuseiBtn`, now a checkbox switch inside `#gakuseiRow`) and 読書モード. Put new settings here, not in the topbar.
- All settings live in localStorage only (per browser, synced between tabs via `storage` events). They are not written to Supabase.
- The gear shows state while closed: green while 読書モード is on, a 🎓 badge (`.settings-badge`, via `html.gakusei-mode`) while 小6モード is on.
- 読書モード (`#readingModeToggle`, `#readingSecondsInput`, default 60 s): after a lookup, new lookups are blocked for that many seconds and the 調べる buttons (`#helperBtn`, `#handwritingDraftLookupBtn`) go gray with a countdown.
- The gate is `readingBlocked()` at the top of `helperLookup`, so every entry point (button, Enter, bubbles, drag, 類義語/漢字辞典 clicks, handwriting) is covered. **New lookup entry points must go through `helperLookup`**. Anything that clears user input before calling it (handwriting candidates, the draft) checks `readingBlocked()` first so the input isn't lost.
- Not blocked: reopening history tabs (`selectHelperHistory`), 英訳, 例文を作り直す, 小6モード refetches, and `?q=` deep links from the history page (`skipReadingCooldown`).
- Settings and the cooldown end time are in localStorage and sync between tabs, so a reload doesn't reset the cooldown.

## Other

- `config.js` holds local settings and keys, and it isn't deployed (see `.vercelignore`). Start from `config.example.js`.
- `known_words.json`, `prompt.txt` and `reading_log.json` drive the vocab-extraction sessions. Don't reformat them.
