// prompts.js — 調べるパネルが Claude に送るプロンプトをすべてここに集める。
// lookup.html と vocab_clicker.html の両方で、vocab_clicker.js より前に読み込む（普通の <script>。ここの名前はそのまま共有される）。
//
// 文言は自由に変えてよい。ただし各プロンプトは「ラベル: 内容」の行で返させていて、
// vocab_clicker.js のパーサーがそのラベルで読む。ラベル名と行の形（｜ や ; の区切り）は変えないこと。
// 各プロンプトの上に「解析: 関数名 / ラベル」を書いてある。
// JITEN_MAX_WORDS と CMP_LETTERS は vocab_clicker.js 側の定数（パーサーと共有）。

const CLAUDE_MODEL = "claude-haiku-4-5";
const CLAUDE_MODEL_SONNET = "claude-sonnet-4-5";

// モード別の設定。temperature を省くと 0。max_tokens は Vercel のプロキシ側で 1024 が上限（api/claude.js）。
const PROMPT_SETTINGS = {
  dict:     { model: CLAUDE_MODEL_SONNET, maxTokens: 400,  temperature: 0 },   // 辞書（定義）
  en:       { model: CLAUDE_MODEL,        maxTokens: 200,  temperature: 0 },   // 辞書（英訳を表示）
  sentence: { model: CLAUDE_MODEL_SONNET, maxTokens: 256,  temperature: 0.9 }, // 例文: 毎回ちがう文がほしいので高め
  jiten:    { model: CLAUDE_MODEL_SONNET, maxTokens: 480,  temperature: 0 },   // 漢字辞典（1字1リクエスト）
  thes:     { model: CLAUDE_MODEL,        maxTokens: 280,  temperature: 0 },   // 類義語
  cmp:      { model: CLAUDE_MODEL_SONNET, maxTokens: 1000, temperature: 0 },   // 使い分け
  kanji:    { model: CLAUDE_MODEL_SONNET, maxTokens: 220,  temperature: 0 }    // 漢字表記
};

// ── 辞書 ──────────────────────────────
// 解析: parseDictResponse / 読み:, JA:
// 辞書: Sonnet で定義（JA）だけを作る。英訳は「英訳を表示」で fetchEnOnly（Haiku）が JA から訳す。
// 2026-10-08: Haiku + 短い定義の指示で「口が減らない＝おしゃべり」のような字面どおりの誤訳が出たため変更。
function buildFreeLookupPrompt(query) {
  return [
    "Define this Japanese word or phrase the way a careful monolingual dictionary (大辞林・明鏡国語辞典) would.",
    "- Idiom (慣用句), proverb or set phrase: give its established idiomatic meaning. Never build the meaning from the literal parts.",
    "- Convey any connotation or register the word carries (disapproving, ironic, humble, praising, colloquial, literary, etc.).",
    "- If it has more than one distinct sense in common use, number them ①②③, most standard first.",
    "- Give the standard meaning first. If a newer or alternate usage is now widespread, add it after, marked 〔新〕. If dictionaries treat that usage as a mistake, say so (誤用とされる).",
    "- If you are not sure of a meaning, say so briefly instead of guessing.",
    "Output exactly 2 lines and nothing else:",
    "読み: <hiragana; katakana if that is normal>",
    "JA: <Japanese definition, all on ONE line>",
    "",
    "Q: " + query
  ].join("\n");
}

// 英訳を表示: 上の JA 定義を英語にするだけ。返すのは1行の英文（ラベルなし）。
function buildEnOnlyPrompt(word, reading, ja) {
  return [
    "Translate this Japanese dictionary definition into a short English gloss.",
    "Translate only what the definition says. Do not add a literal word-by-word reading of the headword.",
    "Keep sense numbers (①②) only if the definition has them. Render 〔新〕 as \"(newer usage)\".",
    "Output ONLY the English gloss on one line. No quotes or labels.",
    "",
    "Word: " + word,
    "Reading: " + reading,
    "JA: " + ja
  ].join("\n");
}

// ── 例文 ──────────────────────────────
// 解析: parseSentenceResponse / JA:, EN:
function buildSentencePrompt(query, context, previous) {
  const avoid = previous.length
    ? "Do not repeat or closely paraphrase any of these previous Japanese sentences:\n" + previous.map((s) => "- " + s.ja).join("\n") + "\n"
    : "";
  const lines = [
    "Write exactly one simple, natural Japanese example sentence that uses this vocabulary word.",
    "Use a different everyday or literary situation so the learner sees varied usage.",
    "Also give a natural English translation of that sentence.",
    "Output exactly two lines and nothing else:",
    "JA: <Japanese sentence>",
    "EN: <English translation>",
    "No quotes, no reading, no commentary.",
    "",
    "Word: " + query
  ];
  if (context && context.reading) lines.push("Reading: " + context.reading);
  if (context && context.meaning) lines.push("Meaning: " + context.meaning);
  if (avoid) lines.push(avoid);
  return lines.join("\n");
}

