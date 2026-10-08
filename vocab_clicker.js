// プロンプト本文・モデル・トークン数は prompts.js（このファイルより先に読み込む）。ここは送信・解析・表示。
const KNOWN_STORAGE_KEY = "vocab-clicker-known";
const FONT_SCALE_STORAGE_KEY = "vocab-clicker-font-scale";
const GAKUSEI_STORAGE_KEY = "vocab-clicker-gakusei-mode";
const FONT_SCALE_MIN = 0.8;
const FONT_SCALE_MAX = 1.6;
const FONT_SCALE_STEP = 0.1;
const FONT_SCALE_DEFAULT = 1;

const SAMPLE_VOCAB = `=== New vocab ===
美味しい｜おいしい｜味がよくて、食べて気持ちがいいこと。
頑張る｜がんばる｜力を尽くして、一生懸命に物事をすること。
景色｜けしき｜目の前に広がる山や海などの眺め。
久しぶり｜ひさしぶり｜長いあいだ会っていなかったり、していなかったりすること。
当たり前｜あたりまえ｜当然で、特に不思議ではないこと。`;

const inputEl = document.getElementById("input");
const parseBtn = document.getElementById("parseBtn");
const inputActionBtn = document.getElementById("inputActionBtn");
const aboutLink = document.getElementById("aboutLink");
const aboutDialog = document.getElementById("about");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const knownFileBtn = document.getElementById("knownFileBtn");
const knownFileInput = document.getElementById("knownFileInput");
const bubblesEl = document.getElementById("bubbles");
const csvEl = document.getElementById("csv");
const copyBtn = document.getElementById("copyBtn");
const removeKnownBtn = document.getElementById("removeKnownBtn");
const fontDecBtn = document.getElementById("fontDecBtn");
const fontIncBtn = document.getElementById("fontIncBtn");
const fontResetBtn = document.getElementById("fontResetBtn");
const gakuseiBtn = document.getElementById("gakuseiBtn");
const helperForm = document.getElementById("helperForm");
const helperInput = document.getElementById("helperInput");
const helperBtn = document.getElementById("helperBtn");
const helperHistoryEl = document.getElementById("helperHistory");
const helperTabs = document.getElementById("helperTabs");
const helperScrollLeft = document.getElementById("helperScrollLeft");
const helperScrollRight = document.getElementById("helperScrollRight");
const helperResult = document.getElementById("helperResult");
const helperWord = document.getElementById("helperWord");
const helperModes = document.getElementById("helperModes");
const handwritingToggle = document.getElementById("helperModeHandwriting");
const helperDictBlock = document.getElementById("helperDictBlock");
const helperKanjiBlock = document.getElementById("helperKanjiBlock");
const helperKana = document.getElementById("helperKana");
const helperDef = document.getElementById("helperDef");
const helperEn = document.getElementById("helperEn");
const helperEnBtn = document.getElementById("helperEnBtn");
const helperKanjiForm = document.getElementById("helperKanjiForm");
const helperKanjiMeter = document.getElementById("helperKanjiMeter");
const helperKanjiLabel = document.getElementById("helperKanjiLabel");
const helperKanjiNote = document.getElementById("helperKanjiNote");
const helperSentenceBlock = document.getElementById("helperSentenceBlock");
const helperSentence = document.getElementById("helperSentence");
const helperSentenceEn = document.getElementById("helperSentenceEn");
const helperSentenceEnBtn = document.getElementById("helperSentenceEnBtn");
const helperSentenceRegenBtn = document.getElementById("helperSentenceRegenBtn");
const helperSentencePrev = document.getElementById("helperSentencePrev");
const helperThesBlock = document.getElementById("helperThesBlock");
const helperSimilar = document.getElementById("helperSimilar");
const helperOpposite = document.getElementById("helperOpposite");
const helperCmpBlock = document.getElementById("helperCmpBlock");
const helperCmp = document.getElementById("helperCmp");
const helperCmpRegenBtn = document.getElementById("helperCmpRegenBtn");
const helperJitenBlock = document.getElementById("helperJitenBlock");
const helperJitenList = document.getElementById("helperJitenList");
const lookupBox = document.querySelector(".lookup-box");
// lookup.html は調べるパネルだけのページ（解析欄・バブル・既知リストなし）。同じスクリプトを共有する。
const HAS_PARSER = Boolean(inputEl && bubblesEl);
const HELPER_HISTORY_LIMIT = 10;
const HELPER_MODES = ["dict", "kanji", "sentence", "thes", "cmp", "jiten"];
const HELPER_MODE_LABELS = { dict: "辞書", kanji: "漢字表記", sentence: "例文", thes: "類義語", cmp: "使い分け", jiten: "漢字辞典" };
const HELPER_MODE_CHIP_LABELS = { dict: "辞書", kanji: "漢字", sentence: "例文", thes: "類義", cmp: "使分", jiten: "字典" };
// 漢字辞典: 入力の中の漢字を1字ずつ引く（1字1リクエスト、並列）。キャッシュも1字単位なので 景色 と 風景 で 景 を共有する。
const JITEN_MAX_CHARS = 4;
const JITEN_MAX_WORDS = 6;
const KANJI_USAGE_LABELS = ["なし", "まれ", "かな優先", "どちらも", "漢字優先"];
const KANJI_METER_STEPS = 4;
const VOCAB_DRAG_TYPE = "application/x-vocab-item";
// 手書きは HELPER_MODES（取得・キャッシュ・履歴を持つモード）ではなく入力方法。
// タブの見た目だけ renderHelperModes で共通管理し、候補を選ぶと辞書で helperLookup する。
const HANDWRITING_TAB = "handwriting";
const HANDWRITING_ENDPOINT = "https://inputtools.google.com/request?ime=handwriting&app=translate&dbg=0&cs=1&oe=UTF-8";
const HANDWRITING_LANGUAGE = "ja";
const HANDWRITING_MAX_CANDIDATES = 10;
const HANDWRITING_AUTO_RECOGNIZE_MS = 850; // ペンを離してから自動認識するまで
let handwritingOpen = false;

/** @type {{word: string, reading: string, meaning: string}[]} */
let items = [];
/** @type {string[]} first-select order */
let selected = [];
/** @type {Set<string> | null} normalized words from known_words.json; null until a file is loaded */
let knownWordSet = null;
/** @type {FileSystemFileHandle | null} */
let knownFileHandle = null;
let knownFileName = "";
/** how many parsed words the last parse dropped as already known */
let lastExcludedCount = 0;
/** @type {Record<string, {ja: string, en: string}[]>} */
// 小6モード (gakusei_mode): 返ってくる説明をすべて小学6年生レベルにする。レベルごとにキャッシュを分ける。
let gakuseiMode = false;
function createCacheBank() {
  return { sentence: {}, dict: {}, kanji: {}, thes: {}, jiten: {}, cmp: {} };
}
const cacheBanks = { standard: createCacheBank(), gakusei: createCacheBank() };
let sentenceCache = cacheBanks.standard.sentence;
let dictCache = cacheBanks.standard.dict;
let kanjiCache = cacheBanks.standard.kanji;
let thesCache = cacheBanks.standard.thes;
/** @type {Record<string, object>} 使い分け: key は正規化した語の並び（"補償・報酬"） */
let cmpCache = cacheBanks.standard.cmp;
/** @type {Record<string, object>} one entry per kanji character */
let jitenCache = cacheBanks.standard.jiten;
/** @type {AbortController | null} */
let helperEnAbort = null;
let helperEnRequestId = 0;
/** @type {{reading: string, ja: string, en: string} | null} */
let helperEntry = null;
let helperEnShown = false;
let helperNextId = 0;
let helperActiveId = 0;
let helperExpandedId = 0;
/** @type {"dict" | "kanji" | "sentence" | "thes" | "cmp" | "jiten"} */
let helperMode = "dict";
let helperSentenceEnShown = false;
/** @type {{id: number, query: string, context: {reading: string, meaning: string} | null, mode: string, usedModes: string[], dict: object, kanji: object, sentence: object, thes: object, cmp: object, jiten: object}[]} */
let helperHistory = [];

function extractNewVocabBlock(raw) {
  let text = raw.replace(/\r\n/g, "\n");
  text = text.replace(/```[\w]*\n?/g, "").replace(/```/g, "");
  const startMatch = text.match(/===\s*New vocab\s*===/i);
  if (!startMatch) return text.trim();
  const start = startMatch.index + startMatch[0].length;
  const rest = text.slice(start);
  const endMatch = rest.match(/\n===\s*Flashcard\s*===/i);
  return (endMatch ? rest.slice(0, endMatch.index) : rest).trim();
}

function parseVocab(raw) {
  const block = extractNewVocabBlock(raw);
  const parsed = [];
  const seen = new Set();
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^===\s*New vocab\s*===/i.test(trimmed)) continue;
    if (/^Word[｜|]/i.test(trimmed)) continue;
    const parts = trimmed.split(/[｜|]/).map((p) => p.trim());
    if (parts.length < 3) continue;
    const [word, reading, ...meaningParts] = parts;
    const meaning = meaningParts.join("｜").trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    parsed.push({ word, reading, meaning });
  }
  return parsed;
}

function csvText() {
  return selected.join(",");
}

function knownWordsInCurrentList() {
  const knownSet = new Set(selected);
  return items.filter((it) => knownSet.has(it.word)).map((it) => it.word);
}

function saveKnown() {
  try {
    localStorage.setItem(KNOWN_STORAGE_KEY, JSON.stringify(selected));
  } catch (_) {
    /* ignore */
  }
}

function renderCsv() {
  const text = csvText();
  csvEl.textContent = text || "未選択";
  csvEl.classList.toggle("empty", !text);
  copyBtn.disabled = !text;
  removeKnownBtn.disabled = !knownWordsInCurrentList().length;
}

function renderBubbles() {
  bubblesEl.replaceChildren();
  const selectedSet = new Set(selected);
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "bubble" + (selectedSet.has(item.word) ? " selected" : "");
    card.dataset.word = item.word;

    const word = document.createElement("span");
    word.className = "word";
    word.textContent = item.word;
    word.draggable = true;
    word.title = "辞書・漢字表記・例文・類義語へドラッグ";
    word.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", item.word);
      e.dataTransfer.setData(VOCAB_DRAG_TYPE, JSON.stringify(bubbleContext(item)));
      document.body.classList.add("dragging-word");
    });
    word.addEventListener("dragend", endWordDrag);

    const reading = document.createElement("span");
    reading.className = "reading";
    reading.textContent = item.reading;

    const meaning = document.createElement("span");
    meaning.className = "meaning";
    renderLookupText(meaning, item.meaning);

    card.append(word, reading, meaning);
    let downX = 0;
    let downY = 0;
    card.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      downX = e.clientX;
      downY = e.clientY;
    });
    card.addEventListener("click", (e) => {
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
      if (selectionInside(card)) return;
      toggleSelect(item.word);
    });
    // A double-click selects text for lookup, but its first click already toggled the word.
    card.addEventListener("dblclick", () => {
      if (selectionInside(card)) toggleSelect(item.word);
    });
    card.addEventListener("contextmenu", (e) => {
      if (selectionInside(card)) return;
      e.preventDefault();
      helperLookup(item.word, { mode: "sentence", context: bubbleContext(item) });
      pulseLookupBox();
    });
    bubblesEl.append(card);
  }
  const excludedNote = lastExcludedCount ? `既知${lastExcludedCount}語を除外` : "";
  statusEl.textContent = [items.length ? items.length + "語" : "", excludedNote].filter(Boolean).join(" · ");
  renderCsv();
}

function selectionInside(el) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return false;
  return el.contains(sel.anchorNode);
}

