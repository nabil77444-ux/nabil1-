import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

declare const __APP_BUILD_NUMBER__: number | undefined;
declare const __APP_NATIVE_VERSION__: string | undefined;

interface TaibahUpdateNotifierNativePlugin {
  configure(options: {
    currentBuildNumber: number;
    versionJsonUrl: string;
    checkNow?: boolean;
  }): Promise<{ scheduled?: boolean }>;
  requestNotificationPermission(): Promise<{ granted?: boolean }>;
  checkPendingUpdateIntent(): Promise<{ openUpdateDialog?: boolean }>;
  clearUpdateNotification(options?: { buildNumber?: number }): Promise<{ cleared?: boolean }>;
  addListener(
    eventName: 'openUpdateDialog',
    listenerFunc: (data: { openUpdateDialog?: boolean }) => void
  ): Promise<PluginListenerHandle>;
}

const TaibahUpdateNotifier = registerPlugin<TaibahUpdateNotifierNativePlugin>(
  'TaibahUpdateNotifier'
);

export interface AppUpdateManifest {
  version: string;
  buildNumber?: number;
  nativeVersion?: string;
  minNativeVersion?: string;
  updateSizeBytes?: number;
  updateSizeText?: string;
  sizeMb?: number;
  notes?: string;
  bundleUrl?: string;
  otaUrl?: string;
  apkUrl?: string;
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
  (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || '2.1.0';

export const NATIVE_APP_VERSION =
  (typeof __APP_NATIVE_VERSION__ !== 'undefined' && __APP_NATIVE_VERSION__) ||
  (import.meta.env.VITE_NATIVE_VERSION as string | undefined)?.trim() ||
  '2.1.0';

export const APP_BUILD_NUMBER =
  (typeof __APP_BUILD_NUMBER__ === 'number' && __APP_BUILD_NUMBER__ > 0
    ? __APP_BUILD_NUMBER__
    : 0) ||
  Number.parseInt(String(import.meta.env.VITE_APP_BUILD_NUMBER || '0').trim(), 10) ||
  0;

const DEFAULT_GITHUB_REPO =
  (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.trim() || '';

const APPLIED_OTA_VERSION_KEY = 'taibah_applied_ota_version_v1';
const APPLIED_OTA_BUILD_NUMBER_KEY = 'taibah_applied_ota_build_number_v1';
const UPDATE_SNOOZE_LOCAL_KEY = 'taibah_update_snooze_v1';
const UPDATE_SNOOZE_SESSION_KEY = 'taibah_update_snooze_session_v1';
const NOTIF_PERMISSION_ASKED_KEY = 'taibah_notif_perm_asked_v1';
const DEFERRED_UPDATE_EVENT = 'taibah:deferred-update-changed';

export function formatUpdateSizeAr(bytes?: number, fallbackMb?: number): string {
  if (typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0) {
    if (bytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
  }
  if (typeof fallbackMb === 'number' && Number.isFinite(fallbackMb) && fallbackMb > 0) {
    if (fallbackMb < 1) {
      return `${Math.max(1, Math.round(fallbackMb * 1024))} كيلوبايت`;
    }
    return `${fallbackMb.toFixed(1)} ميجابايت`;
  }
  return 'خفيف جداً';
}

export function resolveManifestSizeText(manifest: AppUpdateManifest): string {
  if (manifest.updateSizeText && manifest.updateSizeText.trim()) {
    return manifest.updateSizeText.trim();
  }
  return formatUpdateSizeAr(manifest.updateSizeBytes, manifest.sizeMb);
}

/**
 * Remember that the user clicked "لاحقاً" so the modal does not reappear
 * repeatedly during the current running session, while still showing a small
 * indicator dot on the Settings icon and reminding them on next cold start.
 */
export function saveUpdateSnooze(version: string, buildNumber?: number): void {
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
      JSON.stringify({ version: clean, buildNumber: buildNumber || 0, snoozedAt: Date.now() })
    );
    window.dispatchEvent(new CustomEvent(DEFERRED_UPDATE_EVENT));
  } catch {
    // ignore
  }
}

export function clearUpdateSnooze(): void {
  try {
    window.sessionStorage.removeItem(UPDATE_SNOOZE_SESSION_KEY);
    window.localStorage.removeItem(UPDATE_SNOOZE_LOCAL_KEY);
    window.dispatchEvent(new CustomEvent(DEFERRED_UPDATE_EVENT));
  } catch {
    // ignore
  }
}

export function hasDeferredUpdate(): boolean {
  try {
    const raw = window.localStorage.getItem(UPDATE_SNOOZE_LOCAL_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { version?: string; buildNumber?: number };
    const currentBuild = getInstalledBuildNumber();
    const currentVer = getInstalledAppVersion();
    if (parsed.buildNumber && currentBuild > 0 && parsed.buildNumber > currentBuild) {
      return true;
    }
    if (parsed.version && compareVersions(parsed.version, currentVer) > 0) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function subscribeDeferredUpdateChanges(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(DEFERRED_UPDATE_EVENT, callback);
  return () => window.removeEventListener(DEFERRED_UPDATE_EVENT, callback);
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

/**
 * Configure native Android WorkManager background update checker (every 2 hours + immediate)
 * so users receive a real system status bar notification even when the app is closed.
 */
export async function configureNativeUpdateNotifier(
  apkDownloadUrl?: string,
  checkNow = false
): Promise<void> {
  if (!isNativePlatformSafe()) return;
  const versionJsonUrl = resolveVersionJsonUrl(apkDownloadUrl);
  if (!versionJsonUrl) return;
  try {
    await TaibahUpdateNotifier.configure({
      currentBuildNumber: getInstalledBuildNumber(),
      versionJsonUrl,
      checkNow,
    });
  } catch {
    // Non-fatal on older builds without native plugin
  }
}

/**
 * Gently request Android 13+ POST_NOTIFICATIONS permission once after first login.
 */
export async function requestNativeNotificationPermissionOnce(): Promise<boolean> {
  if (!isNativePlatformSafe()) return false;
  try {
    if (localStorage.getItem(NOTIF_PERMISSION_ASKED_KEY) === '1') {
      return true;
    }
    localStorage.setItem(NOTIF_PERMISSION_ASKED_KEY, '1');
    const res = await TaibahUpdateNotifier.requestNotificationPermission();
    return Boolean(res?.granted);
  } catch {
    return false;
  }
}

/**
 * Check if MainActivity was launched from the native update notification (`OPEN_UPDATE_DIALOG=true`).
 */
export async function consumePendingUpdateDialogIntent(): Promise<boolean> {
  if (!isNativePlatformSafe()) return false;
  try {
    const res = await TaibahUpdateNotifier.checkPendingUpdateIntent();
    return Boolean(res?.openUpdateDialog);
  } catch {
    return false;
  }
}

/**
 * Listen for taps on the native status bar update notification while the app is already running.
 */
export async function listenForUpdateDialogIntent(
  onTrigger: () => void
): Promise<(() => void) | null> {
  if (!isNativePlatformSafe()) return null;
  try {
    const handle = await TaibahUpdateNotifier.addListener('openUpdateDialog', (data) => {
      if (data?.openUpdateDialog) {
        onTrigger();
      }
    });
    return () => {
      void handle.remove().catch(() => {});
    };
  } catch {
    return null;
  }
}

export async function clearNativeUpdateNotification(buildNumber?: number): Promise<void> {
  if (!isNativePlatformSafe()) return;
  try {
    await TaibahUpdateNotifier.clearUpdateNotification({ buildNumber: buildNumber || 0 });
  } catch {
    // Non-fatal
  }
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
 * Compare semantic version strings (e.g. "2.1.15" vs "2.1.4").
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
      // Fall through to fetch below
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
  fallbackBundleUrl?: string,
  fallbackBytes?: number
): AppUpdateManifest | null {
  const remoteVersion = String(raw.version || '').trim();
  if (!remoteVersion) return null;

  const parsedBuild =
    typeof raw.buildNumber === 'number'
      ? raw.buildNumber
      : Number.parseInt(String(raw.buildNumber || '0'), 10) || 0;

  const resolvedBytes =
    typeof raw.updateSizeBytes === 'number' && raw.updateSizeBytes > 0
      ? raw.updateSizeBytes
      : typeof fallbackBytes === 'number' && fallbackBytes > 0
        ? fallbackBytes
        : undefined;

  const resolvedSizeMb =
    typeof raw.sizeMb === 'number' && raw.sizeMb > 0
      ? raw.sizeMb
      : resolvedBytes
        ? Math.round((resolvedBytes / (1024 * 1024)) * 100) / 100
        : Number(raw.sizeMb) || undefined;

  const resolvedSizeText =
    (typeof raw.updateSizeText === 'string' && raw.updateSizeText.trim()) ||
    formatUpdateSizeAr(resolvedBytes, resolvedSizeMb);

  const resolvedBundleUrl =
    (typeof raw.bundleUrl === 'string' && raw.bundleUrl.trim()) ||
    (typeof raw.otaUrl === 'string' && raw.otaUrl.trim()) ||
    fallbackBundleUrl ||
    undefined;

  const resolvedApkUrl =
    (typeof raw.apkUrl === 'string' && raw.apkUrl.trim()) || fallbackApkUrl || undefined;

  const resolvedNativeVersion =
    (typeof raw.nativeVersion === 'string' && raw.nativeVersion.trim()) ||
    (typeof raw.minNativeVersion === 'string' && raw.minNativeVersion.trim()) ||
    undefined;

  return {
    version: remoteVersion,
    buildNumber: parsedBuild > 0 ? parsedBuild : undefined,
    nativeVersion: resolvedNativeVersion,
    minNativeVersion:
      typeof raw.minNativeVersion === 'string' ? raw.minNativeVersion : resolvedNativeVersion,
    updateSizeBytes: resolvedBytes,
    updateSizeText: resolvedSizeText,
    sizeMb: resolvedSizeMb,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    bundleUrl: resolvedBundleUrl,
    otaUrl: resolvedBundleUrl,
    apkUrl: resolvedApkUrl,
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
 * Checks `version.json` & GitHub Releases Latest API via `CapacitorHttp.get` on Android
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
    // Strategy 1: Explicit custom manifest URL
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

    // Strategy 2: Direct version.json via CapacitorHttp on Native Android (fastest, ~300 bytes, zero API rate limits)
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

    // Strategy 3: GitHub Releases Latest API (Web CORS-friendly + Native fallback)
    if (!manifest && repo) {
      const releaseApiUrl = `https://api.github.com/repos/${repo}/releases/latest?t=${Date.now()}`;
      const releaseRes = await httpGetJson<GitHubReleasePayload>(releaseApiUrl);
      lastHttpStatus = releaseRes.status || lastHttpStatus;

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

        if (isNative && versionAsset?.browser_download_url) {
          const sep = versionAsset.browser_download_url.includes('?') ? '&' : '?';
          const verRes = await httpGetJson<Partial<AppUpdateManifest>>(
            `${versionAsset.browser_download_url}${sep}t=${Date.now()}`
          );
          if (verRes.ok && verRes.data) {
            manifest = parseManifestObject(
              verRes.data,
              fallbackApkUrl,
              fallbackBundleUrl,
              zipAsset?.size
            );
          }
        }

        if (!manifest) {
          const derivedVersion = extractVersionFromReleaseBody(
            releaseRes.data.body,
            releaseRes.data.tag_name
          );
          if (derivedVersion && /\d+\.\d+/.test(derivedVersion)) {
            const parts = derivedVersion.split('.');
            const derivedBuild = Number.parseInt(parts[2] || '0', 10) || 0;
            const bytes = zipAsset?.size || undefined;
            const sizeMb = bytes
              ? Math.round((bytes / (1024 * 1024)) * 100) / 100
              : undefined;

            manifest = {
              version: derivedVersion,
              buildNumber: derivedBuild > 0 ? derivedBuild : undefined,
              nativeVersion: NATIVE_APP_VERSION,
              minNativeVersion: NATIVE_APP_VERSION,
              updateSizeBytes: bytes,
              updateSizeText: formatUpdateSizeAr(bytes, sizeMb),
              sizeMb,
              notes:
                'تحديث خفيف وسريع لتطبيق كروت طيبة نت — تحسينات الأداء والأمان وتجربة الاستخدام.',
              bundleUrl: fallbackBundleUrl,
              otaUrl: fallbackBundleUrl,
              apkUrl: fallbackApkUrl,
              publishedAt: releaseRes.data.published_at,
            };
          }
        }
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

    // Only request full APK download in the rare case that native Android code version actually increased
    const targetNativeVer = manifest.nativeVersion || manifest.minNativeVersion;
    const requiresNativeApk = Boolean(
      targetNativeVer && compareVersions(targetNativeVer, NATIVE_APP_VERSION) > 0
    );

    if (!hasUpdate) {
      clearUpdateSnooze();
    }

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
 * Downloads and applies the lightweight OTA `update.zip` bundle via @capgo/capacitor-updater
 * with live 0%–100% progress reporting, updates local buildNumber, and clears the system notification.
 * Only downloads the full APK if `requiresNativeApk` is true.
 */
export async function downloadAndApplyAppUpdate(
  manifest: AppUpdateManifest,
  requiresNativeApk: boolean,
  onProgress: (percent: number) => void
): Promise<{ ok: boolean; mode: 'ota' | 'apk' | 'web'; message?: string }> {
  const isNative = isNativePlatformSafe();
  const otaDownloadUrl = manifest.bundleUrl || manifest.otaUrl;

  if (requiresNativeApk || !isNative) {
    if (manifest.apkUrl && /^https?:\/\//i.test(manifest.apkUrl)) {
      onProgress(100);
      clearUpdateSnooze();
      window.location.href = manifest.apkUrl;
      return { ok: true, mode: 'apk' };
    }
    if (!isNative) {
      onProgress(100);
      clearUpdateSnooze();
      window.location.reload();
      return { ok: true, mode: 'web' };
    }
    return {
      ok: false,
      mode: 'apk',
      message: 'رابط ملف التحديث APK غير متوفر حالياً.',
    };
  }

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

    clearUpdateSnooze();
    await clearNativeUpdateNotification(manifest.buildNumber);
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
