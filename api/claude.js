// Vercel serverless proxy for the Anthropic Messages API.
// Env vars (Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  your real key (never sent to the browser)
//   ACCESS_CODE        passcode the browser must send, so strangers can't spend your credits
//
// Request body: { model, messages, max_tokens?, temperature?, gakusei_mode? }
//   gakusei_mode  optional boolean. true → every returned explanation is written for a
//                 6th-grade reader (see ../gakusei.js). false / omitted → unchanged.
const Gakusei = require("../gakusei.js");

const ALLOWED_MODELS = new Set(["claude-haiku-4-5", "claude-sonnet-4-5"]);
const MAX_TOKENS_CAP = 1024;

// 1. Validation: returns { ok, error } and never touches the body.
function validateRequest(b) {
  if (!ALLOWED_MODELS.has(b.model) || !Array.isArray(b.messages)) {
    return { ok: false, error: "bad request" };
  }
  const flag = Gakusei.readFlag(b);
  if (!flag.ok) return { ok: false, error: flag.error };
  return { ok: true };
}

// 2. Middleware: detect the override once and hang it on the request for later stages.
function gakuseiMiddleware(req) {
  req.gakusei = Gakusei.readFlag(req.body || {}).enabled;
  return req;
}

function buildUpstreamBody(b, gakusei) {
  const base = {
    model: b.model,
    max_tokens: Math.min(Number(b.max_tokens) || 256, MAX_TOKENS_CAP),
    temperature: b.temperature,
    messages: b.messages
  };
  return Gakusei.applyRequest(base, gakusei);
}

// 3. Response formatting: last stop before the payload goes back to the client.
function formatResponse(status, rawText, gakusei) {
  if (status < 200 || status >= 300) return rawText; // pass errors through untouched
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (_) {
    return rawText;
  }
  return JSON.stringify(Gakusei.formatResponse(data, gakusei));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: { message: "POST only" } });
  }
  const key = process.env.ANTHROPIC_API_KEY;
  const code = process.env.ACCESS_CODE;
  if (!key || !code) {
    return res.status(500).json({ error: { message: "サーバー未設定 (ANTHROPIC_API_KEY / ACCESS_CODE)" } });
  }
  if (req.headers["x-access-code"] !== code) {
    return res.status(401).json({ error: { message: "アクセスコードが違います" } });
  }

  const b = req.body || {};
  const valid = validateRequest(b);
  if (!valid.ok) {
    return res.status(400).json({ error: { message: valid.error } });
  }
  gakuseiMiddleware(req);

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(buildUpstreamBody(b, req.gakusei))
  });
  const payload = formatResponse(upstream.status, await upstream.text(), req.gakusei);
  res.setHeader("x-gakusei-mode", req.gakusei ? "1" : "0");
  res.status(upstream.status).setHeader("content-type", "application/json").send(payload);
};