function toggleSelect(word) {
  const idx = selected.indexOf(word);
  if (idx >= 0) selected.splice(idx, 1);
  else selected.push(word);
  for (const card of bubblesEl.querySelectorAll(".bubble")) {
    card.classList.toggle("selected", selected.includes(card.dataset.word));
  }
  saveKnown();
  renderCsv();
}

async function copyCsv() {
  const text = csvText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.classList.add("copied");
    copyBtn.title = "コピーしました";
    setTimeout(() => {
      copyBtn.classList.remove("copied");
      copyBtn.title = "コピー";
    }, 1400);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(csvEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function isKanjiChar(ch) {
  return /[\u3400-\u9fff\uf900-\ufaff々〆ヶ]/.test(ch);
}

function looksJapanese(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

function renderLookupText(container, text) {
  container.replaceChildren();
  let i = 0;
  while (i < text.length) {
    if (isKanjiChar(text[i])) {
      let j = i + 1;
      while (j < text.length && isKanjiChar(text[j])) j++;
      const span = document.createElement("span");
      span.className = "lookup-word";
      span.textContent = text.slice(i, j);
      span.addEventListener("click", (e) => {
        if (window.getSelection() && !window.getSelection().isCollapsed) return;
        e.stopPropagation();
        helperLookupFromHighlight(span.textContent);
      });
      container.append(span);
      i = j;
    } else {
      let j = i + 1;
      while (j < text.length && !isKanjiChar(text[j])) j++;
      container.append(document.createTextNode(text.slice(i, j)));
      i = j;
    }
  }
}

function dictCacheKey(word, context) {
  return word + "\n" + context;
}

const WRAP_QUOTE_PAIRS = { '"': '"', "「": "」", "『": "』" };

function stripWrappingQuotes(s) {
  let text = String(s || "").trim();
  while (text.length >= 2) {
    const close = WRAP_QUOTE_PAIRS[text[0]];
    if (!close || text[text.length - 1] !== close) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

function parseDictResponse(raw) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const readingMatch = text.match(/^\s*(?:読み(?:方)?|よみ|reading)\s*[:：]\s*(.+)$/im);
  const jaMatch = text.match(/^\s*JA\s*[:：]\s*(.+)$/im);
  const enMatch = text.match(/^\s*EN\s*[:：]\s*(.+)$/im);
  let reading = readingMatch ? readingMatch[1].trim() : "";
  let ja = jaMatch ? jaMatch[1].trim() : "";
  let en = enMatch ? enMatch[1].trim() : "";
  if (!reading || !ja) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!reading && lines[0]) {
      reading = lines[0]
        .replace(/^(?:読み(?:方)?|よみ|reading)\s*[:：]\s*/i, "")
        .trim();
    }
    if (!ja && lines[1]) {
      ja = lines[1].replace(/^JA\s*[:：]\s*/i, "").trim();
    }
    if (!en && lines[2]) {
      en = lines[2].replace(/^EN\s*[:：]\s*/i, "").trim();
    }
  }
  reading = stripWrappingQuotes(reading);
  ja = stripWrappingQuotes(ja);
  en = stripWrappingQuotes(en);
  return { reading, ja, en };
}

function isNoneList(value) {
  return /^(なし|無し|none|n\/a|-|ー|―)$/i.test(String(value || "").trim());
}

function parseThesList(raw) {
  const text = stripWrappingQuotes(raw).trim();
  if (!text || isNoneList(text)) return [];
  const items = [];
  for (const part of text.split(/[;；]/)) {
    const bits = part.split(/[｜|]/).map((p) => stripWrappingQuotes(p)).filter(Boolean);
    if (!bits.length || isNoneList(bits[0])) continue;
    if (!looksJapanese(bits[0])) continue;
    items.push({
      word: bits[0],
      reading: bits[1] || "",
      gloss: bits.slice(2).join("｜")
    });
  }
  return items;
}

function parseThesResponse(raw) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const pick = (re) => {
    const match = text.match(re);
    return match ? match[1].trim() : "";
  };
  let similarRaw = pick(/^\s*(?:類義語?|similar|synonyms?)\s*[:：]\s*(.+)$/im);
  let oppositeRaw = pick(/^\s*(?:対義語?|antonyms?|opposite)\s*[:：]\s*(.+)$/im);
  if (!similarRaw && !oppositeRaw) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    similarRaw = (lines[0] || "").replace(/^(?:類義語?|similar|synonyms?)\s*[:：]\s*/i, "");
    oppositeRaw = (lines[1] || "").replace(/^(?:対義語?|antonyms?|opposite)\s*[:：]\s*/i, "");
  }
  if (!similarRaw && !oppositeRaw) throw new Error("empty");
  const similar = parseThesList(similarRaw).slice(0, 6);
  const opposite = parseThesList(oppositeRaw).slice(0, 4);
  if (!similar.length && !opposite.length && !isNoneList(similarRaw) && !isNoneList(oppositeRaw)) {
    throw new Error("empty");
  }
  return { similar, opposite };
}

async function fetchThesEntry(query, context, signal) {
  return parseThesResponse(await requestPrompt("thes", buildThesPrompt(query, context), signal));
}

// 使い分け: 意味の重なる2〜3語の違い。辞書の定義は1語で完結しているので、並べたときの差（場面・硬さ・焦点・コロケーション）を出す。
// 入力は「・」「、」「/」や空白で区切る。1語だけなら、まぎらわしい近い語をモデルに選ばせて比べる。
const CMP_MAX_WORDS = 3;
const CMP_LETTERS = ["A", "B", "C"];

function cmpWords(query) {
  const out = [];
  for (const w of String(query || "").split(/[・、,，/／|｜\s]+|\s+vs\.?\s+/i)) {
    const word = w.trim();
    if (word && !out.includes(word)) out.push(word);
  }
  return out;
}

function cmpCacheKey(query) {
  return cmpWords(query).slice(0, CMP_MAX_WORDS).join("・");
}

function parseCmpResponse(raw, inputWords) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const fw = { "Ａ": "A", "Ｂ": "B", "Ｃ": "C" };
  let wordsLine = "";
  let point = "";
  let common = "";
  const usage = {};
  const example = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*[-*・]?\s*\**\s*(語|要点|共通|例[A-CＡ-Ｃ]|[A-CＡ-Ｃ])\s*\**\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const label = m[1].replace(/[Ａ-Ｃ]/g, (c) => fw[c]);
    const value = stripWrappingQuotes(m[2]).trim();
    if (label === "語") wordsLine = wordsLine || value;
    else if (label === "要点") point = point || value;
    else if (label === "共通") common = common || value;
    else if (label.startsWith("例")) example[label.slice(1)] = example[label.slice(1)] || value;
    else usage[label] = usage[label] || value;
  }
  let words = cmpWords(wordsLine).filter(looksJapanese);
  // 指定された語は必ずその順で使う。1語のときだけモデルが選んだ語を足す
  if (inputWords.length > 1 || !words.length) words = inputWords.slice();
  else if (words[0] !== inputWords[0]) words = [inputWords[0], ...words.filter((w) => w !== inputWords[0])];
  words = words.slice(0, CMP_MAX_WORDS);
  const cards = words.map((word, i) => ({
    word,
    usage: usage[CMP_LETTERS[i]] || "",
    example: example[CMP_LETTERS[i]] || ""
  }));
  if (!point && !cards.some((c) => c.usage)) throw new Error("empty");
  return { point, cards, common: isNoneList(common) ? "" : common };
}

async function fetchCmpEntry(query, context, signal) {
  const words = cmpWords(query).slice(0, CMP_MAX_WORDS);
  if (!words.length) throw new Error("empty");
  const raw = await requestPrompt("cmp", buildCmpPrompt(words, context), signal);
  return parseCmpResponse(raw, words);
}

