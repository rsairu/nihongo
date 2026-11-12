# AGENTS.md

Notes for AI agents (Claude, Codex, Cursor, etc.) working in this repo.

## Pages

| File | What it is |
| --- | --- |
| `lookup.html` + `lookup/` + `lookup.css` | **リトリーブ — the canonical lookup page.** Served at `/` on Vercel (see `vercel.json`). The name (formerly 調べる) is a play on "retrieve": Pila the dog fetching a word's meaning. Her icon (`icons_png/web/pila.png`) sits left of the title. |
| `vocab_clicker.html` + `vocab_clicker.js` + `vocab_clicker.css` | 語彙クリッカー — vocab parser and bubbles, with a compact copy of the lookup panel on the side. |
| `ondoku.html` / `ondoku.js` / `ondoku.css` | 音読タイマー — separate page; doesn't share the lookup code. |
| `history.html` + `history.js` + `history.css` | 履歴 — every word ever looked up, 50 per page. Linked from the end of the history tabs. Loads only `store.js`, not the lookup code. A filter row at the top (`#historyFilter`: すべて + the mode icons in the same order as lookup.html's `#helperModes`) shows only words looked up in one mode; clicking the active icon again clears it. The filter runs server-side (`LookupStore.history({ mode })` → `modes=cs.{…}` in `api/store.js`), so the count and paging stay right, and it's kept in `?mode=` so it survives going to a word and back. While filtered, rows open in that mode. Each row's left edge is a 6px mode-colored band that fades into the card (a background gradient under a transparent left border). |

## lookup.html is canonical

The lookup panel (dictionary, 例文, 漢字辞典, 類義語, 使い分け, 漢字表記, ふりがな, 言い回し, 手書き, history tabs, 小6モード)
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
- `#helperInput` is a `<textarea rows="1">`, not an `<input>`, so ふりがな and 言い回し can wrap. In every other mode CSS keeps it
  one line high with `white-space: pre` (scrolls sideways like the old input). In ふりがな (`[data-mode="furi"]`) and
  言い回し (`[data-mode="iimawashi"]`) it is twice as tall and wraps. Enter submits (keydown handler), and line breaks are stripped on input and in `helperLookup`
  (`stripLineBreaks`). The height is `calc(1.2em + padding + border)`: change it together with the padding.
  On lookup.html `.lookup-row` has `width: 100%; max-width: 30rem`, the width the old `<input>` gave it.

## Shared code: why drift breaks things

Both pages load the **same** `config.js`, `gakusei.js`, `prompts.js`, `store.js` and the `lookup/` files (in that order), and the same base `vocab_clicker.css`.
`vocab_clicker.html` then loads `vocab_clicker.js` last. `lookup.css` is layered on top for the full-page look (rules scoped to `.lookup-page` / `.lookup-body`).

The lookup panel is split into these files, loaded in this order on both pages:

| File | What's in it |
| --- | --- |
| `lookup/common.js` | Small text helpers used by more than one mode: `isKanjiChar`, `looksJapanese`, `renderLookupText`, `stripWrappingQuotes`, `isNoneList`, もしかして (`parseSuggestion`, `isSuggestionEntry`, `renderSuggestion`). |
| `lookup/api.js` | Sending prompts: API key vs. `/api/claude` proxy, access code, 小6モード harness, `requestPrompt` / `requestClaudeText`. |
| `lookup/core.js` | The center: `HELPER_MODES` and labels, cache banks, history tabs, `cachedModeEntry` / `cacheModeEntry`, `paintHelperItem` (which mode to show), `runHelperFetch` (which mode to fetch), `helperLookup` (every lookup's entry point), `setHelperMode`, drag-and-drop targets, the input box. |
| `lookup/saved.js` | Saving and restoring through `store.js`: `persistModeEntry`, `storeKeysFor`, `applyStoredEntries` (+ `repairStoredEntry` / `repairWordList` for old saved answers), `hydrateFromStore`, `initLookupStore`, `?q=` deep links. |
| `lookup/modes/<mode>.js` | One file per mode (`dict`, `kanji`, `sentence`, `thes`, `cmp`, `jiten`, `furi`, `iimawashi`): that mode's elements, state, `parse…Response`, `fetch…`, `render…` and its own buttons. 辞書 also has 英訳 / 訳語; 例文 has 作り直し, its 英訳 and highlight-to-look-up; 漢字辞典 has the follow-up picker. |
| `lookup/handwriting.js` | The 手書き toggle, canvas, Google recognition, candidates and draft. |
| `lookup/pool.js` | 待てモード's あとで pool: words typed during the cooldown, the Opus pick (`pickPoolWord`), the pills. Loaded before `settings.js`, which calls into it. |
| `lookup/settings.js` | The ⚙ menu: 文字の大きさ, アイコンだけ表示, 小6モード (`setGakuseiMode`, including the cache bank swap), 待てモード (`readingBlocked`, cooldown). |
| `lookup/start.js` | Runs last: `renderHelperModes()` and `initLookupStore()`. |
| `vocab_clicker.js` | Clicker only (`vocab_clicker.html` only, after `lookup/`): vocab-list parsing, bubbles, selection and CSV, `known_words.json`, dragging a bubble out, highlight-to-look-up inside bubbles. |

These are plain `<script>` tags, not modules, so every file's top-level `const` / `let` / functions are shared by name.
- **Load order matters for code that runs immediately** (top-level statements, and anything they call). Code inside functions and event handlers runs later, when every file is loaded, so it can use anything.
  If you add top-level code that calls into another file, that file must be listed earlier. A file that throws while loading stops everything after it.
- Keep the `<script>` lists in `lookup.html` and `vocab_clicker.html` identical (the clicker adds `vocab_clicker.js` at the end).
- `vocab_clicker.js` uses what `lookup/` defines (`helperLookup`, `helperLookupFromHighlight`, `pulseLookupBox`, `renderLookupText`, `looksJapanese`, `endWordDrag`, `VOCAB_DRAG_TYPE`), never the other way round.
- The `lookup/` files look up elements by ID at load time. If an ID exists in one page's markup but not the
  other's, the script throws partway through on the page that's missing it, and every feature wired after that point stops working.
  **Any element `lookup/` uses must exist in both `lookup.html` and `vocab_clicker.html`.**
- Clicker-only code (bubbles, parsing, known words, footer) goes in `vocab_clicker.js`, not `lookup/`. `lookup/` must not mention clicker elements or state.
  The `vocab-clicker-*` localStorage keys keep their old names everywhere so saved settings carry over.
- Put base and compact styles in `vocab_clicker.css`. Put full-page overrides in `lookup.css`, scoped under `.lookup-page`.

## Checklist for lookup changes

1. Change `lookup.html` (and `lookup.css` if needed).
2. Mirror the markup into the `.lookup-box` section of `vocab_clicker.html` with the same IDs and structure.
3. Update the 使い方 (`#about`) dialog on both pages if the controls changed.
4. Open both pages and exercise the feature, at desktop and phone widths, with no console errors.
   A quick diff of the panels:
   compare `lookup.html`'s `<main class="lookup-box lookup-page">` with `vocab_clicker.html`'s `<div class="lookup-box">`.
   Expected differences are presentational only (icons, `autofocus`, the wrapper tag and classes).

## Prompts

- Every prompt the lookup panel sends lives in `prompts.js`, together with `PROMPT_SETTINGS` (model, maxTokens, effort, thinking per mode).
  `lookup/api.js` sends them through `requestPrompt(kind, prompt, signal)`, and each mode's file in `lookup/modes/` parses the replies.
- Models are the 5.5 generation (2026-11-09): Haiku 5.5, Sonnet 5.5, Opus 5.5 (`CLAUDE_MODEL`, `CLAUDE_MODEL_SONNET`, `CLAUDE_MODEL_OPUS`).
  Their API rules: no `temperature` (any non-default value is a 400, so nothing sends it); adaptive thinking is **on by default** and
  thinking tokens count toward `max_tokens`. Modes with `thinking: false` turn it off in `buildClaudeBody` via `thinkingOffFor(model)`
  (Haiku 5.5 → `{type:"disabled"}`, Sonnet 5.5 → `{type:"between_tools"}`; both only at effort `high` or below). Opus 5.5 can't turn
  thinking off; `effort` is its only control. `output_config.effort` is sent for every mode. Replies are read by block type
  (`text` blocks only), and an empty reply that stopped at `max_tokens` throws. The new tokenizer counts about 30% more tokens than
  the 4.5 models did, so the old max_tokens were raised by that much.
- Each prompt asks for labeled lines (`読み:`, `類義:`, `例A:` …) and the matching `parse…Response` in `lookup/modes/<mode>.js` reads those labels.
  The comment above each prompt names its parser and labels. Reword freely; change a label only together with its parser.
- もしかして: 辞書 and 漢字表記 both start with `候補:` (`buildSuggestionRules`, read by `parseSuggestion`). It's filled only when Q isn't an established word or spelling (typo, wrong kanji, bad conversion like 賞も無い). Then the answer is just `{ suggestion }`: the parsers drop any other lines, and `renderDictEntry` / `renderKanjiEntry` show 「見つかりませんでした。もしかして：〇〇」, where 〇〇 is a button that calls `helperLookup` in the same mode. That `{ suggestion }` is what gets cached and saved for the bad query, never a guessed definition or spelling. A lookup that ends in a suggestion cancels the 待てモード cooldown it started (`releaseReadingCooldown`), so tapping the suggestion isn't blocked.
- 辞書 has two English buttons under the definition. 訳語を表示 (`#helperGlossBtn`) shows `#helperGloss`, the English equivalent of the word itself (`entry.gloss`), on its own line under the reading in `.helper-reading-row`, in the reading's color and smaller (the button's text is that color too). 英訳を表示 (`#helperEnBtn`) shows `#helperEn`, the translation of the definition (`entry.en`).
  The gloss comes back with the 辞書 answer itself as the `訳:` line (parsed by `GLOSS_LINE_RE`), so there's no second request. Saved answers from before that line existed have no gloss: the first click fetches one with `buildGlossPrompt` (Haiku, `ensureHelperGloss`) and saves it like 英訳 does. `#helperGloss` stays outside `#helperKana`, so click-to-copy copies only the reading.
- 辞書 with a kana-only query: the answer also has `表記:` (kanji spelling of the word that was defined; なし when it has none or only a very rare/archaic one) and `同音:` (up to 4 other common words with the same reading, in kanji). When several words share the reading, the prompt defines only the most common one, never mixing the others into ①②③. `parseDictResponse` keeps them as `entry.spelling` / `entry.homophones` only when Q has no kanji (`hasKanji`). `renderDictHeadword` shows the reading as 読み【表記】 (`#helperSpelling`, inside `.helper-headword` next to `#helperKana`) and the homophones as buttons in `#helperHomophones` that call `helperLookup(word, { mode: "dict" })`. 英訳 / 訳語 send `entry.spelling` as the word when it exists. The history page shows 読み【表記】 too (`dict.spelling` in the `summary=1` history rows). Answers saved before this have neither field.
- 辞書の辞書形 (2026-11-11): the answer also has `見出し:` (dictionary form of the word defined) and `活用:` (school-grammar name of Q's form: 連用形, て形, 過去形 …).
  When Q is inflected (疲れ果て, 美しく, 食べなかった) the prompt defines the dictionary form; 読み / 表記 / JA / 訳 are about 見出し. Words that are headwords themselves (例えば, 改めて, 疲れ) keep Q.
  `parseDictResponse` keeps them as `entry.lemma` / `entry.inflection` only when 見出し differs from Q (`sameHeadword`). The cache, saved row and history stay keyed by what was typed (Q).
  `renderDictHeadword` shows 読み【見出し】 (`dictHeadwordSpelling`: 表記 first, then 見出し unless it's kana equal to the reading), and `renderDictInflection` appends a `.helper-word-form` pill
  (the form name, title 「疲れ果てる」の連用形で調べました) to `#helperWord`; `paintHelperItem` resets `#helperWord` to Q on every paint, so the pill never leaks into other modes.
  英訳 / 訳語 send `dictDefinedWord(entry, query)` (表記 → 見出し → Q). The history page shows 読み【見出し】 too (`dict.lemma` in the `summary=1` rows).
- 辞書の使い方ラベル (2026-11-11): register is no longer written as prose (くだけた言い方。). The prompt lists `USAGE_LABELS` (in `lookup/modes/dict.js`, sent through `usageLabelPromptList()`)
  and the model puts them in JA as 〔口語〕: at the very start for the whole word, right after the number for one sense (②〔俗語〕…). Set: 新・侮蔑・卑語・俗語・口語・文章語・古風,
  each with `aliases` the model tends to write instead (〔俗〕, 〔くだけた〕 …) and a `tone` for color (`.usage-badge[data-tone]` in `vocab_clicker.css`: new / bad / warn / plain).
  `usageLineNodes` turns each line into [number, badges, text], moving known labels to just after ① (or the line start) wherever the model put them; unknown 〔…〕 stay text.
  Badges are sorted by their order in `USAGE_LABELS` (a fixed ranking, like adjective order: 新 first, then the hurtful ones, then slang, then register, then age), so array order is display order.
  〔新〕 is a label too (badge text 新用法, `inPrompt: false` because the prompt asks for it in its own rule). Line splitting (`splitSenses`, `NEW_USAGE_SPLIT_RE`) and `.def-new` still key off the raw 〔新〕 text before badges are made.
  To add a label, add one row to `USAGE_LABELS` where it should rank. `buildEnOnlyPrompt` drops the labels from 英訳 (〔新〕 → "(newer usage)"); the history page strips all of them from its one-line preview.
- New mode: add its builder and a `PROMPT_SETTINGS` entry to `prompts.js`. Put its parse / fetch / render code in a new `lookup/modes/<mode>.js`
  and add that `<script>` to both pages next to the other modes. Then add the mode to `HELPER_MODES` and the label maps, `createCacheBank`,
  `createHelperItem` / `modeState`, `cachedModeEntry` / `cacheModeEntry`, `paintHelperItem`, `runHelperFetch` (all in `lookup/core.js`),
  `persistModeEntry` / `applyStoredEntries` if its saved shape is special (`lookup/saved.js`), the bank swap in `setGakuseiMode` (`lookup/settings.js`),
  the per-mode colors in `vocab_clicker.css` and `history.css` (mirror every `[data-mode="…"]` rule) and a 48px icon in `icons_png/web/`, `MODES` in `history.js` and `api/store.js`,
  and the `mode` check in `db/schema.sql` (existing Supabase projects need the `alter table` from there).
- ふりがな (`furi`, `buildFuriPrompt`, `parseFuriResponse`): readings only, no meaning. `ルビ:` is Q with `{よみ}` after each
  kanji/digit run; `parseRubyLine` turns it into `[{ t, r? }]` for `<ruby>`. The whole-reading line (`#helperFuriReading`,
  click to copy) is shown only when there's no ruby: if the ruby's base text doesn't match Q (`sameFuriText`), the ruby is
  dropped and Q is shown plain with the reading under it. Q and its ruby are normal weight, with a little letter-spacing on Q. `別:` lists other readings that change
  the meaning (生物 → なまもの), shown as ほかの読み.
- 言い回し (`iimawashi`, `buildIimawashiPrompt`, `parseIimawashiResponse`, Opus 5.5 at effort medium, maxTokens 4096 for thinking):
  for a word, phrase or sentence, judges whether it's an established expression, a normal way to say it, or the author's own wording,
  and translates it. Labels: `ルビ:` (same `{よみ}` form as ふりがな, read with `parseRubyLine`; kept as `entry.ruby` only when its text is exactly Q, since 核 is located by character offset), `判定:` (one of `IIMAWASHI_VERDICTS`: 定型 dictionary idiom / 慣用的 conventional figure used the usual way /
  普通 literal combination / 独自 author's own / 不自然 / 不明; hovering or tapping/focusing the badge (`.iimawashi-badge-wrap`, tabindex 0)
  shows `.iimawashi-scale` under it: the `IIMAWASHI_SCALE` steps 定型 → 慣用的 → 普通 → 独自 as badges, the verdict in full color and the rest faded;
  不自然 is appended only when it's the verdict, 不明 gets no scale), `核:` (the part that matters), `解説:` (Japanese, plain text: no
  click-to-look-up on its kanji, since that grabs kanji runs, not words), `直訳:` and `訳:` (English), `関連:` (up to 4 related
  expressions as chips → 辞書). 慣用的 vs 普通 is "is there a conventional figurative piece" — keep that line clean in the prompt.
  - Q is shown with furigana from `entry.ruby` (`renderIimawashiQuery`, `.has-ruby` makes the line taller). Answers saved before 2026-11-11 have no ruby and show plain text.
    When 核's edge falls inside a kanji run that has a reading, the whole run goes into the mark so the reading isn't split.
  - 核 is highlighted in Q (`mark.iimawashi-core`). No lookup buttons on it (tried 2026-11-09, removed). When 核 isn't in Q verbatim
    (Q inflects it), 核 is shown as plain text on the 判定 line instead (`.iimawashi-core-text`).
  - English is hidden like 辞書's 英訳: one 英訳を表示 button (`#helperIimawashiEnBtn`) shows both 訳 and 直訳 (`#helperIimawashiEn`).
    They come in the same reply, so no second request. 直訳 is left out when it's the same as 訳 (`sameEnglish`). Shown/hidden is
    remembered per history item (`modeState(item, "iimawashi").enShown`, passed to `renderIimawashiEntry` by `paintHelperItem`).
- `PROMPT_SETTINGS[mode].noGakusei` (ふりがな): the 小6モード harness isn't applied, the cache object is shared between the two
  levels (`cacheBanks.gakusei.furi = cacheBanks.standard.furi`), and answers are saved as `standard`.
- The proxy (`api/claude.js`) allows only the three 5.5 model IDs, caps max_tokens at 4096 (言い回し needs room to think),
  forwards `output_config.effort` (low/medium/high) and only the thinking-off shapes, and never forwards `temperature`. 小6モード's rewrite lives in `gakusei.js`, because the proxy uses it too.

## 漢字辞典 follow-up lookups

- Each 漢字辞典 card's 「よく使う言葉」 label has a row of small round icon buttons (`.jiten-follow` / `.jiten-follow-btn`, built in `renderJitenFollowPicker`): 辞書・例文・漢字辞典・類義語. The selected one (`jitenFollowMode`, default `dict`) decides which mode a word chip opens in; it has a ︶ bracket under it (`.active::after`).
- One shared value for all cards, saved in localStorage (`JITEN_FOLLOW_STORAGE_KEY`); `setJitenFollowMode` updates every picker on screen. The chips' hover color follows it via `.jiten-words[data-follow]`.
- The buttons are created by JS inside the card, so there's no static markup to mirror between the pages. Base sizes in `vocab_clicker.css`, larger ones in `lookup.css`.

## Saved lookups (store.js / api/store.js)

- Every answer and every looked-up word is saved. On load, the last 10 words come back as history tabs and their answers fill the caches, so reopening a saved word costs no API call.
- `store.js` exposes `window.LookupStore`. Hosted, it calls `api/store.js` (Supabase, gated by the same `ACCESS_CODE`). On localhost / file:// it uses this browser's localStorage instead.
- The panel saves from one place: `cacheModeEntry` → `persistModeEntry` (plus the 英訳 and 訳語 updates in `ensureHelperEnglish` / `ensureHelperGloss`). A new fetch path must go through `cacheModeEntry` or it won't be saved.
- Saved keys match the in-memory cache keys: the word, `cmpCacheKey(query)` for 使い分け, one row per character for 漢字辞典. 小6モード answers are stored with `level = 'gakusei'`.
- On load, `storeKeysFor(query, modes)` adds the 使い分け key only for words that were looked up in 使い分け (ふりがな sentences are long).
  `api/store.js` splits the `in.(…)` list into several requests so the URL stays short (`MAX_IN_LIST_CHARS`), and accepts queries up to 400 chars.
- `helperLookup` records the word (`record_lookup`), but only once that mode has an answer: it passes `{ record }` to `runHelperFetch`, which calls `recordAnsweredLookup` on a cache hit, an answer already on screen, or a successful fetch (`finishHelperFetch` with no error; a second `helperLookup` while loading is merged into `pendingRecord`). A lookup that ends in an error (e.g. 漢字辞典 on a kana-only word, API failure) leaves no mode dot in the history. Re-running the word already on screen in another tab adds the mode without bumping `lookup_count`. Dots saved before this fix: the 2026-11-08 cleanup query at the end of `db/schema.sql`.
- The history page's × (`.history-delete`, with a confirm) calls `LookupStore.deleteLookup(query)`: it removes the history row and that word's saved answers, keeping 漢字辞典 rows because they're per character and shared. Hosted, that's the `delete` action → `delete_lookup` in `db/schema.sql`. A tab already open on lookup.html keeps the word in memory until reload.
- `lookup.html?q=語&mode=dict` opens a word directly (used by the history page); the query string is removed after it opens.
- Schema: `db/schema.sql`. Server env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ACCESS_CODE`. The browser never sees the Supabase key; RLS has no policies, so only the server key can read or write.

## Settings menu, アイコンだけ表示 and 待てモード

- The ⚙ button (`#settingsBtn`) at the right of the topbar opens a dropdown (`#settingsMenu`), not a page. It's on both pages with the same IDs.
  It holds 文字の大きさ (`#fontDecBtn` / `#fontResetBtn` / `#fontIncBtn`), アイコンだけ表示 (`#modeLabelsToggle` in `#modeLabelsRow`), 小6モード (`#gakuseiBtn`, now a checkbox switch inside `#gakuseiRow`) and 待てモード. Put new settings here, not in the topbar.
- All settings live in localStorage only (per browser, synced between tabs via `storage` events). They are not written to Supabase.
- The gear shows state while closed: a ⏳ badge bottom-left (`.settings-badge-reading`, via `html.reading-mode`) while 待てモード is on, a 🎓 badge bottom-right (`.settings-badge`, via `html.gakusei-mode`) while 小6モード is on. The menu labels carry the same emoji, gray while off.
- アイコンだけ表示 (`#modeLabelsToggle`, key `vocab-clicker-mode-labels-hidden`): adds `html.mode-labels-hidden`, which visually hides the `.mode-label` under each mode tile on lookup.html (still read by screen readers; the tiles carry `title`s) and enlarges the icons, mainly for phones. Styles are in `lookup.css`. A tiny inline script in lookup.html's `<head>` applies the class before first paint. The clicker's tabs are text-only, so its `#modeLabelsRow` is in the markup (shared IDs) but `hidden`.
- 待てモード (formerly 読書モード; ⏳; a play on the dog command 待て, since Pila fetches the words). Internal names (`readingMode`, `#readingModeToggle`, `reading-*` classes, `vocab-clicker-reading-*` keys) were kept so saved settings carry over.
  (`#readingModeToggle`, `#readingSecondsInput`, default 180 s): after a lookup, new lookups are blocked for that many seconds and the 調べる buttons (`#helperBtn`, `#handwritingDraftLookupBtn`) go gray with a countdown and read あとで.
- The gate is `readingBlocked()` at the top of `helperLookup`, so every entry point (bubbles, drag, 類義語/漢字辞典 clicks; the button, Enter and handwriting pool the word first, see あとで below) is covered. **New lookup entry points must go through `helperLookup`**. Anything that clears user input before calling it (handwriting candidates, the draft) checks `readingBlocked()` first so the input isn't lost.
- Not blocked: reopening history tabs (`selectHelperHistory`), 英訳, 例文を作り直す, 小6モード refetches, and `?q=` deep links from the history page (`skipReadingCooldown`).
- Settings and the cooldown end time are in localStorage and sync between tabs, so a reload doesn't reset the cooldown.
- あとで pool (2026-11-12, `lookup/pool.js`, `#helperPool` between `#helperForm` and `#helperHistory` on both pages): during the cooldown the 調べる buttons read あとで (still gray, with the countdown) and
  **typed input and handwriting are pooled instead of blocked**: the form's submit handler, `chooseHandwritingCandidate` and `lookupHandwritingDraft` call `addPoolWord` before `helperLookup`. Every other entry point
  (chips, bubbles, drags, もしかして, the pool pills themselves) still hits `readingBlocked()` in `helperLookup`. Max `POOL_MAX` (12) words, no duplicates; a full pool keeps the input.
  - Pills (`.pool-chip`: sand-colored, dashed, so they don't read as history tabs) have a word button and an ×. While waiting they're muted (`#helperPool.is-waiting`); afterwards clicking one calls `helperLookup(word)` in the selected mode.
  - おすすめを選ぶ (`#helperPoolPickBtn`, shown once the cooldown is over, the pool has 2+ words and there's no pick yet) sends `buildPoolPickPrompt(words)` (`PROMPT_SETTINGS.pool`: Opus 5.5, effort low, `noGakusei`) and reads `選: <number>` with `parsePoolPick`.
    The pick only marks its pill (`.is-pick`, ★); nothing is looked up until the pill is clicked, and any pill can be clicked. One word alone is the pick with no request. Adding a word or removing the pick clears it.
  - ⚙ おすすめを自動で選ぶ (`#poolAutoToggle` in `#poolAutoRow`, key `vocab-clicker-reading-pool-auto`, default off): `maybeAutoPickPool` runs the pick when the cooldown ends (`syncPoolWaiting`, called from `renderReadingCooldown`), only in a visible tab.
  - Every round starts empty: `helperLookup` calls `clearPoolForRound` right before `startReadingCooldown`, so looking anything up drops the whole pool. If that lookup ends in もしかして, `releaseReadingCooldown` → `restorePoolRound` puts the other words back.
  - Words and the pick live in localStorage (`vocab-clicker-reading-pool`) and sync between tabs, like the cooldown. Not written to Supabase.

## Other

- `config.js` holds local settings and keys, and it isn't deployed (see `.vercelignore`). Start from `config.example.js`.
- `known_words.json`, `prompt.txt` and `reading_log.json` drive the vocab-extraction sessions. Don't reformat them.
- Icons: full-size sources live in `icons_png/`, and the pages load the smaller copies in `icons_png/web/` (192 px). `favicon.ico` (16/32/48 px, made from `icons_png/pila.png`) sits at the root, and every page links it with `<link rel="icon">`.
