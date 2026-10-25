// prompts.js — リトリーブのパネルが Claude に送るプロンプトをすべてここに集める。
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

// ── もしかして（辞書・漢字表記で共通）────────────
// 解析: parseSuggestion / 候補:（なし のときは空。どのラベルより先に読む）
// Q が実在の語・表記でない（打ちまちがい・漢字ちがい・賞も無い のような変換ミス）ときだけ 候補 を埋めさせ、
// そのときは 候補 の行だけ返させる。アプリは「もしかして」だけを出し、推測の定義や表記はキャッシュに残らない。
// 変換ミスは打った読みのまま（賞も無い → しょうもない。仕様もない／しようもない は読みがちがう）。
function buildSuggestionRules() {
  return [
    "First decide whether Q is an established Japanese word, phrase or spelling.",
    "If it is not (a typo, a wrong kanji, or a bad kana-kanji conversion such as 賞も無い for しょうもない), put the word the writer most likely meant, spelled the usual way, in 候補, and output ONLY the 候補 line. Do not answer for Q itself.",
    "A bad conversion keeps the reading the writer typed, so 候補 must have the same reading as Q (賞も無い is read しょうもない, so 候補 is しょうもない, not しようもない).",
    "Rare, literary, archaic, dialect and slang words, proper nouns, inflected forms, kana spellings of real words, and established alternate spellings (綺麗・奇麗・きれい) all count as established. For those, or whenever you are unsure, write 候補: なし and continue."
  ];
}

// ── 辞書 ──────────────────────────────
// 解析: parseDictResponse / 候補:, 読み:, JA:
// 辞書: Sonnet で定義（JA）だけを作る。英訳は「英訳を表示」で fetchEnOnly（Haiku）が JA から訳す。
// 2026-10-08: Haiku + 短い定義の指示で「口が減らない＝おしゃべり」のような字面どおりの誤訳が出たため変更。
function buildFreeLookupPrompt(query) {
  return [
    "Define this Japanese word or phrase the way a careful monolingual dictionary (大辞林・明鏡国語辞典) would.",
    ...buildSuggestionRules(),
    "- Idiom (慣用句), proverb or set phrase: give its established idiomatic meaning. Never build the meaning from the literal parts.",
    "- Convey any connotation or register the word carries (disapproving, ironic, humble, praising, colloquial, literary, etc.).",
    "- If it has more than one distinct sense in common use, number them ①②③, most standard first.",
    "- Give the standard meaning first. If a newer or alternate usage is now widespread, add it after, marked 〔新〕. If dictionaries treat that usage as a mistake, say so (誤用とされる).",
    "- If you are not sure of a meaning, say so briefly instead of guessing.",
    "Output these 3 lines in this order and nothing else (only the 候補 line when 候補 is not なし):",
    "候補: <most likely intended word, or なし>",
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
// 解析: parseJitenResponse / 字:, 訓:, 音:, 意味:, EN:, 語:（語は1行に 単語｜よみ｜意味 を1つ。語: の行をくり返す）
// 2026-10-20: 1行に ; 区切りで並べさせたら 、 や ｜ で区切ってくることがあったので、1語1行にした。
// 2026-10-21: 「4〜6語」だと、語の少ない字（逞）で同じ語を意味ごとにくり返して数を埋めたので、「最大6語・同じ語は1回」にした。
// 表示順は 訓 → 音 → 意味 → EN（renderJitenCard）。パーサーはラベルで読むので行の順番は自由。
function buildJitenPrompt(ch, query) {
  const lines = [
    "Kanji dictionary entry for this single kanji, as used in modern Japanese.",
    "Output these lines and nothing else:",
    "字: <the kanji>",
    "訓: <kun'yomi in hiragana, separated by 、 (mark okurigana with a dot, e.g. い.きる), or なし if none>",
    "音: <on'yomi in katakana, separated by 、, or なし if none>",
    "意味: <its general meaning(s) in short Japanese, senses separated by 、>",
    "EN: <2-4 short English keywords>",
    "語: 単語｜よみ｜短い意味",
    "語: 単語｜よみ｜短い意味",
    "語: … (one 語 line per word)",
    "",
    "Readings: list the standard (常用) readings first, most common first. Add a rare reading only if it is well known.",
    "語: up to " + JITEN_MAX_WORDS + " common words that contain this kanji, most common first, mixing on and kun readings when both are common. Each word must contain the kanji. Short meanings in Japanese.",
    "Each 語 line must be a different word. Never repeat a word to list its other senses; put all its senses in its one meaning, separated by 、.",
    "If the kanji has only a few common words, list only those (even just 1). Fewer real words beat padding.",
    "Put each word on its own 語 line: exactly one 単語｜よみ｜意味 per line, never two words on one line.",
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
// 解析: parseKanjiResponse / 候補:, 形:, 補足:, 使用:（0〜4）, 表記:
// 2026-10-25: 形 に同じ読みの別の語（類義語）が入ることと、補足 と 使用 が食いちがうことがあったので、
// 「形 は Q と同じ語・同じ読み」「使用・表記 は 補足 と同じ判断」を足し、補足 を 使用 より先に書かせる。
// パーサーはラベルで読むので行の順番は自由。
function buildKanjiPrompt(query, context) {
  const lines = [
    "Judge how this Japanese word is normally written in modern Japanese.",
    ...buildSuggestionRules(),
    "形 must be a spelling of the same word as Q, with the same reading. Never give a synonym or a different word with a similar meaning. If the word itself has no established kanji spelling, write なし.",
    "補足 states your judgment. 使用 and 表記 must express that same judgment (e.g. if 補足 says the word is usually written in kana, 使用 is 2 and 表記 is kana).",
    "Output these 5 lines in this order and nothing else (only the 候補 line when 候補 is not なし):",
    "候補: <most likely intended word, or なし>",
    "形: <principal kanji spelling, or なし if no established kanji spelling exists>",
    "補足: <one short Japanese sentence for a learner: how the word is usually written>",
    "使用: <0-4>",
    "表記: <kana | either | kanji>",
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
