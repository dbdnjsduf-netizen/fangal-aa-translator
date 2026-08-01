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

function consumeAdjacentLeftWhitespace(
  segments: TextSegment[],
  targetIndex: number,
  requestedWidth: number,
) {
  let remainingWidth = requestedWidth;

  for (let index = targetIndex - 1; index >= 0 && remainingWidth > 0; index -= 1) {
    const segment = segments[index];
    let text = segment.text;
    let changed = false;

    while (text.length > 0 && remainingWidth > 0) {
      const trailingCharacter = text.at(-1);
      if (trailingCharacter === ' ') {
        text = text.slice(0, -1);
        remainingWidth -= 1;
        changed = true;
        continue;
      }
      if (trailingCharacter === '　') {
        if (remainingWidth >= 2) {
          text = text.slice(0, -1);
          remainingWidth -= 2;
        } else {
          // 전각 공백을 반각 공백으로 줄이면 정확히 한 칸만 확보할 수 있다.
          text = `${text.slice(0, -1)} `;
          remainingWidth -= 1;
        }
        changed = true;
        continue;
      }
      break;
    }

    if (changed) {
      segments[index] = { ...segment, text };
    }

    // 빈 세그먼트는 연속 공백 조각일 수 있으므로 계속 탐색한다. 그 외의
    // 문자(줄바꿈 포함)를 만나면 같은 줄의 인접 공백이 끝난 것이다.
    if (text.length > 0) break;
  }

  return requestedWidth - remainingWidth;
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

  const nextSegments = [...segments];

  segments.forEach((segment, index) => {
    const update = updateBySegmentId.get(segment.id);
    if (!update) return;

    const unchanged = update.translatedText.trim() === segment.text.trim();
    if (unchanged) {
      nextSegments[index] = finalize
        ? { ...segment, isTranslated: true, isSelected: false }
        : segment;
      return;
    }

    const fitted = fitTranslationToDisplayWidth(segment.text, update.translatedText);
    const consumedLeftWidth = fitted.overflowWidth
      ? consumeAdjacentLeftWhitespace(nextSegments, index, fitted.overflowWidth)
      : 0;
    const remainingOverflow = (fitted.overflowWidth || 0) - consumedLeftWidth;

    if (finalize && remainingOverflow > 0) {
      const leftSpaceDetail = consumedLeftWidth > 0
        ? `왼쪽 공백 ${consumedLeftWidth}칸을 먼저 사용했지만 `
        : '';
      layoutFailures.push(
        `${update.sourceText}: ${leftSpaceDetail}번역 폭이 아직 ${remainingOverflow}칸 초과되어 오른쪽 내용을 밀어냈습니다.`,
      );
    }
    nextSegments[index] = {
      ...segment,
      text: fitted.text,
      isTranslated: true,
      isSelected: false,
    };
  });

  return { segments: nextSegments, layoutFailures };
}
