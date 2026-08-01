import { TextSegment } from '../types';

// Digits and a small set of in-sentence marks are context tokens, not enough
// to establish a vertical group by themselves. Once Japanese text establishes
// the group, however, dropping them changes meanings such as １５歳 or 後５年.
const VERTICAL_SOURCE_CHAR = /[ぁ-んァ-ヶ一-龯々〆ヵヶー！？。、…「」『』（）［］【】│┃0-9０-９:：・･\uff66-\uff9f]/;
const PIPE_BOUNDARY = /[|｜]/;
const LEFT_ARROW_BOUNDARY = /[>＞]/;
const RIGHT_ARROW_BOUNDARY = /[<＜]/;
const LOOSE_VERTICAL_SOURCE_CHAR = /[ぁ-んァ-ヶ一-龯々〆ヵヶー！？。、…│┃\uff66-\uff9f]/;
const LOOSE_BUBBLE_BOUNDARY = /[<>＜＞()（）／＼\\/⌒'`｀{}｛｝]/u;
const TRACK_CENTER_TOLERANCE = 18;
const TRACK_WIDTH_TOLERANCE = 5;
const COLUMN_TOLERANCE = 2;
const MAX_LINE_GAP = 3;
const VERTICAL_AA_ONLY = /^[ニィノイ二三彡一。ー（）［］]+$/u;

export interface VerticalTextToken {
  char: string;
  line: number;
  stringIndex: number;
  displayX: number;
  displayWidth: number;
  segmentId: string;
  segmentOffset: number;
}

export interface VerticalTextGroup {
  id: string;
  sourceText: string;
  capacity: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  segmentIds: string[];
  tokens: VerticalTextToken[];
}

export interface VerticalApplyResult {
  applied: boolean;
  segments: TextSegment[];
  normalizedTranslation: string;
  reason?: string;
}

export interface VerticalTranslationAssignment {
  group: VerticalTextGroup;
  translation: string;
}

export interface VerticalBatchApplyItem {
  groupId: string;
  normalizedTranslation: string;
  reason?: string;
}

export interface VerticalBatchApplyResult {
  applied: boolean;
  segments: TextSegment[];
  items: VerticalBatchApplyItem[];
  reason?: string;
}

export interface FixedWidthTextResult {
  applied: boolean;
  text: string;
  reason?: string;
}

interface RawGlyph {
  char: string;
  stringIndex: number;
  displayX: number;
  displayWidth: number;
}

interface CandidateToken extends RawGlyph {
  line: number;
  left: number;
  right: number;
  boundaryKind: 'pipe' | 'arrow';
}

interface RowBox {
  line: number;
  left: number;
  right: number;
  boundaryKind: 'pipe' | 'arrow';
  tokens: CandidateToken[];
}

interface BoxTrack {
  lastLine: number;
  lastCenter: number;
  lastWidth: number;
  boundaryKind: 'pipe' | 'arrow';
  rows: RowBox[];
}

interface TrackAssignmentPlan {
  assignments: Array<BoxTrack | undefined>;
  matches: number;
  score: number;
}

interface Column {
  x: number;
  tokens: CandidateToken[];
}

interface RawVerticalGroup {
  top: number;
  bottom: number;
  left: number;
  right: number;
  tokens: CandidateToken[];
}

export function getDisplayWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (isCombiningCodePoint(codePoint)) continue;
    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

export function detectVerticalTextGroups(
  content: string,
  segments: TextSegment[],
): VerticalTextGroup[] {
  const manualGroups = buildManualVerticalTextGroups(segments);
  const rawGroups = detectRawVerticalGroups(content);
  const segmentRanges = buildSegmentRanges(segments);
  const mappedGroups: VerticalTextGroup[] = [];

  for (const rawGroup of rawGroups) {
    const mappedTokens: VerticalTextToken[] = [];
    for (const token of rawGroup.tokens) {
      const ranges = segmentRanges.get(token.line) || [];
      const range = ranges.find(({ start, end }) => (
        token.stringIndex >= start && token.stringIndex < end
      ));
      if (!range || range.segment.isManualVerticalSelection) continue;

      const segmentOffset = token.stringIndex - range.start;
      if (range.segment.text[segmentOffset] !== token.char) continue;

      mappedTokens.push({
        ...token,
        segmentId: range.segment.id,
        segmentOffset,
      });
    }

    if (mappedTokens.length < 3 || mappedTokens.length < rawGroup.tokens.length * 0.8) {
      continue;
    }

    const segmentIds = [...new Set(mappedTokens.map(({ segmentId }) => segmentId))];
    mappedGroups.push({
      id: '',
      sourceText: mappedTokens.map(({ char }) => normalizeSourceCharacter(char)).join(''),
      capacity: mappedTokens.length,
      top: rawGroup.top,
      bottom: rawGroup.bottom,
      left: rawGroup.left,
      right: rawGroup.right,
      segmentIds,
      tokens: mappedTokens,
    });
  }

  mappedGroups.sort((left, right) => (
    left.top - right.top
    || right.right - left.right
    || left.left - right.left
  ));

  const automaticGroups = mappedGroups.map((group, index) => ({
    ...group,
    id: `vertical-${group.top}-${Math.round(group.left)}-${Math.round(group.right)}-${index}`,
  }));
  return [...automaticGroups, ...manualGroups].sort((left, right) => (
    left.top - right.top
    || right.right - left.right
    || left.left - right.left
  ));
}

function buildManualVerticalTextGroups(segments: TextSegment[]): VerticalTextGroup[] {
  const byGroupId = new Map<string, TextSegment[]>();
  for (const segment of segments) {
    if (
      !segment.isManualVerticalSelection
      || !segment.verticalGroupId
      || segment.verticalOrder === undefined
      || segment.verticalSourceLine === undefined
      || segment.verticalSourceIndex === undefined
      || segment.verticalDisplayX === undefined
      || segment.verticalDisplayWidth === undefined
    ) continue;
    const existing = byGroupId.get(segment.verticalGroupId) || [];
    existing.push(segment);
    byGroupId.set(segment.verticalGroupId, existing);
  }

  const result: VerticalTextGroup[] = [];
  for (const [groupId, groupSegments] of byGroupId) {
    const ordered = [...groupSegments].sort(
      (left, right) => (left.verticalOrder || 0) - (right.verticalOrder || 0),
    );
    if (ordered.length < 2) continue;
    const tokens: VerticalTextToken[] = ordered.map((segment) => ({
      char: segment.original,
      line: segment.verticalSourceLine!,
      stringIndex: segment.verticalSourceIndex!,
      displayX: segment.verticalDisplayX!,
      displayWidth: segment.verticalDisplayWidth!,
      segmentId: segment.id,
      segmentOffset: 0,
    }));
    result.push({
      id: groupId,
      sourceText: tokens.map(({ char }) => normalizeSourceCharacter(char)).join(''),
      capacity: tokens.length,
      top: Math.min(...tokens.map(({ line }) => line)),
      bottom: Math.max(...tokens.map(({ line }) => line)),
      left: Math.min(...tokens.map(({ displayX }) => displayX)),
      right: Math.max(...tokens.map(({ displayX, displayWidth }) => displayX + displayWidth)),
      segmentIds: ordered.map(({ id }) => id),
      tokens,
    });
  }
  return result;
}

export function annotateVerticalTextSegments(
  content: string,
  segments: TextSegment[],
): TextSegment[] {
  const groups = detectVerticalTextGroups(content, segments);
  const metadata = new Map<string, Map<number, { groupId: string; order: number }>>();

  for (const group of groups) {
    group.tokens.forEach((token, order) => {
      const segmentMetadata = metadata.get(token.segmentId) || new Map();
      const previous = segmentMetadata.get(token.segmentOffset);
      if (!previous || order < previous.order) {
        segmentMetadata.set(token.segmentOffset, { groupId: group.id, order });
        metadata.set(token.segmentId, segmentMetadata);
      }
    });
  }

  return segments.flatMap((segment) => {
    const segmentMetadata = metadata.get(segment.id);
    if (!segmentMetadata || segment.text === '\n') {
      return [clearVerticalMetadata(segment)];
    }

    const idMatch = /^seg-(\d+)-(\d+)$/.exec(segment.id);
    if (!idMatch) return [clearVerticalMetadata(segment)];
    const line = Number(idMatch[1]);
    const segmentStart = Number(idMatch[2]);
    const verticalOffsets = [...segmentMetadata.keys()].sort((left, right) => left - right);
    const result: TextSegment[] = [];
    let cursor = 0;

    const pushSlice = (
      start: number,
      end: number,
      vertical?: { groupId: string; order: number },
    ) => {
      if (end <= start) return;
      const text = segment.text.slice(start, end);
      const original = segment.original.slice(start, end);
      const base = {
        ...segment,
        id: `seg-${line}-${segmentStart + start}`,
        text,
        original,
        isSelected: false,
      };
      if (!vertical) {
        result.push({
          ...clearVerticalMetadata(base),
          isJapanese: containsJapaneseScript(text) && segment.isJapanese,
        });
        return;
      }
      result.push({
        ...base,
        isJapanese: true,
        isVerticalBox: true,
        isVerticalText: true,
        isAutoSelectExcluded: false,
        verticalGroupId: vertical.groupId,
        verticalOrder: vertical.order,
      });
    };

    for (const offset of verticalOffsets) {
      pushSlice(cursor, offset);
      pushSlice(offset, offset + 1, segmentMetadata.get(offset));
      cursor = offset + 1;
    }
    pushSlice(cursor, segment.text.length);
    return result;
  });
}

export function fitTranslationToDisplayWidth(
  original: string,
  translation: string,
): FixedWidthTextResult {
  const text = translation.trim();
  const availableWidth = getDisplayWidth(original);
  if (!text) {
    return {
      applied: true,
      text: ' '.repeat(availableWidth),
      reason: '빈 번역 결과를 원문 폭만큼의 공백으로 대체했습니다.',
    };
  }

  const translatedWidth = getDisplayWidth(text);
  if (translatedWidth > availableWidth) {
    return {
      applied: true,
      text,
      reason: `번역 폭이 ${translatedWidth - availableWidth}칸 초과되어 오른쪽 내용을 밀어냈습니다.`,
    };
  }

  return {
    applied: true,
    text: text + ' '.repeat(availableWidth - translatedWidth),
  };
}

export function applyVerticalTranslation(
  segments: TextSegment[],
  group: VerticalTextGroup,
  translation: string,
): VerticalApplyResult {
  const result = applyVerticalTranslations(segments, [{ group, translation }]);
  const item = result.items[0];
  return {
    applied: result.applied,
    segments: result.segments,
    normalizedTranslation: item?.normalizedTranslation || '',
    reason: result.reason || item?.reason,
  };
}

export function applyVerticalTranslations(
  segments: TextSegment[],
  assignments: VerticalTranslationAssignment[],
): VerticalBatchApplyResult {
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const replacements = new Map<string, Map<number, string>>();
  const wholeSegmentReplacements = new Map<string, string>();
  const items: VerticalBatchApplyItem[] = [];

  for (const { group, translation } of assignments) {
    const normalizedTranslation = normalizeVerticalTranslation(translation);
    const outputCharacters = Array.from(normalizedTranslation);
    if (outputCharacters.length === 0) outputCharacters.push('　');

    const resolvedTokens = group.tokens.map((token, order) => {
      const segment = segmentById.get(token.segmentId);
      if (
        segment
        && token.char.length === 1
        && token.displayWidth === 2
        && token.segmentOffset >= 0
        && token.segmentOffset < segment.text.length
        && segment.text[token.segmentOffset] === token.char
      ) {
        return {
          token,
          segmentId: token.segmentId,
          segmentOffset: token.segmentOffset,
          replaceWholeSegment: false,
        };
      }

      // Partial-result rendering or an overlapping normal selection may have
      // already changed the source glyph. Annotated vertical cells retain a
      // stable group/order identity and an untouched one-character `original`,
      // so they can still be replaced safely without relying on the old glyph.
      const metadataMatch = segments.find((candidate) => (
        candidate.verticalGroupId === group.id
        && candidate.verticalOrder === order
        && Array.from(candidate.original).length === 1
        && candidate.original === token.char
      ));
      if (!metadataMatch) return undefined;
      return {
        token,
        segmentId: metadataMatch.id,
        segmentOffset: 0,
        replaceWholeSegment: true,
      };
    });
    const unsafeIndex = resolvedTokens.findIndex((resolved) => !resolved);
    if (unsafeIndex >= 0) {
      const unsafeToken = group.tokens[unsafeIndex];
      return {
        applied: false,
        segments,
        items,
        reason: `원문 슬롯(${unsafeToken.line + 1}행)의 위치가 변경되어 적용할 수 없습니다.`,
      };
    }

    const overflow = Math.max(0, outputCharacters.length - group.capacity);
    const overflowAnchorIndex = overflow > 0
      ? group.tokens.reduce((bestIndex, token, index) => {
          const best = group.tokens[bestIndex];
          // Prefer the physically lowest text row. On the same row, the
          // rightmost cell causes the least horizontal displacement.
          return token.line > best.line
            || (token.line === best.line && token.displayX > best.displayX)
            ? index
            : bestIndex;
        }, 0)
      : -1;

    for (const [index, resolved] of resolvedTokens.entries()) {
      const { token, segmentId, segmentOffset, replaceWholeSegment } = resolved!;
      const outputIndex = overflow > 0 && index > overflowAnchorIndex
        ? index + overflow
        : index;
      let replacement = outputCharacters[outputIndex]
        ? toVerticalCell(outputCharacters[outputIndex])
        : '　';
      // Insert overflow at the lowest available row. Later slots consume output
      // after the inserted run, preserving the complete Korean reading order.
      if (index === overflowAnchorIndex) {
        replacement += outputCharacters
          .slice(index + 1, index + overflow + 1)
          .map(toVerticalCell)
          .join('');
      }
      if (replaceWholeSegment) {
        if (wholeSegmentReplacements.has(segmentId) || replacements.has(segmentId)) {
          return {
            applied: false,
            segments,
            items,
            reason: `세로 말풍선들이 ${token.line + 1}행의 같은 문자 슬롯과 겹칩니다.`,
          };
        }
        wholeSegmentReplacements.set(segmentId, replacement);
        continue;
      }
      const segmentReplacements = replacements.get(segmentId) || new Map<number, string>();
      if (segmentReplacements.has(segmentOffset) || wholeSegmentReplacements.has(segmentId)) {
        return {
          applied: false,
          segments,
          items,
          reason: `세로 말풍선들이 ${token.line + 1}행의 같은 문자 슬롯과 겹칩니다.`,
        };
      }
      segmentReplacements.set(segmentOffset, replacement);
      replacements.set(segmentId, segmentReplacements);
    }

    items.push({
      groupId: group.id,
      normalizedTranslation,
      reason: overflow > 0
        ? `세로 번역이 ${overflow}자를 초과해 가장 아래쪽의 한 행만 확장했습니다.`
        : undefined,
    });
  }

  const updated = segments.map((segment) => {
    const wholeReplacement = wholeSegmentReplacements.get(segment.id);
    if (wholeReplacement !== undefined) {
      return {
        ...segment,
        text: wholeReplacement,
        isTranslated: true,
        isSelected: false,
      };
    }
    const segmentReplacements = replacements.get(segment.id);
    if (!segmentReplacements) return segment;

    const characters = segment.text.split('');
    for (const [offset, replacement] of segmentReplacements) {
      characters[offset] = replacement;
    }
    const text = characters.join('');

    return {
      ...segment,
      text,
      isTranslated: true,
      isSelected: false,
    };
  });

  return {
    applied: true,
    segments: updated,
    items,
  };
}

export function makeVerticalTranslationRequest(group: VerticalTextGroup): string {
  return `⟦VERTICAL_MAX=${group.capacity}⟧${group.sourceText}`;
}

export function normalizeVerticalTranslation(translation: string): string {
  const withoutMarker = translation.replace(/^⟦VERTICAL_MAX=\d+⟧/i, '');
  let result = '';
  for (const character of withoutMarker.normalize('NFKC')) {
    if (/\s/.test(character)) continue;
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 0x21 && codePoint <= 0x7e) {
      result += String.fromCodePoint(codePoint + 0xfee0);
    } else {
      result += character;
    }
  }
  return result;
}

