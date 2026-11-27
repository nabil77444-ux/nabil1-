import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

declare const __APP_BUILD_NUMBER__: number | undefined;
declare const __APP_NATIVE_VERSION__: string | undefined;
declare const __GITHUB_REPO__: string | undefined;

export interface OtaDownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  speedKbps: number;
  mirrorIndex: number;
  mirrorCount: number;
  mirrorLabel?: string;
  status?: 'downloading' | 'verifying' | 'extracting' | 'applying';
}

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
  downloadAndApplyOta(options: {
    urls: string[];
    url?: string;
    version: string;
    buildNumber?: number;
    expectedBytes?: number;
  }): Promise<{
    applied?: boolean;
    cancelled?: boolean;
    version?: string;
    buildNumber?: number;
    mirrorIndex?: number;
    error?: string;
  }>;
  cancelOtaDownload(): Promise<{ cancelled?: boolean }>;
  addListener(
    eventName: 'openUpdateDialog',
    listenerFunc: (data: { openUpdateDialog?: boolean }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'otaProgress',
    listenerFunc: (data: Partial<OtaDownloadProgress>) => void
  ): Promise<PluginListenerHandle>;
}

const TaibahUpdateNotifier = registerPlugin<TaibahUpdateNotifierNativePlugin>(
  'TaibahUpdateNotifier'
);

export type ReleaseChangeType = 'add' | 'improve' | 'fix' | 'security' | 'remove';

export interface ReleaseChangeItem {
  type: ReleaseChangeType;
  text: string;
}

export interface AppUpdateManifest {
  version: string;
  buildNumber?: number;
  versionCode?: number;
  nativeVersion?: string;
  minNativeVersion?: string;
  updateSizeBytes?: number;
  updateSizeText?: string;
  sizeMb?: number;
  releaseTitle?: string;
  releaseSummary?: string;
  changes?: ReleaseChangeItem[];
  notes?: string;
  bundleUrl?: string;
  otaUrl?: string;
  bundleMirrors?: string[];
  apkUrl?: string;
  publishedAt?: string;
  sourceKey?: 'github_releases' | 'github_raw' | 'jsdelivr' | 'firestore' | 'github_api' | 'custom';
  sourceLabel?: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  requiresNativeApk: boolean;
  currentVersion: string;
  currentBuildNumber: number;
  currentVersionCode: number;
  manifest: AppUpdateManifest | null;
  latestCheckedVersion?: string;
  latestCheckedBuildNumber?: number;
  latestCheckedVersionCode?: number;
  checkedSourceLabel?: string;
  checkedSourcesCount?: number;
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

export function getInstalledVersionCode(): number {
  const build = getInstalledBuildNumber();
  return build > 0 ? 1000 + build : 0;
}

/**
 * Extract numeric version segments (e.g. "v2.1.35" -> [2, 1, 35]).
 */
function parseVersionParts(ver?: string): number[] {
  return String(ver || '0')
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => Number.parseInt(n, 10) || 0);
}

/**
 * Compare semantic version strings (e.g. "2.1.35" vs "2.1.34").
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const cleanA = parseVersionParts(a);
  const cleanB = parseVersionParts(b);

  const maxLen = Math.max(cleanA.length, cleanB.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const numA = cleanA[i] ?? 0;
    const numB = cleanB[i] ?? 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

function resolveEffectiveBuildNumber(manifest: {
  buildNumber?: number;
  versionCode?: number;
  version?: string;
}): number {
  if (typeof manifest.buildNumber === 'number' && manifest.buildNumber > 0) {
    return manifest.buildNumber;
  }
  if (typeof manifest.versionCode === 'number' && manifest.versionCode > 1000) {
    return manifest.versionCode - 1000;
  }
  const parts = parseVersionParts(manifest.version);
  return parts.length >= 3 ? parts[2] || 0 : 0;
}

function resolveEffectiveVersionCode(manifest: {
  buildNumber?: number;
  versionCode?: number;
  version?: string;
}): number {
  if (typeof manifest.versionCode === 'number' && manifest.versionCode > 0) {
    return manifest.versionCode;
  }
  const build = resolveEffectiveBuildNumber(manifest);
  return build > 0 ? 1000 + build : 0;
}

/**
 * Accurate release comparison: returns true if remote release is strictly newer than current
 * by `buildNumber` OR `versionCode` OR numeric semantic `version` parts ([2,1,35] > [2,1,34]).
 */
