// ⚙ 設定メニュー: 文字の大きさ・アイコンだけ表示・小6モード・待てモード。どれも localStorage に保存。

const FONT_SCALE_STORAGE_KEY = "vocab-clicker-font-scale";
const GAKUSEI_STORAGE_KEY = "vocab-clicker-gakusei-mode";
const READING_MODE_STORAGE_KEY = "vocab-clicker-reading-mode";
const READING_SECONDS_STORAGE_KEY = "vocab-clicker-reading-seconds";
const READING_UNTIL_STORAGE_KEY = "vocab-clicker-reading-until";
const MODE_LABELS_HIDDEN_STORAGE_KEY = "vocab-clicker-mode-labels-hidden";
const READING_SECONDS_DEFAULT = 180;
const READING_SECONDS_MIN = 1;
const READING_SECONDS_MAX = 3600;
const FONT_SCALE_MIN = 0.8;
const FONT_SCALE_MAX = 1.6;
const FONT_SCALE_STEP = 0.1;
const FONT_SCALE_DEFAULT = 1;
const fontDecBtn = document.getElementById("fontDecBtn");
const fontIncBtn = document.getElementById("fontIncBtn");
const fontResetBtn = document.getElementById("fontResetBtn");
const gakuseiBtn = document.getElementById("gakuseiBtn"); // ⚙ メニューの中のスイッチ (checkbox)
const gakuseiRow = document.getElementById("gakuseiRow");

// ⚙ 設定メニュー（ドロップダウン）: 文字の大きさ・アイコンだけ表示・小6モード・待てモード。どれも localStorage に保存。
const settingsWrap = document.getElementById("settings");

const settingsBtn = document.getElementById("settingsBtn");
const settingsMenu = document.getElementById("settingsMenu");
const readingModeToggle = document.getElementById("readingModeToggle");
const readingSecondsInput = document.getElementById("readingSecondsInput");
const readingSecondsRow = document.getElementById("readingSecondsRow");

// アイコンだけ表示: lookup.html のモードタブの文字を消す（クリッカーでは行が hidden）
const modeLabelsToggle = document.getElementById("modeLabelsToggle");

// 待てモード (⚙ メニュー): 調べたあと readingSeconds 秒は新しく調べられない（調べるボタンがグレーになる）。
// 休み中に入力した語は「あとで」にたまる（lookup/pool.js）。
// 辞書に頼らず読み続けるため。履歴タブを開き直す・英訳・例文の作り直しは止めない。
let readingMode = false;

let readingSeconds = READING_SECONDS_DEFAULT;
let readingUntil = 0; // この時刻 (ms) まで休み
let readingSpan = 0; // 今回の休みの長さ (ms)。ボタンの残りゲージ用
let readingCooldownOwner = null; // { itemId, mode, until }: 今の休みを始めた調べもの（startReadingCooldown）
let readingTimer = 0;

/** @type {Record<string, {ja: string, en: string}[]>} */
// 小6モード (gakusei_mode): 返ってくる説明をすべて小学6年生レベルにする。レベルごとにキャッシュを分ける。
let gakuseiMode = false;

// 小6モードの切り替え。レベルを変えたら表示中の結果を捨てて、そのレベルのキャッシュから（なければ取得し直して）出す。
// html.gakusei-mode で ⚙ に 🎓 バッジが付く（メニューを閉じていてもオンだとわかる）
function renderGakuseiBtn() {
  document.documentElement.classList.toggle("gakusei-mode", gakuseiMode);
  if (gakuseiBtn) gakuseiBtn.checked = gakuseiMode;
  if (gakuseiRow) gakuseiRow.classList.toggle("gakusei-on", gakuseiMode);
  renderSettingsBtn();
}

