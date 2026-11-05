// 手書き入力: キャンバス → Google 手書き認識 → 候補 → helperLookup。モードではなく入力方法。

const handwritingToggle = document.getElementById("helperModeHandwriting");

// 手書きは HELPER_MODES（取得・キャッシュ・履歴を持つモード）ではなく入力方法。
// タブの見た目だけ renderHelperModes で共通管理し、候補を選ぶと辞書で helperLookup する。
const HANDWRITING_TAB = "handwriting";

const HANDWRITING_ENDPOINT = "https://inputtools.google.com/request?ime=handwriting&app=translate&dbg=0&cs=1&oe=UTF-8";
const HANDWRITING_LANGUAGE = "ja";
const HANDWRITING_MAX_CANDIDATES = 10;
const HANDWRITING_AUTO_RECOGNIZE_MS = 850; // ペンを離してから自動認識するまで
let handwritingOpen = false;

// 漢字辞典タブを押して自動で開いたとき true。ほかのタブへ移ったら自動で閉じる（手で開閉したら false）
let handwritingAutoOpened = false;

// 手書きは「調べ方」ではなく入力方法: 入力欄の左のトグルで開閉
if (handwritingToggle) {
  handwritingToggle.addEventListener("click", () => {
    handwritingAutoOpened = false; // 手で開閉したら、タブ切り替えで勝手に閉じない
    if (handwritingOpen) {
      handwritingOpen = false;
      renderHelperModes();
    } else {
      setHelperMode(HANDWRITING_TAB);
    }
  });
}

// 手書き入力: ペンのストローク → Google 手書き認識 → 候補 → 辞書で helperLookup
// ペンを離して HANDWRITING_AUTO_RECOGNIZE_MS 後に自動認識（次の一画でリセット）
const handwritingCanvas = document.getElementById("handwritingCanvas");

const handwritingCtx = handwritingCanvas.getContext("2d");
const handwritingClearBtn = document.getElementById("handwritingClearBtn");
const handwritingCandidates = document.getElementById("handwritingCandidates");
const handwritingUndoBtn = document.getElementById("handwritingUndoBtn");
const handwritingComposeBtn = document.getElementById("handwritingComposeBtn");
const handwritingCompose =document.getElementById("handwritingCompose");
const handwritingDraft = document.getElementById("handwritingDraft");
const handwritingDraftBackBtn = document.getElementById("handwritingDraftBackBtn");
const handwritingDraftCancelBtn = document.getElementById("handwritingDraftCancelBtn");
const handwritingDraftLookupBtn = document.getElementById("handwritingDraftLookupBtn");
const HANDWRITING_HINT = "ペンで書くと候補が表示されます";
let handwritingStrokes = []; // [[{x, y, t}, ...], ...]  x/y は CSS px
let handwritingCurrentStroke = null;
const HANDWRITING_UNDO_LIMIT = 5; // 取り消せるのは直近5画まで
let handwritingUndoCache = []; // 直近の最大5ストローク（handwritingStrokes 内の同じ配列を参照）
let handwritingDrawing = false;
let handwritingStartTime = 0;
let handwritingRequestId = 0;
let handwritingAutoTimer = 0;
let handwritingSize = { w: 360, h: 160 };

// 追加モード: 候補クリックで下書きに追加 → キャンバスをクリア（辞書は開かない）
let handwritingComposing = false;

let handwritingDraftParts = []; // 追加した候補（⌫ で1つずつ戻せる）

// 表示サイズに合わせてキャンバスの解像度を更新（パネルの高さに追従、歪み防止）
function syncHandwritingCanvasSize() {
  const w = handwritingCanvas.clientWidth;
  const h = handwritingCanvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  handwritingSize = { w, h };
  handwritingCanvas.width = Math.round(w * dpr);
  handwritingCanvas.height = Math.round(h * dpr);
  handwritingCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawHandwriting();
}

function getHandwritingPoint(e) {
  const rect = handwritingCanvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    t: Math.round(performance.now() - handwritingStartTime)
  };
}

function redrawHandwriting() {
  handwritingCtx.clearRect(0, 0, handwritingSize.w, handwritingSize.h);
  handwritingCtx.lineCap = "round";
  handwritingCtx.lineJoin = "round";
  handwritingCtx.lineWidth = 4;
  handwritingCtx.strokeStyle = "#1c1915";
  handwritingCtx.fillStyle = "#1c1915";
  for (const stroke of handwritingStrokes) {
    if (stroke.length === 1) {
      handwritingCtx.beginPath();
      handwritingCtx.arc(stroke[0].x, stroke[0].y, 2, 0, Math.PI * 2);
      handwritingCtx.fill();
      continue;
    }
    handwritingCtx.beginPath();
    handwritingCtx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) handwritingCtx.lineTo(stroke[i].x, stroke[i].y);
    handwritingCtx.stroke();
  }
}

