// 辞書モード (dict): 定義・読み・訳語・英訳。

const helperDictBlock = document.getElementById("helperDictBlock");
const helperKana = document.getElementById("helperKana");
const helperDef = document.getElementById("helperDef");
const helperEn = document.getElementById("helperEn");
const helperEnBtn = document.getElementById("helperEnBtn");
const helperGloss = document.getElementById("helperGloss");
const helperGlossBtn = document.getElementById("helperGlossBtn");
const helperSpelling = document.getElementById("helperSpelling");
const helperHomophones = document.getElementById("helperHomophones");

/** @type {AbortController | null} */
let helperEnAbort = null;

let helperEnRequestId = 0;

/** @type {AbortController | null} */
let helperGlossAbort = null;

let helperGlossRequestId = 0;

/** @type {{reading: string, ja: string, en: string, gloss?: string} | null} */
let helperEntry = null;

let helperEnShown = false;
let helperGlossShown = false;

function dictCacheKey(word, context) {
  return word + "\n" + context;
}

const NEW_USAGE_MARK = "〔新〕"; // 辞書プロンプトの「新しい用法」の印（prompts.js）

function parseDictResponse(raw, query) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const suggestion = parseSuggestion(text, query);
  if (suggestion) return { suggestion };
  const readingMatch = text.match(/^\s*(?:読み(?:方)?|よみ|reading)\s*[:：]\s*(.+)$/im);
  const jaMatch = text.match(/^\s*JA\s*[:：]\s*(.+)$/im);
  const enMatch = text.match(/^\s*EN\s*[:：]\s*(.+)$/im);
  const glossMatch = text.match(GLOSS_LINE_RE);
  let reading = readingMatch ? readingMatch[1].trim() : "";
  let ja = jaMatch ? jaMatch[1].trim() : "";
  // 「1行で」の指示を破って 〔新〕 を JA: の次の行に書いてきたときも、捨てずに JA に足す。
  if (jaMatch) {
    const after = text.slice(jaMatch.index + jaMatch[0].length).split("\n");
    for (const line of after) {
      const t = line.trim();
      if (!t) continue;
      if (!t.startsWith(NEW_USAGE_MARK)) break;
      ja += t;
    }
  }
  let en = enMatch ? enMatch[1].trim() : "";
  if (!reading || !ja) {
    // 候補: なし・見出し:・活用:・表記:・同音:・訳: の行は位置で読むときに数えない（読み・JA がずれないように）
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l && !SUGGESTION_LINE_RE.test(l) && !GLOSS_LINE_RE.test(l) &&
          !SPELLING_LINE_RE.test(l) && !HOMOPHONE_LINE_RE.test(l) &&
          !LEMMA_LINE_RE.test(l) && !INFLECTION_LINE_RE.test(l)
      );
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
  const gloss = glossMatch ? cleanGloss(glossMatch[1]) : "";
  const entry = gloss ? { reading, ja, en, gloss } : { reading, ja, en };
  // 見出し（辞書形）は Q が活用しているときだけ残す（疲れ果て → 疲れ果てる）。活用 はそのときだけ。
  const lemmaMatch = text.match(LEMMA_LINE_RE);
  const lemma = lemmaMatch ? cleanLemma(lemmaMatch[1], query) : "";
  if (lemma) {
    entry.lemma = lemma;
    const formMatch = text.match(INFLECTION_LINE_RE);
    const inflection = formMatch ? cleanInflection(formMatch[1]) : "";
    if (inflection) entry.inflection = inflection;
  }
  // 表記・同音語は、かなだけで引いたときだけ（漢字があれば、もうその語に決まっている）
  if (!hasKanji(query)) {
    const spellingMatch = text.match(SPELLING_LINE_RE);
    const spelling = spellingMatch ? cleanSpelling(spellingMatch[1], query) : "";
    const homophoneMatch = text.match(HOMOPHONE_LINE_RE);
    const homophones = homophoneMatch ? cleanHomophones(homophoneMatch[1], query, spelling) : [];
    if (spelling) entry.spelling = spelling;
    if (homophones.length) entry.homophones = homophones;
  }
  return entry;
}