function toVerticalCell(character: string): string {
  const width = getDisplayWidth(character);
  if (width >= 2) return character;
  if (width === 1) return `${character} `;
  return '　';
}

export function detectRawVerticalGroups(content: string): RawVerticalGroup[] {
  const candidates: CandidateToken[] = [];
  const lines = content.split('\n');

  lines.forEach((line, lineIndex) => {
    const glyphs = scanLine(line);
    const pipes = glyphs.filter(({ char }) => PIPE_BOUNDARY.test(char));
    const leftArrows = glyphs.filter(({ char }) => LEFT_ARROW_BOUNDARY.test(char));
    const rightArrows = glyphs.filter(({ char }) => RIGHT_ARROW_BOUNDARY.test(char));

    for (const glyph of glyphs) {
      if (!VERTICAL_SOURCE_CHAR.test(glyph.char)) continue;
      const pairs = [
        makeBoundaryPair('pipe', pipes, pipes, glyph.displayX),
        makeBoundaryPair('arrow', leftArrows, rightArrows, glyph.displayX),
      ].filter((pair): pair is NonNullable<typeof pair> => Boolean(pair))
        .filter(({ width }) => width >= 4 && width <= 80)
        .sort((left, right) => left.width - right.width);
      const pair = pairs[0];
      if (!pair) continue;

      candidates.push({
        ...glyph,
        line: lineIndex,
        left: pair.left.displayX,
        right: pair.right.displayX,
        boundaryKind: pair.kind,
      });
    }
  });

  const rowBoxMap = new Map<string, RowBox>();
  for (const token of candidates) {
    const key = `${token.line}:${token.boundaryKind}:${token.left}:${token.right}`;
    const rowBox = rowBoxMap.get(key);
    if (rowBox) {
      rowBox.tokens.push(token);
    } else {
      rowBoxMap.set(key, {
        line: token.line,
        left: token.left,
        right: token.right,
        boundaryKind: token.boundaryKind,
        tokens: [token],
      });
    }
  }

  const tracks: BoxTrack[] = [];
  const rowBoxes = [...rowBoxMap.values()].sort((left, right) => (
    left.line - right.line || right.right - left.right
  ));
  const boxesByLine = new Map<number, RowBox[]>();
  for (const rowBox of rowBoxes) {
    const lineBoxes = boxesByLine.get(rowBox.line) || [];
    lineBoxes.push(rowBox);
    boxesByLine.set(rowBox.line, lineBoxes);
  }

  for (const [line, lineBoxesUnsorted] of [...boxesByLine.entries()].sort((a, b) => a[0] - b[0])) {
    const lineBoxes = [...lineBoxesUnsorted].sort((left, right) => right.right - left.right);
    const activeTracks = tracks
      .filter((track) => line > track.lastLine && line - track.lastLine <= MAX_LINE_GAP)
      .sort((left, right) => right.lastCenter - left.lastCenter);
    const plan = assignRowBoxesToTracks(lineBoxes, activeTracks, line);

    lineBoxes.forEach((rowBox, index) => {
      const center = (rowBox.left + rowBox.right) / 2;
      const width = rowBox.right - rowBox.left;
      const selectedTrack = plan.assignments[index];
      if (selectedTrack) {
        selectedTrack.rows.push(rowBox);
        selectedTrack.lastLine = line;
        selectedTrack.lastCenter = center;
        selectedTrack.lastWidth = width;
      } else {
        tracks.push({
          lastLine: line,
          lastCenter: center,
          lastWidth: width,
          boundaryKind: rowBox.boundaryKind,
          rows: [rowBox],
        });
      }
    });
  }

  function assignRowBoxesToTracks(
    boxes: RowBox[],
    activeTracks: BoxTrack[],
    line: number,
  ): TrackAssignmentPlan {
    const search = (boxIndex: number, minimumTrackIndex: number): TrackAssignmentPlan => {
      if (boxIndex >= boxes.length) {
        return { assignments: [], matches: 0, score: 0 };
      }

      const newTrackPlan = search(boxIndex + 1, minimumTrackIndex);
      let best: TrackAssignmentPlan = {
        assignments: [undefined, ...newTrackPlan.assignments],
        matches: newTrackPlan.matches,
        score: newTrackPlan.score + 25,
      };
      const box = boxes[boxIndex];
      const center = (box.left + box.right) / 2;
      const width = box.right - box.left;

      for (let trackIndex = minimumTrackIndex; trackIndex < activeTracks.length; trackIndex += 1) {
        const track = activeTracks[trackIndex];
        if (track.boundaryKind !== box.boundaryKind) continue;
        const centerDistance = Math.abs(center - track.lastCenter);
        const widthDistance = Math.abs(width - track.lastWidth);
        if (
          centerDistance > TRACK_CENTER_TOLERANCE
          || widthDistance > TRACK_WIDTH_TOLERANCE
        ) continue;

        const remaining = search(boxIndex + 1, trackIndex + 1);
        const candidate: TrackAssignmentPlan = {
          assignments: [track, ...remaining.assignments],
          matches: remaining.matches + 1,
          score: remaining.score
            + centerDistance
            + (widthDistance * 2)
            + ((line - track.lastLine - 1) * 4),
        };
        if (
          candidate.matches > best.matches
          || (candidate.matches === best.matches && candidate.score < best.score)
        ) {
          best = candidate;
        }
      }

      return best;
    };

    return search(0, 0);
  }

  const groups: RawVerticalGroup[] = [];
  for (const track of tracks) {
    const trackTokens = track.rows.flatMap(({ tokens }) => tokens);
    const columns = clusterColumns(trackTokens);
    const verticalColumns = columns.filter((column) => {
      const linesInColumn = [...new Set(column.tokens.map(({ line }) => line))];
      return linesInColumn.length >= 2
        && Math.max(...linesInColumn) - Math.min(...linesInColumn) >= 1;
    });
    const verticalTokens = verticalColumns
      // A smaller distance from the right border is the rightmost Japanese column.
      .sort((left, right) => left.x - right.x)
      .flatMap((column) => (
        [...column.tokens].sort((left, right) => (
          left.line - right.line || right.displayX - left.displayX
        ))
      ));
    if (verticalTokens.length < 3) continue;
    if (!isLikelyVerticalGroup(verticalTokens, verticalColumns)) continue;

    groups.push({
      top: Math.min(...verticalTokens.map(({ line }) => line)),
      bottom: Math.max(...verticalTokens.map(({ line }) => line)),
      left: verticalTokens.reduce((sum, token) => sum + token.left, 0) / verticalTokens.length,
      right: verticalTokens.reduce((sum, token) => sum + token.right, 0) / verticalTokens.length,
      tokens: verticalTokens,
    });
  }

  const claimedTokens = new Set(
    groups.flatMap(({ tokens }) => tokens.map(({ line, stringIndex }) => `${line}:${stringIndex}`)),
  );
  return [
    ...groups,
    ...detectLooseVerticalGroups(lines, claimedTokens),
  ];
}