function jitenChars(query) {
  const out = [];
  for (const ch of String(query || "")) {
    if (ch === "々" || ch === "〆" || ch === "ヶ") continue; // 踊り字などは字典の見出しにしない
    if (isKanjiChar(ch) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

function splitReadings(raw) {
  const text = stripWrappingQuotes(raw).trim();
  if (!text || isNoneList(text)) return [];
  return text
    .split(/[、,，;；\/／・\s]+/)
    .map((r) => stripWrappingQuotes(r).replace(/[（(].*?[）)]/g, "").trim())
    .filter((r) => r && !isNoneList(r) && /[぀-ヿ]/.test(r));
}

function parseJitenResponse(raw, ch) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
  const meaning = stripWrappingQuotes(pick(/^\s*(?:意味|meaning)\s*[:：]\s*(.+)$/im));
  const en = stripWrappingQuotes(pick(/^\s*(?:EN|英語?)\s*[:：]\s*(.+)$/im));
  let on = splitReadings(pick(/^\s*(?:音読み|音|on(?:'?yomi)?)\s*[:：]\s*(.+)$/im)).map((r) =>
    r.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
  );
  let kun = splitReadings(pick(/^\s*(?:訓読み|訓|kun(?:'?yomi)?)\s*[:：]\s*(.+)$/im)).map((r) =>
    r.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[．。·]/g, ".")
  );
  const words = parseThesList(pick(/^\s*(?:語|熟語|words?)\s*[:：]\s*(.+)$/im))
    .filter((w) => w.word.includes(ch))
    .slice(0, JITEN_MAX_WORDS);
  const dedupe = (list) => list.filter((r, i) => list.indexOf(r) === i);
  on = dedupe(on);
  kun = dedupe(kun);
  if (!meaning && !on.length && !kun.length && !words.length) throw new Error("empty");
  return { char: ch, meaning, en, on, kun, words };
}

function jitenNoKanjiError() {
  const err = new Error("nokanji");
  err.userMessage = "漢字が含まれていません。漢字を入力してください";
  return err;
}

async function fetchJitenEntry(query, signal) {
  const chars = jitenChars(query);
  if (!chars.length) throw jitenNoKanjiError();
  const shown = chars.slice(0, JITEN_MAX_CHARS);
  const kanji = await Promise.all(
    shown.map(async (ch) => {
      if (jitenCache[ch]) return jitenCache[ch];
      const entry = parseJitenResponse(
        await requestPrompt("jiten", buildJitenPrompt(ch, query), signal),
        ch
      );
      jitenCache[ch] = entry;
      return entry;
    })
  );
  return { kanji, skipped: chars.length - shown.length };
}

function apiKey() {
  return typeof CLAUDE_API_KEY === "string" ? CLAUDE_API_KEY : "";
}

function hasApiKey() {
  const key = apiKey();
  return Boolean(key) && key !== "PASTE_KEY_HERE";
}

// Hosted (Vercel): no key in the browser; requests go through /api/claude, gated by a passcode.
const PROXY_URL = "/api/claude";
const ACCESS_CODE_STORAGE_KEY = "vocab_clicker_access_code";
const useProxy = () => !hasApiKey() && /^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);

function getAccessCode(forcePrompt) {
  let code = "";
  try { code = localStorage.getItem(ACCESS_CODE_STORAGE_KEY) || ""; } catch (_) {}
  if (!code || forcePrompt) {
    code = (window.prompt("アクセスコード") || "").trim();
    try { localStorage.setItem(ACCESS_CODE_STORAGE_KEY, code); } catch (_) {}
  }
  return code;
}

// 直接 Anthropic に送るとき（ローカル + config.js のキー）はここでハーネスをかける。
// プロキシ経由ではフラグだけ送り、サーバー側 (api/claude.js) が同じ gakusei.js でかける。
const GakuseiHarness = typeof Gakusei === "object" && Gakusei ? Gakusei : null;

function buildClaudeBody(prompt, maxTokens, temperature, model) {
  const base = {
    model: model || CLAUDE_MODEL,
    max_tokens: maxTokens,
    temperature: temperature == null ? 0 : temperature,
    messages: [{ role: "user", content: prompt }]
  };
  if (useProxy()) return JSON.stringify(gakuseiMode ? { ...base, gakusei_mode: true } : base);
  if (gakuseiMode && GakuseiHarness) return JSON.stringify(GakuseiHarness.applyRequest(base, true));
  return JSON.stringify(base);
}

// prompts.js の PROMPT_SETTINGS（モデル・max_tokens・temperature）で送る
function requestPrompt(kind, prompt, signal) {
  const cfg = PROMPT_SETTINGS[kind];
  return requestClaudeText(prompt, cfg.maxTokens, signal, cfg.temperature, cfg.model);
}

async function requestClaudeText(prompt, maxTokens, signal, temperature, model) {
  const direct = !useProxy();
  const wantGakusei = gakuseiMode;
  const body = buildClaudeBody(prompt, maxTokens, temperature, model);
  const send = (code) =>
    useProxy()
      ? fetch(PROXY_URL, { method: "POST", headers: { "content-type": "application/json", "x-access-code": code }, body, signal })
      : fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey(),
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body,
          signal
        });

  let res = await send(useProxy() ? getAccessCode(false) : "");
  if (res.status === 401 && useProxy()) res = await send(getAccessCode(true));

  let data = await res.json();
  if (!res.ok) {
    const msg = (data.error && data.error.message) || ("HTTP " + res.status);
    throw new Error(msg);
  }
  if (direct && GakuseiHarness) data = GakuseiHarness.formatResponse(data, wantGakusei);

  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function parseKanjiResponse(raw) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
  const firstToken = (s) =>
    stripWrappingQuotes(stripWrappingQuotes(s).split(/[、,／\/｜|(（\s]/)[0]);
  const isNone = (s) => /^(なし|無し|none|n\/a|-|ー|―)$/i.test(s);

  let form = firstToken(pick(/^\s*(?:表記形|形|form)\s*[:：]\s*(.+)$/im));
  const usageRaw = pick(/^\s*(?:使用度|使用|usage)\s*[:：]\s*(.+)$/im);
  const preferredRaw = pick(/^\s*(?:表記|preferred|writing)\s*[:：]\s*(.+)$/im).toLowerCase();
  const note = stripWrappingQuotes(pick(/^\s*(?:補足|note)\s*[:：]\s*(.+)$/im));

  const explicitNone = isNone(form);
  if (explicitNone) form = "";
  // Some replies label the spelling 表記 instead of 形.
  if (!form && !explicitNone && looksJapanese(preferredRaw)) form = firstToken(preferredRaw);
  if (!form && !explicitNone) throw new Error("empty");

  const usageNum = parseInt(usageRaw.replace(/[^0-9]/g, ""), 10);
  let usage = Number.isFinite(usageNum) ? Math.min(KANJI_METER_STEPS, Math.max(0, usageNum)) : 3;
  if (!form) usage = 0;

  let preferred;
  if (usage === 0 || /kana|かな|仮名/.test(preferredRaw)) preferred = "kana";
  else if (/kanji|漢字/.test(preferredRaw)) preferred = "kanji";
  else if (/either|both|どちら/.test(preferredRaw)) preferred = "either";
  else preferred = usage >= 4 ? "kanji" : usage <= 2 ? "kana" : "either";

  return { form, usage, label: KANJI_USAGE_LABELS[usage], preferred, note };
}

async function fetchDictWithPrompt(prompt, signal) {
  const parsed = parseDictResponse(await requestPrompt("dict", prompt, signal));
  if (!parsed.reading || !parsed.ja) throw new Error("empty");
  return parsed;
}

async function fetchKanjiUsage(query, context, signal) {
  return parseKanjiResponse(
    await requestPrompt("kanji", buildKanjiPrompt(query, context), signal)
  );
}

async function fetchEnOnly(word, reading, ja, signal) {
  const text = stripWrappingQuotes(
    (await requestPrompt("en", buildEnOnlyPrompt(word, reading, ja), signal))
      .trim()
      .replace(/^```(?:\w+)?\n?|\n?```$/g, "")
      .trim()
      .replace(/^EN\s*[:：]\s*/i, "")
  );
  if (!text) throw new Error("empty");
  return text.split("\n")[0].trim();
}

function getActiveHelperItem() {
  return helperHistory.find((item) => item.id === helperActiveId) || null;
}

function updateHelperHistoryScroll() {
  const overflowing = helperTabs.scrollWidth > helperTabs.clientWidth + 1;
  helperHistoryEl.classList.toggle("overflowing", overflowing);
  helperScrollLeft.disabled = !overflowing || helperTabs.scrollLeft <= 1;
  helperScrollRight.disabled =
    !overflowing || helperTabs.scrollLeft + helperTabs.clientWidth >= helperTabs.scrollWidth - 1;
}

function findHelperItem(query) {
  return helperHistory.find((h) => h.query === query) || null;
}

function usedHelperModes(item) {
  return HELPER_MODES.filter((mode) => {
    if (item.usedModes && item.usedModes.includes(mode)) return true;
    const st = modeState(item, mode);
    return Boolean(st.entry || st.loading || st.error);
  });
}

function markModeUsed(item, mode) {
  if (!HELPER_MODES.includes(mode)) return;
  if (!item.usedModes) item.usedModes = [];
  if (!item.usedModes.includes(mode)) item.usedModes.push(mode);
}

function helperTabTitle(item) {
  const used = usedHelperModes(item);
  const labels = used.map((mode) => HELPER_MODE_LABELS[mode] || mode);
  if (labels.length <= 1) {
    return (labels[0] || HELPER_MODE_LABELS.dict) + ": " + item.query;
  }
  return item.query + "（" + labels.join("・") + "）";
}

function appendModePips(btn, modes) {
  const pips = document.createElement("span");
  pips.className = "helper-tab-pips";
  pips.setAttribute("aria-hidden", "true");
  for (const mode of modes) {
    const pip = document.createElement("span");
    pip.className = "helper-tab-pip";
    pip.dataset.mode = mode;
    pips.append(pip);
  }
  btn.append(pips);
}

function renderHelperTabs() {
  helperTabs.replaceChildren();
  const showHistory =
    helperHistory.length >= 2 ||
    (helperHistory.length === 1 && usedHelperModes(helperHistory[0]).length > 1);
  if (!showHistory) {
    helperHistoryEl.classList.remove("visible", "overflowing");
    helperExpandedId = 0;
    return;
  }
  helperHistoryEl.classList.add("visible");
  if (helperExpandedId && !helperHistory.some((h) => h.id === helperExpandedId)) {
    helperExpandedId = 0;
  }
  const oldest = Math.max(1, helperHistory.length - 1);
  helperHistory.forEach((item, index) => {
    const used = usedHelperModes(item);
    const expanded = item.id === helperExpandedId && used.length > 1;
    const group = document.createElement("div");
    group.className = "helper-tab-group" + (expanded ? " expanded" : "");
    group.style.setProperty("--age", String(index / oldest));

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "helper-tab helper-tab-word";
    btn.dataset.mode = HELPER_MODES.includes(item.mode) ? item.mode : "dict";
    if (item.id === helperActiveId) btn.classList.add("active");
    if (used.some((mode) => modeState(item, mode).loading)) btn.classList.add("loading");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", item.id === helperActiveId ? "true" : "false");
    if (used.length > 1) {
      btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
    btn.title = helperTabTitle(item);
    const label = document.createElement("span");
    label.className = "helper-tab-label";
    label.textContent = item.query;
    btn.append(label);
    if (used.length > 1 && !expanded) appendModePips(btn, used);
    btn.addEventListener("click", () => {
      if (used.length > 1) {
        helperExpandedId = expanded ? 0 : item.id;
      } else {
        helperExpandedId = 0;
      }
      selectHelperHistory(item.id);
    });
    group.append(btn);

    if (expanded) {
      for (const mode of used) {
        const sub = document.createElement("button");
        sub.type = "button";
        sub.className = "helper-tab helper-tab-mode";
        sub.dataset.mode = mode;
        if (item.id === helperActiveId && item.mode === mode) sub.classList.add("active");
        if (modeState(item, mode).loading) sub.classList.add("loading");
        sub.setAttribute("role", "tab");
        sub.setAttribute("aria-selected", item.id === helperActiveId && item.mode === mode ? "true" : "false");
        sub.title = (HELPER_MODE_LABELS[mode] || mode) + ": " + item.query;
        sub.textContent = HELPER_MODE_CHIP_LABELS[mode] || HELPER_MODE_LABELS[mode] || mode;
        sub.addEventListener("click", () => selectHelperHistory(item.id, mode));
        group.append(sub);
      }
    }

    helperTabs.append(group);
  });
  requestAnimationFrame(() => {
    const open = helperTabs.querySelector(".helper-tab-group.expanded");
    if (open) open.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    updateHelperHistoryScroll();
  });
}

function createModeState() {
  return { entry: null, error: "", loading: false, fetchId: 0, controller: null, enShown: false };
}

function createHelperItem(query, context) {
  return {
    id: ++helperNextId,
    query,
    context: context || null,
    mode: helperMode,
    usedModes: [],
    dict: createModeState(),
    kanji: createModeState(),
    sentence: createModeState(),
    thes: createModeState(),
    jiten: createModeState(),
    cmp: createModeState()
  };
}

function modeState(item, mode) {
  if (mode === "kanji") return item.kanji;
  if (mode === "sentence") {
    if (!item.sentence) item.sentence = createModeState();
    return item.sentence;
  }
  if (mode === "thes") {
    if (!item.thes) item.thes = createModeState();
    return item.thes;
  }
  if (mode === "cmp") {
    if (!item.cmp) item.cmp = createModeState();
    return item.cmp;
  }
  if (mode === "jiten") {
    if (!item.jiten) item.jiten = createModeState();
    return item.jiten;
  }
  return item.dict;
}

function abortHelperItem(item) {
  for (const mode of HELPER_MODES) {
    const st = modeState(item, mode);
    if (st.controller) st.controller.abort();
    st.controller = null;
    st.loading = false;
  }
}

function rememberHelperItem(item) {
  helperHistory = helperHistory.filter((h) => h.id !== item.id);
  helperHistory.unshift(item);
  while (helperHistory.length > HELPER_HISTORY_LIMIT) {
    const dropped = helperHistory.pop();
    if (dropped) {
      if (dropped.id === helperExpandedId) helperExpandedId = 0;
      abortHelperItem(dropped);
    }
  }
  return helperHistory[0];
}

function cachedModeEntry(mode, query) {
  if (mode === "kanji") return kanjiCache[query];
  if (mode === "sentence") {
    const sentences = sentenceCache[query];
    return sentences && sentences.length ? { sentences, index: sentences.length - 1 } : null;
  }
  if (mode === "thes") return thesCache[query];
  if (mode === "cmp") return cmpCache[cmpCacheKey(query)];
  if (mode === "jiten") {
    const chars = jitenChars(query);
    if (!chars.length) return null;
    const shown = chars.slice(0, JITEN_MAX_CHARS);
    if (!shown.every((ch) => jitenCache[ch])) return null;
    return { kanji: shown.map((ch) => jitenCache[ch]), skipped: chars.length - shown.length };
  }
  return dictCache[dictCacheKey(query, "")];
}

function cacheModeEntry(mode, query, entry) {
  if (mode === "kanji") kanjiCache[query] = entry;
  else if (mode === "sentence") sentenceCache[query] = (entry && entry.sentences) || [];
  else if (mode === "thes") thesCache[query] = entry;
  else if (mode === "cmp") cmpCache[cmpCacheKey(query)] = entry;
  else if (mode === "jiten") {
    for (const k of (entry && entry.kanji) || []) jitenCache[k.char] = k;
  } else dictCache[dictCacheKey(query, "")] = entry;
}

function setHelperEnVisible(shown) {
  helperEnShown = shown;
  const item = getActiveHelperItem();
  if (item) item.dict.enShown = shown;
  const hasEn = Boolean(helperEntry && helperEntry.en);
  helperEn.classList.toggle("visible", shown && hasEn);
  helperEnBtn.textContent = shown ? "英訳を隠す" : "英訳を表示";
}

function renderDictPending(text) {
  helperEntry = null;
  helperResult.classList.remove("error");
  helperKana.textContent = text;
  helperDef.textContent = text;
  helperEn.textContent = "";
  helperEn.classList.remove("visible");
  helperEnBtn.classList.remove("visible");
  helperEnBtn.disabled = false;
  helperEnBtn.textContent = "英訳を表示";
}

function renderDictError(message) {
  helperEntry = null;
  helperResult.classList.add("error");
  helperKana.textContent = message;
  helperDef.textContent = "";
  helperEn.textContent = "";
  helperEn.classList.remove("visible");
  helperEnBtn.classList.remove("visible");
  helperEnBtn.disabled = false;
}

function renderDictEntry(entry, enShown) {
  helperEntry = entry;
  helperResult.classList.remove("error");
  helperKana.textContent = entry.reading || "…";
  helperDef.textContent = entry.ja || "";
  helperEn.textContent = entry.en || "";
  helperEnBtn.classList.toggle("visible", Boolean(entry.reading && entry.ja));
  helperEnBtn.disabled = false;
  setHelperEnVisible(Boolean(enShown) && Boolean(entry.en));
}

function renderKanjiMeter(usage, label) {
  helperKanjiMeter.replaceChildren();
  for (let i = 0; i < KANJI_METER_STEPS; i++) {
    const pip = document.createElement("span");
    pip.className = "kanji-pip" + (i < usage ? " on" : "");
    helperKanjiMeter.append(pip);
  }
  helperKanjiMeter.setAttribute("aria-label", "漢字使用度 " + usage + "／" + KANJI_METER_STEPS + " " + label);
}

function renderKanjiPending(text) {
  helperResult.classList.remove("error");
  helperKanjiForm.textContent = text;
  helperKanjiMeter.replaceChildren();
  helperKanjiMeter.removeAttribute("aria-label");
  helperKanjiLabel.textContent = "";
  helperKanjiNote.textContent = "";
}

function renderKanjiError(message) {
  helperResult.classList.add("error");
  helperKanjiForm.textContent = message;
  helperKanjiMeter.replaceChildren();
  helperKanjiMeter.removeAttribute("aria-label");
  helperKanjiLabel.textContent = "";
  helperKanjiNote.textContent = "";
}

function renderKanjiEntry(entry) {
  helperResult.classList.remove("error");
  helperKanjiForm.textContent = entry.form || "漢字表記なし";
  renderKanjiMeter(entry.usage, entry.label);
  helperKanjiLabel.textContent = entry.label;
  helperKanjiNote.textContent = entry.note || "";
}

function setHelperSentenceEnVisible(shown) {
  helperSentenceEnShown = shown;
  const item = getActiveHelperItem();
  if (item) item.sentence.enShown = shown;
  const entry = item && item.sentence && item.sentence.entry;
  const current = entry && entry.sentences && entry.sentences[entry.index];
  const hasEn = Boolean(current && current.en);
  helperSentenceEn.classList.toggle("visible", shown && hasEn);
  helperSentenceEnBtn.textContent = shown ? "英訳を隠す" : "英訳を表示";
}

function hideSentenceActions() {
  helperSentenceEn.classList.remove("visible");
  helperSentenceEnBtn.classList.remove("visible");
  helperSentenceRegenBtn.classList.remove("visible");
  helperSentenceRegenBtn.disabled = false;
  helperSentencePrev.replaceChildren();
}

function renderSentencePending(text) {
  helperResult.classList.remove("error");
  helperSentence.textContent = text;
  helperSentenceEn.textContent = "";
  hideSentenceActions();
}

function renderSentenceError(message) {
  helperResult.classList.add("error");
  helperSentence.textContent = message;
  helperSentenceEn.textContent = "";
  hideSentenceActions();
  helperSentenceRegenBtn.classList.add("visible");
}

function renderSentencePrev(entry) {
  helperSentencePrev.replaceChildren();
  const sentences = (entry && entry.sentences) || [];
  if (sentences.length < 2) return;
  const label = document.createElement("div");
  label.className = "helper-sentence-prev-label";
  label.textContent = "これまでの例文";
  helperSentencePrev.append(label);
  sentences.forEach((s, i) => {
    if (i === entry.index) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "helper-sentence-prev";
    btn.textContent = s.ja;
    btn.title = "この例文を表示";
    btn.addEventListener("click", () => {
      entry.index = i;
      const item = getActiveHelperItem();
      if (item && item.sentence.entry === entry) {
        item.sentence.enShown = false;
        paintHelperItem(item);
      }
    });
    helperSentencePrev.append(btn);
  });
}

function renderSentenceEntry(entry, enShown, loading) {
  const sentences = (entry && entry.sentences) || [];
  const index = entry && Number.isInteger(entry.index) ? entry.index : sentences.length - 1;
  const current = sentences[index];
  if (!current) {
    renderSentencePending("…");
    return;
  }
  if (!Number.isInteger(entry.index)) entry.index = index;
  helperResult.classList.remove("error");
  renderLookupText(helperSentence, current.ja);
  helperSentenceEn.textContent = current.en || "";
  helperSentenceEnBtn.classList.add("visible");
  helperSentenceRegenBtn.classList.add("visible");
  helperSentenceRegenBtn.disabled = Boolean(loading);
  setHelperSentenceEnVisible(Boolean(enShown) && Boolean(current.en));
  renderSentencePrev(entry);
}

function renderThesList(container, words) {
  container.replaceChildren();
  if (!words.length) {
    const empty = document.createElement("span");
    empty.className = "thes-empty";
    empty.textContent = "なし";
    container.append(empty);
    return;
  }
  for (const entry of words) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thes-chip";
    const word = document.createElement("span");
    word.className = "thes-word";
    word.textContent = entry.word;
    btn.append(word);
    if (entry.reading) {
      const reading = document.createElement("span");
      reading.className = "thes-reading";
      reading.textContent = entry.reading;
      btn.append(reading);
    }
    if (entry.gloss) {
      const gloss = document.createElement("span");
      gloss.className = "thes-gloss";
      gloss.textContent = entry.gloss;
      btn.append(gloss);
    }
    const title = [entry.reading, entry.gloss].filter(Boolean).join(" ");
    if (title) btn.title = title;
    btn.addEventListener("click", () => {
      helperLookup(entry.word, {
        mode: "thes",
        context: { reading: entry.reading || "", meaning: entry.gloss || "" }
      });
    });
    container.append(btn);
  }
}

function renderThesPending(text) {
  helperResult.classList.remove("error");
  helperOpposite.replaceChildren();
  helperSimilar.replaceChildren();
  const note = document.createElement("span");
  note.className = "thes-empty";
  note.textContent = text;
  helperSimilar.append(note);
}

function renderThesError(message) {
  helperResult.classList.add("error");
  helperOpposite.replaceChildren();
  helperSimilar.replaceChildren();
  const note = document.createElement("span");
  note.className = "thes-empty";
  note.textContent = message;
  helperSimilar.append(note);
}

function renderThesEntry(entry) {
  helperResult.classList.remove("error");
  renderThesList(helperSimilar, (entry && entry.similar) || []);
  renderThesList(helperOpposite, (entry && entry.opposite) || []);
}

function cmpNote(text, cls) {
  const note = document.createElement("div");
  note.className = cls || "thes-empty";
  note.textContent = text;
  return note;
}

function renderCmpPending(text) {
  helperResult.classList.remove("error");
  helperCmpRegenBtn.hidden = true;
  helperCmp.replaceChildren(cmpNote(text));
}

function renderCmpError(message) {
  helperResult.classList.add("error");
  helperCmpRegenBtn.hidden = false;
  helperCmp.replaceChildren(cmpNote(message));
}

function cmpExample(markText, text, cls) {
  const ex = document.createElement("div");
  ex.className = "cmp-example" + (cls ? " " + cls : "");
  const mark = document.createElement("span");
  mark.className = "cmp-mark";
  mark.textContent = markText;
  const sentence = document.createElement("span");
  sentence.textContent = text;
  ex.append(mark, sentence);
  return ex;
}

function renderCmpEntry(entry, query) {
  helperResult.classList.remove("error");
  helperCmpRegenBtn.hidden = false;
  helperCmp.replaceChildren();
  const cards = (entry && entry.cards) || [];
  if (cards.length < 2) {
    helperCmp.append(cmpNote("比べる語が足りません。2〜3語を「・」や空白で区切って入力してください"));
    return;
  }
  const dropped = cmpWords(query).length - CMP_MAX_WORDS;
  if (dropped > 0) helperCmp.append(cmpNote("比べられるのは" + CMP_MAX_WORDS + "語までです（" + dropped + "語を省きました）"));
  if (entry.point) helperCmp.append(cmpNote(entry.point, "cmp-point"));
  const cols = document.createElement("div");
  cols.className = "cmp-cols";
  cols.dataset.count = String(cards.length);
  for (const card of cards) {
    const el = document.createElement("div");
    el.className = "cmp-card";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "cmp-word";
    head.textContent = card.word;
    head.title = "「" + card.word + "」を辞書で調べる";
    head.addEventListener("click", () => helperLookup(card.word, { mode: "dict" }));
    el.append(head);
    if (card.usage) el.append(cmpNote(card.usage, "cmp-usage"));
    if (card.example) {
      el.append(cmpExample("○", card.example));
      const others = cards.filter((c) => c !== card).map((c) => "「" + c.word + "」").join("");
      el.append(cmpNote(others + "だと不自然", "cmp-swap"));
    }
    cols.append(el);
  }
  helperCmp.append(cols);
  if (entry.common) helperCmp.append(cmpExample("共通", entry.common, "cmp-common"));
}

function appendKunReading(container, reading) {
  const dot = reading.indexOf(".");
  if (dot < 0) {
    container.append(document.createTextNode(reading));
    return;
  }
  container.append(document.createTextNode(reading.slice(0, dot)));
  const okuri = document.createElement("span");
  okuri.className = "jiten-okuri";
  okuri.textContent = reading.slice(dot + 1).replace(/\./g, "");
  container.append(okuri);
}

function jitenReadingRow(label, readings, isKun) {
  const row = document.createElement("div");
  row.className = "jiten-reading-row";
  const tag = document.createElement("span");
  tag.className = "jiten-tag";
  tag.textContent = label;
  row.append(tag);
  const list = document.createElement("span");
  list.className = "jiten-readings";
  if (!readings.length) {
    list.classList.add("jiten-none");
    list.textContent = "なし";
  }
  readings.forEach((r, i) => {
    const one = document.createElement("span");
    one.className = "jiten-reading";
    if (isKun) appendKunReading(one, r);
    else one.textContent = r;
    list.append(one);
    if (i < readings.length - 1) list.append(document.createTextNode("、"));
  });
  row.append(list);
  return row;
}

function renderJitenWordChip(entry, ch) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "thes-chip jiten-word";
  const word = document.createElement("span");
  word.className = "thes-word";
  for (const c of entry.word) {
    if (c === ch) {
      const mark = document.createElement("span");
      mark.className = "jiten-hit";
      mark.textContent = c;
      word.append(mark);
    } else {
      word.append(document.createTextNode(c));
    }
  }
  btn.append(word);
  if (entry.reading) {
    const reading = document.createElement("span");
    reading.className = "thes-reading";
    reading.textContent = entry.reading;
    btn.append(reading);
  }
  if (entry.gloss) {
    const gloss = document.createElement("span");
    gloss.className = "thes-gloss";
    gloss.textContent = entry.gloss;
    btn.append(gloss);
  }
  btn.title = "辞書で調べる: " + [entry.word, entry.reading].filter(Boolean).join(" ");
  btn.addEventListener("click", () => {
    helperLookup(entry.word, {
      mode: "dict",
      context: { reading: entry.reading || "", meaning: entry.gloss || "" }
    });
  });
  return btn;
}

function renderJitenCard(k) {
  const card = document.createElement("section");
  card.className = "jiten-card";

  const head = document.createElement("div");
  head.className = "jiten-head";
  const glyph = document.createElement("div");
  glyph.className = "jiten-char";
  glyph.lang = "ja";
  glyph.textContent = k.char;
  glyph.title = "クリックでコピー";
  glyph.addEventListener("click", () => {
    if (navigator.clipboard) navigator.clipboard.writeText(k.char).catch(() => {});
  });
  head.append(glyph);

  const info = document.createElement("div");
  info.className = "jiten-info";
  if (k.meaning) {
    const meaning = document.createElement("div");
    meaning.className = "jiten-meaning";
    meaning.textContent = k.meaning;
    info.append(meaning);
  }
  if (k.en) {
    const en = document.createElement("div");
    en.className = "jiten-en";
    en.textContent = k.en;
    info.append(en);
  }
  info.append(jitenReadingRow("音", k.on || [], false));
  info.append(jitenReadingRow("訓", k.kun || [], true));
  head.append(info);
  card.append(head);

  const words = k.words || [];
  if (words.length) {
    const label = document.createElement("div");
    label.className = "thes-label";
    label.textContent = "よく使う言葉";
    card.append(label);
    const list = document.createElement("div");
    list.className = "thes-list jiten-words";
    for (const w of words) list.append(renderJitenWordChip(w, k.char));
    card.append(list);
  }
  return card;
}

function renderJitenMessage(text) {
  helperJitenList.replaceChildren();
  const note = document.createElement("div");
  note.className = "jiten-message";
  note.textContent = text;
  helperJitenList.append(note);
}

function renderJitenPending(text) {
  helperResult.classList.remove("error");
  renderJitenMessage(text);
}

function renderJitenError(message) {
  helperResult.classList.add("error");
  renderJitenMessage(message);
}

function renderJitenEntry(entry) {
  helperResult.classList.remove("error");
  helperJitenList.replaceChildren();
  for (const k of (entry && entry.kanji) || []) helperJitenList.append(renderJitenCard(k));
  if (entry && entry.skipped > 0) {
    const more = document.createElement("div");
    more.className = "jiten-message";
    more.textContent = "ほかに " + entry.skipped + " 字あります（最初の " + JITEN_MAX_CHARS + " 字だけ表示）";
    helperJitenList.append(more);
  }
}

const HELPER_INPUT_PLACEHOLDER = helperInput.placeholder;
const CMP_INPUT_PLACEHOLDER = "2〜3語を「・」で区切る（例: 補償・報酬）";

function renderHelperModes() {
  lookupBox.dataset.mode = helperMode;
  helperInput.placeholder = helperMode === "cmp" ? CMP_INPUT_PLACEHOLDER : HELPER_INPUT_PLACEHOLDER;
  if (handwritingOpen) lookupBox.dataset.uiTab = HANDWRITING_TAB;
  else delete lookupBox.dataset.uiTab;
  // 手書きは入力方法なので、開いている間も選択中の調べ方タブを強調したままにする
  const activeTab = helperMode;
  for (const btn of helperModes.querySelectorAll(".helper-mode")) {
    const active = btn.dataset.mode === activeTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  if (handwritingToggle) {
    handwritingToggle.classList.toggle("active", handwritingOpen);
    handwritingToggle.setAttribute("aria-pressed", handwritingOpen ? "true" : "false");
  }
}

function paintHelperItem(item) {
  helperActiveId = item.id;
  if (HELPER_MODES.includes(item.mode)) helperMode = item.mode;
  helperResult.classList.add("visible");
  helperWord.textContent = item.query;
  helperDictBlock.classList.toggle("visible", helperMode === "dict");
  helperKanjiBlock.classList.toggle("visible", helperMode === "kanji");
  helperSentenceBlock.classList.toggle("visible", helperMode === "sentence");
  helperThesBlock.classList.toggle("visible", helperMode === "thes");
  helperCmpBlock.classList.toggle("visible", helperMode === "cmp");
  helperJitenBlock.classList.toggle("visible", helperMode === "jiten");
  renderHelperModes();

  const st = modeState(item, helperMode);
  if (helperMode === "dict") {
    helperEnShown = st.enShown;
    if (st.error) renderDictError(st.error);
    else if (st.entry) renderDictEntry(st.entry, st.enShown);
    else renderDictPending("…");
  } else if (helperMode === "kanji") {
    if (st.error) renderKanjiError(st.error);
    else if (st.entry) renderKanjiEntry(st.entry);
    else renderKanjiPending("…");
  } else if (helperMode === "thes") {
    if (st.error) renderThesError(st.error);
    else if (st.entry) renderThesEntry(st.entry);
    else renderThesPending("…");
  } else if (helperMode === "cmp") {
    if (st.error) renderCmpError(st.error);
    else if (st.entry) renderCmpEntry(st.entry, item.query);
    else renderCmpPending("比べています…");
  } else if (helperMode === "jiten") {
    if (st.error) renderJitenError(st.error);
    else if (st.entry) renderJitenEntry(st.entry);
    else renderJitenPending("…");
  } else if (st.error) {
    renderSentenceError(st.error);
  } else if (st.entry) {
    helperSentenceEnShown = st.enShown;
    renderSentenceEntry(st.entry, st.enShown, st.loading);
  } else {
    renderSentencePending("…");
  }
  renderHelperTabs();
}

function repaintHelper(item, mode) {
  if (helperActiveId === item.id && helperMode === mode) paintHelperItem(item);
  else renderHelperTabs();
}

function selectHelperHistory(id, mode) {
  const item = helperHistory.find((h) => h.id === id);
  if (!item) return;
  if (HELPER_MODES.includes(mode)) item.mode = mode;
  helperInput.value = item.query;
  helperMode = HELPER_MODES.includes(item.mode) ? item.mode : "dict";
  helperActiveId = item.id;
  paintHelperItem(item);
  const st = modeState(item, helperMode);
  if (!st.entry && !st.loading) runHelperFetch(item, helperMode);
}

function finishHelperFetch(item, mode, fetchId, entry, error) {
  const st = modeState(item, mode);
  if (st.fetchId !== fetchId) return;
  if (!helperHistory.includes(item)) return;
  st.loading = false;
  st.controller = null;
  st.entry = error ? null : entry;
  st.error = error || "";
  repaintHelper(item, mode);
}

async function runHelperFetch(item, mode, options) {
  const force = Boolean(options && options.force);
  const st = modeState(item, mode);
  if (st.loading) return;
  if (!force && st.entry && !st.error) return;

  if (!force) {
    const cached = cachedModeEntry(mode, item.query);
    if (cached) {
      st.entry = cached;
      st.error = "";
      repaintHelper(item, mode);
      return;
    }
  }

  const keepSentence = force && mode === "sentence" && st.entry;
  st.loading = true;
  st.error = "";
  if (!keepSentence) st.entry = null;
  const fetchId = ++st.fetchId;
  repaintHelper(item, mode);

  if (!hasApiKey() && !useProxy()) {
    if (keepSentence) {
      finishHelperFetch(item, mode, fetchId, st.entry, "");
      return;
    }
    finishHelperFetch(item, mode, fetchId, null, "APIキーを設定してください");
    return;
  }

  if (st.controller) st.controller.abort();
  const controller = new AbortController();
  st.controller = controller;

  try {
    let parsed;
    if (mode === "kanji") {
      parsed = await fetchKanjiUsage(item.query, item.context, controller.signal);
    } else if (mode === "sentence") {
      parsed = await fetchSentenceEntry(item.query, item.context, sentenceCache[item.query] || [], controller.signal);
    } else if (mode === "thes") {
      parsed = await fetchThesEntry(item.query, item.context, controller.signal);
    } else if (mode === "cmp") {
      parsed = await fetchCmpEntry(item.query, item.context, controller.signal);
    } else if (mode === "jiten") {
      parsed = await fetchJitenEntry(item.query, controller.signal);
    } else {
      parsed = await fetchDictWithPrompt(buildFreeLookupPrompt(item.query), controller.signal);
    }
    cacheModeEntry(mode, item.query, parsed);
    finishHelperFetch(item, mode, fetchId, parsed, "");
  } catch (err) {
    if (err?.name === "AbortError") return;
    const message =
      mode === "kanji" ? "漢字表記を読み込めませんでした"
      : mode === "sentence" ? "例文を読み込めませんでした"
      : mode === "thes" ? "類義語を読み込めませんでした"
      : mode === "cmp" ? "使い分けを読み込めませんでした"
      : mode === "jiten" ? (err && err.userMessage) || "漢字辞典を読み込めませんでした"
      : "読み込めませんでした";
    if (keepSentence) {
      finishHelperFetch(item, mode, fetchId, st.entry, "");
      return;
    }
    finishHelperFetch(item, mode, fetchId, null, message);
  }
}

function helperLookup(queryOverride, options) {
  const opts = options || {};
  const query = (queryOverride != null ? String(queryOverride) : helperInput.value).trim();
  if (!query) return;
  if (HELPER_MODES.includes(opts.mode)) helperMode = opts.mode;
  handwritingOpen = false;

  let item = findHelperItem(query);
  if (item) {
    if (opts.context) item.context = opts.context;
  } else {
    item = createHelperItem(query, opts.context);
  }
  item.mode = helperMode;
  markModeUsed(item, helperMode);
  if (helperExpandedId && helperExpandedId !== item.id) helperExpandedId = 0;
  item = rememberHelperItem(item);
  helperActiveId = item.id;
  helperInput.value = query;
  paintHelperItem(item);
  runHelperFetch(item, helperMode);
}

function setHelperMode(mode) {
  if (mode === HANDWRITING_TAB) {
    if (handwritingOpen) return;
    handwritingOpen = true;
    renderHelperModes();
    return;
  }
  if (!HELPER_MODES.includes(mode)) return;
  // 手書きパッドは開いたまま、調べ方だけ切り替える（候補は選択中のタブで調べる）
  if (mode === helperMode) return;
  helperMode = mode;
  renderHelperModes();

  const current = getActiveHelperItem();
  const query = (helperInput.value.trim() || (current && current.query) || "");
  if (query) helperInput.value = query;

  const match = query ? findHelperItem(query) : current;
  if (!match) {
    helperResult.classList.remove("visible");
    renderHelperTabs();
    return;
  }

  helperActiveId = match.id;
  const st = modeState(match, mode);
  if (st.entry || st.loading || st.error) {
    match.mode = mode;
    paintHelperItem(match);
    return;
  }

  helperResult.classList.remove("visible");
  renderHelperTabs();
}

function pulseLookupBox() {
  lookupBox.classList.remove("pulse");
  void lookupBox.offsetWidth;
  lookupBox.classList.add("pulse");
  lookupBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function helperLookupFromHighlight(word, context) {
  const cleaned = String(word || "").replace(/\s+/g, "").trim();
  if (!cleaned || !looksJapanese(cleaned)) return;
  const opts = { context };
  if (helperMode === "sentence") opts.mode = "dict";
  helperLookup(cleaned, opts);
  pulseLookupBox();
}

async function ensureHelperEnglish() {
  const item = getActiveHelperItem();
  if (!helperEntry || helperEntry.en) return helperEntry && helperEntry.en;
  const query = (item && item.query) || helperWord.textContent.trim();
  if (!query) return "";
  const sourceEntry = helperEntry;

  if (!hasApiKey() && !useProxy()) {
    helperEn.textContent = "APIキーを設定してください";
    helperEn.classList.add("visible");
    return "";
  }

  if (helperEnAbort) helperEnAbort.abort();
  const controller = new AbortController();
  helperEnAbort = controller;
  const requestId = ++helperEnRequestId;
  const targetId = item ? item.id : helperActiveId;
  helperEnBtn.disabled = true;
  helperEn.textContent = "…";
  helperEn.classList.add("visible");

  try {
    const en = await fetchEnOnly(query, sourceEntry.reading, sourceEntry.ja, controller.signal);
    if (requestId !== helperEnRequestId) return "";
    const next = { ...sourceEntry, en };
    dictCache[dictCacheKey(query, "")] = next;
    const target = helperHistory.find((h) => h.id === targetId);
    if (target) target.dict.entry = next;
    if (helperActiveId === targetId) {
      helperEntry = next;
      helperEn.textContent = en;
      helperEnBtn.disabled = false;
    }
    return en;
  } catch (err) {
    if (err?.name === "AbortError") return "";
    if (requestId !== helperEnRequestId) return "";
    if (helperActiveId === targetId) {
      helperEn.textContent = "英訳を読み込めませんでした";
      helperEnBtn.disabled = false;
    }
    return "";
  } finally {
    if (helperEnAbort === controller) helperEnAbort = null;
  }
}

function parseSentenceResponse(raw) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const jaMatch = text.match(/^\s*JA\s*[:：]\s*(.+)$/im);
  const enMatch = text.match(/^\s*EN\s*[:：]\s*(.+)$/im);
  if (jaMatch && enMatch) {
    return { ja: jaMatch[1].trim(), en: enMatch[1].trim() };
  }
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return { ja: lines[0].replace(/^JA\s*[:：]\s*/i, ""), en: lines.slice(1).join(" ").replace(/^EN\s*[:：]\s*/i, "") };
  }
  return { ja: lines[0] || text, en: "" };
}

async function fetchSentenceEntry(query, context, previous, signal) {
  const parsed = parseSentenceResponse(
    await requestPrompt("sentence", buildSentencePrompt(query, context, previous), signal)
  );
  parsed.ja = stripWrappingQuotes(parsed.ja);
  if (!parsed.ja) throw new Error("empty");
  const sentences = (sentenceCache[query] || []).concat([parsed]);
  sentenceCache[query] = sentences;
  return { sentences, index: sentences.length - 1 };
}

function inputHasText() {
  return Boolean(inputEl.value.trim());
}

function syncInputAction() {
  const filled = inputHasText();
  inputActionBtn.textContent = filled ? "クリア" : "サンプルを使う";
}

async function parseInput() {
  await refreshKnownWords();
  const parsed = parseVocab(inputEl.value);
  const next = knownWordSet ? parsed.filter((it) => !knownWordSet.has(normalizeWord(it.word))) : parsed;
  lastExcludedCount = parsed.length - next.length;
  const prevWords = new Set(items.map((it) => it.word));
  if (next.some((it) => !prevWords.has(it.word))) {
    selected = [];
    saveKnown();
  }
  items = next;
  renderBubbles();
  syncInputAction();
  if (!items.length && lastExcludedCount) {
    statusEl.textContent = `すべて既知の単語でした（${lastExcludedCount}語を除外）`;
  } else if (!items.length && inputHasText()) {
    statusEl.textContent = "単語の行が見つかりませんでした。";
  }
}

/* ---------------- known_words.json: strict, local dedupe (no API calls) ---------------- */

const KNOWN_IDB_NAME = "vocab-clicker";
const KNOWN_IDB_STORE = "handles";
const KNOWN_IDB_HANDLE_KEY = "known-words";
const knownFsSupported = typeof window.showOpenFilePicker === "function";

// Exact match only; NFKC just folds full-/half-width variants and stray spaces.
function normalizeWord(word) {
  return String(word).normalize("NFKC").replace(/\s+/g, "");
}

function parseKnownWordsJson(text) {
  if (!text.trim()) return new Set();
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data && data.known_words;
  if (!Array.isArray(list)) throw new Error("known_words の配列が見つかりません");
  return new Set(list.filter((w) => typeof w === "string").map(normalizeWord).filter(Boolean));
}

function knownIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KNOWN_IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(KNOWN_IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function knownIdbGet(key) {
  const db = await knownIdb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(KNOWN_IDB_STORE).objectStore(KNOWN_IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function knownIdbSet(key, value) {
  const db = await knownIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KNOWN_IDB_STORE, "readwrite");
    tx.objectStore(KNOWN_IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function renderKnownFileBtn(state) {
  knownFileBtn.classList.toggle("known-linked", state === "linked");
  knownFileBtn.classList.toggle("known-error", state === "error");
  knownFileBtn.classList.toggle("known-unset", !(state === "linked" && knownWordSet) && state !== "error");
  if (state === "linked" && knownWordSet) {
    knownFileBtn.textContent = `既知リスト ${knownWordSet.size}語`;
    knownFileBtn.title = `${knownFileName} — 完全一致する単語を除外中。クリックで別のファイルを選択`;
  } else if (state === "reconnect") {
    knownFileBtn.textContent = `${knownFileName} に再接続`;
    knownFileBtn.title = "ブラウザの許可が必要です";
  } else if (state === "error") {
    knownFileBtn.textContent = "known_words.json を読めません";
  } else {
    knownFileBtn.textContent = "known_words.json を開く";
    knownFileBtn.title = "このファイルにある単語は解析結果から除かれます";
  }
}

async function readKnownHandle(handle) {
  const text = await (await handle.getFile()).text();
  knownWordSet = parseKnownWordsJson(text);
  knownFileName = handle.name;
  renderKnownFileBtn("linked");
}

// Re-read the linked file before each parse so edits to known_words.json are picked up.
// If that fails, the last successfully loaded list stays in use.
async function refreshKnownWords() {
  if (!knownFileHandle) return;
  try {
    if ((await knownFileHandle.queryPermission({ mode: "read" })) !== "granted") return;
    await readKnownHandle(knownFileHandle);
  } catch (err) {
    console.warn("known_words.json re-read failed", err);
    if (!knownWordSet) renderKnownFileBtn("error");
  }
}

async function afterKnownLoaded() {
  if (inputHasText()) await parseInput();
}

async function openKnownFile() {
  if (!knownFsSupported) {
    knownFileInput.value = "";
    knownFileInput.click();
    return;
  }
  try {
    if (knownFileHandle && !knownWordSet) {
      const perm = await knownFileHandle.requestPermission({ mode: "read" });
      if (perm === "granted") {
        await readKnownHandle(knownFileHandle);
        await afterKnownLoaded();
        return;
      }
    }
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      excludeAcceptAllOption: false,
    });
    knownFileHandle = handle;
    await readKnownHandle(handle);
    try {
      await knownIdbSet(KNOWN_IDB_HANDLE_KEY, handle);
    } catch (_) {
      /* handle just won't be remembered next time */
    }
    await afterKnownLoaded();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    renderKnownFileBtn("error");
    statusEl.textContent = `known_words.json を読めませんでした: ${err.message || err}`;
  }
}

// Fallback for browsers without the File System Access API: one-off load for this visit.
async function loadKnownFromInput() {
  const file = knownFileInput.files && knownFileInput.files[0];
  if (!file) return;
  try {
    knownWordSet = parseKnownWordsJson(await file.text());
    knownFileName = file.name;
    renderKnownFileBtn("linked");
    await afterKnownLoaded();
  } catch (err) {
    renderKnownFileBtn("error");
    statusEl.textContent = `known_words.json を読めませんでした: ${err.message || err}`;
  }
}

async function restoreKnownFile() {
  if (!knownFsSupported) return;
  try {
    const handle = await knownIdbGet(KNOWN_IDB_HANDLE_KEY);
    if (!handle) return;
    knownFileHandle = handle;
    knownFileName = handle.name;
    if ((await handle.queryPermission({ mode: "read" })) === "granted") {
      await readKnownHandle(handle);
    } else {
      renderKnownFileBtn("reconnect");
    }
  } catch (err) {
    console.warn("known_words.json restore failed", err);
  }
}

function clearKnown() {
  if (!selected.length) return;
  selected = [];
  saveKnown();
  renderBubbles();
}

function removeKnownFromInput() {
  const toRemove = new Set(knownWordsInCurrentList());
  if (!toRemove.size) return;
  const lines = inputEl.value.replace(/\r\n/g, "\n").split("\n");
  inputEl.value = lines
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      const word = trimmed.split(/[｜|]/)[0].trim();
      return !toRemove.has(word);
    })
    .join("\n");
  parseInput();
}

function selectionLookupContext(node) {
  if (helperSentence.contains(node) || helperSentencePrev.contains(node)) {
    return { el: helperSentence.contains(node) ? helperSentence : helperSentencePrev, item: null };
  }
  const el = node.nodeType === 1 ? node : node.parentElement;
  const field = el && el.closest(".meaning, .word, .reading");
  if (!field || !bubblesEl || !bubblesEl.contains(field)) return null;
  const card = field.closest(".bubble");
  const item = card ? items.find((it) => it.word === card.dataset.word) : null;
  return { el: field, item: item || null };
}

function bubbleContext(item) {
  return { word: item.word, reading: item.reading, meaning: item.meaning };
}

function endWordDrag() {
  document.body.classList.remove("dragging-word");
  for (const el of document.querySelectorAll(".drop-target")) el.classList.remove("drop-target");
}

function dragCarriesWord(dt) {
  if (!dt) return false;
  const types = Array.from(dt.types || []);
  return types.includes(VOCAB_DRAG_TYPE) || types.includes("text/plain");
}

function readDragPayload(dt) {
  const raw = dt.getData(VOCAB_DRAG_TYPE);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.word) {
        return { word: parsed.word, context: { reading: parsed.reading || "", meaning: parsed.meaning || "" } };
      }
    } catch (_) {
      /* fall through to plain text */
    }
  }
  const text = (dt.getData("text/plain") || "").replace(/\s+/g, "").trim();
  return text ? { word: text, context: null } : null;
}

function wireDropZone(el, mode) {
  el.addEventListener("dragover", (e) => {
    if (!dragCarriesWord(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove("drop-target");
  });
  el.addEventListener("drop", (e) => {
    if (!dragCarriesWord(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    const payload = readDragPayload(e.dataTransfer);
    endWordDrag();
    if (!payload) return;
    helperLookup(payload.word, { mode: mode || helperMode, context: payload.context });
    pulseLookupBox();
  });
}

if (HAS_PARSER) {
  parseBtn.addEventListener("click", parseInput);
  knownFileBtn.addEventListener("click", openKnownFile);
  knownFileInput.addEventListener("change", loadKnownFromInput);

  inputEl.addEventListener("input", (e) => {
    syncInputAction();
    if (e.inputType === "insertFromPaste" && inputHasText()) clearKnown();
  });

  inputEl.addEventListener("paste", (e) => {
    const text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
    if (text.trim()) clearKnown();
  });

  inputActionBtn.addEventListener("click", () => {
    if (inputHasText()) {
      inputEl.value = "";
      parseInput();
      inputEl.focus();
      return;
    }
    inputEl.value = SAMPLE_VOCAB;
    parseInput();
  });

  clearBtn.addEventListener("click", clearKnown);

  copyBtn.addEventListener("click", copyCsv);
  removeKnownBtn.addEventListener("click", removeKnownFromInput);
}

if (aboutLink && aboutDialog) {
  aboutLink.addEventListener("click", (e) => {
    e.preventDefault();
    aboutDialog.showModal();
  });
}

lookupBox.addEventListener("animationend", (e) => {
  if (e.animationName === "lookup-pulse") lookupBox.classList.remove("pulse");
});

helperForm.addEventListener("submit", (e) => {
  e.preventDefault();
  helperLookup();
});

helperCmpRegenBtn.addEventListener("click", () => {
  const item = getActiveHelperItem();
  if (item) runHelperFetch(item, "cmp", { force: true });
});

// 入力欄のクリア: × ボタン / Esc キー（表示は CSS の :placeholder-shown で制御）
const helperClear = document.getElementById("helperClear");
function clearHelperInput() {
  helperInput.value = "";
  helperInput.focus();
}
if (helperClear) {
  helperClear.addEventListener("click", clearHelperInput);
}
helperInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && helperInput.value && !e.isComposing) {
    e.preventDefault();
    clearHelperInput();
  }
});

for (const btn of helperModes.querySelectorAll(".helper-mode")) {
  btn.addEventListener("click", () => {
    setHelperMode(btn.dataset.mode);
    if (handwritingOpen) renderHandwritingDraft(); // 候補のツールチップを選択中のタブに合わせる
  });
  if (HELPER_MODES.includes(btn.dataset.mode)) wireDropZone(btn, btn.dataset.mode);
}
// 手書きは「調べ方」ではなく入力方法: 入力欄の左のトグルで開閉
if (handwritingToggle) {
  handwritingToggle.addEventListener("click", () => {
    if (handwritingOpen) {
      handwritingOpen = false;
      renderHelperModes();
    } else {
      setHelperMode(HANDWRITING_TAB);
    }
  });
}

// 手書き入力: ペンのストローク → Google 手書き認識 → 候補 → 辞書で helperLookup
// ペンを離して HANDWRITING_AUTO_RECOGNIZE_MS 後に自動認識（次の一画でリセット）
const handwritingCanvas = document.getElementById("handwritingCanvas");
const handwritingCtx = handwritingCanvas.getContext("2d");
const handwritingClearBtn = document.getElementById("handwritingClearBtn");
const handwritingCandidates = document.getElementById("handwritingCandidates");
const handwritingUndoBtn = document.getElementById("handwritingUndoBtn");
const handwritingComposeBtn = document.getElementById("handwritingComposeBtn");
const handwritingCompose =document.getElementById("handwritingCompose");
const handwritingDraft = document.getElementById("handwritingDraft");
const handwritingDraftBackBtn = document.getElementById("handwritingDraftBackBtn");
const handwritingDraftCancelBtn = document.getElementById("handwritingDraftCancelBtn");
const handwritingDraftLookupBtn = document.getElementById("handwritingDraftLookupBtn");
const HANDWRITING_HINT = "ペンで書くと候補が表示されます";
let handwritingStrokes = []; // [[{x, y, t}, ...], ...]  x/y は CSS px
let handwritingCurrentStroke = null;
const HANDWRITING_UNDO_LIMIT = 5; // 取り消せるのは直近5画まで
let handwritingUndoCache = []; // 直近の最大5ストローク（handwritingStrokes 内の同じ配列を参照）
let handwritingDrawing = false;
let handwritingStartTime = 0;
let handwritingRequestId = 0;
let handwritingAutoTimer = 0;
let handwritingSize = { w: 360, h: 160 };
// 追加モード: 候補クリックで下書きに追加 → キャンバスをクリア（辞書は開かない）
let handwritingComposing = false;
let handwritingDraftParts = []; // 追加した候補（⌫ で1つずつ戻せる）

// 表示サイズに合わせてキャンバスの解像度を更新（パネルの高さに追従、歪み防止）
function syncHandwritingCanvasSize() {
  const w = handwritingCanvas.clientWidth;
  const h = handwritingCanvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  handwritingSize = { w, h };
  handwritingCanvas.width = Math.round(w * dpr);
  handwritingCanvas.height = Math.round(h * dpr);
  handwritingCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawHandwriting();
}

function getHandwritingPoint(e) {
  const rect = handwritingCanvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    t: Math.round(performance.now() - handwritingStartTime)
  };
}

function redrawHandwriting() {
  handwritingCtx.clearRect(0, 0, handwritingSize.w, handwritingSize.h);
  handwritingCtx.lineCap = "round";
  handwritingCtx.lineJoin = "round";
  handwritingCtx.lineWidth = 4;
  handwritingCtx.strokeStyle = "#1c1915";
  handwritingCtx.fillStyle = "#1c1915";
  for (const stroke of handwritingStrokes) {
    if (stroke.length === 1) {
      handwritingCtx.beginPath();
      handwritingCtx.arc(stroke[0].x, stroke[0].y, 2, 0, Math.PI * 2);
      handwritingCtx.fill();
      continue;
    }
    handwritingCtx.beginPath();
    handwritingCtx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) handwritingCtx.lineTo(stroke[i].x, stroke[i].y);
    handwritingCtx.stroke();
  }
}

