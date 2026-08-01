import { TextSegment } from '../types';
import { fitTranslationToDisplayWidth } from './verticalText';

const AUTOMATIC_SELECTION_FLAGS: Array<keyof TextSegment> = [
  'isManualSelection',
  'isStrictJapanese',
  'isAutoSelected',
  'isBoxedDialogue',
  'isContextDialogue',
  'isArrowBox',
  'isVerticalBox',
  'isIndentedDialogue',
  'isIsolatedDialogue',
];

export interface NormalTranslationUpdate {
  segmentId: string;
  sourceText: string;
  translatedText: string;
}

export function isSegmentTranslationSelectable(segment: TextSegment) {
  return segment.isJapanese && !segment.isTranslated;
}

export function toggleSegmentTranslationSelection(
  segments: TextSegment[],
  segmentId: string,
) {
  const target = segments.find((segment) => segment.id === segmentId);
  if (!target || !isSegmentTranslationSelectable(target)) return segments;

  const nextSelected = !target.isSelected;
  return segments.map((segment) => {
    if (
      target.verticalGroupId
      && segment.verticalGroupId === target.verticalGroupId
      && isSegmentTranslationSelectable(segment)
    ) {
      return { ...segment, isSelected: nextSelected };
    }
    return segment.id === segmentId
      ? { ...segment, isSelected: nextSelected }
      : segment;
  });
}

export function selectAllTranslatableSegments(segments: TextSegment[]) {
  return segments.map((segment) => {
    if (!isSegmentTranslationSelectable(segment)) {
      return segment.isSelected ? { ...segment, isSelected: false } : segment;
    }
    const shouldSelect = !segment.isAutoSelectExcluded
      && AUTOMATIC_SELECTION_FLAGS.some((flag) => Boolean(segment[flag]));
    return shouldSelect && !segment.isSelected
      ? { ...segment, isSelected: true }
      : segment;
  });
}

export function clearCompletedSelections(segments: TextSegment[]) {
  return segments.map((segment) => (
    segment.isTranslated && segment.isSelected
      ? { ...segment, isSelected: false }
      : segment
  ));
}

export function applyNormalTranslationUpdates(
  segments: TextSegment[],
  updates: NormalTranslationUpdate[],
  finalize = false,
) {
  const updateBySegmentId = new Map(
    updates.map((update) => [update.segmentId, update]),
  );
  const layoutFailures: string[] = [];

  const nextSegments = segments.map((segment) => {
    const update = updateBySegmentId.get(segment.id);
    if (!update) return segment;

    const unchanged = update.translatedText.trim() === segment.text.trim();
    if (unchanged) {
      return finalize
        ? { ...segment, isTranslated: true, isSelected: false }
        : segment;
    }

    const fitted = fitTranslationToDisplayWidth(segment.text, update.translatedText);
    if (finalize && fitted.reason) {
      layoutFailures.push(`${update.sourceText}: ${fitted.reason}`);
    }
    return {
      ...segment,
      text: fitted.text,
      isTranslated: true,
      isSelected: false,
    };
  });

  return { segments: nextSegments, layoutFailures };
}
