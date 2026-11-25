import { initializeApp } from 'firebase/app';
import {
  getAuth,
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
} from 'firebase/auth';
import {
  CACHE_SIZE_UNLIMITED,
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
  setLogLevel,
  type Firestore,
} from 'firebase/firestore';
import { getMessaging, getToken, isSupported as isMessagingSupported } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';
import { SUPER_ADMIN_CONFIG } from '../types/taibah';

const app = initializeApp(firebaseConfig);

// CRITICAL: Connect to the provisioned Enterprise Firestore database ID using
// `experimentalForceLongPolling: true` + `persistentLocalCache(...)` inside safe `try/catch`
// to prevent WebSocket/WebChannel stalls on Android WebView (minSdk 23), VPNs, and browser previews.
function createOfflineFirstFirestore(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
          cacheSizeBytes: CACHE_SIZE_UNLIMITED,
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    try {
      return initializeFirestore(
        app,
        {
          experimentalForceLongPolling: true,
          localCache: persistentLocalCache({
            tabManager: persistentSingleTabManager({}),
            cacheSizeBytes: CACHE_SIZE_UNLIMITED,
          }),
        },
        firebaseConfig.firestoreDatabaseId
      );
    } catch {
      try {
        return initializeFirestore(
          app,
          {
            experimentalForceLongPolling: true,
            localCache: memoryLocalCache(),
          },
          firebaseConfig.firestoreDatabaseId
        );
      } catch {
        return getFirestore(app, firebaseConfig.firestoreDatabaseId);
      }
    }
  }
}

// Prevent noisy SDK console errors (`Could not reach Cloud Firestore backend [code=unavailable]`)
// while offline or inside sandboxed preview iframes; app handles offline/quota states explicitly.
try {
  setLogLevel('silent');
} catch {
  // ignore
}

export const db: Firestore = createOfflineFirstFirestore();
export const auth = getAuth(app);
export const firebaseProjectId = firebaseConfig.projectId;
export const firestoreDatabaseId = firebaseConfig.firestoreDatabaseId;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

let lastQuotaWarningAt = 0;

/**
 * Detect Firestore daily free-tier / billing quota exhaustion errors (`resource-exhausted`).
 */
export function isFirestoreQuotaError(error: unknown): boolean {
  if (!error) return false;
  const code =
    typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code.toLowerCase()
      : '';
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    code === 'resource-exhausted' ||
    msg.includes('quota limit exceeded') ||
    msg.includes('quota exceeded') ||
    msg.includes('free daily read units') ||
    msg.includes('resource_exhausted')
  );
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  rethrow = false
): FirestoreErrorInfo {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };

  if (isFirestoreQuotaError(error)) {
    const now = Date.now();
    if (now - lastQuotaWarningAt > 30000) {
      lastQuotaWarningAt = now;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('taibah:firestore-quota-exceeded'));
      }
    }
    return errInfo;
  }

  if (isFirestoreOfflineError(error)) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('taibah:firestore-offline'));
    }
    return errInfo;
  }

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (rethrow) {
    throw new Error(JSON.stringify(errInfo));
  }
  return errInfo;
}

/**
 * Detect transient Firestore offline / network-unavailable errors so non-critical
 * background startup checks can gracefully defer and retry instead of crashing.
 */
export function isFirestoreOfflineError(error: unknown): boolean {
  if (!error) return false;
  const code =
    typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code.toLowerCase()
      : '';
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    code === 'unavailable' ||
    (code === 'failed-precondition' && msg.includes('offline')) ||
    msg.includes('the client is offline') ||
    msg.includes('client is offline') ||
    msg.includes('could not reach cloud firestore backend') ||
    msg.includes('network-request-failed')
  );
}

/**
 * Connectivity verification against Firestore server (called on explicit manual sync).
 * Gracefully falls back to local cache on offline or quota exhaustion with zero console warnings.
 */