function detectLooseVerticalGroups(lines: string[], claimedTokens: Set<string>): RawVerticalGroup[] {
  const rows: CandidateToken[][] = [];

  lines.forEach((line, lineIndex) => {
    const glyphs = scanLine(line);
    const sourceGlyphs = glyphs.filter(({ char, stringIndex }) => (
      LOOSE_VERTICAL_SOURCE_CHAR.test(char)
      && !claimedTokens.has(`${lineIndex}:${stringIndex}`)
    ));
    rows[lineIndex] = sourceGlyphs
      .filter((glyph) => !sourceGlyphs.some((other) => (
        other !== glyph
        && Math.abs(other.displayX - glyph.displayX) <= 2
      )))
      .filter((glyph) => hasLooseBubbleBoundary(glyphs, glyph.displayX))
      .map((glyph) => ({
        ...glyph,
        line: lineIndex,
        left: glyph.displayX - 2,
        right: glyph.displayX + glyph.displayWidth + 2,
        boundaryKind: 'arrow' as const,
      }));
  });

  const tracks: Array<{ tokens: CandidateToken[]; lastLine: number; lastX: number }> = [];
  rows.forEach((row, line) => {
    const active = tracks.filter(({ lastLine }) => line - lastLine <= 3);
    const used = new Set<typeof tracks[number]>();
    for (const token of [...row].sort((left, right) => (
      looseTokenPriority(right.char) - looseTokenPriority(left.char)
      || right.displayX - left.displayX
    ))) {
      const maximumDistance = looseTokenPriority(token.char) > 0 ? 18 : 6;
      const nearest = active
        .filter((track) => (
          !used.has(track) && Math.abs(token.displayX - track.lastX) <= maximumDistance
        ))
        .sort((left, right) => (
          Math.abs(token.displayX - left.lastX) - Math.abs(token.displayX - right.lastX)
        ))[0];
      if (nearest) {
        nearest.tokens.push(token);
        nearest.lastLine = line;
        nearest.lastX = token.displayX;
        used.add(nearest);
      } else if (looseTokenPriority(token.char) > 0) {
        tracks.push({ tokens: [token], lastLine: line, lastX: token.displayX });
      }
    }
  });

  return tracks
    .map(({ tokens }) => trimLooseTrack(tokens))
    .filter((tokens) => tokens.length >= 4 && isLikelyLooseVerticalGroup(tokens))
    .map((tokens) => ({
      top: Math.min(...tokens.map(({ line }) => line)),
      bottom: Math.max(...tokens.map(({ line }) => line)),
      left: Math.min(...tokens.map(({ displayX }) => displayX)),
      right: Math.max(...tokens.map(({ displayX, displayWidth }) => displayX + displayWidth)),
      tokens,
    }));
}

