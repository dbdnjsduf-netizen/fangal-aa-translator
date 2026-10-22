import { DictionaryEntry, TextSegment } from '../types';
import {
  buildTranslationSystemInstruction,
  generateDictionaryPrompt,
  TranslationBatchInput,
  TranslationInstruction,
  validateTranslatedItems,
} from './ollamaService';
import {
  isSegmentTranslationSelectable,
  NormalTranslationUpdate,
} from './translationApplication';
import { SmartTranslationUnit } from './translationPlan';
import {
  makeVerticalTranslationRequest,
  VerticalTextGroup,
  VerticalTranslationAssignment,
} from './verticalText';

// Claude Code(또는 사람)가 파일로 번역을 채워 넣고 다시 가져오는 작업 파일.
// 번역하는 쪽은 items[].translation만 채운다. id·source·app은 무결성 해시로 보호된다.
export const CLAUDE_JOB_FORMAT = 'fangal-aa-translation-job';
export const CLAUDE_JOB_VERSION = 1;

export interface ClaudeJobItem {
  id: string;
  source: string;
  translation: string;
  sceneBreakBefore?: boolean;
  verticalMaxChars?: number;
}

type ClaudeJobAnchor =
  | { id: string; kind: 'normal'; segmentId: string; sourceText: string }
  | { id: string; kind: 'vertical'; group: VerticalTextGroup };

export interface ClaudeJobFile {
  format: typeof CLAUDE_JOB_FORMAT;
  version: typeof CLAUDE_JOB_VERSION;
  jobId: string;
  createdAt: string;
  sourceFileName: string;
  guide: string[];
  systemPrompt: string;
  terminology: string;
  items: ClaudeJobItem[];
  app: {
    contentHash: string;
    integrity: string;
    anchors: ClaudeJobAnchor[];
  };
}

export const CLAUDE_JOB_GUIDE = [
  '이 파일은 AA 번역기의 번역 작업 파일입니다. items 배열의 각 translation 칸만 한국어 번역으로 채우세요.',
  'id, source, sceneBreakBefore, verticalMaxChars, app 블록은 절대 고치지 마세요. 바뀌면 가져오기가 거부됩니다.',
  '각 translation에는 같은 항목의 source 번역만 넣으세요. 앞뒤 항목과 합치거나, 나누거나, 순서를 옮기지 마세요.',
  'items는 원문 순서대로입니다. 앞뒤 항목을 문맥으로 참고하되, sceneBreakBefore가 true인 항목부터는 다른 장면입니다.',
  'verticalMaxChars가 있는 항목은 세로쓰기입니다. 공백 없이 그 글자 수 이하로 번역하세요.',
  'systemPrompt의 번역 규칙과 terminology의 용어를 따르세요.',
  '번역할 수 없거나 확신이 없는 항목은 translation을 빈 문자열로 두면 원문과 선택 상태가 그대로 남습니다.',
  '일부만 채운 파일도 가져올 수 있습니다. 결과는 UTF-8 JSON 파일로 저장하세요.',
];

export interface BuildClaudeJobOptions {
  content: string;
  sourceFileName: string;
  textsToTranslate: TranslationBatchInput[];
  translationUnits: SmartTranslationUnit[];
  systemInstruction: TranslationInstruction;
  customDictionary: DictionaryEntry[];
  useDefaultDictionary: boolean;
  jobId?: string;
  createdAt?: string;
}