// 表記（定義した語の漢字）と 同音（同じ読みのほかの語）。prompts.js の buildFreeLookupPrompt。
const SPELLING_LINE_RE = /^\s*(?:表記|spelling)\s*[:：]\s*(.*)$/im;

const HOMOPHONE_LINE_RE = /^\s*(?:同音語?|homophones?)\s*[:：]\s*(.*)$/im;
const HOMOPHONE_MAX = 4;

// 見出し（辞書形）と 活用（Q の形の名前）。prompts.js の buildFreeLookupPrompt（2026-11-11）。
// 疲れ果て で引くと 見出し: 疲れ果てる / 活用: 連用形。見出しは 読み【見出し】、活用 は上の小さい Q の横に出す。
const LEMMA_LINE_RE = /^\s*(?:見出し(?:語)?|辞書形|lemma)\s*[:：]\s*(.*)$/im;

const INFLECTION_LINE_RE = /^\s*(?:活用(?:形)?|inflection)\s*[:：]\s*(.*)$/im;

function sameHeadword(a, b) {
  const key = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "");
  return key(a) === key(b);
}

function cleanLemma(raw, query) {
  const s = cleanSpellingWord(raw);
  if (!s || isNoneList(s) || !looksJapanese(s) || sameHeadword(s, query)) return "";
  return s;
}

function cleanInflection(raw) {
  const s = stripWrappingQuotes(String(raw || "").trim()).replace(/[。．.]+$/, "").trim();
  if (!s || isNoneList(s) || s.length > 16) return "";
  return s;
}

function hasKanji(text) {
  return Array.from(String(text || "")).some(isKanjiChar);
}

