// 例文モード (sentence): 例文と英訳、作り直し、例文の中の語を選んで調べる。

const helperSentenceBlock = document.getElementById("helperSentenceBlock");
const helperSentence = document.getElementById("helperSentence");
const helperSentenceEn = document.getElementById("helperSentenceEn");
const helperSentenceEnBtn = document.getElementById("helperSentenceEnBtn");
const helperSentenceRegenBtn = document.getElementById("helperSentenceRegenBtn");
const helperSentencePrev = document.getElementById("helperSentencePrev");
let helperSentenceEnShown = false;

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

// 例文の中を選択したら、その語を調べる（バブルの中の選択は vocab_clicker.js が扱う）
document.addEventListener("mouseup", () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const node = sel.getRangeAt(0).commonAncestorContainer;
  if (!helperSentence.contains(node) && !helperSentencePrev.contains(node)) return;
  const word = sel.toString().replace(/\s+/g, "").trim();
  if (!looksJapanese(word)) return;
  helperLookupFromHighlight(word, null);
});