export async function buildClaudeJob(options: BuildClaudeJobOptions): Promise<ClaudeJobFile> {
  const items: ClaudeJobItem[] = [];
  const anchors: ClaudeJobAnchor[] = [];
  const idWidth = Math.max(4, String(options.translationUnits.length).length);
  let unitIndex = 0;
  let pendingBreak = false;

  for (const input of options.textsToTranslate) {
    if (typeof input !== 'string') {
      pendingBreak = items.length > 0;
      continue;
    }
    const unit = options.translationUnits[unitIndex];
    if (!unit || unit.requestText !== input) {
      throw new Error('번역 단위 목록이 내부적으로 맞지 않아 내보낼 수 없습니다.');
    }
    const id = `#${String(unitIndex + 1).padStart(idWidth, '0')}`;
    const item: ClaudeJobItem = { id, source: unit.sourceText, translation: '' };
    if (pendingBreak) item.sceneBreakBefore = true;
    if (unit.kind === 'vertical') item.verticalMaxChars = unit.group.capacity;
    items.push(item);
    anchors.push(unit.kind === 'vertical'
      ? { id, kind: 'vertical', group: unit.group }
      : { id, kind: 'normal', segmentId: unit.segmentId, sourceText: unit.sourceText });
    pendingBreak = false;
    unitIndex += 1;
  }
  if (unitIndex !== options.translationUnits.length) {
    throw new Error('번역 단위 목록이 내부적으로 맞지 않아 내보낼 수 없습니다.');
  }

  const jobId = options.jobId || createJobId();
  const contentHash = await sha256Hex(options.content);
  return {
    format: CLAUDE_JOB_FORMAT,
    version: CLAUDE_JOB_VERSION,
    jobId,
    createdAt: options.createdAt || new Date().toISOString(),
    sourceFileName: options.sourceFileName,
    guide: CLAUDE_JOB_GUIDE,
    systemPrompt: buildTranslationSystemInstruction(options.systemInstruction),
    terminology: generateDictionaryPrompt(options.customDictionary, options.useDefaultDictionary)
      || '추가 용어 없음',
    items,
    app: {
      contentHash,
      integrity: await computeIntegrity(jobId, contentHash, items, anchors),
      anchors,
    },
  };
}

export interface ClaudeJobImportPlan {
  documentChanged: boolean;
  totalItems: number;
  normalUpdates: NormalTranslationUpdate[];
  verticalAssignments: VerticalTranslationAssignment[];
  // 아래 목록은 적용하지 않은 항목. 사용자에게 보여줄 설명 문자열이다.
  emptyIds: string[];
  rejected: string[];
  stale: string[];
}