// 「橋（はし）」「【橋】」のような飾りを外す。漢字のない答え・Q と同じ答えは出さない。
function cleanSpellingWord(raw) {
  const s = stripWrappingQuotes(String(raw || "").split(/[（(]/)[0].replace(/[【】\[\]]/g, "").trim());
  return s.replace(/[。．.]+$/, "").trim();
}

function cleanSpelling(raw, query) {
  const s = cleanSpellingWord(raw);
  if (!s || isNoneList(s) || !hasKanji(s) || s === String(query).trim()) return "";
  return s;
}

function cleanHomophones(raw, query, spelling) {
  const s = String(raw || "").trim();
  if (!s || isNoneList(s)) return [];
  const seen = new Set([String(query).trim(), spelling]);
  const out = [];
  for (const part of s.split(/[、,，;；/／・]+/)) {
    const w = cleanSpellingWord(part);
    if (!w || isNoneList(w) || !hasKanji(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= HOMOPHONE_MAX) break;
  }
  return out;
}

// 訳語（prompts.js の 訳: 行 / buildGlossPrompt）。定義の英訳（en）とは別の、語そのものの英語。
// 「英訳」の行にマッチしないよう、行頭の 訳 だけを読む。
const GLOSS_LINE_RE = /^\s*(?:訳語|訳|gloss)\s*[:：]\s*(.*)$/im;

function cleanGloss(raw) {
  const s = stripWrappingQuotes(String(raw || "").split("\n")[0].trim().replace(/^(?:訳語|訳|gloss)\s*[:：]\s*/i, ""));
  return isNoneList(s) ? "" : s;
}

async function fetchDictWithPrompt(prompt, signal, query) {
  const parsed = parseDictResponse(await requestPrompt("dict", prompt, signal), query);
  if (isSuggestionEntry(parsed)) return parsed;
  if (!parsed.reading || !parsed.ja) throw new Error("empty");
  return parsed;
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

// 訳 のない保存済みの答えだけで使う（新しい辞書の答えには 訳: が入っている）。
async function fetchGlossOnly(word, reading, ja, signal) {
  const raw = (await requestPrompt("gloss", buildGlossPrompt(word, reading, ja), signal))
    .trim()
    .replace(/^```(?:\w+)?\n?|\n?```$/g, "")
    .trim();
  const gloss = cleanGloss(raw);
  if (!gloss) throw new Error("empty");
  return gloss;
}

function setHelperEnVisible(shown) {
  helperEnShown = shown;
  const item = getActiveHelperItem();
  if (item) item.dict.enShown = shown;
  const hasEn = Boolean(helperEntry && helperEntry.en);
  helperEn.classList.toggle("visible", shown && hasEn);
  helperEnBtn.textContent = shown ? "英訳を隠す" : "英訳を表示";
}

// 訳語（語そのものの英語）: 読みの横に、読みと同じ色で小さく出す。
function setHelperGlossVisible(shown) {
  helperGlossShown = shown;
  const item = getActiveHelperItem();
  if (item) item.dict.glossShown = shown;
  const hasGloss = Boolean(helperEntry && helperEntry.gloss);
  helperGloss.classList.toggle("visible", shown && hasGloss);
  helperGlossBtn.textContent = shown ? "訳語を隠す" : "訳語を表示";
}

function clearHelperGloss() {
  helperGloss.textContent = "";
  helperGloss.classList.remove("visible");
  helperGlossBtn.classList.remove("visible");
  helperGlossBtn.disabled = false;
  helperGlossBtn.textContent = "訳語を表示";
}

// 読み【表記】: かなで引いたとき、定義した語の漢字を読みの後ろに（国語辞典の見出しの形）。
// 同音語: 同じ読みのほかの語。押すとその漢字の表記を辞書で引く（helperLookup を通すので待てモードも効く）。
// 見出し（辞書形）: 活用した形で引いたときは 読み【見出し】。かなで引いたときは 表記 が先（見出しの漢字）。
// 見出しがかなだけで読みと同じ（して → する）なら【】は出さない。
function dictHeadwordSpelling(entry) {
  if (!entry) return "";
  if (entry.spelling) return entry.spelling;
  if (entry.lemma && !sameHeadword(entry.lemma, entry.reading)) return entry.lemma;
  return "";
}

// 英訳・訳語に渡す語: 定義した語（表記 → 見出し → 入力の順）
function dictDefinedWord(entry, query) {
  return (entry && (entry.spelling || entry.lemma)) || query;
}

// 上の小さい Q（#helperWord）の横に、活用した形で引いたことを出す（疲れ果て 連用形）。
// #helperWord は paintHelperItem が毎回 Q だけに戻すので、ここでは足すだけ。
function renderDictInflection(entry) {
  const old = helperWord.querySelector(".helper-word-form");
  if (old) old.remove();
  if (!entry || !entry.lemma) return;
  const tag = document.createElement("span");
  tag.className = "helper-word-form";
  tag.textContent = entry.inflection || "活用形";
  tag.title = "「" + entry.lemma + "」の" + (entry.inflection || "活用した形") + "で調べました";
  helperWord.append(tag);
}

function renderDictHeadword(entry) {
  const spelling = dictHeadwordSpelling(entry);
  helperSpelling.textContent = spelling ? "【" + spelling + "】" : "";
  helperSpelling.title = !spelling ? "" : entry.spelling ? "かなで引いた語の漢字表記" : "辞書形（見出し）";
  renderDictInflection(entry);
  const homophones = (entry && Array.isArray(entry.homophones) && entry.homophones) || [];
  if (!homophones.length) {
    helperHomophones.replaceChildren();
    helperHomophones.classList.remove("visible");
    return;
  }
  const label = document.createElement("span");
  label.className = "homophones-label";
  label.textContent = "同音語";
  const list = document.createElement("span");
  list.className = "homophones-list";
  for (const word of homophones) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "homophone-btn";
    btn.textContent = word;
    btn.title = "「" + word + "」を辞書で調べる";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      helperLookup(word, { mode: "dict" });
    });
    list.append(btn);
  }
  helperHomophones.replaceChildren(label, list);
  helperHomophones.classList.add("visible");
}

function renderDictPending(text) {
  helperEntry = null;
  helperResult.classList.remove("error");
  renderDictHeadword(null);
  helperKana.textContent = text;
  helperDef.textContent = text;
  helperEn.textContent = "";
  helperEn.classList.remove("visible");
  helperEnBtn.classList.remove("visible");
  helperEnBtn.disabled = false;
  helperEnBtn.textContent = "英訳を表示";
  clearHelperGloss();
}

