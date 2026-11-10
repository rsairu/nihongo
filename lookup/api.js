// Claude への送信。ローカルは config.js のキーで直接、公開版は /api/claude（パスコード付き）経由。
// プロンプト本文・モデル・トークン数は prompts.js。ここは送るだけ。

function apiKey() {
  return typeof CLAUDE_API_KEY === "string" ? CLAUDE_API_KEY : "";
}

function hasApiKey() {
  const key = apiKey();
  return Boolean(key) && key !== "PASTE_KEY_HERE";
}

// Hosted (Vercel): no key in the browser; requests go through /api/claude, gated by a passcode.
const PROXY_URL = "/api/claude";

const ACCESS_CODE_STORAGE_KEY = "vocab_clicker_access_code";
const useProxy = () => !hasApiKey() && /^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);

function getAccessCode(forcePrompt) {
  let code = "";
  try { code = localStorage.getItem(ACCESS_CODE_STORAGE_KEY) || ""; } catch (_) {}
  if (!code || forcePrompt) {
    code = (window.prompt("アクセスコード") || "").trim();
    try { localStorage.setItem(ACCESS_CODE_STORAGE_KEY, code); } catch (_) {}
  }
  return code;
}

// 直接 Anthropic に送るとき（ローカル + config.js のキー）はここでハーネスをかける。
// プロキシ経由ではフラグだけ送り、サーバー側 (api/claude.js) が同じ gakusei.js でかける。
const GakuseiHarness = typeof Gakusei === "object" && Gakusei ? Gakusei : null;

// 5.5 世代は考える（thinking）のが既定。考えないモード（PROMPT_SETTINGS の thinking: false）は、モデルごとに切り方がちがう。
// Opus 5.5 は切れない（null を返すので thinking は送らず、effort だけで量を決める）。
function thinkingOffFor(model) {
  if (/^claude-haiku-5-5/.test(model)) return { type: "disabled" };
  if (/^claude-sonnet-5-5/.test(model)) return { type: "between_tools" };
  return null;
}

// cfg は PROMPT_SETTINGS の1つ（model, maxTokens, effort, thinking）。temperature は送らない（5.5 世代は 400）。
function buildClaudeBody(prompt, cfg, wantGakusei) {
  const model = cfg.model || CLAUDE_MODEL;
  const base = {
    model,
    max_tokens: cfg.maxTokens,
    messages: [{ role: "user", content: prompt }]
  };
  if (cfg.effort) base.output_config = { effort: cfg.effort };
  const off = cfg.thinking ? null : thinkingOffFor(model);
  if (off) base.thinking = off;
  if (useProxy()) return JSON.stringify(wantGakusei ? { ...base, gakusei_mode: true } : base);
  if (wantGakusei && GakuseiHarness) return JSON.stringify(GakuseiHarness.applyRequest(base, true));
  return JSON.stringify(base);
}

// prompts.js の PROMPT_SETTINGS（モデル・max_tokens・effort・thinking）で送る。noGakusei のモードは小6モードでもハーネスなし。
function requestPrompt(kind, prompt, signal) {
  return requestClaudeText(prompt, PROMPT_SETTINGS[kind], signal);
}

async function requestClaudeText(prompt, cfg, signal) {
  const direct = !useProxy();
  const wantGakusei = gakuseiMode && !cfg.noGakusei;
  const body = buildClaudeBody(prompt, cfg, wantGakusei);
  const send = (code) =>
    useProxy()
      ? fetch(PROXY_URL, { method: "POST", headers: { "content-type": "application/json", "x-access-code": code }, body, signal })
      : fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey(),
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body,
          signal
        });

  let res = await send(useProxy() ? getAccessCode(false) : "");
  if (res.status === 401 && useProxy()) res = await send(getAccessCode(true));

  let data = await res.json();
  if (!res.ok) {
    const msg = (data.error && data.error.message) || ("HTTP " + res.status);
    throw new Error(msg);
  }
  if (direct && GakuseiHarness) data = GakuseiHarness.formatResponse(data, wantGakusei);

  // 考えたモデルの返事は thinking ブロックが先に来るので、text ブロックだけをつなぐ
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  // 考えるのに max_tokens を使い切って本文が出なかったとき（PROMPT_SETTINGS の maxTokens が足りない）
  if (!text.trim() && data.stop_reason === "max_tokens") throw new Error("max_tokens に届きました（考える分が足りません）");
  return text;
}
