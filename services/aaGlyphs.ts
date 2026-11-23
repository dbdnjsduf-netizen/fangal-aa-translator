// Glyphs that users repeatedly banned as AA texture but that almost never occur
// in dialogue they selected by hand (learned from exported ban/manual-regex
// lists). Kana and kanji that are also ordinary words are left out on purpose.
const AA_STROKE_GLYPHS = new Set(
  'r{¨´‐′∧∨⌒│〃〉〕ィノミヽ㍉丶丿乂于亥仄从冖冫刈匕厂厶圦圭壬孑廴弋弌彡愀戀抖斗斥气汀沁狄癶竿笊筏絲綫縱羔苹衍辷爪爻幵幺＝｀ｈｉｖｘｙ､ｦﾉﾒ',
);
export const isAAStrokeGlyph = (char: string) => AA_STROKE_GLYPHS.has(char);
const AA_FILLER = /^[:;.,'`^|_\-]$/u;
const RE_KANA = /[ぁ-ゖァ-ヺｦ-ﾝ]/u;

// A part made mostly of AA stroke glyphs (e.g. "乂弋こｿ", "厶圭圭圭ア") is
// picture texture even when it happens to sit on its own line.
export function isAAGlyphSoup(text: string) {
  const chars = Array.from(text).filter((char) => !/\s/u.test(char));
  if (chars.length < 2) return false;
  const glyphCount = chars.filter((char) => AA_STROKE_GLYPHS.has(char)).length;
  if (glyphCount === 0) return false;
  // Half-width filler such as ":::" or "..." fills hair and shading between
  // stroke glyphs ("乂ﾐ:::::::乂ﾊ"); it counts toward texture once a real
  // stroke glyph is present.
  const strokeCount = glyphCount + chars.filter((char) => AA_FILLER.test(char)).length;
  // Three or more consecutive kana read as a word ("ミルク"), not texture.
  let run = 0;
  for (const char of chars) {
    run = RE_KANA.test(char) ? run + 1 : 0;
    if (run >= 3) return false;
  }
  return strokeCount / chars.length >= 0.5;
}

// Sound effects and voiced reactions that users kept adding by hand:
// half-width onomatopoeia ("ｼﾞｬﾗｯ", "ｸｽｸｽ", "））　ﾓﾐ") and kana-only cries
// with long vowels, a closing small tsu, ♪ or a short repetition
// ("おーーー♪", "ぐっ", "うう"). Plain short phrases ("１１歳？", "は？") are
// deliberately not covered; they keep the stricter spatial rules.
const RE_HW_ONOMATOPOEIA = /^[ｦ-ﾟｰ…‥・!！?？♪～~、､。.]+$/u;
const RE_FW_SPEECH = /^[ぁ-ゖァ-ヺー、。…‥！？!?♪～~]+$/u;
export function hasSpeechShape(text: string) {
  const compact = text.replace(/[\s　]/gu, '').replace(/^[）)]+/u, '');
  if (Array.from(compact).length < 2) return false;
  if (Array.from(compact).some((char) => AA_STROKE_GLYPHS.has(char))) return false;
  if (RE_HW_ONOMATOPOEIA.test(compact)) {
    const kana = compact.replace(/[^ｦ-ﾟｰ]/gu, '');
    const base = Array.from(kana.replace(/[ﾞﾟｰ]/gu, ''));
    if (base.length < 2) return false;
    // "ﾆﾆﾆﾆﾆ!" is a ruled line with a stroke at its end.
    if (/([ﾆﾐ])\1/u.test(kana)) return false;
    // Stroke-shaped kana need a real sound mark: "ﾑｯ", "ﾊﾊﾊ…" are voices,
    // "ﾊｰﾍ", "ﾐ ｰｲ" and "ﾏﾆ!" are hair and outline strokes.
    const isStrokeOnly = base.every((char) => AA_SHAPE_LETTERS.has(char) || AA_SOFT_TEXTURE.has(char));
    // Repeated multi-glyph units (ｸｽｸｽ) or explicit sound marks (ﾞﾟｯｰ…！？♪).
    // A single repeated glyph such as "ﾆﾆﾆﾆ" is a drawn line, not a sound.
    if ((isStrokeOnly ? /[ﾞﾟｯ…‥♪]/u : /[ﾞﾟｯｰ…‥!！?？♪～~]/u).test(compact)) return true;
    // Laughter written with one glyph ("ﾌﾌﾌﾌ", "ｸｸｸ") is still a voice.
    if (/^([ﾌﾍﾎﾋｸｷｹｺ])\1{2,}$/u.test(kana)) return true;
    const unit = /^(.{2,4}?)\1+.?$/u.exec(kana)?.[1];
    return Boolean(unit && new Set(Array.from(unit)).size >= 2);
  }
  if (RE_FW_SPEECH.test(compact)) {
    const letters = compact.replace(/[^ぁ-ゖァ-ヺ]/gu, '');
    if (letters.length === 0) return false;
    // "ゑゑゑゑゑ" / "ヨヨヨヨヨヨ" are fill texture, not speech.
    if (/([ぁ-ゖァ-ヺ])\1{3,}/u.test(letters)) return false;
    if (/♪|ー{2,}/u.test(compact) || (letters.length >= 2 && /[っッ][！？!?…‥]*$/u.test(compact))) {
      return true;
    }
    // Short kana repetition reads as a voice ("うう", "はは", "ムニュムニュ").
    const repeated = /^(.{1,3}?)\1+$/u.exec(letters);
    return Boolean(
      repeated
      && /[ぁ-ゖァ-ヺ]/u.test(repeated[1])
      && letters.length / repeated[1].length <= 4,
    );
  }
  return false;
}

