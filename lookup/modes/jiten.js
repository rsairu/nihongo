// 漢字辞典モード (jiten): 入力の中の漢字を1字ずつ。よく使う言葉からの追いかけ調べ。

const JITEN_FOLLOW_STORAGE_KEY = "vocab-clicker-jiten-follow";
const helperJitenBlock = document.getElementById("helperJitenBlock");
const helperJitenList = document.getElementById("helperJitenList");

// 漢字辞典: 入力の中の漢字を1字ずつ引く（1字1リクエスト、並列）。キャッシュも1字単位なので 景色 と 風景 で 景 を共有する。
const JITEN_MAX_CHARS = 4;

const JITEN_MAX_WORDS = 6;

// 漢字辞典の語リストを整える: 見出し字を含む語だけ残し、同じ語（単語＋よみ）は1枚にまとめて意味を 、 でつなぐ。最大 JITEN_MAX_WORDS 語。
// 新しい答え（parseJitenResponse）と保存済みの答え（repairStoredEntry）の両方で使う。
// 2026-10-21 逞: モデルが 逞しい を意味ごとに4回くり返し、保存済みの答えの読み込みでは重複が消えなかった。
function tidyJitenWords(list, ch) {
  const out = [];
  const byKey = new Map();
  for (const w of list || []) {
    if (!w || !w.word || (ch && !w.word.includes(ch))) continue;
    const key = w.word + "｜" + (w.reading || "");
    const have = byKey.get(key);
    if (!have) {
      const item = { ...w };
      byKey.set(key, item);
      out.push(item);
      continue;
    }
    const glosses = have.gloss ? have.gloss.split("、") : [];
    for (const g of String(w.gloss || "").split("、")) {
      const s = g.trim();
      if (s && !glosses.includes(s)) glosses.push(s);
    }
    have.gloss = glosses.join("、");
  }
  return out.slice(0, JITEN_MAX_WORDS);
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
  // 語: は1語1行でくり返す（古い形の「1行に ; 区切り」も parseThesList が読む）
  const words = tidyJitenWords(
    [...text.matchAll(/^\s*(?:語|熟語|words?)\s*[:：]\s*(.+)$/gim)].flatMap((m) => parseThesList(m[1])),
    ch
  );
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

// 漢字辞典の「よく使う言葉」をクリックしたときに開くモード（追いかけ調べ）。辞書がふつう。
// 漢字辞典に短い意味はもう出ているので、例文や、その言葉の漢字辞典・類義語・漢字表記へ直接行けるように。
// 全カード共通の1つの値。localStorage に保存（このブラウザだけ）。
const JITEN_FOLLOW_MODES = [
  { mode: "dict", icon: "lookup.png" },
  { mode: "sentence", icon: "sentence.png" },
  { mode: "jiten", icon: "jiten.png" },
  { mode: "thes", icon: "thesaurus.png" },
  { mode: "kanji", icon: "kana.png" }
];

let jitenFollowMode = "dict";

try {
  const saved = localStorage.getItem(JITEN_FOLLOW_STORAGE_KEY);
  if (JITEN_FOLLOW_MODES.some((m) => m.mode === saved)) jitenFollowMode = saved;
} catch (_) {}

function jitenFollowTitle(entry) {
  return HELPER_MODE_LABELS[jitenFollowMode] + "で調べる: " + [entry.word, entry.reading].filter(Boolean).join(" ");
}

function setJitenFollowMode(mode) {
  if (!JITEN_FOLLOW_MODES.some((m) => m.mode === mode)) return;
  jitenFollowMode = mode;
  try { localStorage.setItem(JITEN_FOLLOW_STORAGE_KEY, mode); } catch (_) {}
  // 表示中のカードすべての切り替えと言葉の色・title をそろえる
  for (const list of helperJitenList.querySelectorAll(".jiten-words")) list.dataset.follow = mode;
  for (const btn of helperJitenList.querySelectorAll(".jiten-follow-btn")) {
    const on = btn.dataset.mode === mode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  for (const chip of helperJitenList.querySelectorAll(".jiten-word")) {
    if (chip._jitenEntry) chip.title = jitenFollowTitle(chip._jitenEntry);
  }
}

function renderJitenFollowPicker() {
  const group = document.createElement("div");
  group.className = "jiten-follow";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "言葉をクリックしたときの調べ方");
  for (const m of JITEN_FOLLOW_MODES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jiten-follow-btn";
    btn.dataset.mode = m.mode;
    const on = m.mode === jitenFollowMode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", "言葉を" + HELPER_MODE_LABELS[m.mode] + "で調べる");
    btn.title = "言葉をクリックしたら" + HELPER_MODE_LABELS[m.mode] + "で調べる";
    const img = document.createElement("img");
    img.className = "mode-icon";
    img.src = "icons_png/web/" + m.icon;
    img.alt = "";
    img.width = 48;
    img.height = 48;
    btn.append(img);
    btn.addEventListener("click", () => setJitenFollowMode(m.mode));
    group.append(btn);
  }
  return group;
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
  btn._jitenEntry = entry;
  btn.title = jitenFollowTitle(entry);
  btn.addEventListener("click", () => {
    helperLookup(entry.word, {
      mode: jitenFollowMode,
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
  // 並び: 訓 → 音 → 意味（日本語）→ EN
  info.append(jitenReadingRow("訓", k.kun || [], true));
  info.append(jitenReadingRow("音", k.on || [], false));
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
  head.append(info);
  card.append(head);

  const words = k.words || [];
  if (words.length) {
    const wordsHead = document.createElement("div");
    wordsHead.className = "jiten-words-head";
    const label = document.createElement("div");
    label.className = "thes-label";
    label.textContent = "よく使う言葉";
    wordsHead.append(label, renderJitenFollowPicker());
    card.append(wordsHead);
    const list = document.createElement("div");
    list.className = "thes-list jiten-words";
    list.dataset.follow = jitenFollowMode;
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
