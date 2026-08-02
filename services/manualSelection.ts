import { TextSegment } from '../types';

export interface ManualSelectionRange {
  segmentId: string;
  start: number;
  end: number;
}

const AUTOMATIC_FLAGS: Array<keyof TextSegment> = [
  'isStrictJapanese',
  'isAutoSelected',
  'isBoxedDialogue',
  'isContextDialogue',
  'isArrowBox',
  'isVerticalBox',
  'isIndentedDialogue',
  'isIsolatedDialogue',
];

export function applyManualSelectionRanges(
  segments: TextSegment[],
  ranges: ManualSelectionRange[],
  selectionKind: 'manual' | 'regex' = 'manual',
): TextSegment[] {
  const rangesBySegmentId = new Map<string, ManualSelectionRange[]>();
  for (const range of ranges) {
    const existing = rangesBySegmentId.get(range.segmentId) || [];
    existing.push(range);
    rangesBySegmentId.set(range.segmentId, existing);
  }
  const result: TextSegment[] = [];

  for (const segment of segments) {
    const requestedRanges = rangesBySegmentId.get(segment.id);
    if (!requestedRanges || segment.isTranslated) {
      result.push(segment);
      continue;
    }
    const normalized = mergeRanges(requestedRanges, segment.text);
    if (normalized.length === 0) {
      result.push(segment);
      continue;
    }

    if (
      normalized.length === 1
      && normalized[0].start === 0
      && normalized[0].end === segment.text.length
      && segment.isJapanese
    ) {
      result.push({
        ...segment,
        isSelected: true,
        isManualRegexSelection: selectionKind === 'regex' || undefined,
      });
      continue;
    }

    let cursor = 0;
    normalized.forEach(({ start, end }, index) => {
      if (start > cursor) {
        result.push(sliceSegment(segment, cursor, start, `before-${index}`));
      }
      result.push(makeManualSegment(segment, start, end, selectionKind));
      cursor = end;
    });
    if (cursor < segment.text.length) {
      result.push(sliceSegment(segment, cursor, segment.text.length, 'after'));
    }
  }

  return result;
}

function sliceSegment(
  segment: TextSegment,
  start: number,
  end: number,
  label: string,
): TextSegment {
  const text = segment.text.slice(start, end);
  const original = segment.original.length === segment.text.length
    ? segment.original.slice(start, end)
    : text;
  return {
    ...segment,
    id: `${segment.id}-slice-${start}-${end}-${label}`,
    text,
    original,
    // A manual range means exactly that range was requested. Surrounding slices
    // must not inherit a previous automatic/drag selection from the parent.
    isSelected: false,
  };
}

function makeManualSegment(
  segment: TextSegment,
  start: number,
  end: number,
  selectionKind: 'manual' | 'regex',
): TextSegment {
  const selected = sliceSegment(segment, start, end, selectionKind);
  const clearedFlags = Object.fromEntries(
    AUTOMATIC_FLAGS.map((flag) => [flag, false]),
  ) as Partial<TextSegment>;
  return {
    ...selected,
    ...clearedFlags,
    isJapanese: true,
    isManualSelection: selectionKind === 'manual',
    isManualRegexSelection: selectionKind === 'regex' || undefined,
    isAutoSelectExcluded: false,
    isSelected: true,
    isTranslated: false,
    isVerticalText: false,
    isManualVerticalSelection: false,
    verticalGroupId: undefined,
    verticalOrder: undefined,
    verticalSourceLine: undefined,
    verticalSourceIndex: undefined,
    verticalDisplayX: undefined,
    verticalDisplayWidth: undefined,
  };
}

function mergeRanges(ranges: ManualSelectionRange[], text: string) {
  const normalized = ranges
    .map(({ start, end }) => ({
      start: Math.max(0, Math.min(start, text.length)),
      end: Math.max(0, Math.min(end, text.length)),
    }))
    .map(({ start, end }) => ({ start: Math.min(start, end), end: Math.max(start, end) }))
    .filter(({ start, end }) => start < end && text.slice(start, end).trim().length > 0)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of normalized) {
    const previous = merged.at(-1);
    if (previous && range.start < previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
