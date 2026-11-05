// 類義語モード (thes): 似た語と反対の語。

const helperThesBlock = document.getElementById("helperThesBlock");
const helperSimilar = document.getElementById("helperSimilar");
const helperOpposite = document.getElementById("helperOpposite");

// 1行に何語も並べて、区切りを ; にしなかったときの救済。漢字辞典は今は1語1行で頼んでいるが、
// 類義語と、それ以前に保存された答えはこの形のことがある。形が合わないときは元の塊をそのまま返す。
//  ・｜ だけで続けた形（2026-10-20 荒）: 荒い｜あらい｜乱暴な、粗い｜荒れる｜あれる｜…
//  ・、 で区切った形（2026-10-20 任）: 責任｜せきにん｜義務、任せる｜まかせる｜…
//    間の要素は「前の語の意味、次の単語」なので最後の 、 で切る。
function isKanaReading(s) {
  return /^[ぁ-ゖァ-ヺー・]+$/.test(String(s || "").trim());
}

function splitRunOnEntries(part) {
  const bits = part.split(/[｜|]/);
  if (bits.length <= 3) return [part];
  if (bits.length % 3 === 0) {
    const entries = [];
    for (let i = 0; i < bits.length; i += 3) entries.push(bits.slice(i, i + 3));
    if (entries.every(([w, r]) => w.trim() && !/[、，,]/.test(w) && isKanaReading(r))) {
      return entries.map((e) => e.join("｜"));
    }
  }
  if (bits.length % 2 === 0) return [part];
  const entries = [];
  let word = bits[0];
  for (let i = 1; i < bits.length; i += 2) {
    const reading = bits[i];
    let gloss = bits[i + 1];
    let next = "";
    if (i + 2 < bits.length) {
      const cut = Math.max(gloss.lastIndexOf("、"), gloss.lastIndexOf("，"), gloss.lastIndexOf(","));
      if (cut < 0) return [part];
      next = gloss.slice(cut + 1);
      gloss = gloss.slice(0, cut);
    }
    entries.push([word, reading, gloss].join("｜"));
    word = next;
  }
  return entries;
}

function parseThesList(raw) {
  const text = stripWrappingQuotes(raw).trim();
  if (!text || isNoneList(text)) return [];
  const items = [];
  for (const part of text.split(/[;；]/).flatMap(splitRunOnEntries)) {
    const bits = part.split(/[｜|]/).map((p) => stripWrappingQuotes(p)).filter(Boolean);
    if (!bits.length || isNoneList(bits[0])) continue;
    if (!looksJapanese(bits[0])) continue;
    items.push({
      word: bits[0],
      reading: bits[1] || "",
      gloss: bits.slice(2).join("｜")
    });
  }
  return items;
}

function parseThesResponse(raw) {
  const text = raw.trim().replace(/^```(?:\w+)?\n?|\n?```$/g, "").trim();
  const pick = (re) => {
    const match = text.match(re);
    return match ? match[1].trim() : "";
  };
  let similarRaw = pick(/^\s*(?:類義語?|similar|synonyms?)\s*[:：]\s*(.+)$/im);
  let oppositeRaw = pick(/^\s*(?:対義語?|antonyms?|opposite)\s*[:：]\s*(.+)$/im);
  if (!similarRaw && !oppositeRaw) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    similarRaw = (lines[0] || "").replace(/^(?:類義語?|similar|synonyms?)\s*[:：]\s*/i, "");
    oppositeRaw = (lines[1] || "").replace(/^(?:対義語?|antonyms?|opposite)\s*[:：]\s*/i, "");
  }
  if (!similarRaw && !oppositeRaw) throw new Error("empty");
  const similar = parseThesList(similarRaw).slice(0, 6);
  const opposite = parseThesList(oppositeRaw).slice(0, 4);
  if (!similar.length && !opposite.length && !isNoneList(similarRaw) && !isNoneList(oppositeRaw)) {
    throw new Error("empty");
  }
  return { similar, opposite };
}

async function fetchThesEntry(query, context, signal) {
  return parseThesResponse(await requestPrompt("thes", buildThesPrompt(query, context), signal));
}

function renderThesList(container, words) {
  container.replaceChildren();
  if (!words.length) {
    const empty = document.createElement("span");
    empty.className = "thes-empty";
    empty.textContent = "なし";
    container.append(empty);
    return;
  }
  for (const entry of words) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thes-chip";
    const word = document.createElement("span");
    word.className = "thes-word";
    word.textContent = entry.word;
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
    const title = [entry.reading, entry.gloss].filter(Boolean).join(" ");
    if (title) btn.title = title;
    btn.addEventListener("click", () => {
      helperLookup(entry.word, {
        mode: "thes",
        context: { reading: entry.reading || "", meaning: entry.gloss || "" }
      });
    });
    container.append(btn);
  }
}

function renderThesPending(text) {
  helperResult.classList.remove("error");
  helperOpposite.replaceChildren();
  helperSimilar.replaceChildren();
  const note = document.createElement("span");
  note.className = "thes-empty";
  note.textContent = text;
  helperSimilar.append(note);
}

function renderThesError(message) {
  helperResult.classList.add("error");
  helperOpposite.replaceChildren();
  helperSimilar.replaceChildren();
  const note = document.createElement("span");
  note.className = "thes-empty";
  note.textContent = message;
  helperSimilar.append(note);
}

function renderThesEntry(entry) {
  helperResult.classList.remove("error");
  renderThesList(helperSimilar, (entry && entry.similar) || []);
  renderThesList(helperOpposite, (entry && entry.opposite) || []);
}