function setHandwritingStatus(message, isError) {
  handwritingCandidates.replaceChildren();
  handwritingCandidates.classList.toggle("error", Boolean(isError));
  const note = document.createElement("span");
  note.className = "handwriting-status";
  note.textContent = message || HANDWRITING_HINT;
  handwritingCandidates.append(note);
}

function renderHandwritingCandidates(candidates) {
  handwritingCandidates.replaceChildren();
  handwritingCandidates.classList.remove("error");
  if (!candidates.length) {
    setHandwritingStatus("候補が見つかりませんでした");
    return;
  }
  for (const text of candidates) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "handwriting-candidate";
    btn.textContent = text;
    btn.title = handwritingComposing ? `「${text}」を下書きに追加` : `「${text}」を${handwritingLookupLabel(text)}で調べる`;
    btn.addEventListener("click", () => chooseHandwritingCandidate(text));
    handwritingCandidates.append(btn);
  }
}

function syncHandwritingClear() {
  handwritingClearBtn.hidden = !handwritingStrokes.length;
  handwritingUndoBtn.disabled = !handwritingUndoCache.length;
}

// 最後の一画を取り消す（キャッシュしている直近5画まで）
function undoHandwritingStroke() {
  if (handwritingDrawing) return;
  const stroke = handwritingUndoCache.pop();
  if (!stroke) return;
  const i = handwritingStrokes.lastIndexOf(stroke);
  if (i >= 0) handwritingStrokes.splice(i, 1);
  clearTimeout(handwritingAutoTimer);
  handwritingRequestId++; // 取り消し前の認識結果を破棄
  handwritingCandidates.classList.remove("loading");
  redrawHandwriting();
  syncHandwritingClear();
  if (handwritingStrokes.length) {
    setHandwritingStatus("認識中…");
    handwritingAutoTimer = setTimeout(recognizeHandwriting, 300);
  } else {
    setHandwritingStatus("");
  }
}