function hasLooseBubbleBoundary(glyphs: RawGlyph[], x: number) {
  return glyphs.some(({ char, displayX }) => (
    LOOSE_BUBBLE_BOUNDARY.test(char)
    && Math.abs(displayX - x) <= 80
  ));
}

function trimLooseTrack(tokens: CandidateToken[]) {
  let start = 0;
  let end = tokens.length;
  const removableEdge = /^[。、…ー│┃]$/u;
  while (start < end && removableEdge.test(normalizeSourceCharacter(tokens[start].char))) start += 1;
  while (end > start && removableEdge.test(normalizeSourceCharacter(tokens[end - 1].char))) end -= 1;
  return tokens.slice(start, end);
}

function looseTokenPriority(character: string) {
  return /^[ー！？。、…│┃\uff70]$/u.test(character) ? 0 : 1;
}

function isLikelyLooseVerticalGroup(tokens: CandidateToken[]) {
  const source = tokens.map(({ char }) => normalizeSourceCharacter(char)).join('');
  if (/^[ぁぃぅぇぉゃゅょァィゥェォャュョッｯ]/u.test(source)) {
    return false;
  }
  const hiragana = Array.from(source.matchAll(/[ぁ-ん]/gu), ({ 0: character }) => character);
  const strongHiragana = hiragana.filter((character) => !/[っぅ]/u.test(character));
  const katakanaRuns = source.match(/[ァ-ヶー]{4,}/gu) || [];
  const cjk = Array.from(source.matchAll(/[一-龯々〆ヵヶ]/gu));
  const hasTerminalPunctuation = /[！？]$/u.test(source);
  const hasKatakanaWord = katakanaRuns.some((run) => (
    new Set(Array.from(run).filter((character) => character !== 'ー')).size >= 3
  ));
  return hasTerminalPunctuation
    ? (
      (hiragana.length >= 3 && new Set(strongHiragana).size >= 2)
      || hasKatakanaWord
      || (hiragana.length >= 2 && cjk.length >= 2)
    )
    : hasKatakanaWord && hiragana.length >= 1 && /[ぁ-ん]$/u.test(source);
}

