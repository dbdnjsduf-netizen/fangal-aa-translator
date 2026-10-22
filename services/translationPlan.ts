import { TextSegment } from '../types';
import {
  isTranslationPostHeader,
  TRANSLATION_POST_BOUNDARY,
  TranslationBatchInput,
} from './ollamaService';
import { isSegmentTranslationSelectable } from './translationApplication';
import {
  detectVerticalTextGroups,
  makeVerticalTranslationRequest,
  VerticalTextGroup,
} from './verticalText';

export type SmartTranslationUnit =
  | {
      kind: 'normal';
      segmentId: string;
      sourceText: string;
      requestText: string;
    }
  | {
      kind: 'vertical';
      group: VerticalTextGroup;
      sourceText: string;
      requestText: string;
    };

export interface SmartTranslationPlan {
  // 번역 엔진에 보내는 순서 그대로. null/경계 표시는 문맥 구분용이다.
  textsToTranslate: TranslationBatchInput[];
  // textsToTranslate에서 문자열 항목만 순서대로 모은 것과 1:1로 대응한다.
  translationUnits: SmartTranslationUnit[];
}

// 선택된 세그먼트를 일괄 번역 단위(가로 대사·세로쓰기 묶음)로 만든다.
export function buildSmartTranslationPlan(
  content: string,
  segments: TextSegment[],
): SmartTranslationPlan {
  const verticalGroups = detectVerticalTextGroups(content, segments);
  const verticalGroupBySegmentId = new Map<string, VerticalTextGroup>();
  verticalGroups.forEach((group) => {
    group.segmentIds.forEach((segmentId) => verticalGroupBySegmentId.set(segmentId, group));
  });

  const textsToTranslate: TranslationBatchInput[] = [];
  const translationUnits: SmartTranslationUnit[] = [];
  const addedVerticalGroups = new Set<string>();
  let lastUnitSegmentIndex = -1;
  let sourceLine = '';
  let pendingPostBoundary = false;

  const addUnit = (unit: SmartTranslationUnit, segmentIndex: number) => {
    if (lastUnitSegmentIndex !== -1) {
      const gapSegments = segments.slice(lastUnitSegmentIndex + 1, segmentIndex);
      const newlineCount = gapSegments.reduce(
        (count, segment) => count + (segment.text.split('\n').length - 1),
        0,
      );
      if (newlineCount >= 3 || gapSegments.length > 20) {
        textsToTranslate.push(null);
      }
    }
    if (pendingPostBoundary && translationUnits.length > 0) {
      textsToTranslate.push(TRANSLATION_POST_BOUNDARY);
    }
    pendingPostBoundary = false;
    translationUnits.push(unit);
    textsToTranslate.push(unit.requestText);
    lastUnitSegmentIndex = segmentIndex;
  };

  segments.forEach((segment, segmentIndex) => {
    const sourceFragment = segment.original || segment.text;
    if (sourceFragment === '\n') {
      if (isTranslationPostHeader(sourceLine)) pendingPostBoundary = true;
      sourceLine = '';
      return;
    }
    sourceLine += sourceFragment;
    if (!segment.isSelected || !isSegmentTranslationSelectable(segment)) return;
    const verticalGroup = verticalGroupBySegmentId.get(segment.id);
    if (verticalGroup) {
      if (addedVerticalGroups.has(verticalGroup.id)) return;
      addedVerticalGroups.add(verticalGroup.id);
      addUnit({
        kind: 'vertical',
        group: verticalGroup,
        sourceText: verticalGroup.sourceText,
        requestText: makeVerticalTranslationRequest(verticalGroup),
      }, segmentIndex);
      return;
    }
    addUnit({
      kind: 'normal',
      segmentId: segment.id,
      sourceText: segment.text,
      requestText: segment.text,
    }, segmentIndex);
  });

  return { textsToTranslate, translationUnits };
}