function clearHandwriting() {
  clearTimeout(handwritingAutoTimer);
  handwritingRequestId++; // 送信中の認識結果を破棄
  handwritingStrokes = [];
  handwritingUndoCache = [];
  handwritingCurrentStroke = null;
  handwritingDrawing = false;
  redrawHandwriting();
  syncHandwritingClear();
  setHandwritingStatus("");
}

// 手書き結果は、いま選んでいる調べ方タブ（辞書・例文・漢字辞典・類義語・漢字表記）でそのまま調べる。
function handwritingLookupMode() {
  return helperMode;
}

function handwritingLookupLabel() {
  return HELPER_MODE_LABELS[helperMode] || "辞書";
}

function chooseHandwritingCandidate(text) {
  clearHandwriting();
  if (handwritingComposing) {
    handwritingDraftParts.push(text);
    renderHandwritingDraft();
    return;
  }
  helperLookup(text, { mode: handwritingLookupMode(text) });
  pulseLookupBox();
}

function renderHandwritingDraft() {
  handwritingComposeBtn.setAttribute("aria-pressed", String(handwritingComposing));
  handwritingComposeBtn.classList.toggle("active", handwritingComposing);
  handwritingCompose.hidden = !handwritingComposing;
  const draft = handwritingDraftParts.join("");
  handwritingDraft.textContent = draft;
  handwritingDraft.classList.toggle("empty", !draft);
  handwritingDraft.dataset.placeholder = "候補をクリックすると下書きに追加されます";
  handwritingDraftBackBtn.disabled = !draft;
  handwritingDraftLookupBtn.disabled = !draft;
  for (const btn of handwritingCandidates.querySelectorAll(".handwriting-candidate")) {
    btn.title = handwritingComposing ? `「${btn.textContent}」を下書きに追加` : `「${btn.textContent}」を${handwritingLookupLabel(btn.textContent)}で調べる`;
  }
}

