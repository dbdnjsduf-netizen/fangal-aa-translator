import {
  ExactSelectionExclusionRule,
  SelectionExclusionKind,
  SelectionExclusionRules,
  TextSegment,
} from '../types';

export const SELECTION_EXCLUSIONS_STORAGE_KEY = 'aat_selection_exclusions_v1';

export const EMPTY_SELECTION_EXCLUSIONS: SelectionExclusionRules = {
  exact: [],
};

export interface SelectionExclusionTarget {
  kind: SelectionExclusionKind;
  sourceText: string;
  contextSignature?: string;
  selected: boolean;
}

export function deserializeSelectionExclusions(
  serialized: string | null | undefined,
): SelectionExclusionRules {
  if (!serialized) return { exact: [] };
  try {
    return normalizeSelectionExclusions(JSON.parse(serialized));
  } catch {
    return { exact: [] };
  }
}

export function normalizeSelectionExclusions(value: unknown): SelectionExclusionRules {
  if (!value || typeof value !== 'object') return { exact: [] };
  const candidate = value as Partial<SelectionExclusionRules>;
  const exact = Array.isArray(candidate.exact)
    ? candidate.exact.filter(isExactRule).map((rule) => ({
        id: rule.id,
        kind: rule.kind,
        sourceText: rule.sourceText,
        contextSignature: rule.contextSignature,
        createdAt: rule.createdAt,
      }))
    : [];
  return { exact };
}

export function getSelectionExclusionTarget(
  segments: TextSegment[],
  segmentId: string,
): SelectionExclusionTarget | null {
  const target = segments.find((segment) => segment.id === segmentId);
  if (!target || target.isTranslated || !target.isJapanese) return null;

  if (target.verticalGroupId) {
    const group = segments
      .filter((segment) => segment.verticalGroupId === target.verticalGroupId)
      .sort((left, right) => (
        (left.verticalOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.verticalOrder ?? Number.MAX_SAFE_INTEGER)
      ));
    if (group.length === 0) return null;
    return {
      kind: 'vertical',
      sourceText: group.map(sourceOf).join(''),
      contextSignature: group.find(({ detectionContextSignature }) => (
        Boolean(detectionContextSignature)
      ))?.detectionContextSignature,
      selected: group.some((segment) => segment.isSelected),
    };
  }

  return {
    kind: 'normal',
    sourceText: sourceOf(target),
    ...(target.detectionContextSignature
      ? { contextSignature: target.detectionContextSignature }
      : {}),
    selected: target.isSelected,
  };
}

export function addExactSelectionExclusion(
  rules: SelectionExclusionRules,
  target: Pick<SelectionExclusionTarget, 'kind' | 'sourceText' | 'contextSignature'>,
  id: string,
  createdAt = Date.now(),
): SelectionExclusionRules {
  const duplicate = rules.exact.some((rule) => (
    rule.kind === target.kind && rule.sourceText === target.sourceText
  ));
  if (duplicate) return rules;
  return {
    ...rules,
    exact: [
      ...rules.exact,
      {
        id,
        kind: target.kind,
        sourceText: target.sourceText,
        contextSignature: target.contextSignature,
        createdAt,
      },
    ],
  };
}

export function applySelectionExclusions(
  segments: TextSegment[],
  rules: SelectionExclusionRules,
): TextSegment[] {
  const exactNormal = new Set(
    rules.exact
      .filter((rule) => rule.kind === 'normal')
      .map((rule) => rule.sourceText),
  );
  const exactVertical = new Set(
    rules.exact
      .filter((rule) => rule.kind === 'vertical')
      .map((rule) => rule.sourceText),
  );
  const verticalGroups = new Map<string, TextSegment[]>();
  for (const segment of segments) {
    if (!segment.verticalGroupId) continue;
    const group = verticalGroups.get(segment.verticalGroupId) || [];
    group.push(segment);
    verticalGroups.set(segment.verticalGroupId, group);
  }
  const excludedVerticalGroups = new Set<string>();
  for (const [groupId, groupUnsorted] of verticalGroups) {
    const group = [...groupUnsorted].sort((left, right) => (
      (left.verticalOrder ?? Number.MAX_SAFE_INTEGER)
      - (right.verticalOrder ?? Number.MAX_SAFE_INTEGER)
    ));
    const sourceText = group.map(sourceOf).join('');
    if (exactVertical.has(sourceText)) {
      excludedVerticalGroups.add(groupId);
    }
  }

  let changed = false;
  const next = segments.map((segment) => {
    const sourceText = sourceOf(segment);
    const excluded = segment.verticalGroupId
      ? excludedVerticalGroups.has(segment.verticalGroupId)
      : Boolean(
        segment.isJapanese
        && exactNormal.has(sourceText)
      );
    if (
      Boolean(segment.isUserExcluded) === excluded
      && (!excluded || !segment.isSelected)
    ) {
      return segment;
    }
    changed = true;
    return {
      ...segment,
      isUserExcluded: excluded || undefined,
      isSelected: excluded ? false : segment.isSelected,
    };
  });
  return changed ? next : segments;
}

function sourceOf(segment: TextSegment): string {
  return segment.original || segment.text;
}

function isExactRule(value: unknown): value is ExactSelectionExclusionRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<ExactSelectionExclusionRule>;
  return typeof rule.id === 'string'
    && (rule.kind === 'normal' || rule.kind === 'vertical')
    && typeof rule.sourceText === 'string'
    && rule.sourceText.length > 0
    && (rule.contextSignature === undefined || typeof rule.contextSignature === 'string')
    && typeof rule.createdAt === 'number';
}
