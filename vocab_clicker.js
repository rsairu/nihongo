const CLAUDE_MODEL = "claude-haiku-4-5";
const KNOWN_STORAGE_KEY = "vocab-clicker-known";

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
const bubblesEl = document.getElementById("bubbles");
const csvEl = document.getElementById("csv");
const copyBtn = document.getElementById("copyBtn");
const removeKnownBtn = document.getElementById("removeKnownBtn");
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
const lookupBox = document.querySelector(".lookup-box");
const HELPER_HISTORY_LIMIT = 10;
const HELPER_MODES = ["dict", "kanji", "sentence"];
const HELPER_MODE_LABELS = { dict: "辞書", kanji: "漢字表記", sentence: "例文" };
const HELPER_MODE_CHIP_LABELS = { dict: "辞書", kanji: "漢字", sentence: "例文" };
const KANJI_USAGE_LABELS = ["なし", "まれ", "かな優先", "どちらも", "漢字優先"];
const KANJI_METER_STEPS = 4;
const VOCAB_DRAG_TYPE = "application/x-vocab-item";

/** @type {{word: string, reading: string, meaning: string}[]} */
let items = [];
/** @type {string[]} first-select order */
let selected = [];
/** @type {Record<string, {ja: string, en: string}[]>} */
const sentenceCache = {};
/** @type {Record<string, {reading: string, ja: string, en: string}>} */
const dictCache = {};
/** @type {Record<string, {form: string, usage: number, label: string, preferred: string, note: string}>} */
const kanjiCache = {};
/** @type {AbortController | null} */
let helperEnAbort = null;
let helperEnRequestId = 0;
/** @type {{reading: string, ja: string, en: string} | null} */
let helperEntry = null;
let helperEnShown = false;
let helperNextId = 0;
let helperActiveId = 0;
let helperExpandedId = 0;
/** @type {"dict" | "kanji" | "sentence"} */
let helperMode = "dict";
let helperSentenceEnShown = false;
/** @type {{id: number, query: string, context: {reading: string, meaning: string} | null, mode: string, usedModes: string[], dict: object, kanji: object, sentence: object}[]} */
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

function loadKnown() {
  try {
    const raw = localStorage.getItem(KNOWN_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) selected = parsed.filter((w) => typeof w === "string" && w);
  } catch (_) {
    /* ignore */
  }
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
    word.title = "辞書・漢字表記・例文へドラッグ";
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
  statusEl.textContent = items.length ? items.length + "語" : "";
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

function buildFreeLookupPrompt(query) {
  return [
    "Lookup this Japanese word or phrase.",
    "3 lines only:",
    "読み: <hiragana; katakana if that is normal>",
    "JA: <one short Japanese def>",
    "EN: <short English gloss>",
    "",
    "Q: " + query
  ].join("\n");
}

function buildEnOnlyPrompt(word, reading, ja) {
  return [
    "Translate this Japanese word gloss into a short English definition.",
    "Output ONLY the English gloss on one line. No quotes or labels.",
    "",
    "Word: " + word,
    "Reading: " + reading,
    "JA: " + ja
  ].join("\n");
}

function buildKanjiPrompt(query, context) {
  const lines = [
    "Judge how this Japanese word is normally written in modern Japanese.",
    "Output exactly 4 lines and nothing else:",
    "形: <principal kanji spelling, or なし if no established kanji spelling exists>",
    "使用: <0-4>",
    "表記: <kana | either | kanji>",
    "補足: <one short Japanese sentence for a learner>",
    "",
    "使用 scale:",
    "0 = no established kanji spelling",
    "1 = kanji exists but is rare or archaic; avoid writing it",
    "2 = kanji is valid but the word is usually written in kana",
    "3 = kana and kanji are both common",
    "4 = normally written in kanji",
    "",
    "Q: " + query
  ];
  if (context && context.reading) lines.push("Reading: " + context.reading);
  if (context && context.meaning) lines.push("Meaning: " + context.meaning);
  return lines.join("\n");
}

function apiKey() {
  return typeof CLAUDE_API_KEY === "string" ? CLAUDE_API_KEY : "";
}

function hasApiKey() {
  const key = apiKey();
  return Boolean(key) && key !== "PASTE_KEY_HERE";
}

async function requestClaudeText(prompt, maxTokens, signal, temperature) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      temperature: temperature == null ? 0 : temperature,
      messages: [{ role: "user", content: prompt }]
    }),
    signal
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data.error && data.error.message) || ("HTTP " + res.status);
    throw new Error(msg);
  }

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
  const parsed = parseDictResponse(await requestClaudeText(prompt, 160, signal));
  if (!parsed.reading || !parsed.ja) throw new Error("empty");
  return parsed;
}