function setHandwritingComposing(on) {
  handwritingComposing = Boolean(on);
  if (!handwritingComposing) handwritingDraftParts = [];
  renderHandwritingDraft();
}

function lookupHandwritingDraft() {
  // 書きかけの文字がある場合は、いまの第1候補も下書きに含めてから調べる
  const pending = handwritingCandidates.querySelector(".handwriting-candidate");
  if (pending && handwritingStrokes.length) handwritingDraftParts.push(pending.textContent);
  const draft = handwritingDraftParts.join("");
  if (!draft) return;
  clearHandwriting();
  setHandwritingComposing(false);
  helperLookup(draft, { mode: handwritingLookupMode(draft) });
  pulseLookupBox();
}

// 候補の表記ゆれを揃えて重複を除く:
// NFKC（互換漢字 U+F900– などを通常の漢字へ）、空白・句読点・記号（「横 浜」「横、浜」「横浜*」）を除去
function normalizeHandwritingCandidate(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, "")
    .replace(/[\p{P}\p{S}]+/gu, "");
}

// Google 入力ツール（翻訳の手書き入力と同じエンドポイント）の ink 形式: 各ストロークを [xs, ys, ts] に
function handwritingInk() {
  return handwritingStrokes.map((stroke) => [
    stroke.map((p) => Math.round(p.x)),
    stroke.map((p) => Math.round(p.y)),
    stroke.map((p) => p.t)
  ]);
}