function setHandwritingStatus(message, isError) {
  handwritingCandidates.replaceChildren();
  handwritingCandidates.classList.toggle("error", Boolean(isError));
  const note = document.createElement("span");
  note.className = "handwriting-status";
  note.textContent = message || HANDWRITING_HINT;
  handwritingCandidates.append(note);
}

function renderHandwritingCandidates(candidates) {
  handwritingCandidates.replaceChildren();
  handwritingCandidates.classList.remove("error");
  if (!candidates.length) {
    setHandwritingStatus("候補が見つかりませんでした");
    return;
  }
  for (const text of candidates) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "handwriting-candidate";
    btn.textContent = text;
    btn.title = handwritingComposing ? `「${text}」を下書きに追加` : `「${text}」を${handwritingLookupLabel(text)}で調べる`;
    btn.addEventListener("click", () => chooseHandwritingCandidate(text));
    handwritingCandidates.append(btn);
  }
}

function syncHandwritingClear() {
  handwritingClearBtn.hidden = !handwritingStrokes.length;
  handwritingUndoBtn.disabled = !handwritingUndoCache.length;
}

// 最後の一画を取り消す（キャッシュしている直近5画まで）
function undoHandwritingStroke() {
  if (handwritingDrawing) return;
  const stroke = handwritingUndoCache.pop();
  if (!stroke) return;
  const i = handwritingStrokes.lastIndexOf(stroke);
  if (i >= 0) handwritingStrokes.splice(i, 1);
  clearTimeout(handwritingAutoTimer);
  handwritingRequestId++; // 取り消し前の認識結果を破棄
  handwritingCandidates.classList.remove("loading");
  redrawHandwriting();
  syncHandwritingClear();
  if (handwritingStrokes.length) {
    setHandwritingStatus("認識中…");
    handwritingAutoTimer = setTimeout(recognizeHandwriting, 300);
  } else {
    setHandwritingStatus("");
  }
}

function clearHandwriting() {
  clearTimeout(handwritingAutoTimer);
  handwritingRequestId++; // 送信中の認識結果を破棄
  handwritingStrokes = [];
  handwritingUndoCache = [];
  handwritingCurrentStroke = null;
  handwritingDrawing = false;
  redrawHandwriting();
  syncHandwritingClear();
  setHandwritingStatus("");
}

// 手書き結果は、いま選んでいる調べ方タブ（辞書・例文・漢字辞典・類義語・漢字表記）でそのまま調べる。
function handwritingLookupMode() {
  return helperMode;
}

function handwritingLookupLabel() {
  return HELPER_MODE_LABELS[helperMode] || "辞書";
}

function chooseHandwritingCandidate(text) {
  // 休み中は書いた字を消さずに残す（下書きへの追加はできる）
  if (!handwritingComposing && readingBlocked()) return;
  clearHandwriting();
  if (handwritingComposing) {
    handwritingDraftParts.push(text);
    renderHandwritingDraft();
    return;
  }
  helperLookup(text, { mode: handwritingLookupMode(text) });
  pulseLookupBox();
}

function renderHandwritingDraft() {
  handwritingComposeBtn.setAttribute("aria-pressed", String(handwritingComposing));
  handwritingComposeBtn.classList.toggle("active", handwritingComposing);
  handwritingCompose.hidden = !handwritingComposing;
  const draft = handwritingDraftParts.join("");
  handwritingDraft.textContent = draft;
  handwritingDraft.classList.toggle("empty", !draft);
  handwritingDraft.dataset.placeholder = "候補をクリックすると下書きに追加されます";
  handwritingDraftBackBtn.disabled = !draft;
  handwritingDraftLookupBtn.disabled = !draft;
  for (const btn of handwritingCandidates.querySelectorAll(".handwriting-candidate")) {
    btn.title = handwritingComposing ? `「${btn.textContent}」を下書きに追加` : `「${btn.textContent}」を${handwritingLookupLabel(btn.textContent)}で調べる`;
  }
}

function setHandwritingComposing(on) {
  handwritingComposing = Boolean(on);
  if (!handwritingComposing) handwritingDraftParts = [];
  renderHandwritingDraft();
}

function lookupHandwritingDraft() {
  if (readingBlocked()) return; // 休み中は下書きを消さない
  // 書きかけの文字がある場合は、いまの第1候補も下書きに含めてから調べる
  const pending = handwritingCandidates.querySelector(".handwriting-candidate");
  if (pending && handwritingStrokes.length) handwritingDraftParts.push(pending.textContent);
  const draft = handwritingDraftParts.join("");
  if (!draft) return;
  clearHandwriting();
  setHandwritingComposing(false);
  helperLookup(draft, { mode: handwritingLookupMode(draft) });
  pulseLookupBox();
}

// 候補の表記ゆれを揃えて重複を除く:
// NFKC（互換漢字 U+F900– などを通常の漢字へ）、空白・句読点・記号（「横 浜」「横、浜」「横浜*」）を除去
function normalizeHandwritingCandidate(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, "")
    .replace(/[\p{P}\p{S}]+/gu, "");
}

