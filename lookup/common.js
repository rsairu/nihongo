// 共通の文字処理: 2つ以上のモードで使う小さな関数（漢字かどうか、引用符を外す、もしかして、なし の判定など）。

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

const WRAP_QUOTE_PAIRS ={ '"': '"', "「": "」", "『": "』" };

function stripWrappingQuotes(s) {
  let text = String(s || "").trim();
  while (text.length >= 2) {
    const close = WRAP_QUOTE_PAIRS[text[0]];
    if (!close || text[text.length - 1] !== close) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

// 「もしかして」: 辞書と漢字表記の 候補: 行（prompts.js の buildSuggestionRules）。
// 埋まっていれば、ほかの行があっても答えは { suggestion } だけにする（推測の定義・表記は出さない・残さない）。
const SUGGESTION_LINE_RE = /^\s*(?:候補|もしかして|suggestion)\s*[:：]\s*(.*)$/im;

function parseSuggestion(text, query) {
  const m = String(text || "").match(SUGGESTION_LINE_RE);
  if (!m) return "";
  const bare = m[1].split(/[（(]/)[0].trim().replace(/[。．.]+$/, "");
  const s = stripWrappingQuotes(stripWrappingQuotes(bare));
  if (!s || isNoneList(s) || !looksJapanese(s)) return "";
  if (query && s === String(query).trim()) return "";
  return s;
}

function isSuggestionEntry(entry) {
  return Boolean(entry && entry.suggestion);
}

function isNoneList(value) {
  return /^(なし|無し|none|n\/a|-|ー|―)$/i.test(String(value || "").trim());
}

// 「見つかりませんでした。もしかして：〇〇」。〇〇 はボタンで、押すと同じタブ（mode）でその語を調べる。
// helperLookup を通すので、待てモードの休み中は他の入口と同じく調べない。
function renderSuggestion(container, word, mode) {
  const box = document.createElement("div");
  box.className = "did-you-mean";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "did-you-mean-btn";
  btn.textContent = word;
  btn.title = "「" + word + "」を調べる";
  btn.addEventListener("click", () => helperLookup(word, { mode }));
  box.append("見つかりませんでした。もしかして：", btn);
  container.replaceChildren(box);
}
