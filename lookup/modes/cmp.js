// 使い分けモード (cmp): 意味の重なる2〜3語の違い。

const helperCmpBlock = document.getElementById("helperCmpBlock");
const helperCmp = document.getElementById("helperCmp");

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

function cmpNote(text, cls) {
  const note = document.createElement("div");
  note.className = cls || "thes-empty";
  note.textContent = text;
  return note;
}

function renderCmpPending(text) {
  helperResult.classList.remove("error");
  helperCmp.replaceChildren(cmpNote(text));
}

function renderCmpError(message) {
  helperResult.classList.add("error");
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

const CMP_INPUT_PLACEHOLDER = "2〜3語を「・」で区切る（例: 補償・報酬）";