function renderDictError(message) {
  helperEntry = null;
  helperResult.classList.add("error");
  renderDictHeadword(null);
  helperKana.textContent = message;
  helperDef.textContent = "";
  helperEn.textContent = "";
  helperEn.classList.remove("visible");
  helperEnBtn.classList.remove("visible");
  helperEnBtn.disabled = false;
  clearHelperGloss();
}

// 定義の ①②③… を1義ずつ1行に分ける。番号より前の前置きがあれば、それも1行にする。
// 次に来るはずの番号（①の次は②）でだけ切るので、「①から転じて」のような本文中の参照では切れない。
const SENSE_MARK_FIRST = 0x2460; // ①

const SENSE_MARK_LAST = 0x2473;  // ⑳
const SENSE_TRIM_RE = /^[\s、,;；/／]+|[\s、,;；/／]+$/g;

// 〔新〕（新しい用法）も1行に分ける（表示は 新用法 のバッジ）。英訳では buildEnOnlyPrompt が "(newer usage)" に置き換える。
// 「③〔新〕…」のように番号のすぐ後ろにあるときは切らない（番号の行のまま）。
// 番号と 〔新〕 の間に使い方のラベルがあるとき（②〔俗語〕〔新〕…）や、行頭のラベルの後ろでも切らない。
const NEW_USAGE_SPLIT_RE = /(?<!(?:^|[①-⑳])(?:\s*〔[^〔〕\s]{1,10}〕)*\s*)(?=〔新〕|\(newer usage\))/i;

const NEW_USAGE_START_RE = /^(?:〔新〕|\(newer usage\))/i;

function splitSenses(text) {
  const s = String(text || "");
  const lines = [];
  let expected = SENSE_MARK_FIRST;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) !== expected || expected > SENSE_MARK_LAST) continue;
    lines.push(s.slice(start, i));
    start = i;
    expected++;
  }
  lines.push(s.slice(start));
  return lines
    .flatMap((line) => line.split(NEW_USAGE_SPLIT_RE))
    .map((line) => line.replace(SENSE_TRIM_RE, ""))
    .filter(Boolean);
}

function isSenseLine(line) {
  const c = line.charCodeAt(0);
  return c >= SENSE_MARK_FIRST && c <= SENSE_MARK_LAST;
}

function isNewUsageLine(line) {
  return NEW_USAGE_START_RE.test(line);
}

// 辞書の JA と英訳で使う。番号が2つ以上あるか 〔新〕 があるときだけ行に分け、それ以外は今までどおり1行。
function renderSenseLines(container, text) {
  const lines = splitSenses(text);
  const hasNewUsage = lines.length > 1 && lines.some(isNewUsageLine);
  if (lines.filter(isSenseLine).length < 2 && !hasNewUsage) {
    container.replaceChildren(...usageLineNodes(text || ""));
    return;
  }
  container.replaceChildren(
    ...lines.map((line) => {
      const row = document.createElement("div");
      row.className = isSenseLine(line)
        ? "def-sense"
        : isNewUsageLine(line)
          ? "def-sense def-new"
          : "def-sense def-lead";
      row.append(...usageLineNodes(line));
      return row;
    })
  );
}