export async function testFirestoreConnection(attempt = 1): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('taibah:firestore-quota-exceeded'));
      }
      return false;
    }
    if (isFirestoreOfflineError(error)) {
      if (attempt < 2 && (typeof navigator === 'undefined' || navigator.onLine)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return testFirestoreConnection(attempt + 1);
      }
      return false;
    }
    // Permission or not-found still proves live network reachability to Firestore
    return true;
  }
}

/**
 * Set Firebase Auth persistence according to "تذكرني".
 */
export async function applyAuthPersistence(rememberMe: boolean): Promise<void> {
  try {
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
  } catch {
    // Silently keep existing auth persistence in restricted storage environments
  }
}

/**
 * Convert Arabic/Hindi digits to ASCII digits.
 */
export function normalizeDigits(input: string): string {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
}

/**
 * Normalize an email or Yemeni phone number into a valid Firebase Auth email.
 * - Super Admin phone `772466998` maps directly to `nabil77444@gmail.com`.
 * - Any email containing `@` is lowercased and returned as-is.
 * - Any phone number maps deterministically to `<digits>@taibah.net`.
 */
export function normalizeAuthIdentifier(rawInput: string): {
  email: string;
  phone: string;
  isPhoneLogin: boolean;
} {
  const cleaned = normalizeDigits(rawInput).replace(/\s+/g, '');
  if (cleaned.includes('@')) {
    const lower = cleaned.toLowerCase();
    const isAdminEmail = lower === SUPER_ADMIN_CONFIG.email.toLowerCase();
    return {
      email: lower,
      phone: isAdminEmail ? SUPER_ADMIN_CONFIG.phone : '',
      isPhoneLogin: false,
    };
  }
  const digitsOnly = cleaned.replace(/[^\d]/g, '').replace(/^00967|^967/, '');
  if (digitsOnly === SUPER_ADMIN_CONFIG.phone) {
    return {
      email: SUPER_ADMIN_CONFIG.email,
      phone: SUPER_ADMIN_CONFIG.phone,
      isPhoneLogin: true,
    };
  }
  return {
    email: `${digitsOnly}@taibah.net`,
    phone: digitsOnly,
    isPhoneLogin: true,
  };
}

/**
 * Check if an email belongs to the Super Admin configuration.
 */
export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return (
    lower === SUPER_ADMIN_CONFIG.email.toLowerCase() ||
    lower === SUPER_ADMIN_CONFIG.runtimeOwnerEmail.toLowerCase()
  );
}

/**
 * Attempt to register for Web Push / FCM notifications gracefully.
 */
export async function requestFCMToken(): Promise<string | null> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return null;
    const supported = await isMessagingSupported();
    if (!supported) return null;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      serviceWorkerRegistration: registration,
    }).catch(() => null);
    return token || null;
  } catch {
    return null;
  }
}

let safeDocIdCounter = 0;

/**
 * Android 6+ (minSdk 23) safe unique document ID generator — zero dependency on `crypto.randomUUID`.
 */
