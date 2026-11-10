// prompts.js — リトリーブのパネルが Claude に送るプロンプトをすべてここに集める。
// lookup.html と vocab_clicker.html の両方で、lookup/ の各ファイルより前に読み込む（普通の <script>。ここの名前はそのまま共有される）。
//
// 文言は自由に変えてよい。ただし各プロンプトは「ラベル: 内容」の行で返させていて、
// lookup/modes/*.js のパーサーがそのラベルで読む。ラベル名と行の形（｜ や ; の区切り）は変えないこと。
// 各プロンプトの上に「解析: 関数名 / ラベル」を書いてある。
// JITEN_MAX_WORDS と CMP_LETTERS は lookup/modes/jiten.js・cmp.js 側の定数（パーサーと共有）。

const CLAUDE_MODEL = "claude-haiku-5-5";
const CLAUDE_MODEL_SONNET = "claude-sonnet-5-5";
const CLAUDE_MODEL_OPUS = "claude-opus-5-5";

// モード別の設定。
// 2026-11-09: 4.5 世代から 5.5 世代へ。5.5 世代は API の決まりが変わった:
//   - temperature は送れない（既定値以外は 400）。どのモードも送らない。例文の「毎回ちがう文」はプロンプトの指示と前の文の一覧で出す。
//   - 考える（adaptive thinking）のが既定。考えた分も max_tokens に数えられるので、ほかのモードは thinking: false で切る
//     （Haiku は {type:"disabled"}、Sonnet は {type:"between_tools"}。lookup/api.js の thinkingOffFor）。
//     Opus 5.5 は切れない。effort で考える量を決める。
//   - トークナイザーが変わり、同じ文が約3割多いトークンになる。max_tokens はそのぶん増やした（使った分しかかからない）。
// effort: low | medium | high（考えない設定のモデルは high まで）。max_tokens の上限は Vercel のプロキシ側（api/claude.js）。
// noGakusei: true のモードは小6モードのハーネスをかけない（lookup/api.js の requestPrompt / lookup/saved.js の persistModeEntry）。
const PROMPT_SETTINGS = {
  dict:     { model: CLAUDE_MODEL_SONNET, maxTokens: 520,  effort: "high", thinking: false }, // 辞書（定義）
  en:       { model: CLAUDE_MODEL,        maxTokens: 260,  effort: "high", thinking: false }, // 辞書（英訳を表示）
  gloss:    { model: CLAUDE_MODEL,        maxTokens: 80,   effort: "high", thinking: false }, // 辞書（訳語を表示）: 訳 のない保存済みの答えだけ
  sentence: { model: CLAUDE_MODEL_SONNET, maxTokens: 340,  effort: "high", thinking: false }, // 例文
  jiten:    { model: CLAUDE_MODEL_SONNET, maxTokens: 640,  effort: "high", thinking: false }, // 漢字辞典（1字1リクエスト）
  thes:     { model: CLAUDE_MODEL,        maxTokens: 370,  effort: "high", thinking: false }, // 類義語
  cmp:      { model: CLAUDE_MODEL_SONNET, maxTokens: 1300, effort: "high", thinking: false }, // 使い分け
  kanji:    { model: CLAUDE_MODEL_SONNET, maxTokens: 290,  effort: "high", thinking: false }, // 漢字表記
  // ふりがな: 読みだけ。文を入れることもあるので max_tokens は多め（使った分しかかからない）。
  // noGakusei: 読みは小6モードでも同じなので、ハーネスをかけず、答えも2つのレベルで共有する（保存は standard）。
  furi:     { model: CLAUDE_MODEL_SONNET, maxTokens: 1300, effort: "high", thinking: false, noGakusei: true },
  // 言い回し: 「ふつうに言うか」の判定は知識と判断が要るので Opus で考えさせる（Opus 5.5 は考えるのを切れない）。
  // 返事は 150〜300 トークンほど。残りは考える分。medium で足りないとき（判定がぶれる）は high にして max_tokens も増やす。
  iimawashi: { model: CLAUDE_MODEL_OPUS,  maxTokens: 4096, effort: "medium", thinking: true }
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
// 解析: parseDictResponse / 候補:, 読み:, 表記:, 同音:（、区切り）, JA:, 訳:
// 辞書: Sonnet で定義（JA）を作る。英訳は「英訳を表示」で fetchEnOnly（Haiku）が JA から訳す。
// 2026-10-08: Haiku + 短い定義の指示で「口が減らない＝おしゃべり」のような字面どおりの誤訳が出たため変更。
// 2026-10-25: 訳:（語そのものの英語の訳語。定義の訳ではない）を同じ返事に足した。出力が10〜20トークン増えるだけで、別リクエストはいらない。
// 「訳語を表示」で読みの横に出す。訳 のない保存済みの答えだけ buildGlossPrompt（Haiku）で後から取る。
// 2026-11-05: かなだけで引いたとき、①②③ に同音の別の語（はし: 橋・箸・端）が混ざるか、どれか1語を黙って選んでいたので、
// 表記:（定義した語の漢字。とても珍しい漢字なら なし）と 同音:（同じ読みのほかの語。最大4語）を足した。
// 定義は いちばんよく指す1語だけ。アプリは 読み【表記】 と、同音語のボタン（押すとその漢字で辞書を引く）を出す。
// Q に漢字があるときは どちらも なし（パーサーも捨てる）。
function buildFreeLookupPrompt(query) {
  return [
    "Define this Japanese word or phrase the way a careful monolingual dictionary (大辞林・明鏡国語辞典) would.",
    ...buildSuggestionRules(),
    "- If Q is written without kanji and several common words share its reading (はし: 橋・箸・端), define only the one Q most often means on its own. Put the others in 同音, never in the numbered senses.",
    "- Idiom (慣用句), proverb or set phrase: give its established idiomatic meaning. Never build the meaning from the literal parts.",
    "- Convey any connotation or register the word carries (disapproving, ironic, humble, praising, colloquial, literary, etc.).",
    "- If the word you define has more than one distinct sense in common use, number them ①②③, most standard first.",
    "- Give the standard meaning first. If a newer or alternate usage is now widespread, add it after, marked 〔新〕. If dictionaries treat that usage as a mistake, say so (誤用とされる).",
    "- If you are not sure of a meaning, say so briefly instead of guessing.",
    "- 訳 is the closest English equivalent of the word you defined, the way a 和英 dictionary gives it: a word or short phrase, not a definition or explanation. For an idiom, give the natural English equivalent expression, never a literal rendering. If the senses need different English words, give up to 3 separated by \"; \", in the same order as the senses.",
    "- 表記: only when Q has no kanji. The standard kanji spelling of the word you defined (くちがへらない → 口が減らない, きれい → 綺麗), even if the word is usually written in kana. Write なし if Q contains kanji, if the word has no kanji spelling, or if its kanji spelling is very rare or archaic (とても → なし, not 迚も).",
    "- 同音: only when Q has no kanji. Other common words with exactly the same reading, each in its usual kanji spelling, most common first, at most 4, separated by 、. The same verb written with different kanji for different meanings counts (あう: 会う → 合う、遭う). Leave out alternate spellings of the word you defined, rare words and proper nouns. なし if there are none.",
    "Output these 6 lines in this order and nothing else (only the 候補 line when 候補 is not なし):",
    "候補: <most likely intended word, or なし>",
    "読み: <hiragana; katakana if that is normal>",
    "表記: <kanji spelling of the word you defined, or なし>",
    "同音: <other words with the same reading, or なし>",
    "JA: <Japanese definition, all on ONE line>",
    "訳: <closest English equivalent of the word you defined>",
    "",
    "Q: " + query
  ].join("\n");
}

// 訳語を表示（訳 のない保存済みの答えだけ）: 語そのものの英語の訳語。返すのは1行の英語（ラベルなし）。
// JA は語義を選ぶためだけに渡す（定義を訳させるのではない）。
function buildGlossPrompt(word, reading, ja) {
  return [
    "Give the closest English equivalent of this Japanese word or phrase itself, the way a 和英 dictionary would: a word or short phrase, not a definition or explanation.",
    "Use the Japanese definition only to pick the right sense. If the senses need different English words, give up to 3 separated by \"; \", in the same order as the senses.",
    "For an idiom, give the natural English equivalent expression, never a literal word-by-word rendering.",
    "Output ONLY the English on one line. No quotes or labels.",
    "",
    "Word: " + word,
    "Reading: " + reading,
    "JA: " + ja
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

// ── ふりがな ────────────────────────────
// 語・フレーズ・動詞・文の読みだけ。意味・訳・説明はいらない。
// 解析: parseFuriResponse / ルビ:, 読み:, 別:
//   ルビ: Q をそのまま写し、漢字（や数字）のかたまりのすぐ後ろに {よみ} を足した形。かな・記号には付けない。
//   読み: Q 全体のひらがな。ルビ: の本文が Q と合わないときは、アプリは ルビ を捨てて 読み だけ出す。
//   別:   1語だけで、意味のちがう別の読みがあるとき（生物 → なまもの）。なければ なし。
function buildFuriPrompt(query) {
  return [
    "Give the reading of this Japanese text (a word, phrase, verb or sentence). Readings only: no meaning, translation or commentary.",
    "Read it the way a native speaker would read it aloud in this context: correct rendaku, 熟字訓 (今日・大人・明日), counters and numbers.",
    "Output these 3 lines and nothing else:",
    "ルビ: <Q copied exactly, character for character, with its hiragana reading in {} right after each run of kanji or digits. Kana, katakana and punctuation get no {}.>",
    "読み: <all of Q in hiragana (katakana words stay katakana), punctuation kept>",
    "別: <only if Q is a single word or set phrase with another common reading that changes the meaning, list those readings separated by 、; otherwise なし>",
    "",
    "Example for 昨日は雨が降った。",
    "ルビ: 昨日{きのう}は雨{あめ}が降{ふ}った。",
    "読み: きのうはあめがふった。",
    "別: なし",
    "",
    "Q: " + query
  ].join("\n");
}

// ── 漢字表記 ────────────────────────────
// 解析: parseKanjiResponse / 候補:, 形:, 補足:, 使用:（0〜4）, 表記:
// 2026-10-25: 形 に同じ読みの別の語（類義語）が入ることと、補足 と 使用 が食いちがうことがあったので、
// 「形 は Q と同じ語・同じ読み」「使用・表記 は 補足 と同じ判断」を足し、補足 を 使用 より先に書かせる。
// 2026-10-25: Q 自体が 形 とちがう漢字表記（穿く → 履く など）のとき、補足 が Q の表記にふれなかったので、
// 「補足 で Q の表記の使われ方も一言」を足す。
// パーサーはラベルで読むので行の順番は自由。
function buildKanjiPrompt(query, context) {
  const lines = [
    "Judge how this Japanese word is normally written in modern Japanese.",
    ...buildSuggestionRules(),
    "形 must be a spelling of the same word as Q, with the same reading. Never give a synonym or a different word with a similar meaning. If the word itself has no established kanji spelling, write なし.",
    "補足 states your judgment. 使用 and 表記 must express that same judgment (e.g. if 補足 says the word is usually written in kana, 使用 is 2 and 表記 is kana).",
    "If Q is itself a kanji spelling that differs from 形 (e.g. Q 穿く, 形 履く), 補足 must also briefly say how Q's spelling is used or regarded (e.g. 表外読み, older or literary, used for certain objects), then how the word is usually written.",
    "Output these 5 lines in this order and nothing else (only the 候補 line when 候補 is not なし):",
    "候補: <most likely intended word, or なし>",
    "形: <principal kanji spelling, or なし if no established kanji spelling exists>",
    "補足: <one or two short Japanese sentences for a learner: how the word is usually written>",
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

// ── 言い回し ────────────────────────────
// 語・フレーズ・文が「決まった言い方か、ふつうに言うか、作者の独自の表現か」の判定と、訳。
// 解析: parseIimawashiResponse / 判定:（IIMAWASHI_VERDICTS のどれか）, 核:, 解説:, 直訳:, 訳:, 関連:（、区切り）
// 判定の分け方（2026-11-09）:
//   定型   辞書の見出しになる慣用句・ことわざ・決まり文句（猫の手も借りたい）
//   慣用的 見出しではないが、決まった比喩の部分を型どおりに使っていて、ふつうに言う（雲の上の話 ← 雲の上）
//   普通   比喩なしの、字どおりの言葉の組み合わせ。自然だが、意味は部分から出る
//   独自   作者の比喩・言葉遊び・珍しい組み合わせ。通じるが、ふつうは言わない
//   不自然 誤用、またはネイティブには不自然
//   不明   判断できない
// 慣用的 と 普通 の境目は「決まった比喩の部分があるか（部分の字面から意味が出ないか）」。
// 英語（直訳・訳）は漢字辞典の EN と同じく、同じ返事に入れて小さく出す。直訳は 訳 とほぼ同じなら表示しない（アプリ側）。
function buildIimawashiPrompt(query) {
  return [
    "A learner reading Japanese fiction asks about this snippet: is it an established expression, a normal way to say it, or the author's own creative wording? Then translate it.",
    "",
    "Steps:",
    "1. Find the part of Q that matters for this question (核): the idiom, set phrase, figurative piece or unusual combination. Drop surrounding grammar like 私には…だが. If nothing in Q is idiomatic or unusual, 核 is the main phrase.",
    "2. Decide whether 核, or a fixed expression it is built on, is a headword or listed idiom in standard dictionaries (大辞林・明鏡国語辞典・故事ことわざ辞典). This is the most checkable fact; settle it before judging.",
    "3. Pick exactly one 判定:",
    "   定型: 核 itself is a dictionary idiom, proverb or set phrase (猫の手も借りたい, 口が減らない).",
    "   慣用的: not a headword itself, but it uses a conventional figurative piece in its usual way, and native speakers say it routinely (雲の上の話, built on 雲の上 = out of reach). Its meaning can't be worked out from the literal words alone.",
    "   普通: a natural, literal combination of words. No idiom or conventional figure; the meaning comes from the parts.",
    "   独自: the writer's own metaphor, wordplay or unusual combination. Understandable, but people don't normally say it this way. If it bends or riffs on a known expression, say which one.",
    "   不自然: a misuse or something a native speaker would find unnatural.",
    "   不明: you genuinely can't tell. Prefer 不明 over a confident guess.",
    "Don't call something 定型 or 慣用的 just because it sounds literary. Build no meaning from the literal parts of a real idiom.",
    "",
    "Output these 6 lines in this order and nothing else:",
    "判定: <定型 | 慣用的 | 普通 | 独自 | 不自然 | 不明>",
    "核: <the key expression, copied from Q (dictionary form if Q inflects it)>",
    "解説: <1-3 short Japanese sentences, all on ONE line: what it means here, how it's built (which idiom or figure it rests on), register, and why you chose that 判定>",
    "直訳: <literal English rendering of Q, word for word but readable>",
    "訳: <natural English translation of Q in context>",
    "関連: <up to 4 related established expressions (the idiom it rests on, close set phrases with similar meaning), separated by 、, or なし>",
    "No quotes, markdown, readings in parentheses, or extra commentary.",
    "",
    "Q: " + query
  ].join("\n");
}