// ── 使い方のラベル（〔新〕〔口語〕〔俗語〕…）────────────
// 辞書の JA に 〔ラベル〕 で入ってくる（prompts.js の buildFreeLookupPrompt が usageLabelPromptList を使う）。
// 表示はバッジ。①②③ のある行では番号のすぐ後ろ、ない行では定義の前に寄せる（文中・文末に書いてきても）。
// 並び順はこの配列の順（形容詞の BAGS のような決まった順）: 新 → 人を傷つける・下品 → 俗 → 話し言葉・書き言葉 → 古さ。
// まずはよく使うものだけ。足すときはここに1行（key がプロンプトに出る名前、text があればバッジはそちら、aliases はモデルが書きがちな別名）。
// tone は色: new（新しい用法）/ bad（相手を傷つける・下品）/ warn（俗）/ plain（ふつう）。vocab_clicker.css の .usage-badge[data-tone]。
// 〔新〕 はプロンプトでは別の指示（新しい用法・誤用とされる）で出させるので、usageLabelPromptList には入れない（inPrompt: false）。
// 行を分けるのも 〔新〕 の文字で（splitSenses）、バッジにするのはその後。
const USAGE_LABELS = [
  { key: "新", text: "新用法", en: "newer usage", tone: "new", inPrompt: false, aliases: ["新しい用法", "新用法"] },
  { key: "侮蔑", en: "derogatory / derisive", tone: "bad", desc: "derogatory or derisive", aliases: ["蔑", "軽蔑", "侮蔑語", "蔑称", "侮蔑的"] },
  { key: "卑語", en: "vulgar / rude", tone: "bad", desc: "vulgar or rude", aliases: ["卑", "卑俗", "下品", "卑語的"] },
  { key: "俗語", en: "slang", tone: "warn", desc: "slang", aliases: ["俗", "俗な言い方", "スラング"] },
  { key: "口語", en: "colloquial", tone: "plain", desc: "casual spoken language (くだけた言い方)", aliases: ["くだけた言い方", "くだけた表現", "くだけた", "話し言葉", "口"] },
  { key: "文章語", en: "literary / formal written", tone: "plain", desc: "literary or formal written language", aliases: ["文", "文語", "書き言葉", "雅語", "雅", "文章"] },
  { key: "古風", en: "dated / archaic", tone: "plain", desc: "old-fashioned or archaic", aliases: ["古", "古語", "古め", "古い言い方"] }
];

const USAGE_TAG_RE = /〔([^〔〕\s]{1,10})〕/g;

// 行頭の番号（①）は、バッジより前に残す
const USAGE_PREFIX_RE = /^(?:[①-⑳]\s*)?/;

function usageLabelPromptList() {
  return USAGE_LABELS.filter((l) => l.inPrompt !== false)
    .map((l) => "〔" + l.key + "〕 " + l.desc)
    .join(", ");
}

function findUsageLabel(name) {
  const s = String(name || "").trim();
  return USAGE_LABELS.find((l) => l.key === s || l.aliases.includes(s)) || null;
}

function usageBadge(label) {
  const badge = document.createElement("span");
  badge.className = "usage-badge";
  badge.dataset.usage = label.key;
  badge.dataset.tone = label.tone;
  badge.textContent = label.text || label.key;
  badge.title = label.en;
  return badge;
}

// 1行の定義を [番号, バッジ…（USAGE_LABELS の順）, 本文] のノードにする。知らない 〔…〕 は文字のまま。
function usageLineNodes(line) {
  const labels = [];
  const rest = String(line || "").replace(USAGE_TAG_RE, (m, name) => {
    const label = findUsageLabel(name);
    if (!label) return m;
    if (!labels.includes(label)) labels.push(label);
    return "";
  });
  if (!labels.length) return [document.createTextNode(rest)];
  labels.sort((a, b) => USAGE_LABELS.indexOf(a) - USAGE_LABELS.indexOf(b));
  const prefix = rest.match(USAGE_PREFIX_RE)[0];
  const body = rest.slice(prefix.length).replace(/^[\s、。]+/, "");
  const nodes = [];
  if (prefix) nodes.push(document.createTextNode(prefix));
  nodes.push(...labels.map(usageBadge));
  if (body) nodes.push(document.createTextNode(body));
  return nodes;
}