function scanLine(line: string): RawGlyph[] {
  const glyphs: RawGlyph[] = [];
  let stringIndex = 0;
  let displayX = 0;
  while (stringIndex < line.length) {
    const codePoint = line.codePointAt(stringIndex) ?? 0;
    const char = String.fromCodePoint(codePoint);
    const displayWidth = getDisplayWidth(char);
    glyphs.push({ char, stringIndex, displayX, displayWidth });
    stringIndex += char.length;
    displayX += displayWidth;
  }
  return glyphs;
}

function findNearestLeftBoundary(boundaries: RawGlyph[], x: number): RawGlyph | undefined {
  let result: RawGlyph | undefined;
  for (const boundary of boundaries) {
    if (boundary.displayX >= x) break;
    result = boundary;
  }
  return result;
}

function findNearestRightBoundary(boundaries: RawGlyph[], x: number): RawGlyph | undefined {
  return boundaries.find((boundary) => boundary.displayX > x);
}

function makeBoundaryPair(
  kind: 'pipe' | 'arrow',
  leftBoundaries: RawGlyph[],
  rightBoundaries: RawGlyph[],
  x: number,
) {
  const left = findNearestLeftBoundary(leftBoundaries, x);
  const right = findNearestRightBoundary(rightBoundaries, x);
  if (!left || !right) return undefined;
  return {
    kind,
    left,
    right,
    width: right.displayX - (left.displayX + left.displayWidth),
  };
}