export function generateSafeDocId(prefix: string): string {
  safeDocIdCounter = (safeDocIdCounter + 1) % 100000;
  const randA = Math.random().toString(36).slice(2, 10);
  const randB = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${safeDocIdCounter.toString(36)}_${randA}${randB}`;
}

// ============================================================================
// Lightweight HTTPS REST API Fallbacks (Firebase Auth + Firestore REST v1)
// Used ONLY on first-time cloud activation when Firebase WebChannel/SDK stalls
// behind VPNs, weak Yemeni mobile data, or legacy Android WebView.
// ============================================================================

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const hasAbort = typeof AbortController !== 'undefined';
  const controller = hasAbort ? new AbortController() : null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const fetchPromise = fetch(url, {
    ...init,
    ...(controller ? { signal: controller.signal } : {}),
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // ignore
      }
      reject(new Error('REST_TIMEOUT'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
}

export interface FirebaseAuthRestResult {
  ok: boolean;
  localId?: string;
  idToken?: string;
  email?: string;
  displayName?: string;
  errorCode?: string;
}

export async function firebaseAuthRestSignIn(
  email: string,
  password: string,
  timeoutMs = 15000
): Promise<FirebaseAuthRestResult> {
  const apiKey = firebaseConfig.apiKey;
  if (!apiKey) return { ok: false, errorCode: 'MISSING_API_KEY' };
  try {
    const res = await fetchWithTimeout(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          returnSecureToken: true,
        }),
      },
      timeoutMs
    );
    const data = (await res.json().catch(() => ({}))) as {
      localId?: string;
      idToken?: string;
      email?: string;
      displayName?: string;
      error?: { message?: string };
    };
    if (!res.ok || !data.localId || !data.idToken) {
      return {
        ok: false,
        errorCode: data?.error?.message || `HTTP_${res.status}`,
      };
    }
    return {
      ok: true,
      localId: data.localId,
      idToken: data.idToken,
      email: data.email || email.trim().toLowerCase(),
      displayName: data.displayName || '',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    return { ok: false, errorCode: msg || 'NETWORK_ERROR' };
  }
}

function parseFirestoreRestValue(val: unknown): unknown {
  if (!val || typeof val !== 'object') return undefined;
  const v = val as Record<string, unknown>;
  if ('stringValue' in v) return String(v.stringValue ?? '');
  if ('integerValue' in v) return Number(v.integerValue ?? 0);
  if ('doubleValue' in v) return Number(v.doubleValue ?? 0);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v && v.arrayValue && typeof v.arrayValue === 'object') {
    const arr = (v.arrayValue as { values?: unknown[] }).values;
    return Array.isArray(arr) ? arr.map(parseFirestoreRestValue) : [];
  }
  if ('mapValue' in v && v.mapValue && typeof v.mapValue === 'object') {
    const fields = (v.mapValue as { fields?: Record<string, unknown> }).fields;
    return parseFirestoreRestFields(fields);
  }
  return undefined;
}

function parseFirestoreRestFields(
  fields?: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [key, rawVal] of Object.entries(fields)) {
    const parsed = parseFirestoreRestValue(rawVal);
    if (parsed !== undefined) {
      out[key] = parsed;
    }
  }
  return out;
}

export async function firestoreRestGetUserDoc(
  uid: string,
  idToken: string,
  timeoutMs = 12000
): Promise<Record<string, unknown> | null> {
  const projectId = firebaseConfig.projectId;
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  if (!projectId || !uid || !idToken) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(dbId)}/documents/users/${encodeURIComponent(uid)}`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
          Accept: 'application/json',
        },
      },
      timeoutMs
    );
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      fields?: Record<string, unknown>;
    } | null;
    if (!json?.fields) return null;
    return parseFirestoreRestFields(json.fields);
  } catch {
    return null;
  }
}

export async function firestoreRestLookupEmailByPhone(
  phoneDigits: string,
  timeoutMs = 10000
): Promise<string | null> {
  const projectId = firebaseConfig.projectId;
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  const apiKey = firebaseConfig.apiKey;
  if (!projectId || !phoneDigits || !apiKey) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(dbId)}/documents:runQuery?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'users' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'phone' },
                op: 'EQUAL',
                value: { stringValue: phoneDigits },
              },
            },
            limit: 1,
          },
        }),
      },
      timeoutMs
    );
    if (!res.ok) return null;
    const rows = (await res.json().catch(() => [])) as Array<{
      document?: { fields?: Record<string, unknown> };
    }>;
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      const fields = parseFirestoreRestFields(row?.document?.fields);
      if (typeof fields.email === 'string' && fields.email.includes('@')) {
        return fields.email.trim().toLowerCase();
      }
    }
    return null;
  } catch {
    return null;
  }
}