export function isNewerRelease(
  remote: { version?: string; buildNumber?: number; versionCode?: number },
  current: { version: string; buildNumber: number; versionCode?: number }
): boolean {
  const remoteBuild = resolveEffectiveBuildNumber(remote);
  const currentBuild = current.buildNumber > 0 ? current.buildNumber : resolveEffectiveBuildNumber(current);
  if (remoteBuild > 0 && currentBuild > 0 && remoteBuild > currentBuild) {
    return true;
  }

  const remoteCode = resolveEffectiveVersionCode(remote);
  const currentCode =
    typeof current.versionCode === 'number' && current.versionCode > 0
      ? current.versionCode
      : currentBuild > 0
        ? 1000 + currentBuild
        : 0;
  if (remoteCode > 0 && currentCode > 0 && remoteCode > currentCode) {
    return true;
  }

  if (remote.version && compareVersions(remote.version, current.version) > 0) {
    return true;
  }

  return false;
}

const SOURCE_PRIORITY: Record<NonNullable<AppUpdateManifest['sourceKey']>, number> = {
  github_releases: 6,
  github_raw: 5,
  github_api: 4,
  custom: 3,
  jsdelivr: 2,
  firestore: 1,
};

/**
 * Compare two candidate manifests to select the genuinely highest release.
 * Priority: buildNumber -> versionCode -> numeric semver -> fresher live source priority.
 */
