import React, { useState } from 'react';
import { BellRing, DownloadCloud, ExternalLink, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import {
  downloadAndApplyAppUpdate,
  formatUpdateSizeAr,
  resolveManifestSizeText,
  saveUpdateSnooze,
  type AppUpdateManifest,
} from '../services/updaterService';
import { TAIBAH_ASSETS } from '../types/taibah';

interface UpdatePromptModalProps {
  manifest: AppUpdateManifest | null;
  requiresNativeApk: boolean;
  onDismiss: () => void;
}

export const UpdatePromptModal: React.FC<UpdatePromptModalProps> = ({
  manifest,
  requiresNativeApk,
  onDismiss,
}) => {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorText, setErrorText] = useState('');

  if (!manifest) return null;

  const sizeText = resolveManifestSizeText(manifest);
  const totalBytes =
    manifest.updateSizeBytes ||
    (manifest.sizeMb ? Math.round(manifest.sizeMb * 1024 * 1024) : 0);
  const downloadedBytes = totalBytes > 0 ? Math.round((totalBytes * progress) / 100) : 0;

  const handleSnooze = () => {
    if (downloading) return;
    saveUpdateSnooze(manifest.version, manifest.buildNumber);
    onDismiss();
  };

  const handleStartUpdate = async () => {
    if (downloading) return;
    setErrorText('');
    setDownloading(true);
    setProgress(5);
    try {
      const result = await downloadAndApplyAppUpdate(
        manifest,
        requiresNativeApk,
        (pct) => setProgress(pct)
      );
      if (!result.ok) {
        setErrorText(
          result.message || 'تعذر تثبيت التحديث الخفيف — يمكنك تحميل ملف APK المباشر بالأسفل.'
        );
        setDownloading(false);
      } else if (result.mode === 'apk') {
        setDownloading(false);
      }
    } catch {
      setErrorText('حدث خطأ غير متوقع أثناء تحميل التحديث — حاول مجدداً أو حمّل ملف APK المباشر.');
      setDownloading(false);
    }
  };

  const handleFallbackApk = () => {
    if (manifest.apkUrl && /^https?:\/\//i.test(manifest.apkUrl)) {
      window.location.href = manifest.apkUrl;
    }
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 safe-top safe-bottom"
    >
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden">
        {/* Royal Navy + Gold Header */}
        <div className="royal-header-3d px-4 py-3.5 border-b-2 border-[#D4AF37] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-full p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shrink-0 shadow">
              <div className="w-full h-full rounded-full bg-[#061124] p-0.5 flex items-center justify-center overflow-hidden">
                <img
                  src={TAIBAH_ASSETS.logo}
                  alt="شعار شبكة طيبة نت"
                  className="w-full h-full rounded-full object-contain"
                />
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="text-[13.5px] sm:text-sm font-extrabold text-white flex items-center gap-1.5 leading-snug">
                <Sparkles className="w-4 h-4 text-[#FDE68A] shrink-0" />
                <span>تحديث جديد لتطبيق كروت طيبة نت</span>
              </h3>
              <p className="text-[11px] font-bold text-[#FDE68A] tabular-nums">
                الإصدار: v{manifest.version}
                {manifest.buildNumber ? ` (#${manifest.buildNumber})` : ''}
              </p>
            </div>
          </div>

          {!downloading && (
            <button
              type="button"
              onClick={handleSnooze}
              aria-label="إغلاق"
              className="w-8 h-8 rounded-full bg-white/15 border border-white/25 text-white flex items-center justify-center shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-4 space-y-3">
          {/* Lightweight Size Guarantee Banner */}
          <div
            className={`rounded-2xl border-2 px-3 py-2 flex items-start gap-2 ${
              requiresNativeApk
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-900 dark:text-amber-200'
                : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-900 dark:text-emerald-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="text-[11.5px] font-extrabold leading-relaxed">
              {requiresNativeApk
                ? `يتطلب هذا الإصدار تحديث التطبيق الأساسي (APK) — جميع بياناتك وحسابك محفوظة ولن تتأثر.`
                : `حجم التحديث: ${sizeText} فقط — لا يحتاج تحميل التطبيق بالكامل ولا يفقد بياناتك`}
            </p>
          </div>

          {/* Update Notes */}
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/90 border border-[#D4AF37]/60 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
              <span>
                {requiresNativeApk ? 'تحديث أساسي (APK)' : 'تحديث خفيف وفوري (OTA)'}
              </span>
              <span className="tabular-nums text-[10.5px] px-2 py-0.5 rounded-lg bg-[#1A365D] text-[#FDE68A] border border-[#D4AF37]">
                {sizeText}
              </span>
            </div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line">
              {manifest.notes?.trim() ||
                'يتضمن هذا التحديث تحسينات مهمة في السرعة والأمان وتجربة الاستخدام، وسيُثبّت مباشرة فوق التطبيق دون فقدان أي بيانات أو تسجيل خروج.'}
            </p>
          </div>

          {/* Live 0%–100% Download Progress Bar + Downloaded Size */}
          {downloading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    {progress >= 100
                      ? 'جاري التطبيق وإعادة التحميل...'
                      : 'جاري تحميل التحديث الخفيف...'}
                  </span>
                </span>
                <span>
                  {downloadedBytes > 0
                    ? `${formatUpdateSizeAr(downloadedBytes)} / ${sizeText} (${progress}%)`
                    : `${progress}%`}
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-800 border-2 border-[#D4AF37]/80 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-[#D4AF37] via-[#F59E0B] to-[#1A365D] transition-all duration-200"
                  style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
                />
              </div>
            </div>
          )}

          {errorText && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border-2 border-red-500 p-2.5 space-y-2">
              <p className="text-xs font-extrabold text-red-700 dark:text-red-300 leading-relaxed">
                {errorText}
              </p>
              {manifest.apkUrl && /^https?:\/\//i.test(manifest.apkUrl) && (
                <button
                  type="button"
                  onClick={handleFallbackApk}
                  className="w-full min-h-[38px] rounded-lg bg-[#1A365D] text-[#FDE68A] border border-[#D4AF37] text-[11.5px] font-extrabold flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>تحميل ملف APK المباشر كبديل</span>
                </button>
              )}
            </div>
          )}

          {/* Action Buttons: تحميل التحديث الآن + لاحقاً */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleStartUpdate()}
              className="min-h-[44px] rounded-xl bg-gradient-to-b from-[#1E3A8A] via-[#1A365D] to-[#0F172A] border-2 border-[#D4AF37] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-md active:scale-[0.98] disabled:opacity-70"
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#FDE68A]" />
              ) : (
                <DownloadCloud className="w-4 h-4 text-[#FDE68A]" />
              )}
              <span>{downloading ? 'جاري التحميل...' : 'تحميل التحديث الآن'}</span>
            </button>

            <button
              type="button"
              disabled={downloading}
              onClick={handleSnooze}
              className="min-h-[44px] rounded-xl bg-amber-50 dark:bg-slate-800 border-2 border-[#1A365D]/60 dark:border-[#D4AF37]/70 text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-1 active:scale-[0.98] disabled:opacity-45"
            >
              <BellRing className="w-3.5 h-3.5 shrink-0" />
              <span>لاحقاً</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
