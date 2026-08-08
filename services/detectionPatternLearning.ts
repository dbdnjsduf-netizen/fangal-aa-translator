import {
  ManualRegexRules,
  SelectionExclusionKind,
  SelectionExclusionRules,
  TextSegment,
} from '../types';
import { contextSignatureSimilarity } from './spatialDetection';

interface LabeledPattern {
  kind: SelectionExclusionKind;
  source: string;
  contextSignature?: string;
}

const AUTOMATIC_DETECTION_FLAGS: Array<keyof TextSegment> = [
  'isStrictJapanese',
  'isAutoSelected',
  'isBoxedDialogue',
  'isContextDialogue',
  'isArrowBox',
  'isVerticalBox',
  'isIndentedDialogue',
  'isIsolatedDialogue',
];

/**
 * Uses user-maintained rules as conservative labeled examples.
 *
 * Exact manual-regex selection and exact bans remain authoritative in their
 * own services. This layer only suppresses weak, short auto-detection
 * candidates that are very similar to a banned AA fragment. Fluent Japanese
 * is never fuzzily suppressed, and a similar positive manual rule cancels the
 * learned suppression.
 */
export function refineAutoDetectionWithLearnedPatterns(
  segments: TextSegment[],
  exclusionRules: SelectionExclusionRules,
  manualRegexRules: ManualRegexRules,
): TextSegment[] {
  const negatives = exclusionRules.exact.map(({ kind, sourceText, contextSignature }) => ({
    kind,
    source: normalizePattern(sourceText),
    contextSignature,
  })).filter(({ source }) => source.length > 0);
  if (negatives.length === 0) {
    return clearLearnedExclusions(segments);
  }
  const positives = manualRegexRules.entries.map(({ kind, sourceText, contextSignature }) => ({
    kind,
    source: normalizePattern(sourceText),
    contextSignature,
  })).filter(({ source }) => source.length > 0);

  const verticalSourceByGroup = buildVerticalSources(segments);
  const learnedVerticalGroups = new Set<string>();
  for (const [groupId, group] of verticalSourceByGroup) {
    if (shouldSuppress(group.source, 'vertical', group.contextSignature, negatives, positives)) {
      learnedVerticalGroups.add(groupId);
    }
  }

  let changed = false;
  const next = segments.map((segment) => {
    const isManual = Boolean(
      segment.isManualSelection
      || segment.isManualRegexSelection
      || segment.isManualVerticalSelection,
    );
    const isAutomaticCandidate = segment.isJapanese
      && !segment.isTranslated
      && AUTOMATIC_DETECTION_FLAGS.some((flag) => Boolean(segment[flag]));
    const suppress = !isManual && isAutomaticCandidate && (
      segment.verticalGroupId
        ? learnedVerticalGroups.has(segment.verticalGroupId)
        : shouldSuppress(
          sourceOf(segment),
          'normal',
          segment.detectionContextSignature,
          negatives,
          positives,
        )
    );
    const learned = suppress || undefined;
    if (segment.isPatternAutoSelectExcluded === learned) return segment;
    changed = true;
    return {
      ...segment,
      isPatternAutoSelectExcluded: learned,
      isSelected: suppress ? false : segment.isSelected,
    };
  });
  return changed ? next : segments;
}

function shouldSuppress(
  sourceText: string,
  kind: SelectionExclusionKind,
  contextSignature: string | undefined,
  negatives: LabeledPattern[],
  positives: LabeledPattern[],
) {
  const source = normalizePattern(sourceText);
  if (!source || !isWeakAutoDetectionCandidate(source)) return false;

  const negativeScore = bestSimilarity(source, contextSignature, negatives, kind);
  const threshold = source.length <= 3 ? 0.94 : source.length <= 6 ? 0.80 : 0.78;
  if (negativeScore < threshold) return false;

  const positiveScore = bestSimilarity(source, contextSignature, positives, kind);
  return positiveScore + 0.06 < negativeScore;
}

