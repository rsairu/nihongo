// 調べるパネルの中心: モードの一覧、キャッシュ、履歴タブ、helperLookup（すべての「調べる」の入口）、
// paintHelperItem（表示するモードを選ぶ）、runHelperFetch（取得するモードを選ぶ）、ドラッグ＆ドロップ、入力欄。
// モードごとの解析・取得・表示は lookup/modes/*.js。

const aboutLink = document.getElementById("aboutLink");
const aboutDialog = document.getElementById("about");
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
const lookupBox = document.querySelector(".lookup-box");
const HELPER_HISTORY_LIMIT = 10;
const DEEP_LINK_WAIT_MS = 5000; // ?q= で開いたとき、保存済みの答えを待つ上限
const HELPER_MODES = ["dict", "kanji", "sentence", "thes", "cmp", "jiten", "furi"];
const HELPER_MODE_LABELS = { dict: "辞書", kanji: "漢字表記", sentence: "例文", thes: "類義語", cmp: "使い分け", jiten: "漢字辞典", furi: "ふりがな" };
const HELPER_MODE_CHIP_LABELS = { dict: "辞書", kanji: "漢字", sentence: "例文", thes: "類義", cmp: "使分", jiten: "字典", furi: "読み" };
const VOCAB_DRAG_TYPE = "application/x-vocab-item";

function createCacheBank() {
  return { sentence: {}, dict: {}, kanji: {}, thes: {}, jiten: {}, cmp: {}, furi: {} };
}

const cacheBanks = { standard: createCacheBank(), gakusei: createCacheBank() };

// 読みはレベルで変わらないので、ふりがな（noGakusei）は2つのレベルで同じキャッシュを使う
cacheBanks.gakusei.furi = cacheBanks.standard.furi;

let sentenceCache = cacheBanks.standard.sentence;
let dictCache = cacheBanks.standard.dict;
let kanjiCache = cacheBanks.standard.kanji;
let thesCache = cacheBanks.standard.thes;

/** @type {Record<string, object>} 使い分け: key は正規化した語の並び（"補償・報酬"） */
let cmpCache = cacheBanks.standard.cmp;

/** @type {Record<string, object>} one entry per kanji character */
let jitenCache = cacheBanks.standard.jiten;

/** @type {Record<string, {ruby: {t: string, r?: string}[], reading: string, alt: string[]}>} ふりがな */
let furiCache = cacheBanks.standard.furi;

let helperNextId = 0;
let helperActiveId = 0;
let helperExpandedId = 0;

/** @type {"dict" | "kanji" | "sentence" | "thes" | "cmp" | "jiten" | "furi"} */
let helperMode = "dict";

/** @type {{id: number, query: string, context: {reading: string, meaning: string} | null, mode: string, usedModes: string[], dict: object, kanji: object, sentence: object, thes: object, cmp: object, jiten: object, furi: object}[]} */
let helperHistory = [];

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
  if (lookupStore) {
    const all = document.createElement("a");
    all.className = "helper-tab helper-tab-all";
    all.href = "history.html";
    all.textContent = "すべての履歴 →";
    all.title = "これまでに調べた語をすべて見る";
    helperTabs.append(all);
  }
  requestAnimationFrame(() => {
    const open = helperTabs.querySelector(".helper-tab-group.expanded");
    if (open) open.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    updateHelperHistoryScroll();
  });
}

