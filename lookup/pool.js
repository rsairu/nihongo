// 待てモードの「あとで」（プール）。お休み中に入力した語は調べずにここへためる。
// お休みが終わったら「おすすめを選ぶ」で Opus が1語だけ選ぶ（buildPoolPickPrompt）。調べ方を選んで語を押すと調べる。
// 何かを調べる（＝次のお休みが始まる）と、残りの語は捨てる。毎回からっぽから始める。
// lookup/settings.js より前に読み込む（settings.js の最後の setReadingMode がここの syncPoolWaiting を呼ぶ）。
// ここの関数は readingCooldownLeft など settings.js の名前を使うが、呼ばれるのは settings.js を読み込んだあと。

const POOL_STORAGE_KEY = "vocab-clicker-reading-pool";
const POOL_AUTO_STORAGE_KEY = "vocab-clicker-reading-pool-auto";
const POOL_MAX = 12;
const helperPoolEl = document.getElementById("helperPool");
const helperPoolLabel = document.getElementById("helperPoolLabel");
const helperPoolList = document.getElementById("helperPoolList");
const helperPoolPickBtn = document.getElementById("helperPoolPickBtn");
const helperPoolNote = document.getElementById("helperPoolNote");
const poolAutoToggle = document.getElementById("poolAutoToggle");
const poolAutoRow = document.getElementById("poolAutoRow");

let poolWords = []; // 入れた順
let poolPick = ""; // おすすめの語（poolWords のどれか）。語を足したり消したりしたら選び直し
let poolAuto = false; // ⚙ おすすめを自動で選ぶ
let poolPicking = false;
let poolPickAbort = null;
let poolError = "";
let poolWaiting = null; // 前回 syncPoolWaiting に来た「お休み中か」。変わったときだけ描き直す
let poolStash = null; // 調べ始めたときに捨てた語。その調べものが もしかして で終わったら戻す

function savePool() {
  try {
    if (poolWords.length) localStorage.setItem(POOL_STORAGE_KEY, JSON.stringify({ words: poolWords, pick: poolPick }));
    else localStorage.removeItem(POOL_STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
}

function loadPool(raw) {
  poolWords = [];
  poolPick = "";
  try {
    const saved = JSON.parse(raw || "null");
    if (saved && Array.isArray(saved.words)) {
      poolWords = [...new Set(saved.words.map((w) => String(w || "").trim()).filter(Boolean))].slice(0, POOL_MAX);
      if (poolWords.includes(saved.pick)) poolPick = saved.pick;
    }
  } catch (_) {
    /* ignore */
  }
}

function stopPoolPick() {
  if (poolPickAbort) poolPickAbort.abort();
  poolPickAbort = null;
  poolPicking = false;
}

// お休み中に入力した語を入れる。入った（またはもう入っている）ら true。いっぱいなら false（呼び出し側は入力を消さない）
function addPoolWord(text) {
  const word = String(text || "").replace(/[\r\n]+/g, "").trim();
  if (!word) return false;
  if (poolWords.includes(word)) {
    renderPool();
    flashPoolChip(word);
    return true;
  }
  if (poolWords.length >= POOL_MAX) {
    poolError = `「あとで」は ${POOL_MAX} 語までです`;
    renderPool();
    restartAnimation(helperPoolEl, "reading-nudge");
    return false;
  }
  stopPoolPick();
  poolWords.push(word);
  poolPick = "";
  poolError = "";
  savePool();
  renderPool();
  flashPoolChip(word);
  return true;
}

function removePoolWord(word) {
  if (!poolWords.includes(word)) return;
  stopPoolPick();
  poolWords = poolWords.filter((w) => w !== word);
  // おすすめを消したら残りから選び直し。ほかの語を消しただけなら、おすすめはそのまま
  if (poolPick === word) poolPick = "";
  poolError = "";
  savePool();
  renderPool();
}

// 新しく調べ始めるとき（helperLookup）: 残りの語は捨てる。もしかして で終わったら restorePoolRound が戻す
function clearPoolForRound(lookedUp) {
  poolStash = poolWords.length ? { words: poolWords.filter((w) => w !== lookedUp), pick: poolPick } : null;
  if (!poolWords.length) return;
  stopPoolPick();
  poolWords = [];
  poolPick = "";
  poolError = "";
  savePool();
  renderPool();
}

// releaseReadingCooldown から: 打ちまちがいで休みが取り消されたので、捨てた語を戻す
function restorePoolRound() {
  const stash = poolStash;
  poolStash = null;
  if (!stash || !stash.words.length || poolWords.length) return;
  poolWords = stash.words;
  poolPick = poolWords.includes(stash.pick) ? stash.pick : "";
  savePool();
  renderPool();
}

function flashPoolChip(word) {
  if (!helperPoolList) return;
  for (const chip of helperPoolList.children) {
    if (chip.dataset.word === word) restartAnimation(chip, "pool-added");
  }
}

// 1語だけなら選ぶまでもないので、お休みが終わったらその語がおすすめ（API は呼ばない）
function currentPoolPick(waiting) {
  if (poolPick) return poolPick;
  return !waiting && poolWords.length === 1 ? poolWords[0] : "";
}

function renderPool() {
  if (!helperPoolEl) return;
  const waiting = readingCooldownLeft() > 0;
  helperPoolEl.hidden = poolWords.length === 0;
  helperPoolEl.classList.toggle("is-waiting", waiting);
  if (helperPoolLabel) {
    helperPoolLabel.title = waiting
      ? "待てモードのお休み中に入れた語。お休みが終わったら、ここから選んで調べます"
      : "調べ方を選んでから語を押すと調べます（残りの語は消えます）";
  }
  const pick = currentPoolPick(waiting);
  helperPoolList.replaceChildren();
  for (const word of poolWords) {
    const chip = document.createElement("span");
    chip.className = "pool-chip" + (word === pick ? " is-pick" : "");
    chip.dataset.word = word;
    chip.setAttribute("role", "listitem");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pool-word";
    const label = document.createElement("span");
    label.className = "pool-word-label";
    label.textContent = word;
    btn.append(label);
    if (waiting) {
      btn.setAttribute("aria-disabled", "true");
      btn.title = `「${word}」: お休みが終わったら調べられます`;
    } else {
      btn.title = (word === pick ? "おすすめ: " : "") + `「${word}」を選択中の調べ方で調べる`;
    }
    // お休み中に押しても helperLookup が止める（調べるボタンが揺れる）
    btn.addEventListener("click", () => helperLookup(word));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "pool-remove";
    remove.textContent = "×";
    remove.title = `「${word}」を「あとで」から消す`;
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", () => removePoolWord(word));

    chip.append(btn, remove);
    helperPoolList.append(chip);
  }
  if (helperPoolPickBtn) {
    helperPoolPickBtn.hidden = waiting || poolWords.length < 2 || Boolean(poolPick);
    helperPoolPickBtn.disabled = poolPicking;
    helperPoolPickBtn.textContent = poolPicking ? "選んでいます…" : "おすすめを選ぶ";
  }
  if (helperPoolNote) {
    helperPoolNote.textContent = poolError;
    helperPoolNote.hidden = !poolError;
  }
}

// 返事は「選: 番号」の1行（buildPoolPickPrompt）。番号が読めないときは、返事に書かれた語をさがす
function parsePoolPick(text, words) {
  const raw = String(text || "");
  const labeled = raw.match(/選\s*[:：]\s*([0-9０-９]+)/) || raw.match(/([0-9０-９]+)/);
  if (labeled) {
    const n = Number(labeled[1].replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)));
    if (n >= 1 && n <= words.length) return words[n - 1];
  }
  // 長い語から見る（短い語が長い語の一部のとき）
  return [...words].sort((a, b) => b.length - a.length).find((w) => raw.includes(w)) || "";
}

