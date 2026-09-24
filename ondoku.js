// 音読タイマー — one 3-minute read-aloud session per day.
// Log format (reading_log.json):
//   { "sessions": [ { "date": "YYYY-MM-DD", "book": "title", "lines": 24, "unknowns": 7 }, ... ] }
// "lines" = 行数 (vertical lines of text read). One entry per date; saving the same
// date again overwrites it. Rate = lines / 3 (行/分).

const COUNTDOWN_SECONDS = 5;
const SESSION_SECONDS = 180;
const LOG_STORAGE_KEY = "ondoku-log-v2";
const SHOW_TIME_KEY = "ondoku-show-time";
const IDB_NAME = "ondoku";
const IDB_STORE = "handles";
const IDB_HANDLE_KEY = "log";

const $ = (id) => document.getElementById(id);
const timerCard = $("timerCard");
const timerMsg = $("timerMsg");
const timerClock = $("timerClock");
const startBtn = $("startBtn");
const tallyWrap = $("tallyWrap");
const tallyBtn = $("tallyBtn");
const tallyUndoBtn = $("tallyUndoBtn");
const tallyResult = $("tallyResult");
const resetBtn = $("resetBtn");
const showTimeEl = $("showTime");
const entryForm = $("entryForm");
const entryDate = $("entryDate");
const entryBook = $("entryBook");
const entryLines = $("entryLines");
const entryUnknowns = $("entryUnknowns");
const saveBtn = $("saveBtn");
const entryPreview = $("entryPreview");
const logSummary = $("logSummary");
const chartEl = $("chart");
const logBody = document.querySelector("#logTable tbody");
const logEmpty = $("logEmpty");
const fileStatus = $("fileStatus");
const linkFileBtn = $("linkFileBtn");
const exportBtn = $("exportBtn");
const aboutLink = $("aboutLink");
const aboutDialog = $("about");

const fsSupported = typeof window.showOpenFilePicker === "function";

let sessions = [];
let fileHandle = null;
let fileLinked = false;

/* ---------------- helpers ---------------- */

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function rate(lines) {
  return lines / (SESSION_SECONDS / 60);
}

function fmtRate(lines) {
  return rate(lines).toFixed(1);
}

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function roundHalf(n) {
  return Math.round(n * 2) / 2;
}

function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function normalize(raw) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.sessions) ? raw.sessions : [];
  const byDate = new Map();
  for (const s of list) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) continue;
    const lines = Number(s.lines);
    const unknowns = Number(s.unknowns) || 0;
    if (!Number.isFinite(lines) || lines < 0) continue;
    byDate.set(s.date, {
      date: s.date,
      book: s.book || "",
      lines: roundHalf(lines),
      unknowns: Math.max(0, Math.round(unknowns))
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// One session per line keeps git diffs readable and makes appending by hand easy.
function serialize(list) {
  const lines = list.map(
    (s) => `    {"date": "${s.date}", "book": "${s.book || ""}", "lines": ${s.lines}, "unknowns": ${s.unknowns}}`
  );
  return `{\n  "sessions": [\n${lines.join(",\n")}${lines.length ? "\n" : ""}  ]\n}\n`;
}

function setStatus(text, kind = "") {
  fileStatus.textContent = text;
  fileStatus.className = `file-status ${kind}`.trim();
}

/* ---------------- storage: localStorage mirror ---------------- */

function loadLocal() {
  try {
    return normalize(JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || "[]"));
  } catch (_) {
    return [];
  }
}

function saveLocal() {
  try {
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(sessions));
  } catch (_) {
    /* ignore */
  }
}

/* ---------------- storage: reading_log.json via File System Access ---------------- */

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readFile(handle) {
  const text = await (await handle.getFile()).text();
  if (!text.trim()) return [];
  return normalize(JSON.parse(text));
}

async function writeFile(handle, list) {
  const w = await handle.createWritable();
  await w.write(serialize(list));
  await w.close();
}

