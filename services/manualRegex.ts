import {
  ManualRegexRule,
  ManualRegexRules,
  SelectionExclusionKind,
  TextSegment,
} from '../types';
import {
  applyManualSelectionRanges,
  ManualSelectionRange,
} from './manualSelection';
import { SpatialContextAnalyzer } from './spatialDetection';
import { getDisplayWidth } from './verticalText';
export const MANUAL_REGEX_STORAGE_KEY = 'aat_manual_regex_rules_v1';

export const EMPTY_MANUAL_REGEX_RULES: ManualRegexRules = { entries: [] };

export interface ManualRegexTarget {
  kind: SelectionExclusionKind;
  sourceText: string;
  contextSignature?: string;
}

export function escapeRegexLiteral(sourceText: string) {
  return sourceText.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function deserializeManualRegexRules(
  serialized: string | null | undefined,
): ManualRegexRules {
  if (!serialized) return { entries: [] };
  try {
    return normalizeManualRegexRules(JSON.parse(serialized));
  } catch {
    return { entries: [] };
  }
}

export function normalizeManualRegexRules(value: unknown): ManualRegexRules {
  if (!value || typeof value !== 'object') return { entries: [] };
  const candidate = value as Partial<ManualRegexRules>;
  if (!Array.isArray(candidate.entries)) return { entries: [] };
  const entries = candidate.entries
    .filter(isManualRegexRule)
    .map((rule) => ({
      id: rule.id,
      kind: rule.kind,
      sourceText: rule.sourceText,
      // Imported patterns are always rebuilt from their source. This keeps the
      // feature literal and prevents unsafe or accidentally over-broad regexes.
      pattern: escapeRegexLiteral(rule.sourceText),
      createdAt: rule.createdAt,
    }));
  return { entries };
}

export function addManualRegexRule(
  rules: ManualRegexRules,
  target: ManualRegexTarget,
  id: string,
  createdAt = Date.now(),
): ManualRegexRules {
  const sourceText = target.sourceText.trim();
  if (!sourceText) return rules;
  if (rules.entries.some((rule) => (
    rule.kind === target.kind
    && rule.sourceText === sourceText
  ))) return rules;
  return {
    entries: [
      ...rules.entries,
      {
        id,
        kind: target.kind,
        sourceText,
        pattern: escapeRegexLiteral(sourceText),
        createdAt,
      },
    ],
  };
}

export function getAddedManualRegexRules(
  previous: ManualRegexRules,
  next: ManualRegexRules,
): ManualRegexRules {
  const previousIds = new Set(previous.entries.map(({ id }) => id));
  return {
    entries: next.entries.filter(({ id }) => !previousIds.has(id)),
  };
}

export function getManualRegexTarget(
  segments: TextSegment[],
  segmentId: string,
): ManualRegexTarget | null {
  const target = segments.find((segment) => segment.id === segmentId);
  if (!target || target.isTranslated) return null;
  if (target.verticalGroupId) {
    const group = segments
      .filter((segment) => segment.verticalGroupId === target.verticalGroupId)
      .sort((left, right) => (
        (left.verticalOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.verticalOrder ?? Number.MAX_SAFE_INTEGER)
      ));
    const sourceText = group.map(sourceOf).join('');
    return sourceText.trim() ? {
      kind: 'vertical',
      sourceText,
    } : null;
  }
  const sourceText = sourceOf(target);
  return sourceText.trim() ? {
    kind: 'normal',
    sourceText,
  } : null;
}

export function getManualRegexTargetForRange(
  segments: TextSegment[],
  range: ManualSelectionRange,
): ManualRegexTarget | null {
  const segmentIndex = segments.findIndex(({ id }) => id === range.segmentId);
  if (segmentIndex < 0) return null;
  const segment = segments[segmentIndex];
  if (segment.isTranslated) return null;
  const start = Math.max(0, Math.min(range.start, segment.text.length));
  const end = Math.max(start, Math.min(range.end, segment.text.length));
  const sourceText = segment.text.slice(start, end).trim();
  if (!sourceText) return null;
  return {
    kind: 'normal',
    sourceText,
  };
}

export function applyManualRegexRules(
  segments: TextSegment[],
  rules: ManualRegexRules,
): TextSegment[] {
  if (rules.entries.length === 0) return segments;
  const normalTexts = [...new Set(
    rules.entries
      .filter(({ kind }) => kind === 'normal')
      .map(({ sourceText }) => sourceText)
      .filter(Boolean),
  )].sort((left, right) => right.length - left.length);
  const verticalTexts = new Set(
    rules.entries
      .filter(({ kind }) => kind === 'vertical')
      .map(({ sourceText }) => sourceText),
  );
  // Automatic detection and older one-character rules can split a later,
  // longer exact rule into several segments. Rebuild those cross-segment
  // matches first so longest-rule precedence is structural, not merely visual.
  // Exact exclusion rules run afterwards and therefore only ban this rebuilt
  // unit when the exclusion itself equals the complete long source text.
  const withCrossSegmentSelections = applyCrossSegmentNormalMatches(
    segments,
    normalTexts,
  );
  const documentLayout = createDocumentLayout(withCrossSegmentSelections);

  const verticalGroups = new Map<string, TextSegment[]>();
  for (const segment of withCrossSegmentSelections) {
    if (!segment.verticalGroupId) continue;
    const current = verticalGroups.get(segment.verticalGroupId) || [];
    current.push(segment);
    verticalGroups.set(segment.verticalGroupId, current);
  }
  const verticalGroupTexts = new Map<string, string>();
  for (const [groupId, group] of verticalGroups) {
    const sourceText = [...group]
      .sort((left, right) => (
        (left.verticalOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.verticalOrder ?? Number.MAX_SAFE_INTEGER)
      ))
      .map(sourceOf)
      .join('');
    verticalGroupTexts.set(groupId, sourceText);
  }
  let withVerticalSelections = withCrossSegmentSelections.map((segment) => {
    if (
      !segment.verticalGroupId
      || !verticalTexts.has(verticalGroupTexts.get(segment.verticalGroupId) || '')
      || segment.isTranslated
    ) return segment;
    return { ...segment, isSelected: true, isManualRegexSelection: true };
  });

  if (normalTexts.length === 0) return withVerticalSelections;
  const ranges: ManualSelectionRange[] = [];
  for (const [segmentIndex, segment] of withVerticalSelections.entries()) {
    if (segment.isTranslated || segment.verticalGroupId) continue;
    const exactSourceText = sourceOf(segment);
    const exactWholeMatch = normalTexts.includes(exactSourceText)
      && hasRuleBoundaries(
        withVerticalSelections,
        documentLayout,
        segmentIndex,
        0,
        segment.text.length,
        exactSourceText,
      );
    if (exactWholeMatch) {
      withVerticalSelections[segmentIndex] = {
        ...segment,
        isJapanese: true,
        isSelected: true,
        isManualRegexSelection: true,
      };
      continue;
    }
    // A selected or already recognized automatic segment is already a complete
    // translation unit. Manual-regex matches inside it must not split the unit,
    // even before the user presses "select all" and isSelected becomes true.
    if (
      segment.isSelected
      || isAutomaticTranslationUnit(segment)
    ) continue;
    ranges.push(...findLiteralRanges(
      withVerticalSelections,
      documentLayout,
      segmentIndex,
      normalTexts,
    ));
  }
  if (ranges.length === 0) return withVerticalSelections;
  withVerticalSelections = applyManualSelectionRanges(
    withVerticalSelections,
    ranges,
    'regex',
  );
  return withVerticalSelections;
}

interface CrossSegmentMatch {
  start: number;
  end: number;
  firstSegmentIndex: number;
  lastSegmentIndex: number;
}

function applyCrossSegmentNormalMatches(
  segments: TextSegment[],
  sourceTexts: string[],
): TextSegment[] {
  if (sourceTexts.length === 0 || segments.length < 2) return segments;
  const starts: number[] = [];
  let content = '';
  for (const segment of segments) {
    starts.push(content.length);
    content += sourceOf(segment);
  }
  const ends = starts.map((start, index) => start + sourceOf(segments[index]).length);
  const candidates: CrossSegmentMatch[] = [];

  for (const sourceText of sourceTexts) {
    if (!sourceText || sourceText.includes('\n')) continue;
    let searchStart = 0;
    while (searchStart <= content.length - sourceText.length) {
      const matchStart = content.indexOf(sourceText, searchStart);
      if (matchStart === -1) break;
      const matchEnd = matchStart + sourceText.length;
      const left = matchStart > 0 ? content.slice(matchStart - 1, matchStart) : undefined;
      const right = matchEnd < content.length ? content.slice(matchEnd, matchEnd + 1) : undefined;
      if (isWhitespaceOrDocumentEdge(left) && isWhitespaceOrDocumentEdge(right)) {
        const firstSegmentIndex = findSegmentAtOffset(starts, ends, matchStart);
        const lastSegmentIndex = findSegmentAtOffset(starts, ends, matchEnd - 1);
        if (
          firstSegmentIndex >= 0
          && lastSegmentIndex > firstSegmentIndex
          && canRebuildCrossSegmentMatch(
            segments,
            firstSegmentIndex,
            lastSegmentIndex,
          )
        ) {
          candidates.push({
            start: matchStart,
            end: matchEnd,
            firstSegmentIndex,
            lastSegmentIndex,
          });
        }
      }
      searchStart = matchStart + Math.max(1, sourceText.length);
    }
  }

  candidates.sort((left, right) => (
    left.start - right.start
    || (right.end - right.start) - (left.end - left.start)
  ));
  const accepted: CrossSegmentMatch[] = [];
  let occupiedUntil = -1;
  for (const candidate of candidates) {
    if (candidate.start < occupiedUntil) continue;
    accepted.push(candidate);
    occupiedUntil = candidate.end;
  }
  if (accepted.length === 0) return segments;

  const rebuilt: TextSegment[] = [];
  let segmentIndex = 0;
  for (const match of accepted) {
    while (segmentIndex < match.firstSegmentIndex) {
      rebuilt.push(segments[segmentIndex]);
      segmentIndex += 1;
    }
    const first = segments[match.firstSegmentIndex];
    const firstLocalStart = match.start - starts[match.firstSegmentIndex];
    if (firstLocalStart > 0) {
      rebuilt.push(sliceSourceSegment(first, 0, firstLocalStart, 'regex-span-before'));
    }
    const sourceText = content.slice(match.start, match.end);
    rebuilt.push(makeCrossSegmentManualRegexSegment(first, sourceText, match));

    const last = segments[match.lastSegmentIndex];
    const lastLocalEnd = match.end - starts[match.lastSegmentIndex];
    if (lastLocalEnd < last.text.length) {
      rebuilt.push(sliceSourceSegment(last, lastLocalEnd, last.text.length, 'regex-span-after'));
    }
    segmentIndex = match.lastSegmentIndex + 1;
  }
  rebuilt.push(...segments.slice(segmentIndex));
  return rebuilt;
}

function findSegmentAtOffset(starts: number[], ends: number[], offset: number) {
  for (let index = 0; index < starts.length; index += 1) {
    if (offset >= starts[index] && offset < ends[index]) return index;
  }
  return -1;
}

function canRebuildCrossSegmentMatch(
  segments: TextSegment[],
  firstIndex: number,
  lastIndex: number,
) {
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const segment = segments[index];
    if (
      segment.isTranslated
      || segment.verticalGroupId
      || segment.text !== sourceOf(segment)
      || segment.text.includes('\n')
    ) return false;
  }
  return true;
}

