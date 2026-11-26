import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

declare const __APP_BUILD_NUMBER__: number | undefined;
declare const __APP_NATIVE_VERSION__: string | undefined;
declare const __GITHUB_REPO__: string | undefined;

interface TaibahUpdateNotifierNativePlugin {
  getBuildConfig(): Promise<{
    githubRepo?: string;
    appBuildNumber?: number;
    versionJsonUrl?: string;
  }>;
  configure(options: {
    currentBuildNumber: number;
    versionJsonUrl: string;
    checkNow?: boolean;
  }): Promise<{ scheduled?: boolean; githubRepo?: string }>;
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

const COMPILE_TIME_GITHUB_REPO =
  (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.trim() ||
  (typeof __GITHUB_REPO__ !== 'undefined' ? String(__GITHUB_REPO__ || '').trim() : '');

let cachedNativeRepo = '';
let cachedNativeBuildNumber = 0;

const APPLIED_OTA_VERSION_KEY = 'taibah_applied_ota_version_v1';
const APPLIED_OTA_BUILD_NUMBER_KEY = 'taibah_applied_ota_build_number_v1';
const UPDATE_SNOOZE_LOCAL_KEY = 'taibah_update_snooze_v1';
const UPDATE_SNOOZE_SESSION_KEY = 'taibah_update_snooze_session_v1';
const NOTIF_PERMISSION_ASKED_KEY = 'taibah_notif_perm_asked_v1';
const DEFERRED_UPDATE_EVENT = 'taibah:deferred-update-changed';

function isValidRepoSlug(value?: string | null): value is string {
  const clean = String(value || '').trim();
  if (!clean) return false;
  if (clean.includes('<') || clean.includes('>') || clean.includes(' ')) return false;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(clean);
}

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

async function hydrateNativeBuildConfig(): Promise<void> {
  if (!isNativePlatformSafe()) return;
  if (cachedNativeRepo && cachedNativeBuildNumber > 0) return;
  try {
    const res = await TaibahUpdateNotifier.getBuildConfig();
    if (res?.githubRepo && isValidRepoSlug(res.githubRepo)) {
      cachedNativeRepo = res.githubRepo.trim();
    }
    if (typeof res?.appBuildNumber === 'number' && res.appBuildNumber > 0) {
      cachedNativeBuildNumber = res.appBuildNumber;
    }
  } catch {
    // Older native builds without getBuildConfig — ignore cleanly
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
  await hydrateNativeBuildConfig();
  const versionJsonUrl = resolveVersionJsonUrl(apkDownloadUrl) || '';
  try {
    const res = await TaibahUpdateNotifier.configure({
      currentBuildNumber: getInstalledBuildNumber(),
      versionJsonUrl,
      checkNow,
    });
    if (res?.githubRepo && isValidRepoSlug(res.githubRepo)) {
      cachedNativeRepo = res.githubRepo.trim();
    }
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
  let baseBuild = Math.max(APP_BUILD_NUMBER, cachedNativeBuildNumber);
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
  if (isValidRepoSlug(COMPILE_TIME_GITHUB_REPO)) {
    return COMPILE_TIME_GITHUB_REPO;
  }
  if (isValidRepoSlug(cachedNativeRepo)) {
    return cachedNativeRepo;
  }
  if (apkDownloadUrl) {
    const match = apkDownloadUrl.match(/github\.com\/([^/\s]+\/[^/\s]+)/i);
    if (match?.[1]) {
      const cleaned = match[1].replace(/\.git$/i, '').trim();
      if (isValidRepoSlug(cleaned)) {
        return cleaned;
      }
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
          'User-Agent': 'TaibahNet-Android-Updater/2.1',
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
  draft?: boolean;
  prerelease?: boolean;
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
 * Fallback Stage 3: Read lightweight OTA manifest mirror from Firestore (`app_meta/latest_update`).
 */
async function readFirestoreUpdateMirror(
  fallbackApkUrl?: string
): Promise<AppUpdateManifest | null> {
  if (!auth.currentUser) return null;
  try {
    const snap = await getDoc(doc(db, 'app_meta', 'latest_update'));
    if (!snap.exists()) return null;
    const data = snap.data() as Partial<AppUpdateManifest>;
    return parseManifestObject(data, fallbackApkUrl);
  } catch {
    return null;
  }
}

/**
 * Super Admin helper: silently mirror a verified GitHub manifest into Firestore `app_meta/latest_update`
 * so Agents and Clients always have a resilient fallback even if GitHub is rate-limited or unreachable.
 */
async function mirrorManifestToFirestoreSilently(manifest: AppUpdateManifest): Promise<void> {
  if (!auth.currentUser) return;
  try {
    const payload: Record<string, unknown> = {
      version: manifest.version.slice(0, 32),
      updatedAt: serverTimestamp(),
    };
    if (typeof manifest.buildNumber === 'number' && manifest.buildNumber > 0) {
      payload.buildNumber = manifest.buildNumber;
    }
    if (manifest.nativeVersion) payload.nativeVersion = manifest.nativeVersion.slice(0, 32);
    if (manifest.minNativeVersion) payload.minNativeVersion = manifest.minNativeVersion.slice(0, 32);
    if (typeof manifest.updateSizeBytes === 'number' && manifest.updateSizeBytes > 0) {
      payload.updateSizeBytes = manifest.updateSizeBytes;
    }
    if (manifest.updateSizeText) payload.updateSizeText = manifest.updateSizeText.slice(0, 64);
    if (typeof manifest.sizeMb === 'number' && manifest.sizeMb > 0) {
      payload.sizeMb = manifest.sizeMb;
    }
    if (manifest.notes) payload.notes = manifest.notes.slice(0, 600);
    if (manifest.bundleUrl) payload.bundleUrl = manifest.bundleUrl.slice(0, 400);
    if (manifest.otaUrl) payload.otaUrl = manifest.otaUrl.slice(0, 400);
    if (manifest.apkUrl) payload.apkUrl = manifest.apkUrl.slice(0, 400);
    if (manifest.publishedAt) payload.publishedAt = manifest.publishedAt.slice(0, 64);

    await setDoc(doc(db, 'app_meta', 'latest_update'), payload, { merge: false });
  } catch {
    // Non-fatal mirror write
  }
}

/**
 * Multi-stage resilient update checker using `CapacitorHttp.get` on Native Android
 * (zero CORS issues, full cross-domain redirects) and `fetch` on Web:
 *
 * Stage 1 (Primary Fast, Zero API Rate Limit):
 *   Direct `https://github.com/${REPO}/releases/latest/download/version.json?t=...`
 *   (or explicit `VITE_UPDATE_MANIFEST_URL`).
 * Stage 2 (Auto Fallback #1 on 404 / prerelease / Web CORS):
 *   `https://api.github.com/repos/${REPO}/releases?per_page=1&t=...`
 *   (locates `version.json` & `update.zip` even if a release is marked pre-release).
 * Stage 3 (Auto Fallback #2 — Cloud Mirror):
 *   Lightweight Firestore document `app_meta/latest_update`.
 */
export async function checkForAppUpdate(options?: {
  apkDownloadUrl?: string;
  silent?: boolean;
  canMirrorToFirestore?: boolean;
}): Promise<UpdateCheckResult> {
  await hydrateNativeBuildConfig();

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
  const directVersionUrl = resolveVersionJsonUrl(options?.apkDownloadUrl);

  let manifest: AppUpdateManifest | null = null;
  let fetchedFromGitHub = false;
  let lastHttpStatus = 0;

  try {
    // Stage 0: Explicit custom manifest URL (if configured)
    if (explicitManifestUrl && /^https?:\/\//i.test(explicitManifestUrl)) {
      const sep = explicitManifestUrl.includes('?') ? '&' : '?';
      const res = await httpGetJson<Partial<AppUpdateManifest>>(
        `${explicitManifestUrl}${sep}t=${Date.now()}`
      );
      lastHttpStatus = res.status;
      if (res.ok && res.data) {
        manifest = parseManifestObject(res.data, options?.apkDownloadUrl);
        if (manifest) fetchedFromGitHub = true;
      }
    }

    // Stage 1 (Fast Primary, Zero Rate Limit): Direct releases/latest/download/version.json
    if (!manifest && directVersionUrl) {
      const sep = directVersionUrl.includes('?') ? '&' : '?';
      const directRes = await httpGetJson<Partial<AppUpdateManifest>>(
        `${directVersionUrl}${sep}t=${Date.now()}`
      );
      if (directRes.status > 0) lastHttpStatus = directRes.status;
      if (directRes.ok && directRes.data) {
        manifest = parseManifestObject(directRes.data, options?.apkDownloadUrl);
        if (manifest) fetchedFromGitHub = true;
      }
    }

    // Stage 2 (Auto Fallback #1 on 404 / prerelease / Web CORS): GitHub Releases list (?per_page=1)
    if (!manifest && repo) {
      const releasesListUrl = `https://api.github.com/repos/${repo}/releases?per_page=1&t=${Date.now()}`;
      const listRes = await httpGetJson<GitHubReleasePayload[]>(releasesListUrl);
      if (listRes.status > 0) lastHttpStatus = listRes.status;

      const releases = Array.isArray(listRes.data) ? listRes.data : [];
      const latestRelease = releases.find((r) => r && !r.draft) || releases[0];

      if (listRes.ok && latestRelease) {
        const assets = Array.isArray(latestRelease.assets) ? latestRelease.assets : [];
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

        if (versionAsset?.browser_download_url && isNative) {
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
            if (manifest) fetchedFromGitHub = true;
          }
        }

        if (!manifest) {
          const derivedVersion = extractVersionFromReleaseBody(
            latestRelease.body,
            latestRelease.tag_name
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
              publishedAt: latestRelease.published_at,
            };
            fetchedFromGitHub = true;
          }
        }
      }
    }

    // Stage 3 (Auto Fallback #2): Lightweight Firestore Mirror (`app_meta/latest_update`)
    if (!manifest) {
      manifest = await readFirestoreUpdateMirror(options?.apkDownloadUrl);
    }

    // If Super Admin successfully fetched a live manifest from GitHub, update the Firestore mirror silently
    if (manifest && fetchedFromGitHub && options?.canMirrorToFirestore) {
      void mirrorManifestToFirestoreSilently(manifest);
    }

    if (!manifest) {
      let friendlyError: string | undefined;
      if (!options?.silent) {
        if (!explicitManifestUrl && !repo) {
          friendlyError =
            'لم يتم العثور على إصدار منشور بعد — عند بناء التطبيق عبر GitHub Actions سيتم ربط سيرفر التحديثات تلقائياً.';
        } else if (lastHttpStatus === 404) {
          friendlyError =
            'تعذر العثور على ملف التحديث (404) — تأكد من أن مستودع GitHub عام (Public) وأنه تم نشر إصدار رسمي (Release) يحتوي على version.json.';
        } else if (lastHttpStatus === 403 || lastHttpStatus === 429) {
          friendlyError =
            'تم تجاوز حد الطلبات المؤقت لسيرفر التحديثات — يرجى المحاولة مجدداً بعد دقائق.';
        } else if (lastHttpStatus > 0) {
          friendlyError = `تعذر الاتصال بسيرفر التحديثات (رمز ${lastHttpStatus}) — تأكد من اتصال الإنترنت وحاول لاحقاً.`;
        } else {
          friendlyError = 'تعذر الاتصال بسيرفر التحديثات — تحقق من اتصال الإنترنت وحاول مجدداً.';
        }
      }
      return {
        hasUpdate: false,
        requiresNativeApk: false,
        currentVersion,
        currentBuildNumber,
        manifest: null,
        error: friendlyError,
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
        : 'تعذر الاتصال بسيرفر التحديثات — تحقق من اتصال الإنترنت وحاول مرة أخرى لاحقاً.',
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