// Opus に「いま1語だけ調べるならどれか」を選んでもらう。答えはピルの色で示すだけで、調べるのは押したとき。
async function pickPoolWord() {
  if (poolPicking || poolWords.length < 2 || readingCooldownLeft() > 0) return;
  const words = poolWords.slice();
  const abort = new AbortController();
  poolPickAbort = abort;
  poolPicking = true;
  poolError = "";
  renderPool();
  try {
    const text = await requestPrompt("pool", buildPoolPickPrompt(words), abort.signal);
    if (poolPickAbort !== abort) return; // その間に語が変わった
    const pick = parsePoolPick(text, words);
    if (!pick) throw new Error("no pick");
    poolPick = pick;
    savePool();
  } catch (err) {
    if (poolPickAbort !== abort) return;
    poolError = "おすすめを選べませんでした";
  }
  poolPickAbort = null;
  poolPicking = false;
  renderPool();
}

// ⚙ おすすめを自動で選ぶ: お休みが終わったときに押さなくても選ぶ。裏のタブでは呼ばない（見えているタブが呼ぶ）
function maybeAutoPickPool() {
  if (!poolAuto || document.hidden || poolPick || poolPicking) return;
  if (poolWords.length < 2 || readingCooldownLeft() > 0) return;
  pickPoolWord();
}

// renderReadingCooldown から毎回呼ばれる。お休みの始まり・終わりでだけ描き直す
function syncPoolWaiting(waiting) {
  if (waiting === poolWaiting) return;
  poolWaiting = waiting;
  renderPool();
  if (!waiting) maybeAutoPickPool();
}

function setPoolAuto(enabled, save) {
  poolAuto = Boolean(enabled);
  if (poolAutoToggle) poolAutoToggle.checked = poolAuto;
  if (save) {
    try {
      localStorage.setItem(POOL_AUTO_STORAGE_KEY, poolAuto ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
    maybeAutoPickPool();
  }
}

if (helperPoolPickBtn) helperPoolPickBtn.addEventListener("click", pickPoolWord);

if (poolAutoToggle) poolAutoToggle.addEventListener("change", () => setPoolAuto(poolAutoToggle.checked, true));

document.addEventListener("visibilitychange", maybeAutoPickPool);

// もう一方のページ（別タブ）と同じプールを使う
window.addEventListener("storage", (e) => {
  if (e.key === POOL_STORAGE_KEY) {
    stopPoolPick();
    loadPool(e.newValue);
    renderPool();
  } else if (e.key === POOL_AUTO_STORAGE_KEY) {
    setPoolAuto(e.newValue === "1", false);
  }
});

try {
  loadPool(localStorage.getItem(POOL_STORAGE_KEY));
  setPoolAuto(localStorage.getItem(POOL_AUTO_STORAGE_KEY) === "1", false);
} catch (_) {
  /* ignore */
}
