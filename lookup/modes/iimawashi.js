// 言い回しモード (iimawashi): 語・フレーズ・文が、決まった言い方か・ふつうに言うか・作者の独自の表現か。直訳と訳も。
// プロンプトは prompts.js の buildIimawashiPrompt（Opus で考えさせる）。

const helperIimawashiBlock = document.getElementById("helperIimawashiBlock");
const helperIimawashiText = document.getElementById("helperIimawashiText");
const helperIimawashiVerdict = document.getElementById("helperIimawashiVerdict");
const helperIimawashiNote = document.getElementById("helperIimawashiNote");
const helperIimawashiEn = document.getElementById("helperIimawashiEn");
const helperIimawashiEnBtn = document.getElementById("helperIimawashiEnBtn");
const helperIimawashiRelated = document.getElementById("helperIimawashiRelated");

// 判定: 並びは「決まっている → 自由 → 外れている」。sub は判定の横に出す短い説明。
const IIMAWASHI_VERDICTS = [
  { key: "定型", sub: "辞書に載っている決まった言い方" },
  { key: "慣用的", sub: "決まった比喩を使った、ふつうの言い方" },
  { key: "普通", sub: "字どおりの言葉の組み合わせ（比喩なし）" },
  { key: "独自", sub: "作者独自の表現。ふつうはこう言わない" },
  { key: "不自然", sub: "不自然・誤用" },
  { key: "不明", sub: "判断できない" }
];

// 例文アイコンを出す判定（決まった言い方なので例文に意味がある）。普通・独自・不自然・不明 には出さない。
const IIMAWASHI_SENTENCE_VERDICTS = ["定型", "慣用的"];

let iimawashiEntry = null;
let iimawashiEnShown = false;

const IIMAWASHI_INPUT_PLACEHOLDER = "語・フレーズ・文（決まった言い方か・訳）";

function normalizeIimawashiVerdict(raw) {
  const s = stripWrappingQuotes(raw).replace(/[。．.\s]/g, "");
  // 「慣用的」を「慣用句」と書いてくることもあるが、慣用句 は辞書の見出し＝定型
  if (/^慣用句|^定型|^決まり文句|^ことわざ|^成句/.test(s)) return "定型";
  for (const v of IIMAWASHI_VERDICTS) if (s.startsWith(v.key)) return v.key;
  return "不明";
}

// 2つの英文がほぼ同じか（直訳を出すかどうか）。大文字小文字・記号・空白は見ない。
function sameEnglish(a, b) {
  const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return key(a) === key(b);
}

function parseIimawashiResponse(raw) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const pick = (re) => {
    const m = text.match(re);
    return m ? stripWrappingQuotes(m[1].trim()) : "";
  };
  const verdictRaw = pick(/^\s*(?:判定|verdict)\s*[:：]\s*(.+)$/im);
  const core = pick(/^\s*(?:核|core)\s*[:：]\s*(.+)$/im);
  const note = pick(/^\s*(?:解説|説明|note)\s*[:：]\s*(.+)$/im);
  const literal = pick(/^\s*(?:直訳|literal)\s*[:：]\s*(.+)$/im);
  const en = pick(/^\s*(?:訳|英訳|translation|EN)\s*[:：]\s*(.+)$/im);
  const relatedRaw = pick(/^\s*(?:関連|related)\s*[:：]\s*(.+)$/im);
  if (!verdictRaw && !note && !en) throw new Error("empty");
  const related = isNoneList(relatedRaw)
    ? []
    : relatedRaw
        .split(/[、,，;；\/／]+/)
        .map((w) => stripWrappingQuotes(w.replace(/[（(].*?[）)]/g, "").trim()))
        .filter((w) => w && !isNoneList(w) && looksJapanese(w))
        .filter((w, i, list) => list.indexOf(w) === i)
        .slice(0, 4);
  return {
    verdict: normalizeIimawashiVerdict(verdictRaw),
    core: isNoneList(core) ? "" : core,
    note,
    literal,
    en,
    related
  };
}

async function fetchIimawashiEntry(query, signal) {
  return parseIimawashiResponse(await requestPrompt("iimawashi", buildIimawashiPrompt(query), signal));
}

// 核 の横の丸いアイコン（漢字辞典の「よく使う言葉」の切り替えと同じ見た目）。押すとそのモードで 核 を調べる。
function iimawashiFollowButton(mode, icon, word, context) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "jiten-follow-btn";
  btn.dataset.mode = mode;
  const label = "「" + word + "」を" + HELPER_MODE_LABELS[mode] + "で調べる";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  const img = document.createElement("img");
  img.className = "mode-icon";
  img.src = "icons_png/web/" + icon;
  img.alt = "";
  img.width = 48;
  img.height = 48;
  btn.append(img);
  btn.addEventListener("click", () => helperLookup(word, context ? { mode, context } : { mode }));
  return btn;
}

function iimawashiFollowButtons(entry) {
  const group = document.createElement("span");
  group.className = "iimawashi-follow";
  group.append(iimawashiFollowButton("dict", "lookup.png", entry.core));
  if (IIMAWASHI_SENTENCE_VERDICTS.includes(entry.verdict)) {
    group.append(iimawashiFollowButton("sentence", "sentence.png", entry.core, { reading: "", meaning: entry.en || "" }));
  }
  return group;
}