export async function planClaudeJobImport(
  rawJson: string,
  content: string,
  segments: TextSegment[],
): Promise<ClaudeJobImportPlan> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson.replace(/^﻿/u, ''));
  } catch (error) {
    throw new Error(`JSON 파일을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
  const job = parsed as Partial<ClaudeJobFile>;
  if (job?.format !== CLAUDE_JOB_FORMAT) {
    throw new Error('AA 번역기에서 내보낸 번역 작업 파일이 아닙니다.');
  }
  if (job.version !== CLAUDE_JOB_VERSION) {
    throw new Error(`지원하지 않는 작업 파일 버전입니다 (${String(job.version)}).`);
  }
  if (!Array.isArray(job.items) || !job.app || !Array.isArray(job.app.anchors)) {
    throw new Error('작업 파일 구조가 손상되었습니다.');
  }

  const items = job.items;
  const anchors = job.app.anchors;
  const seenIds = new Set<string>();
  for (const item of items) {
    if (typeof item?.id !== 'string' || typeof item.source !== 'string') {
      throw new Error('작업 파일의 items 구조가 손상되었습니다.');
    }
    if (seenIds.has(item.id)) {
      throw new Error(`같은 id(${item.id})가 두 번 들어 있습니다. 항목이 복제된 것 같습니다.`);
    }
    seenIds.add(item.id);
    if (item.translation !== undefined && item.translation !== null && typeof item.translation !== 'string') {
      throw new Error(`${item.id}의 translation이 문자열이 아닙니다.`);
    }
  }
  if (items.length !== anchors.length) {
    throw new Error(`항목 수가 내보낼 때(${anchors.length}개)와 다릅니다 (${items.length}개). 항목이 지워지거나 추가된 것 같습니다.`);
  }

  // 순서가 바뀌었더라도 id로 원래 자리를 찾고, 원문·앱 데이터가 그대로인지 해시로 확인한다.
  const itemById = new Map(items.map((item) => [item.id, item]));
  const orderedItems = anchors.map((anchor) => {
    const item = itemById.get(anchor.id);
    if (!item) throw new Error(`${anchor.id} 항목이 사라졌습니다.`);
    return item;
  });
  const expectedIntegrity = await computeIntegrity(
    String(job.jobId),
    String(job.app.contentHash),
    orderedItems,
    anchors,
  );
  if (expectedIntegrity !== job.app.integrity) {
    throw new Error('원문(id·source)이나 app 블록이 내보낼 때와 다릅니다. 번역 칸 외의 내용이 바뀐 파일은 섞일 위험이 있어 가져오지 않습니다.');
  }

  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const plan: ClaudeJobImportPlan = {
    documentChanged: (await sha256Hex(content)) !== job.app.contentHash,
    totalItems: anchors.length,
    normalUpdates: [],
    verticalAssignments: [],
    emptyIds: [],
    rejected: [],
    stale: [],
  };

  anchors.forEach((anchor, index) => {
    const item = orderedItems[index];
    const translation = typeof item.translation === 'string' ? item.translation : '';
    if (!translation.trim()) {
      plan.emptyIds.push(anchor.id);
      return;
    }
    const requestText = anchor.kind === 'vertical'
      ? makeVerticalTranslationRequest(anchor.group)
      : anchor.sourceText;
    let validated: string;
    try {
      [validated] = validateTranslatedItems([requestText], [translation]);
    } catch (error) {
      plan.rejected.push(`${anchor.id} ${preview(item.source)}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    if (anchor.kind === 'normal') {
      const segment = segmentById.get(anchor.segmentId);
      if (segment?.isTranslated) {
        plan.stale.push(`${anchor.id} ${preview(item.source)}: 이미 번역된 항목입니다.`);
        return;
      }
      if (!segment || segment.text !== anchor.sourceText) {
        plan.stale.push(`${anchor.id} ${preview(item.source)}: 문서에서 같은 자리의 원문을 찾지 못했습니다.`);
        return;
      }
      if (!isSegmentTranslationSelectable(segment)) {
        plan.stale.push(`${anchor.id} ${preview(item.source)}: 지금은 번역 대상이 아닌 항목입니다.`);
        return;
      }
      plan.normalUpdates.push({
        segmentId: anchor.segmentId,
        sourceText: anchor.sourceText,
        translatedText: validated,
      });
      return;
    }

    const allTokensIntact = anchor.group.tokens.every((token) => {
      const segment = segmentById.get(token.segmentId);
      // 이미 번역된 칸은 글자가 바뀌어 있으므로 원문 글자 비교만으로 걸러진다.
      return Boolean(
        segment
        && segment.text.slice(token.segmentOffset, token.segmentOffset + token.char.length) === token.char,
      );
    });
    const hasUntranslatedToken = anchor.group.tokens.some((token) => {
      const segment = segmentById.get(token.segmentId);
      return Boolean(segment && isSegmentTranslationSelectable(segment));
    });
    if (!allTokensIntact || !hasUntranslatedToken) {
      plan.stale.push(`${anchor.id} ${preview(item.source)}: 세로쓰기 원문 위치가 바뀌었거나 이미 번역되었습니다.`);
      return;
    }
    plan.verticalAssignments.push({ group: anchor.group, translation: validated });
  });

  return plan;
}

function preview(text: string) {
  const singleLine = text.replace(/\s+/gu, ' ').trim();
  return singleLine.length > 20 ? `「${singleLine.slice(0, 20)}…」` : `「${singleLine}」`;
}

function createJobId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function computeIntegrity(
  jobId: string,
  contentHash: string,
  items: ClaudeJobItem[],
  anchors: ClaudeJobAnchor[],
) {
  // translation은 번역하는 쪽이 채우는 칸이라 해시에서 뺀다.
  const protectedItems = items.map((item) => [
    item.id,
    item.source,
    item.sceneBreakBefore === true,
    item.verticalMaxChars ?? null,
  ]);
  return sha256Hex(stableStringify({ jobId, contentHash, items: protectedItems, anchors }));
}

// 키 순서가 바뀌어 저장돼도(예: 다른 도구가 정렬) 같은 값이면 같은 문자열이 되게 한다.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