function renderDictEntry(entry, enShown, glossShown) {
  if (isSuggestionEntry(entry)) {
    helperEntry = null; // 英訳・訳語の対象にしない
    helperResult.classList.remove("error");
    renderDictHeadword(null);
    helperKana.textContent = "";
    renderSuggestion(helperDef, entry.suggestion, "dict");
    helperEn.textContent = "";
    helperEn.classList.remove("visible");
    helperEnBtn.classList.remove("visible");
    clearHelperGloss();
    return;
  }
  helperEntry = entry;
  helperResult.classList.remove("error");
  helperKana.textContent = entry.reading || "…";
  renderDictHeadword(entry);
  renderSenseLines(helperDef, entry.ja);
  renderSenseLines(helperEn, entry.en);
  const answered = Boolean(entry.reading && entry.ja);
  helperEnBtn.classList.toggle("visible", answered);
  helperEnBtn.disabled = false;
  setHelperEnVisible(Boolean(enShown) && Boolean(entry.en));
  helperGloss.textContent = entry.gloss || "";
  helperGlossBtn.classList.toggle("visible", answered);
  helperGlossBtn.disabled = false;
  setHelperGlossVisible(Boolean(glossShown) && Boolean(entry.gloss));
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
    // かなで引いた語は定義した語の漢字（表記）、活用した形で引いた語は辞書形（見出し）で渡す
    const en = await fetchEnOnly(dictDefinedWord(sourceEntry, query), sourceEntry.reading, sourceEntry.ja, controller.signal);
    if (requestId !== helperEnRequestId) return "";
    const next = { ...latestDictEntry(query, sourceEntry), en };
    dictCache[dictCacheKey(query, "")] = next;
    persistModeEntry("dict", query, next);
    const target = helperHistory.find((h) => h.id === targetId);
    if (target) target.dict.entry = next;
    if (helperActiveId === targetId) {
      helperEntry = next;
      renderSenseLines(helperEn, en);
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

// 英訳と訳語を同時に取りに行ったとき、あとから終わったほうが先の結果を消さないように、
// 同じ定義のままならキャッシュの最新の答えに足す。
function latestDictEntry(query, sourceEntry) {
  const latest = dictCache[dictCacheKey(query, "")];
  return latest && latest.ja === sourceEntry.ja ? latest : sourceEntry;
}

// 訳 のない保存済みの答えで「訳語を表示」を押したときだけ取る。取れたら英訳と同じく保存する。
async function ensureHelperGloss() {
  const item = getActiveHelperItem();
  if (!helperEntry || helperEntry.gloss) return helperEntry && helperEntry.gloss;
  const query = (item && item.query) || helperWord.textContent.trim();
  if (!query) return "";
  const sourceEntry = helperEntry;

  if (!hasApiKey() && !useProxy()) {
    helperGloss.textContent = "APIキーを設定してください";
    helperGloss.classList.add("visible");
    return "";
  }

  if (helperGlossAbort) helperGlossAbort.abort();
  const controller = new AbortController();
  helperGlossAbort = controller;
  const requestId = ++helperGlossRequestId;
  const targetId = item ? item.id : helperActiveId;
  helperGlossBtn.disabled = true;
  helperGloss.textContent = "…";
  helperGloss.classList.add("visible");

  try {
    const gloss = await fetchGlossOnly(dictDefinedWord(sourceEntry, query), sourceEntry.reading, sourceEntry.ja, controller.signal);
    if (requestId !== helperGlossRequestId) return "";
    const next = { ...latestDictEntry(query, sourceEntry), gloss };
    dictCache[dictCacheKey(query, "")] = next;
    persistModeEntry("dict", query, next);
    const target = helperHistory.find((h) => h.id === targetId);
    if (target) target.dict.entry = next;
    if (helperActiveId === targetId) {
      helperEntry = next;
      helperGloss.textContent = gloss;
      helperGlossBtn.disabled = false;
    }
    return gloss;
  } catch (err) {
    if (err?.name === "AbortError") return "";
    if (requestId !== helperGlossRequestId) return "";
    if (helperActiveId === targetId) {
      helperGloss.textContent = "訳語を読み込めませんでした";
      helperGlossBtn.disabled = false;
    }
    return "";
  } finally {
    if (helperGlossAbort === controller) helperGlossAbort = null;
  }
}

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

helperGlossBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (!helperEntry) return;
  if (helperGlossShown) {
    setHelperGlossVisible(false);
    return;
  }
  if (!helperEntry.gloss) {
    const gloss = await ensureHelperGloss();
    if (!gloss) return;
  }
  setHelperGlossVisible(true);
});