function clusterColumns(tokens: CandidateToken[]): Column[] {
  const columns: Column[] = [];
  for (const token of [...tokens].sort((left, right) => (
    (left.right - left.displayX) - (right.right - right.displayX)
  ))) {
    const relativeX = token.right - token.displayX;
    const column = columns.find(({ x }) => Math.abs(x - relativeX) <= COLUMN_TOLERANCE);
    if (column) {
      column.tokens.push(token);
      column.x = column.tokens.reduce(
        (sum, item) => sum + (item.right - item.displayX),
        0,
      ) / column.tokens.length;
    } else {
      columns.push({ x: relativeX, tokens: [token] });
    }
  }
  return columns;
}

function isLikelyVerticalGroup(tokens: CandidateToken[], columns: Column[]): boolean {
  const tokensPerLine = new Map<number, number>();
  for (const token of tokens) {
    tokensPerLine.set(token.line, (tokensPerLine.get(token.line) || 0) + 1);
  }
  const distinctLines = tokensPerLine.size;
  const maximumTokensPerLine = Math.max(...tokensPerLine.values());
  const longestColumn = Math.max(
    0,
    ...columns.map((column) => new Set(column.tokens.map(({ line }) => line)).size),
  );
  if (
    distinctLines < 3
    || longestColumn < 3
    || maximumTokensPerLine > 6
    || tokens.length / distinctLines > 6
  ) return false;

  const source = tokens.map(({ char }) => normalizeSourceCharacter(char)).join('');
  if (VERTICAL_AA_ONLY.test(source) || /^[ー│┃]/u.test(source)) return false;

  const semanticCharacterCount = Array.from(
    source.matchAll(/[ぁ-んァ-ヶ一-龯々〆ヵヶ]/gu),
  ).length;
  const contextOnlyCount = Array.from(
    source.matchAll(/[0-9０-９:：・･！？。、…「」『』（）［］【】]/gu),
  ).length;
  if (contextOnlyCount > semanticCharacterCount) return false;

  const hiragana = Array.from(source.matchAll(/[ぁ-ん]/gu), ({ 0: character }) => character);
  const strongHiragana = hiragana.filter((character) => !/[っぅ]/u.test(character));
  const katakanaRuns = source.match(/[ァ-ヶー]{3,}/gu) || [];
  const cjk = Array.from(source.matchAll(/[一-龯々〆ヵヶ]/gu), ({ 0: character }) => character);

  const hasHiraganaLanguage = (
    (hiragana.length >= 2 && new Set(strongHiragana).size >= 2)
    || (hiragana.length >= 3 && /[、。！？]/u.test(source))
  );
  const hasKatakanaWord = katakanaRuns.some((run) => (
    !/^[ニィノイー]+$/u.test(run)
    && new Set(Array.from(run).filter((character) => character !== 'ー')).size >= 2
  ));
  const hasPureCjkPhrase = (
    /^[一-龯々〆ヵヶ]{3,}[！？。、…「」『』（）［］【】]*$/u.test(source)
    && new Set(cjk).size >= 2
  );
  const hasMixedWord = strongHiragana.length >= 1 && hasKatakanaWord && cjk.length >= 1;
  return hasHiraganaLanguage || hasKatakanaWord || hasPureCjkPhrase || hasMixedWord;
}

