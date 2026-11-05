// 保存した答えと履歴（store.js）。調べた答えを残し、読み込み時に直近の履歴と答えを戻す。

// 保存先（store.js）。履歴と答えを残して、読み込み時に直近の履歴を戻す。store.js がなければ今まで通りメモリだけ。
const lookupStore = typeof LookupStore === "object" && LookupStore ? LookupStore : null;

// 保存済みの語リスト（漢字辞典の words、類義語の similar / opposite）で、意味に ｜ が残っているものを分け直す。
// 救済を入れる前に保存された答えも、読み込み時に直る。
function repairWordList(list) {
  if (!Array.isArray(list) || !list.some((w) => w && /[｜|]/.test(w.gloss || ""))) return list;
  return list.flatMap((w) =>
    w && /[｜|]/.test(w.gloss || "") ? parseThesList([w.word, w.reading, w.gloss].join("｜")) : [w]
  );
}

function repairStoredEntry(mode, entry) {
  if (!entry || typeof entry !== "object") return entry;
  if (mode === "jiten" && Array.isArray(entry.words)) {
    return { ...entry, words: tidyJitenWords(repairWordList(entry.words), entry.char) };
  }
  if (mode === "thes") {
    const similar = repairWordList(entry.similar);
    const opposite = repairWordList(entry.opposite);
    if (similar !== entry.similar || opposite !== entry.opposite) return { ...entry, similar, opposite };
  }
  return entry;
}

// 保存のキーはメモリのキャッシュと同じ: 語 / 使い分けは cmpCacheKey / 漢字辞典は1字ずつ。
function persistModeEntry(mode, query, entry) {
  if (!lookupStore || !entry) return;
  const cfg = PROMPT_SETTINGS[mode];
  const level = lookupStore.levelOf(gakuseiMode && !(cfg && cfg.noGakusei));
  const model = cfg ? cfg.model : null;
  let rows;
  if (mode === "jiten") rows = (entry.kanji || []).map((k) => ({ query: k.char, mode, level, entry: k, model }));
  else if (mode === "sentence") rows = [{ query, mode, level, entry: entry.sentences || [], model }];
  else if (mode === "cmp") rows = [{ query: cmpCacheKey(query), mode, level, entry, model }];
  else rows = [{ query, mode, level, entry, model }];
  rows = rows.filter((r) => r.query);
  if (rows.length) lookupStore.save(rows);
}

// modes を渡すと、使い分けのキーは使い分けで調べた語のときだけ足す（ふりがなの文は長く、ほぼ同じ長さのキーがもう1本増えるので）。
// 漢字辞典のキーは1字ずつで短く、ほかの語と共有しているので今までどおり足す。
function storeKeysFor(query, modes) {
  const keys = [query];
  if (!Array.isArray(modes) || modes.includes("cmp")) keys.push(cmpCacheKey(query));
  for (const ch of jitenChars(query).slice(0, JITEN_MAX_CHARS)) keys.push(ch);
  return keys.filter(Boolean);
}

// 保存済みの答えを両方のレベルのキャッシュへ。メモリにもうある答え（このページで取ったもの）は上書きしない。
function applyStoredEntries(rows) {
  for (const row of rows) {
    const bank = cacheBanks[row.level];
    if (!bank || !row.entry || !HELPER_MODES.includes(row.mode)) continue;
    if (row.mode === "dict") {
      const key = dictCacheKey(row.query, "");
      if (!bank.dict[key]) bank.dict[key] = row.entry;
    } else if (row.mode === "sentence") {
      const have = bank.sentence[row.query];
      if (!(have && have.length) && Array.isArray(row.entry)) bank.sentence[row.query] = row.entry;
    } else if (!bank[row.mode][row.query]) {
      bank[row.mode][row.query] = repairStoredEntry(row.mode, row.entry);
    }
  }
}

// 直近の履歴をタブに戻す（このページで先に調べた語のうしろに並べる）。答えはキャッシュから出る。
function restoreStoredHistory(rows) {
  const restored = [];
  for (const row of rows) {
    if (!row || !row.query || findHelperItem(row.query)) continue;
    const item = createHelperItem(row.query, row.context || null);
    const modes = (row.modes || []).filter((m) => HELPER_MODES.includes(m));
    item.usedModes = modes.slice();
    item.mode = modes.length ? modes[modes.length - 1] : "dict";
    restored.push(item);
  }
  if (!restored.length) return;
  helperHistory = helperHistory.concat(restored).slice(0, HELPER_HISTORY_LIMIT);
  renderHelperTabs();
}

async function hydrateFromStore(extraQuery) {
  const recent = await lookupStore.history({ limit: HELPER_HISTORY_LIMIT });
  const items = (recent && recent.items) || [];
  const keys = new Set();
  for (const row of items) for (const k of storeKeysFor(row.query, row.modes)) keys.add(k);
  if (extraQuery) for (const k of storeKeysFor(extraQuery)) keys.add(k);
  applyStoredEntries(await lookupStore.entries([...keys]));
  restoreStoredHistory(items);
}

// 履歴ページから lookup.html?q=語&mode=辞書 で開く。保存済みなら API は呼ばない。
async function initLookupStore() {
  const params = new URLSearchParams(location.search);
  const deepQuery = (params.get("q") || "").trim();
  const deepMode = params.get("mode");
  if (deepQuery) window.history.replaceState(null, "", location.pathname + location.hash);

  if (lookupStore) {
    const hydrated = hydrateFromStore(deepQuery).catch((err) => console.warn("[store] 履歴を読み込めませんでした", err));
    if (deepQuery) await Promise.race([hydrated, new Promise((r) => setTimeout(r, DEEP_LINK_WAIT_MS))]);
  }
  // 履歴ページから開くのは保存済みの語を見直すだけなので、待てモードの休みには数えない
  if (deepQuery) helperLookup(deepQuery, { ...(HELPER_MODES.includes(deepMode) ? { mode: deepMode } : {}), skipReadingCooldown: true });
}
