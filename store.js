// リトリーブの保存先。lookup.html / vocab_clicker.html / history.html が読み込む（vocab_clicker.js より先）。
// Hosted (Vercel): /api/store → Supabase（端末をまたいで残る）。アクセスコードは api/claude.js と共通。
// Local (localhost / file://): このブラウザの localStorage に保存（その端末だけ）。
// 書き込みはすべて投げっぱなし。失敗しても調べる機能は止めない。
(function () {
  "use strict";

  const ACCESS_CODE_STORAGE_KEY = "vocab_clicker_access_code"; // vocab_clicker.js と同じキー
  const ENDPOINT = "/api/store";
  const SAVE_FLUSH_MS = 300;
  const SAVE_BATCH = 20;

  const hosted =
    /^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  function levelOf(gakusei) {
    return gakusei ? "gakusei" : "standard";
  }

  // 使い分けの答えの保存キー。vocab_clicker.js の cmpCacheKey と同じ（history.html は vocab_clicker.js を読まないのでここにも置く）。
  const CMP_MAX_WORDS = 3;
  function cmpKeyOf(query) {
    const out = [];
    for (const w of String(query || "").split(/[・、,，/／|｜\s]+|\s+vs\.?\s+/i)) {
      const word = w.trim();
      if (word && !out.includes(word)) out.push(word);
    }
    return out.slice(0, CMP_MAX_WORDS).join("・");
  }

  /* ---------------- remote: /api/store ---------------- */

  function readCode() {
    try {
      return localStorage.getItem(ACCESS_CODE_STORAGE_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  let codePrompt = null; // 401 が同時に来ても聞くのは1回
  function askCode() {
    if (!codePrompt) {
      codePrompt = Promise.resolve().then(() => {
        const code = (window.prompt("アクセスコード") || "").trim();
        try {
          localStorage.setItem(ACCESS_CODE_STORAGE_KEY, code);
        } catch (_) {}
        setTimeout(() => (codePrompt = null), 0);
        return code;
      });
    }
    return codePrompt;
  }

  async function call(method, url, body) {
    const send = (code) =>
      fetch(url, {
        method,
        headers: body ? { "content-type": "application/json", "x-access-code": code } : { "x-access-code": code },
        body: body ? JSON.stringify(body) : undefined
      });
    let code = readCode();
    if (!code) code = await askCode();
    let res = await send(code);
    if (res.status === 401) res = await send(await askCode());
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try {
        const data = await res.json();
        if (data && data.error && data.error.message) msg = data.error.message;
      } catch (_) {}
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  let saveQueue = [];
  let saveTimer = 0;
  function flushSaves() {
    saveTimer = 0;
    while (saveQueue.length) {
      const rows = saveQueue.splice(0, SAVE_BATCH);
      call("POST", ENDPOINT, { action: "save", rows }).catch((err) => console.warn("[store] save", err));
    }
  }

  const remote = {
    kind: "remote",
    history({ offset = 0, limit = 50, summary = false } = {}) {
      const q = new URLSearchParams({ action: "history", offset: String(offset), limit: String(limit) });
      if (summary) q.set("summary", "1");
      return call("GET", ENDPOINT + "?" + q.toString());
    },
    async entries(keys) {
      if (!keys.length) return [];
      const data = await call("POST", ENDPOINT, { action: "entries", keys });
      return (data && data.entries) || [];
    },
    recordLookup(query, mode, context, bump) {
      call("POST", ENDPOINT, { action: "lookup", query, mode, context: context || null, bump: bump !== false }).catch(
        (err) => console.warn("[store] lookup", err)
      );
    },
    save(rows) {
      saveQueue.push(...rows);
      if (!saveTimer) saveTimer = setTimeout(flushSaves, SAVE_FLUSH_MS);
    },
    // 履歴の1語と、その語の保存済みの答えを消す（漢字辞典の1字ごとの答えは共有なので残す）。失敗は呼び出し側へ投げる。
    async deleteLookup(query) {
      await call("POST", ENDPOINT, { action: "delete", query, cmpKey: cmpKeyOf(query) || null });
    }
  };
  window.addEventListener("pagehide", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      flushSaves();
    }
  });

  /* ---------------- local: localStorage ---------------- */

  const HIST_KEY = "lookup-store-history-v1";
  const ENT_KEY = "lookup-store-entries-v1";
  const LOCAL_HISTORY_MAX = 5000;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  const entKey = (level, mode, query) => level + "\t" + mode + "\t" + query;

  function writeEntries(map) {
    if (writeJson(ENT_KEY, map)) return;
    // 容量オーバー: 古い答えから4分の1を捨ててもう一度
    const keys = Object.keys(map).sort((a, b) => String(map[a].updated_at).localeCompare(String(map[b].updated_at)));
    for (const k of keys.slice(0, Math.ceil(keys.length / 4))) delete map[k];
    writeJson(ENT_KEY, map);
  }

  const local = {
    kind: "local",
    async history({ offset = 0, limit = 50, summary = false } = {}) {
      const all = readJson(HIST_KEY, []);
      const items = all.slice(offset, offset + limit).map((h) => ({ ...h }));
      if (summary) {
        const map = readJson(ENT_KEY, {});
        for (const item of items) {
          const e =
            (map[entKey("standard", "dict", item.query)] || map[entKey("gakusei", "dict", item.query)] || {}).entry;
          if (e) item.dict = { reading: e.reading || "", ja: e.ja || "", suggestion: e.suggestion || "" };
        }
      }
      return { items, total: all.length };
    },
    async entries(keys) {
      const want = new Set(keys);
      const map = readJson(ENT_KEY, {});
      const out = [];
      for (const [k, v] of Object.entries(map)) {
        const [level, mode, query] = k.split("\t");
        if (want.has(query)) out.push({ query, mode, level, entry: v.entry });
      }
      return out;
    },
    recordLookup(query, mode, context, bump) {
      const all = readJson(HIST_KEY, []);
      const now = new Date().toISOString();
      const i = all.findIndex((h) => h.query === query);
      let row = i >= 0 ? all[i] : null;
      if (row) {
        if (!row.modes.includes(mode)) row.modes.push(mode);
        if (context) row.context = context;
        if (bump !== false) {
          row.lookup_count += 1;
          row.last_looked_at = now;
          all.splice(i, 1);
          all.unshift(row);
        }
      } else {
        row = { query, context: context || null, modes: [mode], lookup_count: 1, first_looked_at: now, last_looked_at: now };
        all.unshift(row);
      }
      writeJson(HIST_KEY, all.slice(0, LOCAL_HISTORY_MAX));
    },
    save(rows) {
      const map = readJson(ENT_KEY, {});
      const now = new Date().toISOString();
      for (const r of rows) map[entKey(r.level, r.mode, r.query)] = { entry: r.entry, updated_at: now };
      writeEntries(map);
    },
    async deleteLookup(query) {
      const cmpKey = cmpKeyOf(query);
      writeJson(HIST_KEY, readJson(HIST_KEY, []).filter((h) => h.query !== query));
      const map = readJson(ENT_KEY, {});
      for (const k of Object.keys(map)) {
        const [, mode, q] = k.split("\t");
        if ((q === query && mode !== "jiten") || (mode === "cmp" && q === cmpKey)) delete map[k];
      }
      writeJson(ENT_KEY, map);
    }
  };

  window.LookupStore = { ...(hosted ? remote : local), levelOf };
})();