// The file wins for any date it already has; dates only saved in the browser are added to it.
async function syncWithFile() {
  const fromFile = await readFile(fileHandle);
  const fileDates = new Set(fromFile.map((s) => s.date));
  const localOnly = sessions.filter((s) => !fileDates.has(s.date));
  sessions = normalize([...fromFile, ...localOnly]);
  if (localOnly.length) await writeFile(fileHandle, sessions);
  saveLocal();
  fileLinked = true;
  setStatus(`${fileHandle.name} に保存中`, "linked");
  linkFileBtn.textContent = "別のファイル…";
  render();
}

async function linkFile() {
  try {
    if (fileHandle && !fileLinked) {
      const perm = await fileHandle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        await syncWithFile();
        return;
      }
    }
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      excludeAcceptAllOption: false,
    });
    fileHandle = handle;
    await idbSet(IDB_HANDLE_KEY, handle);
    await syncWithFile();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    setStatus(`ファイルを開けませんでした: ${err.message || err}`, "error");
  }
}

async function restoreFile() {
  if (!fsSupported) {
    linkFileBtn.hidden = true;
    setStatus("このブラウザはファイル保存に非対応 — 「JSONを書き出す」を使ってください");
    return;
  }
  try {
    const handle = await idbGet(IDB_HANDLE_KEY);
    if (!handle) return;
    fileHandle = handle;
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm === "granted") {
      await syncWithFile();
    } else {
      setStatus(`${handle.name} — 再接続が必要です`);
      linkFileBtn.textContent = `${handle.name} に再接続`;
    }
  } catch (err) {
    setStatus(`ファイルを読めませんでした: ${err.message || err}`, "error");
  }
}

async function persist() {
  saveLocal();
  if (!fileLinked) return;
  try {
    await writeFile(fileHandle, sessions);
    setStatus(`${fileHandle.name} に保存しました`, "linked");
  } catch (err) {
    fileLinked = false;
    setStatus(`ファイルに保存できませんでした（ブラウザ内には保存済み）: ${err.message || err}`, "error");
    linkFileBtn.textContent = `${fileHandle.name} に再接続`;
  }
}

