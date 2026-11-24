import { Capacitor } from '@capacitor/core';

export interface AppUpdateManifest {
  version: string;
  sizeMb?: number;
  notes?: string;
  otaUrl?: string;
  apkUrl?: string;
  minNativeVersion?: string;
  publishedAt?: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  requiresNativeApk: boolean;
  currentVersion: string;
  manifest: AppUpdateManifest | null;
  error?: string;
}

export const APP_CURRENT_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || '2.0.0';

export const NATIVE_APP_VERSION =
  (import.meta.env.VITE_NATIVE_VERSION as string | undefined)?.trim() || APP_CURRENT_VERSION;

const DEFAULT_GITHUB_REPO =
  (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.trim() || '';

const APPLIED_OTA_VERSION_KEY = 'taibah_applied_ota_version_v1';
const UPDATE_SNOOZE_LOCAL_KEY = 'taibah_update_snooze_v1';
const UPDATE_SNOOZE_SESSION_KEY = 'taibah_update_snooze_session_v1';

/**
 * Remember that the user clicked "تذكير لاحقاً" so the modal does not reappear
 * repeatedly during the current running session, while still reminding them
 * next time they close and reopen the app (or tap manual check in Settings).
 */
export function saveUpdateSnooze(version: string): void {
  const clean = String(version || '').trim();
  if (!clean) return;
  try {
    window.sessionStorage.setItem(UPDATE_SNOOZE_SESSION_KEY, clean);
  } catch {
    // ignore
  }
  try {
    window.localStorage.setItem(
      UPDATE_SNOOZE_LOCAL_KEY,
      JSON.stringify({ version: clean, snoozedAt: Date.now() })
    );
  } catch {
    // ignore
  }
}

export function isUpdateSnoozedForCurrentSession(version: string): boolean {
  const clean = String(version || '').trim();
  if (!clean) return false;
  try {
    return window.sessionStorage.getItem(UPDATE_SNOOZE_SESSION_KEY) === clean;
  } catch {
    return false;
  }
}

function isNativePlatformSafe(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function loadNativeCapacitorUpdater() {
  if (!isNativePlatformSafe()) return null;
  try {
    const mod = await import('@capgo/capacitor-updater');
    return mod?.CapacitorUpdater ?? null;
  } catch {
    return null;
  }
}

/**
 * Must be called immediately on native app startup so @capgo/capacitor-updater
 * confirms the active bundle loaded cleanly and never rolls it back.
 * Strictly skipped on Web / Preview to prevent browser-side plugin errors.
 */
export function notifyUpdaterReady(): void {
  if (!isNativePlatformSafe()) return;
  void loadNativeCapacitorUpdater()
    .then((updater) => {
      if (updater && typeof updater.notifyAppReady === 'function') {
        return updater.notifyAppReady();
      }
      return undefined;
    })
    .catch(() => {
      // Non-fatal in non-native or preview environments
    });
}

export function getInstalledAppVersion(): string {
  try {
    const applied = localStorage.getItem(APPLIED_OTA_VERSION_KEY);
    if (applied && compareVersions(applied, APP_CURRENT_VERSION) > 0) {
      return applied;
    }
  } catch {
    // ignore storage read errors
  }
  return APP_CURRENT_VERSION;
}

/**
 * Compare semantic version strings (e.g. "2.0.15" vs "2.0.4").
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const cleanA = String(a || '0')
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => Number.parseInt(n, 10) || 0);
  const cleanB = String(b || '0')
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => Number.parseInt(n, 10) || 0);

  const maxLen = Math.max(cleanA.length, cleanB.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const numA = cleanA[i] ?? 0;
    const numB = cleanB[i] ?? 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

/**
 * Resolve version.json URL from build-time VITE_GITHUB_REPO or configured apkDownloadUrl.
 */
export function resolveVersionJsonUrl(apkDownloadUrl?: string): string | null {
  const explicitUrl = (import.meta.env.VITE_UPDATE_MANIFEST_URL as string | undefined)?.trim();
  if (explicitUrl && /^https?:\/\//i.test(explicitUrl)) {
    return explicitUrl;
  }

  let repo = DEFAULT_GITHUB_REPO;

  if (!repo && apkDownloadUrl) {
    const match = apkDownloadUrl.match(/github\.com\/([^/]+\/[^/]+)/i);
    if (match?.[1]) {
      repo = match[1].replace(/\.git$/i, '');
    }
  }

  if (repo) {
    return `https://github.com/${repo}/releases/latest/download/version.json`;
  }

  return null;
}

/**
 * Silently checks GitHub Releases Latest `version.json?t=...` for an available OTA or APK update.
 * Never throws or shows intrusive errors when offline or on Web Preview.
 */
export async function checkForAppUpdate(options?: {
  apkDownloadUrl?: string;
  silent?: boolean;
}): Promise<UpdateCheckResult> {
  const currentVersion = getInstalledAppVersion();
  const isNative = isNativePlatformSafe();

  // On Web/Preview, skip silent background checks to avoid cross-origin CORS console noise
  if (options?.silent && !isNative) {
    return {
      hasUpdate: false,
      requiresNativeApk: false,
      currentVersion,
      manifest: null,
    };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      hasUpdate: false,
      requiresNativeApk: false,
      currentVersion,
      manifest: null,
      error: options?.silent ? undefined : 'لا يوجد اتصال بالإنترنت حالياً.',
    };
  }

  const baseUrl = resolveVersionJsonUrl(options?.apkDownloadUrl);
  if (!baseUrl) {
    return {
      hasUpdate: false,
      requiresNativeApk: false,
      currentVersion,
      manifest: null,
      error: options?.silent
        ? undefined
        : isNative
          ? 'رابط خادم التحديثات غير مُعدّ بعد في الإصدار الحالي.'
          : undefined,
    };
  }

  // On non-native web preview, direct github.com release download URLs are blocked by CORS
  if (!isNative && /^https?:\/\/github\.com\//i.test(baseUrl)) {
    return {
      hasUpdate: false,
      requiresNativeApk: false,
      currentVersion,
      manifest: null,
      error: options?.silent
        ? undefined
        : 'التحديث الخفيف (OTA) يعمل تلقائياً داخل تطبيق الأندرويد المثبت على الهاتف.',
    };
  }

  const sep = baseUrl.includes('?') ? '&' : '?';
  const manifestUrl = `${baseUrl}${sep}t=${Date.now()}`;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(manifestUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        hasUpdate: false,
        requiresNativeApk: false,
        currentVersion,
        manifest: null,
        error: options?.silent ? undefined : `تعذر الوصول لملف التحديث (HTTP ${response.status})`,
      };
    }

    const raw = (await response.json()) as Partial<AppUpdateManifest>;
    const remoteVersion = String(raw.version || '').trim();
    if (!remoteVersion) {
      return {
        hasUpdate: false,
        requiresNativeApk: false,
        currentVersion,
        manifest: null,
        error: options?.silent ? undefined : 'ملف التحديث غير مكتمل.',
      };
    }

    const manifest: AppUpdateManifest = {
      version: remoteVersion,
      sizeMb: typeof raw.sizeMb === 'number' ? raw.sizeMb : Number(raw.sizeMb) || undefined,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      otaUrl: typeof raw.otaUrl === 'string' ? raw.otaUrl : undefined,
      apkUrl: typeof raw.apkUrl === 'string' ? raw.apkUrl : options?.apkDownloadUrl || undefined,
      minNativeVersion:
        typeof raw.minNativeVersion === 'string' ? raw.minNativeVersion : undefined,
      publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : undefined,
    };

    const hasUpdate = compareVersions(remoteVersion, currentVersion) > 0;
    const requiresNativeApk = Boolean(
      manifest.minNativeVersion &&
        compareVersions(manifest.minNativeVersion, NATIVE_APP_VERSION) > 0
    );

    return {
      hasUpdate,
      requiresNativeApk,
      currentVersion,
      manifest: hasUpdate ? manifest : null,
    };
  } catch {
    return {
      hasUpdate: false,
      requiresNativeApk: false,
      currentVersion,
      manifest: null,
      error: options?.silent ? undefined : 'تعذر التحقق من التحديثات حالياً — حاول لاحقاً.',
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Downloads and applies a lightweight OTA bundle via @capgo/capacitor-updater
 * with live 0%–100% progress reporting, OR opens the direct APK URL if a native update is required.
 */
export async function downloadAndApplyAppUpdate(
  manifest: AppUpdateManifest,
  requiresNativeApk: boolean,
  onProgress: (percent: number) => void
): Promise<{ ok: boolean; mode: 'ota' | 'apk' | 'web'; message?: string }> {
  const isNative = isNativePlatformSafe();

  // 1. If a newer native Android APK is required (or running outside native Android)
  if (requiresNativeApk || !isNative) {
    if (manifest.apkUrl && /^https?:\/\//i.test(manifest.apkUrl)) {
      onProgress(100);
      window.location.href = manifest.apkUrl;
      return { ok: true, mode: 'apk' };
    }
    if (!isNative) {
      onProgress(100);
      window.location.reload();
      return { ok: true, mode: 'web' };
    }
    return {
      ok: false,
      mode: 'apk',
      message: 'رابط ملف التحديث APK غير متوفر حالياً.',
    };
  }

  // 2. Native Android Lightweight OTA Download & Apply via lazy-loaded @capgo/capacitor-updater
  if (!manifest.otaUrl || !/^https?:\/\//i.test(manifest.otaUrl)) {
    if (manifest.apkUrl && /^https?:\/\//i.test(manifest.apkUrl)) {
      window.location.href = manifest.apkUrl;
      return { ok: true, mode: 'apk' };
    }
    return {
      ok: false,
      mode: 'ota',
      message: 'رابط حزمة التحديث الخفيف (update.zip) غير متوفر.',
    };
  }

  const updater = await loadNativeCapacitorUpdater();
  if (!updater) {
    return {
      ok: false,
      mode: 'ota',
      message: 'مكوّن التحديث الخفيف غير متوفر في هذه البيئة.',
    };
  }

  let listenerHandle: { remove: () => Promise<void> } | null = null;
  try {
    onProgress(5);
    listenerHandle = await updater.addListener('download', (info) => {
      const pct = Math.max(5, Math.min(99, Math.round(Number(info?.percent) || 0)));
      onProgress(pct);
    });

    const bundle = await updater.download({
      url: manifest.otaUrl,
      version: manifest.version,
    });

    onProgress(100);
    try {
      localStorage.setItem(APPLIED_OTA_VERSION_KEY, manifest.version);
    } catch {
      // ignore storage errors
    }

    await updater.set(bundle);
    return { ok: true, mode: 'ota' };
  } catch (err) {
    const errMsg =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'تعذر تحميل التحديث الخفيف حالياً.';
    return { ok: false, mode: 'ota', message: errMsg };
  } finally {
    if (listenerHandle) {
      await listenerHandle.remove().catch(() => {});
    }
  }
}