function sliceSourceSegment(
  segment: TextSegment,
  start: number,
  end: number,
  label: string,
): TextSegment {
  const text = segment.text.slice(start, end);
  return {
    ...segment,
    id: `${segment.id}-${label}-${start}-${end}`,
    text,
    original: text,
    isSelected: false,
  };
}

function makeCrossSegmentManualRegexSegment(
  base: TextSegment,
  sourceText: string,
  match: CrossSegmentMatch,
): TextSegment {
  return {
    ...base,
    id: `${base.id}-regex-span-${match.start}-${match.end}`,
    text: sourceText,
    original: sourceText,
    isJapanese: true,
    isStrictJapanese: false,
    isAutoSelected: false,
    isBoxedDialogue: false,
    isContextDialogue: false,
    isArrowBox: false,
    isVerticalBox: false,
    isIndentedDialogue: false,
    isIsolatedDialogue: false,
    isManualSelection: false,
    isManualRegexSelection: true,
    isManualVerticalSelection: false,
    isAutoSelectExcluded: false,
    isUserExcluded: undefined,
    isSelected: true,
    isTranslated: false,
    isVerticalText: false,
    verticalGroupId: undefined,
    verticalOrder: undefined,
    verticalSourceLine: undefined,
    verticalSourceIndex: undefined,
    verticalDisplayX: undefined,
    verticalDisplayWidth: undefined,
  };
}