function setGakuseiMode(enabled, save) {
  const next = Boolean(enabled);
  if (save) {
    try {
      localStorage.setItem(GAKUSEI_STORAGE_KEY, next ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
  }
  if (next === gakuseiMode) {
    renderGakuseiBtn();
    return;
  }
  gakuseiMode = next;
  const bank = gakuseiMode ? cacheBanks.gakusei : cacheBanks.standard;
  sentenceCache = bank.sentence;
  dictCache = bank.dict;
  kanjiCache = bank.kanji;
  thesCache = bank.thes;
  jitenCache = bank.jiten;
  cmpCache = bank.cmp;
  furiCache = bank.furi;
  iimawashiCache = bank.iimawashi;
  renderGakuseiBtn();

  if (helperEnAbort) helperEnAbort.abort();
  helperEnAbort = null;
  if (helperGlossAbort) helperGlossAbort.abort();
  helperGlossAbort = null;
  helperEntry = null;
  for (const item of helperHistory) {
    abortHelperItem(item);
    for (const mode of HELPER_MODES) {
      const st = modeState(item, mode);
      st.entry = null;
      st.error = "";
      st.enShown = false;
      st.glossShown = false;
      st.fetchId++;
    }
  }
  const active = getActiveHelperItem();
  if (active && helperResult.classList.contains("visible") && !handwritingOpen) {
    paintHelperItem(active);
    runHelperFetch(active, helperMode);
  } else {
    renderHelperTabs();
  }
}

function loadGakuseiMode() {
  try {
    return localStorage.getItem(GAKUSEI_STORAGE_KEY) === "1";
  } catch (_) {
    return false;
  }
}

// ONにしたときだけ小さなトーストでほめる（読み込み時・他タブとの同期では出さない）
const GAKUSEI_CHEERS = [
  "やさしい言葉で説明するよ。いっしょにがんばろう！",
  "いいね！わかるところから、少しずつ。",
  "ナイス！読めた言葉がどんどんふえるよ。",
  "その調子！むずかしい言葉も、かんたんに。"
];

let gakuseiToastEl = null;
let gakuseiToastTimer = 0;
let gakuseiCheerIndex = -1;

function showGakuseiToast() {
  if (!gakuseiToastEl) {
    gakuseiToastEl = document.createElement("div");
    gakuseiToastEl.className = "gakusei-toast";
    gakuseiToastEl.setAttribute("role", "status");
    gakuseiToastEl.setAttribute("aria-live", "polite");
    gakuseiToastEl.innerHTML =
      '<span class="gakusei-toast-cap" aria-hidden="true">🎓</span>' +
      '<span class="gakusei-toast-text"><strong>小6モード ON</strong><span class="gakusei-toast-cheer"></span></span>';
    gakuseiToastEl.addEventListener("click", hideGakuseiToast);
    document.body.append(gakuseiToastEl);
  }
  gakuseiCheerIndex = (gakuseiCheerIndex + 1 + Math.floor(Math.random() * (GAKUSEI_CHEERS.length - 1))) % GAKUSEI_CHEERS.length;
  gakuseiToastEl.querySelector(".gakusei-toast-cheer").textContent = GAKUSEI_CHEERS[gakuseiCheerIndex];
  gakuseiToastEl.classList.remove("show");
  void gakuseiToastEl.offsetWidth; // 連打してもアニメーションをやり直す
  gakuseiToastEl.classList.add("show");
  clearTimeout(gakuseiToastTimer);
  gakuseiToastTimer = setTimeout(hideGakuseiToast, 2600);
}

function hideGakuseiToast() {
  clearTimeout(gakuseiToastTimer);
  if (gakuseiToastEl) gakuseiToastEl.classList.remove("show");
}

if (gakuseiBtn) {
  gakuseiBtn.addEventListener("change", () => {
    setGakuseiMode(gakuseiBtn.checked, true);
    if (gakuseiMode) {
      showGakuseiToast();
      if (gakuseiRow) {
        gakuseiRow.classList.remove("gakusei-pop");
        void gakuseiRow.offsetWidth;
        gakuseiRow.classList.add("gakusei-pop");
      }
    } else {
      hideGakuseiToast();
    }
  });
}

window.addEventListener("storage", (e) => {
  if (e.key === GAKUSEI_STORAGE_KEY) setGakuseiMode(e.newValue === "1", false);
});

setGakuseiMode(loadGakuseiMode(), false);

// 文字サイズ: html の font-size を倍率で変える（rem 指定の要素がまとめて拡大縮小）。両ページで共有して保存。
function clampFontScale(scale) {
  const n = Number(scale);
  if (!Number.isFinite(n)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(n * 10) / 10));
}

let fontScale = FONT_SCALE_DEFAULT;

function applyFontScale(scale, save) {
  fontScale = clampFontScale(scale);
  document.documentElement.style.fontSize = fontScale === FONT_SCALE_DEFAULT ? "" : fontScale * 100 + "%";
  if (fontResetBtn) {
    fontResetBtn.textContent = Math.round(fontScale * 100) + "%";
    fontResetBtn.classList.toggle("is-default", fontScale === FONT_SCALE_DEFAULT);
  }
  if (fontDecBtn) fontDecBtn.disabled = fontScale <= FONT_SCALE_MIN;
  if (fontIncBtn) fontIncBtn.disabled = fontScale >= FONT_SCALE_MAX;
  if (save) {
    try {
      localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(fontScale));
    } catch (_) {
      /* ignore */
    }
  }
  requestAnimationFrame(updateHelperHistoryScroll);
}