async function recognizeHandwriting() {
  clearTimeout(handwritingAutoTimer);
  if (!handwritingStrokes.length) return;
  const requestId = ++handwritingRequestId;
  handwritingCandidates.classList.add("loading");
  if (!handwritingCandidates.querySelector(".handwriting-candidate")) setHandwritingStatus("認識中…");
  const body = {
    requests: [{
      writing_guide: { writing_area_width: Math.round(handwritingSize.w), writing_area_height: Math.round(handwritingSize.h) },
      ink: handwritingInk(),
      language: HANDWRITING_LANGUAGE,
      max_num_results: HANDWRITING_MAX_CANDIDATES,
      max_completions: 0
    }]
  };
  try {
    const res = await fetch(HANDWRITING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (requestId !== handwritingRequestId) return;
    // 形式: ["SUCCESS", [[id, [候補...], [], {...}]]]
    if (!Array.isArray(data) || data[0] !== "SUCCESS") throw new Error(String((data && data[0]) || "unexpected response"));
    const raw = (data[1] && data[1][0] && data[1][0][1]) || [];
    const seen = new Set();
    const candidates = [];
    for (const c of raw) {
      const text = normalizeHandwritingCandidate(c);
      if (text && !seen.has(text)) {
        seen.add(text);
        candidates.push(text);
      }
    }
    renderHandwritingCandidates(candidates.slice(0, HANDWRITING_MAX_CANDIDATES));
  } catch (err) {
    if (requestId !== handwritingRequestId) return;
    console.warn("handwriting recognition failed", err);
    setHandwritingStatus("認識できませんでした（ネットワークを確認してください）", true);
  } finally {
    if (requestId === handwritingRequestId) handwritingCandidates.classList.remove("loading");
  }
}

function scheduleHandwritingRecognize() {
  clearTimeout(handwritingAutoTimer);
  if (!handwritingStrokes.length) return;
  handwritingAutoTimer = setTimeout(recognizeHandwriting, HANDWRITING_AUTO_RECOGNIZE_MS);
}

function endHandwritingStroke(e) {
  if (!handwritingDrawing) return;
  handwritingDrawing = false;
  handwritingCurrentStroke = null;
  if (e && e.pointerId != null && handwritingCanvas.hasPointerCapture(e.pointerId)) {
    handwritingCanvas.releasePointerCapture(e.pointerId);
  }
  scheduleHandwritingRecognize();
}

handwritingCanvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  e.preventDefault();
  // 書き始めたら入力欄のフォーカスを外す（Ctrl+Z を入力欄ではなく一画の取り消しに使うため）
  if (document.activeElement === helperInput) helperInput.blur();
  clearTimeout(handwritingAutoTimer);
  handwritingCanvas.setPointerCapture(e.pointerId);
  if (!handwritingStrokes.length) handwritingStartTime = performance.now();
  handwritingDrawing = true;
  handwritingCurrentStroke = [getHandwritingPoint(e)];
  handwritingStrokes.push(handwritingCurrentStroke);
  handwritingUndoCache.push(handwritingCurrentStroke);
  if (handwritingUndoCache.length > HANDWRITING_UNDO_LIMIT) handwritingUndoCache.shift();
  redrawHandwriting();
  syncHandwritingClear();
});

