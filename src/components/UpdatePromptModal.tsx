import React, { useState } from 'react';
import {
  BellRing,
  DownloadCloud,
  ExternalLink,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import {
  cancelActiveAppUpdate,
  cleanChangeItemText,
  downloadAndApplyAppUpdate,
  formatUpdateSizeAr,
  resolveGitHubRepo,
  resolveManifestSizeText,
  saveUpdateSnooze,
  type AppUpdateManifest,
  type OtaDownloadProgress,
  type ReleaseChangeType,
} from '../services/updaterService';
import { TAIBAH_ASSETS } from '../types/taibah';

const CHANGE_DOT_CLASS: Record<ReleaseChangeType, string> = {
  add: 'bg-emerald-500 ring-emerald-500/25',
  improve: 'bg-blue-500 ring-blue-500/25',
  fix: 'bg-orange-500 ring-orange-500/25',
  security: 'bg-[#D4AF37] ring-[#D4AF37]/30',
  remove: 'bg-slate-400 ring-slate-400/25',
};

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
  const [cancelling, setCancelling] = useState(false);
  const [progressInfo, setProgressInfo] = useState<OtaDownloadProgress | null>(null);
  const [errorText, setErrorText] = useState('');

  if (!manifest) return null;

  const sizeText = resolveManifestSizeText(manifest);
  const manifestBytes =
    manifest.updateSizeBytes ||
    (manifest.sizeMb ? Math.round(manifest.sizeMb * 1024 * 1024) : 0);

  const percent = progressInfo?.percent ?? 0;
  const totalBytes = progressInfo?.totalBytes || manifestBytes;
  const downloadedBytes = progressInfo?.downloadedBytes ?? 0;
  const speedKbps = progressInfo?.speedKbps ?? 0;
  const mirrorIndex = progressInfo?.mirrorIndex ?? 1;
  const mirrorCount = progressInfo?.mirrorCount ?? (manifest.bundleMirrors?.length || 3);
  const mirrorLabel = progressInfo?.mirrorLabel || '';
  const stageStatus = progressInfo?.status || 'downloading';

  const statusText =
    stageStatus === 'verifying'
      ? 'جاري التحقق من سلامة حزمة التحديث...'
      : stageStatus === 'extracting'
        ? 'جاري فك الضغط وتجهيز الملفات...'
        : stageStatus === 'applying' || percent >= 100
          ? 'جاري التطبيق وإعادة التشغيل...'
          : downloadedBytes <= 0
            ? 'جاري الاتصال بسيرفر التحديث...'
            : 'جاري تحميل التحديث الخفيف...';

  const speedText =
    speedKbps >= 1024
      ? `${(speedKbps / 1024).toFixed(1)} MB/s`
      : speedKbps > 0
        ? `${Math.round(speedKbps)} KB/s`
        : '';

  const structuredChanges = Array.isArray(manifest.changes)
    ? manifest.changes
        .filter((c) => c && typeof c.text === 'string')
        .map((c) => ({ type: c.type, text: cleanChangeItemText(c.text) }))
        .filter((c) => c.text.length > 0)
    : [];

  const headerTitle =
    manifest.releaseTitle?.trim() || 'تحديث جديد لتطبيق كروت طيبة نت';
  const releaseSummary = manifest.releaseSummary?.trim() || '';

  const resolvedApkUrl = (() => {
    if (manifest.apkUrl && /^https?:\/\//i.test(manifest.apkUrl)) {
      return manifest.apkUrl;
    }
    const repo = resolveGitHubRepo(manifest.apkUrl);
    return repo ? `https://github.com/${repo}/releases/latest/download/TaibahNet-Cards.apk` : '';
  })();

  const handleSnooze = async () => {
    if (downloading) {
      await cancelActiveAppUpdate();
      setDownloading(false);
    }
    saveUpdateSnooze(manifest.version, manifest.buildNumber);
    onDismiss();
  };

  const handleCancelDownload = async () => {
    if (!downloading || cancelling) return;
    setCancelling(true);
    try {
      await cancelActiveAppUpdate();
    } finally {
      setCancelling(false);
    }
  };

  const handleStartUpdate = async () => {
    if (downloading) return;
    setErrorText('');
    setCancelling(false);
    setDownloading(true);
    setProgressInfo({
      downloadedBytes: 0,
      totalBytes: manifestBytes,
      percent: 0,
      speedKbps: 0,
      mirrorIndex: 1,
      mirrorCount: manifest.bundleMirrors?.length || 3,
      mirrorLabel: 'GitHub Raw المباشر',
      status: 'downloading',
    });

    try {
      const result = await downloadAndApplyAppUpdate(
        manifest,
        requiresNativeApk,
        (info) => setProgressInfo(info)
      );
      if (!result.ok) {
        if (result.cancelled) {
          setErrorText('تم إلغاء التحميل — يمكنك المحاولة مجدداً في أي وقت.');
        } else {
          setErrorText(
            result.message || 'تعذر تثبيت التحديث الخفيف — يمكنك إعادة المحاولة أو تحميل النسخة الكاملة (APK).'
          );
        }
        setDownloading(false);
      } else if (result.mode === 'apk') {
        setDownloading(false);
      }
    } catch {
      setErrorText('حدث خطأ غير متوقع أثناء تحميل التحديث — اضغط «إعادة المحاولة» أو حمّل النسخة الكاملة (APK).');
      setDownloading(false);
    }
  };

  const handleFallbackApk = () => {
    if (resolvedApkUrl && /^https?:\/\//i.test(resolvedApkUrl)) {
      window.location.href = resolvedApkUrl;
    }
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 safe-top safe-bottom"
    >
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-xl overflow-hidden">
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
              <h3 className="text-[13px] sm:text-sm font-extrabold text-white flex items-center gap-1.5 leading-snug">
                <Sparkles className="w-4 h-4 text-[#FDE68A] shrink-0" />
                <span className="truncate">{headerTitle}</span>
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
              onClick={() => void handleSnooze()}
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
                ? 'يتطلب هذا الإصدار تحديث التطبيق الأساسي (APK) — جميع بياناتك وحسابك محفوظة ولن تتأثر.'
                : `حجم التحديث: ${sizeText} فقط — تحميل مباشر وسريع بدون فقدان بياناتك`}
            </p>
          </div>

          {/* Clean Non-Repetitive Release Notes Card */}
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/90 border border-[#D4AF37]/60 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
              <span>
                {requiresNativeApk ? 'ما الجديد في هذا الإصدار (APK)' : 'ما الجديد في هذا التحديث'}
              </span>
              <span className="tabular-nums text-[10.5px] px-2 py-0.5 rounded-lg bg-[#1A365D] text-[#FDE68A] border border-[#D4AF37]">
                {sizeText}
              </span>
            </div>

            {releaseSummary && (
              <p className="text-[11.5px] font-extrabold text-[#1A365D] dark:text-slate-100 leading-relaxed">
                {releaseSummary}
              </p>
            )}

            {structuredChanges.length > 0 ? (
              <ul className="max-h-44 overflow-y-auto space-y-1.5 pe-0.5">
                {structuredChanges.map((item, idx) => {
                  const dotClass = CHANGE_DOT_CLASS[item.type] || CHANGE_DOT_CLASS.improve;
                  return (
                    <li
                      key={`${item.type}_${idx}`}
                      className="flex items-start gap-2 rounded-xl bg-white/85 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700/80 px-2.5 py-1.5"
                    >
                      <span
                        className={`w-2 h-2 rounded-full ring-2 shrink-0 mt-1.5 ${dotClass}`}
                        aria-hidden="true"
                      />
                      <span className="text-[11.5px] font-bold text-slate-700 dark:text-slate-200 leading-relaxed">
                        {item.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line max-h-44 overflow-y-auto">
                {manifest.notes?.trim() ||
                  'يتضمن هذا التحديث تحسينات مهمة في السرعة والأمان وتجربة الاستخدام، وسيُثبّت مباشرة فوق التطبيق دون فقدان أي بيانات أو تسجيل خروج.'}
              </p>
            )}
          </div>

          {/* Real Live Native Streaming Progress Bar (Starts strictly at 0% / 0 KB) */}
          {downloading && (
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/75 border border-[#D4AF37]/70 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                <span className="flex items-center gap-1.5 min-w-0 truncate">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="truncate">{statusText}</span>
                </span>
                <span className="shrink-0">{percent}%</span>
              </div>

              <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-700 border border-[#D4AF37] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-[#D4AF37] via-[#F59E0B] to-[#1A365D] transition-all duration-150"
                  style={{ width: `${percent > 0 ? Math.min(100, percent) : 0}%` }}
                />
              </div>

              <div className="flex items-center justify-between gap-2 text-[10.5px] font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                <span>
                  {totalBytes > 0
                    ? `${downloadedBytes > 0 ? formatUpdateSizeAr(downloadedBytes) : '0 كيلوبايت'} / ${formatUpdateSizeAr(totalBytes)}`
                    : downloadedBytes > 0
                      ? formatUpdateSizeAr(downloadedBytes)
                      : '0 كيلوبايت'}
                </span>
                <span dir="ltr" className="text-emerald-700 dark:text-emerald-400 font-extrabold">
                  {speedText || (downloadedBytes > 0 ? 'جاري التحميل...' : '0 KB/s')}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                <span className="truncate">
                  المرآة {mirrorIndex}/{mirrorCount}
                  {mirrorLabel ? ` • ${mirrorLabel}` : ''}
                </span>
                <span>تدفق مباشر للقرص</span>
              </div>
            </div>
          )}

          {/* Error Box with Retry + Direct Full APK Fallback */}
          {errorText && !downloading && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border-2 border-red-500 p-2.5 space-y-2">
              <p className="text-xs font-extrabold text-red-700 dark:text-red-300 leading-relaxed">
                {errorText}
              </p>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleStartUpdate()}
                  className="w-full min-h-[38px] rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11.5px] font-extrabold flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>إعادة المحاولة</span>
                </button>
                {resolvedApkUrl && (
                  <button
                    type="button"
                    onClick={handleFallbackApk}
                    className="w-full min-h-[38px] rounded-lg bg-[#1A365D] text-[#FDE68A] border border-[#D4AF37] text-[11.5px] font-extrabold flex items-center justify-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>تحميل النسخة الكاملة (APK)</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons: Download/Retry + Real Cancel / Later */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {downloading ? (
              <>
                <button
                  type="button"
                  disabled={cancelling || stageStatus === 'extracting' || stageStatus === 'applying'}
                  onClick={() => void handleCancelDownload()}
                  className="min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 border-2 border-red-800 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-55"
                >
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>{cancelling ? 'جاري الإلغاء...' : 'إلغاء التحميل'}</span>
                </button>
                <button
                  type="button"
                  disabled={stageStatus === 'extracting' || stageStatus === 'applying'}
                  onClick={() => void handleSnooze()}
                  className="min-h-[44px] rounded-xl bg-amber-50 dark:bg-slate-800 border-2 border-[#1A365D]/60 dark:border-[#D4AF37]/70 text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-1 disabled:opacity-55"
                >
                  <BellRing className="w-3.5 h-3.5 shrink-0" />
                  <span>لاحقاً</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleStartUpdate()}
                  className="min-h-[44px] rounded-xl bg-gradient-to-b from-[#1E3A8A] via-[#1A365D] to-[#0F172A] border-2 border-[#D4AF37] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {errorText ? (
                    <RotateCcw className="w-4 h-4 text-[#FDE68A]" />
                  ) : (
                    <DownloadCloud className="w-4 h-4 text-[#FDE68A]" />
                  )}
                  <span>{errorText ? 'إعادة المحاولة' : 'تحميل التحديث الآن'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleSnooze()}
                  className="min-h-[44px] rounded-xl bg-amber-50 dark:bg-slate-800 border-2 border-[#1A365D]/60 dark:border-[#D4AF37]/70 text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-1"
                >
                  <BellRing className="w-3.5 h-3.5 shrink-0" />
                  <span>لاحقاً</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
