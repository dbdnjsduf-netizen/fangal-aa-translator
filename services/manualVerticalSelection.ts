import { TextSegment } from '../types';
import { getDisplayWidth } from './verticalText';

export interface ManualVerticalCharacterRange {
  segmentId: string;
  start: number;
  end: number;
}

interface SelectedCharacter {
  segmentId: string;
  start: number;
  end: number;
  char: string;
  line: number;
  stringIndex: number;
  displayX: number;
  displayWidth: number;
  order?: number;
}

const MANUAL_VERTICAL_SOURCE_CHARACTER =
  /[ぁ-んァ-ヶ一-龯々〆ヵヶー！？!?。、.，,；;…「」『』（）［］【】│┃A-Za-zＡ-Ｚａ-ｚ0-9０-９:：・･\uff66-\uff9f]/u;
const COLUMN_CONTINUITY_TOLERANCE = 18;
const MAX_COLUMN_LINE_GAP = 4;
let manualVerticalSequence = 0;

const HORIZONTAL_DETECTION_FLAGS: Array<keyof TextSegment> = [
  'isStrictJapanese',
  'isAutoSelected',
  'isBoxedDialogue',
  'isContextDialogue',
  'isArrowBox',
  'isIndentedDialogue',
  'isIsolatedDialogue',
];

export function isManualVerticalSourceCharacter(character: string) {
  return MANUAL_VERTICAL_SOURCE_CHARACTER.test(character);
}

export function applyManualVerticalSelection(
  segments: TextSegment[],
  ranges: ManualVerticalCharacterRange[],
  requestedGroupId?: string,
): TextSegment[] {
  const rangeBySegmentId = new Map<string, ManualVerticalCharacterRange[]>();
  for (const range of ranges) {
    const existing = rangeBySegmentId.get(range.segmentId) || [];
    existing.push(range);
    rangeBySegmentId.set(range.segmentId, existing);
  }

  const content = segments.map(({ text }) => text).join('');
  const lineStarts = buildLineStarts(content);
  const absoluteStartBySegmentId = new Map<string, number>();
  let absoluteCursor = 0;
  for (const segment of segments) {
    absoluteStartBySegmentId.set(segment.id, absoluteCursor);
    absoluteCursor += segment.text.length;
  }

  const selectedCharacters: SelectedCharacter[] = [];
  for (const segment of segments) {
    // Allow an automatically detected vertical slot to be selected again. This
    // lets the manual box repair an incorrectly split automatic group instead
    // of forcing the user to accept the old grouping.
    if (segment.isTranslated) continue;
    const requested = rangeBySegmentId.get(segment.id);
    const segmentAbsoluteStart = absoluteStartBySegmentId.get(segment.id);
    if (!requested || segmentAbsoluteStart === undefined) continue;

    for (const range of requested) {
      const start = Math.max(0, Math.min(range.start, segment.text.length));
      const end = Math.max(start, Math.min(range.end, segment.text.length));
      let offset = start;
      while (offset < end) {
        const codePoint = segment.text.codePointAt(offset);
        if (codePoint === undefined) break;
        const char = String.fromCodePoint(codePoint);
        const nextOffset = offset + char.length;
        if (nextOffset <= end && isManualVerticalSourceCharacter(char)) {
          const absoluteIndex = segmentAbsoluteStart + offset;
          const line = findLineIndex(lineStarts, absoluteIndex);
          const lineStart = lineStarts[line];
          selectedCharacters.push({
            segmentId: segment.id,
            start: offset,
            end: nextOffset,
            char,
            line,
            stringIndex: absoluteIndex - lineStart,
            displayX: getDisplayWidth(content.slice(lineStart, absoluteIndex)),
            displayWidth: getDisplayWidth(char),
          });
        }
        offset = nextOffset;
      }
    }
  }

  const uniqueCharacters = deduplicateCharacters(selectedCharacters);
  if (uniqueCharacters.length < 2) return segments;

  const orderedCharacters = orderVerticalCharacters(uniqueCharacters);
  orderedCharacters.forEach((character, order) => {
    character.order = order;
  });
  const selectedBySegmentId = new Map<string, SelectedCharacter[]>();
  for (const character of orderedCharacters) {
    const existing = selectedBySegmentId.get(character.segmentId) || [];
    existing.push(character);
    selectedBySegmentId.set(character.segmentId, existing);
  }

  const groupId = requestedGroupId || makeManualVerticalGroupId();
  const result: TextSegment[] = [];
  for (const segment of segments) {
    const selected = selectedBySegmentId.get(segment.id);
    if (!selected) {
      result.push(segment);
      continue;
    }

    const orderedInSegment = [...selected].sort((left, right) => left.start - right.start);
    let cursor = 0;
    for (const character of orderedInSegment) {
      if (character.start > cursor) {
        result.push(sliceSegment(segment, cursor, character.start, `before-${character.start}`));
      }
      result.push(makeManualVerticalSegment(segment, character, groupId));
      cursor = character.end;
    }
    if (cursor < segment.text.length) {
      result.push(sliceSegment(segment, cursor, segment.text.length, 'after'));
    }
  }
  return result;
}

