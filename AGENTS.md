# AGENTS.md

Notes for AI agents (Claude, Codex, Cursor, etc.) working in this repo.

## Pages

| File | What it is |
| --- | --- |
| `lookup.html` + `lookup.css` | **リトリーブ — the canonical lookup page.** Served at `/` on Vercel (see `vercel.json`). The name (formerly 調べる) is a play on "retrieve": Pila the dog fetching a word's meaning. Her icon (`icons_png/web/pila.png`) sits left of the title. |
| `vocab_clicker.html` + `vocab_clicker.css` | 語彙クリッカー — vocab parser and bubbles, with a compact copy of the lookup panel on the side. |
| `ondoku.html` / `ondoku.js` / `ondoku.css` | 音読タイマー — separate page; doesn't share the lookup code. |
| `history.html` + `history.js` + `history.css` | 履歴 — every word ever looked up, 50 per page. Linked from the end of the history tabs. Loads only `store.js`, not the lookup code. |

## lookup.html is canonical

The lookup panel (dictionary, 例文, 漢字辞典, 類義語, 使い分け, 漢字表記, ふりがな, 手書き, history tabs, 小6モード)
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
- `#helperInput` is a `<textarea rows="1">`, not an `<input>`, so ふりがな mode can wrap. In every other mode CSS keeps it
  one line high with `white-space: pre` (scrolls sideways like the old input). In ふりがな (`[data-mode="furi"]`) it is
  twice as tall and wraps. Enter submits (keydown handler), and line breaks are stripped on input and in `helperLookup`
  (`stripLineBreaks`). The height is `calc(1.2em + padding + border)`: change it together with the padding.
  On lookup.html `.lookup-row` has `width: 100%; max-width: 30rem`, the width the old `<input>` gave it.

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
- 辞書 has two English buttons under the definition. 訳語を表示 (`#helperGlossBtn`) shows `#helperGloss`, the English equivalent of the word itself (`entry.gloss`), on its own line under the reading in `.helper-reading-row`, in the reading's color and smaller (the button's text is that color too). 英訳を表示 (`#helperEnBtn`) shows `#helperEn`, the translation of the definition (`entry.en`).
  The gloss comes back with the 辞書 answer itself as the `訳:` line (parsed by `GLOSS_LINE_RE`), so there's no second request. Saved answers from before that line existed have no gloss: the first click fetches one with `buildGlossPrompt` (Haiku, `ensureHelperGloss`) and saves it like 英訳 does. `#helperGloss` stays outside `#helperKana`, so click-to-copy copies only the reading.
- New mode: add its builder and a `PROMPT_SETTINGS` entry to `prompts.js`, not to `vocab_clicker.js`.
  Then add the mode to `HELPER_MODES` and the label maps, `createCacheBank`, `createHelperItem` / `modeState`,
  `cachedModeEntry` / `cacheModeEntry`, `paintHelperItem`, `runHelperFetch`, the bank swap in `setGakuseiMode`,
  the per-mode colors in `vocab_clicker.css` and `history.css`, `MODES` in `history.js` and `api/store.js`,
  and the `mode` check in `db/schema.sql` (existing Supabase projects need the `alter table` from there).
- ふりがな (`furi`, `buildFuriPrompt`, `parseFuriResponse`): readings only, no meaning. `ルビ:` is Q with `{よみ}` after each
  kanji/digit run; `parseRubyLine` turns it into `[{ t, r? }]` for `<ruby>`. If the ruby's base text doesn't match Q
  (`sameFuriText`), the ruby is dropped and Q is shown plain with the reading under it. `別:` lists other readings that change
  the meaning (生物 → なまもの), shown as ほかの読み.
- `PROMPT_SETTINGS[mode].noGakusei` (ふりがな): the 小6モード harness isn't applied, the cache object is shared between the two
  levels (`cacheBanks.gakusei.furi = cacheBanks.standard.furi`), and answers are saved as `standard`.
- The proxy caps max_tokens at 1024 (`api/claude.js`). 小6モード's rewrite lives in `gakusei.js`, because the proxy uses it too.

## 漢字辞典 follow-up lookups

- Each 漢字辞典 card's 「よく使う言葉」 label has a row of small round icon buttons (`.jiten-follow` / `.jiten-follow-btn`, built in `renderJitenFollowPicker`): 辞書・例文・漢字辞典・類義語. The selected one (`jitenFollowMode`, default `dict`) decides which mode a word chip opens in; it has a ︶ bracket under it (`.active::after`).
- One shared value for all cards, saved in localStorage (`JITEN_FOLLOW_STORAGE_KEY`); `setJitenFollowMode` updates every picker on screen. The chips' hover color follows it via `.jiten-words[data-follow]`.
- The buttons are created by JS inside the card, so there's no static markup to mirror between the pages. Base sizes in `vocab_clicker.css`, larger ones in `lookup.css`.