// ── 漢字辞典 ────────────────────────────
// 解析: parseJitenResponse / 字:, 意味:, EN:, 音:, 訓:, 語:（語は 単語｜よみ｜意味 を ; で区切る）
function buildJitenPrompt(ch, query) {
  const lines = [
    "Kanji dictionary entry for this single kanji, as used in modern Japanese.",
    "Output exactly 6 lines and nothing else:",
    "字: <the kanji>",
    "意味: <its general meaning(s) in short Japanese; separate senses with 、>",
    "EN: <2-4 short English keywords>",
    "音: <on'yomi in katakana, separated by 、 ; なし if none>",
    "訓: <kun'yomi in hiragana, separated by 、 ; mark okurigana with a dot, e.g. い.きる ; なし if none>",
    "語: 単語｜よみ｜短い意味; 単語｜よみ｜短い意味",
    "",
    "Readings: list the standard (常用) readings first, most common first; add a rare reading only if it is well known.",
    "語: 4 to " + JITEN_MAX_WORDS + " common words that contain this kanji, most common first, mixing on and kun readings when both are common. Each word must contain the kanji. Short meanings in Japanese.",
    "No quotes, furigana in parentheses, or extra commentary.",
    "",
    "Kanji: " + ch
  ];
  if (query && query !== ch) lines.push("(Looked up from the word: " + query + ")");
  return lines.join("\n");
}

// ── 類義語 ─────────────────────────────
// 解析: parseThesResponse / 類義:, 対義:（単語｜よみ｜意味 を ; で区切る。空なら なし）
function buildThesPrompt(query, context) {
  const lines = [
    "List close synonyms and antonyms for this Japanese word.",
    "Prefer なし over a weak match.",
    "Output exactly 2 lines and nothing else:",
    "類義: 単語｜よみ｜短い意味; 単語｜よみ｜短い意味",
    "対義: 単語｜よみ｜短い意味",
    "Up to 4 synonyms and 3 antonyms. Use なし when a list is empty.",
    "No quotes or extra commentary.",
    "",
    "Q: " + query
  ];
  if (context && context.reading) lines.push("Reading: " + context.reading);
  if (context && context.meaning) lines.push("Meaning: " + context.meaning);
  return lines.join("\n");
}

// ── 使い分け ────────────────────────────
// 2〜3語（1語ならモデルが近い語を選ぶ）の違い。words は入力を区切った配列。
// 解析: parseCmpResponse / 語:, 要点:, A:, 例A:, B:, 例B:, C:, 例C:, 共通:
function buildCmpPrompt(words, context) {
  const single = words.length === 1;
  const lines = [
    single
      ? "One Japanese word is given as A. First pick 1 or 2 established near-synonyms (same part of speech) that learners commonly confuse with it, as B and C. Then compare them."
      : "Compare these Japanese words. Their meanings overlap.",
    "Dictionary definitions describe each word on its own. The learner already knows roughly what each means; explain how they differ in actual use, and when to pick which.",
    "Consider whichever of these actually matter here: typical situations and collocations, register (formal/written vs casual/spoken, official vs everyday), what each one focuses on, restrictions on what can be the subject or object, connotation or emotional color.",
    "Skip differences that don't matter in practice. If two are near-interchangeable, say so and give the closest real difference.",
    "Write in natural Japanese for an advanced learner. Output these lines in this order and nothing else:",
    "語: the words compared, joined with ・, in the order A・B" + (single || words.length > 2 ? "・C" : ""),
    "要点: 1 to 2 sentences giving the core difference",
    "Then for each word X (A, B" + (single || words.length > 2 ? ", C" : "") + "):",
    "X: 1 to 2 sentences on how X is typically used (situations, typical partner words, register)",
    "例X: one short natural sentence where X fits and the other word(s) would sound wrong or change the meaning",
    "Finally:",
    "共通: one short sentence where all of them work, or なし",
    "Use the labels literally (語, 要点, A, 例A, B, 例B" + (single || words.length > 2 ? ", C, 例C" : "") + ", 共通). Don't write readings. No quotes, markdown, or extra commentary.",
    ""
  ];
  words.forEach((w, i) => lines.push(CMP_LETTERS[i] + ": " + w));
  if (single && context && context.meaning) lines.push("Meaning of A in the learner's context: " + context.meaning);
  return lines.join("\n");
}

// ── 漢字表記 ────────────────────────────
// 解析: parseKanjiResponse / 形:, 使用:（0〜4）, 表記:, 補足:
function buildKanjiPrompt(query, context) {
  const lines = [
    "Judge how this Japanese word is normally written in modern Japanese.",
    "Output exactly 4 lines and nothing else:",
    "形: <principal kanji spelling, or なし if no established kanji spelling exists>",
    "使用: <0-4>",
    "表記: <kana | either | kanji>",
    "補足: <one short Japanese sentence for a learner>",
    "",
    "使用 scale:",
    "0 = no established kanji spelling",
    "1 = rare or archaic kanji exists; avoid writing it",
    "2 = kanji is valid but the word is usually written in kana",
    "3 = kana and kanji are both common",
    "4 = normally written in kanji",
    "",
    "Q: " + query
  ];
  if (context && context.reading) lines.push("Reading: " + context.reading);
  if (context && context.meaning) lines.push("Meaning: " + context.meaning);
  return lines.join("\n");
}
