import React, { useState, useRef, useEffect, startTransition } from 'react';
import { SelectionRange, TextSegment, ViewMode } from '../types';
import SegmentationWorker from '../workers/segmentation.worker?worker';
import { annotateVerticalTextSegments } from '../services/verticalText';
import {
  applyManualSelectionRanges,
  ManualSelectionRange,
} from '../services/manualSelection';
import {
  applyManualVerticalSelection,
  isManualVerticalSourceCharacter,
  ManualVerticalCharacterRange,
} from '../services/manualVerticalSelection';
import { isSegmentTranslationSelectable } from '../services/translationApplication';

interface EditorProps {
  content: string;
  fileName?: string;
  onChange: (newContent: string) => void;
  onSelectionChange: (range: SelectionRange | null) => void;
  viewMode: ViewMode;
  segments: TextSegment[];
  onSegmentsChange: (segments: TextSegment[]) => void;
  isDragMode?: boolean;
  isManualSelectMode?: boolean;
  isManualVerticalMode?: boolean;
}

export const Editor: React.FC<EditorProps> = ({ 
  content,
  fileName = "",
  onChange, 
  onSelectionChange,
  viewMode,
  segments,
  onSegmentsChange,
  isDragMode = false,
  isManualSelectMode = false,
  isManualVerticalMode = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(16);

  // Web Worker for segmentation
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  // Initialize and cleanup worker
  useEffect(() => {
    const worker = new SegmentationWorker();
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Drag Selection State
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const manualAnchorRef = useRef<{ node: Node; offset: number } | null>(null);

  // --- Raw Mode Logic ---
  const handleSelect = () => {
    if (viewMode !== 'raw') return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value.substring(start, end);
    if (start !== end && text.trim().length > 0) {
      onSelectionChange({ start, end, text });
    } else {
      onSelectionChange(null);
    }
  };

  const handleRawChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    // Reset segments to trigger re-segmentation when switching back to smart mode
    if (segments.length > 0) {
      onSegmentsChange([]);
    }
  };

  // --- Smart Mode Logic (Parsing via Web Worker) ---
  // Stable callback ref to avoid re-triggering the effect when onSegmentsChange identity changes
  const onSegmentsChangeRef = useRef(onSegmentsChange);
  onSegmentsChangeRef.current = onSegmentsChange;

  useEffect(() => {
    if (viewMode === 'smart' && segments.length === 0 && content) {
      const worker = workerRef.current;
      if (!worker) return;

      // Increment request ID to ignore stale results
      const currentRequestId = ++requestIdRef.current;

      const handleMessage = (e: MessageEvent<{ type: string; requestId: number; segments: TextSegment[] }>) => {
        if (e.data.type === 'result' && e.data.requestId === currentRequestId) {
          // Use startTransition so React can yield to the browser between renders,
          // preventing the UI (and other Chrome tabs) from freezing on large files.
          startTransition(() => {
            onSegmentsChangeRef.current(annotateVerticalTextSegments(content, e.data.segments));
          });
        }
      };

      worker.addEventListener('message', handleMessage);
      worker.postMessage({ type: 'segment', content, requestId: currentRequestId });

      return () => {
        worker.removeEventListener('message', handleMessage);
      };
    }
  }, [content, viewMode, segments.length]);

  const toggleSegmentSelection = (id: string) => {
    const target = segments.find((segment) => segment.id === id);
    if (!target || !isSegmentTranslationSelectable(target)) return;
    const nextSelected = !target.isSelected;
    const newSegments = segments.map((segment) => {
      if (
        target.verticalGroupId
        && segment.verticalGroupId === target.verticalGroupId
        && isSegmentTranslationSelectable(segment)
      ) {
        return { ...segment, isSelected: nextSelected };
      }
      return segment.id === id ? { ...segment, isSelected: nextSelected } : segment;
    });
    onSegmentsChange(newSegments);
    onSelectionChange(null); 
  };

  const captureManualTextSelection = () => {
    if (!isManualSelectMode || viewMode !== 'smart') return;
    const container = containerRef.current;
    const browserSelection = window.getSelection();
    if (
      !container
      || !browserSelection
      || browserSelection.rangeCount === 0
      || browserSelection.isCollapsed
    ) return;

    const range = browserSelection.getRangeAt(0);
    const startElement = findSegmentElement(range.startContainer);
    const endElement = findSegmentElement(range.endContainer);
    if (
      !startElement
      || !endElement
      || !container.contains(startElement)
      || !container.contains(endElement)
    ) return;

    const startId = startElement.dataset.segmentId;
    const endId = endElement.dataset.segmentId;
    const startIndex = segments.findIndex(({ id }) => id === startId);
    const endIndex = segments.findIndex(({ id }) => id === endId);
    if (startIndex < 0 || endIndex < startIndex) return;

    const startOffset = textOffsetWithin(
      startElement,
      range.startContainer,
      range.startOffset,
    );
    const endOffset = textOffsetWithin(
      endElement,
      range.endContainer,
      range.endOffset,
    );
    const manualRanges: ManualSelectionRange[] = [];
    for (let index = startIndex; index <= endIndex; index += 1) {
      const segment = segments[index];
      manualRanges.push({
        segmentId: segment.id,
        start: index === startIndex ? startOffset : 0,
        end: index === endIndex ? endOffset : segment.text.length,
      });
    }

    const nextSegments = applyManualSelectionRanges(segments, manualRanges);
    if (nextSegments !== segments) {
      onSegmentsChange(nextSegments);
      onSelectionChange(null);
    }
    browserSelection.removeAllRanges();
  };

  const captureManualVerticalBox = (x1: number, y1: number, x2: number, y2: number) => {
    if (!isManualVerticalMode || viewMode !== 'smart') return;
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const segmentById = new Map<string, TextSegment>(
      segments.map((segment) => [segment.id, segment]),
    );
    const ranges: ManualVerticalCharacterRange[] = [];

    for (const element of container.querySelectorAll<HTMLElement>('[data-segment-id]')) {
      const segmentId = element.dataset.segmentId;
      const segment = segmentId ? segmentById.get(segmentId) : undefined;
      if (!segmentId || !segment || segment.isTranslated) continue;

      const elementRect = element.getBoundingClientRect();
      const elementLeft = elementRect.left - containerRect.left + container.scrollLeft;
      const elementTop = elementRect.top - containerRect.top + container.scrollTop;
      const elementRight = elementLeft + elementRect.width;
      const elementBottom = elementTop + elementRect.height;
      if (elementRight < x1 || elementLeft > x2 || elementBottom < y1 || elementTop > y2) {
        continue;
      }

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      let elementTextOffset = 0;
      while (textNode) {
        const nodeText = textNode.textContent || '';
        let nodeOffset = 0;
        while (nodeOffset < nodeText.length) {
          const codePoint = nodeText.codePointAt(nodeOffset);
          if (codePoint === undefined) break;
          const character = String.fromCodePoint(codePoint);
          const nextOffset = nodeOffset + character.length;
          if (isManualVerticalSourceCharacter(character)) {
            const characterRange = document.createRange();
            characterRange.setStart(textNode, nodeOffset);
            characterRange.setEnd(textNode, nextOffset);
            const characterRect = characterRange.getBoundingClientRect();
            const centerX = characterRect.left - containerRect.left
              + container.scrollLeft + (characterRect.width / 2);
            const centerY = characterRect.top - containerRect.top
              + container.scrollTop + (characterRect.height / 2);
            if (centerX >= x1 && centerX <= x2 && centerY >= y1 && centerY <= y2) {
              ranges.push({
                segmentId,
                start: elementTextOffset + nodeOffset,
                end: elementTextOffset + nextOffset,
              });
            }
          }
          nodeOffset = nextOffset;
        }
        elementTextOffset += nodeText.length;
        textNode = walker.nextNode();
      }
    }

    const nextSegments = applyManualVerticalSelection(segments, ranges);
    if (nextSegments !== segments) {
      onSegmentsChange(nextSegments);
      onSelectionChange(null);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      setFontSize(prev => Math.min(Math.max(10, prev - Math.sign(e.deltaY)), 32));
    }
  };

  // --- Pointer Events for Robust Dragging ---
  const handlePointerDown = (e: React.PointerEvent) => {
    if (viewMode !== 'smart' || !e.isPrimary || e.button !== 0) return;
    if (isManualSelectMode) {
      const caret = caretAtPoint(e.clientX, e.clientY);
      const container = containerRef.current;
      if (!caret || !container || !findSegmentElement(caret.node)) return;
      e.preventDefault();
      container.setPointerCapture(e.pointerId);
      manualAnchorRef.current = caret;
      window.getSelection()?.setBaseAndExtent(
        caret.node,
        caret.offset,
        caret.node,
        caret.offset,
      );
      return;
    }
    if (!isDragMode && !isManualVerticalMode) return;
    
    // Prevent default browser actions (text selection etc)
    e.preventDefault();
    
    const container = containerRef.current;
    if (!container) return;
    
    // Capture pointer to ensure we receive events even if cursor leaves the container
    container.setPointerCapture(e.pointerId);
    
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left + container.scrollLeft;
    const y = e.clientY - rect.top + container.scrollTop;
    
    setIsDragging(true);
    setDragStart({ x, y });
    setDragCurrent({ x, y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isManualSelectMode && manualAnchorRef.current) {
      const caret = caretAtPoint(e.clientX, e.clientY);
      if (!caret || !findSegmentElement(caret.node)) return;
      e.preventDefault();
      window.getSelection()?.setBaseAndExtent(
        manualAnchorRef.current.node,
        manualAnchorRef.current.offset,
        caret.node,
        caret.offset,
      );
      return;
    }
    if (!isDragging || !dragStart) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left + container.scrollLeft;
    const y = e.clientY - rect.top + container.scrollTop;
    
    setDragCurrent({ x, y });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isManualSelectMode && manualAnchorRef.current) {
      const container = containerRef.current;
      const caret = caretAtPoint(e.clientX, e.clientY);
      if (caret && findSegmentElement(caret.node)) {
        window.getSelection()?.setBaseAndExtent(
          manualAnchorRef.current.node,
          manualAnchorRef.current.offset,
          caret.node,
          caret.offset,
        );
        captureManualTextSelection();
      }
      manualAnchorRef.current = null;
      if (container?.hasPointerCapture(e.pointerId)) {
        container.releasePointerCapture(e.pointerId);
      }
      return;
    }
    if (!isDragging || !dragStart || !dragCurrent) {
        if (isDragging) {
           // Cleanup if weird state
           setIsDragging(false);
           setDragStart(null);
           setDragCurrent(null);
           containerRef.current?.releasePointerCapture(e.pointerId);
        }
        return;
    }
    
    const container = containerRef.current;
    if (container) container.releasePointerCapture(e.pointerId);

    // Calculate selection box
    const x1 = Math.min(dragStart.x, dragCurrent.x);
    const y1 = Math.min(dragStart.y, dragCurrent.y);
    const x2 = Math.max(dragStart.x, dragCurrent.x);
    const y2 = Math.max(dragStart.y, dragCurrent.y);

    // Calculate minimal drag distance to differentiate from click
    const dist = Math.sqrt(Math.pow(dragCurrent.x - dragStart.x, 2) + Math.pow(dragCurrent.y - dragStart.y, 2));
    const isClick = dist < 5; 

    if (isClick && !isManualVerticalMode) {
        // Handle click toggle in drag mode
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target instanceof HTMLElement && target.id) {
            const segment = segments.find(s => s.id === target.id);
            if (segment && isSegmentTranslationSelectable(segment)) {
                toggleSegmentSelection(target.id);
            }
        }
    } else if (isManualVerticalMode) {
        captureManualVerticalBox(x1, y1, x2, y2);
    } else {
        // Find intersecting segments
        const intersectedSegments = segments.map(seg => {
          if (!isSegmentTranslationSelectable(seg)) return seg;

          const el = document.getElementById(seg.id);
          if (el && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();

            // Calculate element position relative to container content
            const elLeft = elRect.left - containerRect.left + containerRef.current.scrollLeft;
            const elTop = elRect.top - containerRect.top + containerRef.current.scrollTop;
            const elRight = elLeft + elRect.width;
            const elBottom = elTop + elRect.height;

            // Check intersection
            const isIntersecting = !(elRight < x1 || elLeft > x2 || elBottom < y1 || elTop > y2);

            if (isIntersecting) {
              return { ...seg, isSelected: true };
            }
          }
          return seg;
        });
        const selectedVerticalGroups = new Set(
          intersectedSegments
            .filter((segment) => segment.isSelected && segment.verticalGroupId)
            .map((segment) => segment.verticalGroupId),
        );
        const newSegments = intersectedSegments.map((segment) => (
          segment.verticalGroupId && selectedVerticalGroups.has(segment.verticalGroupId)
            ? { ...segment, isSelected: true }
            : segment
        ));
        onSegmentsChange(newSegments);
    }

    setIsDragging(false);
    setDragStart(null);
    setDragCurrent(null);
  };

  // Determine Background Color for Viewer Mode
  const getViewerBackgroundColor = () => {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.mlt') || lowerName.endsWith('.ast')) {
      return '#F0E0D6'; // Classic AA Beige
    }
    return '#FAFAFA'; // Off-white for generic text
  };

  // Render Content based on ViewMode
  if (viewMode === 'viewer') {
    return (
       <div className="relative w-full h-full flex flex-col">
         <div className="absolute top-2 right-4 z-10 flex gap-2 bg-black/10 backdrop-blur p-1 rounded-lg border border-black/10">
            <button onClick={() => setFontSize(f => Math.max(10, f - 1))} className="px-2 py-1 text-xs text-slate-700 hover:text-black hover:bg-white/50 rounded">A-</button>
            <span className="px-2 py-1 text-xs text-slate-700 font-mono">{fontSize}px</span>
            <button onClick={() => setFontSize(f => Math.min(32, f + 1))} className="px-2 py-1 text-xs text-slate-700 hover:text-black hover:bg-white/50 rounded">A+</button>
         </div>
         <div
            className="w-full h-full p-4 overflow-auto whitespace-pre font-aa leading-tight select-text text-[#2e2e2e]"
            style={{ 
                fontSize: `${fontSize}px`,
                backgroundColor: getViewerBackgroundColor()
            }}
            onWheel={handleWheel}
          >
            {content}
          </div>
       </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Font Controls */}
      <div className="absolute top-2 right-4 z-10 flex gap-2 bg-slate-800/80 backdrop-blur p-1 rounded-lg border border-slate-700">
        <button onClick={() => setFontSize(f => Math.max(10, f - 1))} className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded">A-</button>
        <span className="px-2 py-1 text-xs text-slate-400">{fontSize}px</span>
        <button onClick={() => setFontSize(f => Math.min(32, f + 1))} className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded">A+</button>
      </div>

      {viewMode === 'raw' ? (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleRawChange}
          onSelect={handleSelect}
          onMouseUp={handleSelect}
          onKeyUp={handleSelect}
          onWheel={handleWheel}
          spellCheck={false}
          className="w-full h-full bg-[#1a1b26] text-[#a9b1d6] p-4 resize-none focus:outline-none font-aa scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent leading-tight"
          style={{ fontSize: `${fontSize}px` }}
        />
      ) : (
        <div 
          ref={containerRef}
          className={`w-full h-full bg-[#1a1b26] text-[#a9b1d6] p-4 overflow-auto whitespace-pre font-aa leading-tight relative ${
            isManualSelectMode ? 'select-text cursor-text' : 'select-none'
          } ${isDragMode || isManualVerticalMode ? 'cursor-crosshair touch-none' : ''}`}
          style={{ fontSize: `${fontSize}px` }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
           {segments.map((seg) => {
             if (seg.isJapanese) {
               return (
                 <span
                   key={seg.id}
                   id={seg.id}
                   data-segment-id={seg.id}
                   onClick={(e) => {
                     if (isManualSelectMode || isManualVerticalMode) return;
                     e.stopPropagation();
                     toggleSegmentSelection(seg.id);
                   }}
                   className={`
                     rounded px-0.5 transition-colors duration-75 inline-block
                     ${!isDragMode && !isManualVerticalMode && isSegmentTranslationSelectable(seg) ? 'cursor-pointer' : 'cursor-default'}
                     ${seg.isSelected 
                        ? seg.isManualVerticalSelection
                          ? 'bg-fuchsia-600 text-white shadow-[0_0_10px_rgba(192,38,211,0.55)]'
                          : seg.isVerticalText
                          ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.5)]'
                          : seg.isManualSelection
                            ? 'bg-orange-600 text-white shadow-[0_0_10px_rgba(234,88,12,0.45)]'
                          : 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]'
                        : seg.isTranslated 
                            ? 'text-green-400 hover:bg-slate-800' 
                            : seg.isManualVerticalSelection
                              ? 'text-fuchsia-200 hover:bg-fuchsia-900/30'
                              : seg.isVerticalText
                              ? 'text-purple-200 hover:bg-purple-900/30'
                              : 'text-yellow-100 hover:bg-slate-700'
                     }
                     ${!seg.isTranslated && !seg.isSelected && 'underline decoration-slate-600/50 decoration-dotted'}
                   `}
                 >
                   {seg.text}
                 </span>
               );
             }
             return (
               <span
                 key={seg.id}
                 data-segment-id={seg.id}
                 className={isManualSelectMode
                   ? 'opacity-90 cursor-text'
                   : 'opacity-70 pointer-events-none'}
               >
                 {seg.text}
               </span>
             );
           })}

           {/* Selection Box Overlay */}
           {isDragging && dragStart && dragCurrent && (
             <div 
               className={`absolute pointer-events-none z-20 ${
                 isManualVerticalMode
                   ? 'border border-fuchsia-400 bg-fuchsia-500/20'
                   : 'border border-blue-400 bg-blue-500/20'
               }`}
               style={{
                 left: Math.min(dragStart.x, dragCurrent.x),
                 top: Math.min(dragStart.y, dragCurrent.y),
                 width: Math.abs(dragCurrent.x - dragStart.x),
                 height: Math.abs(dragCurrent.y - dragStart.y)
               }}
             />
           )}
        </div>
      )}
    </div>
  );
};

function findSegmentElement(node: Node): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest<HTMLElement>('[data-segment-id]') || null;
}

function textOffsetWithin(element: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  try {
    range.setEnd(node, offset);
    return Math.max(0, Math.min(range.toString().length, element.textContent?.length || 0));
  } catch {
    return 0;
  }
}

function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
  const caretPosition = document.caretPositionFromPoint?.(x, y);
  if (caretPosition) {
    return { node: caretPosition.offsetNode, offset: caretPosition.offset };
  }

  const legacyDocument = document as Document & {
    caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
  };
  const range = legacyDocument.caretRangeFromPoint?.(x, y);
  return range
    ? { node: range.startContainer, offset: range.startOffset }
    : null;
}