// Google 入力ツール（翻訳の手書き入力と同じエンドポイント）の ink 形式: 各ストロークを [xs, ys, ts] に
function handwritingInk() {
  return handwritingStrokes.map((stroke) => [
    stroke.map((p) => Math.round(p.x)),
    stroke.map((p) => Math.round(p.y)),
    stroke.map((p) => p.t)
  ]);
}

async function recognizeHandwriting() {
  clearTimeout(handwritingAutoTimer);
  if (!handwritingStrokes.length) return;
  const requestId = ++handwritingRequestId;
  handwritingCandidates.classList.add("loading");
  if (!handwritingCandidates.querySelector(".handwriting-candidate")) setHandwritingStatus("認識中…");
  const body = {
    requests: [{
      writing_guide: { writing_area_width: Math.round(handwritingSize.w), writing_area_height: Math.round(handwritingSize.h) },
      ink: handwritingInk(),
      language: HANDWRITING_LANGUAGE,
      max_num_results: HANDWRITING_MAX_CANDIDATES,
      max_completions: 0
    }]
  };
  try {
    const res = await fetch(HANDWRITING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (requestId !== handwritingRequestId) return;
    // 形式: ["SUCCESS", [[id, [候補...], [], {...}]]]
    if (!Array.isArray(data) || data[0] !== "SUCCESS") throw new Error(String((data && data[0]) || "unexpected response"));
    const raw = (data[1] && data[1][0] && data[1][0][1]) || [];
    const seen = new Set();
    const candidates = [];
    for (const c of raw) {
      const text = normalizeHandwritingCandidate(c);
      if (text && !seen.has(text)) {
        seen.add(text);
        candidates.push(text);
      }
    }
    renderHandwritingCandidates(candidates.slice(0, HANDWRITING_MAX_CANDIDATES));
  } catch (err) {
    if (requestId !== handwritingRequestId) return;
    console.warn("handwriting recognition failed", err);
    setHandwritingStatus("認識できませんでした（ネットワークを確認してください）", true);
  } finally {
    if (requestId === handwritingRequestId) handwritingCandidates.classList.remove("loading");
  }
}

function scheduleHandwritingRecognize() {
  clearTimeout(handwritingAutoTimer);
  if (!handwritingStrokes.length) return;
  handwritingAutoTimer = setTimeout(recognizeHandwriting, HANDWRITING_AUTO_RECOGNIZE_MS);
}

function endHandwritingStroke(e) {
  if (!handwritingDrawing) return;
  handwritingDrawing = false;
  handwritingCurrentStroke = null;
  if (e && e.pointerId != null && handwritingCanvas.hasPointerCapture(e.pointerId)) {
    handwritingCanvas.releasePointerCapture(e.pointerId);
  }
  scheduleHandwritingRecognize();
}

handwritingCanvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  e.preventDefault();
  // 書き始めたら入力欄のフォーカスを外す（Ctrl+Z を入力欄ではなく一画の取り消しに使うため）
  if (document.activeElement === helperInput) helperInput.blur();
  clearTimeout(handwritingAutoTimer);
  handwritingCanvas.setPointerCapture(e.pointerId);
  if (!handwritingStrokes.length) handwritingStartTime = performance.now();
  handwritingDrawing = true;
  handwritingCurrentStroke = [getHandwritingPoint(e)];
  handwritingStrokes.push(handwritingCurrentStroke);
  handwritingUndoCache.push(handwritingCurrentStroke);
  if (handwritingUndoCache.length > HANDWRITING_UNDO_LIMIT) handwritingUndoCache.shift();
  redrawHandwriting();
  syncHandwritingClear();
});

handwritingCanvas.addEventListener("pointermove", (e) => {
  if (!handwritingDrawing || !handwritingCurrentStroke) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (events.length ? events : [e])) handwritingCurrentStroke.push(getHandwritingPoint(ev));
  redrawHandwriting();
});

handwritingCanvas.addEventListener("pointerup", endHandwritingStroke);

handwritingCanvas.addEventListener("pointercancel", endHandwritingStroke);

handwritingClearBtn.addEventListener("click", clearHandwriting);

handwritingUndoBtn.addEventListener("click", undoHandwritingStroke);

document.addEventListener("keydown", (e) => {
  if (!handwritingOpen || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  if (!handwritingUndoCache.length) return;
  e.preventDefault();
  undoHandwritingStroke();
});

handwritingComposeBtn.addEventListener("click", () => setHandwritingComposing(!handwritingComposing));

handwritingDraftBackBtn.addEventListener("click", () => {
  handwritingDraftParts.pop();
  renderHandwritingDraft();
});

handwritingDraftCancelBtn.addEventListener("click", () => setHandwritingComposing(false));

handwritingDraftLookupBtn.addEventListener("click", lookupHandwritingDraft);

renderHandwritingDraft();

new ResizeObserver(syncHandwritingCanvasSize).observe(handwritingCanvas);

setHandwritingStatus("");
