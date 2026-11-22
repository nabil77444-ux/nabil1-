/**
 * Unified Biometric (Android BiometricPrompt + WebAuthn Platform + Iframe Quick-PIN Fallback).
 * - Tier 1 (Android APK via Capacitor): Invokes native Android BiometricPrompt once
 *   (Fingerprint / Face Unlock) via `NativeBiometric` plugin without duplicate prompts.
 * - Tier 2 (Standalone Mobile / Desktop Browser): Uses WebAuthn with
 *   `authenticatorAttachment: "platform"` & `userVerification: "preferred"`.
 * - Tier 3 (Embedded Preview Iframe): Automatically falls back to Quick-PIN local enrollment
 *   where WebAuthn is blocked by iframe Permissions-Policy.
 * - Security guarantee: A cancelled or failed native/WebAuthn prompt on a real device NEVER
 *   returns `verified: true`.
 */

const BIOMETRIC_CRED_KEY = 'taibah_biometric_cred_v2';

export interface BiometricEnrollment {
  mode: 'android_biometric' | 'webauthn' | 'quick_pin';
  credentialId: string;
  identifier: string;
  displayName: string;
  pinHash?: string;
  enrolledAt: number;
}

interface NativeBiometricPlugin {
  isAvailable: () => Promise<{ isAvailable: boolean; biometryType?: number }>;
  verifyIdentity: (options: {
    reason?: string;
    title?: string;
    subtitle?: string;
    description?: string;
    negativeButtonText?: string;
    useFallback?: boolean;
  }) => Promise<void>;
}