// 入力をそのまま大きく出し、核 に色を付けて、そのすぐ後ろに辞書（と例文）のアイコン。
// 核 が入力の中にない（活用している）ときは false を返し、呼び出し側が判定の行に 核 とアイコンを出す。
function renderIimawashiQuery(query, entry) {
  helperIimawashiText.replaceChildren();
  const core = entry.core;
  const at = core ? query.indexOf(core) : -1;
  if (at < 0) {
    helperIimawashiText.append(document.createTextNode(query));
    return false;
  }
  const mark = document.createElement("mark");
  mark.className = "iimawashi-core";
  mark.textContent = core;
  helperIimawashiText.append(
    document.createTextNode(query.slice(0, at)),
    mark,
    iimawashiFollowButtons(entry),
    document.createTextNode(query.slice(at + core.length))
  );
  return true;
}

function iimawashiHasEnglish(entry) {
  return Boolean(entry && (entry.en || entry.literal));
}

// 英語（訳・直訳）は辞書の英訳と同じく、ボタンを押すまで出さない。1つのボタンで両方。
function setIimawashiEnVisible(shown) {
  iimawashiEnShown = shown;
  const item = getActiveHelperItem();
  if (item) modeState(item, "iimawashi").enShown = shown;
  helperIimawashiEn.classList.toggle("visible", shown && iimawashiHasEnglish(iimawashiEntry));
  helperIimawashiEnBtn.textContent = shown ? "英訳を隠す" : "英訳を表示";
}

function clearIimawashi() {
  iimawashiEntry = null;
  helperIimawashiEnBtn.classList.remove("visible");
  helperIimawashiEn.classList.remove("visible");
  helperIimawashiVerdict.replaceChildren();
  helperIimawashiNote.textContent = "";
  helperIimawashiEn.replaceChildren();
  helperIimawashiRelated.replaceChildren();
}

function renderIimawashiMessage(text) {
  helperIimawashiText.textContent = text;
  clearIimawashi();
}

function renderIimawashiPending(text) {
  helperResult.classList.remove("error");
  renderIimawashiMessage(text);
}

function renderIimawashiError(message) {
  helperResult.classList.add("error");
  renderIimawashiMessage(message);
}

function renderIimawashiEntry(entry, query, enShown) {
  helperResult.classList.remove("error");
  clearIimawashi();
  iimawashiEntry = entry;
  const coreShown = renderIimawashiQuery(query, entry);

  const verdict = IIMAWASHI_VERDICTS.find((v) => v.key === entry.verdict) || IIMAWASHI_VERDICTS[IIMAWASHI_VERDICTS.length - 1];
  const badge = document.createElement("span");
  badge.className = "iimawashi-badge";
  badge.dataset.verdict = verdict.key;
  badge.textContent = verdict.key;
  const sub = document.createElement("span");
  sub.className = "iimawashi-sub";
  sub.textContent = verdict.sub;
  helperIimawashiVerdict.append(badge, sub);
  // 核 が入力の中に見つからなかった（活用している）ときは、判定の行に 核 とアイコンを出す
  if (entry.core && !coreShown) {
    const core = document.createElement("span");
    core.className = "iimawashi-core-text";
    core.textContent = entry.core;
    helperIimawashiVerdict.append(core, iimawashiFollowButtons(entry));
  }

  // 解説の漢字はクリックで調べない（語ではなく漢字のかたまりを拾うだけなので）
  helperIimawashiNote.textContent = entry.note || "";

  // 英語は「英訳を表示」で出す。直訳は 訳 とほぼ同じなら出さない。
  const enLines = [];
  if (entry.en) enLines.push({ tag: "訳", text: entry.en });
  if (entry.literal && !sameEnglish(entry.literal, entry.en)) enLines.push({ tag: "直訳", text: entry.literal });
  for (const line of enLines) {
    const row = document.createElement("div");
    row.className = "iimawashi-en-row";
    const tag = document.createElement("span");
    tag.className = "iimawashi-en-tag";
    tag.textContent = line.tag;
    const body = document.createElement("span");
    body.lang = "en";
    body.textContent = line.text;
    row.append(tag, body);
    helperIimawashiEn.append(row);
  }
  helperIimawashiEnBtn.classList.toggle("visible", enLines.length > 0);
  helperIimawashiEnBtn.disabled = false;
  setIimawashiEnVisible(Boolean(enShown) && enLines.length > 0);

  if (entry.related && entry.related.length) {
    const label = document.createElement("span");
    label.className = "thes-label";
    label.textContent = "関連";
    helperIimawashiRelated.append(label);
    for (const w of entry.related) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "thes-chip iimawashi-related-chip";
      chip.textContent = w;
      chip.title = "「" + w + "」を辞書で調べる";
      chip.addEventListener("click", () => helperLookup(w, { mode: "dict" }));
      helperIimawashiRelated.append(chip);
    }
  }
}

helperIimawashiEnBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!iimawashiEntry) return;
  setIimawashiEnVisible(!iimawashiEnShown);
});