function exportJson() {
  const blob = new Blob([serialize(sessions)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "reading_log.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- timer ---------------- */

let audioCtx = null;
let endAt = 0;
let tickId = 0;
let titleFlashId = 0;
let tally = 0;
const baseTitle = document.title;

function chime() {
  if (!audioCtx) return;
  const notes = [659.25, 783.99, 1046.5]; // E5 G5 C6
  const t0 = audioCtx.currentTime + 0.05;
  for (let rep = 0; rep < 3; rep++) {
    notes.forEach((freq, i) => {
      const t = t0 + rep * 1.1 + i * 0.22;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  }
}

function setTimerState(state) {
  timerCard.dataset.state = state;
  startBtn.hidden = state !== "idle";
  tallyWrap.hidden = state !== "running";
  tallyResult.hidden = state !== "done";
  resetBtn.hidden = state === "idle";
  resetBtn.textContent = state === "running" ? "中止" : "リセット";
  updateClockVisibility();
}

function updateClockVisibility() {
  timerClock.hidden = !(showTimeEl.checked && (timerCard.dataset.state === "running" || timerCard.dataset.state === "countdown"));
}

function tick() {
  const remaining = (endAt - performance.now()) / 1000;
  timerClock.textContent = fmtClock(remaining);
  if (remaining <= 0) {
    if (timerCard.dataset.state === "countdown") {
      startSession();
    } else {
      finish();
    }
  }
}

function startCountdown() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch (_) {
    audioCtx = null;
  }
  endAt = performance.now() + COUNTDOWN_SECONDS * 1000;
  tally = 0;
  timerMsg.textContent = "準備してください…";
  timerClock.textContent = fmtClock(COUNTDOWN_SECONDS);
  timerCard.dataset.state = "countdown";
  startBtn.hidden = true;
  tallyWrap.hidden = true;
  resetBtn.hidden = false;
  updateClockVisibility();
  clearInterval(tickId);
  tickId = setInterval(tick, 200);
}

function startSession() {
  endAt = performance.now() + SESSION_SECONDS * 1000;
  timerMsg.textContent = "読んでいます…";
  timerClock.textContent = fmtClock(SESSION_SECONDS);
  setTimerState("running");
  clearInterval(tickId);
  tickId = setInterval(tick, 200);
}

function start() {
  startCountdown();
}

function finish() {
  clearInterval(tickId);
  timerMsg.textContent = "ストップ！";
  tallyResult.innerHTML = `なになに <strong>${tally}</strong> 回`;
  setTimerState("done");
  chime();
  let on = false;
  clearInterval(titleFlashId);
  titleFlashId = setInterval(() => {
    on = !on;
    document.title = on ? "⏰ 時間です" : baseTitle;
  }, 800);
  entryDate.value = todayStr();
  syncEntryToDate();
  entryUnknowns.value = tally;
  renderPreview();
  entryLines.focus();
}

function bumpTally(delta) {
  if (timerCard.dataset.state !== "running") return;
  tally = Math.max(0, tally + delta);
  if (delta > 0) {
    tallyBtn.classList.remove("bump");
    void tallyBtn.offsetWidth;
    tallyBtn.classList.add("bump");
    setTimeout(() => tallyBtn.classList.remove("bump"), 90);
  }
}

function reset() {
  clearInterval(tickId);
  clearInterval(titleFlashId);
  document.title = baseTitle;
  timerMsg.textContent = "準備ができたら開始";
  setTimerState("idle");
}

/* ---------------- entry & log ---------------- */

function findSession(date) {
  return sessions.find((s) => s.date === date);
}

function syncEntryToDate() {
  const existing = findSession(entryDate.value);
  if (existing) {
    entryBook.value = existing.book || "";
    entryLines.value = existing.lines;
    entryUnknowns.value = existing.unknowns;
  } else {
    entryBook.value = "";
  }
  saveBtn.textContent = existing ? "上書き保存" : "保存";
  renderPreview();
}

function renderPreview() {
  const lines = Number(entryLines.value);
  const unknowns = Number(entryUnknowns.value) || 0;
  if (!entryLines.value || !Number.isFinite(lines) || lines <= 0) {
    entryPreview.textContent = "";
    return;
  }
  const perLine = (unknowns / lines).toFixed(1);
  entryPreview.innerHTML = `<strong>${fmtRate(lines)}</strong> 行/分 · なになに 1行あたり ${perLine}`;
}

async function saveEntry(e) {
  e.preventDefault();
  const date = entryDate.value;
  const book = entryBook.value || "";
  const lines = roundHalf(Number(entryLines.value));
  const unknowns = Math.max(0, Math.round(Number(entryUnknowns.value) || 0));
  if (!date || !Number.isFinite(lines) || lines < 0) return;
  sessions = normalize([...sessions.filter((s) => s.date !== date), { date, book, lines, unknowns }]);
  await persist();
  render();
  syncEntryToDate();
  if (timerCard.dataset.state === "done") reset();
}

async function deleteEntry(date) {
  if (!confirm(`${date} の記録を削除しますか？`)) return;
  sessions = sessions.filter((s) => s.date !== date);
  await persist();
  render();
  syncEntryToDate();
}

function renderTable() {
  const today = todayStr();
  logBody.innerHTML = "";
  for (const s of [...sessions].reverse()) {
    const tr = document.createElement("tr");
    if (s.date === today) tr.className = "today";
    const cells = [s.date, s.book || "—", fmtNum(s.lines), fmtRate(s.lines), s.unknowns];
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    }
    const td = document.createElement("td");
    const del = document.createElement("button");
    del.type = "button";
    del.className = "minor del";
    del.textContent = "削除";
    del.addEventListener("click", () => deleteEntry(s.date));
    td.appendChild(del);
    tr.appendChild(td);
    logBody.appendChild(tr);
  }
  logEmpty.hidden = sessions.length > 0;
}

function renderSummary() {
  if (!sessions.length) {
    logSummary.textContent = "";
    return;
  }
  const latest = sessions[sessions.length - 1];
  const best = Math.max(...sessions.map((s) => s.lines));
  logSummary.textContent = `${sessions.length}回 · 最新 ${fmtRate(latest.lines)} 行/分 · 最高 ${fmtRate(best)} 行/分`;
}

function niceMax(v) {
  if (v <= 0) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

function renderChart() {
  const NS = "http://www.w3.org/2000/svg";
  chartEl.innerHTML = "";
  chartEl.hidden = sessions.length < 2;
  if (chartEl.hidden) return;

  const W = chartEl.clientWidth || 600;
  const H = chartEl.clientHeight || 140;
  const pad = { l: 36, r: 10, t: 10, b: 20 };
  chartEl.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const vals = sessions.map((s) => rate(s.lines));
  const yMax = niceMax(Math.max(...vals));
  const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / (vals.length - 1);
  const y = (v) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);

  const el = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    chartEl.appendChild(n);
    return n;
  };

  for (const f of [0, 0.5, 1]) {
    const v = yMax * f;
    el("line", { class: "grid", x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) });
    el("text", { class: "axis-label", x: pad.l - 6, y: y(v) + 4, "text-anchor": "end" }, fmtNum(Math.round(v * 10) / 10));
  }
  const first = sessions[0].date.slice(5).replace("-", "/");
  const last = sessions[sessions.length - 1].date.slice(5).replace("-", "/");
  el("text", { class: "axis-label", x: pad.l, y: H - 4 }, first);
  el("text", { class: "axis-label", x: W - pad.r, y: H - 4, "text-anchor": "end" }, last);

  el("polyline", { class: "line", points: vals.map((v, i) => `${x(i)},${y(v)}`).join(" ") });
  if (vals.length <= 60) {
    vals.forEach((v, i) => {
      const dot = el("circle", { class: "dot", cx: x(i), cy: y(v), r: 3 });
      const t = document.createElementNS(NS, "title");
      t.textContent = `${sessions[i].date}: ${v.toFixed(1)} 行/分`;
      dot.appendChild(t);
    });
  }
}

function render() {
  renderTable();
  renderSummary();
  renderChart();
}

/* ---------------- wiring ---------------- */

startBtn.addEventListener("click", start);
resetBtn.addEventListener("click", reset);
tallyBtn.addEventListener("click", () => bumpTally(1));
tallyUndoBtn.addEventListener("click", () => bumpTally(-1));

showTimeEl.addEventListener("change", () => {
  try {
    localStorage.setItem(SHOW_TIME_KEY, showTimeEl.checked ? "1" : "0");
  } catch (_) {
    /* ignore */
  }
  updateClockVisibility();
});

document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(tag) || aboutDialog.open) return;
  e.preventDefault();
  // Idle: start countdown. Reading: count a なになに. Done: nothing (use the リセット button).
  if (timerCard.dataset.state === "idle") start();
  else if (timerCard.dataset.state === "running") bumpTally(1);
});

entryForm.addEventListener("submit", saveEntry);
entryDate.addEventListener("change", syncEntryToDate);
entryBook.addEventListener("input", renderPreview);
entryLines.addEventListener("input", renderPreview);
entryUnknowns.addEventListener("input", renderPreview);

linkFileBtn.addEventListener("click", linkFile);
exportBtn.addEventListener("click", exportJson);

aboutLink.addEventListener("click", (e) => {
  e.preventDefault();
  aboutDialog.showModal();
});

let resizeId = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeId);
  resizeId = requestAnimationFrame(renderChart);
});

(function init() {
  try {
    showTimeEl.checked = localStorage.getItem(SHOW_TIME_KEY) === "1";
  } catch (_) {
    /* ignore */
  }
  sessions = loadLocal();
  entryDate.value = todayStr();
  setTimerState("idle");
  render();
  syncEntryToDate();
  restoreFile();
})();
