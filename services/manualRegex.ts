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

export const MANUAL_REGEX_STORAGE_KEY = 'aat_manual_regex_rules_v1';

export const EMPTY_MANUAL_REGEX_RULES: ManualRegexRules = { entries: [] };

export interface ManualRegexTarget {
  kind: SelectionExclusionKind;
  sourceText: string;
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
      ...rule,
      // Imported patterns are always rebuilt from their source. This keeps the
      // feature literal and prevents unsafe or accidentally over-broad regexes.
      pattern: escapeRegexLiteral(rule.sourceText),
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
    rule.kind === target.kind && rule.sourceText === sourceText
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
    return sourceText.trim() ? { kind: 'vertical', sourceText } : null;
  }
  const sourceText = sourceOf(target);
  return sourceText.trim() ? { kind: 'normal', sourceText } : null;
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

  const verticalGroups = new Map<string, TextSegment[]>();
  for (const segment of segments) {
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
  let withVerticalSelections = segments.map((segment) => {
    if (
      !segment.verticalGroupId
      || !verticalTexts.has(verticalGroupTexts.get(segment.verticalGroupId) || '')
      || segment.isTranslated
    ) return segment;
    return { ...segment, isSelected: true, isManualRegexSelection: true };
  });

  if (normalTexts.length === 0) return withVerticalSelections;
  const ranges: ManualSelectionRange[] = [];
  for (const segment of withVerticalSelections) {
    if (segment.isTranslated || segment.verticalGroupId) continue;
    ranges.push(...findLiteralRanges(segment, normalTexts));
  }
  if (ranges.length === 0) return withVerticalSelections;
  withVerticalSelections = applyManualSelectionRanges(
    withVerticalSelections,
    ranges,
    'regex',
  );
  return withVerticalSelections;
}

function findLiteralRanges(segment: TextSegment, sourceTexts: string[]) {
  const candidates: Array<{ start: number; end: number }> = [];
  for (const sourceText of sourceTexts) {
    let start = 0;
    while (start <= segment.text.length - sourceText.length) {
      const matchStart = segment.text.indexOf(sourceText, start);
      if (matchStart === -1) break;
      candidates.push({ start: matchStart, end: matchStart + sourceText.length });
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
    && typeof rule.createdAt === 'number';
}
