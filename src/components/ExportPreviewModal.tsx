import React, { useEffect } from 'react';
import { CheckCircle2, Download, FileText, Send, X } from 'lucide-react';
import { openWhatsAppShare, type ExportShareResult } from '../utils/shareExport';

interface ExportPreviewModalProps {
  result: ExportShareResult | null;
  onClose: () => void;
}

/**
 * Update 13: Instant Preview & Action Fallback Modal when native share isn't used (e.g. desktop / preview iframe).
 * Gives the user an immediate preview + Download + Open WhatsApp buttons.
 */
export const ExportPreviewModal: React.FC<ExportPreviewModalProps> = ({ result, onClose }) => {
  useEffect(() => {
    return () => {
      if (result?.blobUrl) {
        URL.revokeObjectURL(result.blobUrl);
      }
    };
  }, [result]);

  if (!result) return null;

  const isImage = result.mimeType.startsWith('image/');

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-3 safe-top safe-bottom overflow-y-auto"
    >
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[90dvh] flex flex-col">
        <div className="royal-header-3d px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white min-w-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold truncate">تم تجهيز الملف بنجاح ✅</h3>
              <p className="text-[11px] font-bold text-[#FDE68A] truncate">{result.fileName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {isImage ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-800 max-h-72 flex items-center justify-center">
              <img
                src={result.blobUrl}
                alt={result.fileName}
                className="max-h-72 w-auto object-contain"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#D4AF37] bg-amber-50/50 dark:bg-amber-950/20 p-5 text-center space-y-2">
              <FileText className="w-10 h-10 mx-auto text-red-600" />
              <p className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
                ملف PDF عربي جاهز للحفظ والمشاركة
              </p>
              <p className="text-[11px] font-bold text-slate-500 break-all">{result.fileName}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <a
              href={result.blobUrl}
              download={result.fileName}
              className="min-h-[42px] rounded-xl royal-btn-3d text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
            >
              <Download className="w-4 h-4 text-[#FDE68A]" />
              <span>حفظ الملف</span>
            </a>
            <button
              type="button"
              onClick={() =>
                openWhatsAppShare(
                  result.sharePhone,
                  result.shareText || `مستند كروت طيبة نت: ${result.fileName}`
                )
              }
              className="min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
            >
              <Send className="w-4 h-4" />
              <span>فتح واتساب</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
