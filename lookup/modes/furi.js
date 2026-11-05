// ふりがなモード (furi): 読みだけ（ルビ）。

const helperFuriBlock = document.getElementById("helperFuriBlock");
const helperFuriText = document.getElementById("helperFuriText");
const helperFuriReading = document.getElementById("helperFuriReading");
const helperFuriAlt = document.getElementById("helperFuriAlt");

// ふりがな: 読みだけ（prompts.js の buildFuriPrompt）。ルビ: は Q に {よみ} を足した形。
// entry: { ruby: [{ t, r? }], reading, alt: [] }。ruby が空なら Q をそのまま出す（かなだけの Q、またはモデルが Q を書き換えたとき）。
const FURI_RUBY_RE = /([\u3400-\u9fff\uf900-\ufaff々〆ヶ0-9０-９A-Za-zＡ-Ｚａ-ｚ]+)\{([^{}]*)\}/g;

function parseRubyLine(line) {
  const segs = [];
  const pushText = (raw) => {
    const t = raw.replace(/\{[^{}]*\}/g, ""); // かなの後ろなどに付いた余計な {…} は捨てる
    if (!t) return;
    const last = segs[segs.length - 1];
    if (last && !last.r) last.t += t;
    else segs.push({ t });
  };
  let at = 0;
  for (const m of line.matchAll(FURI_RUBY_RE)) {
    pushText(line.slice(at, m.index));
    const r = m[2].trim();
    if (r && r !== m[1]) segs.push({ t: m[1], r });
    else pushText(m[1]);
    at = m.index + m[0].length;
  }
  pushText(line.slice(at));
  return segs;
}

// ルビの本文が Q と同じか。空白と全角・半角の差は見ない。
function sameFuriText(a, b) {
  const key = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "");
  return key(a) === key(b);
}

function parseFuriResponse(raw, query) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
  const rubyRaw = stripWrappingQuotes(pick(/^\s*(?:ルビ|ruby)\s*[:：]\s*(.+)$/im));
  const altRaw = stripWrappingQuotes(pick(/^\s*(?:別|ほかの読み|other)\s*[:：]\s*(.+)$/im));
  let reading = stripWrappingQuotes(pick(/^\s*(?:読み(?:方)?|よみ|reading)\s*[:：]\s*(.+)$/im));
  const segs = rubyRaw ? parseRubyLine(rubyRaw) : [];
  if (!reading && segs.length) reading = segs.map((s) => s.r || s.t).join("");
  if (!reading) throw new Error("empty");
  const ruby = segs.some((s) => s.r) && sameFuriText(segs.map((s) => s.t).join(""), query) ? segs : [];
  const alt = isNoneList(altRaw) ? [] : splitReadings(altRaw).filter((r) => r !== reading);
  return { ruby, reading, alt };
}

async function fetchFuriEntry(query, signal) {
  return parseFuriResponse(await requestPrompt("furi", buildFuriPrompt(query), signal), query);
}

// ふりがな: 入力をそのまま大きく出し、漢字に <ruby> で読みを付ける。
// 全体の読み（クリックでコピー）は、ルビが付かなかったときだけ下に出す。
function renderFuriMessage(text) {
  helperFuriText.textContent = text;
  helperFuriReading.textContent = "";
  helperFuriAlt.textContent = "";
}

function renderFuriPending(text) {
  helperResult.classList.remove("error");
  renderFuriMessage(text);
}

function renderFuriError(message) {
  helperResult.classList.add("error");
  renderFuriMessage(message);
}

function renderFuriEntry(entry, query) {
  helperResult.classList.remove("error");
  helperFuriText.replaceChildren();
  const hasRuby = !!(entry && entry.ruby && entry.ruby.length);
  const segs = hasRuby ? entry.ruby : [{ t: query }];
  for (const s of segs) {
    if (!s.r) {
      helperFuriText.append(document.createTextNode(s.t));
      continue;
    }
    const ruby = document.createElement("ruby");
    const rt = document.createElement("rt");
    rt.textContent = s.r;
    ruby.append(document.createTextNode(s.t), rt);
    helperFuriText.append(ruby);
  }
  helperFuriReading.textContent = hasRuby ? "" : (entry && entry.reading) || "";
  const alt = (entry && entry.alt) || [];
  helperFuriAlt.textContent = alt.length ? "ほかの読み：" + alt.join("、") : "";
}

const FURI_INPUT_PLACEHOLDER = "語・フレーズ・文（読みだけ）";

helperFuriReading.addEventListener("click", async () => {
  const text = helperFuriReading.textContent.trim();
  if (!text || text === "コピーしました" || helperResult.classList.contains("error")) return;
  try {
    await navigator.clipboard.writeText(text);
    helperFuriReading.textContent = "コピーしました";
    setTimeout(() => {
      if (helperFuriReading.textContent === "コピーしました") helperFuriReading.textContent = text;
    }, 900);
  } catch {
    /* ignore */
  }
});
