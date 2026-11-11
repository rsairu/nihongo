// history.html: 調べた語の一覧（新しい順）。50件ずつ読み込み、「さらに50件」で続きを取る。
// 行をクリックすると lookup.html?q=語&mode=… で開く（保存済みの答えから出るので API は呼ばない）。
(function () {
  "use strict";

  const PAGE_SIZE = 50;
  const FONT_SCALE_STORAGE_KEY = "vocab-clicker-font-scale"; // lookup/settings.js と同じ
  const MODES = ["dict", "kanji", "sentence", "thes", "cmp", "jiten", "furi", "iimawashi"];
  const MODE_LABELS = { dict: "辞書", kanji: "漢字表記", sentence: "例文", thes: "類義語", cmp: "使い分け", jiten: "漢字辞典", furi: "ふりがな", iimawashi: "言い回し" };
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  const listEl = document.getElementById("historyList");
  const totalEl = document.getElementById("historyTotal");
  const statusEl = document.getElementById("historyStatus");
  const moreBtn = document.getElementById("historyMoreBtn");
  const noteEl = document.getElementById("historyNote");
  const filterEl = document.getElementById("historyFilter");
  const filterBtns = filterEl ? Array.from(filterEl.querySelectorAll("button[data-mode]")) : [];
  const store = window.LookupStore;

  let offset = 0;
  let total = 0;
  let lastDay = "";
  let loading = false;
  // 絞り込み中のモード（"" = すべて）。URL の ?mode= にも入れるので、語を開いて戻っても残る
  let filterMode = "";
  // 絞り込みを切り替えたら番号を進める。読み込み中に切り替わった古い結果は捨てる
  let generation = 0;
  try {
    const m = new URLSearchParams(location.search).get("mode") || "";
    if (MODES.includes(m)) filterMode = m;
  } catch (_) {}

  // リトリーブのページと同じ文字サイズ
  try {
    const scale = parseFloat(localStorage.getItem(FONT_SCALE_STORAGE_KEY));
    if (scale >= 0.8 && scale <= 1.6) document.documentElement.style.fontSize = scale * 100 + "%";
  } catch (_) {}

  function dayKey(d) {
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function dayLabel(d) {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayKey(d) === dayKey(now)) return "今日";
    if (dayKey(d) === dayKey(yesterday)) return "昨日";
    const md = d.getMonth() + 1 + "月" + d.getDate() + "日（" + WEEKDAYS[d.getDay()] + "）";
    return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + "年" + md;
  }

  function timeLabel(d) {
    return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  // 絞り込み中ならそのモードで。そうでなければ、辞書で見たことがあれば辞書で、なければ最後に使ったモードで開く（どれも保存済み）
  function openMode(modes) {
    if (filterMode && modes.includes(filterMode)) return filterMode;
    if (modes.includes("dict")) return "dict";
    return modes.length ? modes[modes.length - 1] : "dict";
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderRow(item) {
    const when = new Date(item.last_looked_at);
    const key = dayKey(when);
    if (key !== lastDay) {
      lastDay = key;
      const head = el("li", "history-day", dayLabel(when));
      head.setAttribute("role", "presentation");
      listEl.append(head);
    }

    const modes = (item.modes || []).filter((m) => MODES.includes(m));
    const mode = openMode(modes);
    const li = el("li", "history-item");
    const a = el("a", "history-row");
    a.href = "lookup.html?" + new URLSearchParams({ q: item.query, mode }).toString();
    a.dataset.mode = mode;

    const word = el("span", "history-word", item.query);
    word.title = item.query;
    const body = el("span", "history-body-text");
    const reading = (item.dict && item.dict.reading) || (item.context && item.context.reading) || "";
    // 使い方のラベル（〔新〕〔口語〕など。辞書ではバッジ）は一覧では外す。
    const meaning = ((item.dict && item.dict.ja) || (item.context && item.context.meaning) || "")
      .replace(/〔[^〔〕\s]{1,10}〕/g, "")
      .trim();
    const suggestion = (item.dict && item.dict.suggestion) || "";
    // かなで引いた語は 読み【表記】（辞書の 表記:）、活用した形で引いた語は 読み【見出し】（辞書形）
    const spelling = (item.dict && (item.dict.spelling || (item.dict.lemma !== item.dict.reading && item.dict.lemma))) || "";
    if (reading) body.append(el("span", "history-reading", spelling ? reading + "【" + spelling + "】" : reading));
    if (meaning) body.append(el("span", "history-meaning", meaning));
    else if (suggestion) body.append(el("span", "history-meaning history-suggestion", "もしかして：" + suggestion));

    const meta = el("span", "history-meta");
    const pips = el("span", "history-pips");
    pips.title = modes.map((m) => MODE_LABELS[m]).join("・");
    pips.setAttribute("aria-label", pips.title);
    for (const m of modes) {
      const pip = el("span", "helper-tab-pip");
      pip.dataset.mode = m;
      pips.append(pip);
    }
    meta.append(pips);
    if (item.lookup_count > 1) {
      const count = el("span", "history-count", "×" + item.lookup_count);
      count.title = item.lookup_count + "回調べた";
      meta.append(count);
    }
    const time = el("time", "history-time", timeLabel(when));
    time.dateTime = item.last_looked_at;
    time.title = "最初: " + new Date(item.first_looked_at).toLocaleString("ja-JP");
    meta.append(time);

    a.append(word, body, meta);

    // × は行のリンクの外に置く（リンクの中にボタンは入れられない）
    const del = el("button", "history-delete", "×");
    del.type = "button";
    del.title = "履歴から削除";
    del.setAttribute("aria-label", "「" + item.query + "」を履歴から削除");
    del.addEventListener("click", () => deleteRow(item.query, li, del));

    li.append(a, del);
    listEl.append(li);
  }

  // 日付の見出しの下に語が残っていなければ、見出しも消す
  function removeEmptyDay(li) {
    const prev = li.previousElementSibling;
    const next = li.nextElementSibling;
    li.remove();
    if (prev && prev.classList.contains("history-day") && (!next || next.classList.contains("history-day"))) {
      prev.remove();
      if (!next) lastDay = ""; // 最後の日の見出しを消したら、次のページでまた出す
    }
  }

  async function deleteRow(query, li, btn) {
    const ok = window.confirm(
      "「" + query + "」を履歴から削除しますか？\n保存した答え（辞書・漢字表記・例文・類義語・使い分け・ふりがな）も消えます。元には戻せません。"
    );
    if (!ok) return;
    btn.disabled = true;
    try {
      await store.deleteLookup(query);
      removeEmptyDay(li);
      // サーバー側で1件減ったので、続きを読む位置と総数も1つ戻す
      offset = Math.max(0, offset - 1);
      total = Math.max(0, total - 1);
      renderFoot();
    } catch (err) {
      console.warn("[history] delete", err);
      btn.disabled = false;
      statusEl.textContent = "「" + query + "」を削除できませんでした（" + err.message + "）。";
    }
  }

  function renderFoot() {
    const left = Math.max(0, total - offset);
    moreBtn.hidden = left === 0;
    moreBtn.textContent = "さらに" + Math.min(PAGE_SIZE, left) + "件（残り" + left + "語）";
    const label = filterMode ? MODE_LABELS[filterMode] + "で調べた語 " : "全";
    totalEl.textContent = total || filterMode ? label + total + "語" : "";
    if (!total && filterMode) statusEl.textContent = MODE_LABELS[filterMode] + "で調べた語はまだありません。";
    else if (!total) statusEl.textContent = "まだ履歴がありません。調べた語がここに並びます。";
    else if (!left) statusEl.textContent = "これで全部です。";
    else statusEl.textContent = "";
  }

  async function loadMore() {
    if (loading || !store) return;
    const gen = generation;
    loading = true;
    moreBtn.disabled = true;
    statusEl.textContent = "読み込み中…";
    try {
      const page = await store.history({ offset, limit: PAGE_SIZE, summary: true, mode: filterMode || undefined });
      if (gen !== generation) return; // 待っている間に絞り込みが変わった
      const items = (page && page.items) || [];
      total = page && Number.isFinite(page.total) ? page.total : offset + items.length;
      for (const item of items) renderRow(item);
      offset += items.length;
      if (!items.length) total = offset; // 途中で数が変わっていても止まる
      renderFoot();
    } catch (err) {
      if (gen !== generation) return;
      console.warn("[history]", err);
      statusEl.textContent = "読み込めませんでした（" + err.message + "）。";
      moreBtn.hidden = false;
      moreBtn.textContent = "もう一度";
    } finally {
      if (gen === generation) {
        loading = false;
        moreBtn.disabled = false;
      }
    }
  }

  function paintFilter() {
    for (const btn of filterBtns) {
      const on = btn.dataset.mode === filterMode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (filterEl) filterEl.dataset.mode = filterMode;
  }

  // 同じアイコンをもう一度押すと解除。一覧は最初から読み直す（絞り込みはサーバー側でするので、件数とページ送りも合う）
  function setFilter(mode) {
    const next = mode && mode !== filterMode ? mode : "";
    if (next === filterMode && !mode) return; // 「すべて」中に「すべて」
    filterMode = next;
    paintFilter();
    try {
      const url = new URL(location.href);
      if (filterMode) url.searchParams.set("mode", filterMode);
      else url.searchParams.delete("mode");
      history.replaceState(null, "", url);
    } catch (_) {}
    generation += 1;
    loading = false;
    offset = 0;
    total = 0;
    lastDay = "";
    listEl.replaceChildren();
    moreBtn.hidden = true;
    totalEl.textContent = "";
    loadMore();
  }

  for (const btn of filterBtns) {
    btn.addEventListener("click", () => setFilter(btn.dataset.mode));
  }

  moreBtn.addEventListener("click", loadMore);

  paintFilter();
  if (!store) {
    statusEl.textContent = "store.js を読み込めませんでした。";
  } else {
    noteEl.hidden = store.kind !== "local";
    loadMore();
  }
})();
