// 漢字表記モード (kanji): 漢字で書くか、かなで書くか。

const helperKanjiBlock = document.getElementById("helperKanjiBlock");
const helperKanjiForm = document.getElementById("helperKanjiForm");
const helperKanjiMeter = document.getElementById("helperKanjiMeter");
const helperKanjiLabel = document.getElementById("helperKanjiLabel");
const helperKanjiNote = document.getElementById("helperKanjiNote");
const KANJI_USAGE_LABELS = ["なし", "まれ", "かな優先", "どちらも", "漢字優先"];
const KANJI_METER_STEPS = 4;

function parseKanjiResponse(raw, query) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const suggestion = parseSuggestion(text, query);
  if (suggestion) return { suggestion };
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

async function fetchKanjiUsage(query, context, signal) {
  return parseKanjiResponse(
    await requestPrompt("kanji", buildKanjiPrompt(query, context), signal),
    query
  );
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
  if (isSuggestionEntry(entry)) {
    helperKanjiForm.textContent = "";
    helperKanjiMeter.replaceChildren();
    helperKanjiMeter.removeAttribute("aria-label");
    helperKanjiLabel.textContent = "";
    renderSuggestion(helperKanjiNote, entry.suggestion, "kanji");
    return;
  }
  helperKanjiForm.textContent = entry.form || "漢字表記なし";
  renderKanjiMeter(entry.usage, entry.label);
  helperKanjiLabel.textContent = entry.label;
  helperKanjiNote.textContent = entry.note || "";
}
