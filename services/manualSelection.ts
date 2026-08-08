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
  const newlyManualSegments = new Set<TextSegment>();

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
      if (selectionKind === 'manual' || hasDirectionOverrideMetadata(segment)) {
        const manual = makeWholeManualSegment(segment, selectionKind);
        result.push(manual);
        newlyManualSegments.add(manual);
      } else {
        result.push({
          ...segment,
          isSelected: true,
          isManualRegexSelection: selectionKind === 'regex' || undefined,
        });
      }
      continue;
    }

    let cursor = 0;
    normalized.forEach(({ start, end }, index) => {
      if (start > cursor) {
        result.push(sliceSegment(segment, cursor, start, `before-${index}`));
      }
      const manual = makeManualSegment(segment, start, end, selectionKind);
      result.push(manual);
      newlyManualSegments.add(manual);
      cursor = end;
    });
    if (cursor < segment.text.length) {
      result.push(sliceSegment(segment, cursor, segment.text.length, 'after'));
    }
  }

  return mergeAdjacentManualHorizontalSegments(result, newlyManualSegments);
}

function hasDirectionOverrideMetadata(segment: TextSegment) {
  return Boolean(
    segment.isManualRegexSelection
    || segment.isVerticalText
    || segment.isManualVerticalSelection
    || segment.verticalGroupId
    || segment.verticalOrder !== undefined
    || segment.verticalSourceLine !== undefined
    || segment.verticalSourceIndex !== undefined,
  );
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
  return makeHorizontalManualSegment(selected, selectionKind);
}

function makeWholeManualSegment(
  segment: TextSegment,
  selectionKind: 'manual' | 'regex',
) {
  return makeHorizontalManualSegment(segment, selectionKind);
}

function makeHorizontalManualSegment(
  selected: TextSegment,
  selectionKind: 'manual' | 'regex',
): TextSegment {
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

/**
 * Automatic vertical annotation splits a horizontal row into one-character
 * segments. When the user explicitly redraws that row in normal manual mode,
 * join only newly converted adjacent cells. Newlines and untouched gaps remain
 * hard boundaries, so separate source rows are never combined accidentally.
 */
function mergeAdjacentManualHorizontalSegments(
  segments: TextSegment[],
  newlyManualSegments: Set<TextSegment>,
) {
  const merged: TextSegment[] = [];
  let index = 0;

  while (index < segments.length) {
    const segment = segments[index];
    if (!isNewHorizontalManual(segment, newlyManualSegments)) {
      merged.push(segment);
      index += 1;
      continue;
    }

    let joined = segment;
    let nextIndex = index + 1;
    while (nextIndex < segments.length) {
      let candidateIndex = nextIndex;
      let gapText = '';
      let gapOriginal = '';

      while (
        candidateIndex < segments.length
        && isAbsorbableHorizontalGap(segments[candidateIndex])
      ) {
        gapText += segments[candidateIndex].text;
        gapOriginal += segments[candidateIndex].original;
        candidateIndex += 1;
      }

      const candidate = segments[candidateIndex];
      if (!candidate || !isNewHorizontalManual(candidate, newlyManualSegments)) break;

      joined = {
        ...joined,
        text: joined.text + gapText + candidate.text,
        original: joined.original + gapOriginal + candidate.original,
      };
      nextIndex = candidateIndex + 1;
    }

    merged.push(joined);
    index = nextIndex;
  }

  return merged;
}

function isNewHorizontalManual(
  segment: TextSegment,
  newlyManualSegments: Set<TextSegment>,
) {
  return newlyManualSegments.has(segment)
    && Boolean(segment.isManualSelection)
    && Boolean(segment.isSelected)
    && !segment.isVerticalText
    && !segment.text.includes('\n');
}

function isAbsorbableHorizontalGap(segment: TextSegment) {
  return !segment.isTranslated
    && !segment.text.includes('\n')
    && segment.text.length > 0
    && segment.text.trim().length === 0;
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