// --- Readable utterances in a slot beside the drawing ---
// Kanji seen only in banned AA texture and never in hand-selected dialogue
// (learned from the exported ban / manual-regex lists). One of these marks the
// whole run as picture texture.
const AA_TEXTURE_KANJI = new Set(
  '圭爻从弋乂彡狄笊辷刈弌竿抖圦厶孑亥冖壬匕厂气于沁筏縱愀幵仄綫戀羔冫斥苧豸衍淺戔勹圷苹癶抃卞薹漉莎坏泌弖豕鑾价貅箋廴艾乍佗兀辿宍竺迂紕丶寸淡斧芋絲幺爪赫云牙芯沙炸炒雫洲洫斗彳巛',
);
// Letters that are frequent in texture but also spell ordinary words. They
// only count against a run when they dominate it or repeat.
const AA_SOFT_TEXTURE = new Set('三二八海灯示寺森林州才杉木比此闇升己米込ノミメヒィぅぃぷぴゑﾆニｨﾉﾐﾒ');
// Kana and kanji AA draws lines and curves with.
const AA_SHAPE_LETTERS = new Set(
  '二三七彡八人入ヌノト一へヘ大イムくミシツテ了心ハフソィッェァォュョエ工口ロ日目回凹凸コ丁十小山ー―つっぅヽヾ丶〆丿乂爻巛川芹云ゝゞ丈乃卜匕ヲｲﾉﾆﾊﾍﾄﾚﾘﾙﾛｯｪｧｫｭｮﾐﾑｿﾂｼﾏｨﾒｦｰ',
);
const AA_CURVE_HIRAGANA = new Set('こしくつうりてとそにれんいへ');
const RE_UTTERANCE_SCRIPT = /[ぁ-ゖァ-ヺ一-龯々〆ｦ-ﾝ]/u;
const RE_UTTERANCE_CHARS = /^[ぁ-ゖァ-ヺー一-龯々〆〇ｦ-ﾟ0-9Ⅰ-Ⅻ\s　、､。，．,.…‥・！？!?「」『』（）()【】〜～♪♥♡☆★○◯●↑：―‐゛%％]+$/u;
// Latin that reads as a word, acronym or code: "D&D", "Fate/stay", "PGM",
// "e" in "eスポーツ". Lone lowercase strokes (r, f, x, zzz) do not qualify.
const RE_LATIN_RUN = /[0-9]*[A-Za-z][A-Za-z0-9]*(?:[/&.\-:][A-Za-z0-9]+)*/gu;
const isLatinWord = (run: string, following: string) => /[A-Z]/u.test(run)
  || (run.length >= 3 && /[aeou]/u.test(run))
  || (run.length >= 4 && run.includes('i'))
  || (run.length === 1 && /^[ァ-ヺー]{3}/u.test(following));
const RE_SENTENCE_END = /(?:[！？!?…‥♥♡♪↑。]|[.．・]{2,})[！？!?…‥♥♡♪↑。.．・]*$/u;
const RE_SOUND_TAIL = /[っッｯぁぃぅぇぉｧｨｩｪｫｬｭｮ][！？!?…‥♥♡♪]*$/u;
// A letter may repeat four times only where a voice stretches or laughs.
const RE_FILL_REPEAT = /([一-龯])\1|([二三ニﾆミﾐ])\2/u;
const RE_LONG_REPEAT = /([ぁ-ゖァ-ヺｦ-ﾝ])\1{3,}/u;
const RE_VOICE_REPEAT_LETTER = /[あいうえおぁぃぅぇぉアイウエオァィゥェォｱ-ｵｧ-ｫはハﾊへヘﾍふフﾌひヒﾋほホﾎくクｸｰ]/u;
// Dakuten, small kana and the sokuon mark a spelled-out sound.
const RE_SOUND_EVIDENCE = /[ﾞﾟっッｯゃゅょャュョｬｭｮがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ]/u;

