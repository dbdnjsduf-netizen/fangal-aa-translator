import React, { useCallback, useEffect, useState } from 'react';
import JSZip from 'jszip';
import {
  AlignLeft,
  Download,
  FileType,
  Image as ImageIcon,
  Loader2,
  MoveHorizontal,
  Scissors,
  X,
} from 'lucide-react';
import { paginateImageLines, stripFileExtension } from '../services/imageExport';

interface ImageExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  fileName: string;
  fontSize: number;
}

const AA_FONT_FAMILY = 'Saitamaar, "MS PGothic", "TextAA", "IPAMonaPGothic", "Monapo", "Mona", monospace';
const MAX_CANVAS_SIZE = 16_384;

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const ImageExportModal: React.FC<ImageExportModalProps> = ({
  isOpen,
  onClose,
  content,
  fileName,
  fontSize,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('준비 중...');
  const [errorText, setErrorText] = useState('');
  const [pageHeight, setPageHeight] = useState(1500);
  const [padding, setPadding] = useState(0);
  const [fixedWidth, setFixedWidth] = useState(1200);
  const [minimumWidth, setMinimumWidth] = useState(800);
  const [suggestedWidth, setSuggestedWidth] = useState(1200);
  const [smartSplit, setSmartSplit] = useState(true);
  const [optimizeWidth, setOptimizeWidth] = useState(true);
  const [removeLeadingWhitespace, setRemoveLeadingWhitespace] = useState(true);
  const [format, setFormat] = useState<'png' | 'jpg'>('png');

  const lines = content.split(/\r\n|\n|\r/u);
  const font = `${fontSize}px ${AA_FONT_FAMILY}`;

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setIsProcessing(false);
    setProgress(0);
    setStatusText('준비 중...');
    setErrorText('');

    void (async () => {
      await document.fonts.load(font);
      await document.fonts.ready;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context || !active) return;
      context.font = font;
      const maximumTextWidth = lines.reduce(
        (maximum, line) => Math.max(maximum, context.measureText(line).width),
        0,
      );
      const width = Math.ceil(maximumTextWidth + 40);
      setSuggestedWidth(width);
      setFixedWidth(width);
    })();

    return () => {
      active = false;
    };
  }, [isOpen, content, font]);

  const handleExport = useCallback(async () => {
    if (!content) return;
    setIsProcessing(true);
    setProgress(0);
    setErrorText('');
    setStatusText('Saitamaar 글꼴 준비 중...');

    try {
      await document.fonts.load(font);
      await document.fonts.ready;

      const safePageHeight = Math.max(128, Math.min(MAX_CANVAS_SIZE, pageHeight));
      const rowHeight = Math.floor(fontSize * 1.125);
      const safePadding = Math.max(
        0,
        Math.min(Math.floor((safePageHeight - rowHeight) / 2), padding),
      );
      const pages = paginateImageLines(lines, {
        pageHeight: safePageHeight,
        rowHeight,
        padding: safePadding,
        smartSplit,
        removeLeadingWhitespace,
      });
      const zip = new JSZip();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('브라우저에서 이미지 캔버스를 만들 수 없습니다.');

      const baseName = stripFileExtension(fileName);
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const page = pages[pageIndex];
        const renderedLines = page.lines.map((line) => (
          removeLeadingWhitespace ? line.slice(page.leadingWhitespaceCount) : line
        ));
        context.font = font;
        const maximumTextWidth = renderedLines.reduce(
          (maximum, line) => Math.max(maximum, context.measureText(line).width),
          0,
        );
        const requestedWidth = optimizeWidth
          ? Math.max(Math.ceil(maximumTextWidth + (safePadding * 2)), minimumWidth)
          : fixedWidth;
        if (requestedWidth > MAX_CANVAS_SIZE) {
          throw new Error(`이미지 너비가 브라우저 제한(${MAX_CANVAS_SIZE}px)을 초과했습니다.`);
        }
        const canvasWidth = Math.max(64, Math.floor(requestedWidth));
        const canvasHeight = Math.max(
          1,
          Math.min(safePageHeight, (renderedLines.length * rowHeight) + (safePadding * 2)),
        );
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvasWidth, canvasHeight);
        context.font = font;
        context.fillStyle = '#000000';
        context.textBaseline = 'top';
        renderedLines.forEach((line, lineIndex) => {
          context.fillText(line, safePadding, safePadding + (lineIndex * rowHeight));
        });

        const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (result) => (result ? resolve(result) : reject(new Error('이미지 변환에 실패했습니다.'))),
            mimeType,
            format === 'jpg' ? 0.9 : undefined,
          );
        });
        const pageName = `${baseName}_${String(pageIndex + 1).padStart(3, '0')}.${format}`;
        zip.file(pageName, blob);
        const percent = Math.floor(((pageIndex + 1) / pages.length) * 100);
        setProgress(percent);
        setStatusText(`${pageIndex + 1}/${pages.length}페이지 완료 (${percent}%)`);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }

      setStatusText('ZIP 파일 압축 중...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, `${stripFileExtension(fileName)}_images.zip`);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : '이미지 내보내기에 실패했습니다.';
      setErrorText(message);
      setStatusText('오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  }, [
    content,
    fileName,
    fixedWidth,
    font,
    fontSize,
    format,
    lines,
    minimumWidth,
    onClose,
    optimizeWidth,
    padding,
    pageHeight,
    removeLeadingWhitespace,
    smartSplit,
  ]);

  if (!isOpen) return null;

  const optionClass = 'flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50 p-3';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-xl bg-white text-slate-800 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white p-4">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <ImageIcon className="h-5 w-5 text-blue-500" /> 이미지로 내보내기
          </h3>
          {!isProcessing && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="이미지 내보내기 닫기">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="space-y-5 p-5">
          <div className="space-y-2">
            <label className="flex items-center gap-1 text-sm font-medium"><FileType className="h-4 w-4 text-slate-400" /> 이미지 포맷</label>
            <div className="grid grid-cols-2 gap-2">
              {(['png', 'jpg'] as const).map((candidate) => (
                <button
                  key={candidate}
                  onClick={() => setFormat(candidate)}
                  disabled={isProcessing}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold ${format === candidate ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-200 text-slate-600'}`}
                >
                  {candidate === 'png' ? 'PNG (고화질)' : 'JPG (저용량)'}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">{format === 'png' ? '텍스트가 가장 선명합니다. AA 작품 보존에 추천합니다.' : '용량이 작지만 텍스트 주변에 노이즈가 생길 수 있습니다.'}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
            <label className="space-y-2 text-sm font-medium">고정 너비 (px)
              <input type="number" value={fixedWidth} onChange={(event) => setFixedWidth(Number(event.target.value))} disabled={isProcessing || optimizeWidth} className="w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-400" />
            </label>
            <label className="space-y-2 text-sm font-medium">최소 너비 (px)
              <input type="number" value={minimumWidth} onChange={(event) => setMinimumWidth(Number(event.target.value))} disabled={isProcessing || !optimizeWidth} className="w-full rounded border border-slate-300 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-400" />
            </label>
          </div>
          <p className="-mt-3 text-xs text-blue-500">{optimizeWidth ? `콘텐츠에 맞추되, 최소 ${minimumWidth}px 너비를 유지합니다.` : `모든 페이지를 ${fixedWidth}px로 고정합니다. (권장: ${suggestedWidth}px)`}</p>

          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-2 text-sm font-medium">페이지 높이 (px)
              <input type="number" value={pageHeight} onChange={(event) => setPageHeight(Number(event.target.value))} disabled={isProcessing} className="w-full rounded border border-slate-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium">여백 (Padding)
              <input type="number" value={padding} onChange={(event) => setPadding(Number(event.target.value))} disabled={isProcessing} className="w-full rounded border border-slate-300 px-3 py-2" />
            </label>
          </div>

          <label className={optionClass}>
            <Scissors className="mt-0.5 h-6 w-6 rounded bg-blue-500 p-1 text-white" />
            <input type="checkbox" checked={smartSplit} onChange={(event) => setSmartSplit(event.target.checked)} disabled={isProcessing} className="mt-1" />
            <span><strong className="text-sm">스마트 분할 (상하 여백 확보)</strong><small className="mt-1 block text-xs text-slate-600">연속 빈 줄 사이에서 페이지를 나눠 AA 작품이 잘리는 것을 줄입니다.</small></span>
          </label>
          <label className={optionClass}>
            <MoveHorizontal className="mt-0.5 h-6 w-6 rounded bg-blue-500 p-1 text-white" />
            <input type="checkbox" checked={optimizeWidth} onChange={(event) => setOptimizeWidth(event.target.checked)} disabled={isProcessing} className="mt-1" />
            <span><strong className="text-sm">너비 자동 최적화</strong><small className="mt-1 block text-xs text-slate-600">각 페이지의 실제 내용에 맞춰 이미지 너비를 자동 조절합니다.</small></span>
          </label>
          <label className={optionClass}>
            <AlignLeft className="mt-0.5 h-6 w-6 rounded bg-blue-500 p-1 text-white" />
            <input type="checkbox" checked={removeLeadingWhitespace} onChange={(event) => setRemoveLeadingWhitespace(event.target.checked)} disabled={isProcessing} className="mt-1" />
            <span><strong className="text-sm">좌측 공백 제거</strong><small className="mt-1 block text-xs text-slate-600">각 페이지 모든 줄에 공통으로 존재하는 좌측 공백만 제거합니다.</small></span>
          </label>

          {isProcessing && (
            <div className="space-y-2 text-xs text-slate-500">
              <div className="flex justify-between"><span>{statusText}</span><span>{progress}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-blue-500" style={{ width: `${progress}%` }} /></div>
            </div>
          )}
          {errorText && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{errorText}</p>}

          <button onClick={() => void handleExport()} disabled={isProcessing} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 font-medium text-white shadow-lg disabled:bg-slate-400">
            {isProcessing ? <><Loader2 className="h-5 w-5 animate-spin" /> 변환 중...</> : <><Download className="h-5 w-5" /> {format.toUpperCase()} 변환 및 다운로드 (ZIP)</>}
          </button>
        </div>
      </div>
    </div>
  );
};
