// 辞書モード (dict): 定義・読み・訳語・英訳。

const helperDictBlock = document.getElementById("helperDictBlock");
const helperKana = document.getElementById("helperKana");
const helperDef = document.getElementById("helperDef");
const helperEn = document.getElementById("helperEn");
const helperEnBtn = document.getElementById("helperEnBtn");
const helperGloss = document.getElementById("helperGloss");
const helperGlossBtn = document.getElementById("helperGlossBtn");

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
    // 候補: なし と 訳: の行は位置で読むときに数えない（読み・JA がずれないように）
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !SUGGESTION_LINE_RE.test(l) && !GLOSS_LINE_RE.test(l));
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
  return gloss ? { reading, ja, en, gloss } : { reading, ja, en };
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
  clearHelperGloss();
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
  clearHelperGloss();
}

// 定義の ①②③… を1義ずつ1行に分ける。番号より前の前置きがあれば、それも1行にする。
// 次に来るはずの番号（①の次は②）でだけ切るので、「①から転じて」のような本文中の参照では切れない。
const SENSE_MARK_FIRST = 0x2460; // ①

const SENSE_MARK_LAST = 0x2473;  // ⑳
const SENSE_TRIM_RE = /^[\s、,;；/／]+|[\s、,;；/／]+$/g;

// 〔新〕（新しい用法）も1行に分ける。英訳では buildEnOnlyPrompt が "(newer usage)" に置き換える。
// 「③〔新〕…」のように番号のすぐ後ろにあるときは切らない（番号の行のまま）。
const NEW_USAGE_SPLIT_RE = /(?<![①-⑳]\s*)(?=〔新〕|\(newer usage\))/i;

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
    container.textContent = text || "";
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
      row.textContent = line;
      return row;
    })
  );
}

function renderDictEntry(entry, enShown, glossShown) {
  if (isSuggestionEntry(entry)) {
    helperEntry = null; // 英訳・訳語の対象にしない
    helperResult.classList.remove("error");
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
    const en = await fetchEnOnly(query, sourceEntry.reading, sourceEntry.ja, controller.signal);
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
    const gloss = await fetchGlossOnly(query, sourceEntry.reading, sourceEntry.ja, controller.signal);
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