function isAutomaticTranslationUnit(segment: TextSegment) {
  return segment.isJapanese
    && !segment.isUserExcluded
    && !segment.isAutoSelectExcluded
    && Boolean(
    segment.isAutoSelected
    || segment.isStrictJapanese
    || segment.isBoxedDialogue
    || segment.isContextDialogue
    || segment.isArrowBox
    || segment.isIndentedDialogue
    || segment.isIsolatedDialogue
  );
}

function findLiteralRanges(
  segments: TextSegment[],
  documentLayout: ManualRegexDocumentLayout,
  segmentIndex: number,
  sourceTexts: string[],
) {
  const segment = segments[segmentIndex];
  const candidates: Array<{ start: number; end: number }> = [];
  for (const sourceText of sourceTexts) {
    let start = 0;
    while (start <= segment.text.length - sourceText.length) {
      const matchStart = segment.text.indexOf(sourceText, start);
      if (matchStart === -1) break;
      const matchEnd = matchStart + sourceText.length;
      if (hasRuleBoundaries(
        segments,
        documentLayout,
        segmentIndex,
        matchStart,
        matchEnd,
        sourceText,
      )) {
        candidates.push({ start: matchStart, end: matchEnd });
      }
      start = matchStart + Math.max(1, sourceText.length);
    }
  }
  candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  const accepted: ManualSelectionRange[] = [];
  let occupiedUntil = -1;
  for (const candidate of candidates) {
    if (candidate.start < occupiedUntil) continue;
    accepted.push({ segmentId: segment.id, ...candidate });
    occupiedUntil = candidate.end;
  }
  return accepted;
}

