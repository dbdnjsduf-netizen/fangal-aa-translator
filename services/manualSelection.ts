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
): TextSegment[] {
  const rangeBySegmentId = new Map(
    ranges.map((range) => [range.segmentId, range]),
  );
  const result: TextSegment[] = [];

  for (const segment of segments) {
    const requested = rangeBySegmentId.get(segment.id);
    if (!requested) {
      result.push(segment);
      continue;
    }

    const start = Math.max(0, Math.min(requested.start, segment.text.length));
    const end = Math.max(start, Math.min(requested.end, segment.text.length));
    const selectedText = segment.text.slice(start, end);
    if (start === end || selectedText.trim().length === 0 || segment.isTranslated) {
      result.push(segment);
      continue;
    }

    if (start === 0 && end === segment.text.length && segment.isJapanese) {
      result.push({ ...segment, isSelected: true });
      continue;
    }

    if (start > 0) {
      result.push(sliceSegment(segment, 0, start, 'before'));
    }
    result.push(makeManualSegment(segment, start, end));
    if (end < segment.text.length) {
      result.push(sliceSegment(segment, end, segment.text.length, 'after'));
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
): TextSegment {
  const selected = sliceSegment(segment, start, end, 'manual');
  const clearedFlags = Object.fromEntries(
    AUTOMATIC_FLAGS.map((flag) => [flag, false]),
  ) as Partial<TextSegment>;
  return {
    ...selected,
    ...clearedFlags,
    isJapanese: true,
    isManualSelection: true,
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