const lettersOf = (text: string) => Array.from(text).filter((char) => RE_UTTERANCE_SCRIPT.test(char));
const isStrongLetter = (char: string) => !AA_SHAPE_LETTERS.has(char)
  && !AA_SOFT_TEXTURE.has(char)
  && !AA_STROKE_GLYPHS.has(char)
  && !AA_CURVE_HIRAGANA.has(char);

// Decides from the letters alone whether a run reads as speech, a word or a
// sentence rather than as strokes. It is meant for a slot that is already
// known to stand beside the drawing; inside the drawing the spatial rules
// still apply. Tuned so that hand-selected dialogue passes and banned texture
// does not.
export function isReadableUtterance(text: string): boolean {
  const ascii = text.replace(/[Ａ-Ｚａ-ｚ０-９]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  // Emphasis marks and frame scraps around the phrase: "））　ﾓﾐ", ";;ｶﾞﾀｶﾞﾀ;".
  const core = ascii.trim()
    .replace(/^[）)]{2}[\s　]*/u, '')
    .replace(/^[;:,.‐\-―─]{1,3}[\s　]*(?=[^;:,.‐\-―─\s　])/u, '')
    .replace(/[\s　]*[;:,‐\-―─ﾞ]{1,3}$/u, '')
    .replace(/[\s　]\.$/u, '')
    // Trailing "ｗｗｗ" laughter.
    .replace(/(?<=[ぁ-ゖァ-ヺー一-龯])w+$/u, '');
  const body = core.replace(RE_LATIN_RUN, (run, offset: number) => (
    isLatinWord(run, core.slice(offset + run.length)) ? '' : run
  ));
  const hasLatinWord = body !== core;
  if (!body || !RE_UTTERANCE_CHARS.test(body)) return false;
  // "ひ.イ", "ろ麒斜、,ｲ": a lone dot or comma between letters is a stroke.
  if (/[ぁ-ゖァ-ヺ一-龯ｦ-ﾟ][.,][ぁ-ゖァ-ヺ一-龯ｦ-ﾟ]/u.test(body)) return false;

  const letters = lettersOf(body);
  const count = letters.length;
  if (count === 0) return false;
  if (letters.some((char) => AA_TEXTURE_KANJI.has(char))) return false;
  if (RE_FILL_REPEAT.test(body)) return false;
  // "ヨヨヨヨヨ", "そんんんんんふ" are fill; "おーーーー", "ﾌﾟﾙﾙﾙﾙ", "ﾍﾍﾍﾍ♪" are voices.
  const longRepeat = RE_LONG_REPEAT.exec(body)?.[1];
  if (longRepeat && !RE_VOICE_REPEAT_LETTER.test(longRepeat) && !RE_SOUND_EVIDENCE.test(body)) return false;

  const strong = letters.filter(isStrongLetter).length;
  const soft = letters.filter((char) => AA_SOFT_TEXTURE.has(char)).length;
  const compact = body.replace(/[\s　]/gu, '');
  const joined = letters.join('');
  const endsLikeSpeech = RE_SENTENCE_END.test(compact)
    || /^[…‥・.．]{2,}/u.test(compact)
    || /[ーｰ～〜]{2,}$/u.test(compact);
  const isRepeatedUnit = /^(.{2,3})\1+$/u.test(joined) && new Set(letters).size >= 2;

  // Phrases written with gaps: every piece has to hold up by itself, so a
  // word next to a stray stroke ("殺意ｨ　ﾏﾘ", "じ ﾍ ｰそ") is still a drawing.
  const pieces = body.split(/[\s　]+/u).filter((piece) => lettersOf(piece).length > 0);
  if (pieces.length >= 2) {
    const pieceLetters = pieces.map(lettersOf);
    if (pieceLetters.every((piece) => piece.length === 1)) {
      // Spaced-out words: "賞　　金", "ア　ル　テ　マ".
      const isKanjiPair = pieceLetters.every((piece) => /[一-龯]/u.test(piece[0]) && isStrongLetter(piece[0]));
      if (!isKanjiPair && (pieces.length < 3 || strong < 2)) return false;
    } else if (!pieces.every((piece, index) => (
      pieceLetters[index].some(isStrongLetter)
      || isReadableUtterance(piece)
      || /^[ぁ-ゖァ-ヺ][ー―～〜]{2,}$/u.test(piece)
    ))) return false;
  }

  // A wall of half-width kana with no break ("ｲｶﾞﾚｽｺﾝｽﾀﾝﾂｧﾒﾘﾗｹｾ…") is
  // letter texture; spoken half-width lines pause or end within a few words.
  if (/[ｦ-ﾟ]{18,}/u.test(body) && !isRepeatedUnit) return false;

  // A sentence with a Latin word: "D&Dのゴブリンには…", "D級", "PGM ヘカートII．．．".
  if (hasLatinWord) return strong >= 1 && soft * 2 < count;

  // Repeats and sound tails outrank the stroke-letter penalty: "ﾓﾐﾓﾐ", "ﾆｯ", "ﾑﾆｭ".
  const hasSoundShape = isRepeatedUnit || (count >= 2 && RE_SOUND_TAIL.test(compact));
  if (soft >= 1 && !hasSoundShape && (soft * 2 >= count || count <= 2)) return false;

  const isHalfwidthOnly = letters.every((char) => /[ｦ-ﾝ]/u.test(char));
  if (isHalfwidthOnly && (strong >= 2 || (strong >= 1 && count >= 3)) && soft * 2 < count) return true;
  if (isHalfwidthOnly && strong === 0) {
    // Voices spelled with stroke-shaped kana need a sound mark or a repeat:
    // "ﾑｯ", "ﾊｧ", "ﾊﾊﾊ…", "ﾆﾍﾆﾍ". "ﾊｰﾍ" and "ﾏﾆ!" are strokes.
    return count >= 2 && (
      hasSoundShape
      || (/[ﾞﾟ]/u.test(body) && soft === 0)
      || (endsLikeSpeech && soft === 0)
      || /^(.)\1{2,}$/u.test(joined)
    );
  }
  if (hasSoundShape && (strong >= 1 || isHalfwidthOnly)) return true;
  // Sound effects and cries: "ﾊﾟﾁﾊﾟﾁﾊﾟﾁ", "おーーー♪", "ﾑﾆﾑﾆ♥".
  if (hasSpeechShape(compact.replace(/[♥♡]/gu, ''))) return true;

  const kanji = letters.filter((char) => /[一-龯々〆]/u.test(char));
  const hiragana = letters.filter((char) => /[ぁ-ゖ]/u.test(char));
  const plainHiragana = hiragana.filter((char) => !AA_CURVE_HIRAGANA.has(char) && !AA_SHAPE_LETTERS.has(char));
  // One to three kana with a sound mark: "え？", "ん……", "あっ", "ふぅ", "ね♥".
  if (
    count <= 3
    && kanji.length === 0
    && /^[…‥・.．]*[ぁ-ゖァ-ヺｦ-ﾟー～〜゛]+$/u.test(compact.replace(RE_SENTENCE_END, ''))
    && (endsLikeSpeech || RE_SOUND_TAIL.test(compact))
  ) {
    // A sigh ("ふぅ", "はぁ") starts with a plain kana; "しぃ" is two curves.
    if (!endsLikeSpeech && /[ぁぃぅぇぉ]$/u.test(compact) && !isStrongLetter(letters[0])) return false;
    return count >= 2 || endsLikeSpeech;
  }
  // A count: "５歳", "２０００だ", "５００っ！？", "３０、か".
  if (/^[0-9]{1,6}[、,]?[ぁ-ゖァ-ヺ一-龯ｦ-ﾟ]{1,4}[！？!?…‥・.．。]*$/u.test(compact)) {
    return strong >= 1 || /[0-9][、,]?[かだねよっ]/u.test(compact);
  }
  if (count === 1) {
    // One kanji asked, trailed off or drawn out: "誰？", "白……", "穴ーー".
    return kanji.length === 1 && strong === 1 && (endsLikeSpeech || /ー{2,}$/u.test(compact));
  }
  // Words and sentences.
  if (strong >= 2) return true;
  if (kanji.length === count) return strong >= 1;
  if (letters.every((char) => /[ァ-ヺ]/u.test(char))) {
    // "アイテム": a katakana word may be spelled almost entirely with shape letters.
    return count >= 3 && new Set(letters).size >= 3 && strong >= 1 && soft === 0;
  }
  if (strong >= 1) return plainHiragana.length >= 1 || endsLikeSpeech;
  return hiragana.length === count && count >= 4 && plainHiragana.length >= 2;
}