// 語彙クリッカー（vocab_clicker.html）だけのコード: 単語リストの解析・バブル・選択とCSV・既知リスト (known_words.json)。
// 調べるパネルは lookup.js（このファイルより先に読み込む）。ここからは helperLookup / helperLookupFromHighlight /
// pulseLookupBox / renderLookupText / looksJapanese / endWordDrag / VOCAB_DRAG_TYPE を使う。

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
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const knownFileBtn = document.getElementById("knownFileBtn");
const knownFileInput = document.getElementById("knownFileInput");
const bubblesEl = document.getElementById("bubbles");
const csvEl = document.getElementById("csv");
const copyBtn = document.getElementById("copyBtn");
const removeKnownBtn = document.getElementById("removeKnownBtn");

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

function bubbleContext(item) {
  return { word: item.word, reading: item.reading, meaning: item.meaning };
}

// バブルの中を選択したら、その語を調べる。見出し語そのものなら読みと意味も渡す（例文の中の選択は lookup.js）。
document.addEventListener("mouseup", () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const node = sel.getRangeAt(0).commonAncestorContainer;
  const el = node.nodeType === 1 ? node : node.parentElement;
  const field = el && el.closest(".meaning, .word, .reading");
  if (!field || !bubblesEl.contains(field)) return;
  const card = field.closest(".bubble");
  const item = card ? items.find((it) => it.word === card.dataset.word) : null;
  const word = sel.toString().replace(/\s+/g, "").trim();
  if (!looksJapanese(word)) return;
  const headword = item && word === item.word;
  helperLookupFromHighlight(word, headword ? bubbleContext(item) : null);
});

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

selected = [];
saveKnown();
renderBubbles();
restoreKnownFile();
