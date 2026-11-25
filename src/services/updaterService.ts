import { Capacitor, CapacitorHttp } from '@capacitor/core';

export interface AppUpdateManifest {
  version: string;
  buildNumber?: number;
  sizeMb?: number;
  notes?: string;
  bundleUrl?: string;
  otaUrl?: string;
  apkUrl?: string;
  minNativeVersion?: string;
  publishedAt?: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  requiresNativeApk: boolean;
  currentVersion: string;
  currentBuildNumber: number;
  manifest: AppUpdateManifest | null;
  error?: string;
}

export const APP_CURRENT_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || '2.0.0';

export const NATIVE_APP_VERSION =
  (import.meta.env.VITE_NATIVE_VERSION as string | undefined)?.trim() || APP_CURRENT_VERSION;

export const APP_BUILD_NUMBER =
  Number.parseInt(String(import.meta.env.VITE_APP_BUILD_NUMBER || '0').trim(), 10) || 0;

const DEFAULT_GITHUB_REPO =
  (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.trim() || '';

const APPLIED_OTA_VERSION_KEY = 'taibah_applied_ota_version_v1';
const APPLIED_OTA_BUILD_NUMBER_KEY = 'taibah_applied_ota_build_number_v1';
const UPDATE_SNOOZE_LOCAL_KEY = 'taibah_update_snooze_v1';
const UPDATE_SNOOZE_SESSION_KEY = 'taibah_update_snooze_session_v1';

/**
 * Remember that the user clicked "لاحقاً" so the modal does not reappear
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

let updaterReadyCalled = false;

/**
 * Must be called immediately on native app startup so @capgo/capacitor-updater
 * confirms the active bundle loaded cleanly and never rolls it back.
 * Strictly skipped on Web / Preview to prevent browser-side plugin errors.
 */
export function notifyUpdaterReady(): void {
  if (updaterReadyCalled || !isNativePlatformSafe()) return;
  updaterReadyCalled = true;
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

export function getInstalledBuildNumber(): number {
  let baseBuild = APP_BUILD_NUMBER;
  if (baseBuild <= 0) {
    const parts = APP_CURRENT_VERSION.replace(/^v/i, '').split(/[^\d]+/).filter(Boolean);
    if (parts.length >= 3) {
      baseBuild = Number.parseInt(parts[2], 10) || 0;
    }
  }
  try {
    const appliedBuild = Number.parseInt(
      localStorage.getItem(APPLIED_OTA_BUILD_NUMBER_KEY) || '0',
      10
    );
    if (appliedBuild > baseBuild) {
      return appliedBuild;
    }
  } catch {
    // ignore
  }
  return baseBuild;
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

export function resolveGitHubRepo(apkDownloadUrl?: string): string | null {
  if (DEFAULT_GITHUB_REPO && /^[^/\s]+\/[^/\s]+$/.test(DEFAULT_GITHUB_REPO)) {
    return DEFAULT_GITHUB_REPO;
  }
  if (apkDownloadUrl) {
    const match = apkDownloadUrl.match(/github\.com\/([^/\s]+\/[^/\s]+)/i);
    if (match?.[1]) {
      return match[1].replace(/\.git$/i, '');
    }
  }
  return null;
}

/**
 * Resolve version.json direct URL from explicit env var or GitHub repo.
 */
export function resolveVersionJsonUrl(apkDownloadUrl?: string): string | null {
  const explicitUrl = (import.meta.env.VITE_UPDATE_MANIFEST_URL as string | undefined)?.trim();
  if (explicitUrl && /^https?:\/\//i.test(explicitUrl)) {
    return explicitUrl;
  }
  const repo = resolveGitHubRepo(apkDownloadUrl);
  if (repo) {
    return `https://github.com/${repo}/releases/latest/download/version.json`;
  }
  return null;
}

interface HttpJsonResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

/**
 * Cross-platform JSON GET helper:
 * - On Native Android: uses `CapacitorHttp.get` (bypasses WebView CORS and follows GitHub redirects natively!).
 * - On Web: uses standard `fetch` with abort timeout.
 */
async function httpGetJson<T>(url: string, timeoutMs = 9500): Promise<HttpJsonResponse<T>> {
  const isNative = isNativePlatformSafe();

  if (isNative) {
    try {
      const response = await CapacitorHttp.get({
        url,
        headers: {
          Accept: 'application/vnd.github+json, application/json',
          'Cache-Control': 'no-cache',
        },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });

      const status = Number(response?.status || 0);
      if (status < 200 || status >= 300) {
        return { ok: false, status, data: null };
      }

      let parsed: T | null = null;
      if (typeof response.data === 'string') {
        parsed = JSON.parse(response.data) as T;
      } else if (response.data && typeof response.data === 'object') {
        parsed = response.data as T;
      }
      return { ok: Boolean(parsed), status, data: parsed };
    } catch {
      // Fall through to fetch below just in case
    }
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json, application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    window.clearTimeout(timer);
  }
}

interface GitHubReleaseAsset {
  name?: string;
  size?: number;
  browser_download_url?: string;
}

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

function parseManifestObject(
  raw: Partial<AppUpdateManifest>,
  fallbackApkUrl?: string,
  fallbackBundleUrl?: string
): AppUpdateManifest | null {
  const remoteVersion = String(raw.version || '').trim();
  if (!remoteVersion) return null;

  const parsedBuild =
    typeof raw.buildNumber === 'number'
      ? raw.buildNumber
      : Number.parseInt(String(raw.buildNumber || '0'), 10) || 0;

  const resolvedBundleUrl =
    (typeof raw.bundleUrl === 'string' && raw.bundleUrl.trim()) ||
    (typeof raw.otaUrl === 'string' && raw.otaUrl.trim()) ||
    fallbackBundleUrl ||
    undefined;

  const resolvedApkUrl =
    (typeof raw.apkUrl === 'string' && raw.apkUrl.trim()) || fallbackApkUrl || undefined;

  return {
    version: remoteVersion,
    buildNumber: parsedBuild > 0 ? parsedBuild : undefined,
    sizeMb: typeof raw.sizeMb === 'number' ? raw.sizeMb : Number(raw.sizeMb) || undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    bundleUrl: resolvedBundleUrl,
    otaUrl: resolvedBundleUrl,
    apkUrl: resolvedApkUrl,
    minNativeVersion:
      typeof raw.minNativeVersion === 'string' ? raw.minNativeVersion : undefined,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : undefined,
  };
}

function extractVersionFromReleaseBody(body?: string, tagName?: string): string {
  const text = `${body || ''} ${tagName || ''}`;
  const semverMatch = text.match(/(\d+\.\d+\.\d+)/);
  if (semverMatch?.[1]) return semverMatch[1];
  return String(tagName || '').replace(/^v/i, '').trim();
}

/**
 * Checks GitHub Releases Latest API + `version.json` using `CapacitorHttp.get` on Android
 * (zero CORS issues) and `fetch` on Web. Works for ALL users (Admin, Agent, Client).
 */
export async function checkForAppUpdate(options?: {
  apkDownloadUrl?: string;
  silent?: boolean;
}): Promise<UpdateCheckResult> {
  const currentVersion = getInstalledAppVersion();
  const currentBuildNumber = getInstalledBuildNumber();
  const isNative = isNativePlatformSafe();

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      hasUpdate: false,
      requiresNativeApk: false,
      currentVersion,
      currentBuildNumber,
      manifest: null,
      error: options?.silent ? undefined : 'لا يوجد اتصال بالإنترنت حالياً.',
    };
  }

  const explicitManifestUrl = (
    import.meta.env.VITE_UPDATE_MANIFEST_URL as string | undefined
  )?.trim();
  const repo = resolveGitHubRepo(options?.apkDownloadUrl);
  const fallbackVersionUrl = resolveVersionJsonUrl(options?.apkDownloadUrl);

  if (!explicitManifestUrl && !repo && !fallbackVersionUrl) {
    return {
      hasUpdate: false,
      requiresNativeApk: false,
      currentVersion,
      currentBuildNumber,
      manifest: null,
      error: options?.silent
        ? undefined
        : 'رابط سيرفر التحديثات غير مُعدّ بعد في هذا الإصدار.',
    };
  }

  let manifest: AppUpdateManifest | null = null;
  let lastHttpStatus = 0;

  try {
    // Strategy 1: Explicit custom manifest URL (if set via env)
    if (explicitManifestUrl && /^https?:\/\//i.test(explicitManifestUrl)) {
      const sep = explicitManifestUrl.includes('?') ? '&' : '?';
      const res = await httpGetJson<Partial<AppUpdateManifest>>(
        `${explicitManifestUrl}${sep}t=${Date.now()}`
      );
      lastHttpStatus = res.status;
      if (res.ok && res.data) {
        manifest = parseManifestObject(res.data, options?.apkDownloadUrl);
      }
    }

    // Strategy 2: GitHub Releases Latest API (works on Native Android via CapacitorHttp AND on Web with full CORS!)
    if (!manifest && repo) {
      const releaseApiUrl = `https://api.github.com/repos/${repo}/releases/latest?t=${Date.now()}`;
      const releaseRes = await httpGetJson<GitHubReleasePayload>(releaseApiUrl);
      lastHttpStatus = releaseRes.status;

      if (releaseRes.ok && releaseRes.data) {
        const assets = Array.isArray(releaseRes.data.assets) ? releaseRes.data.assets : [];
        const versionAsset = assets.find((a) => a.name?.toLowerCase() === 'version.json');
        const zipAsset = assets.find((a) => a.name?.toLowerCase() === 'update.zip');
        const apkAsset = assets.find((a) => a.name?.toLowerCase().endsWith('.apk'));

        const fallbackBundleUrl =
          zipAsset?.browser_download_url ||
          `https://github.com/${repo}/releases/latest/download/update.zip`;
        const fallbackApkUrl =
          apkAsset?.browser_download_url ||
          options?.apkDownloadUrl ||
          `https://github.com/${repo}/releases/latest/download/TaibahNet-Cards.apk`;

        // On Native Android, CapacitorHttp follows GitHub redirects to objects.githubusercontent.com with zero CORS blocks
        if (isNative && versionAsset?.browser_download_url) {
          const sep = versionAsset.browser_download_url.includes('?') ? '&' : '?';
          const verRes = await httpGetJson<Partial<AppUpdateManifest>>(
            `${versionAsset.browser_download_url}${sep}t=${Date.now()}`
          );
          if (verRes.ok && verRes.data) {
            manifest = parseManifestObject(verRes.data, fallbackApkUrl, fallbackBundleUrl);
          }
        }

        // Fallback to release metadata if version.json couldn't be fetched (e.g. Web CORS on release download asset)
        if (!manifest) {
          const derivedVersion = extractVersionFromReleaseBody(
            releaseRes.data.body,
            releaseRes.data.tag_name
          );
          if (derivedVersion && /\d+\.\d+/.test(derivedVersion)) {
            const parts = derivedVersion.split('.');
            const derivedBuild = Number.parseInt(parts[2] || '0', 10) || 0;
            const sizeMb = zipAsset?.size
              ? Math.round((zipAsset.size / (1024 * 1024)) * 100) / 100
              : apkAsset?.size
                ? Math.round((apkAsset.size / (1024 * 1024)) * 100) / 100
                : undefined;

            manifest = {
              version: derivedVersion,
              buildNumber: derivedBuild > 0 ? derivedBuild : undefined,
              sizeMb,
              notes:
                'تحديث جديد لتطبيق كروت طيبة نت — تحسينات الأداء والأمان وتجربة الاستخدام.',
              bundleUrl: fallbackBundleUrl,
              otaUrl: fallbackBundleUrl,
              apkUrl: fallbackApkUrl,
              minNativeVersion: '2.0.0',
              publishedAt: releaseRes.data.published_at,
            };
          }
        }
      }
    }

    // Strategy 3: Direct version.json via CapacitorHttp on Native Android (if GitHub API rate-limited)
    if (!manifest && isNative && fallbackVersionUrl) {
      const sep = fallbackVersionUrl.includes('?') ? '&' : '?';
      const directRes = await httpGetJson<Partial<AppUpdateManifest>>(
        `${fallbackVersionUrl}${sep}t=${Date.now()}`
      );
      lastHttpStatus = directRes.status || lastHttpStatus;
      if (directRes.ok && directRes.data) {
        manifest = parseManifestObject(directRes.data, options?.apkDownloadUrl);
      }
    }

    if (!manifest) {
      return {
        hasUpdate: false,
        requiresNativeApk: false,
        currentVersion,
        currentBuildNumber,
        manifest: null,
        error: options?.silent
          ? undefined
          : lastHttpStatus > 0
            ? `تعذر الاتصال بسيرفر التحديثات (رمز ${lastHttpStatus})`
            : 'تعذر الاتصال بسيرفر التحديثات — تحقق من اتصال الإنترنت وحاول مجدداً.',
      };
    }

    const remoteBuild = manifest.buildNumber || 0;
    const isNewerByBuild =
      remoteBuild > 0 && currentBuildNumber > 0 && remoteBuild > currentBuildNumber;
    const isNewerBySemver = compareVersions(manifest.version, currentVersion) > 0;
    const hasUpdate = isNewerByBuild || isNewerBySemver;

    const requiresNativeApk = Boolean(
      manifest.minNativeVersion &&
        compareVersions(manifest.minNativeVersion, NATIVE_APP_VERSION) > 0
    );

    return {
      hasUpdate,
      requiresNativeApk,
      currentVersion,
      currentBuildNumber,
      manifest: hasUpdate ? manifest : null,
    };
  } catch {
    return {
      hasUpdate: false,
      requiresNativeApk: false,
      currentVersion,
      currentBuildNumber,
      manifest: null,
      error: options?.silent
        ? undefined
        : 'تعذر الاتصال بسيرفر التحديثات — حاول مرة أخرى لاحقاً.',
    };
  }
}

/**
 * Downloads and applies a lightweight OTA bundle via @capgo/capacitor-updater
 * with live 0%–100% progress reporting, OR opens the direct APK URL if a native update is required
 * or if OTA fails and an APK download link is available.
 */
export async function downloadAndApplyAppUpdate(
  manifest: AppUpdateManifest,
  requiresNativeApk: boolean,
  onProgress: (percent: number) => void
): Promise<{ ok: boolean; mode: 'ota' | 'apk' | 'web'; message?: string }> {
  const isNative = isNativePlatformSafe();
  const otaDownloadUrl = manifest.bundleUrl || manifest.otaUrl;

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
  if (!otaDownloadUrl || !/^https?:\/\//i.test(otaDownloadUrl)) {
    if (manifest.apkUrl && /^https?:\/\//i.test(manifest.apkUrl)) {
      onProgress(100);
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
    if (manifest.apkUrl && /^https?:\/\//i.test(manifest.apkUrl)) {
      onProgress(100);
      window.location.href = manifest.apkUrl;
      return { ok: true, mode: 'apk' };
    }
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
      url: otaDownloadUrl,
      version: manifest.version,
    });

    onProgress(100);
    try {
      localStorage.setItem(APPLIED_OTA_VERSION_KEY, manifest.version);
      if (manifest.buildNumber && manifest.buildNumber > 0) {
        localStorage.setItem(APPLIED_OTA_BUILD_NUMBER_KEY, String(manifest.buildNumber));
      }
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
