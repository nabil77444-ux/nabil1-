import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { useFirebase, type ImportCardsResult } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import { normalizeDigits } from '../lib/firebase';
import {
  EXCLUSIVE_PACKAGES,
  formatCount,
  formatYER,
  getPackageThemeStyle,
  TAIBAH_ASSETS,
  type PackageDoc,
} from '../types/taibah';

interface PackagesImportScreenProps {
  hideNumbers: boolean;
}

/**
 * Extract all 10-digit and 11-digit voucher codes from arbitrary text,
 * converting Arabic/Hindi numerals to Western digits automatically.
 */
function extractVoucherNumbers(rawText: string): string[] {
  const normalized = normalizeDigits(rawText);
  const matches = normalized.match(/(?<!\d)\d{10,11}(?!\d)/g);
  return matches ? matches : [];
}

export const PackagesImportScreen: React.FC<PackagesImportScreenProps> = ({ hideNumbers }) => {
  const { packages, importCardsBatch } = useFirebase();
  const { notifySuccess, notifyError, notifyInfo } = useFeedback();

  const displayPackages = packages.length > 0 ? packages : (EXCLUSIVE_PACKAGES as PackageDoc[]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedPkg, setSelectedPkg] = useState<PackageDoc | null>(null);
  const [rawText, setRawText] = useState('');
  const [parsingFile, setParsingFile] = useState(false);
  const [parsingStatus, setParsingStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [lastReport, setLastReport] = useState<ImportCardsResult | null>(null);

  const parsedPreview = useMemo(() => {
    const all = extractVoucherNumbers(rawText);
    const unique = Array.from(new Set(all));
    return {
      totalExtracted: all.length,
      uniqueList: unique,
      localDuplicates: Math.max(0, all.length - unique.length),
    };
  }, [rawText]);

  const openImporterForPackage = (pkg: PackageDoc) => {
    setSelectedPkg(pkg);
    setRawText('');
    setLastReport(null);
    setProgressPercent(0);
    setProgressLabel('');
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsingFile(true);
    setParsingStatus(`جاري قراءة الملف: ${file.name}...`);

    try {
      const ext = file.name.toLowerCase().split('.').pop() || '';
      let extractedText = '';

      if (ext === 'txt' || ext === 'csv') {
        extractedText = await file.text();
      } else if (ext === 'xlsx' || ext === 'xls') {
        setParsingStatus('جاري قراءة ملف Excel بسرعة عالية...');
        const [buffer, XLSX] = await Promise.all([file.arrayBuffer(), import('xlsx')]);
        const wb = XLSX.read(buffer, { type: 'array' });
        const parts: string[] = [];
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1 });
          for (const row of rows) {
            parts.push(row.map((cell) => String(cell ?? '')).join(' '));
          }
        }
        extractedText = parts.join('\n');
      } else if (ext === 'pdf') {
        const parseStart = performance.now();
        setParsingStatus('جاري استخراج أرقام الكروت من ملف PDF بالتوازي بسرعة فائقة...');
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let pdfCodes: string[] = [];

        try {
          const pdfjsLib = await import('pdfjs-dist');
          try {
            pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
              'pdfjs-dist/build/pdf.worker.min.mjs',
              import.meta.url
            ).toString();
          } catch {
            // Worker URL fallback handled gracefully by pdfjs
          }

          const loadingTask = pdfjsLib.getDocument({
            data: bytes,
            disableFontFace: true,
            useSystemFonts: true,
          });
          const pdf = await loadingTask.promise;
          const totalPages = pdf.numPages || 0;
          const allPageCodes: string[][] = new Array(totalPages);

          // Step 1 (Primary Ultra-Fast Path): Parallel direct text extraction across all pages (ZERO Canvas, ZERO OCR)
          const PAGE_WAVE = 40;
          for (let start = 1; start <= totalPages; start += PAGE_WAVE) {
            const end = Math.min(totalPages, start + PAGE_WAVE - 1);
            setParsingStatus(`استخراج نصي فائق السرعة للصفحات ${start} - ${end} من ${totalPages}...`);
            const pageNumbers = Array.from({ length: end - start + 1 }, (_, i) => start + i);
            await Promise.all(
              pageNumbers.map(async (pageNum) => {
                const page = await pdf.getPage(pageNum);
                try {
                  const content = await page.getTextContent({ includeMarkedContent: false });
                  const items = content?.items || [];
                  const chunks: string[] = [];
                  for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (item && 'str' in item && item.str) {
                      chunks.push(item.str);
                    }
                  }
                  allPageCodes[pageNum - 1] = extractVoucherNumbers(chunks.join(' '));
                } finally {
                  page.cleanup();
                }
              })
            );
          }

          pdfCodes = allPageCodes.flat();

          // Step 2 (OCR Fallback ONLY if PDF is a scanned image with 0 extractable text codes)
          if (pdfCodes.length === 0 && totalPages > 0) {
            const maxOcrPages = Math.min(totalPages, 15);
            setParsingStatus(
              `الملف عبارة عن صور ممسوحة — جاري تشغيل خطة OCR البديلة (${maxOcrPages} صفحة)...`
            );
            const Tesseract = await import('tesseract.js');
            const ocrParts: string[] = [];
            for (let pageNum = 1; pageNum <= maxOcrPages; pageNum++) {
              setParsingStatus(`قراءة ضوئية (OCR) للصفحة ${pageNum} من ${maxOcrPages}...`);
              const page = await pdf.getPage(pageNum);
              try {
                const viewport = page.getViewport({ scale: 1.75 });
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(viewport.width);
                canvas.height = Math.round(viewport.height);
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
                  const ocrRes = await Tesseract.recognize(canvas, 'eng');
                  if (ocrRes?.data?.text) {
                    ocrParts.push(ocrRes.data.text);
                  }
                }
              } finally {
                page.cleanup();
              }
            }
            pdfCodes = extractVoucherNumbers(ocrParts.join('\n'));
          }

          await loadingTask.destroy();
          extractedText = pdfCodes.join('\n');
          const sec = ((performance.now() - parseStart) / 1000).toFixed(1);
          if (pdfCodes.length > 0) {
            setParsingStatus(`تم استخراج ${pdfCodes.length} رقم خلال ${sec} ثانية ⚡`);
          }
        } catch {
          // Clean fallback: decode raw PDF bytes text stream if pdfjs worker is restricted
          const decoder = new TextDecoder('latin1');
          extractedText = decoder.decode(buffer);
        }
      } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
        setParsingStatus('جاري تحليل الصورة واستخراج الأرقام عبر OCR...');
        const Tesseract = await import('tesseract.js');
        const result = await Tesseract.recognize(file, 'eng', {
          logger: (m) => {
            if (m.status === 'recognizing text' && typeof m.progress === 'number') {
              setParsingStatus(`جاري قراءة الصورة (OCR): ${Math.round(m.progress * 100)}%`);
            }
          },
        });
        extractedText = result?.data?.text || '';
      } else {
        extractedText = await file.text();
      }

      // Immediate in-memory Set deduplication
      const allCodes = extractVoucherNumbers(extractedText);
      const uniqueCodes = Array.from(new Set(allCodes));
      if (uniqueCodes.length === 0) {
        notifyInfo('لم يُعثر على أرقام كروت (10 أو 11 خانة)', 'تأكد من وضوح الملف أو الصق الأرقام مباشرة.');
      } else {
        setRawText((prev) =>
          prev.trim() ? `${prev.trim()}\n${uniqueCodes.join('\n')}` : uniqueCodes.join('\n')
        );
        notifySuccess(`تم استخراج ${uniqueCodes.length} رقم كرت فريد من ${file.name} بنجاح ⚡`);
      }
    } catch {
      notifyError('تعذر قراءة الملف', 'جرّب ملف Excel / CSV / TXT / PDF أو الصق الأرقام مباشرة.');
    } finally {
      setParsingFile(false);
      setParsingStatus('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCommitImport = async () => {
    if (!selectedPkg || parsedPreview.uniqueList.length === 0) return;
    setImporting(true);
    setProgressPercent(5);
    setProgressLabel('جاري فحص التكرارات والرفع السحابي...');
    try {
      const report = await importCardsBatch(
        selectedPkg.id,
        parsedPreview.uniqueList,
        (pct, done, total) => {
          setProgressPercent(pct);
          setProgressLabel(`جاري رفع الكروت... ${done} / ${total} (${pct}%)`);
        }
      );
      setLastReport(report);
      if (report.importedCount > 0) {
        setRawText('');
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3 safe-bottom-clear">
      {/* Header Banner */}
      <div className="royal-header-3d rounded-3xl border-2 border-[#D4AF37] p-4 shadow-xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-white/15 border border-[#D4AF37] flex items-center justify-center text-[#FDE68A] shrink-0">
            <Layers className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-white truncate">الباقات الثماني واستيراد الكروت</h2>
            <p className="text-[11px] font-bold text-[#FDE68A] truncate">
              اضغط على أي باقة لفتح محرك الاستيراد السريع (PDF • Excel • CSV • TXT • OCR)
            </p>
          </div>
        </div>
        <div className="w-11 h-11 rounded-full bg-[#061124] p-0.5 border-2 border-[#D4AF37] shrink-0 overflow-hidden shadow">
          <img
            src={TAIBAH_ASSETS.logo}
            alt="شعار طيبة نت"
            className="w-full h-full rounded-full object-contain"
          />
        </div>
      </div>

      {/* Vertical Stack of the 8 Exclusive Packages (Update 6) */}
      <div className="space-y-2.5">
        {displayPackages.map((pkg, idx) => {
          const theme = getPackageThemeStyle(pkg.price);
          return (
            <div
              key={pkg.id}
              onClick={() => openImporterForPackage(pkg)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openImporterForPackage(pkg);
              }}
              className={`royal-tile-3d cursor-pointer rounded-2xl bg-white dark:bg-slate-900 border-2 ${theme.border} shadow-md overflow-hidden`}
            >
              <div className={`bg-gradient-to-l ${theme.headerBg} px-3.5 py-2.5 text-white flex items-center justify-between gap-2`}>
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-slate-950 border-2 border-[#D4AF37] text-[#FDE68A] text-xs font-extrabold flex items-center justify-center tabular-nums shrink-0">
                    {idx + 1}
                  </span>
                  <div>
                    <div className="text-base font-extrabold tabular-nums leading-tight">
                      باقة {formatYER(pkg.price, hideNumbers)} — {pkg.dataLabel}
                    </div>
                    <div className="text-[11px] font-bold text-white/90">
                      {pkg.hoursLabel} · صلاحية {pkg.validityLabel}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openImporterForPackage(pkg);
                  }}
                  className="min-h-[36px] px-3 rounded-xl bg-white text-[#0F172A] text-xs font-extrabold flex items-center gap-1.5 shadow shrink-0"
                >
                  <Upload className="w-3.5 h-3.5 text-[#1A365D]" />
                  <span>استيراد الكروت</span>
                </button>
              </div>

              {/* 4 Live Stock Counters */}
              <div className="p-3 grid grid-cols-4 gap-1.5 text-center text-[11px] font-extrabold tabular-nums">
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-2 text-emerald-700 dark:text-emerald-300">
                  <div>المتاح</div>
                  <div className="text-sm">{formatCount(pkg.availableCount, hideNumbers)}</div>
                </div>
                <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 p-2 text-blue-700 dark:text-blue-300">
                  <div>المرفوع</div>
                  <div className="text-sm">{formatCount(pkg.uploadedCount, hideNumbers)}</div>
                </div>
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 p-2 text-amber-800 dark:text-amber-300">
                  <div>المباع</div>
                  <div className="text-sm">{formatCount(pkg.soldCount, hideNumbers)}</div>
                </div>
                <div className="rounded-xl bg-purple-50 dark:bg-purple-950/30 p-2 text-purple-700 dark:text-purple-300">
                  <div>المحقون</div>
                  <div className="text-sm">{formatCount(pkg.injectedCount, hideNumbers)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* DIRECT CARD IMPORTER MODAL (4,000+ Cards Batch Engine) */}
      {selectedPkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[92dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[#061124] p-0.5 border-2 border-[#D4AF37] shrink-0 overflow-hidden">
                  <img
                    src={TAIBAH_ASSETS.logo}
                    alt="طيبة نت"
                    className="w-full h-full rounded-full object-contain"
                  />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">
                    استيراد كروت باقة {selectedPkg.price} ر.ي ({selectedPkg.dataLabel})
                  </h3>
                  <p className="text-[11px] font-bold text-[#FDE68A]">
                    يدعم حتى 4,000+ كرت في الدفعة الواحدة (أرقام 10 و 11 خانة)
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={importing}
                onClick={() => setSelectedPkg(null)}
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {/* File Import Buttons */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.webp"
                onChange={handleFileSelected}
                className="hidden"
              />

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={parsingFile || importing}
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[46px] rounded-xl border-2 border-[#D4AF37] bg-amber-50 dark:bg-amber-950/30 text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex flex-col items-center justify-center gap-0.5 p-2"
                >
                  <FileText className="w-4 h-4" />
                  <span>PDF / TXT</span>
                </button>
                <button
                  type="button"
                  disabled={parsingFile || importing}
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[46px] rounded-xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold flex flex-col items-center justify-center gap-0.5 p-2"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Excel / CSV</span>
                </button>
                <button
                  type="button"
                  disabled={parsingFile || importing}
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[46px] rounded-xl border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-xs font-extrabold flex flex-col items-center justify-center gap-0.5 p-2"
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>صورة OCR</span>
                </button>
              </div>

              {parsingFile && (
                <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-300 p-3 flex items-center gap-2 text-xs font-extrabold text-blue-800 dark:text-blue-300">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>{parsingStatus}</span>
                </div>
              )}

              {/* Direct Paste Area */}
              <div>
                <label className="block text-xs font-extrabold mb-1">
                  أو الصق أرقام الكروت هنا مباشرة (يتم فرز الأرقام من 10 و 11 خانة تلقائياً):
                </label>
                <textarea
                  rows={6}
                  dir="ltr"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={'1234567890\n98765432101\n...'}
                  className="w-full rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 p-3 font-mono text-xs font-bold shadow-xs focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              {/* Live Extraction Preview */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs font-extrabold tabular-nums">
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2">
                  <div className="text-[10px] text-slate-500">المستخرج</div>
                  <div>{parsedPreview.totalExtracted}</div>
                </div>
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-2 text-emerald-700 dark:text-emerald-300">
                  <div className="text-[10px]">فريد جاهز للرفع</div>
                  <div>{parsedPreview.uniqueList.length}</div>
                </div>
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-2 text-amber-700 dark:text-amber-300">
                  <div className="text-[10px]">مكرر محلياً</div>
                  <div>{parsedPreview.localDuplicates}</div>
                </div>
              </div>

              {/* Live Upload Progress Bar */}
              {importing && (
                <div className="space-y-1.5">
                  <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-l from-[#D4AF37] to-emerald-500 transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="text-center text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                    {progressLabel}
                  </div>
                </div>
              )}

              {/* Final Import Report */}
              {lastReport && (
                <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-500 p-3 space-y-1 text-xs font-extrabold text-emerald-800 dark:text-emerald-200">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>تقرير الاستيراد السحابي النهائي:</span>
                  </div>
                  <div className="tabular-nums">
                    • تم استيراد وإضافة: {lastReport.importedCount} كرت جديد
                    {typeof lastReport.elapsedMs === 'number' && lastReport.elapsedMs > 0
                      ? ` (خلال ${(lastReport.elapsedMs / 1000).toFixed(1)} ثانية ⚡)`
                      : ''}
                  </div>
                  <div className="tabular-nums">
                    • تم استبعاد المكرر (بالمخزن أو الملف): {lastReport.duplicateCount} كرت
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={importing || parsedPreview.uniqueList.length === 0}
                onClick={handleCommitImport}
                className="w-full min-h-[48px] royal-btn-3d text-white text-sm font-extrabold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Upload className="w-4 h-4 text-[#FDE68A]" />
                <span>
                  {importing
                    ? 'جاري الاستيراد السحابي...'
                    : `تأكيد استيراد (${parsedPreview.uniqueList.length} كرت) إلى المخزون`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