interface ManualRegexDocumentLayout {
  content: string;
  segmentStarts: number[];
  lines: string[];
  lineStarts: number[];
  spatialAnalyzer: SpatialContextAnalyzer;
}

function createDocumentLayout(segments: TextSegment[]): ManualRegexDocumentLayout {
  const segmentStarts: number[] = [];
  let content = '';
  for (const segment of segments) {
    segmentStarts.push(content.length);
    content += segment.text;
  }
  const lines = content.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  return {
    content,
    segmentStarts,
    lines,
    lineStarts,
    spatialAnalyzer: new SpatialContextAnalyzer(lines),
  };
}

function hasRuleBoundaries(
  segments: TextSegment[],
  documentLayout: ManualRegexDocumentLayout,
  segmentIndex: number,
  start: number,
  end: number,
  sourceText: string,
) {
  if (Array.from(sourceText).length === 1) {
    return hasFourSideTwoCellIsolation(documentLayout, segmentIndex, start, end)
      || isInsideVerifiedDialogueBox(documentLayout, segmentIndex, start, end);
  }
  return hasWhitespaceBoundaries(segments, segmentIndex, start, end);
}

function isInsideVerifiedDialogueBox(
  layout: ManualRegexDocumentLayout,
  segmentIndex: number,
  start: number,
  end: number,
) {
  const absoluteStart = layout.segmentStarts[segmentIndex] + start;
  const absoluteEnd = layout.segmentStarts[segmentIndex] + end;
  const lineIndex = findLineIndex(layout.lineStarts, absoluteStart);
  const lineStart = layout.lineStarts[lineIndex];
  const localStart = absoluteStart - lineStart;
  const localEnd = absoluteEnd - lineStart;
  if (
    localStart < 0
    || localEnd > (layout.lines[lineIndex]?.length || 0)
    || findLineIndex(layout.lineStarts, Math.max(absoluteStart, absoluteEnd - 1)) !== lineIndex
  ) return false;

  // A one-character manual rule normally needs two completely blank rows and
  // columns so that eyes/eyebrows in dense AA are not promoted. Inside a real
  // speech box those rows contain the box caps, so reuse the same strict
  // paired-wall + independent top/bottom-cap verifier as automatic detection.
  return layout.spatialAnalyzer
    .analyze(lineIndex, localStart, localEnd)
    .isClosedDialogueContainer;
}