function clearVerticalMetadata(segment: TextSegment): TextSegment {
  if (segment.isManualVerticalSelection) return segment;
  return {
    ...segment,
    isVerticalBox: false,
    isVerticalText: undefined,
    verticalGroupId: undefined,
    verticalOrder: undefined,
  };
}

function containsJapaneseScript(text: string): boolean {
  return /[ぁ-んァ-ヶ一-龯々〆ヵヶ\uff66-\uff9f]/u.test(text);
}

function buildSegmentRanges(segments: TextSegment[]) {
  const result = new Map<number, Array<{ start: number; end: number; segment: TextSegment }>>();
  for (const segment of segments) {
    const match = /^seg-(\d+)-(\d+)$/.exec(segment.id);
    if (!match || segment.text === '\n') continue;
    const line = Number(match[1]);
    const start = Number(match[2]);
    const ranges = result.get(line) || [];
    ranges.push({ start, end: start + segment.text.length, segment });
    result.set(line, ranges);
  }
  for (const ranges of result.values()) {
    ranges.sort((left, right) => left.start - right.start);
  }
  return result;
}

function normalizeSourceCharacter(character: string): string {
  if (character === '│' || character === '┃') return 'ー';
  return /[\uff66-\uff9f]/u.test(character) ? character.normalize('NFKC') : character;
}

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f)
    || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
    || (codePoint >= 0x1dc0 && codePoint <= 0x1dff)
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f)
    || (codePoint >= 0x2010 && codePoint <= 0x203b)
    || (codePoint >= 0x2100 && codePoint <= 0x27bf)
    || (codePoint >= 0x2e80 && codePoint <= 0x303e)
    || (codePoint >= 0x3041 && codePoint <= 0x33bf)
    || (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff01 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}