async function fetchKanjiUsage(query, context, signal) {
  return parseKanjiResponse(await requestClaudeText(buildKanjiPrompt(query, context), 220, signal));
}

async function fetchEnOnly(word, reading, ja, signal) {
  const text = stripWrappingQuotes(
    (await requestClaudeText(buildEnOnlyPrompt(word, reading, ja), 64, signal))
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
    sentence: createModeState()
  };
}

function modeState(item, mode) {
  if (mode === "kanji") return item.kanji;
  if (mode === "sentence") {
    if (!item.sentence) item.sentence = createModeState();
    return item.sentence;
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
  return dictCache[dictCacheKey(query, "")];
}

function cacheModeEntry(mode, query, entry) {
  if (mode === "kanji") kanjiCache[query] = entry;
  else if (mode === "sentence") sentenceCache[query] = (entry && entry.sentences) || [];
  else dictCache[dictCacheKey(query, "")] = entry;
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

function renderHelperModes() {
  lookupBox.dataset.mode = helperMode;
  for (const btn of helperModes.querySelectorAll(".helper-mode")) {
    const active = btn.dataset.mode === helperMode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
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

  if (!hasApiKey()) {
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
  if (!HELPER_MODES.includes(mode) || mode === helperMode) return;
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

  if (!hasApiKey()) {
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

function buildSentencePrompt(query, context, previous) {
  const avoid = previous.length
    ? "Do not repeat or closely paraphrase any of these previous Japanese sentences:\n" + previous.map((s) => "- " + s.ja).join("\n") + "\n"
    : "";
  const lines = [
    "Write exactly one simple, natural Japanese example sentence that uses this vocabulary word.",
    "Use a different everyday or literary situation so the learner sees varied usage.",
    "Also give a natural English translation of that sentence.",
    "Output exactly two lines and nothing else:",
    "JA: <Japanese sentence>",
    "EN: <English translation>",
    "No quotes, no reading, no commentary.",
    "",
    "Word: " + query
  ];
  if (context && context.reading) lines.push("Reading: " + context.reading);
  if (context && context.meaning) lines.push("Meaning: " + context.meaning);
  if (avoid) lines.push(avoid);
  return lines.join("\n");
}

async function fetchSentenceEntry(query, context, previous, signal) {
  const parsed = parseSentenceResponse(
    await requestClaudeText(buildSentencePrompt(query, context, previous), 256, signal, 0.9)
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

function parseInput() {
  items = parseVocab(inputEl.value);
  renderBubbles();
  syncInputAction();
  if (!items.length && inputHasText()) {
    statusEl.textContent = "単語の行が見つかりませんでした。";
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
  if (!field || !bubblesEl.contains(field)) return null;
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

parseBtn.addEventListener("click", parseInput);

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

aboutLink.addEventListener("click", (e) => {
  e.preventDefault();
  aboutDialog.showModal();
});

clearBtn.addEventListener("click", clearKnown);

copyBtn.addEventListener("click", copyCsv);
removeKnownBtn.addEventListener("click", removeKnownFromInput);

lookupBox.addEventListener("animationend", (e) => {
  if (e.animationName === "lookup-pulse") lookupBox.classList.remove("pulse");
});

helperForm.addEventListener("submit", (e) => {
  e.preventDefault();
  helperLookup();
});

for (const btn of helperModes.querySelectorAll(".helper-mode")) {
  btn.addEventListener("click", () => setHelperMode(btn.dataset.mode));
  wireDropZone(btn, btn.dataset.mode);
}

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

renderHelperModes();
loadKnown();
renderBubbles();
