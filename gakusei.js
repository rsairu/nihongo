// 小6モード (gakusei_mode): 返ってくる説明文をすべて小学6年生が読めるレベルにする共通ハーネス。
// Loaded two ways:
//   - Vercel function:  const Gakusei = require("../gakusei.js")
//   - Browser:          <script src="gakusei.js"></script>  → window.Gakusei
// The browser uses it only when it talks to Anthropic directly (local dev with config.js key);
// on the hosted site it just sends `gakusei_mode` and the proxy applies the harness.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Gakusei = api;
})(typeof self !== "undefined" ? self : this, function () {
  const PARAM = "gakusei_mode";

  // Injected as the system prompt. Every feature (辞書・漢字表記・例文・類義語・漢字辞典・英訳) builds its own
  // strict line format in the user message, so this only changes the *register* of explanatory text
  // and explicitly protects the data fields the client parsers depend on.
  const SYSTEM_PROMPT = [
    "GAKUSEI MODE: the reader is a 6th-grade student (about 11-12 years old). Apply this to every part of your reply.",
    "",
    "Make all explanatory text easy for them to read:",
    "- Japanese explanations (definitions, notes, short meanings, example sentences): write like a book for a Japanese elementary-school 6th grader. Short sentences, everyday words. Use only kanji taught in elementary school (教育漢字); write any other word in hiragana.",
    "- English text (glosses, translations): plain words a US 6th grader knows, short and concrete, no jargon or grammar terms.",
    "- Keep the meaning accurate. Simpler, never wrong or vague.",
    "",
    "Never simplify or replace these; they are data, not explanation:",
    "- the word being asked about, its reading, and its kanji spelling (write the real spelling even if it is hard);",
    "- synonym/antonym headwords (must be real words; only their short meanings become simpler);",
    "- in a kanji dictionary entry: the kanji, its on/kun readings, and the listed words containing it (real, common words; only their short meanings become simpler);",
    "- in example sentences, the target word itself, written exactly as given;",
    "- numbers, scores, and fixed category values such as kana / either / kanji.",
    "",
    "Follow the output format in the user message exactly: the same line labels, the same number of lines, the same separators. No furigana in parentheses, no extra lines or commentary."
  ].join("\n");

  // Step 1: request validation. Optional; when present it must be a real boolean.
  function readFlag(body) {
    const value = body ? body[PARAM] : undefined;
    if (value === undefined || value === null) return { ok: true, enabled: false };
    if (typeof value !== "boolean") {
      return { ok: false, enabled: false, error: PARAM + " must be a boolean" };
    }
    return { ok: true, enabled: value };
  }

  // Step 2: request side of the harness. Returns a new Anthropic Messages body.
  function applyRequest(upstreamBody, enabled) {
    if (!enabled) return upstreamBody;
    const existing = typeof upstreamBody.system === "string" ? upstreamBody.system.trim() : "";
    return {
      ...upstreamBody,
      system: existing ? SYSTEM_PROMPT + "\n\n" + existing : SYSTEM_PROMPT
    };
  }

  // Step 3: response formatting layer, run on the Anthropic payload before it goes back to the client.
  // Tidies text blocks (furigana in parentheses would break the parsers and clutter the display) and
  // stamps the payload so clients can tell which level they received.
  const FURIGANA_AFTER_KANJI = /([㐀-鿿豈-﫿々〆ヶ]+)[（(]([ぁ-ゟ゠-ヿー]+)[）)]/g;

  function tidyText(text) {
    return String(text).replace(FURIGANA_AFTER_KANJI, "$1");
  }

  function formatResponse(data, enabled) {
    if (!data || typeof data !== "object") return data;
    if (!enabled) return { ...data, [PARAM]: false };
    const content = Array.isArray(data.content)
      ? data.content.map((b) => (b && b.type === "text" ? { ...b, text: tidyText(b.text) } : b))
      : data.content;
    return { ...data, content, [PARAM]: true };
  }

  return { PARAM, SYSTEM_PROMPT, readFlag, applyRequest, formatResponse, tidyText };
});