handwritingCanvas.addEventListener("pointermove", (e) => {
  if (!handwritingDrawing || !handwritingCurrentStroke) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (events.length ? events : [e])) handwritingCurrentStroke.push(getHandwritingPoint(ev));
  redrawHandwriting();
});

handwritingCanvas.addEventListener("pointerup", endHandwritingStroke);
handwritingCanvas.addEventListener("pointercancel", endHandwritingStroke);
handwritingClearBtn.addEventListener("click", clearHandwriting);
handwritingUndoBtn.addEventListener("click", undoHandwritingStroke);
document.addEventListener("keydown", (e) => {
  if (!handwritingOpen || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  if (!handwritingUndoCache.length) return;
  e.preventDefault();
  undoHandwritingStroke();
});
handwritingComposeBtn.addEventListener("click", () => setHandwritingComposing(!handwritingComposing));
handwritingDraftBackBtn.addEventListener("click", () => {
  handwritingDraftParts.pop();
  renderHandwritingDraft();
});
handwritingDraftCancelBtn.addEventListener("click", () => setHandwritingComposing(false));
handwritingDraftLookupBtn.addEventListener("click", lookupHandwritingDraft);
renderHandwritingDraft();
new ResizeObserver(syncHandwritingCanvasSize).observe(handwritingCanvas);
setHandwritingStatus("");

wireDropZone(lookupBox, null);
document.addEventListener("dragend", endWordDrag);

helperScrollLeft.addEventListener("click", () => {
  helperTabs.scrollBy({ left: -helperTabs.clientWidth * 0.75, behavior: "smooth" });
});

helperScrollRight.addEventListener("click", () => {
  helperTabs.scrollBy({ left: helperTabs.clientWidth * 0.75, behavior: "smooth" });
});

helperTabs.addEventListener("scroll", updateHelperHistoryScroll);
window.addEventListener("resize", updateHelperHistoryScroll);

helperKana.addEventListener("click", async () => {
  const text = helperKana.textContent.trim();
  if (!text || text === "…" || text === "コピーしました" || helperResult.classList.contains("error")) return;
  try {
    await navigator.clipboard.writeText(text);
    helperKana.textContent = "コピーしました";
    setTimeout(() => {
      if (helperKana.textContent === "コピーしました") helperKana.textContent = text;
    }, 900);
  } catch {
    /* ignore */
  }
});

helperEnBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (!helperEntry) return;
  if (helperEnShown) {
    setHelperEnVisible(false);
    return;
  }
  if (!helperEntry.en) {
    const en = await ensureHelperEnglish();
    if (!en) return;
  }
  setHelperEnVisible(true);
});

helperSentenceEnBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const item = getActiveHelperItem();
  const entry = item && item.sentence && item.sentence.entry;
  const current = entry && entry.sentences && entry.sentences[entry.index];
  if (!current || !current.en) return;
  setHelperSentenceEnVisible(!helperSentenceEnShown);
});

helperSentenceRegenBtn.addEventListener("click", () => {
  const item = getActiveHelperItem();
  if (!item || item.mode !== "sentence") return;
  item.sentence.enShown = false;
  runHelperFetch(item, "sentence", { force: true });
});

document.addEventListener("mouseup", () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const ctx = selectionLookupContext(range.commonAncestorContainer);
  if (!ctx) return;
  const word = sel.toString().replace(/\s+/g, "").trim();
  if (!looksJapanese(word)) return;
  const headword = ctx.item && word === ctx.item.word;
  helperLookupFromHighlight(word, headword ? bubbleContext(ctx.item) : null);
});

// 小6モードの切り替え。レベルを変えたら表示中の結果を捨てて、そのレベルのキャッシュから（なければ取得し直して）出す。
function renderGakuseiBtn() {
  if (!gakuseiBtn) return;
  gakuseiBtn.setAttribute("aria-pressed", gakuseiMode ? "true" : "false");
  gakuseiBtn.classList.toggle("gakusei-on", gakuseiMode);
  document.documentElement.classList.toggle("gakusei-mode", gakuseiMode);
}

function setGakuseiMode(enabled, save) {
  const next = Boolean(enabled);
  if (save) {
    try {
      localStorage.setItem(GAKUSEI_STORAGE_KEY, next ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
  }
  if (next === gakuseiMode) {
    renderGakuseiBtn();
    return;
  }
  gakuseiMode = next;
  const bank = gakuseiMode ? cacheBanks.gakusei : cacheBanks.standard;
  sentenceCache = bank.sentence;
  dictCache = bank.dict;
  kanjiCache = bank.kanji;
  thesCache = bank.thes;
  jitenCache = bank.jiten;
  cmpCache = bank.cmp;
  renderGakuseiBtn();

  if (helperEnAbort) helperEnAbort.abort();
  helperEnAbort = null;
  helperEntry = null;
  for (const item of helperHistory) {
    abortHelperItem(item);
    for (const mode of HELPER_MODES) {
      const st = modeState(item, mode);
      st.entry = null;
      st.error = "";
      st.enShown = false;
      st.fetchId++;
    }
  }
  const active = getActiveHelperItem();
  if (active && helperResult.classList.contains("visible") && !handwritingOpen) {
    paintHelperItem(active);
    runHelperFetch(active, helperMode);
  } else {
    renderHelperTabs();
  }
}

function loadGakuseiMode() {
  try {
    return localStorage.getItem(GAKUSEI_STORAGE_KEY) === "1";
  } catch (_) {
    return false;
  }
}

// ONにしたときだけ小さなトーストでほめる（読み込み時・他タブとの同期では出さない）
const GAKUSEI_CHEERS = [
  "やさしい言葉で説明するよ。いっしょにがんばろう！",
  "いいね！わかるところから、少しずつ。",
  "ナイス！読めた言葉がどんどんふえるよ。",
  "その調子！むずかしい言葉も、かんたんに。"
];
let gakuseiToastEl = null;
let gakuseiToastTimer = 0;
let gakuseiCheerIndex = -1;

function showGakuseiToast() {
  if (!gakuseiToastEl) {
    gakuseiToastEl = document.createElement("div");
    gakuseiToastEl.className = "gakusei-toast";
    gakuseiToastEl.setAttribute("role", "status");
    gakuseiToastEl.setAttribute("aria-live", "polite");
    gakuseiToastEl.innerHTML =
      '<span class="gakusei-toast-cap" aria-hidden="true">🎓</span>' +
      '<span class="gakusei-toast-text"><strong>小6モード ON</strong><span class="gakusei-toast-cheer"></span></span>';
    gakuseiToastEl.addEventListener("click", hideGakuseiToast);
    document.body.append(gakuseiToastEl);
  }
  gakuseiCheerIndex = (gakuseiCheerIndex + 1 + Math.floor(Math.random() * (GAKUSEI_CHEERS.length - 1))) % GAKUSEI_CHEERS.length;
  gakuseiToastEl.querySelector(".gakusei-toast-cheer").textContent = GAKUSEI_CHEERS[gakuseiCheerIndex];
  gakuseiToastEl.classList.remove("show");
  void gakuseiToastEl.offsetWidth; // 連打してもアニメーションをやり直す
  gakuseiToastEl.classList.add("show");
  clearTimeout(gakuseiToastTimer);
  gakuseiToastTimer = setTimeout(hideGakuseiToast, 2600);
}

function hideGakuseiToast() {
  clearTimeout(gakuseiToastTimer);
  if (gakuseiToastEl) gakuseiToastEl.classList.remove("show");
}

if (gakuseiBtn) {
  gakuseiBtn.addEventListener("click", () => {
    setGakuseiMode(!gakuseiMode, true);
    if (gakuseiMode) {
      showGakuseiToast();
      gakuseiBtn.classList.remove("gakusei-pop");
      void gakuseiBtn.offsetWidth;
      gakuseiBtn.classList.add("gakusei-pop");
    } else {
      hideGakuseiToast();
    }
  });
}
window.addEventListener("storage", (e) => {
  if (e.key === GAKUSEI_STORAGE_KEY) setGakuseiMode(e.newValue === "1", false);
});
setGakuseiMode(loadGakuseiMode(), false);

// 文字サイズ: html の font-size を倍率で変える（rem 指定の要素がまとめて拡大縮小）。両ページで共有して保存。
function clampFontScale(scale) {
  const n = Number(scale);
  if (!Number.isFinite(n)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(n * 10) / 10));
}

let fontScale = FONT_SCALE_DEFAULT;

function applyFontScale(scale, save) {
  fontScale = clampFontScale(scale);
  document.documentElement.style.fontSize = fontScale === FONT_SCALE_DEFAULT ? "" : fontScale * 100 + "%";
  if (fontResetBtn) {
    fontResetBtn.textContent = Math.round(fontScale * 100) + "%";
    fontResetBtn.classList.toggle("is-default", fontScale === FONT_SCALE_DEFAULT);
  }
  if (fontDecBtn) fontDecBtn.disabled = fontScale <= FONT_SCALE_MIN;
  if (fontIncBtn) fontIncBtn.disabled = fontScale >= FONT_SCALE_MAX;
  if (save) {
    try {
      localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(fontScale));
    } catch (_) {
      /* ignore */
    }
  }
  requestAnimationFrame(updateHelperHistoryScroll);
}

function loadFontScale() {
  try {
    const saved = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
    if (saved != null) return clampFontScale(saved);
  } catch (_) {
    /* ignore */
  }
  return FONT_SCALE_DEFAULT;
}

if (fontDecBtn) fontDecBtn.addEventListener("click", () => applyFontScale(fontScale - FONT_SCALE_STEP, true));
if (fontIncBtn) fontIncBtn.addEventListener("click", () => applyFontScale(fontScale + FONT_SCALE_STEP, true));
if (fontResetBtn) fontResetBtn.addEventListener("click", () => applyFontScale(FONT_SCALE_DEFAULT, true));
// 他のタブで変えたら追従
window.addEventListener("storage", (e) => {
  if (e.key === FONT_SCALE_STORAGE_KEY) applyFontScale(e.newValue, false);
});
applyFontScale(loadFontScale(), false);

renderHelperModes();
if (HAS_PARSER) {
  selected = [];
  saveKnown();
  renderBubbles();
  restoreKnownFile();
}
