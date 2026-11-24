import { isSuperAdminEmail, normalizeAuthIdentifier, normalizeDigits } from './firebase';
import { SUPER_ADMIN_CONFIG, type UserProfile, type UserRole, type UserStatus } from '../types/taibah';

/**
 * Local-First Hybrid Authentication Vault (`localAuthVault`).
 *
 * - Stores activated device accounts in `localStorage` AND mirrors them to IndexedDB.
 * - NEVER stores plaintext passwords: every password is hashed with a unique random 16-byte
 *   per-account salt using iterative SHA-256 (`crypto.subtle` with an identical pure-TS
 *   RFC 6234 SHA-256 fallback for non-HTTPS / Android 6 WebViews).
 * - Enables < 0.2s daily login & biometric login with ZERO Firebase cloud reads.
 */

export const LOCAL_AUTH_VAULT_KEY = 'taibah_local_auth_vault_v1';
const VAULT_IDB_NAME = 'taibah_local_auth_vault_idb_v1';
const VAULT_IDB_STORE = 'accounts';
const VAULT_IDB_KEY = 'vault_records_v1';

// 1000 iterative salted SHA-256 rounds: ~3-8ms on mobile/web (well under 0.2s login budget)
// while adding meaningful work factor over single-pass hashing.
const HASH_ITERATIONS = 1000;

export interface LocalVaultAccount {
  uid: string;
  email: string;
  phone: string;
  identifier: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  disabled?: boolean;
  parentAgentId: string;
  discountRate: number;
  balance: number;
  passwordSalt: string;
  passwordHash: string;
  passwordVersion?: string;
  activatedAt: number;
  lastLoginAt: number;
  updatedAt: number;
}

export type LocalVerifyStatus = 'matched' | 'wrong_password' | 'not_found' | 'suspended';

export interface LocalVerifyResult {
  status: LocalVerifyStatus;
  account: LocalVaultAccount | null;
}

