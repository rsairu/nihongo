// Vercel serverless function: the 調べる page's saved lookups, kept in Supabase.
// Env vars (Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL               https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  server-only key (never sent to the browser); RLS stays closed to everyone else
//   ACCESS_CODE                same passcode as api/claude.js
// Tables and the record_lookup function: db/schema.sql.
//
// GET  ?action=history&offset=0&limit=50[&summary=1]
//        → { items: [{query, context, modes, lookup_count, first_looked_at, last_looked_at, dict?}], total }
//        summary=1 adds dict: {reading, ja} from the saved 辞書 answer (standard level first).
// POST { action: "entries", keys: [...] }
//        → { entries: [{query, mode, level, entry}] }   every saved answer whose cache key is in keys
// POST { action: "lookup", query, mode, context?, bump? }
//        → 204   inserts the word or bumps lookup_count / adds the mode (record_lookup)
// POST { action: "save", rows: [{query, mode, level, entry, model?}] }
//        → 204   upserts answers on (query, mode, level)

const MODES = new Set(["dict", "kanji", "sentence", "thes", "cmp", "jiten"]);
const LEVELS = new Set(["standard", "gakusei"]);
const MAX_QUERY = 200;
const MAX_KEYS = 200;
const MAX_SAVE_ROWS = 20;
const MAX_ENTRY_BYTES = 64 * 1024;
const MAX_PAGE = 100;

function supabase(path, init) {
  const base = process.env.SUPABASE_URL.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(base + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: key,
      authorization: "Bearer " + key,
      "content-type": "application/json",
      ...(init && init.headers)
    }
  });
}

async function expectOk(res) {
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  const err = new Error("supabase " + res.status + ": " + text.slice(0, 300));
  err.status = 502;
  throw err;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function cleanQuery(q) {
  const s = typeof q === "string" ? q.trim() : "";
  if (!s || s.length > MAX_QUERY) throw badRequest("bad query");
  return s;
}

// PostgREST in.(…) list: every value double-quoted, with " and \ escaped.
function inList(values) {
  return "in.(" + values.map((v) => '"' + v.replace(/["\\]/g, "\\$&") + '"').join(",") + ")";
}

async function history(params) {
  const offset = Math.max(0, parseInt(params.offset, 10) || 0);
  const limit = Math.min(MAX_PAGE, Math.max(1, parseInt(params.limit, 10) || 50));
  const res = await expectOk(
    await supabase(
      "lookup_history?select=query,context,modes,lookup_count,first_looked_at,last_looked_at" +
        "&order=last_looked_at.desc,id.desc&offset=" + offset + "&limit=" + limit,
      { headers: { prefer: "count=exact" } }
    )
  );
  const items = await res.json();
  const range = res.headers.get("content-range") || "";
  const total = parseInt(range.split("/")[1], 10);

  if (params.summary === "1" && items.length) {
    const dictRes = await expectOk(
      await supabase(
        "lookup_entries?select=query,level,entry&mode=eq.dict&query=" +
          encodeURIComponent(inList(items.map((i) => i.query)))
      )
    );
    const byQuery = {};
    for (const row of await dictRes.json()) {
      if (!byQuery[row.query] || row.level === "standard") byQuery[row.query] = row.entry;
    }
    for (const item of items) {
      const e = byQuery[item.query];
      if (e) item.dict = { reading: e.reading || "", ja: e.ja || "" };
    }
  }
  return { items, total: Number.isFinite(total) ? total : items.length };
}

async function entries(body) {
  const keys = Array.isArray(body.keys) ? body.keys : [];
  const clean = [...new Set(keys.filter((k) => typeof k === "string" && k && k.length <= MAX_QUERY))].slice(0, MAX_KEYS);
  if (!clean.length) return { entries: [] };
  const res = await expectOk(
    await supabase("lookup_entries?select=query,mode,level,entry&query=" + encodeURIComponent(inList(clean)))
  );
  return { entries: await res.json() };
}

async function recordLookup(body) {
  const query = cleanQuery(body.query);
  if (!MODES.has(body.mode)) throw badRequest("bad mode");
  const context = body.context && typeof body.context === "object" ? body.context : null;
  await expectOk(
    await supabase("rpc/record_lookup", {
      method: "POST",
      body: JSON.stringify({ p_query: query, p_mode: body.mode, p_context: context, p_bump: body.bump !== false })
    })
  );
}

async function save(body) {
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_SAVE_ROWS) : [];
  if (!rows.length) throw badRequest("no rows");
  const now = new Date().toISOString();
  const clean = rows.map((r) => {
    if (!r || !MODES.has(r.mode) || !LEVELS.has(r.level)) throw badRequest("bad row");
    if (r.entry == null || typeof r.entry !== "object") throw badRequest("bad entry");
    if (JSON.stringify(r.entry).length > MAX_ENTRY_BYTES) throw badRequest("entry too large");
    return {
      query: cleanQuery(r.query),
      mode: r.mode,
      level: r.level,
      entry: r.entry,
      model: typeof r.model === "string" ? r.model.slice(0, 80) : null,
      updated_at: now
    };
  });
  // One row per (query, mode, level) — Postgres rejects an upsert that hits the same key twice.
  const unique = [...new Map(clean.map((r) => [r.query + "\n" + r.mode + "\n" + r.level, r])).values()];
  await expectOk(
    await supabase("lookup_entries?on_conflict=query,mode,level", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(unique)
    })
  );
}

module.exports = async function handler(req, res) {
  const code = process.env.ACCESS_CODE;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !code) {
    return res.status(500).json({ error: { message: "サーバー未設定 (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ACCESS_CODE)" } });
  }
  if (req.headers["x-access-code"] !== code) {
    return res.status(401).json({ error: { message: "アクセスコードが違います" } });
  }

  try {
    if (req.method === "GET") {
      const params = req.query || {};
      if (params.action !== "history") throw badRequest("unknown action");
      res.setHeader("cache-control", "no-store");
      return res.status(200).json(await history(params));
    }
    if (req.method === "POST") {
      const body = req.body || {};
      if (body.action === "entries") return res.status(200).json(await entries(body));
      if (body.action === "lookup") {
        await recordLookup(body);
        return res.status(204).end();
      }
      if (body.action === "save") {
        await save(body);
        return res.status(204).end();
      }
      throw badRequest("unknown action");
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: { message: "GET or POST only" } });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: { message: status >= 500 ? "保存先に接続できませんでした" : err.message } });
  }
};