function isWeakAutoDetectionCandidate(source: string) {
  const japanese = Array.from(source.matchAll(/[ぁ-んァ-ヶ一-龯々〆ヵヶｦ-ﾟ]/gu), ({ 0: value }) => value);
  if (japanese.length === 0 || japanese.length > 14) return false;
  const hiragana = japanese.filter((character) => /[ぁ-ん]/u.test(character));
  const cjk = japanese.filter((character) => /[一-龯々〆ヵヶ]/u.test(character));
  const katakana = japanese.filter((character) => /[ァ-ヶｦ-ﾟ]/u.test(character));
  const hasFluentHiragana = /[ぁ-ん]{3,}/u.test(source)
    || (hiragana.length >= 2 && cjk.length >= 1);
  const hasKatakanaWord = katakana.length >= 4 && new Set(katakana).size >= 3;
  const hasCjkPhrase = cjk.length >= 3 && new Set(cjk).size >= 2 && japanese.length === cjk.length;
  return !(hasFluentHiragana || hasKatakanaWord || hasCjkPhrase);
}

function bestSimilarity(
  source: string,
  contextSignature: string | undefined,
  patterns: LabeledPattern[],
  kind: SelectionExclusionKind,
) {
  let best = 0;
  for (const pattern of patterns) {
    if (pattern.kind !== kind) continue;
    const sourceSimilarity = patternSimilarity(source, pattern.source);
    const contextSimilarity = contextSignatureSimilarity(
      contextSignature,
      pattern.contextSignature,
    );
    const score = contextSignature && pattern.contextSignature
      ? (sourceSimilarity * 0.78) + (contextSimilarity * 0.22)
      : sourceSimilarity;
    best = Math.max(best, score);
  }
  return best;
}

export function patternSimilarity(leftText: string, rightText: string) {
  const left = normalizePattern(leftText);
  const right = normalizePattern(rightText);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const maximumLength = Math.max(left.length, right.length);
  const editSimilarity = 1 - (levenshteinDistance(left, right) / maximumLength);
  const leftBigrams = makeBigrams(left);
  const rightBigrams = makeBigrams(right);
  const dice = diceCoefficient(leftBigrams, rightBigrams);
  const sameShape = scriptShape(left) === scriptShape(right) ? 0.04 : 0;
  return Math.min(1, (editSimilarity * 0.7) + (dice * 0.3) + sameShape);
}

function normalizePattern(text: string) {
  return text.normalize('NFKC').replace(/[\s\u200B]+/gu, '').trim();
}

function makeBigrams(text: string) {
  const characters = Array.from(text);
  if (characters.length < 2) return new Set(characters);
  return new Set(characters.slice(0, -1).map((character, index) => (
    `${character}${characters[index + 1]}`
  )));
}

function diceCoefficient(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

function scriptShape(text: string) {
  return Array.from(text).map((character) => {
    if (/[ぁ-ん]/u.test(character)) return 'H';
    if (/[ァ-ヶｦ-ﾟ]/u.test(character)) return 'K';
    if (/[一-龯々〆ヵヶ]/u.test(character)) return 'C';
    if (/[A-Za-z0-9]/u.test(character)) return 'A';
    return 'S';
  }).join('');
}

function levenshteinDistance(left: string, right: string) {
  const a = Array.from(left);
  const b = Array.from(right);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function buildVerticalSources(segments: TextSegment[]) {
  const groups = new Map<string, TextSegment[]>();
  for (const segment of segments) {
    if (!segment.verticalGroupId) continue;
    const group = groups.get(segment.verticalGroupId) || [];
    group.push(segment);
    groups.set(segment.verticalGroupId, group);
  }
  const result = new Map<string, { source: string; contextSignature?: string }>();
  for (const [groupId, group] of groups) {
    const ordered = [...group].sort((left, right) => (
        (left.verticalOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.verticalOrder ?? Number.MAX_SAFE_INTEGER)
      ));
    result.set(groupId, {
      source: ordered.map(sourceOf).join(''),
      contextSignature: ordered.find(({ detectionContextSignature }) => (
        Boolean(detectionContextSignature)
      ))?.detectionContextSignature,
    });
  }
  return result;
}

function clearLearnedExclusions(segments: TextSegment[]) {
  let changed = false;
  const next = segments.map((segment) => {
    if (!segment.isPatternAutoSelectExcluded) return segment;
    changed = true;
    return { ...segment, isPatternAutoSelectExcluded: undefined };
  });
  return changed ? next : segments;
}

function sourceOf(segment: TextSegment) {
  return segment.original || segment.text;
}