// ============================================================================
// RFC 6234 Pure-TypeScript SHA-256 Fallback (exact bit-for-bit match with Web Crypto)
// Guarantees identical hashes across HTTPS browsers and non-HTTPS/Android 6 WebViews
// ============================================================================

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256BytesSync(inputBytes: Uint8Array): Uint8Array {
  const len = inputBytes.length;
  const bitLenHi = Math.floor((len * 8) / 0x100000000);
  const bitLenLo = (len * 8) >>> 0;

  const paddedLen = ((len + 9 + 63) & ~63);
  const padded = new Uint8Array(paddedLen);
  padded.set(inputBytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function generateSaltHex(byteLen = 16): string {
  const bytes = new Uint8Array(byteLen);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLen; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToHex(bytes);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Derive a salted SHA-256 hex digest using Web Crypto `crypto.subtle` when available,
 * with automatic identical pure-TS RFC 6234 SHA-256 fallback for non-HTTPS contexts.
 */
export async function hashPasswordWithSalt(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const payload = encoder.encode(`taibah_v1:${salt}:${password}`);
  const hasSubtle =
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.subtle.digest === 'function';

  if (hasSubtle) {
    try {
      let digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
      const saltBytes = encoder.encode(salt);
      const buf = new Uint8Array(32 + saltBytes.length);
      buf.set(saltBytes, 32);
      for (let i = 1; i < HASH_ITERATIONS; i++) {
        buf.set(digest, 0);
        digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
      }
      return bytesToHex(digest);
    } catch {
      // Fall through to pure-TS SHA-256 if subtle is restricted in this WebView
    }
  }

  let digest = sha256BytesSync(payload);
  const saltBytes = encoder.encode(salt);
  const buf = new Uint8Array(32 + saltBytes.length);
  buf.set(saltBytes, 32);
  for (let i = 1; i < HASH_ITERATIONS; i++) {
    buf.set(digest, 0);
    digest = sha256BytesSync(buf);
  }
  return bytesToHex(digest);
}

// ============================================================================
// Dual Storage Engine: Synchronous localStorage + IndexedDB Backup Mirror
// ============================================================================

function openVaultIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(VAULT_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(VAULT_IDB_STORE)) {
        idb.createObjectStore(VAULT_IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Vault IDB open error'));
  });
}

async function mirrorVaultToIdb(accounts: LocalVaultAccount[]): Promise<void> {
  try {
    const idb = await openVaultIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(VAULT_IDB_STORE, 'readwrite');
      const store = tx.objectStore(VAULT_IDB_STORE);
      const req = store.put(accounts, VAULT_IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    idb.close();
  } catch {
    // Non-fatal in private browsing / restricted iframe storage
  }
}

async function readVaultFromIdb(): Promise<LocalVaultAccount[]> {
  try {
    const idb = await openVaultIdb();
    const list = await new Promise<LocalVaultAccount[]>((resolve, reject) => {
      const tx = idb.transaction(VAULT_IDB_STORE, 'readonly');
      const store = tx.objectStore(VAULT_IDB_STORE);
      const req = store.get(VAULT_IDB_KEY);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as LocalVaultAccount[]) : []);
      req.onerror = () => reject(req.error);
    });
    idb.close();
    return list;
  } catch {
    return [];
  }
}

function readVaultRecords(): LocalVaultAccount[] {
  try {
    const raw = localStorage.getItem(LOCAL_AUTH_VAULT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalVaultAccount =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof item.uid === 'string' &&
        item.uid.length > 0 &&
        typeof item.passwordHash === 'string' &&
        typeof item.passwordSalt === 'string'
    );
  } catch {
    return [];
  }
}

function writeVaultRecords(records: LocalVaultAccount[]): void {
  const trimmed = records.slice(0, 50);
  try {
    localStorage.setItem(LOCAL_AUTH_VAULT_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage quota restrictions
  }
  void mirrorVaultToIdb(trimmed);
}

/**
 * Hydrate localStorage vault from IndexedDB if localStorage was cleared by the browser/OS.
 */
export async function initLocalAuthVaultFromIdb(): Promise<void> {
  try {
    const localList = readVaultRecords();
    if (localList.length > 0) return;
    const idbList = await readVaultFromIdb();
    if (idbList.length > 0) {
      localStorage.setItem(LOCAL_AUTH_VAULT_KEY, JSON.stringify(idbList.slice(0, 50)));
    }
  } catch {
    // non-fatal
  }
}

// ============================================================================
// Lookup, Verification, Activation & Updates
// ============================================================================

export function findVaultAccountByUid(uid: string): LocalVaultAccount | null {
  if (!uid) return null;
  const records = readVaultRecords();
  return records.find((r) => r.uid === uid) || null;
}

export function findVaultAccountByIdentifier(rawInput: string): LocalVaultAccount | null {
  const cleanedRaw = normalizeDigits(rawInput || '').trim().toLowerCase();
  if (!cleanedRaw) return null;

  const { email, phone } = normalizeAuthIdentifier(rawInput);
  const targetEmail = email.toLowerCase();
  const targetPhone = phone.replace(/[^\d]/g, '').replace(/^00967|^967/, '');

  const records = readVaultRecords();
  return (
    records.find((acc) => {
      const accEmail = (acc.email || '').trim().toLowerCase();
      const accPhone = normalizeDigits(acc.phone || '').replace(/[^\d]/g, '').replace(/^00967|^967/, '');
      const accIdent = normalizeDigits(acc.identifier || '').trim().toLowerCase();

      if (targetEmail && accEmail === targetEmail) return true;
      if (targetPhone && targetPhone.length >= 7 && accPhone === targetPhone) return true;
      if (accIdent === cleanedRaw) return true;
      if (isSuperAdminEmail(targetEmail) && isSuperAdminEmail(accEmail)) return true;
      return false;
    }) || null
  );
}

/**
 * Verify credentials strictly locally in < 0.05s with ZERO Firebase reads.
 */
export async function verifyLocalVaultPassword(
  rawInput: string,
  password: string
): Promise<LocalVerifyResult> {
  let account = findVaultAccountByIdentifier(rawInput);
  if (!account) {
    // One-time check against IDB mirror in case localStorage was cleared before init completed
    await initLocalAuthVaultFromIdb();
    account = findVaultAccountByIdentifier(rawInput);
  }
  if (!account) {
    return { status: 'not_found', account: null };
  }

  if (account.status === 'suspended' || account.disabled === true) {
    return { status: 'suspended', account };
  }

  if (!account.passwordHash || !account.passwordSalt) {
    return { status: 'not_found', account: null };
  }

  const computedHash = await hashPasswordWithSalt(password, account.passwordSalt);
  if (!timingSafeEqualHex(computedHash, account.passwordHash)) {
    return { status: 'wrong_password', account };
  }

  // Update lastLoginAt locally
  const now = Date.now();
  const updated: LocalVaultAccount = { ...account, lastLoginAt: now };
  const all = readVaultRecords();
  const next = [updated, ...all.filter((r) => r.uid !== updated.uid)];
  writeVaultRecords(next);

  return { status: 'matched', account: updated };
}

/**
 * Save or refresh an activated account inside `localAuthVault` with salted SHA-256 hash.
 */
export async function saveAccountToLocalVault(
  profile: UserProfile,
  password: string,
  rawIdentifier?: string,
  passwordVersion?: string
): Promise<LocalVaultAccount> {
  const salt = generateSaltHex(16);
  const passwordHash = await hashPasswordWithSalt(password, salt);
  const now = Date.now();
  const all = readVaultRecords();
  const existing = all.find((r) => r.uid === profile.uid);

  const normalizedPhone =
    normalizeDigits(profile.phone || '').replace(/[^\d]/g, '') ||
    (isSuperAdminEmail(profile.email) ? SUPER_ADMIN_CONFIG.phone : '');

  const record: LocalVaultAccount = {
    uid: profile.uid,
    email: (profile.email || '').trim().toLowerCase(),
    phone: normalizedPhone,
    identifier: (rawIdentifier || existing?.identifier || profile.phone || profile.email || '').trim(),
    name: profile.name || existing?.name || 'مستخدم طيبة نت',
    role: profile.role,
    status: profile.status,
    disabled: profile.status === 'suspended',
    parentAgentId: profile.parentAgentId || '',
    discountRate: typeof profile.discountRate === 'number' ? profile.discountRate : 100,
    balance: typeof profile.balance === 'number' ? profile.balance : 0,
    passwordSalt: salt,
    passwordHash,
    passwordVersion: passwordVersion ?? existing?.passwordVersion,
    activatedAt: existing?.activatedAt || now,
    lastLoginAt: now,
    updatedAt: now,
  };

  const next = [record, ...all.filter((r) => r.uid !== profile.uid && r.email !== record.email)];
  writeVaultRecords(next);
  return record;
}

/**
 * Update profile metadata/status/balance/disabled flag from silent background check
 * without disturbing the stored salted password hash.
 */
export function updateVaultAccountProfile(
  uid: string,
  patch: Partial<
    Pick<
      LocalVaultAccount,
      'name' | 'phone' | 'email' | 'role' | 'status' | 'disabled' | 'parentAgentId' | 'discountRate' | 'balance' | 'passwordVersion'
    >
  >
): LocalVaultAccount | null {
  const all = readVaultRecords();
  const idx = all.findIndex((r) => r.uid === uid);
  if (idx === -1) return null;

  const updated: LocalVaultAccount = {
    ...all[idx],
    ...patch,
    updatedAt: Date.now(),
  };
  all[idx] = updated;
  writeVaultRecords(all);
  return updated;
}

/**
 * Directly update a user's local salted SHA-256 hash when synced from admin password change.
 */
export function updateVaultAccountHashDirectly(
  uid: string,
  passwordHash: string,
  passwordSalt: string,
  passwordVersion?: string
): boolean {
  if (!uid || !passwordHash || !passwordSalt) return false;
  const all = readVaultRecords();
  const idx = all.findIndex((r) => r.uid === uid);
  if (idx === -1) return false;

  all[idx] = {
    ...all[idx],
    passwordHash,
    passwordSalt,
    passwordVersion: passwordVersion ?? all[idx].passwordVersion,
    updatedAt: Date.now(),
  };
  writeVaultRecords(all);
  return true;
}

/**
 * Remove a stale local vault entry (e.g. if admin remotely changed password without providing a local hash)
 * so the next login verifies once against Firebase and re-saves the new salted hash.
 */
export function removeVaultAccount(uid: string): void {
  if (!uid) return;
  const all = readVaultRecords();
  const filtered = all.filter((r) => r.uid !== uid);
  if (filtered.length !== all.length) {
    writeVaultRecords(filtered);
  }
}

export function vaultAccountToUserProfile(acc: LocalVaultAccount): UserProfile {
  return {
    uid: acc.uid,
    name: acc.name,
    phone: acc.phone,
    email: acc.email,
    role: acc.role,
    status: acc.disabled ? 'suspended' : acc.status,
    parentAgentId: acc.parentAgentId || '',
    discountRate: acc.discountRate,
    balance: acc.balance,
    fcmTokens: [],
  };
}

/**
 * Enforce a hard timeout (default 3 seconds) on first-time cloud activation calls
 * so login never hangs on slow or blocked connections.
 */
export class CloudTimeoutError extends Error {
  code = 'cloud/timeout';
  constructor(message = 'CLOUD_ACTIVATION_TIMEOUT') {
    super(message);
    this.name = 'CloudTimeoutError';
  }
}

export function raceWithTimeout<T>(promise: Promise<T>, timeoutMs = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new CloudTimeoutError(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (val) => {
        window.clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}