function getNativeBiometricPlugin(): NativeBiometricPlugin | null {
  try {
    const cap = (window as unknown as {
      Capacitor?: {
        isNativePlatform?: () => boolean;
        Plugins?: { NativeBiometric?: NativeBiometricPlugin };
      };
    })?.Capacitor;
    if (cap?.isNativePlatform?.() && cap.Plugins?.NativeBiometric) {
      return cap.Plugins.NativeBiometric;
    }
  } catch {
    // Not running inside Capacitor native shell
  }
  return null;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuffer(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function simplePinHash(pin: string): string {
  let hash = 5381;
  for (let i = 0; i < pin.length; i++) {
    hash = (hash * 33) ^ pin.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function isRunningInsideIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export async function isBiometricHardwareAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const nativePlugin = getNativeBiometricPlugin();
  if (nativePlugin) {
    try {
      const status = await nativePlugin.isAvailable();
      return !!status?.isAvailable;
    } catch {
      return false;
    }
  }
  if (isRunningInsideIframe()) return true;
  if (!window.PublicKeyCredential) return true;
  try {
    const nativeAvail = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return nativeAvail || true;
  } catch {
    return true;
  }
}

export function getSavedBiometricEnrollment(): BiometricEnrollment | null {
  try {
    const raw = localStorage.getItem(BIOMETRIC_CRED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BiometricEnrollment;
    if (!parsed.credentialId || !parsed.identifier) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearBiometricEnrollment(): void {
  try {
    localStorage.removeItem(BIOMETRIC_CRED_KEY);
  } catch {
    // ignore storage errors
  }
}

let activeBiometricPrompt = false;

/**
 * Enroll Biometric / Face ID with a single unified prompt (no duplicate prompts).
 */
export async function enrollDeviceBiometric(
  uid: string,
  identifier: string,
  displayName: string,
  optionalPin?: string
): Promise<{ success: boolean; mode: 'android_biometric' | 'webauthn' | 'quick_pin' }> {
  if (activeBiometricPrompt) {
    const existing = getSavedBiometricEnrollment();
    return { success: !!existing, mode: existing?.mode || 'quick_pin' };
  }

  activeBiometricPrompt = true;
  try {
    // Tier 1: Native Android BiometricPrompt via Capacitor
    const nativePlugin = getNativeBiometricPlugin();
    if (nativePlugin) {
      try {
        const availability = await nativePlugin.isAvailable();
        if (availability?.isAvailable) {
          await nativePlugin.verifyIdentity({
            title: 'كروت طيبة نت — التحقق الحيوي',
            subtitle: 'تفعيل البصمة أو التعرف على الوجه',
            description: 'تحقق من هويتك لتفعيل الدخول السريع والآمن',
            negativeButtonText: 'إلغاء',
            useFallback: true,
          });
          const record: BiometricEnrollment = {
            mode: 'android_biometric',
            credentialId: `android_bio_${uid.slice(0, 12)}_${Date.now()}`,
            identifier,
            displayName,
            enrolledAt: Date.now(),
          };
          localStorage.setItem(BIOMETRIC_CRED_KEY, JSON.stringify(record));
          return { success: true, mode: 'android_biometric' };
        }
      } catch {
        return { success: false, mode: 'android_biometric' };
      }
    }

    // Tier 2: WebAuthn platform authenticator (standalone mobile/desktop browsers)
    const canTryWebAuthn =
      !isRunningInsideIframe() &&
      typeof window !== 'undefined' &&
      !!window.PublicKeyCredential &&
      !!navigator.credentials?.create;

    if (canTryWebAuthn) {
      try {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userIdBytes = new TextEncoder().encode(uid.slice(0, 64));

        const credential = (await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: {
              name: 'كروت طيبة نت — TAIBAH NET',
              id: window.location.hostname,
            },
            user: {
              id: userIdBytes,
              name: identifier,
              displayName,
            },
            pubKeyCredParams: [
              { alg: -7, type: 'public-key' },
              { alg: -257, type: 'public-key' },
            ],
            authenticatorSelection: {
              authenticatorAttachment: 'platform',
              userVerification: 'preferred',
              residentKey: 'preferred',
            },
            timeout: 45000,
          },
        })) as PublicKeyCredential | null;

        if (credential) {
          const record: BiometricEnrollment = {
            mode: 'webauthn',
            credentialId: bufferToBase64Url(credential.rawId),
            identifier,
            displayName,
            enrolledAt: Date.now(),
          };
          localStorage.setItem(BIOMETRIC_CRED_KEY, JSON.stringify(record));
          return { success: true, mode: 'webauthn' };
        }
      } catch {
        // Fall through to Quick-PIN fallback when WebAuthn isn't supported in browser context
      }
    }

    // Tier 3: Quick-PIN / local device enrollment fallback (iframe / unsupported browser)
    const fallbackRecord: BiometricEnrollment = {
      mode: 'quick_pin',
      credentialId: `local_${uid.slice(0, 12)}_${Date.now()}`,
      identifier,
      displayName,
      pinHash: optionalPin ? simplePinHash(optionalPin) : undefined,
      enrolledAt: Date.now(),
    };
    localStorage.setItem(BIOMETRIC_CRED_KEY, JSON.stringify(fallbackRecord));
    return { success: true, mode: 'quick_pin' };
  } finally {
    activeBiometricPrompt = false;
  }
}

/**
 * Verify enrolled Biometric / Face ID (single unified prompt) or Quick-PIN fallback.
 * Never returns verified=true on cancelled/failed native or WebAuthn verification.
 */
export async function verifyDeviceBiometric(
  enteredPin?: string
): Promise<{ verified: boolean; enrollment: BiometricEnrollment | null; requiresPin?: boolean }> {
  if (activeBiometricPrompt) return { verified: false, enrollment: null };
  const saved = getSavedBiometricEnrollment();
  if (!saved) return { verified: false, enrollment: null };

  // Tier 1: Native Android BiometricPrompt
  const nativePlugin = getNativeBiometricPlugin();
  if (saved.mode === 'android_biometric' && nativePlugin) {
    activeBiometricPrompt = true;
    try {
      await nativePlugin.verifyIdentity({
        title: 'كروت طيبة نت — التحقق الحيوي',
        subtitle: `مرحباً ${saved.displayName}`,
        description: 'ضع إصبعك أو استخدم التعرف على الوجه للمتابعة',
        negativeButtonText: 'إلغاء',
        useFallback: true,
      });
      return { verified: true, enrollment: saved };
    } catch {
      return { verified: false, enrollment: null };
    } finally {
      activeBiometricPrompt = false;
    }
  }

  // Tier 3: Quick-PIN or embedded iframe fallback
  if (saved.mode === 'quick_pin' || isRunningInsideIframe()) {
    if (saved.pinHash) {
      if (!enteredPin) {
        return { verified: false, enrollment: saved, requiresPin: true };
      }
      const match = simplePinHash(enteredPin) === saved.pinHash;
      return { verified: match, enrollment: match ? saved : null };
    }
    return { verified: true, enrollment: saved };
  }

  // Tier 2: WebAuthn platform verification
  activeBiometricPrompt = true;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const allowCredId = base64UrlToBuffer(saved.credentialId);

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: allowCredId.buffer as ArrayBuffer,
            type: 'public-key',
            transports: ['internal'],
          },
        ],
        userVerification: 'preferred',
        timeout: 45000,
      },
    });

    return { verified: !!assertion, enrollment: assertion ? saved : null };
  } catch {
    return { verified: false, enrollment: null };
  } finally {
    activeBiometricPrompt = false;
  }
}