function hasFourSideTwoCellIsolation(
  layout: ManualRegexDocumentLayout,
  segmentIndex: number,
  start: number,
  end: number,
) {
  const absoluteStart = layout.segmentStarts[segmentIndex] + start;
  const absoluteEnd = layout.segmentStarts[segmentIndex] + end;
  const lineIndex = findLineIndex(layout.lineStarts, absoluteStart);
  const lineStart = layout.lineStarts[lineIndex];
  const line = layout.lines[lineIndex] || '';
  const localStart = absoluteStart - lineStart;
  const localEnd = absoluteEnd - lineStart;
  if (localStart < 0 || localEnd > line.length) return false;

  const leftWhitespace = line.slice(0, localStart)
    .match(/[\s\u3000\u00a0\u2000-\u200b]+$/u)?.[0] || '';
  const rightWhitespace = line.slice(localEnd)
    .match(/^[\s\u3000\u00a0\u2000-\u200b]+/u)?.[0] || '';
  const isAtOpenRightEdge = localEnd === line.length;
  if (
    getDisplayWidth(leftWhitespace) < 2
    || (!isAtOpenRightEdge && getDisplayWidth(rightWhitespace) < 2)
  ) {
    return false;
  }

  // Two physical rows above and below must be empty across the character's
  // displayed columns. This rejects isolated-looking eyes/eyebrows embedded in
  // AA even when their immediate left and right happen to be spaces.
  if (lineIndex < 2 || lineIndex + 2 >= layout.lines.length) return false;
  const displayStart = getDisplayWidth(line.slice(0, localStart));
  const displayEnd = displayStart + getDisplayWidth(line.slice(localStart, localEnd));
  for (const neighborIndex of [
    lineIndex - 2,
    lineIndex - 1,
    lineIndex + 1,
    lineIndex + 2,
  ]) {
    if (!isDisplayRangeBlank(layout.lines[neighborIndex], displayStart, displayEnd)) {
      return false;
    }
  }
  return true;
}

function findLineIndex(lineStarts: number[], absoluteOffset: number) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= absoluteOffset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

function isDisplayRangeBlank(line: string, rangeStart: number, rangeEnd: number) {
  let displayX = 0;
  for (const character of line) {
    const characterEnd = displayX + getDisplayWidth(character);
    if (
      displayX < rangeEnd
      && characterEnd > rangeStart
      && !/^[\s\u3000\u00a0\u2000-\u200b]$/u.test(character)
    ) return false;
    displayX = characterEnd;
    if (displayX >= rangeEnd) break;
  }
  return true;
}

function hasWhitespaceBoundaries(
  segments: TextSegment[],
  segmentIndex: number,
  start: number,
  end: number,
) {
  const left = findAdjacentCharacter(segments, segmentIndex, start, -1);
  const right = findAdjacentCharacter(segments, segmentIndex, end, 1);
  return isWhitespaceOrDocumentEdge(left) && isWhitespaceOrDocumentEdge(right);
}

function findAdjacentCharacter(
  segments: TextSegment[],
  segmentIndex: number,
  offset: number,
  direction: -1 | 1,
): string | undefined {
  const currentText = segments[segmentIndex].text;
  if (direction === -1 && offset > 0) return currentText.slice(offset - 1, offset);
  if (direction === 1 && offset < currentText.length) return currentText.slice(offset, offset + 1);

  for (
    let index = segmentIndex + direction;
    index >= 0 && index < segments.length;
    index += direction
  ) {
    const text = segments[index].text;
    if (!text) continue;
    return direction === -1 ? text.slice(-1) : text.slice(0, 1);
  }
  return undefined;
}

function isWhitespaceOrDocumentEdge(character: string | undefined) {
  return character === undefined || /^\s$/u.test(character);
}

function sourceOf(segment: TextSegment) {
  return segment.original || segment.text;
}

function isManualRegexRule(value: unknown): value is ManualRegexRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<ManualRegexRule>;
  return typeof rule.id === 'string'
    && (rule.kind === 'normal' || rule.kind === 'vertical')
    && typeof rule.sourceText === 'string'
    && rule.sourceText.trim().length > 0
    && (rule.contextSignature === undefined || typeof rule.contextSignature === 'string')
    && typeof rule.createdAt === 'number';
}
