import { SpatialContextAnalyzer } from '../services/spatialDetection';
import type { VisualWidthProfile } from '../services/visualTextMetrics';
import { annotateVerticalTextSegments } from '../services/verticalText';
import { applyManualRegexRules } from '../services/manualRegex';
import { applySelectionExclusions } from '../services/selectionExclusions';
import type {
  ManualRegexRules,
  SelectionExclusionRules,
  TextSegment,
} from '../types';

// Web Worker for text segmentation (runs off the main UI thread)
// All regex patterns and pure helper functions are duplicated here
// because Web Workers run in a separate context with no shared memory.

// --- Pre-compiled regex patterns ---
// U+FF9E/U+FF9F are half-width dakuten marks, not standalone Japanese
// letters. Counting them as text made AA fragments such as "ﾞｉ" look like
// Japanese even though the visible letter is Latin.
const RE_JAPANESE_CHAR = /[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9d\u4e00-\u9faf\u3400-\u4dbf]/;
const RE_JAPANESE_CHARS_G = /[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9d\u4e00-\u9faf\u3400-\u4dbf]/g;
const RE_JAPANESE_PUNCTUATION = /[!?！？。、…「」『』（）［］【】♥♡]/;
const RE_INLINE_DRAWING = /[|│┃｜\/／\\＼_＿￣─━≦≧=＝<＜>＞∫∬\u2500-\u257F\u2580-\u259F]/;
const RE_GAP = /([\s\u3000\u00A0\u2000-\u200B]*(?:[|│┃｜＞＜\u2500-\u257F／＼\[\]｛｝［］★◆]+|[\s\u3000\u00A0\u2000-\u200B]{2,})[\s\u3000\u00A0\u2000-\u200B]*)/;
const RE_SEPARATOR = /^[\s\u3000\u00A0\u2000-\u200B]*(?:[|│┃｜＞＜\u2500-\u257F／＼\[\]｛｝［］★◆]+|[\s\u3000\u00A0\u2000-\u200B]{2,})[\s\u3000\u00A0\u2000-\u200B]*$/;
const RE_WHITESPACE_GAP = /^[\s\u3000\u00A0\u2000-\u200B]{2,}$/;
const RE_BAR_END = /[|│┃｜＞＜／＼\[\]｛｝［］\u2500-\u257F★◆■□●○◎◇△▽▲▼＋＊*#+\-_=]$/;
const RE_BAR_START = /^[|│┃｜＞＜／＼\[\]｛｝［］\u2500-\u257F★◆■□●○◎◇△▽▲▼＋＊*#+\-_=]/;
const RE_BAR_CHAR = /[|│┃｜＞＜\u2500-\u257F／＼\[\]｛｝［］★◆■□●○◎◇△▽▲▼＋＊*#+\-_=]/;
// Directional arrow constraints for box detection: ＞ content ＜ is a valid box, ＜ content ＞ is not.
// Left border allows ＞ (points right/inward toward content), excludes ＜.
// Right border allows ＜ (points left/inward toward content), excludes ＞.
const RE_BOX_PIPE_CHAR_LEFT = /[|│┃｜＞\u2500-\u257F]/;
const RE_BOX_PIPE_CHAR_RIGHT = /[|│┃｜＜\u2500-\u257F]/;
const RE_ARROW_BOX_START = /[>＞|｜]/;
const RE_ARROW_BOX_END = /[<＜|｜]/;
const RE_EDGE_BLANK = /^[\s\u200B\u3000\u00A0\u2000-\u200B│┃|｜＞＜／＼\u2500-\u257F人从⌒YWV^‐―＝≡   ´｀ヽヾ乂ノﾚﾉ]*$/;
const RE_STRUCTURAL_REPEAT = /[二三壬]{2,}|[口ロ十]{3,}/;
const RE_LINE_BORDERS = /[|│┃｜_＿￣─━\-\/／\\＼]{2,}/;
const RE_BOUNDARY_DRAWING = /^[\s\u3000]*[|│┃｜\/／\\＼_＿￣─━]|[\s\u3000]*[|│┃｜\/／\\＼_＿￣─━][\s\u3000]*$/;
const RE_STANDARD_HIRAGANA = /[ぁ-ん]/;
const RE_GEGE_G = /[ゝゞ]/g;
const RE_DRAWING_MARKS = /[ヽヾ丶〆丿乂爻巛川]/;
// Japanese glyphs that frequently double as strokes in Shift-JIS art. Keep
// this list evidence-based: no Hangul lookalikes or invented transliterations.
const RE_AA_CHARS = /[二三七彡八人入ヌノト一へヘ大イムくミシツテ了心ハフソィッェァォュョエ工乀乁口ロ日目回凵凹凸匚コ丁十小山ー―つっぅヽヾ丶〆丿乂爻巛川芹云ゝゞ冖宀冂广廴廾彐彳忄扌氵犭纟艹辶阝丈乃亅卜匕个丫儿厂厶ヲｲﾉﾆﾊﾍﾄﾚﾘﾙﾛｯｪｧｫｭｮ]/u;
const RE_NON_JP_G = /[^\u3040-\u309f\u30a0-\u30ff\uff66-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/g;
const RE_SYMBOLS_G = /[^\u3040-\u309f\u30a0-\u30ff\uff66-\uff9f\u4e00-\u9faf\u3400-\u4dbf!?！？。、…「」『』（）［］【】♥♡\s]/g;
const RE_HALFWIDTH_PUNCT = /[\uff61-\uff65]/;
const RE_THREAD_NAME = /^\s*\d+\s*[:：].*?(?:◆|ID[:：]\w|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/;
// Box border chars: horiz ─━ (U+2500-01), vert │┃ (U+2502-03), dashed (U+2504-05,2508-09), corners/intersections (U+250C-254D), double (U+2550,2552-2573), ASCII/fullwidth pipes (|｜)
const RE_BOX_HORIZONTAL_BORDER = /^[\s\u200B￣＿\u2500-\u2503\u2504\u2505\u2508\u2509\u250C-\u254D\u2550\u2552-\u2573\-|｜]*$/;
const RE_BOX_BORDER_ANY = /^[\s\u200B\u3000\u00A0\u2000-\u200B￣＿\-\u2500-\u257F｜|＞＜／＼人从⌒YWV^‐―＝≡   \[\]｛｝［］★◆■□●○◎◇△▽▲▼＋＊*#+\-_=f,x'´｀ヽヾ乂ノﾚﾉ:.]*$/;
const RE_STRICT_BLANK = /^[\s\u3000\u00A0\u2000-\u200B]*$/;
// A real box border separator has 1 or more pipe/arrow/box chars with optional whitespace
const RE_HW_DAKUTEN = /[\uff9e\uff9f]/;
const RE_DISQUALIFIED = /[}｝囗＿|ｌl丿／｜><]/;
const RE_AUTO_SELECT_EXCLUDE = /[＼＞＜]|(^[ﾆ二ニ々]+$)/;
const RE_NOISE_ONLY = /^[\s\u3000\u00A0\u2000-\u200B从人f´￣｀ヽ_！]+$/;
const RE_FACE_FRAME = /[()（）<>＜＞〈〉《》「」『』\[\]｛｝{}´｀'"＾^⌒ﾟ°・]/u;
const RE_AA_CONTEXT_GLYPH = /[|│┃｜/／\\＼_＿￣─━\-~～^＾<>＜＞()（）\[\]｛｝{}´｀'"`.,:;・ﾟ°vVyYwWjJiIlLfFxX]/u;
const RE_HORIZONTAL_AA_STROKE = /[一二三ニﾆー―‐‑‒–—−＿￣_=＝─━┄┅┈┉.．・:：]/u;
const RE_HORIZONTAL_AA_JAPANESE = /^[一二三ニﾆー―]+$/u;
const RE_VERTICAL_PIPES_G = /[|│┃｜]/g;
const RE_JAPANESE_SCRIPT = /[\u3041-\u3096\u30a1-\u30f6\uff66-\uff9d\u4e00-\u9faf\u3400-\u4dbf]/;
const RE_MEANINGFUL_JP = /[\u3041-\u3096\u30a1-\u30f6\uff66-\uff9d\u4e00-\u9faf\u3400-\u4dbf]/;
// Shared Unicode range for Japanese script chars (hiragana, katakana, half-width katakana, CJK)
const JP_SCRIPT_RANGE = '\u3041-\u3096\u30a1-\u30f6\uff66-\uff9f\u4e00-\u9faf\u3400-\u4dbf';
// Gap regex for vertical box content: allows whitespace, Japanese chars, fullwidth chars, and box-drawing vertical chars (│┃ used as ー in vertical text)
const RE_VERT_BOX_GAP = new RegExp(`^[ \\u3000\\u00A0\\u2000-\\u200B\\u2009${JP_SCRIPT_RANGE}\\uff01-\\uff5e│┃]*$`);
// Display-width tolerance for border alignment check (handles mixed full/half-width AA art)
const VERT_BOX_BORDER_TOLERANCE = 8;
// Max non-whitespace chars allowed between pipe borders in vertical box content
const MAX_VERT_BOX_CONTENT_CHARS = 3;

// --- Display width helpers (full-width chars = 2 columns, half-width = 1) ---
const isFullWidthChar = (code: number): boolean => {
  return (
    (code >= 0x1100 && code <= 0x115F) ||
    (code >= 0x2010 && code <= 0x203B) ||
    (code >= 0x2100 && code <= 0x27BF) ||
    (code >= 0x2E80 && code <= 0x303E) ||
    (code >= 0x3041 && code <= 0x33BF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0xAC00 && code <= 0xD7A3) ||
    (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0xFE30 && code <= 0xFE6F) ||
    (code >= 0xFF01 && code <= 0xFF60) ||
    (code >= 0xFFE0 && code <= 0xFFE6)
  );
};

const getDisplayWidth = (str: string): number => {
  let w = 0;
  for (let i = 0; i < str.length; i++) {
    w += isFullWidthChar(str.charCodeAt(i)) ? 2 : 1;
  }
  return w;
};

// Extract substring covering display columns [dispStart, dispEnd)
const substringByDisplayCols = (line: string, dispStart: number, dispEnd: number): string => {
  let col = 0;
  let startIdx = -1;
  let endIdx = line.length;

  for (let i = 0; i < line.length; i++) {
    if (startIdx === -1 && col >= dispStart) {
      startIdx = i;
    }
    col += isFullWidthChar(line.charCodeAt(i)) ? 2 : 1;
    if (startIdx !== -1 && col >= dispEnd) {
      endIdx = i + 1;
      break;
    }
  }

  if (startIdx === -1) return '';
  return line.substring(startIdx, endIdx);
};

// --- Helper functions ---
const isVerticallyIsolatedAt = (lines: string[], lineIdx: number, colStart: number, colEnd: number, padding: number = 8): boolean => {
  // Convert string positions to display column positions
  const currentLine = lines[lineIdx];
  const dispStart = getDisplayWidth(currentLine.substring(0, colStart));
  const dispEnd = dispStart + getDisplayWidth(currentLine.substring(colStart, colEnd));

  const checkStart = Math.max(0, dispStart - padding);
  const checkEnd = dispEnd + padding;

  const isEmptyRange = (line: string | undefined, dStart: number, dEnd: number): boolean => {
    if (line === undefined) return true;
    const substr = substringByDisplayCols(line, dStart, dEnd);
    if (substr.length === 0) return true;
    return RE_STRICT_BLANK.test(substr);
  };

  const above = lineIdx > 0 ? lines[lineIdx - 1] : undefined;
  const below = lineIdx < lines.length - 1 ? lines[lineIdx + 1] : undefined;

  if (above === undefined && below === undefined) return false;

  return isEmptyRange(above, checkStart, checkEnd) && isEmptyRange(below, checkStart, checkEnd);
};

// Stricter isolation check used for the relaxed "all 4 sides blank" path.
// Uses a wider 12-column vertical window to avoid isolated AA fragments.
const isStrictlyIsolatedAt = (lines: string[], lineIdx: number, colStart: number, colEnd: number): boolean => {
  const currentLine = lines[lineIdx];
  const dispStart = getDisplayWidth(currentLine.substring(0, colStart));
  const dispEnd = dispStart + getDisplayWidth(currentLine.substring(colStart, colEnd));

  const padding = 12;
  const checkStart = Math.max(0, dispStart - padding);
  const checkEnd = dispEnd + padding;

  const isEmptyRange = (line: string | undefined, dStart: number, dEnd: number): boolean => {
    if (line === undefined) return true;
    const substr = substringByDisplayCols(line, dStart, dEnd);
    if (substr.length === 0) return true;
    return RE_STRICT_BLANK.test(substr);
  };

  const above = lineIdx > 0 ? lines[lineIdx - 1] : undefined;
  const below = lineIdx < lines.length - 1 ? lines[lineIdx + 1] : undefined;

  // Require at least one neighbor to exist
  if (above === undefined && below === undefined) return false;

  // Both above AND below must be blank (stricter than normal isolation)
  return isEmptyRange(above, checkStart, checkEnd) && isEmptyRange(below, checkStart, checkEnd);
};

const hasBoxBorderOrBlankNearby = (lines: string[], lineIdx: number, colStart: number, colEnd: number): boolean => {
  // Convert string positions to display column positions
  const currentLine = lines[lineIdx];
  const dispStart = getDisplayWidth(currentLine.substring(0, colStart));
  const dispEnd = dispStart + getDisplayWidth(currentLine.substring(colStart, colEnd));

  const checkStart = Math.max(0, dispStart - 1);
  const checkEnd = dispEnd + 1;

  const matchesBoxBorder = (line: string | undefined, dStart: number, dEnd: number): boolean => {
    if (line === undefined) return true;
    const substr = substringByDisplayCols(line, dStart, dEnd);
    if (substr.length === 0) return true;
    return RE_BOX_BORDER_ANY.test(substr);
  };

  const above = lineIdx > 0 ? lines[lineIdx - 1] : undefined;
  const below = lineIdx < lines.length - 1 ? lines[lineIdx + 1] : undefined;

  if (above === undefined && below === undefined) return false;

  const aboveOk = matchesBoxBorder(above, checkStart, checkEnd);
  const belowOk = matchesBoxBorder(below, checkStart, checkEnd);
  return aboveOk && belowOk;
};

// Check if vertical context (above/below) is "safe" for auto-selection.
// A text block is safe if the area above AND below (within column range ± padding)
// contains blank space, horizontal box borders (＿￣─━-), or normal continuous Japanese text.
// Text blocks embedded in AA art (where above/below is drawing content) are excluded.
const hasSafeVerticalContext = (lines: string[], lineIdx: number, colStart: number, colEnd: number, padding: number = 3): boolean => {
  const currentLine = lines[lineIdx];
  const dispStart = getDisplayWidth(currentLine.substring(0, colStart));
  const dispEnd = dispStart + getDisplayWidth(currentLine.substring(colStart, colEnd));

  const checkStart = Math.max(0, dispStart - padding);
  const checkEnd = dispEnd + padding;

  const isSafeRange = (line: string | undefined, dStart: number, dEnd: number): boolean => {
    if (line === undefined) return true;
    const substr = substringByDisplayCols(line, dStart, dEnd);
    if (substr.length === 0) return true;
    // 1. Blank/whitespace
    if (RE_STRICT_BLANK.test(substr)) return true;
    // 2. Box border characters (horizontal ─━, vertical │┃, pipes |｜, corners, etc.)
    if (RE_BOX_HORIZONTAL_BORDER.test(substr)) return true;
    // 3. Box border/decoration characters (pipes, corners, decorations like ﾚﾉ)
    if (RE_BOX_BORDER_ANY.test(substr)) return true;
    // 4. Normal Japanese text (not AA art/drawing) = continuous text
    if (hasJapaneseChar(substr) && !isDrawing(substr)) return true;
    return false;
  };

  const above = lineIdx > 0 ? lines[lineIdx - 1] : undefined;
  const below = lineIdx < lines.length - 1 ? lines[lineIdx + 1] : undefined;

  return (above === undefined || isSafeRange(above, checkStart, checkEnd)) && (below === undefined || isSafeRange(below, checkStart, checkEnd));
};

// Short kana-like fragments inside character art often look like valid words in
// isolation. Measure the nearby AA strokes in display columns so those fragments
// are not promoted merely because their own line has whitespace. Verified
// dialogue boxes are handled separately and deliberately override this signal.
const hasDenseAADrawingContext = (
  lines: string[],
  lineIdx: number,
  colStart: number,
  colEnd: number,
  columnRadius: number = 10,
  rowRadius: number = 3,
): boolean => {
  const currentLine = lines[lineIdx] || '';
  const displayStart = getDisplayWidth(currentLine.substring(0, colStart));
  const displayEnd = displayStart + getDisplayWidth(currentLine.substring(colStart, colEnd));
  const checkStart = Math.max(0, displayStart - columnRadius);
  const checkEnd = displayEnd + columnRadius;
  const occupiedSides = new Set<'above' | 'below' | 'left' | 'right'>();
  let totalGlyphs = 0;
  let occupiedRows = 0;

  const countDrawingGlyphs = (value: string): number => Array.from(value).filter((character) => (
    RE_AA_CONTEXT_GLYPH.test(character) || RE_AA_CHARS.test(character)
  )).length;

  for (let offset = -rowRadius; offset <= rowRadius; offset += 1) {
    const row = lines[lineIdx + offset];
    if (row === undefined) continue;

    // A completely blank physical row separates independent AA/dialogue
    // blocks. Do not let a drawing two or three rows away contaminate the
    // candidate merely because it happens to occupy similar columns.
    if (offset !== 0) {
      const betweenStart = Math.min(lineIdx, lineIdx + offset) + 1;
      const betweenEnd = Math.max(lineIdx, lineIdx + offset);
      if (lines.slice(betweenStart, betweenEnd).some((between) => (
        RE_STRICT_BLANK.test(between)
      ))) continue;
    }

    if (offset === 0) {
      const leftCount = countDrawingGlyphs(substringByDisplayCols(row, checkStart, displayStart));
      const rightCount = countDrawingGlyphs(substringByDisplayCols(row, displayEnd, checkEnd));
      totalGlyphs += leftCount + rightCount;
      if (leftCount >= 1) occupiedSides.add('left');
      if (rightCount >= 1) occupiedSides.add('right');
      if (leftCount + rightCount >= 2) occupiedRows += 1;
      continue;
    }

    const rowCount = countDrawingGlyphs(substringByDisplayCols(row, checkStart, checkEnd));
    totalGlyphs += rowCount;
    if (rowCount >= 2) {
      occupiedRows += 1;
      occupiedSides.add(offset < 0 ? 'above' : 'below');
    }
  }

  const hasVerticalDrawingNeighbor = occupiedSides.has('above') || occupiedSides.has('below');
  return totalGlyphs >= 6
    && occupiedRows >= 2
    && occupiedSides.size >= 2
    && hasVerticalDrawingNeighbor;
};

// Eye and eyebrow strokes in Shift-JIS art sometimes form a deceptively
// language-like run such as `,ｘぅ竿竿刃ア`: a Latin curve, a small kana and a
// few CJK/kana glyphs are used as pixels rather than words. Keep this as a
// shape signal only; the caller must also prove that the run sits in a broad,
// multi-row AA neighborhood. This avoids banning the same scripts in an
// isolated annotation or a verified speech bubble.
const isMixedScriptEyebrowTextureCandidate = (text: string): boolean => {
  const compact = text.normalize('NFKC').replace(/[\s　]/gu, '');
  const japanese = compact.match(RE_JAPANESE_CHARS_G) || [];
  if (japanese.length < 4 || japanese.length > 8) return false;

  const cjkCount = japanese.filter((character) => /[一-龯㐀-䶿]/u.test(character)).length;
  const smallKanaCount = japanese.filter((character) => /[ぁぃぅぇぉゃゅょ]/u.test(character)).length;
  const otherKanaCount = japanese.filter((character) => (
    /[ぁ-んァ-ヶ\uff66-\uff9d]/u.test(character)
    && !/[ぁぃぅぇぉゃゅょ]/u.test(character)
  )).length;
  const latinCount = (compact.match(/[A-Za-z]/gu) || []).length;
  const hasNaturalKanaRun = /[ぁ-んァ-ヶ]{3,}/u.test(compact);

  return latinCount >= 1
    && cjkCount >= 2
    && smallKanaCount >= 1
    && otherKanaCount >= 1
    && !hasNaturalKanaRun;
};

const hasBroadAADrawingNeighborhood = (
  lines: string[],
  lineIdx: number,
  colStart: number,
  colEnd: number,
): boolean => {
  const currentLine = lines[lineIdx] || '';
  const displayStart = getDisplayWidth(currentLine.substring(0, colStart));
  const displayEnd = displayStart + getDisplayWidth(currentLine.substring(colStart, colEnd));
  const checkStart = Math.max(0, displayStart - 28);
  const checkEnd = displayEnd + 28;
  let drawingGlyphs = 0;
  let occupiedRows = 0;
  let hasAbove = false;
  let hasBelow = false;

  for (let offset = -2; offset <= 2; offset += 1) {
    const row = lines[lineIdx + offset];
    if (row === undefined) continue;
    const nearby = substringByDisplayCols(row, checkStart, checkEnd);
    const count = Array.from(nearby).filter((character) => (
      RE_AA_CONTEXT_GLYPH.test(character) || RE_AA_CHARS.test(character)
    )).length;
    drawingGlyphs += count;
    if (count >= 3) {
      occupiedRows += 1;
      if (offset < 0) hasAbove = true;
      if (offset > 0) hasBelow = true;
    }
  }

  return drawingGlyphs >= 16
    && occupiedRows >= 3
    && hasAbove
    && hasBelow;
};

const hasJapaneseChar = (text: string) => RE_JAPANESE_CHAR.test(text);

const isNaturalJapaneseText = (text: string, allowShort = false): boolean => {
  const scriptCharacters = text.match(RE_JAPANESE_CHARS_G) || [];
  if (scriptCharacters.length === 0 || RE_INLINE_DRAWING.test(text)) return false;

  const hiraganaCount = scriptCharacters.filter((character) => /[ぁ-ん]/.test(character)).length;
  const kanaCount = scriptCharacters.filter((character) => (
    /[ぁ-んァ-ヶ\uff66-\uff9f]/.test(character)
  )).length;
  const cjkCount = scriptCharacters.filter((character) => /[一-龯]/.test(character)).length;
  const symbolCount = (text.match(RE_SYMBOLS_G) || []).filter((character) => (
    !/[A-Za-z0-9Ａ-Ｚａ-ｚ０-９ｗＷ]/.test(character)
  )).length;
  if (symbolCount > scriptCharacters.length * 1.5) return false;

  const hasNaturalHiraganaRun = /[ぁ-ん]{2,}/u.test(text);
  const aaCharacterCount = scriptCharacters.filter((character) => RE_AA_CHARS.test(character)).length;
  const aaRatio = aaCharacterCount / scriptCharacters.length;
  const isRepeatedStructural = (
    RE_STRUCTURAL_REPEAT.test(text)
    || aaRatio >= 0.75 && !hasNaturalHiraganaRun
    || (
      !hasNaturalHiraganaRun
      && aaRatio >= 0.4
      && symbolCount >= scriptCharacters.length * 0.5
    )
    || (
      hiraganaCount === 0
      && symbolCount >= 2
      && symbolCount >= scriptCharacters.length * 0.3
    )
  );
  if (isRepeatedStructural) return false;

  if (scriptCharacters.length >= 4 && (kanaCount >= 2 || cjkCount >= 2)) return true;
  if (kanaCount >= 2) return true;
  if (cjkCount >= 2 && new Set(scriptCharacters).size >= 2) return true;
  if (
    allowShort
    && cjkCount >= 1
    && kanaCount >= 1
    && scriptCharacters.length >= 2
    && RE_JAPANESE_PUNCTUATION.test(text)
  ) return true;
  return allowShort
    && scriptCharacters.length === 1
    && kanaCount === 1
    && RE_JAPANESE_PUNCTUATION.test(text);
};

const isStrictJapaneseText = (text: string) => isNaturalJapaneseText(text);

const hasStrongLexicalEvidence = (text: string): boolean => {
  const characters = text.match(RE_JAPANESE_CHARS_G) || [];
  const hiragana = characters.filter((character) => /[ぁ-ん]/u.test(character));
  const katakana = characters.filter((character) => /[ァ-ヶ\uff66-\uff9f]/u.test(character));
  const cjk = characters.filter((character) => /[一-龯々〆ヵヶ]/u.test(character));
  const strongHiragana = hiragana.filter((character) => !/[っぅゃゅょぁぃぇぉ]/u.test(character));
  const hasHiraganaPhrase = (
    /[ぁ-ん]{2,}/u.test(text)
    && new Set(strongHiragana).size >= 2
  ) || (hiragana.length >= 3 && RE_JAPANESE_PUNCTUATION.test(text));
  // A lone small kana between CJK-shaped glyphs is also common in eyes,
  // eyebrows and clothing folds in AA. Do not treat that shape alone as
  // strong language; spatial context decides whether it is dialogue.
  const hasMixedPhrase = cjk.length >= 1
    && hiragana.length >= 1
    && characters.length >= 3
    && (strongHiragana.length >= 1 || hiragana.length >= 2);
  const hasKatakanaWord = katakana.length >= 3
    && new Set(katakana.filter((character) => character !== 'ー')).size >= 2
    && !katakana.every((character) => RE_AA_CHARS.test(character));
  const hasCjkPhrase = cjk.length >= 3 && new Set(cjk).size >= 2;
  const hasShortPunctuatedPhrase = characters.length >= 2
    && RE_JAPANESE_PUNCTUATION.test(text)
    && (new Set(characters).size >= 2 || hiragana.length >= 2);
  return hasHiraganaPhrase
    || hasMixedPhrase
    || hasKatakanaWord
    || hasCjkPhrase
    || hasShortPunctuatedPhrase;
};

const isLikelyAAFaceFragment = (text: string): boolean => {
  const characters = text.match(RE_JAPANESE_CHARS_G) || [];
  if (characters.length === 0 || characters.length > 7 || hasStrongLexicalEvidence(text)) {
    return false;
  }
  const aaCount = characters.filter((character) => RE_AA_CHARS.test(character)).length;
  const symbols = text.match(RE_SYMBOLS_G) || [];
  const mostlyShapeGlyphs = aaCount / characters.length >= 0.5;
  const repetitiveShapes = new Set(characters).size <= 2 && mostlyShapeGlyphs;
  const framedLikeFace = RE_FACE_FRAME.test(text) && mostlyShapeGlyphs;
  const symbolHeavyShape = symbols.length >= characters.length && mostlyShapeGlyphs;
  return repetitiveShapes || framedLikeFace || symbolHeavyShape;
};

const hasStructuralGlyphDominance = (text: string): boolean => {
  const normalizedCharacters = (text.normalize('NFKC').match(RE_JAPANESE_CHARS_G) || [])
    .filter((character) => !/[・･\u3099\u309a]/u.test(character));
  if (normalizedCharacters.length === 0 || normalizedCharacters.length > 40) return false;
  const structuralCount = normalizedCharacters.filter((character) => (
    RE_AA_CHARS.test(character) || /[アマニ]/u.test(character)
  )).length;
  return structuralCount >= 1
    && structuralCount / normalizedCharacters.length >= 0.5;
};

const isRecognizedVocalization = (text: string): boolean => {
  const normalized = text.normalize('NFKC').replace(/[\s　]/gu, '');
  return /^(?:(?:ア|ガ|カ|キャ|ワ)?ハ[ハァッー!！?？]*|[ギキ]ャ[アァッー!！?？]+)$/u.test(normalized);
};

// This is deliberately only a candidate signal. A sequence such as
// `斗ぅ笊气` must not be banned by its spelling: the caller still has to prove
// that it is cramped against AA strokes and connected to a drawing. The same
// sequence in an isolated slot or a verified dialogue box remains selectable.
const isShortCjkSmallKanaCandidate = (text: string): boolean => {
  const trimmed = text.trim();
  const characters = trimmed.match(RE_JAPANESE_CHARS_G) || [];
  if (characters.length < 3 || characters.length > 7) return false;
  if (RE_JAPANESE_PUNCTUATION.test(trimmed)) return false;
  if (!characters.every((character) => /[一-龯々〆ヵヶぁぃぅぇぉゃゅょ]/u.test(character))) {
    return false;
  }

  const cjkCount = characters.filter((character) => /[一-龯々〆ヵヶ]/u.test(character)).length;
  const smallKanaCount = characters.filter((character) => /[ぁぃぅぇぉゃゅょ]/u.test(character)).length;
  return cjkCount >= 2 && smallKanaCount >= 1 && smallKanaCount <= 2;
};

// Ordinary hiragana can also be used as a curved eye stroke next to two
// CJK-shaped glyphs (for example 芸豸う). This remains only a weak candidate:
// exclusion additionally requires a connected, dense AA component.
const isShortCjkKanaShapeCandidate = (text: string): boolean => {
  const trimmed = text.trim();
  const characters = trimmed.match(RE_JAPANESE_CHARS_G) || [];
  if (characters.length < 3 || characters.length > 5) return false;
  if (RE_JAPANESE_PUNCTUATION.test(trimmed)) return false;
  if (!characters.every((character) => /[一-龯々〆ヵヶぁ-んァ-ヶ\uff66-\uff9f]/u.test(character))) {
    return false;
  }
  const cjkCount = characters.filter((character) => /[一-龯々〆ヵヶ]/u.test(character)).length;
  const kanaCount = characters.length - cjkCount;
  return cjkCount >= 2 && kanaCount >= 1 && kanaCount <= 2;
};

/**
 * A short line in a multi-line dialogue may not have enough lexical evidence
 * on its own. Accept it only when a genuinely sentence-like line immediately
 * above or below occupies the same horizontal area. AA texture rows fail the
 * language, drawing, and repetition checks before alignment is considered.
 */
const hasAlignedNaturalSentenceNeighbor = (
  lines: string[],
  lineIdx: number,
  colStart: number,
  colEnd: number,
): boolean => {
  const currentLine = lines[lineIdx] || '';
  const displayStart = getDisplayWidth(currentLine.slice(0, colStart));
  const displayEnd = displayStart + getDisplayWidth(currentLine.slice(colStart, colEnd));
  const center = (displayStart + displayEnd) / 2;

  for (const neighborIndex of [lineIdx - 1, lineIdx + 1]) {
    const neighbor = lines[neighborIndex];
    if (neighbor === undefined || RE_THREAD_NAME.test(neighbor)) continue;
    const parts = neighbor.split(RE_GAP);
    let offset = 0;
    for (const part of parts) {
      const start = offset;
      offset += part.length;
      if (!part || RE_SEPARATOR.test(part) || !hasJapaneseChar(part)) continue;
      const japanese = part.match(RE_JAPANESE_CHARS_G) || [];
      const hiraganaCount = japanese.filter((character) => /[ぁ-ん]/u.test(character)).length;
      const fullwidthKatakanaCount = japanese.filter((character) => /[ァ-ヶ]/u.test(character)).length;
      const hasGrammaticalSentenceEvidence = (
        hiraganaCount >= 2
        && (japanese.length <= 12 || hiraganaCount / japanese.length >= 0.25)
      ) || (
        fullwidthKatakanaCount >= 4
        && fullwidthKatakanaCount / japanese.length >= 0.5
      );
      if (
        (japanese.length < 4 && !RE_JAPANESE_PUNCTUATION.test(part))
        || !hasGrammaticalSentenceEvidence
        || !isNaturalJapaneseText(part, true)
        || !hasStrongLexicalEvidence(part)
        || isLikelyAAFaceFragment(part)
        || hasStructuralGlyphDominance(part)
        || getTextTextureSignals(part).isCandidate
        || isDrawing(part)
      ) continue;

      const neighborStart = getDisplayWidth(neighbor.slice(0, start));
      const neighborEnd = neighborStart + getDisplayWidth(part);
      const overlap = Math.min(displayEnd, neighborEnd) - Math.max(displayStart, neighborStart);
      const neighborCenter = (neighborStart + neighborEnd) / 2;
      const alignmentTolerance = Math.max(10, (displayEnd - displayStart) / 2);
      if (overlap > 0 || Math.abs(center - neighborCenter) <= alignmentTolerance) return true;
    }
  }
  return false;
};

const isStretchedHiraganaVocalization = (text: string): boolean => {
  const normalized = text.normalize('NFKC').replace(/[\s　]/gu, '');
  return /^(?=[ぁ-んー～〜―‐\-!?]+$)(?=(?:.*[ぁ-ん]){2,})(?=(?:.*[ー～〜―‐\-]){2,}).*[!?]+$/u
    .test(normalized);
};

/**
 * Kana-only dialogue is common in shouts, laughter and sound effects, but
 * those strings have little dictionary-like lexical evidence. Promote them
 * only when the caller has already confirmed a genuinely isolated physical
 * slot. One kana needs punctuation; repeated kana needs at least three cells.
 */
const isKanaOnlyUtterance = (text: string): boolean => {
  const normalized = text.normalize('NFKC').replace(/[\s　]/gu, '');
  if (!/^[ぁ-んァ-ヶー～〜…!?！？。、・]+$/u.test(normalized)) return false;
  const kana = normalized.match(/[ぁ-んァ-ヶ]/gu) || [];
  if (kana.length === 0) return false;
  const hasPunctuation = /[…!?！？。、]/u.test(normalized);
  if (kana.length === 1) return hasPunctuation;
  if (hasPunctuation || new Set(kana).size >= 2) return true;
  return kana.length >= 3;
};

/**
 * Shapes repeatedly added through manual-regex rules. This function never
 * decides selection by itself: callers must first prove either a rightmost,
 * four-side-independent slot or a verified physical dialogue box. Bare single
 * glyphs deliberately remain manual-only.
 */
const isManualPatternJapaneseShape = (text: string): boolean => {
  const normalized = text.normalize('NFKC').replace(/[\s\u3000\u00a0\u2000-\u200b]+/gu, '');
  // NFKC expands the single ellipsis glyph (…) to three ASCII periods on
  // current JS runtimes, so periods must remain part of the normalized shape.
  if (!normalized || !/^[ぁ-んァ-ヶ一-龯々〆ヵヶ0-9ー~～〜….!?。、・]+$/u.test(normalized)) {
    return false;
  }

  const japanese = normalized.match(/[ぁ-んァ-ヶ一-龯々〆ヵヶ]/gu) || [];
  const kana = normalized.match(/[ぁ-んァ-ヶ]/gu) || [];
  const cjk = normalized.match(/[一-龯々〆ヵヶ]/gu) || [];
  const digits = normalized.match(/[0-9]/gu) || [];
  const hasExpressiveEnding = /[ー~～〜….!?。]+$/u.test(normalized);
  const hasStrongSingleKanaEnding = /(?:[ー~～〜.]{2,}|[!?]{2,}|[ー~～〜.]+[!?]+)$/u
    .test(normalized);
  if (japanese.length === 0) return false;

  const isKanaEffectOrReaction = cjk.length === 0
    && digits.length === 0
    && (kana.length >= 2 || (kana.length === 1 && hasStrongSingleKanaEnding));
  const isCjkReaction = digits.length === 0
    && cjk.length >= 1
    && hasExpressiveEnding;
  const isNumberedCjkReaction = digits.length >= 1
    && cjk.length >= 1
    && hasExpressiveEnding;
  const isCompactJapaneseLabel = digits.length === 0
    && japanese.length >= 2
    && (kana.length >= 2 || cjk.length >= 2);

  return isKanaEffectOrReaction
    || isCjkReaction
    || isNumberedCjkReaction
    || isCompactJapaneseLabel;
};

/**
 * Very short grammatical fragments such as 君は or 僕も are meaningful in a
 * dialogue bubble (often completed by the next line), but their one CJK plus
 * one hiragana shape is intentionally too weak for free-standing AA. Callers
 * must therefore require a strictly verified physical dialogue container.
 */
const isShortBoxedCjkParticlePhrase = (text: string): boolean => {
  const normalized = text.normalize('NFKC')
    .replace(/[\s\u3000\u00a0\u2000-\u200b]+/gu, '');
  return /^[一-龯々〆ヵヶ]{1,4}(?:は|が|を|に|の|も|と|へ|で|ね|よ|か|ぞ|ぜ|さ|な|だ(?:ね|よ|な)?)[!?！？。、…]*$/u
    .test(normalized);
};

/**
 * Compact mixed-script phrases such as 離せ, 待て, 行け, 来い, 止まれ and
 * 逃げろ do not have enough letters to prove natural language by themselves.
 * The caller must additionally prove either a closed dialogue container or a
 * strictly empty local rectangle, so eyebrow/eye fragments embedded in AA do
 * not become selectable merely because their glyphs resemble this shape.
 */
const isShortMixedJapanesePhrase = (text: string): boolean => {
  const normalized = text.normalize('NFKC')
    .replace(/[\s\u3000\u00a0\u2000-\u200b]+/gu, '');
  if (!/^[一-龯々〆ヵヶぁ-んァ-ヶ]{2,5}[!?！？。、…]*$/u.test(normalized)) {
    return false;
  }
  const japanese = normalized.match(/[一-龯々〆ヵヶぁ-んァ-ヶ]/gu) || [];
  const cjkCount = japanese.filter((character) => /[一-龯々〆ヵヶ]/u.test(character)).length;
  const kanaCount = japanese.length - cjkCount;
  return cjkCount >= 1 && kanaCount >= 1;
};

const isAcronymCjkPhrase = (text: string): boolean => {
  const normalized = text.normalize('NFKC')
    .replace(/[\s\u3000\u00a0\u2000-\u200b]+/gu, '');
  return /^[A-Z][A-Z0-9]{1,7}[一-龯々〆ヵヶ]{1,8}[.!?！？。、…]*$/u.test(normalized);
};

const isShortNumericJapanesePhrase = (text: string): boolean => {
  const normalized = text.normalize('NFKC')
    .replace(/[\s\u3000\u00a0\u2000-\u200b]+/gu, '');
  if (!/^[0-9ぁ-んァ-ヶ一-龯々〆ヵヶー]{2,12}[!?！？。、…]*$/u.test(normalized)) {
    return false;
  }
  const digits = normalized.match(/[0-9]/gu) || [];
  const japanese = normalized.match(/[ぁ-んァ-ヶ一-龯々〆ヵヶ]/gu) || [];
  return digits.length >= 1
    && digits.length <= 4
    && japanese.length >= 1
    && japanese.length <= 8;
};

// A compact count/status shout can be linguistically weak even though its
// layout is unambiguous (for example `12人！？` or `第100話？`). NFKC keeps
// full-width digits and punctuation on the same path. This remains a shape
// predicate: callers must separately prove a closed box or a four-side empty
// display slot before promoting it.
const isPunctuatedNumericCjkPhrase = (text: string): boolean => {
  const normalized = text.normalize('NFKC')
    .replace(/[\s\u3000\u00a0\u2000-\u200b]+/gu, '');
  if (!/^[0-9ぁ-んァ-ヶ一-龯々〆ヵヶー]{2,20}(?:[!?]+|\.{2,})$/u.test(normalized)) {
    return false;
  }
  const digits = normalized.match(/[0-9]/gu) || [];
  const cjk = normalized.match(/[一-龯々〆ヵヶ]/gu) || [];
  const japanese = normalized.match(/[ぁ-んァ-ヶ一-龯々〆ヵヶ]/gu) || [];
  return digits.length >= 1
    && digits.length <= 6
    && cjk.length >= 1
    && japanese.length <= 12;
};

const isLeadingHesitationSingleKanaReaction = (text: string): boolean => {
  const normalized = text.normalize('NFKC').replace(/[\s\u3000\u00a0\u2000-\u200b]+/gu, '');
  return /^[.…・]{2,}[ぁ-んァ-ヶ][!?]+$/u.test(normalized);
};

const INLINE_BUBBLE_LEFT_WALL = /[|｜│┃>＞]/u;
const INLINE_BUBBLE_RIGHT_WALL = /[|｜│┃<＜]/u;
const INLINE_BUBBLE_PIPE = /[|｜│┃]/u;
const LOCAL_BUBBLE_WALL_TOLERANCE = 18;

const hasPotentialDottedDialogueBox = (lines: string[], lineIdx: number): boolean => {
  const wallCount = lines[lineIdx]?.match(/[:：]/gu)?.length || 0;
  if (wallCount < 4) return false;
  const hasCap = (direction: -1 | 1) => {
    for (let distance = 1; distance <= 8; distance += 1) {
      const row = lines[lineIdx + (distance * direction)];
      if (row === undefined) break;
      const dottedCount = row.match(/[.:：．]/gu)?.length || 0;
      if (dottedCount >= 8 && /(?:[.:：．]\s*){8,}/u.test(row)) return true;
    }
    return false;
  };
  return hasCap(-1) && hasCap(1);
};

/**
 * Detects a locally closed pipe or inward-arrow cell around a candidate
 * without rejecting the entire source row merely because unrelated AA on the
 * left contains many other pipes. Both adjacent rows must continue the nearest
 * left/right walls, and the candidate row must have blank padding inside them.
 */
const hasLocalClosedDialogueCell = (
  lines: string[],
  lineIdx: number,
  start: number,
  end: number,
): boolean => {
  const line = lines[lineIdx];
  let left = start - 1;
  while (left >= 0 && !INLINE_BUBBLE_LEFT_WALL.test(line[left])) left -= 1;
  let right = end;
  while (right < line.length && !INLINE_BUBBLE_RIGHT_WALL.test(line[right])) right += 1;
  if (left < 0 || right >= line.length || right <= left) return false;
  const hasPipePair = INLINE_BUBBLE_PIPE.test(line[left]) && INLINE_BUBBLE_PIPE.test(line[right]);
  const hasArrowPair = /[>＞]/u.test(line[left]) && /[<＜]/u.test(line[right]);
  if (!hasPipePair && !hasArrowPair) return false;
  if (
    !RE_STRICT_BLANK.test(line.slice(left + 1, start))
    || !RE_STRICT_BLANK.test(line.slice(end, right))
    || !RE_STRICT_BLANK.test(line.slice(right + 1))
  ) return false;

  const innerWidth = getDisplayWidth(line.slice(left + 1, right));
  if (innerWidth < 8 || innerWidth > 80) return false;
  const leftX = getDisplayWidth(line.slice(0, left));
  const rightX = getDisplayWidth(line.slice(0, right));
  const findWallNear = (candidate: string, targetX: number, wallPattern: RegExp) => {
    let displayX = 0;
    let nearest: { index: number; distance: number } | undefined;
    for (let index = 0; index < candidate.length; index += 1) {
      if (wallPattern.test(candidate[index])) {
        const distance = Math.abs(displayX - targetX);
        if (
          distance <= LOCAL_BUBBLE_WALL_TOLERANCE
          && (!nearest || distance < nearest.distance)
        ) {
          nearest = { index, distance };
        }
      }
      displayX += getDisplayWidth(candidate[index]);
    }
    return nearest;
  };
  const hasAlignedWalls = (candidate: string | undefined) => {
    if (!candidate) return false;
    const alignedLeft = findWallNear(candidate, leftX, INLINE_BUBBLE_LEFT_WALL);
    const alignedRight = findWallNear(candidate, rightX, INLINE_BUBBLE_RIGHT_WALL);
    return Boolean(
      alignedLeft
      && alignedRight
      && alignedLeft.index < alignedRight.index
      && RE_STRICT_BLANK.test(candidate.slice(alignedLeft.index + 1, alignedRight.index))
      && (
        (
          INLINE_BUBBLE_PIPE.test(candidate[alignedLeft.index])
          && INLINE_BUBBLE_PIPE.test(candidate[alignedRight.index])
        )
        || (
          /[>＞]/u.test(candidate[alignedLeft.index])
          && /[<＜]/u.test(candidate[alignedRight.index])
        )
      ),
    );
  };

  return hasAlignedWalls(lines[lineIdx - 1]) && hasAlignedWalls(lines[lineIdx + 1]);
};

interface TextTextureSignals {
  isCandidate: boolean;
  hasRepeatedCjkRun: boolean;
  hasDenseHalfwidthKana: boolean;
  hasLowVarietyLongScript: boolean;
  hasMixedWidthScriptNoise: boolean;
}

/**
 * Finds Japanese-looking glyph textures used to shade Shift-JIS art.
 * Broad candidates are not rejected here: they are sent to the 2D analyzer
 * and become drawings only when their surroundings also look like AA.
 */
const getTextTextureSignals = (text: string): TextTextureSignals => {
  const compact = text.replace(/[\s　]/gu, '');
  const japanese = compact.match(RE_JAPANESE_CHARS_G) || [];
  const cjk = japanese.filter((character) => /[一-龯㐀-䶿]/u.test(character));
  const halfwidthKana = compact.match(/[\uff66-\uff9f]/gu) || [];
  const hasHiragana = /[ぁ-ん]/u.test(compact);
  const uniqueRatio = japanese.length > 0
    ? new Set(japanese.map((character) => character.normalize('NFKC'))).size / japanese.length
    : 1;
  const hasRepeatedCjkRun = /([一-龯㐀-䶿])\1{3,}/u.test(compact);
  const hasDenseHalfwidthKana = halfwidthKana.length >= 5
    && (
      halfwidthKana.length / Math.max(japanese.length, 1) >= 0.55
      || japanese.length >= 18
    );
  const hasLowVarietyLongScript = japanese.length >= 18
    && !hasHiragana
    && (
      uniqueRatio <= 0.55
      || cjk.length / japanese.length >= 0.75
    );
  const visibleNonJapanese = Array.from(compact).filter((character) => (
    !RE_JAPANESE_CHAR.test(character)
  ));
  const hasMixedWidthScriptNoise = !hasHiragana
    && japanese.length >= 5
    && cjk.length >= 2
    && halfwidthKana.length >= 1
    && visibleNonJapanese.length >= 2;

  return {
    isCandidate: hasRepeatedCjkRun
      || hasDenseHalfwidthKana
      || hasLowVarietyLongScript
      || hasMixedWidthScriptNoise,
    hasRepeatedCjkRun,
    hasDenseHalfwidthKana,
    hasLowVarietyLongScript,
    hasMixedWidthScriptNoise,
  };
};

const isPunctuationHeavyAAFragment = (text: string): boolean => {
  const normalized = text.normalize('NFKC');
  const japanese = normalized.match(RE_JAPANESE_CHARS_G) || [];
  if (japanese.length === 0 || japanese.length > 2 || /[ぁ-ん]/u.test(normalized)) return false;
  const drawingPunctuation = normalized.match(/[-―‐…・.．_:：=＝＿￣─━\/／\\＼]/gu) || [];
  return drawingPunctuation.length >= 3 && hasStructuralGlyphDominance(normalized);
};

const hasRepeatedStructuralKana = (text: string): boolean => (
  /(?:ニ|二|ﾆ){2,}/u.test(text.normalize('NFKC'))
);

const isHorizontalAAStructureRun = (text: string): boolean => {
  const normalized = text.normalize('NFKC');
  const japanese = normalized.match(RE_JAPANESE_CHARS_G) || [];
  if (japanese.length < 2 || !RE_HORIZONTAL_AA_JAPANESE.test(japanese.join(''))) return false;
  const visible = Array.from(normalized).filter((character) => !/\s/u.test(character));
  return visible.length >= japanese.length
    && visible.every((character) => RE_HORIZONTAL_AA_STROKE.test(character));
};

const RE_AA_EFFECTS = /．・｀ｰ"|｀ｰ"/;

const isDrawing = (text: string) => {
  if (RE_STRUCTURAL_REPEAT.test(text)) return true;
  if (RE_LINE_BORDERS.test(text)) return true;
  if (RE_AA_EFFECTS.test(text)) return true;

  const hasBoundaryDrawingLines = RE_BOUNDARY_DRAWING.test(text);
  const hasStdHiragana = RE_STANDARD_HIRAGANA.test(text.replace(RE_GEGE_G, ''));
  if (hasBoundaryDrawingLines && !hasStdHiragana) return true;

  const jpChars = text.match(RE_JAPANESE_CHARS_G) || [];
  const symbols = text.match(RE_SYMBOLS_G) || [];
  const hasNaturalKanaRun = /[ぁ-ん]{2,}|[ァ-ヶ]{3,}/u.test(text);

  // If symbols significantly outnumber Japanese characters, it's likely a drawing
  if (jpChars.length > 0 && symbols.length > jpChars.length * 1.5) return true;

  if (jpChars.length > 0 && jpChars.every(c => RE_DRAWING_MARKS.test(c))) return true;

  // Aggressively reject single-character AA fragments (like 'j', 'i', 'v' in drawings)
  if (
    !hasNaturalKanaRun
    && jpChars.length === 1
    && RE_AA_CHARS.test(jpChars[0])
    && text.length <= 3
  ) return true;

  const isAllAAChars = jpChars.length > 0 && jpChars.every(c => RE_AA_CHARS.test(c));
  if (isAllAAChars && !hasNaturalKanaRun) {
    const spacesAndSymbols = text.match(RE_NON_JP_G) || [];
    if (spacesAndSymbols.length >= jpChars.length || jpChars.length === 1) return true;
    if (RE_HALFWIDTH_PUNCT.test(text)) return true;
    if (jpChars.some(c => RE_DRAWING_MARKS.test(c))) return true;
  }

  // Ratio-based check: if AA chars dominate (≥50%) and enough total, likely drawing
  // 50% threshold catches borderline cases where roughly half the chars are AA structural chars
  // Exclude fullwidth digits (０-９) from AA count since they commonly appear in status tables / normal text
  if (jpChars.length >= 3 && !hasNaturalKanaRun) {
    const aaCount = jpChars.filter(c => RE_AA_CHARS.test(c) && !/[\uff10-\uff19]/.test(c)).length;
    if (
      aaCount / jpChars.length >= 0.65
      && symbols.length > 0
      && !RE_HW_DAKUTEN.test(text)
    ) return true;
  }

  return false;
};

// --- Segment interface (plain object, no imports needed) ---
interface WorkerTextSegment {
  id: string;
  text: string;
  original: string;
  isJapanese: boolean;
  isStrictJapanese?: boolean;
  isAutoSelected?: boolean;
  isBoxedDialogue?: boolean;
  isContextDialogue?: boolean;
  isArrowBox?: boolean;
  isVerticalBox?: boolean;
  isIndentedDialogue?: boolean;
  isIsolatedDialogue?: boolean;
  isContextPatternApproved?: boolean;
  isAutoSelectExcluded?: boolean;
  detectionConfidence?: 'high' | 'ambiguous' | 'drawing';
  detectionContextSignature?: string;
  isSelected: boolean;
  isTranslated: boolean;
}

interface SpacedHorizontalDialogueRange {
  start: number;
  end: number;
  isBoxed: boolean;
  isIsolated: boolean;
}

interface StatusWindowTextRange {
  start: number;
  end: number;
}

/**
 * Detect game-like status panels framed by long `╋━━╋` separators and `┃` row
 * walls. Requiring a separator both above and below prevents an arbitrary pair
 * of AA strokes from turning into a status window.
 */
const detectStatusWindowTextRanges = (lines: string[]): Map<number, StatusWindowTextRange[]> => {
  const borderRows = lines
    .map((line, lineIdx) => (/╋━{12,}╋/u.test(line) ? lineIdx : -1))
    .filter((lineIdx) => lineIdx >= 0);
  const ranges = new Map<number, StatusWindowTextRange[]>();
  if (borderRows.length < 2) return ranges;

  lines.forEach((line, lineIdx) => {
    const hasNearbyBorderAbove = borderRows.some((borderRow) => (
      borderRow < lineIdx && lineIdx - borderRow <= 6
    ));
    const hasNearbyBorderBelow = borderRows.some((borderRow) => (
      borderRow > lineIdx && borderRow - lineIdx <= 6
    ));
    if (!hasNearbyBorderAbove || !hasNearbyBorderBelow) return;

    const rowRanges: StatusWindowTextRange[] = [];
    const rowPattern = /┃([^┃]*)┃/gu;
    let match: RegExpExecArray | null;
    while ((match = rowPattern.exec(line)) !== null) {
      if (!RE_JAPANESE_SCRIPT.test(match[1])) continue;
      rowRanges.push({
        start: match.index + 1,
        end: match.index + match[0].length - 1,
      });
    }
    if (rowRanges.length > 0) ranges.set(lineIdx, rowRanges);
  });
  return ranges;
};

const SPACED_DIALOGUE_SCRIPT = 'ぁ-んァ-ヶ一-龯々〆ヵヶ\uff66-\uff9f';
const SPACED_DIALOGUE_SPACE = '[ \\u3000\\u00A0\\u2000-\\u200B]+';
// Some AA sources place a decorative period between two physical blank runs
// (for example "邪   王 .  雷"). Treat only this tightly constrained form as
// a spacing separator; a normal period attached to prose remains punctuation.
const SPACED_DIALOGUE_SEPARATOR = `${SPACED_DIALOGUE_SPACE}(?:[.．·・]${SPACED_DIALOGUE_SPACE})?`;
const SPACED_DIALOGUE_MARK = '[！？!?。、…ー]';
const RE_SPACED_DIALOGUE_RUN = new RegExp(
  `(?:[${SPACED_DIALOGUE_SCRIPT}]{1,2}${SPACED_DIALOGUE_MARK}*${SPACED_DIALOGUE_SEPARATOR}){4,}`
  + `[${SPACED_DIALOGUE_SCRIPT}]{1,2}${SPACED_DIALOGUE_MARK}*`
  + `(?:${SPACED_DIALOGUE_SEPARATOR}[！？!?。、…]+)*`,
  'gu',
);

/**
 * Finds horizontally written dialogue whose author inserted a regular blank
 * cell between nearly every character. It requires both repeated spacing and
 * language evidence; structural AA glyph rows such as "ハ　人　ノ" do not
 * qualify merely because they are evenly spaced.
 */
const findSpacedHorizontalDialogue = (line: string): SpacedHorizontalDialogueRange | undefined => {
  RE_SPACED_DIALOGUE_RUN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RE_SPACED_DIALOGUE_RUN.exec(line)) !== null) {
    const text = match[0];
    const compact = text.replace(/[\s　]/gu, '');
    const japanese = compact.match(RE_JAPANESE_CHARS_G) || [];
    const hiraganaCount = japanese.filter((character) => /[ぁ-ん]/u.test(character)).length;
    const katakanaCount = japanese.filter((character) => /[ァ-ヶ\uff66-\uff9f]/u.test(character)).length;
    const cjkCount = japanese.filter((character) => /[一-龯]/u.test(character)).length;
    const chunks = text.trim().split(/[\s　]+/u).filter(Boolean);
    const singleCharacterChunks = chunks.filter((chunk) => (
      (chunk.match(RE_JAPANESE_CHARS_G) || []).length === 1
    )).length;
    const hasSentenceEnding = /[！？!?。…]$/u.test(compact);
    const hasLanguageEvidence = (
      cjkCount >= 1 && (hiraganaCount >= 2 || katakanaCount >= 2)
    ) || (
      hiraganaCount >= 4 && hasSentenceEnding
    ) || (
      katakanaCount >= 5
      && new Set(japanese.map((character) => character.normalize('NFKC'))).size >= 3
      && hasSentenceEnding
    );
    if (
      japanese.length < 5
      || chunks.length < 5
      || singleCharacterChunks / chunks.length < 0.7
      || !hasLanguageEvidence
      || hasStructuralGlyphDominance(compact)
    ) continue;

    const start = match.index;
    const end = start + text.length;
    const left = line.slice(0, start);
    const right = line.slice(end);
    const hasPairedBoxBoundaries = /[>＞|｜│┃][^>＞|｜│┃]*$/u.test(left)
      && /^[^<＜|｜│┃]*[<＜|｜│┃]/u.test(right);
    const isIsolated = RE_STRICT_BLANK.test(left) && RE_STRICT_BLANK.test(right);
    if (!hasPairedBoxBoundaries && !isIsolated) continue;

    return { start, end, isBoxed: hasPairedBoxBoundaries, isIsolated };
  }
  return undefined;
};

const mergeSpacedHorizontalDialogue = (
  lineSegments: WorkerTextSegment[],
  lineIdx: number,
  range: SpacedHorizontalDialogueRange,
): WorkerTextSegment[] => {
  const result: WorkerTextSegment[] = [];
  const fullLine = lineSegments.map(({ text }) => text).join('');
  let cursor = 0;
  let inserted = false;

  for (const segment of lineSegments) {
    const segmentStart = cursor;
    const segmentEnd = segmentStart + segment.text.length;
    cursor = segmentEnd;
    if (segmentEnd <= range.start || segmentStart >= range.end) {
      result.push(segment);
      continue;
    }

    if (segmentStart < range.start) {
      const length = range.start - segmentStart;
      result.push({
        ...segment,
        id: `seg-${lineIdx}-${segmentStart}`,
        text: segment.text.slice(0, length),
        original: segment.original.slice(0, length),
      });
    }
    if (!inserted) {
      const text = fullLine.slice(range.start, range.end);
      result.push({
        id: `seg-${lineIdx}-${range.start}`,
        text,
        original: text,
        isJapanese: true,
        isStrictJapanese: true,
        isAutoSelected: true,
        isBoxedDialogue: range.isBoxed,
        isIndentedDialogue: true,
        isAutoSelectExcluded: false,
        detectionConfidence: 'high',
        isSelected: false,
        isTranslated: false,
      });
      inserted = true;
    }
    if (segmentEnd > range.end) {
      const offset = range.end - segmentStart;
      result.push({
        ...segment,
        id: `seg-${lineIdx}-${range.end}`,
        text: segment.text.slice(offset),
        original: segment.original.slice(offset),
      });
    }
  }
  return result;
};

// --- Main segmentation function ---
function segmentContent(
  content: string,
  requestId: number,
  visualWidthProfile?: VisualWidthProfile,
): WorkerTextSegment[] {
  const lines = content.split('\n');
  const spatialAnalyzer = new SpatialContextAnalyzer(lines, visualWidthProfile);
  const statusWindowTextRanges = detectStatusWindowTextRanges(lines);
  const newSegments: WorkerTextSegment[] = [];

  const progressInterval = Math.max(100, Math.ceil(lines.length / 100));
  lines.forEach((line, lineIdx) => {
    if (lineIdx % progressInterval === 0) {
      self.postMessage({
        type: 'progress',
        requestId,
        progress: 10 + Math.round((lineIdx / Math.max(1, lines.length)) * 55),
        stage: `텍스트 감지 중 (${lineIdx.toLocaleString()}/${lines.length.toLocaleString()}행)`,
      });
    }
    const lineSegmentStart = newSegments.length;
    // --- Fast path: skip per-part processing for lines with no Japanese ---
    if (!hasJapaneseChar(line)) {
      if (line.length > 0) {
        newSegments.push({
          id: `seg-${lineIdx}-0`,
          text: line,
          original: line,
          isJapanese: false,
          isSelected: false,
          isTranslated: false
        });
      }
      newSegments.push({
        id: `seg-${lineIdx}-newline`,
        text: '\n',
        original: '\n',
        isJapanese: false,
        isSelected: false,
        isTranslated: false
      });
      return;
    }

    const isThreadNameLine = RE_THREAD_NAME.test(line);

    const parts = line.split(RE_GAP);
    let currentOffset = 0;

    parts.forEach((part, partIdx) => {
      if (part === "") return;

      const isSeparator = RE_SEPARATOR.test(part);
      const isJp = !isSeparator && hasJapaneseChar(part);

      const hasLeadingLargeGap = partIdx > 0 && RE_WHITESPACE_GAP.test(parts[partIdx-1]);
      const hasTrailingLargeGap = partIdx < parts.length - 1 && RE_WHITESPACE_GAP.test(parts[partIdx + 1]);
      const isAtStartWithGap = partIdx === 0 && line.startsWith('  ');
      const isIsolatedByGap = hasLeadingLargeGap || isAtStartWithGap;

      const isTouchingBarLeft = partIdx > 0 && RE_BAR_END.test(parts[partIdx-1]);
      const isTouchingBarRight = partIdx < parts.length - 1 && RE_BAR_START.test(parts[partIdx+1]);
      const isTouchingBar = isTouchingBarLeft || isTouchingBarRight;

      const jpCharsMatch = part.match(RE_JAPANESE_CHARS_G) || [];
      const uniqueJpChars = new Set(jpCharsMatch);

      const hasNoAAChars = jpCharsMatch.length > 0 && jpCharsMatch.every(c => !RE_AA_CHARS.test(c));

      const requiredDistinctChars = hasNoAAChars ? 1 : (isIsolatedByGap ? 2 : 3);
      const hasEnoughDistinctJpChars = uniqueJpChars.size >= requiredDistinctChars;

      // If line above is a thread name header, relax vertical isolation (only check below)
      const isAboveThreadName = lineIdx > 0 && RE_THREAD_NAME.test(lines[lineIdx - 1]);

      // --- Lazy computation: expensive functions computed only when needed ---
      let _isDrawingCached: boolean | undefined;
      const getIsDrawing = (): boolean => {
        if (_isDrawingCached === undefined) _isDrawingCached = isDrawing(part);
        return _isDrawingCached;
      };

      let _isVertIsolated: boolean | undefined;
      const getVertIsolated = (): boolean => {
        if (_isVertIsolated === undefined) _isVertIsolated = isVerticallyIsolatedAt(lines, lineIdx, currentOffset, currentOffset + part.length);
        return _isVertIsolated;
      };

      let _isStrictlyIsolated: boolean | undefined;
      const getStrictlyIsolated = (): boolean => {
        if (_isStrictlyIsolated === undefined) _isStrictlyIsolated = isStrictlyIsolatedAt(lines, lineIdx, currentOffset, currentOffset + part.length);
        return _isStrictlyIsolated;
      };

      // Find the closest borders specifically around this part
      let leftBorderIdx = -1;
      for (let i = currentOffset - 1; i >= 0; i--) {
        if (RE_BAR_CHAR.test(line[i])) {
          leftBorderIdx = i;
          break;
        }
      }
      let rightBorderIdx = -1;
      for (let i = currentOffset + part.length; i < line.length; i++) {
        if (RE_BAR_CHAR.test(line[i])) {
          rightBorderIdx = i;
          break;
        }
      }

      // Box isolation check: borders must be surrounded by whitespace on their outer side
      const isLeftBorderStrictlyClean = leftBorderIdx === -1 || 
                                        leftBorderIdx === 0 || 
                                        RE_STRICT_BLANK.test(line[leftBorderIdx - 1]);
      const isRightBorderStrictlyClean = rightBorderIdx === -1 || 
                                         rightBorderIdx === line.length - 1 || 
                                         RE_STRICT_BLANK.test(line[rightBorderIdx + 1]);

      const isLeftBorderClean = leftBorderIdx === -1 || 
                                leftBorderIdx === 0 || 
                                RE_STRICT_BLANK.test(line[leftBorderIdx - 1]) ||
                                RE_BAR_CHAR.test(line[leftBorderIdx - 1]);
      const isRightBorderClean = rightBorderIdx === -1 || 
                                 rightBorderIdx === line.length - 1 || 
                                 RE_STRICT_BLANK.test(line[rightBorderIdx + 1]) ||
                                 RE_BAR_CHAR.test(line[rightBorderIdx + 1]);
      const isBoxIsolated = isLeftBorderClean && isRightBorderClean;

      let _hasCleanBoxCtx: boolean | undefined;
      const getCleanBoxCtx = (): boolean => {
        if (_hasCleanBoxCtx === undefined) {
          const prevLine = lineIdx > 0 ? lines[lineIdx - 1] : "";
          const nextLine = lineIdx < lines.length - 1 ? lines[lineIdx + 1] : "";
          
          // 1. Check for immediate horizontal border lines (top/bottom of a box)
          const isActualBoxBorderLine = (candidateLine: string): boolean => (
            candidateLine.length > 0
            && RE_BOX_BORDER_ANY.test(candidateLine)
            && RE_BAR_CHAR.test(candidateLine)
          );
          const isTopOrBottom = isActualBoxBorderLine(prevLine) || isActualBoxBorderLine(nextLine);
          
          // 2. Check for vertical continuity: neighbors have borders at the same positions (with tolerance)
          const checkBorder = (l: string, idx: number) => {
            if (!l || idx === -1) return false;
            for (let i = idx - 1; i <= idx + 1; i++) {
              if (i >= 0 && i < l.length && RE_BAR_CHAR.test(l[i])) return true;
            }
            return false;
          };
          
          const hasUpperBorder = checkBorder(prevLine, leftBorderIdx) || checkBorder(prevLine, rightBorderIdx);
          const hasLowerBorder = checkBorder(nextLine, leftBorderIdx) || checkBorder(nextLine, rightBorderIdx);
                                 
          _hasCleanBoxCtx = isTopOrBottom || (hasUpperBorder && hasLowerBorder);
        }
        return _hasCleanBoxCtx;
      };

      // For left-border-only detection, require the border to be an actual box pipe (│┃|｜＞ or box drawing),
      // not just any bar-like char (★ etc.) which commonly appear in AA art.
      // Arrow direction: ＞ is valid only as left border (points inward), ＜ only as right border.
      const leftBorderIsBoxPipe = leftBorderIdx !== -1 && RE_BOX_PIPE_CHAR_LEFT.test(line[leftBorderIdx]);
      const rightBorderIsBoxPipe = rightBorderIdx !== -1 && RE_BOX_PIPE_CHAR_RIGHT.test(line[rightBorderIdx]);
      const hasBothBordersWithPipe = (leftBorderIsBoxPipe || rightBorderIsBoxPipe) && leftBorderIdx !== -1 && rightBorderIdx !== -1;
      // Guard: lines with many vertical pipe characters are AA art structures, not real dialogue boxes
      // Real boxes have 2-3 pipes (left border, right border, maybe divider); AA art has many more
      const verticalPipesInLine = (line.match(RE_VERTICAL_PIPES_G) || []).length;
      const isAAStructureLine = verticalPipesInLine > 4;
      const isInsideBox = !isAAStructureLine && isBoxIsolated && (hasBothBordersWithPipe || (leftBorderIsBoxPipe && getCleanBoxCtx()));
      const hasStrongLanguage = hasStrongLexicalEvidence(part);
      const isStatusWindowTextSegment = !isThreadNameLine
        && isJp
        && Boolean(statusWindowTextRanges.get(lineIdx)?.some(({ start, end }) => (
          currentOffset >= start && currentOffset + part.length <= end
        )));
      const isShortCjkSmallKana = isShortCjkSmallKanaCandidate(part);
      const isShortCjkKanaShape = isShortCjkKanaShapeCandidate(part);
      const isMixedScriptEyebrowTexture = isMixedScriptEyebrowTextureCandidate(part);
      const isLikelyFaceFragmentRaw = isLikelyAAFaceFragment(part);
      const isHorizontalStructure = isHorizontalAAStructureRun(part);
      const hasStructuralDominance = hasStructuralGlyphDominance(part);
      const trimmedPart = part.trim();
      const shortHiragana = trimmedPart.match(/[ぁ-ん]/gu) || [];
      const strongShortHiragana = shortHiragana.filter((character) => (
        !/[っぅゃゅょぁぃぇぉ]/u.test(character)
      ));
      const hasSeparatedHorizontalSlot = (
        hasLeadingLargeGap
        || isAtStartWithGap
        || (partIdx > 0 && RE_SEPARATOR.test(parts[partIdx - 1]))
      ) && (
        hasTrailingLargeGap
        || (partIdx < parts.length - 1 && RE_SEPARATOR.test(parts[partIdx + 1]))
        || RE_STRICT_BLANK.test(line.substring(currentOffset + part.length))
      );
      const isIsolatedKanaBlock = hasSeparatedHorizontalSlot
        && isKanaOnlyUtterance(part)
        && getStrictlyIsolated();
      // A horizontally detached response such as はーーいっ！！ remains a
      // natural utterance even when nearby character AA makes the conservative
      // vertical-isolation window fail. The grammar is deliberately narrow:
      // at least two hiragana, two stretch marks, terminal !/?, and a clean
      // horizontal slot are all required.
      // RE_GAP can store an AA border and the long blank after it in the same
      // separator (for example "|　　　　　　"). Inspect the separator's
      // trailing whitespace instead of treating it as a non-blank boundary.
      const previousSeparatorWhitespace = partIdx > 0
        ? parts[partIdx - 1].match(/[\s\u3000\u00a0\u2000-\u200b]+$/u)?.[0] || ''
        : '';
      const nextSeparatorWhitespace = partIdx < parts.length - 1
        ? parts[partIdx + 1].match(/^[\s\u3000\u00a0\u2000-\u200b]+/u)?.[0] || ''
        : '';
      const hasStretchedResponseWhitespaceSlot = (
        hasLeadingLargeGap
        || getDisplayWidth(previousSeparatorWhitespace) >= 4
        || isAtStartWithGap
        || currentOffset === 0
      ) && (
        hasTrailingLargeGap
        || getDisplayWidth(nextSeparatorWhitespace) >= 4
        || RE_STRICT_BLANK.test(line.substring(currentOffset + part.length))
      );
      const isSeparatedStretchedKanaResponse = hasStretchedResponseWhitespaceSlot
        && isStretchedHiraganaVocalization(part);
      const isClearlySeparatedShortUtterance = hasSeparatedHorizontalSlot && (
        isSeparatedStretchedKanaResponse
        ||
        /^[ぁ-ん]{1,2}[！？!?。…]+$/u.test(trimmedPart)
        || (
          // Natural kana effects and calls can contain a prolonged-sound mark
          // between hiragana (for example きりにょーん). Keep this bounded
          // and require multiple distinct ordinary hiragana below so a row of
          // AA dashes or a repeated eye stroke cannot qualify on shape alone.
          /^(?=(?:.*[ぁ-ん]){2,})[ぁ-んー～〜―‐-]{2,10}[！？!?。…]*$/u.test(trimmedPart)
          && (
            new Set(strongShortHiragana).size >= 2
            || /^(?:ああ|わっ|くそ)[！？!?。…]*$/u.test(trimmedPart)
          )
        )
        || /^(?:[一-龯々〆ヵヶ]{1,3}[ぁ-ん]{1,2}|[ぁ-ん]{1,2}[一-龯々〆ヵヶ]{1,3})[！？!?。…]*$/u.test(trimmedPart)
      );
      const contentBeforeCandidate = line.substring(0, currentOffset);
      const contentAfterCandidate = line.substring(currentOffset + part.length);
      const immediateLeftWhitespace = contentBeforeCandidate
        .match(/[\s\u3000\u00a0\u2000-\u200b]+$/u)?.[0] || '';
      const immediateRightWhitespace = contentAfterCandidate
        .match(/^[\s\u3000\u00a0\u2000-\u200b]+/u)?.[0] || '';
      const leadingWhitespaceWidth = getDisplayWidth(immediateLeftWhitespace);
      const trailingWhitespaceWidth = getDisplayWidth(immediateRightWhitespace);
      // Text identity is only a candidate signal. A locally empty rectangle is
      // stronger evidence than a short CJK/kana run looking like an AA stroke.
      // Physical line edges count as open space; otherwise require four display
      // columns on both sides and a wide blank band above and below.
      const hasLocalFourSideWhitespace = getStrictlyIsolated()
        && (
          RE_STRICT_BLANK.test(contentBeforeCandidate)
          || leadingWhitespaceWidth >= 4
        )
        && (
          RE_STRICT_BLANK.test(contentAfterCandidate)
          || trailingWhitespaceWidth >= 4
        );
      const isRightmostFullyIndependentJapaneseShape = !isThreadNameLine
        && RE_STRICT_BLANK.test(contentAfterCandidate)
        && hasLocalFourSideWhitespace
        && isManualPatternJapaneseShape(part);
      const isFourSideIndependentHesitationReaction = !isThreadNameLine
        && hasLocalFourSideWhitespace
        && isLeadingHesitationSingleKanaReaction(part);
      // Saitamaar's proportional spaces can shift nearby AA into the visual
      // analysis window even when a natural note is visibly detached at the
      // far right. A kana phrase followed by a Japanese parenthetical gloss is
      // strong linguistic evidence, but only promote it through this escape
      // hatch when a large physical gap and the right line edge are both real.
      const isRightDetachedParentheticalGloss = !isThreadNameLine
        && hasStrongLanguage
        && leadingWhitespaceWidth >= 8
        && RE_STRICT_BLANK.test(contentAfterCandidate)
        && /^[ぁ-んァ-ヶ\uff66-\uff9f一-龯々〆ヵヶ]{2,}[（(][ぁ-んァ-ヶ\uff66-\uff9f一-龯々〆ヵヶ]{2,}[）)][!?！？。、…]*$/u
          .test(trimmedPart);
      const isRightDetachedKanaStutter = !isThreadNameLine
        && hasStrongLanguage
        && leadingWhitespaceWidth >= 8
        && RE_STRICT_BLANK.test(contentAfterCandidate)
        && /^([ぁ-んァ-ヶ]{1,3})[、,，]\1[ぁ-んァ-ヶー]{1,}[.!?！？。、…]*$/u
          .test(trimmedPart.normalize('NFKC'));
      const isRightDetachedNaturalJapanesePhrase = !isThreadNameLine
        && hasStrongLanguage
        && jpCharsMatch.length >= 4
        && jpCharsMatch.length <= 24
        && !/[\uff66-\uff9f]/u.test(trimmedPart)
        && !/([一-龯々〆ヵヶ])\1{3,}/u.test(trimmedPart)
        && leadingWhitespaceWidth >= 8
        && RE_STRICT_BLANK.test(contentAfterCandidate)
        // A repeated address or correction can contain a deliberate single
        // full-width gap, e.g. "皇帝よ？　皇帝". At the verified far-right
        // detached slot this is sentence spacing, not evidence of AA texture.
        // Hearts are ordinary terminal emotion marks in AA dialogue. Keep them
        // inside this far-right, large-gap natural-language path instead of
        // letting dense AA elsewhere on the same source row veto the slot.
        && /^[ぁ-んァ-ヶ\uff66-\uff9f一-龯々〆ヵヶー!?！？。、…♥♡「」『』（）()\s\u3000]+$/u
          .test(trimmedPart);
      const isRightDetachedAcronymCjkPhrase = !isThreadNameLine
        && leadingWhitespaceWidth >= 8
        && RE_STRICT_BLANK.test(contentAfterCandidate)
        && isAcronymCjkPhrase(part);
      const isRightDetachedNaturalAnnotation = isRightDetachedParentheticalGloss
        || isRightDetachedKanaStutter
        || isRightDetachedNaturalJapanesePhrase
        || isRightDetachedAcronymCjkPhrase;
      const hasMixedKanjiHiragana = /[一-龯々〆ヵヶ]/u.test(trimmedPart)
        && /[ぁ-ん]/u.test(trimmedPart)
        && !isShortCjkSmallKana;
      const japaneseWordChunks = trimmedPart
        .split(/[\s　]+/u)
        .filter((chunk) => RE_JAPANESE_SCRIPT.test(chunk));
      const hasSeparatedJapaneseWords = japaneseWordChunks.length >= 2
        && jpCharsMatch.length >= 6
        && japaneseWordChunks.some((chunk) => /[ぁ-ん]/u.test(chunk));
      const textTexture = getTextTextureSignals(part);
      const isEmbeddedInRepeatedCjkTexture = textTexture.hasMixedWidthScriptNoise
        && lines.slice(Math.max(0, lineIdx - 2), lineIdx + 3)
          .some((nearbyLine) => getTextTextureSignals(nearbyLine).hasRepeatedCjkRun);
      // Short real dialogue is normally separated by padding or enclosed by a
      // bubble. When a short Japanese-looking run is embedded directly in AA,
      // its surrounding geometry is more reliable than the glyphs themselves.
      const isShortContextSensitiveFragment = jpCharsMatch.length >= 2
        && jpCharsMatch.length <= 8
        && !isClearlySeparatedShortUtterance
        && !isIsolatedKanaBlock;
      const isPotentialDottedBox = isJp
        && hasPotentialDottedDialogueBox(lines, lineIdx);
      const shouldAnalyzeSpatialContext = isJp
        && (
          isInsideBox
          || isPotentialDottedBox
          || !hasStrongLanguage
          || hasStructuralDominance
          || textTexture.isCandidate
          || isShortCjkSmallKana
          || isShortCjkKanaShape
          || isShortContextSensitiveFragment
        )
        && !isLikelyFaceFragmentRaw
        && (!isHorizontalStructure || isPotentialDottedBox)
        && (!getIsDrawing() || isPotentialDottedBox);
      const firstJapaneseInPart = isPotentialDottedBox
        ? part.search(RE_JAPANESE_CHAR)
        : -1;
      let lastJapaneseInPart = -1;
      if (firstJapaneseInPart >= 0) {
        for (let index = part.length - 1; index >= firstJapaneseInPart; index -= 1) {
          if (RE_JAPANESE_CHAR.test(part[index])) {
            lastJapaneseInPart = index;
            break;
          }
        }
      }
      const spatialContext = shouldAnalyzeSpatialContext
        ? spatialAnalyzer.analyze(
          lineIdx,
          firstJapaneseInPart >= 0 ? currentOffset + firstJapaneseInPart : currentOffset,
          lastJapaneseInPart >= 0 ? currentOffset + lastJapaneseInPart + 1 : currentOffset + part.length,
        )
        : undefined;
      const faceShapeSpatialContext = spatialContext || (
        isShortCjkKanaShape
          ? spatialAnalyzer.analyze(lineIdx, currentOffset, currentOffset + part.length)
          : undefined
      );
      const hasLocallyClosedDialogueCell = hasLocalClosedDialogueCell(
          lines,
          lineIdx,
          currentOffset,
          currentOffset + part.length,
        );
      const isClosedBubbleVocalization = isStretchedHiraganaVocalization(part)
        && hasLocallyClosedDialogueCell;
      const isClosedBubblePatternPhrase = hasLocallyClosedDialogueCell
        && isManualPatternJapaneseShape(part);
      const hasVerifiedDialogueBox = (
        Boolean(faceShapeSpatialContext?.isClosedDialogueContainer)
        || isClosedBubbleVocalization
        || isClosedBubblePatternPhrase
      )
        && !textTexture.hasRepeatedCjkRun
        && !textTexture.hasMixedWidthScriptNoise;
      const isEmbeddedMixedScriptEyebrowTexture = isMixedScriptEyebrowTexture
        && !hasVerifiedDialogueBox
        && hasBroadAADrawingNeighborhood(
          lines,
          lineIdx,
          currentOffset,
          currentOffset + part.length,
        );
      const isLikelyFaceFragment = isLikelyFaceFragmentRaw
        && !isClearlySeparatedShortUtterance
        && !isIsolatedKanaBlock
        && !isRightmostFullyIndependentJapaneseShape
        && !isFourSideIndependentHesitationReaction
        && !isRightDetachedNaturalAnnotation
        && !isStatusWindowTextSegment
        && !hasLocalFourSideWhitespace
        && !hasVerifiedDialogueBox;
      const attachedDrawingGlyphCount = Array.from(part).filter((character) => (
        !RE_JAPANESE_SCRIPT.test(character)
        && !/[A-Za-z0-9Ａ-Ｚａ-ｚ０-９]/u.test(character)
        && !RE_STRICT_BLANK.test(character)
        && (
          RE_AA_CONTEXT_GLYPH.test(character)
          || /[^ぁ-んァ-ヶ\uff66-\uff9f一-龯!?！？。、…「」『』（）［］【】]/u.test(character)
        )
      )).length;
      const hasAttachedAADrawingTexture = attachedDrawingGlyphCount >= 2;
      const isParenthesizedNaturalDialogue = hasStrongLanguage
        && /^[（(][ぁ-んァ-ヶ\uff66-\uff9f一-龯々〆ヵヶ!?！？。、…「」『』\s\u3000]+[）)]$/u
          .test(trimmedPart);
      // A physical line edge is open space, not a zero-width collision. Count
      // a side as cramped only when a real non-blank glyph exists nearby. AA
      // punctuation swallowed into the same segment also counts as a neighbor.
      const hasCrampedHorizontalContext = hasAttachedAADrawingTexture || (
        contentBeforeCandidate.length > immediateLeftWhitespace.length
        && getDisplayWidth(immediateLeftWhitespace) < 4
      ) || (
        contentAfterCandidate.length > immediateRightWhitespace.length
        && getDisplayWidth(immediateRightWhitespace) < 4
      );
      const isContextualEmbeddedFaceFragment = (
        (
          (
            isShortCjkSmallKana
            || (
              isShortContextSensitiveFragment
              && !isParenthesizedNaturalDialogue
            )
          )
          && hasCrampedHorizontalContext
        )
        || (
          isShortCjkKanaShape
          && Boolean(faceShapeSpatialContext?.isConnectedToLargeDrawing)
          && Boolean(faceShapeSpatialContext?.isDenseDrawingNeighborhood)
        )
      )
        && !hasVerifiedDialogueBox
        && (
          Boolean(faceShapeSpatialContext?.isConnectedToLargeDrawing)
          || Boolean(faceShapeSpatialContext?.isDenseDrawingNeighborhood)
          || hasDenseAADrawingContext(
            lines,
            lineIdx,
            currentOffset,
            currentOffset + part.length,
            8,
            2,
          )
        );

      let _hasVertBoxCtx: boolean | undefined;
      const getVertBoxCtx = (): boolean => {
        if (_hasVertBoxCtx === undefined) _hasVertBoxCtx = hasBoxBorderOrBlankNearby(lines, lineIdx, currentOffset, currentOffset + part.length);
        return _hasVertBoxCtx;
      };

      let _hasSafeVertCtx: boolean | undefined;
      const getSafeVertCtx = (): boolean => {
        if (_hasSafeVertCtx === undefined) _hasSafeVertCtx = hasSafeVerticalContext(lines, lineIdx, currentOffset, currentOffset + part.length);
        return _hasSafeVertCtx;
      };

      // isAllSidesBlank: uses stricter isolation (wider padding) to avoid false positives on AA art fragments
      const isAllSidesBlank = isJp && RE_STRICT_BLANK.test(line.substring(0, currentOffset)) && RE_STRICT_BLANK.test(line.substring(currentOffset + part.length)) && getStrictlyIsolated();

      // Guard: when all sides are blank but text is entirely AA chars and short (≤6), it's likely an AA art fragment
      // Threshold of 6 covers most AA fragments while preserving legitimate short sound effects
      const isAllAAOnly = jpCharsMatch.length > 0 && jpCharsMatch.every(c => RE_AA_CHARS.test(c));
      const hasFluentLanguage = isRecognizedVocalization(part)
        || isStatusWindowTextSegment
        || isClosedBubbleVocalization
        || isIsolatedKanaBlock
        || isClearlySeparatedShortUtterance
        || isRightmostFullyIndependentJapaneseShape
        || isFourSideIndependentHesitationReaction
        || isRightDetachedNaturalAnnotation
        || hasMixedKanjiHiragana
        || hasSeparatedJapaneseWords
        || (
        !hasStructuralDominance && !textTexture.isCandidate && (
          hasStrongLanguage
          || /[ぁ-ん]{3,}/u.test(part)
          || (/[一-龯々〆ヵヶ]/u.test(part) && /[ぁ-ん]{2,}/u.test(part))
        )
      );
      const isSpatialDrawing = Boolean(
        (
          (
            spatialContext?.isConnectedToLargeDrawing
            && (
              !textTexture.isCandidate
              || (spatialContext?.componentRows || 0) >= 2
            )
          )
          || (
            hasStructuralDominance
            && (
              spatialContext?.isDenseDrawingNeighborhood
              || hasRepeatedStructuralKana(part)
              || isPunctuationHeavyAAFragment(part)
            )
          )
          || textTexture.hasRepeatedCjkRun
          || isEmbeddedInRepeatedCjkTexture
          || (
            textTexture.isCandidate
            && (
              spatialContext?.isDenseDrawingNeighborhood
              || (
                spatialContext?.isConnectedToLargeDrawing
                && (spatialContext?.componentRows || 0) >= 2
              )
            )
          )
        )
        && !hasVerifiedDialogueBox
        && !hasFluentLanguage,
      );
      const isSpatialAmbiguous = Boolean(
        !isSpatialDrawing
        && !hasVerifiedDialogueBox
        && !hasFluentLanguage
        && (
          spatialContext?.isDenseDrawingNeighborhood
          || (
            jpCharsMatch.length <= 2
            && (spatialContext?.localOccupiedRows || 0) >= 3
            && (spatialContext?.localDrawingGlyphs || 0) >= (hasStructuralDominance ? 4 : 6)
          )
        ),
      );
      const hasDenseAAContext = jpCharsMatch.length <= 4
        && !hasFluentLanguage
        && !hasVerifiedDialogueBox
        && hasDenseAADrawingContext(lines, lineIdx, currentOffset, currentOffset + part.length);
      // Guard: segments with no real Japanese script content are never selectable in any path
      // Real Japanese = hiragana, katakana (\u30a0-\u30ff), kanji (\u4e00-\u9faf) — not just fullwidth ASCII (\uff01-\uff5e)
      // Blocks: single AA art chars (人,ノ), fullwidth punctuation only (（）), special chars
      // Allows: hiragana (お,え〜), katakana sound effects, kanji text
      const hasHiragana = RE_STANDARD_HIRAGANA.test(part);
      const hasJapaneseScript = RE_JAPANESE_SCRIPT.test(part);
      const isShortBarAttachedFragment = isTouchingBar
        && jpCharsMatch.length <= 2
        && !hasStrongLanguage
        && !isClosedBubbleVocalization;
      const isNeverSelectable = RE_DISQUALIFIED.test(part)
        || RE_NOISE_ONLY.test(part)
        || !RE_MEANINGFUL_JP.test(part)
        || isLikelyFaceFragment
        || isContextualEmbeddedFaceFragment
        || isEmbeddedMixedScriptEyebrowTexture
        || isHorizontalStructure
        || (isSpatialDrawing && !isClosedBubbleVocalization)
        || isShortBarAttachedFragment
        || (!hasHiragana && isAllAAOnly && jpCharsMatch.length <= 1);
      const isAllSidesBlankQualified = isAllSidesBlank && !isNeverSelectable;

      // Relaxed path first (isAllSidesBlank already computed) to short-circuit the expensive strict regex
      // When all 4 sides are blank (isAllSidesBlankQualified), skip isDrawing: truly isolated text is likely a sound effect / annotation
      const isStrict = !isThreadNameLine && !isNeverSelectable && isJp && hasEnoughDistinctJpChars && (!isTouchingBar || hasNoAAChars) && (
        (isAllSidesBlankQualified && !isLikelyFaceFragment)
        || (getSafeVertCtx() && !getIsDrawing() && isStrictJapaneseText(part) && (isAboveThreadName || getVertIsolated()))
      );

      // Edge position: outer sides of the segment contain only whitespace/border chars
      const isAtLeftEdge = RE_EDGE_BLANK.test(line.substring(0, currentOffset));
      const isAtRightEdge = RE_EDGE_BLANK.test(line.substring(currentOffset + part.length));
      const isEdgePositioned = isAtLeftEdge || isAtRightEdge;

      const leftPart = partIdx > 0 ? parts[partIdx - 1] : "";
      const rightPart = partIdx < parts.length - 1 ? parts[partIdx + 1] : "";
      const hasLeadingSeparatorGap = Boolean(leftPart && RE_SEPARATOR.test(leftPart));
      const hasTrailingSeparatorGap = Boolean(rightPart && RE_SEPARATOR.test(rightPart));

      const hasCleanOuterEdge = (leftPart && (RE_SEPARATOR.test(leftPart) || RE_STRICT_BLANK.test(leftPart))) &&
                                (rightPart && (RE_SEPARATOR.test(rightPart) || RE_STRICT_BLANK.test(rightPart)));
      
      const isLongJp = jpCharsMatch.length >= 5;
      
      // Guard: reject text where non-JP symbols outnumber or equal JP chars (likely AA art fragments like ".!丈zﾘ")
      const symbolCount = (part.match(RE_SYMBOLS_G) || []).filter(c => !/[0-9]/.test(c)).length;
      const hasExcessiveSymbols = symbolCount >= jpCharsMatch.length && jpCharsMatch.length > 0;
      
      // Guard: single AA-char segments with only a left border are likely AA art decoration, not dialogue
      const isLeftBorderOnlySingleAA = !hasBothBordersWithPipe && isAllAAOnly && jpCharsMatch.length <= 1;
      // Guard: short (≤2 chars) AA-only segments classified as drawing are AA art fragments, not dialogue
      // Exception: pure fullwidth digits (０-９) which are legitimate data values in boxes/tables
      const isShortDrawingAA = isAllAAOnly && jpCharsMatch.length <= 2 && getIsDrawing() && !jpCharsMatch.every(c => /[\uff10-\uff19]/.test(c));
      // Guard: segments composed entirely of fullwidth structural/border chars (＿ ＝) are never dialogue
      const isAllStructuralBorder = jpCharsMatch.length > 0 && jpCharsMatch.every(c => /[＿＝]/.test(c));

      const isVerifiedDottedBoxDialogue = isPotentialDottedBox
        && hasVerifiedDialogueBox
        && isJp
        && !isNeverSelectable
        && !hasExcessiveSymbols
        && !isAllStructuralBorder;
      const isBoxedDialogue = isVerifiedDottedBoxDialogue || (!isThreadNameLine
        && !isNeverSelectable
        && (isInsideBox || isClosedBubbleVocalization)
        && isJp
        && !hasExcessiveSymbols
        && !isAllStructuralBorder
        && (getSafeVertCtx() || isClosedBubbleVocalization)
        && (isStrictJapaneseText(part) || isClosedBubbleVocalization)
        && (
        isClosedBubbleVocalization
        ||
        (getCleanBoxCtx() && !isLeftBorderOnlySingleAA && !isShortDrawingAA) || 
        (!getIsDrawing() && (
          isLongJp || 
          hasCleanOuterEdge ||
          (isEdgePositioned && (hasNoAAChars || uniqueJpChars.size >= 3)) ||
          (isTouchingBar && (uniqueJpChars.size >= 3 || hasNoAAChars))
        ))
      ));

      const isSpatiallySeparatedHalfwidthDialogue = textTexture.hasDenseHalfwidthKana
        && RE_JAPANESE_PUNCTUATION.test(part)
        && !spatialContext?.isDenseDrawingNeighborhood
        && !(
          spatialContext?.isConnectedToLargeDrawing
          && (spatialContext?.componentRows || 0) >= 2
        )
        && getVertIsolated();
      const isNaturalText = isNaturalJapaneseText(part, true)
        || isSpatiallySeparatedHalfwidthDialogue;

      const hasSomeNonAAChars = jpCharsMatch.some(c => !RE_AA_CHARS.test(c));
      const hasHwDakuten = RE_HW_DAKUTEN.test(part);

      const leftContent = line.substring(0, currentOffset);
      const trailingSpacesMatch = leftContent.match(/[\s\u3000\u00A0\u2000-\u200B]+$/);
      const trailingSpaces = trailingSpacesMatch ? trailingSpacesMatch[0] : "";

      const hiraganaMatch = part.match(/[ぁ-ん]/g) || [];
      const uniqueHiraganaCount = new Set(hiraganaMatch).size;

      const rightContent = line.substring(currentOffset + part.length);
      const hasPairedDialogueBorders = (
        leftBorderIdx !== -1
        && rightBorderIdx !== -1
        && (
          (
            RE_ARROW_BOX_START.test(line[leftBorderIdx])
            && RE_ARROW_BOX_END.test(line[rightBorderIdx])
          )
          || (
            line[leftBorderIdx] === ':'
            && (line[rightBorderIdx] === ':' || line[rightBorderIdx] === '.')
          )
        )
      );
      const hasCleanInnerDialogueGaps = (
        leftBorderIdx !== -1
        && rightBorderIdx !== -1
        && /^[ \u3000\u00A0\u2000-\u200B\u2009:.]*$/.test(
          line.substring(leftBorderIdx + 1, currentOffset),
        )
        && /^[ \u3000\u00A0\u2000-\u200B\u2009:.]*$/.test(
          line.substring(currentOffset + part.length, rightBorderIdx),
        )
      );
      const hasComfortableHorizontalSpace = (
        leadingWhitespaceWidth >= 2
        && trailingWhitespaceWidth >= 2
      ) || (
        Math.max(leadingWhitespaceWidth, trailingWhitespaceWidth) >= 6
        && (
          RE_STRICT_BLANK.test(leftContent)
          || RE_STRICT_BLANK.test(rightContent)
          || hasPairedDialogueBorders
        )
      );
      const hasDialogueContextEvidence = hasStrongLanguage
        || isClearlySeparatedShortUtterance
        || jpCharsMatch.length >= 6
        || hasComfortableHorizontalSpace
        || hasPairedDialogueBorders
        || isInsideBox
        || hasVerifiedDialogueBox;
      const isStrongBorderedNaturalText = (
        isNaturalText
        && (
          jpCharsMatch.length >= 4
          || (
            jpCharsMatch.length >= 2
            && RE_JAPANESE_PUNCTUATION.test(part)
          )
        )
        && hasPairedDialogueBorders
        && hasCleanInnerDialogueGaps
        && !getIsDrawing()
      );

      const isArrowBox = !RE_DISQUALIFIED.test(part) && !RE_NOISE_ONLY.test(part) &&
                         isNaturalText &&
                         (
                           jpCharsMatch.length >= 2
                           || (
                             jpCharsMatch.length === 1
                             && RE_JAPANESE_PUNCTUATION.test(part)
                           )
                         ) &&
                         hasPairedDialogueBorders &&
                         hasCleanInnerDialogueGaps &&
                         (
                           isStrongBorderedNaturalText
                           || (
                             isLeftBorderStrictlyClean
                             && isRightBorderStrictlyClean
                             && getSafeVertCtx()
                             && (getVertIsolated() || !getIsDrawing())
                             && /^[ \u3000\u00A0\u2000-\u200B\u2009:.]*$/.test(
                               line.substring(rightBorderIdx + 1),
                             )
                           )
                         );

      // For isVerticalBox: find dedicated pipe/arrow borders (|, ｜, >, ＞ for left; |, ｜, <, ＜ for right)
      // This skips box-drawing chars like │/┃ that may appear as content in vertical text (representing ー)
      let vertLeftPipeIdx = -1;
      for (let i = currentOffset - 1; i >= 0; i--) {
        if (line[i] === '|' || line[i] === '｜' || line[i] === '>' || line[i] === '＞') {
          vertLeftPipeIdx = i; break;
        }
      }
      let vertRightPipeIdx = -1;
      for (let i = currentOffset + part.length; i < line.length; i++) {
        if (line[i] === '|' || line[i] === '｜' || line[i] === '<' || line[i] === '＜') {
          vertRightPipeIdx = i; break;
        }
      }

      const isVerticalBox = !RE_DISQUALIFIED.test(part) && !RE_NOISE_ONLY.test(part) &&
                         (RE_JAPANESE_SCRIPT.test(part) || /^[\uff01-\uff5e\s\u3000\u00A0\u2000-\u200B\u2009│┃]*$/.test(part)) &&
                         vertLeftPipeIdx !== -1 && vertRightPipeIdx !== -1 &&
                         (
                           ((line[vertLeftPipeIdx] === '|' || line[vertLeftPipeIdx] === '｜') && (line[vertRightPipeIdx] === '|' || line[vertRightPipeIdx] === '｜')) ||
                           ((line[vertLeftPipeIdx] === '>' || line[vertLeftPipeIdx] === '＞') && (line[vertRightPipeIdx] === '<' || line[vertRightPipeIdx] === '＜'))
                         ) &&
                         RE_VERT_BOX_GAP.test(line.substring(vertLeftPipeIdx + 1, currentOffset)) &&
                         RE_VERT_BOX_GAP.test(line.substring(currentOffset + part.length, vertRightPipeIdx)) &&
                         // Right border must be at or near end of line (no content after it) to avoid matching AA art pipes
                         RE_STRICT_BLANK.test(line.substring(vertRightPipeIdx + 1)) &&
                         // Vertical box content is sparse: at most 3 non-whitespace chars between pipe borders
                         line.substring(vertLeftPipeIdx + 1, vertRightPipeIdx).replace(/[\s\u3000\u00A0\u2000-\u200B\u2009]/g, '').length <= MAX_VERT_BOX_CONTENT_CHARS &&
                         (() => {
                           const prevLine = lineIdx > 0 ? lines[lineIdx - 1] : "";
                           const nextLine = lineIdx < lines.length - 1 ? lines[lineIdx + 1] : "";
                           // Use display-width-based alignment to find matching borders on adjacent lines,
                           // since mixed full/half-width AA art causes character indices to differ even when visually aligned.
                           const checkBorder = (l: string, idx: number, char: string) => {
                             if (!l || idx === -1) return false;
                             const isPipe = char === '|' || char === '｜';
                             const isArrowLeft = char === '>' || char === '＞';
                             const isArrowRight = char === '<' || char === '＜';
                             const dispW = getDisplayWidth(line.substring(0, idx));
                             const checkStart = Math.max(0, dispW - VERT_BOX_BORDER_TOLERANCE);
                             const checkEnd = dispW + VERT_BOX_BORDER_TOLERANCE + 1;
                             const substr = substringByDisplayCols(l, checkStart, checkEnd);
                             for (let i = 0; i < substr.length; i++) {
                               const c = substr[i];
                               if (isPipe && (c === '|' || c === '｜' || c === '│' || c === '┃')) return true;
                               if (isArrowLeft && (c === '>' || c === '＞')) return true;
                               if (isArrowRight && (c === '<' || c === '＜')) return true;
                             }
                             return false;
                           };
                           const leftChar = line[vertLeftPipeIdx];
                           const rightChar = line[vertRightPipeIdx];
                           const hasUpper = checkBorder(prevLine, vertLeftPipeIdx, leftChar) && checkBorder(prevLine, vertRightPipeIdx, rightChar);
                           const hasLower = checkBorder(nextLine, vertLeftPipeIdx, leftChar) && checkBorder(nextLine, vertRightPipeIdx, rightChar);
                           return hasUpper || hasLower;
                         })();

      const isStandaloneNaturalText = (
        !isThreadNameLine
        && !isNeverSelectable
        && isNaturalText
        && hasDialogueContextEvidence
        && (
          isClearlySeparatedShortUtterance
          ||
          jpCharsMatch.length >= 4
          || (
            jpCharsMatch.length >= 2
            && RE_JAPANESE_PUNCTUATION.test(part)
          )
        )
        && RE_STRICT_BLANK.test(line.substring(0, currentOffset))
        && RE_STRICT_BLANK.test(rightContent)
      );
      const isGapSeparatedNaturalText = (
        !isThreadNameLine
        && !isNeverSelectable
        && isNaturalText
        && (
          isClearlySeparatedShortUtterance
          ||
          jpCharsMatch.length >= 4
          || (
            jpCharsMatch.length >= 2
            && RE_JAPANESE_PUNCTUATION.test(part)
          )
          || (
            uniqueHiraganaCount >= 2
            && getVertIsolated()
          )
        )
        && (hasLeadingLargeGap || hasLeadingSeparatorGap || isAtStartWithGap)
        && (hasTrailingLargeGap || hasTrailingSeparatorGap || RE_STRICT_BLANK.test(rightContent))
      );
      const isLooseRightAnnotation = (
        !isThreadNameLine
        && isNaturalText
        && !/[\uff66-\uff9f]/u.test(part)
        && jpCharsMatch.length >= 2
        && (
          RE_JAPANESE_PUNCTUATION.test(part)
          || uniqueHiraganaCount >= 2
        )
        && getDisplayWidth(trailingSpaces) >= 4
        && (hasTrailingLargeGap || hasTrailingSeparatorGap || RE_STRICT_BLANK.test(rightContent))
        && !getIsDrawing()
      );

      const isIndentedDialogue = !isNeverSelectable &&
                                 isNaturalText && !getIsDrawing() &&
                                 hasDialogueContextEvidence &&
                                 (
                                   isStandaloneNaturalText
                                   || isGapSeparatedNaturalText
                                   || isLooseRightAnnotation
                                   || (
                                     part.length >= 5
                                     && uniqueHiraganaCount >= 2
                                     && getDisplayWidth(trailingSpaces) >= 6
                                     && RE_STRICT_BLANK.test(rightContent)
                                   )
                                 );

      const isIsolatedDialogue = !isNeverSelectable &&
                                 /[ぁ-んァ-ン\uff66-\uff9f]/.test(part) &&
                                 hasDialogueContextEvidence &&
                                 (!getIsDrawing() || !isDrawing(part)) &&
                                 getDisplayWidth(trailingSpaces) >= 2 &&
                                 RE_STRICT_BLANK.test(rightContent) &&
                                 (getVertIsolated() || (getDisplayWidth(trailingSpaces) >= 4 && isVerticallyIsolatedAt(lines, lineIdx, currentOffset, currentOffset + part.length, 4)));

      const isContextDlg = !isThreadNameLine && !isNeverSelectable && !isStrict && !isBoxedDialogue && isJp && !getIsDrawing()
        && !isTouchingBar
        && (hasNoAAChars || (hasSomeNonAAChars && uniqueJpChars.size >= 2) || hasHwDakuten)
        // Horizontal check: at edge of line OR near vertical box context (lenient, one side enough)
        && (isEdgePositioned || getVertBoxCtx())
        // Vertical check: BOTH above AND below must be blank at the segment's position
        && getVertIsolated()
        // Additional check: If not strict Japanese, BOTH lines above AND below should be entirely blank
        // to avoid selecting segments embedded in dense AA art blocks.
        && (RE_STRICT_BLANK.test(lineIdx > 0 ? lines[lineIdx - 1] : "") && RE_STRICT_BLANK.test(lineIdx < lines.length - 1 ? lines[lineIdx + 1] : ""))
        // Reject if surrounded by drawings on both sides
        && !(lineIdx > 0 && lineIdx < lines.length - 1 && isDrawing(lines[lineIdx - 1]) && isDrawing(lines[lineIdx + 1]));

      const isJapaneseCandidate = !RE_DISQUALIFIED.test(part)
        && !RE_STRICT_BLANK.test(part)
        && !RE_NOISE_ONLY.test(part)
        && !isEmbeddedMixedScriptEyebrowTexture
        && !isSpatialDrawing
        && (
          isNaturalText
          || isStatusWindowTextSegment
          || isIsolatedKanaBlock
          || isRightmostFullyIndependentJapaneseShape
          || isFourSideIndependentHesitationReaction
          || isRightDetachedNaturalAnnotation
          || isStrict
          || isBoxedDialogue
          || isContextDlg
          || isArrowBox
          || isIndentedDialogue
          || isIsolatedDialogue
        );
      const hasMixedKanaWidth = /[ぁ-ん]/u.test(part)
        && /[\uff66-\uff9f]/u.test(part);
      const hasFullwidthLatinJapanesePhrase = /[Ａ-Ｚａ-ｚ]{2,}/u.test(part)
        && (part.match(/[ぁ-ん]/gu) || []).length >= 2
        && jpCharsMatch.length >= 4;
      const hasLatinJapaneseDrawingMix = /[A-Za-z]/u.test(part.normalize('NFKC'))
        && RE_JAPANESE_SCRIPT.test(part)
        && !hasFullwidthLatinJapanesePhrase
        && (
          /[\uff66-\uff9f]/u.test(part)
          || (part.match(RE_SYMBOLS_G) || []).length > 0
          || /[一-龯々〆ヵヶ]/u.test(part)
        );
      const hasCjkHeavySparseHiragana = (
        (part.match(/[一-龯々〆ヵヶ]/gu) || []).length >= 4
        && (part.match(/[ぁ-ん]/gu) || []).length <= 2
      );
      const hasCleanSpatialDialogueContainer = hasVerifiedDialogueBox
        && hasStrongLanguage
        && !textTexture.isCandidate
        && !hasStructuralDominance
        && !hasMixedKanaWidth
        && !hasLatinJapaneseDrawingMix
        && !hasCjkHeavySparseHiragana;
      const hasConfirmedDialogueContainer = Boolean(
        hasVerifiedDialogueBox
        || isClosedBubbleVocalization
        || isBoxedDialogue
        || (isArrowBox && hasComfortableHorizontalSpace)
        || hasCleanSpatialDialogueContainer,
      );
      // Manual-rule shapes are also safe inside a real physical box. Do not use
      // loose "box-like" texture here: require actual side walls, verified
      // top/bottom or continuing borders, and usable inner horizontal padding.
      const isVerifiedPhysicalBoxPatternContext = isInsideBox
        && getCleanBoxCtx()
        && hasComfortableHorizontalSpace
        && (getSafeVertCtx() || getVertBoxCtx());
      const isBoxQualifiedJapaneseShape = !isThreadNameLine
        && (
          hasVerifiedDialogueBox
          || isVerifiedPhysicalBoxPatternContext
        )
        && (
          isManualPatternJapaneseShape(part)
          || (
            hasVerifiedDialogueBox
            && isShortBoxedCjkParticlePhrase(part)
          )
        );
      const isSpatiallyQualifiedShortMixedPhrase = !isThreadNameLine
        && isShortMixedJapanesePhrase(part)
        && (
          hasVerifiedDialogueBox
          || isVerifiedPhysicalBoxPatternContext
          || hasLocalFourSideWhitespace
        );
      // The general four-side detector deliberately examines a wide 12-column
      // vertical window. That is useful for kana/kanji eyebrow fragments, but
      // it was too conservative for unmistakable number+CJK exclamations: AA
      // several cells away could veto an otherwise empty status/dialogue slot.
      // Require four visible blank columns on both horizontal sides (or a real
      // line edge) and a tighter four-column blank range immediately above and
      // below. Attached number-shaped AA still fails these physical checks.
      const hasIndependentPunctuatedNumericSlot = isPunctuatedNumericCjkPhrase(part)
        && (
          leadingWhitespaceWidth >= 4
          || RE_STRICT_BLANK.test(contentBeforeCandidate)
        )
        // "Independent" also means that no later AA/text exists on this row;
        // a four-cell gap followed by another token is merely an inline label.
        && RE_STRICT_BLANK.test(contentAfterCandidate)
        && isVerticallyIsolatedAt(
          lines,
          lineIdx,
          currentOffset,
          currentOffset + part.length,
          4,
        );
      const isSpatiallyQualifiedShortNumericPhrase = !isThreadNameLine
        && isShortNumericJapanesePhrase(part)
        && (
          hasVerifiedDialogueBox
          || isVerifiedPhysicalBoxPatternContext
          || hasIndependentPunctuatedNumericSlot
          || (
            hasLocalFourSideWhitespace
            && RE_STRICT_BLANK.test(contentAfterCandidate)
          )
        );
      const isContextPatternApproved = isRightmostFullyIndependentJapaneseShape
        || isFourSideIndependentHesitationReaction
        || isBoxQualifiedJapaneseShape
        || isSpatiallyQualifiedShortMixedPhrase
        || isSpatiallyQualifiedShortNumericPhrase
        || isRightDetachedNaturalAnnotation
        || isStatusWindowTextSegment;
      const isJapanese = isJapaneseCandidate || (
        !RE_DISQUALIFIED.test(part)
        && !RE_STRICT_BLANK.test(part)
        && !RE_NOISE_ONLY.test(part)
        && isContextPatternApproved
      );
      const hasFourSideLocalWhitespace = !isNeverSelectable
        && hasLocalFourSideWhitespace;
      const isAdjacentDialogueContinuation = !isNeverSelectable
        && isNaturalText
        && !getIsDrawing()
        && !hasStructuralDominance
        && !textTexture.isCandidate
        && jpCharsMatch.length >= 2
        && hasAlignedNaturalSentenceNeighbor(
          lines,
          lineIdx,
          currentOffset,
          currentOffset + part.length,
        );
      const hasDocumentSelectionEvidence = hasConfirmedDialogueContainer
        || isContextPatternApproved
        || hasFourSideLocalWhitespace
        || isAdjacentDialogueContinuation;
      const isEmbeddedInDenseAA = !hasConfirmedDialogueContainer
        && !isContextPatternApproved
        && !isAllSidesBlankQualified
        && (
          textTexture.isCandidate
          || hasStructuralDominance
          || !hasStrongLanguage
          || hasMixedKanaWidth
          || hasLatinJapaneseDrawingMix
          || hasCjkHeavySparseHiragana
        )
        && hasDenseAADrawingContext(
          lines,
          lineIdx,
          currentOffset,
          currentOffset + part.length,
        );
      const isAutoSelectExcluded = RE_AUTO_SELECT_EXCLUDE.test(part)
        || (isNeverSelectable && !hasConfirmedDialogueContainer && !isContextPatternApproved)
        || (
          !hasConfirmedDialogueContainer
          && !isContextPatternApproved
          && (isLikelyFaceFragment || isContextualEmbeddedFaceFragment)
        )
        || isHorizontalStructure
        || isEmbeddedInDenseAA
        || (
          !hasDocumentSelectionEvidence
          && (
            (hasDenseAAContext && !isClosedBubbleVocalization)
            || isSpatialAmbiguous
          )
        );
      const detectionConfidence = (
        !hasConfirmedDialogueContainer
        && !isContextPatternApproved
        && (
          isSpatialDrawing
          || isLikelyFaceFragment
          || isContextualEmbeddedFaceFragment
        )
      ) || isHorizontalStructure
        ? 'drawing'
        : isJapanese && isAutoSelectExcluded
          ? 'ambiguous'
        : isJapanese
            ? 'high'
            : undefined;
      newSegments.push({
        id: `seg-${lineIdx}-${currentOffset}`,
        text: part,
        original: part,
        isJapanese,
        isAutoSelected: isIsolatedKanaBlock
          || isContextPatternApproved
          || hasFourSideLocalWhitespace
          || isAdjacentDialogueContinuation,
        isStrictJapanese: isStrict,
        isBoxedDialogue: isBoxedDialogue,
        isContextDialogue: isContextDlg,
        isArrowBox: isArrowBox,
        isVerticalBox: isVerticalBox,
        isIndentedDialogue: isIndentedDialogue,
        isIsolatedDialogue: isIsolatedDialogue,
        isContextPatternApproved,
        isAutoSelectExcluded: isAutoSelectExcluded,
        detectionConfidence,
        detectionContextSignature: spatialContext?.contextSignature,
        isSelected: false,
        isTranslated: false
      });

      currentOffset += part.length;
    });

    const spacedDialogue = findSpacedHorizontalDialogue(line);
    if (spacedDialogue) {
      const lineSegments = newSegments.splice(lineSegmentStart);
      newSegments.push(...mergeSpacedHorizontalDialogue(
        lineSegments,
        lineIdx,
        spacedDialogue,
      ));
    }

    newSegments.push({
      id: `seg-${lineIdx}-newline`,
      text: '\n',
      original: '\n',
      isJapanese: false,
      isSelected: false,
      isTranslated: false
    });
  });

  // Remove trailing newline segment (matches original behavior)
  const result = newSegments.slice(0, -1);

  // Merge consecutive non-interactive segments to reduce DOM node count.
  // A conservatively rejected Japanese fragment remains addressable only
  // when its layout is useful for structural learning (bubble, clear edge,
  // vertical isolation, or sufficient horizontal whitespace). Keeping every
  // Japanese-looking glyph in dense AA would create too many DOM nodes.
  const merged: WorkerTextSegment[] = [];
  for (const seg of result) {
    if (!seg.isJapanese && seg.text !== '\n') {
      const prev = merged[merged.length - 1];
      if (
        prev
        && !prev.isJapanese
        && prev.text !== '\n'
      ) {
        prev.text += seg.text;
        prev.original += seg.original;
        continue;
      }
    }
    merged.push(seg);
  }

  return merged;
}

// --- Message handler ---
self.onmessage = (e: MessageEvent<{
  type: string;
  content?: string;
  requestId: number;
  visualWidthProfile?: VisualWidthProfile;
  postProcess?: boolean;
  manualRegexRules?: ManualRegexRules;
  selectionExclusions?: SelectionExclusionRules;
  segments?: TextSegment[];
}>) => {
  if (e.data.type === 'apply-rules') {
    const segments = applySelectionExclusions(
      applyManualRegexRules(
        e.data.segments || [],
        e.data.manualRegexRules || { entries: [] },
      ),
      e.data.selectionExclusions || { exact: [] },
    );
    self.postMessage({
      type: 'result',
      requestId: e.data.requestId,
      segments,
    });
    return;
  }
  if (e.data.type === 'segment') {
    self.postMessage({
      type: 'progress',
      requestId: e.data.requestId,
      progress: 10,
      stage: '텍스트 구조를 준비하는 중',
    });
    const segmented = segmentContent(
      e.data.content || '',
      e.data.requestId,
      e.data.visualWidthProfile,
    );
    let segments: TextSegment[] | WorkerTextSegment[] = segmented;
    if (e.data.postProcess) {
      self.postMessage({
        type: 'progress',
        requestId: e.data.requestId,
        progress: 68,
        stage: '세로쓰기 영역을 분석하는 중',
      });
      segments = annotateVerticalTextSegments(
        e.data.content || '',
        segmented as TextSegment[],
        (completed, total) => {
          const ratio = completed / Math.max(1, total);
          self.postMessage({
            type: 'progress',
            requestId: e.data.requestId,
            progress: 68 + Math.round(ratio * 17),
            stage: `세로쓰기 영역을 분석하는 중 (${Math.round(ratio * 100)}%)`,
          });
        },
      );
      self.postMessage({
        type: 'progress',
        requestId: e.data.requestId,
        progress: 86,
        stage: '수동정규식을 적용하는 중',
      });
      segments = applyManualRegexRules(
        segments,
        e.data.manualRegexRules || { entries: [] },
      );
      self.postMessage({
        type: 'progress',
        requestId: e.data.requestId,
        progress: 95,
        stage: '금지목록과 선택 상태를 정리하는 중',
      });
      segments = applySelectionExclusions(
        segments,
        e.data.selectionExclusions || { exact: [] },
      );
    }
    self.postMessage({
      type: 'result',
      requestId: e.data.requestId,
      segments,
    });
  }
};
