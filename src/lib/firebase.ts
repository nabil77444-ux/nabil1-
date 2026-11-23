import { initializeApp } from 'firebase/app';
import {
  getAuth,
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getMessaging, getToken, isSupported as isMessagingSupported } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';
import { SUPER_ADMIN_CONFIG } from '../types/taibah';

const app = initializeApp(firebaseConfig);

function isEmbeddedIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

// CRITICAL: Connect to the provisioned Enterprise Firestore database ID using:
// - `experimentalForceLongPolling: true` to bypass hanging WebChannel streams in mobile networks,
//   carrier proxies, and sandboxed preview iframes (prevents 10-second offline timeout).
// - `memoryLocalCache()` inside embedded iframes (zero IndexedDB partition stalls) and
//   `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` in standalone/PWA/APK
//   for full Offline-First persistence.
function createOfflineFirstFirestore(): Firestore {
  const embedded = isEmbeddedIframe();
  try {
    const localCache = embedded
      ? memoryLocalCache()
      : persistentLocalCache({ tabManager: persistentMultipleTabManager() });

    return initializeFirestore(
      app,
      {
        localCache,
        ...(embedded
          ? { experimentalForceLongPolling: true }
          : { experimentalAutoDetectLongPolling: true }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    try {
      return initializeFirestore(
        app,
        {
          localCache: memoryLocalCache(),
          ...(embedded
            ? { experimentalForceLongPolling: true }
            : { experimentalAutoDetectLongPolling: true }),
        },
        firebaseConfig.firestoreDatabaseId
      );
    } catch {
      return getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
  }
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
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (rethrow) {
    throw new Error(JSON.stringify(errInfo));
  }
  return errInfo;
}

/**
 * Startup connectivity verification against Firestore server with one automatic retry
 * to handle slow mobile handshakes without false offline errors.
 */
export async function testFirestoreConnection(attempt = 1): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      if (attempt < 2 && (typeof navigator === 'undefined' || navigator.onLine)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return testFirestoreConnection(attempt + 1);
      }
      console.warn('Firestore connection temporarily offline — operating from local cache until reconnected.');
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
  } catch (err) {
    console.warn('Unable to update auth persistence:', err);
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