function compareCandidateManifests(a: AppUpdateManifest, b: AppUpdateManifest): number {
  const buildA = resolveEffectiveBuildNumber(a);
  const buildB = resolveEffectiveBuildNumber(b);
  if (buildA !== buildB) return buildA - buildB;

  const codeA = resolveEffectiveVersionCode(a);
  const codeB = resolveEffectiveVersionCode(b);
  if (codeA !== codeB) return codeA - codeB;

  const semverDiff = compareVersions(a.version, b.version);
  if (semverDiff !== 0) return semverDiff;

  const prioA = a.sourceKey ? SOURCE_PRIORITY[a.sourceKey] || 0 : 0;
  const prioB = b.sourceKey ? SOURCE_PRIORITY[b.sourceKey] || 0 : 0;
  return prioA - prioB;
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

async function httpGetJson<T>(url: string, timeoutMs = 8000): Promise<HttpJsonResponse<T>> {
  const isNative = isNativePlatformSafe();

  if (isNative) {
    try {
      const response = await CapacitorHttp.get({
        url,
        headers: {
          Accept: 'application/vnd.github+json, application/json',
          'Cache-Control': 'no-cache, no-store, max-age=0',
          Pragma: 'no-cache',
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

  const runFetch = async (includeCacheHeader: boolean): Promise<HttpJsonResponse<T>> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json, application/json',
      };
      if (includeCacheHeader) {
        headers['Cache-Control'] = 'no-cache';
      }
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers,
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
  };

  // Send Cache-Control: no-cache + cache: 'no-store'; if browser CORS preflight blocks custom header, retry cleanly with cache: 'no-store'
  const firstTry = await runFetch(true);
  if (firstTry.ok || firstTry.status > 0) {
    return firstTry;
  }
  return runFetch(false);
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

const DUPLICATE_CATEGORY_PREFIX_RE =
  /^(?:إضافة|اضافة|تحسين|إصلاح|اصلاح|أمان|امان|إزالة|ازالة)\s*[:\-–—]\s*/;

/**
 * Strips any repetitive Arabic category prefix (e.g. "إضافة: ", "تحسين: ", "إصلاح: ")
 * from a release note bullet so notes never display redundant duplicated labels.
 */
export function cleanChangeItemText(rawText: string): string {
  let cleaned = String(rawText || '').trim();
  while (DUPLICATE_CATEGORY_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(DUPLICATE_CATEGORY_PREFIX_RE, '').trim();
  }
  return cleaned;
}

function buildOrderedBundleMirrors(
  rawMirrors?: unknown,
  primaryUrl?: string,
  fallbackUrl?: string,
  repo?: string | null,
  buildNumber?: number
): string[] {
  const ordered: string[] = [];
  const pushUnique = (u?: unknown) => {
    const clean = typeof u === 'string' ? u.trim() : '';
    if (clean && /^https?:\/\//i.test(clean) && !ordered.includes(clean)) {
      ordered.push(clean);
    }
  };

  if (Array.isArray(rawMirrors)) {
    for (const item of rawMirrors) {
      pushUnique(item);
    }
  }
  pushUnique(primaryUrl);

  if (repo && isValidRepoSlug(repo)) {
    const cacheBust = buildNumber && buildNumber > 0 ? `?v=${buildNumber}` : '';
    pushUnique(`https://raw.githubusercontent.com/${repo}/ota-dist/update.zip${cacheBust}`);
    pushUnique(`https://cdn.jsdelivr.net/gh/${repo}@ota-dist/update.zip${cacheBust}`);
    pushUnique(`https://github.com/${repo}/releases/latest/download/update.zip`);
  }

  pushUnique(fallbackUrl);
  return ordered.slice(0, 6);
}

function parseManifestObject(
  raw: Partial<AppUpdateManifest>,
  fallbackApkUrl?: string,
  fallbackBundleUrl?: string,
  fallbackBytes?: number,
  repo?: string | null,
  sourceKey?: AppUpdateManifest['sourceKey'],
  sourceLabel?: string
): AppUpdateManifest | null {
  const remoteVersion = String(raw.version || '').trim();
  if (!remoteVersion) return null;

  const rawBuild =
    typeof raw.buildNumber === 'number'
      ? raw.buildNumber
      : Number.parseInt(String(raw.buildNumber || '0'), 10) || 0;

  const rawVersionCode =
    typeof raw.versionCode === 'number'
      ? raw.versionCode
      : Number.parseInt(String(raw.versionCode || '0'), 10) || 0;

  const derivedParts = parseVersionParts(remoteVersion);
  const parsedBuild =
    rawBuild > 0
      ? rawBuild
      : rawVersionCode > 1000
        ? rawVersionCode - 1000
        : derivedParts.length >= 3
          ? derivedParts[2] || 0
          : 0;

  const parsedVersionCode =
    rawVersionCode > 0 ? rawVersionCode : parsedBuild > 0 ? 1000 + parsedBuild : 0;

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

  const rawPrimaryBundleUrl =
    (typeof raw.bundleUrl === 'string' && raw.bundleUrl.trim()) ||
    (typeof raw.otaUrl === 'string' && raw.otaUrl.trim()) ||
    undefined;

  const resolvedMirrors = buildOrderedBundleMirrors(
    raw.bundleMirrors,
    rawPrimaryBundleUrl,
    fallbackBundleUrl,
    repo,
    parsedBuild > 0 ? parsedBuild : undefined
  );

  const resolvedBundleUrl = resolvedMirrors[0] || rawPrimaryBundleUrl || fallbackBundleUrl || undefined;

  const resolvedApkUrl =
    (typeof raw.apkUrl === 'string' && raw.apkUrl.trim()) || fallbackApkUrl || undefined;

  const resolvedNativeVersion =
    (typeof raw.nativeVersion === 'string' && raw.nativeVersion.trim()) ||
    (typeof raw.minNativeVersion === 'string' && raw.minNativeVersion.trim()) ||
    undefined;

  const parsedChanges: ReleaseChangeItem[] = [];
  if (Array.isArray(raw.changes)) {
    const validTypes = new Set<ReleaseChangeType>(['add', 'improve', 'fix', 'security', 'remove']);
    for (const item of raw.changes) {
      if (!item || typeof item !== 'object') continue;
      const rawType = String((item as { type?: unknown }).type || 'improve').trim().toLowerCase() as ReleaseChangeType;
      const text = cleanChangeItemText(String((item as { text?: unknown }).text || '')).slice(0, 260);
      if (!text) continue;
      parsedChanges.push({
        type: validTypes.has(rawType) ? rawType : 'improve',
        text,
      });
      if (parsedChanges.length >= 15) break;
    }
  }

  const resolvedReleaseTitle =
    typeof raw.releaseTitle === 'string' && raw.releaseTitle.trim()
      ? raw.releaseTitle.trim().slice(0, 120)
      : undefined;
  const resolvedReleaseSummary =
    typeof raw.releaseSummary === 'string' && raw.releaseSummary.trim()
      ? raw.releaseSummary.trim().slice(0, 240)
      : undefined;

  return {
    version: remoteVersion,
    buildNumber: parsedBuild > 0 ? parsedBuild : undefined,
    versionCode: parsedVersionCode > 0 ? parsedVersionCode : undefined,
    nativeVersion: resolvedNativeVersion,
    minNativeVersion:
      typeof raw.minNativeVersion === 'string' ? raw.minNativeVersion : resolvedNativeVersion,
    updateSizeBytes: resolvedBytes,
    updateSizeText: resolvedSizeText,
    sizeMb: resolvedSizeMb,
    releaseTitle: resolvedReleaseTitle,
    releaseSummary: resolvedReleaseSummary,
    changes: parsedChanges.length > 0 ? parsedChanges : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    bundleUrl: resolvedBundleUrl,
    otaUrl: resolvedBundleUrl,
    bundleMirrors: resolvedMirrors.length > 0 ? resolvedMirrors : undefined,
    apkUrl: resolvedApkUrl,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : undefined,
    sourceKey,
    sourceLabel,
  };
}

function extractVersionFromReleaseBody(body?: string, tagName?: string): string {
  const text = `${body || ''} ${tagName || ''}`;
  const semverMatch = text.match(/(\d+\.\d+\.\d+)/);
  if (semverMatch?.[1]) return semverMatch[1];
  return String(tagName || '').replace(/^v/i, '').trim();
}

/**
 * Additional Mirror Source: Read lightweight OTA manifest mirror from Firestore (`app_meta/latest_update`).
 * Queried strictly in parallel with GitHub sources — NEVER blocks or overrides a newer GitHub release.
 */
async function readFirestoreUpdateMirror(
  fallbackApkUrl?: string,
  repo?: string | null
): Promise<AppUpdateManifest | null> {
  if (!auth.currentUser) return null;
  try {
    const snap = await Promise.race([
      getDoc(doc(db, 'app_meta', 'latest_update')),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 8000)),
    ]);
    if (!snap || !snap.exists()) return null;
    const data = snap.data() as Partial<AppUpdateManifest>;
    return parseManifestObject(
      data,
      fallbackApkUrl,
      undefined,
      undefined,
      repo,
      'firestore',
      'مرآة Firestore'
    );
  } catch {
    return null;
  }
}

/**
 * Super Admin helper: silently mirror the verified highest GitHub manifest (including ordered `bundleMirrors`)
 * into Firestore `app_meta/latest_update` so Agents and Clients always have an up-to-date backup mirror.
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
    if (typeof manifest.versionCode === 'number' && manifest.versionCode > 0) {
      payload.versionCode = manifest.versionCode;
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
    if (manifest.releaseTitle) payload.releaseTitle = manifest.releaseTitle.slice(0, 120);
    if (manifest.releaseSummary) payload.releaseSummary = manifest.releaseSummary.slice(0, 240);
    if (Array.isArray(manifest.changes) && manifest.changes.length > 0) {
      payload.changes = manifest.changes.slice(0, 15).map((ch) => ({
        type: ch.type,
        text: ch.text.slice(0, 260),
      }));
    }
    if (manifest.notes) payload.notes = manifest.notes.slice(0, 600);
    if (manifest.bundleUrl) payload.bundleUrl = manifest.bundleUrl.slice(0, 400);
    if (manifest.otaUrl) payload.otaUrl = manifest.otaUrl.slice(0, 400);
    if (Array.isArray(manifest.bundleMirrors) && manifest.bundleMirrors.length > 0) {
      payload.bundleMirrors = manifest.bundleMirrors
        .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
        .slice(0, 6)
        .map((u) => u.slice(0, 400));
    }
    if (manifest.apkUrl) payload.apkUrl = manifest.apkUrl.slice(0, 400);
    if (manifest.publishedAt) payload.publishedAt = manifest.publishedAt.slice(0, 64);

    await setDoc(doc(db, 'app_meta', 'latest_update'), payload, { merge: false });
  } catch {
    // Non-fatal mirror write
  }
}

interface ProbeOutcome {
  manifest: AppUpdateManifest | null;
  status: number;
  isLiveGitHub: boolean;
}

/**
 * Parallel multi-source resilient update checker (NEVER stops at first responder!):
 * Queries ALL 4 update sources simultaneously (8s timeout per source, unique `?t=<NOW>`, `cache: 'no-store'`, `Cache-Control: no-cache`):
 *   1) GitHub Releases Direct: `https://github.com/<REPO>/releases/latest/download/version.json?t=<NOW>`
 *   2) GitHub Raw (`ota-dist`): `https://raw.githubusercontent.com/<REPO>/ota-dist/version.json?t=<NOW>`
 *   3) jsDelivr Mirror: `https://cdn.jsdelivr.net/gh/<REPO>@ota-dist/version.json?t=<NOW>`
 *   4) Firestore Mirror (`app_meta/latest_update`): additional mirror only, NEVER blocks GitHub
 * Automatically picks the single candidate with the HIGHEST `buildNumber` -> `versionCode` -> numeric `version`.
 */
export async function checkForAppUpdate(options?: {
  apkDownloadUrl?: string;
  silent?: boolean;
  canMirrorToFirestore?: boolean;
}): Promise<UpdateCheckResult> {
  await hydrateNativeBuildConfig();

  const currentVersion = getInstalledAppVersion();
  const currentBuildNumber = getInstalledBuildNumber();
  const currentVersionCode = getInstalledVersionCode();
  const isNative = isNativePlatformSafe();

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      hasUpdate: false,
      requiresNativeApk: false,
      currentVersion,
      currentBuildNumber,
      currentVersionCode,
      manifest: null,
      error: options?.silent ? undefined : 'لا يوجد اتصال بالإنترنت حالياً.',
    };
  }

  const explicitManifestUrl = (
    import.meta.env.VITE_UPDATE_MANIFEST_URL as string | undefined
  )?.trim();
  const repo = resolveGitHubRepo(options?.apkDownloadUrl);
  const directVersionUrl = resolveVersionJsonUrl(options?.apkDownloadUrl);
  const cacheTs = Date.now();

  const probeJsonUrl = async (
    rawUrl: string,
    sourceKey: NonNullable<AppUpdateManifest['sourceKey']>,
    sourceLabel: string,
    isLiveGitHub: boolean
  ): Promise<ProbeOutcome> => {
    const sep = rawUrl.includes('?') ? '&' : '?';
    const res = await httpGetJson<Partial<AppUpdateManifest>>(`${rawUrl}${sep}t=${cacheTs}`, 8000);
    if (res.ok && res.data) {
      const parsed = parseManifestObject(
        res.data,
        options?.apkDownloadUrl,
        undefined,
        undefined,
        repo,
        sourceKey,
        sourceLabel
      );
      return { manifest: parsed, status: res.status, isLiveGitHub };
    }
    return { manifest: null, status: res.status, isLiveGitHub };
  };

  try {
    const probes: Promise<ProbeOutcome>[] = [];

    // Explicit custom manifest URL (if configured)
    if (explicitManifestUrl && /^https?:\/\//i.test(explicitManifestUrl)) {
      probes.push(probeJsonUrl(explicitManifestUrl, 'custom', 'خادم التحديث المخصص', true));
    }

    // Source 1: GitHub Releases Direct
    if (repo) {
      probes.push(
        probeJsonUrl(
          `https://github.com/${repo}/releases/latest/download/version.json`,
          'github_releases',
          'GitHub Releases المباشر',
          true
        )
      );
    } else if (directVersionUrl && directVersionUrl !== explicitManifestUrl) {
      probes.push(
        probeJsonUrl(directVersionUrl, 'github_releases', 'GitHub Releases المباشر', true)
      );
    }

    // Source 2: GitHub Raw (ota-dist branch)
    if (repo) {
      probes.push(
        probeJsonUrl(
          `https://raw.githubusercontent.com/${repo}/ota-dist/version.json`,
          'github_raw',
          'GitHub Raw (ota-dist)',
          true
        )
      );
    }

    // Source 3: jsDelivr CDN Mirror
    if (repo) {
      probes.push(
        probeJsonUrl(
          `https://cdn.jsdelivr.net/gh/${repo}@ota-dist/version.json`,
          'jsdelivr',
          'مرآة jsDelivr',
          true
        )
      );
    }

    // Source 4: Firestore Mirror (`app_meta/latest_update`) — strictly parallel additional source
    probes.push(
      readFirestoreUpdateMirror(options?.apkDownloadUrl, repo).then((fsManifest) => ({
        manifest: fsManifest,
        status: fsManifest ? 200 : 0,
        isLiveGitHub: false,
      }))
    );

    const settled = await Promise.allSettled(probes);
    const candidates: AppUpdateManifest[] = [];
    let hasAnyLiveGitHubSuccess = false;
    let firestoreCandidate: AppUpdateManifest | null = null;
    let lastHttpStatus = 0;

    for (const item of settled) {
      if (item.status !== 'fulfilled') continue;
      const out = item.value;
      if (out.status > 0 && out.isLiveGitHub) {
        lastHttpStatus = out.status;
      }
      if (out.manifest) {
        candidates.push(out.manifest);
        if (out.isLiveGitHub) {
          hasAnyLiveGitHubSuccess = true;
        }
        if (out.manifest.sourceKey === 'firestore') {
          firestoreCandidate = out.manifest;
        }
      }
    }

    // Fallback Stage: GitHub Releases API (if direct GitHub sources failed due to CORS/404/prerelease)
    if (!hasAnyLiveGitHubSuccess && repo) {
      const releasesListUrl = `https://api.github.com/repos/${repo}/releases?per_page=1&t=${Date.now()}`;
      const listRes = await httpGetJson<GitHubReleasePayload[]>(releasesListUrl, 8000);
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

        let apiManifest: AppUpdateManifest | null = null;
        if (versionAsset?.browser_download_url && isNative) {
          const sep = versionAsset.browser_download_url.includes('?') ? '&' : '?';
          const verRes = await httpGetJson<Partial<AppUpdateManifest>>(
            `${versionAsset.browser_download_url}${sep}t=${Date.now()}`,
            8000
          );
          if (verRes.ok && verRes.data) {
            apiManifest = parseManifestObject(
              verRes.data,
              fallbackApkUrl,
              fallbackBundleUrl,
              zipAsset?.size,
              repo,
              'github_api',
              'GitHub Releases API'
            );
          }
        }

        if (!apiManifest) {
          const derivedVersion = extractVersionFromReleaseBody(
            latestRelease.body,
            latestRelease.tag_name
          );
          if (derivedVersion && /\d+\.\d+/.test(derivedVersion)) {
            const parts = parseVersionParts(derivedVersion);
            const derivedBuild = parts.length >= 3 ? parts[2] || 0 : 0;
            const derivedVersionCode = derivedBuild > 0 ? 1000 + derivedBuild : undefined;
            const bytes = zipAsset?.size || undefined;
            const sizeMb = bytes
              ? Math.round((bytes / (1024 * 1024)) * 100) / 100
              : undefined;
            const mirrors = buildOrderedBundleMirrors(
              undefined,
              undefined,
              fallbackBundleUrl,
              repo,
              derivedBuild > 0 ? derivedBuild : undefined
            );

            apiManifest = {
              version: derivedVersion,
              buildNumber: derivedBuild > 0 ? derivedBuild : undefined,
              versionCode: derivedVersionCode,
              nativeVersion: NATIVE_APP_VERSION,
              minNativeVersion: NATIVE_APP_VERSION,
              updateSizeBytes: bytes,
              updateSizeText: formatUpdateSizeAr(bytes, sizeMb),
              sizeMb,
              notes:
                'تحديث خفيف وسريع لتطبيق كروت طيبة نت — تحسينات الأداء والأمان وتجربة الاستخدام.',
              bundleUrl: mirrors[0] || fallbackBundleUrl,
              otaUrl: mirrors[0] || fallbackBundleUrl,
              bundleMirrors: mirrors,
              apkUrl: fallbackApkUrl,
              publishedAt: latestRelease.published_at,
              sourceKey: 'github_api',
              sourceLabel: 'GitHub Releases API',
            };
          }
        }

        if (apiManifest) {
          candidates.push(apiManifest);
          hasAnyLiveGitHubSuccess = true;
        }
      }
    }

    if (candidates.length === 0) {
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
        currentVersionCode,
        manifest: null,
        checkedSourcesCount: 0,
        error: friendlyError,
      };
    }

    // Select the SINGLE genuinely highest release across ALL responded sources
    candidates.sort((a, b) => compareCandidateManifests(b, a));
    const bestManifest = candidates[0];
    const bestIsLiveGitHub = bestManifest.sourceKey !== 'firestore';

    // If Super Admin discovered a newer live GitHub manifest than Firestore mirror, update Firestore mirror silently
    if (
      bestIsLiveGitHub &&
      options?.canMirrorToFirestore &&
      (!firestoreCandidate || compareCandidateManifests(bestManifest, firestoreCandidate) > 0)
    ) {
      void mirrorManifestToFirestoreSilently(bestManifest);
    }

    const hasUpdate = isNewerRelease(bestManifest, {
      version: currentVersion,
      buildNumber: currentBuildNumber,
      versionCode: currentVersionCode,
    });

    // Only request full APK download in the rare case that native Android code version actually increased
    const targetNativeVer = bestManifest.nativeVersion || bestManifest.minNativeVersion;
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
      currentVersionCode,
      manifest: hasUpdate ? bestManifest : null,
      latestCheckedVersion: bestManifest.version,
      latestCheckedBuildNumber: bestManifest.buildNumber,
      latestCheckedVersionCode: bestManifest.versionCode,
      checkedSourceLabel: bestManifest.sourceLabel || 'GitHub Releases',
      checkedSourcesCount: candidates.length,
    };
  } catch {
    return {
      hasUpdate: false,
      requiresNativeApk: false,
      currentVersion,
      currentBuildNumber,
      currentVersionCode,
      manifest: null,
      error: options?.silent
        ? undefined
        : 'تعذر الاتصال بسيرفر التحديثات — تحقق من اتصال الإنترنت وحاول مرة أخرى لاحقاً.',
    };
  }
}