function loadFontScale() {
  try {
    const saved = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
    if (saved != null) return clampFontScale(saved);
  } catch (_) {
    /* ignore */
  }
  return FONT_SCALE_DEFAULT;
}

if (fontDecBtn) fontDecBtn.addEventListener("click", () => applyFontScale(fontScale - FONT_SCALE_STEP, true));

if (fontIncBtn) fontIncBtn.addEventListener("click", () => applyFontScale(fontScale + FONT_SCALE_STEP, true));

if (fontResetBtn) fontResetBtn.addEventListener("click", () => applyFontScale(FONT_SCALE_DEFAULT, true));

// 他のタブで変えたら追従
window.addEventListener("storage", (e) => {
  if (e.key === FONT_SCALE_STORAGE_KEY) applyFontScale(e.newValue, false);
});

applyFontScale(loadFontScale(), false);

// アイコンだけ表示。html.mode-labels-hidden でモードタブの文字を消す（lookup.css）。localStorage のみ
function setModeLabelsHidden(hidden, save) {
  const on = Boolean(hidden);
  document.documentElement.classList.toggle("mode-labels-hidden", on);
  if (modeLabelsToggle) modeLabelsToggle.checked = on;
  if (save) {
    try {
      localStorage.setItem(MODE_LABELS_HIDDEN_STORAGE_KEY, on ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
  }
}

if (modeLabelsToggle) modeLabelsToggle.addEventListener("change", () => setModeLabelsHidden(modeLabelsToggle.checked, true));

window.addEventListener("storage", (e) => {
  if (e.key === MODE_LABELS_HIDDEN_STORAGE_KEY) setModeLabelsHidden(e.newValue === "1", false);
});

try {
  setModeLabelsHidden(localStorage.getItem(MODE_LABELS_HIDDEN_STORAGE_KEY) === "1", false);
} catch (_) {
  /* ignore */
}

// 待てモード。設定と休みの終わりの時刻は両ページで共有して localStorage に保存（DB には書かない）。
function clampReadingSeconds(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return READING_SECONDS_DEFAULT;
  return Math.min(READING_SECONDS_MAX, Math.max(READING_SECONDS_MIN, n));
}

function readingCooldownLeft() {
  return readingMode ? Math.max(0, readingUntil - Date.now()) : 0;
}

function restartAnimation(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

// 休み中なら調べるボタンを揺らして true を返す（呼び出し側はそこで止める）
function readingBlocked() {
  if (readingCooldownLeft() <= 0) return false;
  restartAnimation(helperBtn, "reading-nudge");
  if (handwritingOpen) restartAnimation(handwritingDraftLookupBtn, "reading-nudge");
  return true;
}

function saveReadingUntil() {
  try {
    if (readingUntil > Date.now()) localStorage.setItem(READING_UNTIL_STORAGE_KEY, JSON.stringify({ until: readingUntil, span: readingSpan }));
    else localStorage.removeItem(READING_UNTIL_STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
}

function loadReadingUntil(raw) {
  readingUntil = 0;
  readingSpan = 0;
  try {
    const saved = JSON.parse(raw || "null");
    if (saved && Number(saved.until) > Date.now()) {
      readingUntil = Number(saved.until);
      readingSpan = Number(saved.span) || readingUntil - Date.now();
    }
  } catch (_) {
    /* ignore */
  }
}

// owner = { itemId, mode }: この休みを始めた調べもの。もしかして で終わったら releaseReadingCooldown が取り消す。
function startReadingCooldown(owner) {
  if (!readingMode) return;
  readingSpan = readingSeconds * 1000;
  readingUntil = Date.now() + readingSpan;
  readingCooldownOwner = owner ? { ...owner, until: readingUntil } : null;
  saveReadingUntil();
  renderReadingCooldown();
}

// 打ちまちがい（答えが もしかして だけ）は読むものがないので休みに数えない。
// 取り消すのは、その調べもので始まった休みだけ（別の語の休みや、他のタブで始まった休みはそのまま）。
function releaseReadingCooldown(itemId, mode) {
  const o = readingCooldownOwner;
  if (!o || o.itemId !== itemId || o.mode !== mode || o.until !== readingUntil) return;
  readingCooldownOwner = null;
  readingUntil = 0;
  readingSpan = 0;
  saveReadingUntil();
  renderReadingCooldown();
  restorePoolRound(); // 調べ始めたときに捨てた「あとで」の語を戻す
}

// 調べるボタン（入力欄の横と手書きの下書き）をグレーにして、残り秒数とゲージを出す。
// 休み中のボタンは「あとで」になり、押すと入力した語を「あとで」（lookup/pool.js）に入れる。
function renderReadingCooldown() {
  const left = readingCooldownLeft();
  const waiting = left > 0;
  syncPoolWaiting(waiting);
  const secs = Math.ceil(left / 1000);
  const pct = waiting && readingSpan > 0 ? Math.min(100, (left / readingSpan) * 100) : 0;
  for (const btn of [helperBtn, handwritingDraftLookupBtn]) {
    if (!btn) continue;
    if (!("baseTitle" in btn.dataset)) btn.dataset.baseTitle = btn.getAttribute("title") || "";
    if (!("baseText" in btn.dataset)) btn.dataset.baseText = btn.textContent;
    btn.classList.toggle("reading-wait", waiting);
    const text = waiting ? "あとで" : btn.dataset.baseText;
    if (btn.textContent !== text) btn.textContent = text;
    if (waiting) {
      btn.dataset.wait = String(secs);
      btn.style.setProperty("--reading-left", pct.toFixed(1) + "%");
      btn.title = `待てモード: あと ${secs} 秒で調べられます。押すと「あとで」に入れておけます`;
    } else {
      delete btn.dataset.wait;
      btn.style.removeProperty("--reading-left");
      if (btn.dataset.baseTitle) btn.title = btn.dataset.baseTitle;
      else btn.removeAttribute("title");
    }
  }
  if (waiting && !readingTimer) {
    readingTimer = setInterval(renderReadingCooldown, 200);
  } else if (!waiting && readingTimer) {
    clearInterval(readingTimer);
    readingTimer = 0;
    // 時間切れで戻ったときだけ、また調べられることを軽く知らせる（オフにしたときは出さない）
    if (readingMode) restartAnimation(helperBtn, "reading-ready");
  }
}

function renderReadingSettings() {
  if (readingModeToggle) readingModeToggle.checked = readingMode;
  if (readingSecondsInput && document.activeElement !== readingSecondsInput) readingSecondsInput.value = String(readingSeconds);
  if (readingSecondsRow) readingSecondsRow.classList.toggle("is-off", !readingMode);
  if (poolAutoRow) poolAutoRow.classList.toggle("is-off", !readingMode);
  renderSettingsBtn();
}

// ⚙ の見た目: 待てモード中は ⏳ バッジ、小6モード中は 🎓 バッジ（CSS, html.reading-mode / html.gakusei-mode）。title にオンの項目を並べる
function renderSettingsBtn() {
  if (!settingsBtn) return;
  document.documentElement.classList.toggle("reading-mode", readingMode);
  const on = [];
  if (gakuseiMode) on.push("小6モード");
  if (readingMode) on.push(`待てモード ${readingSeconds} 秒`);
  settingsBtn.title = on.length ? `設定（${on.join("・")}）` : "設定";
}

function setReadingMode(enabled, save) {
  readingMode = Boolean(enabled);
  if (!readingMode) {
    readingUntil = 0;
    readingSpan = 0;
  }
  if (save) {
    try {
      localStorage.setItem(READING_MODE_STORAGE_KEY, readingMode ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
    if (!readingMode) saveReadingUntil();
  }
  renderReadingSettings();
  renderReadingCooldown();
}

// 秒数を変えても、いまの休みはそのまま。次に調べたときから新しい秒数
function setReadingSeconds(value, save) {
  readingSeconds = clampReadingSeconds(value);
  if (save) {
    try {
      localStorage.setItem(READING_SECONDS_STORAGE_KEY, String(readingSeconds));
    } catch (_) {
      /* ignore */
    }
  }
  renderReadingSettings();
}

function setSettingsOpen(open) {
  if (!settingsMenu || !settingsBtn) return;
  settingsMenu.hidden = !open;
  settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

if (settingsBtn && settingsMenu) {
  settingsBtn.addEventListener("click", () => setSettingsOpen(settingsMenu.hidden));
  document.addEventListener("pointerdown", (e) => {
    if (!settingsMenu.hidden && settingsWrap && !settingsWrap.contains(e.target)) setSettingsOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || settingsMenu.hidden) return;
    setSettingsOpen(false);
    settingsBtn.focus();
  });
}

if (readingModeToggle) readingModeToggle.addEventListener("change", () => setReadingMode(readingModeToggle.checked, true));

if (readingSecondsInput) {
  readingSecondsInput.addEventListener("change", () => setReadingSeconds(readingSecondsInput.value, true));
  readingSecondsInput.addEventListener("blur", renderReadingSettings);
  readingSecondsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setReadingSeconds(readingSecondsInput.value, true);
      readingSecondsInput.blur();
    }
  });
}

// もう一方のページ（別タブ）で変えたら追従。休みも共有するので、片方で調べるともう片方も休みになる
window.addEventListener("storage", (e) => {
  if (e.key === READING_MODE_STORAGE_KEY) setReadingMode(e.newValue === "1", false);
  else if (e.key === READING_SECONDS_STORAGE_KEY) setReadingSeconds(e.newValue ?? READING_SECONDS_DEFAULT, false);
  else if (e.key === READING_UNTIL_STORAGE_KEY) {
    loadReadingUntil(e.newValue);
    renderReadingCooldown();
  }
});

try {
  readingSeconds = clampReadingSeconds(localStorage.getItem(READING_SECONDS_STORAGE_KEY) ?? READING_SECONDS_DEFAULT);
  readingMode = localStorage.getItem(READING_MODE_STORAGE_KEY) === "1";
  // 再読み込みしても休みは続く
  loadReadingUntil(localStorage.getItem(READING_UNTIL_STORAGE_KEY));
} catch (_) {
  /* ignore */
}

setReadingMode(readingMode, false);