function orderVerticalCharacters(characters: SelectedCharacter[]) {
  const byLine = new Map<number, SelectedCharacter[]>();
  for (const character of characters) {
    const row = byLine.get(character.line) || [];
    row.push(character);
    byLine.set(character.line, row);
  }

  const columns: Array<{
    x: number;
    lastLine: number;
    lastX: number;
    characters: SelectedCharacter[];
  }> = [];
  for (const [line, row] of [...byLine.entries()].sort((left, right) => left[0] - right[0])) {
    const active = columns.filter((column) => line - column.lastLine <= MAX_COLUMN_LINE_GAP);
    const used = new Set<typeof columns[number]>();
    for (const character of [...row].sort((left, right) => right.displayX - left.displayX)) {
      const nearest = active
        .filter((column) => (
          !used.has(column)
          && Math.abs(column.lastX - character.displayX) <= COLUMN_CONTINUITY_TOLERANCE
        ))
        .sort((left, right) => (
          Math.abs(left.lastX - character.displayX) - Math.abs(right.lastX - character.displayX)
        ))[0];
      if (nearest) {
        nearest.characters.push(character);
        nearest.lastLine = line;
        nearest.lastX = character.displayX;
        nearest.x = nearest.characters.reduce((sum, item) => sum + item.displayX, 0)
          / nearest.characters.length;
        used.add(nearest);
      } else {
        columns.push({
          x: character.displayX,
          lastLine: line,
          lastX: character.displayX,
          characters: [character],
        });
      }
    }
  }

  return columns
    .sort((left, right) => right.x - left.x)
    .flatMap((column) => [...column.characters].sort((left, right) => (
      left.line - right.line || left.displayX - right.displayX
    )));
}

function makeManualVerticalSegment(
  segment: TextSegment,
  character: SelectedCharacter,
  groupId: string,
): TextSegment {
  const sliced = sliceSegment(segment, character.start, character.end, `vertical-${character.order}`);
  const clearedHorizontalFlags = Object.fromEntries(
    HORIZONTAL_DETECTION_FLAGS.map((flag) => [flag, false]),
  ) as Partial<TextSegment>;
  return {
    ...sliced,
    ...clearedHorizontalFlags,
    isJapanese: true,
    isManualSelection: true,
    isManualVerticalSelection: true,
    isManualRegexSelection: false,
    isAutoSelectExcluded: false,
    isSelected: true,
    isTranslated: false,
    isVerticalBox: true,
    isVerticalText: true,
    verticalGroupId: groupId,
    verticalOrder: character.order,
    verticalSourceLine: character.line,
    verticalSourceIndex: character.stringIndex,
    verticalDisplayX: character.displayX,
    verticalDisplayWidth: character.displayWidth,
  };
}

function sliceSegment(segment: TextSegment, start: number, end: number, label: string): TextSegment {
  const text = segment.text.slice(start, end);
  const original = segment.original.length === segment.text.length
    ? segment.original.slice(start, end)
    : text;
  return {
    ...segment,
    id: `${segment.id}-manual-v-${start}-${end}-${label}`,
    text,
    original,
    isSelected: false,
  };
}

function deduplicateCharacters(characters: SelectedCharacter[]) {
  const seen = new Set<string>();
  return characters.filter((character) => {
    const key = `${character.segmentId}:${character.start}:${character.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildLineStarts(content: string) {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function findLineIndex(lineStarts: number[], absoluteIndex: number) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= absoluteIndex) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

function makeManualVerticalGroupId() {
  manualVerticalSequence += 1;
  return `manual-vertical-${Date.now().toString(36)}-${manualVerticalSequence}`;
}