/**
 * Immediately aborts an in-progress native OTA download socket on Android.
 */
export async function cancelActiveAppUpdate(): Promise<void> {
  if (!isNativePlatformSafe()) return;
  try {
    await TaibahUpdateNotifier.cancelOtaDownload();
  } catch {
    // Non-fatal on web or older APK builds
  }
}

/**
 * Downloads and applies the lightweight OTA `update.zip` bundle EXCLUSIVELY via native Android Java
 * streaming-to-disk (`TaibahUpdateNotifier.downloadAndApplyOta`) — NEVER JS `fetch` / `CapacitorHttp` / Base64.
 * Supports automatic multi-mirror failover (jsDelivr CDN -> GitHub Raw -> GitHub Releases),
 * HTTP 206 resume, 10s stall watchdog, ZIP integrity verification, live speed/progress telemetry, and real cancellation.
 */
export async function downloadAndApplyAppUpdate(
  manifest: AppUpdateManifest,
  requiresNativeApk: boolean,
  onProgress: (progress: OtaDownloadProgress) => void
): Promise<{ ok: boolean; cancelled?: boolean; mode: 'ota' | 'apk' | 'web'; message?: string }> {
  const isNative = isNativePlatformSafe();
  const repo = resolveGitHubRepo(manifest.apkUrl);
  const mirrors = buildOrderedBundleMirrors(
    manifest.bundleMirrors,
    manifest.bundleUrl || manifest.otaUrl,
    undefined,
    repo,
    manifest.buildNumber
  );

  const expectedTotalBytes =
    manifest.updateSizeBytes ||
    (manifest.sizeMb ? Math.round(manifest.sizeMb * 1024 * 1024) : 0);

  if (requiresNativeApk || !isNative) {
    if (manifest.apkUrl && /^https?:\/\//i.test(manifest.apkUrl)) {
      onProgress({
        downloadedBytes: expectedTotalBytes,
        totalBytes: expectedTotalBytes,
        percent: 100,
        speedKbps: 0,
        mirrorIndex: 1,
        mirrorCount: 1,
        status: 'applying',
      });
      clearUpdateSnooze();
      window.location.href = manifest.apkUrl;
      return { ok: true, mode: 'apk' };
    }
    if (!isNative) {
      onProgress({
        downloadedBytes: expectedTotalBytes,
        totalBytes: expectedTotalBytes,
        percent: 100,
        speedKbps: 0,
        mirrorIndex: 1,
        mirrorCount: 1,
        status: 'applying',
      });
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

  if (mirrors.length === 0) {
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

  const STALL_WATCHDOG_MS = 15000;
  const listenerRef: { handle: PluginListenerHandle | null } = { handle: null };
  let stallTimer: number | null = null;
  let settled = false;

  const clearWatchdog = () => {
    if (stallTimer !== null) {
      window.clearTimeout(stallTimer);
      stallTimer = null;
    }
  };

  try {
    onProgress({
      downloadedBytes: 0,
      totalBytes: expectedTotalBytes,
      percent: 0,
      speedKbps: 0,
      mirrorIndex: 1,
      mirrorCount: mirrors.length,
      mirrorLabel: 'GitHub Raw المباشر',
      status: 'downloading',
    });

    let lastObservedBytes = -1;
    let lastObservedStage = '';

    const nativeRes = await new Promise<{
      applied?: boolean;
      cancelled?: boolean;
      version?: string;
      buildNumber?: number;
      mirrorIndex?: number;
      error?: string;
      stalledTimeout?: boolean;
    }>((resolve, reject) => {
      const armWatchdog = () => {
        clearWatchdog();
        stallTimer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          void TaibahUpdateNotifier.cancelOtaDownload().catch(() => {});
          resolve({
            applied: false,
            cancelled: false,
            stalledTimeout: true,
            error:
              'توقف تحميل التحديث لأكثر من 15 ثانية دون استجابة من السيرفر — اضغط «إعادة المحاولة» أو حمّل النسخة الكاملة (APK).',
          });
        }, STALL_WATCHDOG_MS);
      };

      armWatchdog();

      TaibahUpdateNotifier.addListener('otaProgress', (evt) => {
        if (settled) return;
        const dlBytes = Math.max(0, Number(evt?.downloadedBytes) || 0);
        const totBytes = Math.max(0, Number(evt?.totalBytes) || expectedTotalBytes);
        const pct = Math.max(0, Math.min(100, Math.round(Number(evt?.percent) || 0)));
        const stage = evt?.status || 'downloading';

        // Reset 15s watchdog ONLY when real bytes advance or stage progresses
        if (
          dlBytes > lastObservedBytes ||
          (stage !== 'downloading' && stage !== lastObservedStage)
        ) {
          lastObservedBytes = dlBytes;
          lastObservedStage = stage;
          armWatchdog();
        }

        onProgress({
          downloadedBytes: dlBytes,
          totalBytes: totBytes,
          percent: pct,
          speedKbps: Math.max(0, Number(evt?.speedKbps) || 0),
          mirrorIndex: Math.max(1, Number(evt?.mirrorIndex) || 1),
          mirrorCount: Math.max(1, Number(evt?.mirrorCount) || mirrors.length),
          mirrorLabel: evt?.mirrorLabel || undefined,
          status: stage,
        });
      })
        .then((handle) => {
          listenerRef.handle = handle;
          return TaibahUpdateNotifier.downloadAndApplyOta({
            urls: mirrors,
            url: mirrors[0],
            version: manifest.version,
            buildNumber: manifest.buildNumber || 0,
            expectedBytes: expectedTotalBytes,
          });
        })
        .then((res) => {
          if (settled) return;
          settled = true;
          clearWatchdog();
          resolve(res);
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          clearWatchdog();
          reject(err);
        });
    });

    if (nativeRes?.cancelled) {
      return {
        ok: false,
        cancelled: true,
        mode: 'ota',
        message: 'تم إلغاء تحميل التحديث.',
      };
    }

    if (nativeRes?.applied) {
      try {
        localStorage.setItem(APPLIED_OTA_VERSION_KEY, manifest.version);
        if (manifest.buildNumber && manifest.buildNumber > 0) {
          localStorage.setItem(APPLIED_OTA_BUILD_NUMBER_KEY, String(manifest.buildNumber));
        }
      } catch {
        // ignore storage errors
      }
      clearUpdateSnooze();
      return { ok: true, mode: 'ota' };
    }

    return {
      ok: false,
      mode: 'ota',
      message: nativeRes?.error || 'تعذر تحميل التحديث الخفيف من جميع المرايا — حاول مجدداً.',
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err || '');
    const isUnimplementedOnOldApk = /not implemented|UNIMPLEMENTED/i.test(rawMsg);

    // Backward-compatible native fallback ONLY for older APKs built before native streaming downloader
    if (isUnimplementedOnOldApk) {
      const updater = await loadNativeCapacitorUpdater();
      if (updater) {
        let capgoHandle: { remove: () => Promise<void> } | null = null;
        try {
          let activeMirrorIdx = 1;
          capgoHandle = await updater.addListener('download', (info) => {
            const pct = Math.max(0, Math.min(99, Math.round(Number(info?.percent) || 0)));
            onProgress({
              downloadedBytes: expectedTotalBytes > 0 ? Math.round((expectedTotalBytes * pct) / 100) : 0,
              totalBytes: expectedTotalBytes,
              percent: pct,
              speedKbps: 0,
              mirrorIndex: activeMirrorIdx,
              mirrorCount: mirrors.length,
              status: 'downloading',
            });
          });

          let lastErr = '';
          for (let i = 0; i < mirrors.length; i++) {
            activeMirrorIdx = i + 1;
            try {
              const bundle = await updater.download({
                url: mirrors[i],
                version: manifest.version,
              });
              onProgress({
                downloadedBytes: expectedTotalBytes,
                totalBytes: expectedTotalBytes,
                percent: 100,
                speedKbps: 0,
                mirrorIndex: activeMirrorIdx,
                mirrorCount: mirrors.length,
                status: 'applying',
              });
              try {
                localStorage.setItem(APPLIED_OTA_VERSION_KEY, manifest.version);
                if (manifest.buildNumber && manifest.buildNumber > 0) {
                  localStorage.setItem(APPLIED_OTA_BUILD_NUMBER_KEY, String(manifest.buildNumber));
                }
              } catch {
                // ignore
              }
              clearUpdateSnooze();
              await clearNativeUpdateNotification(manifest.buildNumber);
              await updater.set(bundle);
              return { ok: true, mode: 'ota' };
            } catch (mErr) {
              lastErr = mErr instanceof Error ? mErr.message : String(mErr || '');
            }
          }
          return {
            ok: false,
            mode: 'ota',
            message: lastErr || 'تعذر تحميل التحديث من جميع المرايا — حاول مجدداً.',
          };
        } finally {
          if (capgoHandle) {
            await capgoHandle.remove().catch(() => {});
          }
        }
      }
    }

    return {
      ok: false,
      mode: 'ota',
      message: rawMsg || 'تعذر تحميل التحديث الخفيف حالياً — يرجى المحاولة مجدداً.',
    };
  } finally {
    clearWatchdog();
    if (listenerRef.handle) {
      await listenerRef.handle.remove().catch(() => {});
      listenerRef.handle = null;
    }
  }
}