function createModeState() {
  return { entry: null, error: "", loading: false, fetchId: 0, controller: null, enShown: false, glossShown: false };
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
    cmp: createModeState(),
    furi: createModeState()
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
  if (mode === "furi") {
    if (!item.furi) item.furi = createModeState();
    return item.furi;
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
  if (mode === "furi") return furiCache[query];
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
  else if (mode === "furi") furiCache[query] = entry;
  else if (mode === "jiten") {
    for (const k of (entry && entry.kanji) || []) jitenCache[k.char] = k;
  } else dictCache[dictCacheKey(query, "")] = entry;
  persistModeEntry(mode, query, entry);
}

const HELPER_INPUT_PLACEHOLDER = helperInput.placeholder;

function renderHelperModes() {
  lookupBox.dataset.mode = helperMode;
  helperInput.placeholder =
    helperMode === "cmp" ? CMP_INPUT_PLACEHOLDER
    : helperMode === "furi" ? FURI_INPUT_PLACEHOLDER
    : HELPER_INPUT_PLACEHOLDER;
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
  helperFuriBlock.classList.toggle("visible", helperMode === "furi");
  renderHelperModes();

  const st = modeState(item, helperMode);
  if (helperMode === "dict") {
    helperEnShown = st.enShown;
    helperGlossShown = st.glossShown;
    if (st.error) renderDictError(st.error);
    else if (st.entry) renderDictEntry(st.entry, st.enShown, st.glossShown);
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
  } else if (helperMode === "furi") {
    if (st.error) renderFuriError(st.error);
    else if (st.entry) renderFuriEntry(st.entry, item.query);
    else renderFuriPending("…");
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
      if (isSuggestionEntry(cached)) releaseReadingCooldown(item.id, mode);
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
    } else if (mode === "furi") {
      parsed = await fetchFuriEntry(item.query, controller.signal);
    } else {
      parsed = await fetchDictWithPrompt(buildFreeLookupPrompt(item.query), controller.signal, item.query);
    }
    cacheModeEntry(mode, item.query, parsed);
    if (isSuggestionEntry(parsed)) releaseReadingCooldown(item.id, mode);
    finishHelperFetch(item, mode, fetchId, parsed, "");
  } catch (err) {
    if (err?.name === "AbortError") return;
    const message =
      mode === "kanji" ? "漢字表記を読み込めませんでした"
      : mode === "sentence" ? "例文を読み込めませんでした"
      : mode === "thes" ? "類義語を読み込めませんでした"
      : mode === "cmp" ? "使い分けを読み込めませんでした"
      : mode === "jiten" ? (err && err.userMessage) || "漢字辞典を読み込めませんでした"
      : mode === "furi" ? "読みを読み込めませんでした"
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
  const query = stripLineBreaks(queryOverride != null ? String(queryOverride) : helperInput.value).trim();
  if (!query) return;
  // 待てモードの休み中は、どこから呼ばれても（ボタン・Enter・バブル・ドラッグ・類義語・手書き）調べない
  if (!opts.skipReadingCooldown && readingBlocked()) return;
  if (HELPER_MODES.includes(opts.mode)) helperMode = opts.mode;
  handwritingOpen = false;
  handwritingAutoOpened = false;

  let item = findHelperItem(query);
  // 表示中の語をタブだけ替えて調べ直すときは回数に数えない（モードだけ記録）
  const bump = !(item && item.id === helperActiveId);
  if (item) {
    if (opts.context) item.context = opts.context;
  } else {
    item = createHelperItem(query, opts.context);
  }
  if (lookupStore) lookupStore.recordLookup(query, helperMode, opts.context || null, bump);
  item.mode = helperMode;
  markModeUsed(item, helperMode);
  if (helperExpandedId && helperExpandedId !== item.id) helperExpandedId = 0;
  item = rememberHelperItem(item);
  helperActiveId = item.id;
  helperInput.value = query;
  // 休みは答えより先に始める（保存済みの もしかして はすぐ出て、そこで取り消されるので）
  if (!opts.skipReadingCooldown) startReadingCooldown({ itemId: item.id, mode: helperMode });
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

// 入力欄は <textarea>（ふりがなモードで2行に折り返すため。ほかのモードでは1行・横スクロールで今までの見た目）。
// 改行は入れない: Enter で調べる、貼り付けた改行は消す。
function stripLineBreaks(text) {
  return String(text || "").replace(/[\r\n]+/g, "");
}

helperInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if (typeof helperForm.requestSubmit === "function") helperForm.requestSubmit();
  else helperLookup();
});

helperInput.addEventListener("input", () => {
  const value = helperInput.value;
  if (!/[\r\n]/.test(value)) return;
  const caret = stripLineBreaks(value.slice(0, helperInput.selectionStart)).length;
  helperInput.value = stripLineBreaks(value);
  helperInput.setSelectionRange(caret, caret);
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
    if (btn.dataset.mode === "jiten") {
      // 漢字辞典は手で書いて調べることが多いので、タブを押したら手書きパッドも開く
      if (!handwritingOpen) {
        setHelperMode(HANDWRITING_TAB);
        handwritingAutoOpened = true;
      }
    } else if (handwritingAutoOpened) {
      // 自動で開いたパッドは、ほかのタブへ移ったら閉じて元の表示に戻す
      handwritingAutoOpened = false;
      if (handwritingOpen) {
        handwritingOpen = false;
        renderHelperModes();
      }
    }
    if (handwritingOpen) renderHandwritingDraft(); // 候補のツールチップを選択中のタブに合わせる
  });
  if (HELPER_MODES.includes(btn.dataset.mode)) wireDropZone(btn, btn.dataset.mode);
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
