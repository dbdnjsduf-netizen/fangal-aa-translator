
import React, { useState, useRef } from 'react';
import { X, Book, Plus, Trash2, Save, Upload, Download } from 'lucide-react';
import { DictionaryEntry } from '../types';
import { DEFAULT_DICTIONARY } from '../services/ollamaService';

interface DictionaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  customDictionary: DictionaryEntry[];
  setCustomDictionary: (dict: DictionaryEntry[]) => void;
  useDefaultDictionary: boolean;
  setUseDefaultDictionary: (use: boolean) => void;
}

export const DictionaryModal: React.FC<DictionaryModalProps> = ({
  isOpen,
  onClose,
  customDictionary,
  setCustomDictionary,
  useDefaultDictionary,
  setUseDefaultDictionary,
}) => {
  const [newOriginal, setNewOriginal] = useState('');
  const [newTranslated, setNewTranslated] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleAdd = () => {
    if (newOriginal.trim() && newTranslated.trim()) {
      setCustomDictionary([
        ...customDictionary,
        {
          id: Date.now().toString(),
          original: newOriginal.trim(),
          translated: newTranslated.trim(),
        },
      ]);
      setNewOriginal('');
      setNewTranslated('');
    }
  };

  const handleDelete = (id: string) => {
    setCustomDictionary(customDictionary.filter((d) => d.id !== id));
  };

  const handleExport = () => {
    if (customDictionary.length === 0) {
        alert("내보낼 사전 데이터가 없습니다.");
        return;
    }
    const jsonStr = JSON.stringify(customDictionary, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `custom_dictionary_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const json = JSON.parse(event.target?.result as string);
            if (Array.isArray(json)) {
                // Simple validation
                const valid = json.every(item => item.id && item.original && item.translated);
                if (valid) {
                    if (window.confirm(`현재 사전을 덮어쓰고 ${json.length}개의 항목을 불러오시겠습니까?`)) {
                        setCustomDictionary(json);
                    }
                } else {
                    alert("올바르지 않은 사전 파일 형식입니다.");
                }
            } else {
                alert("올바르지 않은 JSON 형식입니다.");
            }
        } catch (err) {
            alert("파일을 읽는 중 오류가 발생했습니다.");
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Book className="w-5 h-5 text-blue-400" />
            번역 사전 설정
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-8 custom-scrollbar">
          
          {/* Custom Dictionary Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    사용자 정의 사전
                </h3>
                <div className="flex gap-2">
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileChange} 
                        accept=".json" 
                        className="hidden" 
                    />
                    <button 
                        onClick={handleImportClick}
                        className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs text-slate-300 transition-colors"
                        title="JSON 파일 불러오기"
                    >
                        <Upload className="w-3 h-3" />
                        가져오기
                    </button>
                    <button 
                        onClick={handleExport}
                        className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs text-slate-300 transition-colors"
                        title="JSON 파일로 저장"
                    >
                        <Download className="w-3 h-3" />
                        내보내기
                    </button>
                </div>
            </div>
            
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="원문 (예: 2ch)"
                value={newOriginal}
                onChange={(e) => setNewOriginal(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none placeholder:text-slate-500"
              />
              <input
                type="text"
                placeholder="번역 (예: 투채널)"
                value={newTranslated}
                onChange={(e) => setNewTranslated(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none placeholder:text-slate-500"
              />
              <button
                onClick={handleAdd}
                disabled={!newOriginal || !newTranslated}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 py-2 rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            {customDictionary.length > 0 ? (
              <div className="bg-slate-800/50 rounded-lg border border-slate-700 divide-y divide-slate-700/50">
                {customDictionary.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between p-3 text-sm">
                    <div className="flex items-center gap-4 flex-1">
                      <span className="text-slate-300 w-1/2 truncate" title={entry.original}>{entry.original}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-blue-300 w-1/2 truncate" title={entry.translated}>{entry.translated}</span>
                    </div>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="text-slate-500 hover:text-red-400 p-1 rounded transition-colors ml-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500 text-sm border-2 border-dashed border-slate-800 rounded-lg">
                등록된 사용자 사전이 없습니다.
              </div>
            )}
          </section>

          {/* Default Dictionary Section */}
          <section className="pt-6 border-t border-slate-800">
            <div className="flex items-center justify-between mb-4">
               <div className="flex items-center gap-2">
                 <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">기본 제공 AA 사전</h3>
                 <span className="text-xs text-slate-500">(야루오, 모나 등)</span>
               </div>
               <label className="flex items-center cursor-pointer">
                 <span className="mr-3 text-sm text-slate-400">{useDefaultDictionary ? '사용 중' : '사용 안 함'}</span>
                 <div className="relative">
                   <input 
                      type="checkbox" 
                      className="sr-only" 
                      checked={useDefaultDictionary} 
                      onChange={(e) => setUseDefaultDictionary(e.target.checked)}
                   />
                   <div className={`w-10 h-5 rounded-full shadow-inner transition-colors ${useDefaultDictionary ? 'bg-blue-600' : 'bg-slate-700'}`}></div>
                   <div className={`absolute left-1 top-1 bg-white w-3 h-3 rounded-full shadow transition-transform ${useDefaultDictionary ? 'translate-x-5' : 'translate-x-0'}`}></div>
                 </div>
               </label>
            </div>

            {useDefaultDictionary ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 opacity-100 transition-opacity duration-300">
                {DEFAULT_DICTIONARY.map((entry) => (
                    <div key={entry.id} className="bg-slate-800/30 border border-slate-700/50 rounded px-3 py-2 text-xs flex justify-between items-center">
                        <span className="text-slate-400">{entry.original}</span>
                        <span className="text-green-400/80">{entry.translated}</span>
                    </div>
                ))}
                </div>
            ) : (
                <div className="text-center py-8 text-slate-600 text-sm opacity-50">
                    기본 사전이 비활성화되었습니다.
                </div>
            )}
          </section>

        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900/50 rounded-b-2xl flex justify-end">
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20"
          >
            <Save className="w-4 h-4" />
            설정 저장 및 닫기
          </button>
        </div>
      </div>
    </div>
  );
};
