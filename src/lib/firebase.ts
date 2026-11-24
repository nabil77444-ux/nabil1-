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
// `experimentalAutoDetectLongPolling: true` + `persistentLocalCache(...)` inside safe `try/catch`
// to prevent WebSocket/WebChannel stalls behind VPNs, mobile networks, and browser previews.
function createOfflineFirstFirestore(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
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
          experimentalAutoDetectLongPolling: true,
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
            experimentalAutoDetectLongPolling: true,
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

export function generateSafeDocId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${randomPart}`;
}
