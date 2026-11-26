import { Capacitor, registerPlugin } from '@capacitor/core';
import { SUPER_ADMIN_CONFIG } from '../types/taibah';
import { resolveGitHubRepo } from './updaterService';

interface TaibahAppShareNativePlugin {
  shareInstalledApk(options?: {
    subject?: string;
    text?: string;
    chooserTitle?: string;
  }): Promise<{
    shared?: boolean;
    fileName?: string;
    sizeBytes?: number;
  }>;
}

const TaibahAppShare = registerPlugin<TaibahAppShareNativePlugin>('TaibahAppShare');

export interface ShareAppResult {
  ok: boolean;
  mode: 'native_apk' | 'web_share' | 'clipboard' | 'cancelled';
  message: string;
}

function buildApkFallbackText(description?: string, apkUrl?: string): string {
  const repo = resolveGitHubRepo(apkUrl);
  const directApkLink =
    (apkUrl && /^https?:\/\//i.test(apkUrl.trim()) ? apkUrl.trim() : '') ||
    (repo ? `https://github.com/${repo}/releases/latest/download/TaibahNet-Cards.apk` : window.location.origin);

  return [
    '📶 تطبيق كروت طيبة نت — شبكة طيبة نت اللاسلكية (TAIBAH NET)',
    description?.trim() ||
      'النظام المتكامل لإدارة وبيع كروت الإنترنت اللاسلكي للوكلاء ونقاط البيع والمستهلكين.',
    `📲 تحميل ملف التطبيق (APK): ${directApkLink}`,
    `📞 ${SUPER_ADMIN_CONFIG.developerCredit}`,
  ].join('\n');
}

/**
 * Unified app sharing helper:
 * - On Native Android: invokes `TaibahAppShare.shareInstalledApk()` to share the actual
 *   installed `TaibahNet-Cards.apk` file directly via FileProvider (WhatsApp, Bluetooth, Nearby Share, etc.).
 * - On Web Preview (or older APK builds): cleanly falls back to Web Share API / clipboard with the direct APK download URL.
 */
export async function shareInstalledAppApk(options?: {
  description?: string;
  apkUrl?: string;
}): Promise<ShareAppResult> {
  const shareText = buildApkFallbackText(options?.description, options?.apkUrl);

  let isNativeAndroid = false;
  try {
    isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    isNativeAndroid = false;
  }

  if (isNativeAndroid) {
    try {
      const res = await TaibahAppShare.shareInstalledApk({
        subject: 'تطبيق كروت طيبة نت — TAIBAH NET',
        text: options?.description?.trim() || 'تطبيق كروت طيبة نت — شبكة طيبة نت اللاسلكية (TAIBAH NET)',
        chooserTitle: 'مشاركة تطبيق كروت طيبة نت',
      });
      if (res?.shared) {
        return {
          ok: true,
          mode: 'native_apk',
          message: 'تم تجهيز ملف التطبيق (TaibahNet-Cards.apk) وفتح نافذة المشاركة ✅',
        };
      }
    } catch {
      // Fall through cleanly to link/text fallback if plugin is unavailable on older APK builds
    }
  }

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const repo = resolveGitHubRepo(options?.apkUrl);
      const shareUrl =
        (options?.apkUrl && /^https?:\/\//i.test(options.apkUrl.trim()) ? options.apkUrl.trim() : '') ||
        (repo ? `https://github.com/${repo}/releases/latest/download/TaibahNet-Cards.apk` : window.location.origin);

      await navigator.share({
        title: 'كروت طيبة نت — TAIBAH NET',
        text: shareText,
        url: shareUrl,
      });
      return {
        ok: true,
        mode: 'web_share',
        message: 'تمت مشاركة رابط تحميل تطبيق كروت طيبة نت (APK) ✅',
      };
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareText);
      return {
        ok: true,
        mode: 'clipboard',
        message: 'تم نسخ رابط تحميل تطبيق كروت طيبة نت (APK) إلى الحافظة ✅',
      };
    }

    return {
      ok: false,
      mode: 'cancelled',
      message: 'تعذر فتح نافذة المشاركة على هذا المتصفح.',
    };
  } catch {
    return {
      ok: false,
      mode: 'cancelled',
      message: 'تم إلغاء المشاركة',
    };
  }
}