## Saved lookups (store.js / api/store.js)

- Every answer and every looked-up word is saved. On load, the last 10 words come back as history tabs and their answers fill the caches, so reopening a saved word costs no API call.
- `store.js` exposes `window.LookupStore`. Hosted, it calls `api/store.js` (Supabase, gated by the same `ACCESS_CODE`). On localhost / file:// it uses this browser's localStorage instead.
- `vocab_clicker.js` saves from one place: `cacheModeEntry` → `persistModeEntry` (plus the 英訳 and 訳語 updates in `ensureHelperEnglish` / `ensureHelperGloss`). A new fetch path must go through `cacheModeEntry` or it won't be saved.
- Saved keys match the in-memory cache keys: the word, `cmpCacheKey(query)` for 使い分け, one row per character for 漢字辞典. 小6モード answers are stored with `level = 'gakusei'`.
- On load, `storeKeysFor(query, modes)` adds the 使い分け key only for words that were looked up in 使い分け (ふりがな sentences are long).
  `api/store.js` splits the `in.(…)` list into several requests so the URL stays short (`MAX_IN_LIST_CHARS`), and accepts queries up to 400 chars.
- `helperLookup` records the word (`record_lookup`). Re-running the word already on screen in another tab adds the mode without bumping `lookup_count`.
- The history page's × (`.history-delete`, with a confirm) calls `LookupStore.deleteLookup(query)`: it removes the history row and that word's saved answers, keeping 漢字辞典 rows because they're per character and shared. Hosted, that's the `delete` action → `delete_lookup` in `db/schema.sql`. A tab already open on lookup.html keeps the word in memory until reload.
- `lookup.html?q=語&mode=dict` opens a word directly (used by the history page); the query string is removed after it opens.
- Schema: `db/schema.sql`. Server env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ACCESS_CODE`. The browser never sees the Supabase key; RLS has no policies, so only the server key can read or write.

## Settings menu and 読書モード

- The ⚙ button (`#settingsBtn`) at the right of the topbar opens a dropdown (`#settingsMenu`), not a page. It's on both pages with the same IDs.
  It holds 文字の大きさ (`#fontDecBtn` / `#fontResetBtn` / `#fontIncBtn`), 小6モード (`#gakuseiBtn`, now a checkbox switch inside `#gakuseiRow`) and 読書モード. Put new settings here, not in the topbar.
- All settings live in localStorage only (per browser, synced between tabs via `storage` events). They are not written to Supabase.
- The gear shows state while closed: a 👓 badge bottom-left (`.settings-badge-reading`, via `html.reading-mode`) while 読書モード is on, a 🎓 badge bottom-right (`.settings-badge`, via `html.gakusei-mode`) while 小6モード is on. The menu labels carry the same emoji, gray while off.
- 読書モード (`#readingModeToggle`, `#readingSecondsInput`, default 180 s): after a lookup, new lookups are blocked for that many seconds and the 調べる buttons (`#helperBtn`, `#handwritingDraftLookupBtn`) go gray with a countdown.
- The gate is `readingBlocked()` at the top of `helperLookup`, so every entry point (button, Enter, bubbles, drag, 類義語/漢字辞典 clicks, handwriting) is covered. **New lookup entry points must go through `helperLookup`**. Anything that clears user input before calling it (handwriting candidates, the draft) checks `readingBlocked()` first so the input isn't lost.
- Not blocked: reopening history tabs (`selectHelperHistory`), 英訳, 例文を作り直す, 小6モード refetches, and `?q=` deep links from the history page (`skipReadingCooldown`).
- Settings and the cooldown end time are in localStorage and sync between tabs, so a reload doesn't reset the cooldown.

## Other

- `config.js` holds local settings and keys, and it isn't deployed (see `.vercelignore`). Start from `config.example.js`.
- `known_words.json`, `prompt.txt` and `reading_log.json` drive the vocab-extraction sessions. Don't reformat them.
- Icons: full-size sources live in `icons_png/`, and the pages load the smaller copies in `icons_png/web/` (192 px). `favicon.ico` (16/32/48 px, made from `icons_png/pila.png`) sits at the root, and every page links it with `<link rel="icon">`.
