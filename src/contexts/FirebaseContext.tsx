import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  terminate,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  generateSafeDocId,
  handleFirestoreError,
  isFirestoreOfflineError,
  isFirestoreQuotaError,
  isSuperAdminEmail,
  normalizeDigits,
  OperationType,
  requestFCMToken,
  testFirestoreConnection,
} from '../lib/firebase';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  DEFAULT_APP_SETTINGS,
  EXCLUSIVE_PACKAGES,
  SUPER_ADMIN_CONFIG,
  type AppRoute,
  type AppSettingsDoc,
  type AuditLogDoc,
  type CardDoc,
  type CustomerAccount,
  type LedgerEntry,
  type NotificationDoc,
  type PackageDoc,
  type PasswordResetRequest,
  type RegistrationRequest,
  type SaleDoc,
  type SaleLineItem,
  type TopupLineItem,
  type TopupRequest,
  type UserProfile,
} from '../types/taibah';
import { useFeedback } from '../lib/feedback';
import {
  clearMemorySessionCredentials,
} from '../lib/biometric';
import {
  appendCachedAvailableCards,
  clearAllLocalOfflineCardCaches,
  clearOfflineSalesQueueOnly,
  consumeCachedAvailableCards,
  enqueueOfflineSale,
  getCachedAvailableCards,
  getPendingOfflineSales,
  isCardLocallyLocked,
  lockCardsLocally,
  offlineSaleToSaleDoc,
  releaseCardLocksLocally,
  removeCardsFromCache,
  removeSyncedOfflineSale,
  saveCachedAvailableCards,
  type CachedAvailableCard,
  type OfflineQueuedSale,
} from '../lib/offlineCards';
import { setGlobalShareTemplates } from '../utils/shareExport';
import {
  clearActiveSession,
  hasActiveSessionUnlocked,
  readActiveProfileFromSession,
  readActiveRouteFromSession,
  saveActiveProfileToSession,
  saveActiveRouteToSession,
} from '../lib/sessionGuard';

export interface SaleExecutionInput {
  saleType: 'direct' | 'electronic_wholesale' | 'paper_invoice';
  buyerId?: string;
  buyerName: string;
  buyerPhone?: string;
  buyerRole: 'consumer' | 'client' | 'agent';
  paymentMethod: 'cash' | 'credit' | 'partial';
  discountRate: number;
  paidAmount: number;
  notes?: string;
  items: Array<{
    packageId: string;
    quantity: number;
    deliverNow?: number;
  }>;
}

export interface ImportCardsResult {
  totalParsed: number;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  elapsedMs?: number;
}

interface FirebaseContextValue {
  authReady: boolean;
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  profileLoading: boolean;
  needsAdminEmailVerification: boolean;
  isOnline: boolean;
  firestoreConnected: boolean;
  isSyncing: boolean;
  packages: PackageDoc[];
  totalAvailableCards: number;
  sales: SaleDoc[];
  customers: CustomerAccount[];
  ledgerEntries: LedgerEntry[];
  notifications: NotificationDoc[];
  unreadNotificationsCount: number;
  pendingRegistrations: RegistrationRequest[];
  pendingPasswordResets: PasswordResetRequest[];
  topupRequests: TopupRequest[];
  pendingTopups: TopupRequest[];
  appSettings: AppSettingsDoc;
  auditLogs: AuditLogDoc[];
  managedUsers: UserProfile[];
  // Update 12: Route-scoped lazy listener control & pagination
  activeRoute: AppRoute;
  setActiveRoute: (route: AppRoute) => void;
  hasMoreSales: boolean;
  loadMoreSales: () => void;
  hasMoreCustomers: boolean;
  loadMoreCustomers: () => void;
  hasMoreAuditLogs: boolean;
  loadMoreAuditLogs: () => void;
  refreshVerificationStatus: () => Promise<boolean>;
  syncNow: () => Promise<void>;
  signOutUser: () => Promise<void>;
  writeAuditLog: (action: string, details: string) => Promise<void>;
  sendCloudNotification: (params: {
    recipientId: string;
    title: string;
    body: string;
    category: NotificationDoc['category'];
    targetRoute: AppRoute;
  }) => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  updateAppSettings: (updates: Partial<Omit<AppSettingsDoc, 'updatedAt'>>) => Promise<void>;
  // Cards & Packages
  importCardsBatch: (
    packageId: string,
    rawCardNumbers: string[],
    onProgress?: (percent: number, done: number, total: number) => void
  ) => Promise<ImportCardsResult>;
  updatePackageInfo: (
    packageId: string,
    updates: Partial<Pick<PackageDoc, 'dataLabel' | 'hoursLabel' | 'validityLabel' | 'price'>>
  ) => Promise<void>;
  // Sales & Wholesale & Paper Invoices
  executeSaleTransaction: (input: SaleExecutionInput) => Promise<SaleDoc | null>;
  deliverPartialCards: (sale: SaleDoc, packageId: string, countToDeliver: number) => Promise<string[]>;
  processSaleReturn: (sale: SaleDoc, packageId: string, returnQty: number) => Promise<boolean>;
  updateSaleRecord: (
    saleId: string,
    updates: Partial<
      Pick<
        SaleDoc,
        'buyerName' | 'buyerPhone' | 'paidAmount' | 'remainingAmount' | 'realizedProfit' | 'paymentMethod' | 'notes' | 'status'
      >
    >
  ) => Promise<void>;
  deleteSaleRecord: (saleId: string) => Promise<void>;
  // Customers & General Ledger
  createCustomerAccount: (input: {
    name: string;
    phone?: string;
    category?: string;
    notes?: string;
    initialDebit?: number;
    initialCredit?: number;
  }) => Promise<CustomerAccount | null>;
  updateCustomerAccount: (
    customerId: string,
    updates: Partial<Pick<CustomerAccount, 'name' | 'phone' | 'category' | 'notes'>>
  ) => Promise<void>;
  deleteCustomerAccount: (customerId: string) => Promise<void>;
  addLedgerEntry: (input: {
    customerId: string;
    entryType: 'debit' | 'credit' | 'adjustment';
    amount: number;
    description: string;
  }) => Promise<boolean>;
  deleteLedgerEntry: (entry: LedgerEntry) => Promise<void>;
  // Topup Requests
  submitTopupRequest: (input: {
    items: TopupLineItem[];
    notes?: string;
  }) => Promise<boolean>;
  approveTopupRequest: (req: TopupRequest) => Promise<boolean>;
  rejectTopupRequest: (req: TopupRequest, reason: string) => Promise<void>;
  // Agents, Clients, Join Requests, Password Resets
  approveRegistration: (req: RegistrationRequest, roleOverride?: 'agent' | 'client') => Promise<void>;
  rejectRegistration: (req: RegistrationRequest, reason: string) => Promise<void>;
  createManualUser: (input: {
    name: string;
    phone: string;
    email?: string;
    role: 'agent' | 'client';
    parentAgentId?: string;
    discountRate?: number;
  }) => Promise<boolean>;
  updateManagedUser: (
    uid: string,
    updates: Partial<Pick<UserProfile, 'name' | 'phone' | 'role' | 'status' | 'discountRate' | 'balance' | 'parentAgentId'>>
  ) => Promise<void>;
  toggleUserRoleUpgrade: (user: UserProfile) => Promise<void>;
  transferClientsToAgent: (clientUids: string[], targetAgentId: string) => Promise<void>;
  deleteManagedUser: (user: UserProfile) => Promise<void>;
  resolvePasswordReset: (req: PasswordResetRequest, status: 'approved' | 'rejected') => Promise<void>;
  // Push, Backup, Account Recovery & Super Admin Reset
  enablePushNotifications: () => Promise<boolean>;
  exportCloudBackup: () => Promise<void>;
  restoreDeletedAgentsAndClients: (
    onProgress?: (stage: string) => void
  ) => Promise<{
    ok: boolean;
    restoredCount: number;
    updatedClientsMirrorCount: number;
    totalFound: number;
    sourcesSummary: string;
    summary: string;
  }>;
  resetAppData: (
    scope: 'sales_only' | 'full_reset',
    adminPassword: string,
    onProgress?: (stage: string) => void
  ) => Promise<{ ok: boolean; error?: string; deletedCount: number }>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

const CACHE_PROFILE_KEY = 'taibah_cached_profile_v1';
const CACHE_PROFILE_UID_PREFIX = 'taibah_cached_profile_uid_v1_';
const CACHE_PROFILE_EMAIL_PREFIX = 'taibah_cached_profile_email_v1_';
const CACHE_PACKAGES_KEY = 'taibah_cached_packages_v1';
const CACHE_SETTINGS_KEY = 'taibah_cached_settings_v1';
const CACHE_SALES_PREFIX = 'taibah_cached_sales_v1_';
const CACHE_CUSTOMERS_PREFIX = 'taibah_cached_customers_v1_';
const CACHE_AUTO_BACKUP_KEY = 'taibah_auto_backup_v1';
const CACHE_USERS_LIST_KEY = 'taibah_cached_users_v1';
const CACHE_STATS_PREFIX = 'taibah_stats_summary_v1_';
const CACHE_SYNC_TS_PREFIX = 'taibah_last_sync_ms_v1_';

interface PackageCounterStats {
  availableCount?: number;
  soldCount?: number;
  uploadedCount?: number;
  injectedCount?: number;
}

interface StatsSummaryDocData {
  ownerId?: string;
  totalAvailable?: number;
  totalSold?: number;
  totalUploaded?: number;
  totalInjected?: number;
  packages?: Record<string, PackageCounterStats>;
  updatedAt?: Timestamp;
}

/**
 * Atomically apply incremental package counter deltas to the single lightweight
 * `stats/summary` (admin) or `stats/user_{uid}` (agent/client) document.
 */
async function applyStatsSummaryDelta(
  statDocId: string,
  ownerId: string,
  deltas: Record<string, { available?: number; sold?: number; uploaded?: number; injected?: number }>
): Promise<void> {
  const pkgEntries = Object.entries(deltas);
  if (pkgEntries.length === 0) return;

  let totalAvailDelta = 0;
  let totalSoldDelta = 0;
  let totalUploadedDelta = 0;
  let totalInjectedDelta = 0;
  const packagesUpdate: Record<string, Record<string, unknown>> = {};

  for (const [pkgId, d] of pkgEntries) {
    const pkgPatch: Record<string, unknown> = {};
    if (d.available) {
      pkgPatch.availableCount = increment(d.available);
      totalAvailDelta += d.available;
    }
    if (d.sold) {
      pkgPatch.soldCount = increment(d.sold);
      totalSoldDelta += d.sold;
    }
    if (d.uploaded) {
      pkgPatch.uploadedCount = increment(d.uploaded);
      totalUploadedDelta += d.uploaded;
    }
    if (d.injected) {
      pkgPatch.injectedCount = increment(d.injected);
      totalInjectedDelta += d.injected;
    }
    if (Object.keys(pkgPatch).length > 0) {
      packagesUpdate[pkgId] = pkgPatch;
    }
  }

  if (Object.keys(packagesUpdate).length === 0) return;

  const payload: Record<string, unknown> = {
    ownerId,
    packages: packagesUpdate,
    updatedAt: serverTimestamp(),
  };
  if (totalAvailDelta !== 0) payload.totalAvailable = increment(totalAvailDelta);
  if (totalSoldDelta !== 0) payload.totalSold = increment(totalSoldDelta);
  if (totalUploadedDelta !== 0) payload.totalUploaded = increment(totalUploadedDelta);
  if (totalInjectedDelta !== 0) payload.totalInjected = increment(totalInjectedDelta);

  await setDoc(doc(db, 'stats', statDocId), payload, { merge: true }).catch(() => {
    // Non-blocking: local cache already reflects optimistic counts
  });
}

function readCachedJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeCachedJson(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // ignore storage quota errors
  }
}

function serializeProfileForCache(p: UserProfile): Omit<UserProfile, 'createdAt' | 'updatedAt'> {
  return {
    uid: p.uid,
    name: p.name,
    phone: p.phone,
    email: p.email,
    role: p.role,
    status: p.status,
    parentAgentId: p.parentAgentId,
    discountRate: p.discountRate,
    balance: p.balance,
    fcmTokens: Array.isArray(p.fcmTokens) ? p.fcmTokens.slice(0, 5) : [],
    ...(p.rejectionReason ? { rejectionReason: p.rejectionReason } : {}),
  };
}

function persistProfileToLocalCache(p: UserProfile): void {
  const payload = serializeProfileForCache(p);
  writeCachedJson(CACHE_PROFILE_KEY, payload);
  if (p.uid) {
    writeCachedJson(`${CACHE_PROFILE_UID_PREFIX}${p.uid}`, payload);
  }
  if (p.email) {
    writeCachedJson(`${CACHE_PROFILE_EMAIL_PREFIX}${p.email.trim().toLowerCase()}`, payload);
  }
}

function readProfileFromLocalCache(user: FirebaseUser): UserProfile | null {
  const emailLower = (user.email || '').trim().toLowerCase();
  const byUid = readCachedJson<UserProfile | null>(`${CACHE_PROFILE_UID_PREFIX}${user.uid}`, null);
  if (byUid && byUid.uid === user.uid) return byUid;
  const primary = readCachedJson<UserProfile | null>(CACHE_PROFILE_KEY, null);
  if (
    primary &&
    (primary.uid === user.uid ||
      (emailLower.length > 0 && primary.email?.trim().toLowerCase() === emailLower))
  ) {
    return { ...primary, uid: user.uid };
  }
  if (emailLower) {
    const byEmail = readCachedJson<UserProfile | null>(`${CACHE_PROFILE_EMAIL_PREFIX}${emailLower}`, null);
    if (byEmail) return { ...byEmail, uid: user.uid };
  }
  return null;
}

function buildSuperAdminProfile(user: FirebaseUser): UserProfile {
  return {
    uid: user.uid,
    name: SUPER_ADMIN_CONFIG.name,
    phone: SUPER_ADMIN_CONFIG.phone,
    email: (user.email || SUPER_ADMIN_CONFIG.email).trim().toLowerCase(),
    role: 'super_admin',
    status: 'active',
    parentAgentId: '',
    discountRate: 100,
    balance: 0,
    fcmTokens: [],
  };
}

function extractNormalizedPhoneFromAuthUser(user: FirebaseUser): string {
  const rawPhone = user.phoneNumber || '';
  if (rawPhone) {
    const digits = normalizeDigits(rawPhone).replace(/[^\d]/g, '').replace(/^00967|^967/, '');
    if (digits.length >= 7) return digits;
  }
  const email = (user.email || '').trim().toLowerCase();
  if (email.includes('@')) {
    const localPart = email.split('@')[0] || '';
    const digits = normalizeDigits(localPart).replace(/[^\d]/g, '').replace(/^00967|^967/, '');
    if (digits.length >= 7) return digits;
  }
  return '';
}

function normalizePhoneDigits(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const digits = normalizeDigits(raw).replace(/[^\d]/g, '').replace(/^00967|^967/, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

function serializePlainAccountForBackup(raw: Record<string, unknown>, fallbackId: string): Record<string, unknown> {
  const phone = normalizePhoneDigits(raw.phone) || (typeof raw.phone === 'string' ? raw.phone.trim().slice(0, 20) : '');
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase().slice(0, 120) : '';
  const role =
    raw.role === 'super_admin' || raw.role === 'agent' || raw.role === 'client' ? raw.role : 'client';
  const status =
    raw.status === 'active' ||
    raw.status === 'pending' ||
    raw.status === 'rejected' ||
    raw.status === 'suspended'
      ? raw.status
      : 'active';
  return {
    uid: typeof raw.uid === 'string' && raw.uid.trim() ? raw.uid.trim().slice(0, 128) : fallbackId,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 100) : phone || 'مستخدم طيبة نت',
    phone,
    email,
    role,
    status,
    parentAgentId: typeof raw.parentAgentId === 'string' ? raw.parentAgentId.slice(0, 128) : '',
    discountRate:
      typeof raw.discountRate === 'number'
        ? raw.discountRate
        : role === 'agent'
        ? 70
        : role === 'super_admin'
        ? 100
        : 80,
    balance: typeof raw.balance === 'number' ? raw.balance : 0,
  };
}

function findCachedAccountInBackups(user: FirebaseUser): Partial<UserProfile> | null {
  const uid = user.uid;
  const emailLower = (user.email || '').trim().toLowerCase();
  const phoneDigits = extractNormalizedPhoneFromAuthUser(user);

  const candidates: Array<Record<string, unknown>> = [];
  const cachedList = readCachedJson<Array<Record<string, unknown>>>(CACHE_USERS_LIST_KEY, []);
  if (Array.isArray(cachedList)) candidates.push(...cachedList);
  const autoBackup = readCachedJson<{ users?: Array<Record<string, unknown>>; clients?: Array<Record<string, unknown>> } | null>(
    CACHE_AUTO_BACKUP_KEY,
    null
  );
  if (autoBackup?.users && Array.isArray(autoBackup.users)) candidates.push(...autoBackup.users);
  if (autoBackup?.clients && Array.isArray(autoBackup.clients)) candidates.push(...autoBackup.clients);

  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const itemUid = typeof item.uid === 'string' ? item.uid.trim() : '';
    const itemEmail = typeof item.email === 'string' ? item.email.trim().toLowerCase() : '';
    const itemPhone = normalizePhoneDigits(item.phone);
    if (
      (itemUid && itemUid === uid) ||
      (emailLower && itemEmail && itemEmail === emailLower) ||
      (phoneDigits && itemPhone && itemPhone === phoneDigits)
    ) {
      return {
        uid,
        name: typeof item.name === 'string' ? item.name.trim() : undefined,
        phone: itemPhone || phoneDigits || undefined,
        email: itemEmail || emailLower || undefined,
        role:
          item.role === 'agent' || item.role === 'client' || item.role === 'super_admin'
            ? item.role
            : 'client',
        status:
          item.status === 'active' ||
          item.status === 'pending' ||
          item.status === 'rejected' ||
          item.status === 'suspended'
            ? item.status
            : 'active',
        parentAgentId: typeof item.parentAgentId === 'string' ? item.parentAgentId : '',
        discountRate: typeof item.discountRate === 'number' ? item.discountRate : undefined,
        balance: typeof item.balance === 'number' ? item.balance : 0,
      };
    }
  }
  return null;
}

function buildAutoRecoveredProfile(
  user: FirebaseUser,
  defaultClientDiscount: number,
  cachedHint?: Partial<UserProfile> | null
): UserProfile {
  const uid = user.uid;
  const emailLower = (user.email || '').trim().toLowerCase();
  const phoneDigits = extractNormalizedPhoneFromAuthUser(user);
  const resolvedPhone = (
    normalizePhoneDigits(cachedHint?.phone) ||
    phoneDigits ||
    '770000000'
  ).slice(0, 20);
  const resolvedEmail = (
    emailLower ||
    (cachedHint?.email && cachedHint.email.includes('@') ? cachedHint.email.trim().toLowerCase() : '') ||
    `${resolvedPhone}@taibah.net`
  ).slice(0, 120);
  const rawName =
    (cachedHint?.name && cachedHint.name.trim().length >= 2 ? cachedHint.name.trim() : '') ||
    (user.displayName && user.displayName.trim().length >= 2 ? user.displayName.trim() : '') ||
    (phoneDigits ? `حساب ${phoneDigits}` : 'مستخدم طيبة نت');
  const safeClientDiscount = Math.max(80, Math.min(100, Number(defaultClientDiscount) || 80));

  return {
    uid,
    name: rawName.slice(0, 100),
    phone: resolvedPhone,
    email: resolvedEmail,
    role: 'client',
    status: 'active',
    parentAgentId: '',
    discountRate: safeClientDiscount,
    balance: 0,
    fcmTokens: [],
  };
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isOnline = useOnlineStatus();
  const { notifySuccess, notifyError, notifyWarning, notifyInfo } = useFeedback();

  const cachedProfileInitial = useMemo(
    () => readActiveProfileFromSession() || readCachedJson<UserProfile | null>(CACHE_PROFILE_KEY, null),
    []
  );

  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [verificationVersion, setVerificationVersion] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(cachedProfileInitial);
  const [profileLoading, setProfileLoading] = useState(!cachedProfileInitial);
  const [firestoreConnected, setFirestoreConnected] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNonce, setSyncNonce] = useState(0);
  const [adminDocApproved, setAdminDocApproved] = useState(false);
  const [adminApprovalChecking, setAdminApprovalChecking] = useState(false);
  const explicitSignOutRef = useRef<boolean>(false);
  const bootstrappingUidRef = useRef<string | null>(null);
  const pendingBootstrapRef = useRef<boolean>(false);
  const pendingProfileLookupRef = useRef<boolean>(false);
  const profileLookupRunningRef = useRef<string | null>(null);
  const inFlightOpsRef = useRef<Set<string>>(new Set());

  // Update 12: Active route & pagination limits for lazy on-demand Firestore subscriptions
  const [activeRoute, setActiveRouteState] = useState<AppRoute>(
    () => readActiveRouteFromSession() || 'home'
  );
  const setActiveRoute = useCallback((next: AppRoute) => {
    setActiveRouteState(next);
    saveActiveRouteToSession(next);
  }, []);
  const [salesLimit, setSalesLimit] = useState(40);
  const [customersLimit, setCustomersLimit] = useState(50);
  const [auditLogsLimit, setAuditLogsLimit] = useState(40);

  const [rawPackages, setRawPackages] = useState<PackageDoc[]>(() =>
    readCachedJson<PackageDoc[]>(CACHE_PACKAGES_KEY, [])
  );
  const [personalCardCounts, setPersonalCardCounts] = useState<Record<string, number>>({});
  const [personalSoldCounts, setPersonalSoldCounts] = useState<Record<string, number>>({});
  const [offlinePoolVersion, setOfflinePoolVersion] = useState(0);
  const [pendingOfflineSales, setPendingOfflineSales] = useState<OfflineQueuedSale[]>(() =>
    getPendingOfflineSales()
  );
  const [sales, setSales] = useState<SaleDoc[]>(() =>
    cachedProfileInitial?.uid
      ? readCachedJson<SaleDoc[]>(`${CACHE_SALES_PREFIX}${cachedProfileInitial.uid}`, [])
      : []
  );
  const [customers, setCustomers] = useState<CustomerAccount[]>(() =>
    cachedProfileInitial?.uid
      ? readCachedJson<CustomerAccount[]>(`${CACHE_CUSTOMERS_PREFIX}${cachedProfileInitial.uid}`, [])
      : []
  );
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [pendingRegistrations, setPendingRegistrations] = useState<RegistrationRequest[]>([]);
  const [pendingPasswordResets, setPendingPasswordResets] = useState<PasswordResetRequest[]>([]);
  const [topupRequests, setTopupRequests] = useState<TopupRequest[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettingsDoc>(() => ({
    ...DEFAULT_APP_SETTINGS,
    ...readCachedJson<Partial<AppSettingsDoc>>(CACHE_SETTINGS_KEY, {}),
  }));
  const [auditLogs, setAuditLogs] = useState<AuditLogDoc[]>([]);
  const [managedUsers, setManagedUsers] = useState<UserProfile[]>([]);

  const loadMoreSales = useCallback(() => setSalesLimit((prev) => prev + 40), []);
  const loadMoreCustomers = useCallback(() => setCustomersLimit((prev) => prev + 50), []);
  const loadMoreAuditLogs = useCallback(() => setAuditLogsLimit((prev) => prev + 40), []);

  // Keep global PDF/SMS/WhatsApp templates synchronized with live AppSettings
  useEffect(() => {
    setGlobalShareTemplates(appSettings);
  }, [appSettings]);

  const userUid = firebaseUser?.uid || null;

  // 1. Mount public settings/global listener ONCE (never tear down/resubscribe on online blips)
  useEffect(() => {
    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'global'),
      (snap) => {
        if (!snap.metadata.fromCache) {
          setFirestoreConnected(true);
        }
        if (snap.exists()) {
          const merged: AppSettingsDoc = {
            ...DEFAULT_APP_SETTINGS,
            ...(snap.data() as AppSettingsDoc),
          };
          setAppSettings(merged);
          writeCachedJson(CACHE_SETTINGS_KEY, {
            newsTicker: merged.newsTicker,
            newsTickerEnabled: merged.newsTickerEnabled,
            newsTickerSpeed: merged.newsTickerSpeed,
            sliderEnabled: merged.sliderEnabled,
            sliderSpeed: merged.sliderSpeed,
            sliderSlides: merged.sliderSlides,
            lowStockThreshold: merged.lowStockThreshold,
            agentDiscountPercent: merged.agentDiscountPercent,
            clientDiscountPercent: merged.clientDiscountPercent,
            directSaleMessageTemplate: merged.directSaleMessageTemplate,
            smsMessageTemplate: merged.smsMessageTemplate,
            whatsappMessageTemplate: merged.whatsappMessageTemplate,
            pdfHeaderTitle: merged.pdfHeaderTitle,
            pdfHeaderSubtitle: merged.pdfHeaderSubtitle,
            pdfFooterText: merged.pdfFooterText,
            appDescription: merged.appDescription,
          });
        }
      },
      () => {
        // Silently keep cached/default settings if unreachable prior to auth
      }
    );

    return () => {
      unsubSettings();
    };
  }, []);

  // 2. Silent connectivity & quota-exhaustion observer (Zero startup reads, zero warning banners!)
  useEffect(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFirestoreConnected(false);
    }

    const onQuotaExceeded = () => {
      // Quietly switch indicator to local cache mode without intrusive banners or warnings
      setFirestoreConnected(false);
    };
    window.addEventListener('taibah:firestore-quota-exceeded', onQuotaExceeded);

    return () => {
      window.removeEventListener('taibah:firestore-quota-exceeded', onQuotaExceeded);
    };
  }, [isOnline]);

  // Keep active verified profile mirrored in sessionStorage during active run
  useEffect(() => {
    if (profile && hasActiveSessionUnlocked()) {
      saveActiveProfileToSession(profile);
    }
  }, [profile]);

  // Auth listener decoupled from kicking out active in-progress sessions
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setVerificationVersion((v) => v + 1);
      setAuthReady(true);

      if (!user) {
        // CRITICAL: Never kick an actively unlocked user out on transient null auth emissions
        // (e.g., Android file picker, keyboard focus, visibilitychange, blur, or token refresh).
        // Only clear state on explicit manual sign-out or when no active session is unlocked.
        if (hasActiveSessionUnlocked() && !explicitSignOutRef.current) {
          return;
        }
        setFirebaseUser(null);
        bootstrappingUidRef.current = null;
        pendingBootstrapRef.current = false;
        pendingProfileLookupRef.current = false;
        profileLookupRunningRef.current = null;
        setAdminDocApproved(false);
        setAdminApprovalChecking(false);
        writeCachedJson(CACHE_PROFILE_KEY, null);
        saveActiveProfileToSession(null);
        setProfile(null);
        setProfileLoading(false);
        setRawPackages([]);
        setPersonalCardCounts({});
        setPersonalSoldCounts({});
        setSales([]);
        setCustomers([]);
        setLedgerEntries([]);
        setNotifications([]);
        setPendingRegistrations([]);
        setPendingPasswordResets([]);
        setTopupRequests([]);
        setAuditLogs([]);
        setManagedUsers([]);
      } else {
        explicitSignOutRef.current = false;
        setFirebaseUser(user);
        const cached = readActiveProfileFromSession() || readProfileFromLocalCache(user);
        if (cached && cached.uid === user.uid) {
          setProfile(cached);
          if (cached.role === 'super_admin' && cached.status === 'active') {
            setAdminDocApproved(true);
          }
          setProfileLoading(false);
        } else if (isSuperAdminEmail(user.email)) {
          // Automatic Super Admin instant profile recovery (never blocked even offline or post-reset)
          const adminProfile = buildSuperAdminProfile(user);
          setProfile(adminProfile);
          persistProfileToLocalCache(adminProfile);
          if (user.emailVerified) {
            setAdminDocApproved(true);
          }
          setProfileLoading(false);
        } else {
          setProfileLoading(true);
        }
      }
    });
    return () => unsub();
  }, []);

  // Check if an authenticated Super Admin is already approved in Firestore (`admins/{uid}`),
  // so approved admins enter directly without waiting for or flashing a redundant email verification gate.
  useEffect(() => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!authReady || !activeUser || !isSuperAdminEmail(activeUser.email)) {
      setAdminDocApproved(false);
      setAdminApprovalChecking(false);
      return;
    }
    if (activeUser.emailVerified) {
      setAdminApprovalChecking(false);
    } else {
      setAdminApprovalChecking(true);
    }
    let active = true;
    getDoc(doc(db, 'admins', activeUser.uid))
      .then((snap) => {
        if (active && snap.exists()) {
          setAdminDocApproved(true);
        }
      })
      .catch(() => {
        // Firestore rules allow owner get on admins/{uid}; ignore transient offline errors
      })
      .finally(() => {
        if (active) setAdminApprovalChecking(false);
      });
    return () => {
      active = false;
    };
  }, [authReady, firebaseUser, verificationVersion, syncNonce]);

  const needsAdminEmailVerification = useMemo(() => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!activeUser) return false;
    if (!isSuperAdminEmail(activeUser.email)) return false;
    // Never flash email verification while checking admins/{uid} or if already approved/verified
    if (adminApprovalChecking || adminDocApproved || activeUser.emailVerified) return false;
    if (profile && profile.uid === activeUser.uid && profile.role === 'super_admin' && profile.status === 'active') {
      return false;
    }
    return true;
  }, [firebaseUser, verificationVersion, adminApprovalChecking, adminDocApproved, profile]);

  // Bootstrap Super Admin docs + 8 exclusive packages (starting at 0) + default settings
  const bootstrapSuperAdminIfNeeded = useCallback(async (user: FirebaseUser): Promise<boolean> => {
    const currentUser = auth.currentUser || user;
    if (!isSuperAdminEmail(currentUser.email)) return false;
    if (!currentUser.emailVerified && !adminDocApproved) return false;
    const bootstrapCacheKey = `taibah_sa_bootstrapped_v1_${currentUser.uid}`;
    try {
      if (localStorage.getItem(bootstrapCacheKey) === '1' && rawPackages.length >= EXCLUSIVE_PACKAGES.length) {
        setAdminDocApproved(true);
        return true;
      }
    } catch {
      // ignore storage access errors
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      pendingBootstrapRef.current = true;
      return false;
    }
    if (bootstrappingUidRef.current === currentUser.uid) return true;
    bootstrappingUidRef.current = currentUser.uid;

    try {
      const adminRef = doc(db, 'admins', currentUser.uid);
      const adminSnap = await getDoc(adminRef);
      if (!adminSnap.exists()) {
        const tokenResult = await currentUser.getIdTokenResult(true);
        if (tokenResult.claims.email_verified !== true) {
          bootstrappingUidRef.current = null;
          return false;
        }
        await setDoc(adminRef, {
          uid: currentUser.uid,
          name: SUPER_ADMIN_CONFIG.name,
          phone: SUPER_ADMIN_CONFIG.phone,
          email: currentUser.email || SUPER_ADMIN_CONFIG.email,
          role: 'super_admin',
          createdAt: serverTimestamp(),
        });
      }
      setAdminDocApproved(true);

      const userRef = doc(db, 'users', currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: currentUser.uid,
          name: SUPER_ADMIN_CONFIG.name,
          phone: SUPER_ADMIN_CONFIG.phone,
          email: currentUser.email || SUPER_ADMIN_CONFIG.email,
          role: 'super_admin',
          status: 'active',
          parentAgentId: '',
          discountRate: 100,
          balance: 0,
          fcmTokens: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const existingData = userSnap.data() as Partial<UserProfile>;
        if (existingData.role !== 'super_admin' || existingData.status !== 'active') {
          await setDoc(
            userRef,
            {
              uid: currentUser.uid,
              name: existingData.name || SUPER_ADMIN_CONFIG.name,
              phone: existingData.phone || SUPER_ADMIN_CONFIG.phone,
              email: existingData.email || currentUser.email || SUPER_ADMIN_CONFIG.email,
              role: 'super_admin',
              status: 'active',
              parentAgentId: existingData.parentAgentId ?? '',
              discountRate: typeof existingData.discountRate === 'number' ? existingData.discountRate : 100,
              balance: typeof existingData.balance === 'number' ? existingData.balance : 0,
              fcmTokens: Array.isArray(existingData.fcmTokens) ? existingData.fcmTokens.slice(0, 5) : [],
              createdAt: existingData.createdAt || serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      // Seed default 8 packages & global settings in parallel without blocking login entry
      void Promise.allSettled([
        (async () => {
          const pkgSnap = await getDocs(query(collection(db, 'packages'), where('price', '>', 0)));
          if (pkgSnap.empty) {
            const batch = writeBatch(db);
            for (const pkg of EXCLUSIVE_PACKAGES) {
              const pkgRef = doc(db, 'packages', pkg.id);
              batch.set(pkgRef, {
                code: pkg.code,
                price: pkg.price,
                dataLabel: pkg.dataLabel,
                hoursLabel: pkg.hoursLabel,
                validityLabel: pkg.validityLabel,
                colorTheme: pkg.colorTheme,
                availableCount: 0,
                soldCount: 0,
                uploadedCount: 0,
                injectedCount: 0,
                sortOrder: pkg.sortOrder,
                updatedAt: serverTimestamp(),
              });
            }
            await batch.commit();
          }
        })(),
        (async () => {
          const settingsRef = doc(db, 'settings', 'global');
          const settingsSnap = await getDoc(settingsRef);
          if (!settingsSnap.exists()) {
            await setDoc(settingsRef, {
              ...DEFAULT_APP_SETTINGS,
              updatedAt: serverTimestamp(),
            });
          }
        })(),
      ]);

      try {
        localStorage.setItem(bootstrapCacheKey, '1');
      } catch {
        // ignore storage errors
      }
      pendingBootstrapRef.current = false;
      setFirestoreConnected(true);
      return true;
    } catch (err) {
      bootstrappingUidRef.current = null;
      if (isFirestoreQuotaError(err)) {
        handleFirestoreError(err, OperationType.WRITE, 'bootstrap_super_admin');
        return false;
      }
      if (isFirestoreOfflineError(err)) {
        pendingBootstrapRef.current = true;
        setFirestoreConnected(false);
        return false;
      }
      handleFirestoreError(err, OperationType.WRITE, 'bootstrap_super_admin');
      return false;
    }
  }, [adminDocApproved, rawPackages.length]);

  // Smart Multi-Strategy Account Profile Lookup (UID -> Email -> Phone across `users` & `clients`)
  // + Automatic UID linking (`setDoc` with `merge: true`) + Offline-First local cache fallback
  const resolveAndLinkUserProfile = useCallback(
    async (user: FirebaseUser): Promise<UserProfile | null> => {
      const uid = user.uid;
      const emailLower = (user.email || '').trim().toLowerCase();
      const emailRaw = (user.email || '').trim();
      const phoneDigits = extractNormalizedPhoneFromAuthUser(user);

      // 1. Super Admin automatic profile recovery (nabil77444@gmail.com)
      if (isSuperAdminEmail(user.email)) {
        const adminProfile = buildSuperAdminProfile(user);
        setProfile((prev) =>
          prev && prev.uid === uid && prev.role === 'super_admin' && prev.status === 'active'
            ? prev
            : adminProfile
        );
        persistProfileToLocalCache(adminProfile);
        setProfileLoading(false);
        if (user.emailVerified || adminDocApproved) {
          void bootstrapSuperAdminIfNeeded(user);
        }
        return adminProfile;
      }

      if (profileLookupRunningRef.current === uid) {
        return readProfileFromLocalCache(user);
      }

      // 2. Offline-First: if offline, keep local cache open and schedule retry on reconnect
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        pendingProfileLookupRef.current = true;
        const cached = readProfileFromLocalCache(user);
        if (cached) {
          setProfile(cached);
          setProfileLoading(false);
        }
        return cached;
      }

      profileLookupRunningRef.current = uid;
      try {
        let matchedCol: 'users' | 'clients' | null = null;
        let matchedDocId: string | null = null;
        let matchedData: Record<string, unknown> | null = null;
        let hitOfflineError = false;

        const safeGetDoc = async (col: 'users' | 'clients', docId: string) => {
          try {
            const snap = await getDoc(doc(db, col, docId));
            if (snap.exists()) {
              return { id: snap.id, data: snap.data() as Record<string, unknown> };
            }
          } catch (err) {
            if (isFirestoreOfflineError(err)) hitOfflineError = true;
          }
          return null;
        };

        const safeQueryOne = async (col: 'users' | 'clients', field: 'email' | 'phone', val: string) => {
          if (!val) return null;
          try {
            const snap = await getDocs(query(collection(db, col), where(field, '==', val), limit(1)));
            if (!snap.empty) {
              const d = snap.docs[0];
              return { id: d.id, data: d.data() as Record<string, unknown> };
            }
          } catch (err) {
            if (isFirestoreOfflineError(err)) hitOfflineError = true;
          }
          return null;
        };

        // Strategy A: Lookup by UID (`users/{uid}` then `clients/{uid}`)
        const byUidUsers = await safeGetDoc('users', uid);
        if (byUidUsers) {
          matchedCol = 'users';
          matchedDocId = byUidUsers.id;
          matchedData = byUidUsers.data;
        } else {
          const byUidClients = await safeGetDoc('clients', uid);
          if (byUidClients) {
            matchedCol = 'clients';
            matchedDocId = byUidClients.id;
            matchedData = byUidClients.data;
          }
        }

        // Strategy B: Lookup by Email (`users` then `clients`)
        if (!matchedData && emailLower) {
          const byEmailUsers =
            (await safeQueryOne('users', 'email', emailLower)) ||
            (emailRaw && emailRaw !== emailLower ? await safeQueryOne('users', 'email', emailRaw) : null);
          if (byEmailUsers) {
            matchedCol = 'users';
            matchedDocId = byEmailUsers.id;
            matchedData = byEmailUsers.data;
          } else {
            const byEmailClients =
              (await safeQueryOne('clients', 'email', emailLower)) ||
              (emailRaw && emailRaw !== emailLower ? await safeQueryOne('clients', 'email', emailRaw) : null);
            if (byEmailClients) {
              matchedCol = 'clients';
              matchedDocId = byEmailClients.id;
              matchedData = byEmailClients.data;
            }
          }
        }

        // Strategy C: Lookup by Phone extracted from phoneNumber or email local part before '@' (`users` then `clients`)
        if (!matchedData && phoneDigits.length >= 7) {
          const byPhoneUsers = await safeQueryOne('users', 'phone', phoneDigits);
          if (byPhoneUsers) {
            matchedCol = 'users';
            matchedDocId = byPhoneUsers.id;
            matchedData = byPhoneUsers.data;
          } else {
            const byPhoneClients = await safeQueryOne('clients', 'phone', phoneDigits);
            if (byPhoneClients) {
              matchedCol = 'clients';
              matchedDocId = byPhoneClients.id;
              matchedData = byPhoneClients.data;
            }
          }
        }

        // Strategy D: If not found in `users` or `clients`, check if user has a pending/rejected registration request,
        // otherwise IMMEDIATELY self-recover & auto-create an active profile so «تعذر تحميل ملف الحساب» NEVER appears!
        if (!matchedData || !matchedCol || !matchedDocId) {
          let pendingRegData: Record<string, unknown> | null = null;
          if (!hitOfflineError) {
            try {
              const regSnap = await getDocs(
                query(collection(db, 'registrationRequests'), where('applicantUid', '==', uid), limit(1))
              );
              if (!regSnap.empty) {
                pendingRegData = regSnap.docs[0].data() as Record<string, unknown>;
              }
            } catch (err) {
              if (isFirestoreOfflineError(err)) hitOfflineError = true;
            }
          }

          if (pendingRegData && (pendingRegData.status === 'pending' || pendingRegData.status === 'rejected')) {
            const regRole = pendingRegData.requestedRole === 'agent' ? 'agent' : 'client';
            const regPhone =
              normalizePhoneDigits(pendingRegData.phone) || phoneDigits || '770000000';
            const regProfile: UserProfile = {
              uid,
              name:
                typeof pendingRegData.name === 'string' && pendingRegData.name.trim().length >= 2
                  ? pendingRegData.name.trim().slice(0, 100)
                  : `حساب ${regPhone}`,
              phone: regPhone.slice(0, 20),
              email: (
                (typeof pendingRegData.email === 'string' && pendingRegData.email.trim()) ||
                emailLower ||
                `${regPhone}@taibah.net`
              )
                .toLowerCase()
                .slice(0, 120),
              role: regRole,
              status: pendingRegData.status === 'rejected' ? 'rejected' : 'pending',
              parentAgentId:
                typeof pendingRegData.parentAgentId === 'string'
                  ? pendingRegData.parentAgentId.slice(0, 128)
                  : '',
              discountRate: 100,
              balance: 0,
              fcmTokens: [],
              ...(typeof pendingRegData.rejectionReason === 'string' && pendingRegData.rejectionReason
                ? { rejectionReason: pendingRegData.rejectionReason }
                : {}),
            };
            setProfile(regProfile);
            persistProfileToLocalCache(regProfile);
            setProfileLoading(false);
            return regProfile;
          }

          const cachedFallback = readProfileFromLocalCache(user) || findCachedAccountInBackups(user);
          if (hitOfflineError) {
            pendingProfileLookupRef.current = true;
            setFirestoreConnected(false);
            const offlineReady =
              cachedFallback && cachedFallback.name && cachedFallback.role
                ? {
                    uid,
                    name: cachedFallback.name,
                    phone: cachedFallback.phone || phoneDigits || '770000000',
                    email: cachedFallback.email || emailLower || `${phoneDigits || '770000000'}@taibah.net`,
                    role: cachedFallback.role,
                    status: cachedFallback.status || 'active',
                    parentAgentId: cachedFallback.parentAgentId || '',
                    discountRate:
                      cachedFallback.discountRate ??
                      (cachedFallback.role === 'agent'
                        ? appSettings.agentDiscountPercent
                        : appSettings.clientDiscountPercent),
                    balance: cachedFallback.balance ?? 0,
                    fcmTokens: [],
                  }
                : buildAutoRecoveredProfile(user, appSettings.clientDiscountPercent, cachedFallback);
            setProfile(offlineReady);
            persistProfileToLocalCache(offlineReady);
            setProfileLoading(false);
            return offlineReady;
          }

          // Instant Self-Recovery for any authenticated account whose Firestore doc was previously deleted/missing
          const selfRecovered = buildAutoRecoveredProfile(
            user,
            appSettings.clientDiscountPercent,
            cachedFallback
          );
          pendingProfileLookupRef.current = false;
          setFirestoreConnected(true);
          setProfile(selfRecovered);
          persistProfileToLocalCache(selfRecovered);
          setProfileLoading(false);

          // Persist self-recovered profile cleanly into BOTH `users/{uid}` and `clients/{uid}`
          const userWritePayload = {
            uid: selfRecovered.uid,
            name: selfRecovered.name,
            phone: selfRecovered.phone,
            email: selfRecovered.email,
            role: 'client' as const,
            status: 'active' as const,
            parentAgentId: '',
            discountRate: selfRecovered.discountRate,
            balance: 0,
            fcmTokens: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          const clientWritePayload = {
            uid: selfRecovered.uid,
            name: selfRecovered.name,
            phone: selfRecovered.phone,
            email: selfRecovered.email,
            role: 'client' as const,
            status: 'active' as const,
            parentAgentId: '',
            discountRate: selfRecovered.discountRate,
            balance: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(doc(db, 'users', uid), userWritePayload, { merge: true }).catch((err) => {
            if (isFirestoreOfflineError(err)) {
              pendingProfileLookupRef.current = true;
            }
          });
          await setDoc(doc(db, 'clients', uid), clientWritePayload, { merge: true }).catch(() => {
            // Non-blocking mirror write
          });

          return selfRecovered;
        }

        const rawRole = matchedData.role;
        const resolvedRole: UserProfile['role'] =
          rawRole === 'super_admin' || rawRole === 'agent' || rawRole === 'client' ? rawRole : 'client';
        const rawStatus = matchedData.status;
        const resolvedStatus: UserProfile['status'] =
          rawStatus === 'active' ||
          rawStatus === 'pending' ||
          rawStatus === 'rejected' ||
          rawStatus === 'suspended'
            ? rawStatus
            : 'active';
        const resolvedDiscount =
          typeof matchedData.discountRate === 'number'
            ? matchedData.discountRate
            : resolvedRole === 'agent'
            ? appSettings.agentDiscountPercent
            : appSettings.clientDiscountPercent;
        const resolvedBalance = typeof matchedData.balance === 'number' ? matchedData.balance : 0;
        const resolvedPhone =
          typeof matchedData.phone === 'string' && matchedData.phone.trim().length >= 7
            ? matchedData.phone.trim().slice(0, 20)
            : (phoneDigits || '770000000').slice(0, 20);
        const resolvedEmail =
          typeof matchedData.email === 'string' && matchedData.email.trim().length >= 5
            ? matchedData.email.trim().toLowerCase().slice(0, 120)
            : (emailLower || `${resolvedPhone}@taibah.net`).slice(0, 120);
        const resolvedName =
          typeof matchedData.name === 'string' && matchedData.name.trim().length >= 2
            ? matchedData.name.trim().slice(0, 100)
            : (user.displayName?.trim() || resolvedPhone).slice(0, 100);
        const resolvedParentAgentId =
          typeof matchedData.parentAgentId === 'string' ? matchedData.parentAgentId.slice(0, 128) : '';
        const resolvedFcmTokens = Array.isArray(matchedData.fcmTokens)
          ? (matchedData.fcmTokens as unknown[])
              .filter((t): t is string => typeof t === 'string' && t.length <= 300)
              .slice(0, 5)
          : [];

        const resolvedProfile: UserProfile = {
          uid,
          name: resolvedName,
          phone: resolvedPhone,
          email: resolvedEmail,
          role: resolvedRole,
          status: resolvedStatus,
          parentAgentId: resolvedParentAgentId,
          discountRate: resolvedDiscount,
          balance: resolvedBalance,
          fcmTokens: resolvedFcmTokens,
          ...(typeof matchedData.rejectionReason === 'string' && matchedData.rejectionReason
            ? { rejectionReason: matchedData.rejectionReason }
            : {}),
        };

        // Immediately hydrate profile & open Home Screen with exact role & discountRate
        pendingProfileLookupRef.current = false;
        setFirestoreConnected(true);
        setProfile(resolvedProfile);
        persistProfileToLocalCache(resolvedProfile);
        setProfileLoading(false);

        // Auto-link UID (`setDoc` with `merge: true`) so `users/{uid}` and source doc are synced
        const needsCanonicalDoc = matchedCol !== 'users' || matchedDocId !== uid;
        if (needsCanonicalDoc) {
          const canonicalPayload: Record<string, unknown> = {
            uid,
            name: resolvedName,
            phone: resolvedPhone,
            email: resolvedEmail,
            role: resolvedRole,
            status: resolvedStatus,
            parentAgentId: resolvedParentAgentId,
            discountRate: resolvedDiscount,
            balance: resolvedBalance,
            fcmTokens: resolvedFcmTokens,
            linkedSourceId: matchedDocId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(doc(db, 'users', uid), canonicalPayload, { merge: true }).catch(() => {
            // Keep active resolved profile if network is transiently unavailable
          });
          await setDoc(
            doc(db, matchedCol, matchedDocId),
            {
              uid,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          ).catch(() => {
            // Non-blocking legacy link update
          });
        } else if (matchedData.uid !== uid) {
          await setDoc(
            doc(db, 'users', uid),
            {
              uid,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          ).catch(() => {});
        }

        return resolvedProfile;
      } finally {
        profileLookupRunningRef.current = null;
      }
    },
    [adminDocApproved, appSettings.agentDiscountPercent, appSettings.clientDiscountPercent, bootstrapSuperAdminIfNeeded]
  );

  // Stable refs so Firestore onSnapshot listeners NEVER tear down & re-subscribe on callback/state identity changes
  const bootstrapRef = useRef(bootstrapSuperAdminIfNeeded);
  bootstrapRef.current = bootstrapSuperAdminIfNeeded;
  const resolveProfileRef = useRef(resolveAndLinkUserProfile);
  resolveProfileRef.current = resolveAndLinkUserProfile;
  const adminDocApprovedRef = useRef(adminDocApproved);
  adminDocApprovedRef.current = adminDocApproved;
  const adminApprovalCheckingRef = useRef(adminApprovalChecking);
  adminApprovalCheckingRef.current = adminApprovalChecking;
  const clientDiscountPercentRef = useRef(appSettings.clientDiscountPercent);
  clientDiscountPercentRef.current = appSettings.clientDiscountPercent;

  // Separate Super Admin bootstrap effect (never unsubscribes/resubscribes user profile onSnapshot)
  useEffect(() => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!authReady || !activeUser || !userUid || needsAdminEmailVerification) return;
    if (!isSuperAdminEmail(activeUser.email)) return;
    if (activeUser.emailVerified || adminDocApproved) {
      void bootstrapRef.current(activeUser);
    }
  }, [authReady, userUid, adminDocApproved, needsAdminEmailVerification, syncNonce]);

  // Retry deferred bootstrap / profile lookup upon reconnection (WITHOUT calling enableNetwork mid-stream!)
  useEffect(() => {
    if (!isOnline || !firestoreConnected) return;
    const activeUser = auth.currentUser || firebaseUser;
    if (!authReady || !activeUser || !userUid) return;
    if (
      pendingBootstrapRef.current &&
      isSuperAdminEmail(activeUser.email) &&
      (activeUser.emailVerified || adminDocApprovedRef.current)
    ) {
      void bootstrapRef.current(activeUser);
    }
    if (pendingProfileLookupRef.current) {
      void resolveProfileRef.current(activeUser);
    }
  }, [isOnline, firestoreConnected, authReady, userUid]);

  // Listen to current user profile in real time with a STABLE subscription (zero target churn!)
  useEffect(() => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!authReady || !activeUser || !userUid) return;
    if (needsAdminEmailVerification) {
      setProfileLoading(false);
      return;
    }

    let cancelled = false;
    const isAdminAccount = isSuperAdminEmail(activeUser.email);

    // Hydrate from local cache or Super Admin recovery immediately so Home Screen opens without waiting
    const cached = readProfileFromLocalCache(activeUser);
    if (cached) {
      setProfile((prev) => prev || cached);
      setProfileLoading(false);
    } else if (isAdminAccount) {
      const adminProfile = buildSuperAdminProfile(activeUser);
      setProfile((prev) => prev || adminProfile);
      persistProfileToLocalCache(adminProfile);
      setProfileLoading(false);
    }

    const userDocPath = `users/${userUid}`;
    const unsub = onSnapshot(
      doc(db, 'users', userUid),
      (snap) => {
        if (cancelled) return;
        if (!snap.metadata.fromCache) {
          setFirestoreConnected(true);
        }
        if (snap.exists()) {
          const p = snap.data() as UserProfile;
          setProfile(p);
          if (p.role === 'super_admin' && p.status === 'active') {
            setAdminDocApproved(true);
          }
          persistProfileToLocalCache(p);
          setProfileLoading(false);
        } else {
          // Super Admin: NEVER show profile load error — automatically recreate Firestore doc in background
          if (isAdminAccount) {
            const adminProfile = buildSuperAdminProfile(activeUser);
            setProfile((prev) =>
              prev && prev.uid === userUid && prev.role === 'super_admin' ? prev : adminProfile
            );
            persistProfileToLocalCache(adminProfile);
            setProfileLoading(false);
            if (activeUser.emailVerified || adminDocApprovedRef.current) {
              void bootstrapRef.current(activeUser);
            }
            return;
          }

          // If snapshot came from an empty local cache while offline/connecting, keep cached profile active!
          const localCached = readProfileFromLocalCache(activeUser);
          if (snap.metadata.fromCache && localCached) {
            setProfile((prev) => prev || localCached);
            setProfileLoading(false);
            pendingProfileLookupRef.current = true;
            return;
          }

          // Run Smart Multi-Strategy Lookup + Instant Auto-Recovery (UID -> Email -> Phone -> Auto-Create)
          if (!adminApprovalCheckingRef.current) {
            void resolveProfileRef.current(activeUser).then((resolved) => {
              if (cancelled) return;
              if (resolved) {
                setProfile(resolved);
                persistProfileToLocalCache(resolved);
                setProfileLoading(false);
              } else {
                const fallbackCached = readProfileFromLocalCache(activeUser);
                const emergencyProfile =
                  fallbackCached ||
                  buildAutoRecoveredProfile(
                    activeUser,
                    clientDiscountPercentRef.current,
                    findCachedAccountInBackups(activeUser)
                  );
                setProfile(emergencyProfile);
                persistProfileToLocalCache(emergencyProfile);
                setProfileLoading(false);
              }
            });
          }
        }
      },
      (err) => {
        if (isFirestoreOfflineError(err)) {
          setFirestoreConnected(false);
          pendingProfileLookupRef.current = true;
          const localCached = readProfileFromLocalCache(activeUser);
          if (localCached) {
            setProfile((prev) => prev || localCached);
          } else if (isAdminAccount) {
            const adminProfile = buildSuperAdminProfile(activeUser);
            setProfile((prev) => prev || adminProfile);
            persistProfileToLocalCache(adminProfile);
          } else {
            const offlineAuto = buildAutoRecoveredProfile(
              activeUser,
              clientDiscountPercentRef.current,
              findCachedAccountInBackups(activeUser)
            );
            setProfile((prev) => prev || offlineAuto);
            persistProfileToLocalCache(offlineAuto);
          }
        } else {
          handleFirestoreError(err, OperationType.GET, userDocPath);
          if (!isAdminAccount) {
            const localCached = readProfileFromLocalCache(activeUser);
            const safeFallback =
              localCached ||
              buildAutoRecoveredProfile(
                activeUser,
                clientDiscountPercentRef.current,
                findCachedAccountInBackups(activeUser)
              );
            setProfile((prev) => prev || safeFallback);
            persistProfileToLocalCache(safeFallback);
          }
        }
        if (!cancelled) setProfileLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [authReady, userUid, needsAdminEmailVerification, syncNonce]);

  // A. ULTRA-LOW-READ CORE LISTENERS (95% Read Reduction: Single stats/summary doc + Cache-First packages + Tight Real-Time Queues — ZERO open cards listener!)
  useEffect(() => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!authReady || !activeUser || !profile || profile.status !== 'active') {
      return;
    }

    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    const isAdmin = profile.role === 'super_admin';
    const isAgent = profile.role === 'agent';
    const statDocId = isAdmin ? 'summary' : `user_${activeUser.uid}`;
    const statsCacheKey = `${CACHE_STATS_PREFIX}${statDocId}`;

    const applyStatsDocToState = (statsData: StatsSummaryDocData | null) => {
      if (!statsData || !statsData.packages || typeof statsData.packages !== 'object') return;
      const pkgMap = statsData.packages;
      if (isAdmin) {
        setRawPackages((prev) => {
          const base = prev.length > 0 ? prev : (EXCLUSIVE_PACKAGES as PackageDoc[]);
          const next = base.map((pkg) => {
            const c = pkgMap[pkg.id];
            if (!c) return pkg;
            return {
              ...pkg,
              availableCount: Math.max(0, Number(c.availableCount ?? pkg.availableCount ?? 0)),
              soldCount: Math.max(0, Number(c.soldCount ?? pkg.soldCount ?? 0)),
              uploadedCount: Math.max(0, Number(c.uploadedCount ?? pkg.uploadedCount ?? 0)),
              injectedCount: Math.max(0, Number(c.injectedCount ?? pkg.injectedCount ?? 0)),
            };
          });
          writeCachedJson(
            CACHE_PACKAGES_KEY,
            next.map(({ updatedAt: _u, ...rest }) => rest)
          );
          return next;
        });
      } else {
        const availCounts: Record<string, number> = {};
        const soldCounts: Record<string, number> = {};
        for (const [pkgId, c] of Object.entries(pkgMap)) {
          if (!c) continue;
          availCounts[pkgId] = Math.max(0, Number(c.availableCount ?? 0));
          soldCounts[pkgId] = Math.max(0, Number(c.soldCount ?? 0));
        }
        setPersonalCardCounts(availCounts);
        setPersonalSoldCounts(soldCounts);
      }
    };

    // 1. Hydrate immediately from localStorage cache (0 Firestore reads!)
    const cachedStats = readCachedJson<StatsSummaryDocData | null>(statsCacheKey, null);
    if (cachedStats) {
      applyStatsDocToState(cachedStats);
    }

    // 1B. Try IndexedDB local cache FIRST (`getDocFromCache` / `getDocsFromCache` — 0 Firestore server reads!)
    const statsRef = doc(db, 'stats', statDocId);
    void getDocFromCache(statsRef)
      .then((snap) => {
        if (!cancelled && snap.exists()) {
          applyStatsDocToState(snap.data() as StatsSummaryDocData);
        }
      })
      .catch(() => {});

    const loadPackagesCacheFirst = async () => {
      const localPkgs = readCachedJson<PackageDoc[]>(CACHE_PACKAGES_KEY, []);
      if (localPkgs.length >= EXCLUSIVE_PACKAGES.length && syncNonce === 0) {
        if (!cancelled) setRawPackages(localPkgs);
        return;
      }
      const pkgQ = query(collection(db, 'packages'), where('price', '>', 0));
      if (syncNonce === 0) {
        try {
          const cachedSnap = await getDocsFromCache(pkgQ);
          if (!cachedSnap.empty) {
            const list = cachedSnap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<PackageDoc, 'id'>) }))
              .sort((a, b) => a.sortOrder - b.sortOrder);
            if (!cancelled) {
              setRawPackages(list);
              writeCachedJson(
                CACHE_PACKAGES_KEY,
                list.map(({ updatedAt: _u, ...rest }) => rest)
              );
            }
            return;
          }
        } catch {
          // Cache miss -> fall through to single on-demand server read
        }
      }
      try {
        const serverSnap = await getDocs(pkgQ);
        if (!serverSnap.empty && !cancelled) {
          const list = serverSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<PackageDoc, 'id'>) }))
            .sort((a, b) => a.sortOrder - b.sortOrder);
          setRawPackages(list);
          writeCachedJson(
            CACHE_PACKAGES_KEY,
            list.map(({ updatedAt: _u, ...rest }) => rest)
          );
          setFirestoreConnected(true);
          // Seed lightweight `stats/summary` once from packages if Super Admin has none yet
          if (isAdmin && !cachedStats) {
            const pkgSummaryMap: Record<string, PackageCounterStats> = {};
            let totalAvailable = 0;
            let totalSold = 0;
            let totalUploaded = 0;
            let totalInjected = 0;
            for (const p of list) {
              const av = Math.max(0, Number(p.availableCount) || 0);
              const sd = Math.max(0, Number(p.soldCount) || 0);
              const up = Math.max(0, Number(p.uploadedCount) || 0);
              const inj = Math.max(0, Number(p.injectedCount) || 0);
              pkgSummaryMap[p.id] = {
                availableCount: av,
                soldCount: sd,
                uploadedCount: up,
                injectedCount: inj,
              };
              totalAvailable += av;
              totalSold += sd;
              totalUploaded += up;
              totalInjected += inj;
            }
            void setDoc(
              doc(db, 'stats', 'summary'),
              {
                ownerId: activeUser.uid,
                totalAvailable,
                totalSold,
                totalUploaded,
                totalInjected,
                packages: pkgSummaryMap,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            ).catch(() => {});
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'packages');
      }
    };
    void loadPackagesCacheFirst();

    // 1C. Single Lightweight Document Listener (`stats/summary` for Admin or `stats/user_{uid}` for Agent/Client = ONLY 1 doc read!)
    unsubscribers.push(
      onSnapshot(
        statsRef,
        (snap) => {
          if (cancelled) return;
          if (!snap.metadata.fromCache) {
            setFirestoreConnected(true);
          }
          if (snap.exists()) {
            const data = snap.data() as StatsSummaryDocData;
            applyStatsDocToState(data);
            writeCachedJson(statsCacheKey, {
              ownerId: data.ownerId,
              totalAvailable: data.totalAvailable ?? 0,
              totalSold: data.totalSold ?? 0,
              totalUploaded: data.totalUploaded ?? 0,
              totalInjected: data.totalInjected ?? 0,
              packages: data.packages ?? {},
            });
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, `stats/${statDocId}`)
      )
    );

    // NOTE: Open `onSnapshot` on the `cards` collection is PERMANENTLY REMOVED.
    // Cards are pulled ONLY from local cache (`localStorage` / `getDocsFromCache`) first,
    // and fetched from Firestore strictly on-demand with exact `limit(1)` (Direct Sale) or `limit(qty)` (Wholesale).

    // 2. Compact Notifications Stream (limit 15)
    const notifQuery = isAdmin
      ? query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(15))
      : query(collection(db, 'notifications'), where('recipientId', '==', activeUser.uid), limit(15));
    unsubscribers.push(
      onSnapshot(
        notifQuery,
        (snap) => {
          const items = snap.docs
            .map((d) => ({
              id: d.id,
              ...(d.data() as Omit<NotificationDoc, 'id'>),
            }))
            .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
          setNotifications(items);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );

    // 3. Pending Registration Requests (Real-time instant arrival for Admin/Agent — compact limit 15)
    if (isAdmin || isAgent) {
      const regQuery = isAdmin
        ? query(collection(db, 'registrationRequests'), where('status', '==', 'pending'), limit(15))
        : query(
            collection(db, 'registrationRequests'),
            where('parentAgentId', '==', activeUser.uid),
            limit(15)
          );
      unsubscribers.push(
        onSnapshot(
          regQuery,
          (snap) => {
            const list = snap.docs
              .map((d) => ({
                id: d.id,
                ...(d.data() as Omit<RegistrationRequest, 'id'>),
              }))
              .filter((r) => r.status === 'pending');
            setPendingRegistrations(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'registrationRequests')
        )
      );
    }

    // 4. Real-Time Topup Requests (Instant Admin/Agent arrival — compact limit 15)
    if (isAgent) {
      let incomingList: TopupRequest[] = [];
      let outgoingList: TopupRequest[] = [];
      const publishMergedTopups = () => {
        const merged = new Map<string, TopupRequest>();
        for (const item of incomingList) merged.set(item.id, item);
        for (const item of outgoingList) merged.set(item.id, item);
        setTopupRequests(
          Array.from(merged.values()).sort(
            (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
          )
        );
      };

      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'topupRequests'), where('targetId', '==', activeUser.uid), limit(15)),
          (snap) => {
            incomingList = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TopupRequest, 'id'>),
            }));
            publishMergedTopups();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'topupRequests')
        )
      );

      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'topupRequests'), where('requesterId', '==', activeUser.uid), limit(15)),
          (snap) => {
            outgoingList = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TopupRequest, 'id'>),
            }));
            publishMergedTopups();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'topupRequests')
        )
      );
    } else {
      const topupQuery = isAdmin
        ? query(collection(db, 'topupRequests'), limit(15))
        : query(collection(db, 'topupRequests'), where('requesterId', '==', activeUser.uid), limit(15));
      unsubscribers.push(
        onSnapshot(
          topupQuery,
          (snap) => {
            const list = snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<TopupRequest, 'id'>) }))
              .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
            setTopupRequests(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'topupRequests')
        )
      );
    }

    // 5. Pending Password Resets (Admin badge only — compact limit 10)
    if (isAdmin) {
      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'passwordResetRequests'), where('status', '==', 'pending'), limit(10)),
          (snap) => {
            setPendingPasswordResets(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<PasswordResetRequest, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'passwordResetRequests')
        )
      );
    }

    return () => {
      cancelled = true;
      unsubscribers.forEach((u) => u());
    };
  }, [authReady, userUid, profile?.uid, profile?.role, profile?.status, syncNonce]);

  // B. CACHE-FIRST + INCREMENTAL LAZY ROUTE DATA LOADER (Reads local cache first; fetches ONLY deltas updated after lastSyncTs!)
  useEffect(() => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!authReady || !activeUser || !profile || profile.status !== 'active') {
      return;
    }

    let cancelled = false;
    const isAdmin = profile.role === 'super_admin';
    const isAgent = profile.role === 'agent';

    const needsSales = [
      'sales_list',
      'direct_sale',
      'electronic_cards',
      'invoices',
      'customers',
      'reports',
      'backup',
    ].includes(activeRoute);

    const needsCustomers = [
      'customers',
      'electronic_cards',
      'invoices',
      'direct_sale',
      'sales_list',
      'reports',
      'backup',
    ].includes(activeRoute);

    const needsLedger = ['customers', 'reports'].includes(activeRoute);

    const needsManagedUsers =
      (isAdmin || isAgent) &&
      [
        'agents_management',
        'electronic_cards',
        'invoices',
        'direct_sale',
        'sales_list',
        'customers',
        'reports',
        'topup_requests',
        'backup',
      ].includes(activeRoute);

    const needsAuditLogs = isAdmin && activeRoute === 'audit_logs';

    const readLastSyncMs = (key: string): number => {
      try {
        return Number(localStorage.getItem(`${CACHE_SYNC_TS_PREFIX}${activeUser.uid}_${key}`) || '0');
      } catch {
        return 0;
      }
    };
    const writeLastSyncMs = (key: string, ms: number) => {
      try {
        localStorage.setItem(`${CACHE_SYNC_TS_PREFIX}${activeUser.uid}_${key}`, String(ms));
      } catch {
        // ignore storage errors
      }
    };

    if (needsSales) {
      const limitCount = activeRoute === 'reports' || activeRoute === 'backup' ? 120 : Math.min(salesLimit, 80);
      const baseSalesQ = isAdmin
        ? query(collection(db, 'sales'), limit(limitCount))
        : query(collection(db, 'sales'), where('sellerId', '==', activeUser.uid), limit(limitCount));

      // 1. Hydrate from IndexedDB local cache immediately (0 server reads)
      void getDocsFromCache(baseSalesQ)
        .then((cSnap) => {
          if (!cancelled && !cSnap.empty) {
            const cachedList = cSnap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<SaleDoc, 'id'>) }))
              .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
            setSales((prev) => (prev.length >= cachedList.length ? prev : cachedList));
          }
        })
        .catch(() => {});

      // 2. Incremental server fetch (ONLY docs updated after lastSyncMs when cache already populated!)
      const localCachedSales = readCachedJson<SaleDoc[]>(`${CACHE_SALES_PREFIX}${activeUser.uid}`, []);
      const lastSyncMs = readLastSyncMs('sales');
      const useIncremental =
        isAdmin && lastSyncMs > 0 && localCachedSales.length > 0 && salesLimit <= 40 && syncNonce === 0;

      const fetchSalesQ = useIncremental
        ? query(collection(db, 'sales'), where('updatedAt', '>', Timestamp.fromMillis(lastSyncMs)), limit(40))
        : baseSalesQ;

      void getDocs(fetchSalesQ)
        .then((snap) => {
          if (cancelled) return;
          const incoming = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SaleDoc, 'id'>) }));
          writeLastSyncMs('sales', Date.now());
          if (useIncremental) {
            if (incoming.length > 0) {
              setSales((prev) => {
                const mergedMap = new Map<string, SaleDoc>();
                for (const s of prev) mergedMap.set(s.id, s);
                for (const s of incoming) mergedMap.set(s.id, s);
                const merged = Array.from(mergedMap.values()).sort(
                  (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
                );
                writeCachedJson(
                  `${CACHE_SALES_PREFIX}${activeUser.uid}`,
                  merged.slice(0, 60).map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest)
                );
                return merged;
              });
            }
          } else {
            const list = incoming.sort(
              (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
            );
            setSales(list);
            writeCachedJson(
              `${CACHE_SALES_PREFIX}${activeUser.uid}`,
              list.slice(0, 60).map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest)
            );
          }
        })
        .catch((err) => handleFirestoreError(err, OperationType.LIST, 'sales'));
    }

    if (needsCustomers) {
      const limitCount = activeRoute === 'reports' || activeRoute === 'backup' ? 120 : Math.min(customersLimit, 80);
      const baseCustQ = isAdmin
        ? query(collection(db, 'customers'), limit(limitCount))
        : query(collection(db, 'customers'), where('ownerId', '==', activeUser.uid), limit(limitCount));

      void getDocsFromCache(baseCustQ)
        .then((cSnap) => {
          if (!cancelled && !cSnap.empty) {
            const cachedList = cSnap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerAccount, 'id'>) }))
              .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
            setCustomers((prev) => (prev.length >= cachedList.length ? prev : cachedList));
          }
        })
        .catch(() => {});

      const localCachedCust = readCachedJson<CustomerAccount[]>(`${CACHE_CUSTOMERS_PREFIX}${activeUser.uid}`, []);
      const lastSyncMs = readLastSyncMs('customers');
      const useIncremental =
        isAdmin && lastSyncMs > 0 && localCachedCust.length > 0 && customersLimit <= 50 && syncNonce === 0;

      const fetchCustQ = useIncremental
        ? query(collection(db, 'customers'), where('updatedAt', '>', Timestamp.fromMillis(lastSyncMs)), limit(40))
        : baseCustQ;

      void getDocs(fetchCustQ)
        .then((snap) => {
          if (cancelled) return;
          const incoming = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerAccount, 'id'>) }));
          writeLastSyncMs('customers', Date.now());
          if (useIncremental) {
            if (incoming.length > 0) {
              setCustomers((prev) => {
                const mergedMap = new Map<string, CustomerAccount>();
                for (const c of prev) mergedMap.set(c.id, c);
                for (const c of incoming) mergedMap.set(c.id, c);
                const merged = Array.from(mergedMap.values()).sort(
                  (a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0)
                );
                writeCachedJson(
                  `${CACHE_CUSTOMERS_PREFIX}${activeUser.uid}`,
                  merged.slice(0, 100).map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest)
                );
                return merged;
              });
            }
          } else {
            const list = incoming.sort(
              (a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0)
            );
            setCustomers(list);
            writeCachedJson(
              `${CACHE_CUSTOMERS_PREFIX}${activeUser.uid}`,
              list.slice(0, 100).map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest)
            );
          }
        })
        .catch((err) => handleFirestoreError(err, OperationType.LIST, 'customers'));
    }

    if (needsLedger) {
      const ledgerQuery = isAdmin
        ? query(collection(db, 'ledgerEntries'), limit(80))
        : query(collection(db, 'ledgerEntries'), where('ownerId', '==', activeUser.uid), limit(80));
      void getDocsFromCache(ledgerQuery)
        .then((cSnap) => {
          if (!cancelled && !cSnap.empty) {
            setLedgerEntries(
              cSnap.docs
                .map((d) => ({ id: d.id, ...(d.data() as Omit<LedgerEntry, 'id'>) }))
                .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
            );
          }
        })
        .catch(() => {});
      void getDocs(ledgerQuery)
        .then((snap) => {
          if (cancelled) return;
          const list = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<LedgerEntry, 'id'>) }))
            .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
          setLedgerEntries(list);
        })
        .catch((err) => handleFirestoreError(err, OperationType.LIST, 'ledgerEntries'));
    }

    if (needsManagedUsers) {
      const cachedUsersList = readCachedJson<UserProfile[]>(CACHE_USERS_LIST_KEY, []);
      if (cachedUsersList.length > 0) {
        setManagedUsers((prev) => (prev.length > 0 ? prev : cachedUsersList));
      }
      const lastUsersSyncMs = readLastSyncMs('users');
      const usersCacheFresh =
        cachedUsersList.length > 0 &&
        Date.now() - lastUsersSyncMs < 10 * 60 * 1000 &&
        activeRoute !== 'agents_management' &&
        syncNonce === 0;

      if (!usersCacheFresh) {
        const usersQuery = isAdmin
          ? query(collection(db, 'users'), limit(100))
          : query(collection(db, 'users'), where('parentAgentId', '==', activeUser.uid), limit(100));
        void getDocs(usersQuery)
          .then((snap) => {
            if (cancelled) return;
            const list = snap.docs.map((d) => d.data() as UserProfile);
            setManagedUsers(list);
            writeLastSyncMs('users', Date.now());
            if (isAdmin && list.length > 0) {
              const serialized = list.map((u) =>
                serializePlainAccountForBackup(u as unknown as Record<string, unknown>, u.uid)
              );
              writeCachedJson(CACHE_USERS_LIST_KEY, serialized);
            }
          })
          .catch((err) => handleFirestoreError(err, OperationType.LIST, 'users'));
      }
    }

    if (needsAuditLogs) {
      const auditQ = query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(auditLogsLimit));
      void getDocsFromCache(auditQ)
        .then((cSnap) => {
          if (!cancelled && !cSnap.empty) {
            setAuditLogs(
              cSnap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<AuditLogDoc, 'id'>),
              }))
            );
          }
        })
        .catch(() => {});
      void getDocs(auditQ)
        .then((snap) => {
          if (cancelled) return;
          setAuditLogs(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<AuditLogDoc, 'id'>),
            }))
          );
        })
        .catch((err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs'));
    }

    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    userUid,
    profile?.uid,
    profile?.role,
    profile?.status,
    activeRoute,
    salesLimit,
    customersLimit,
    auditLogsLimit,
    syncNonce,
  ]);

  // Account-isolated packages view: Super Admin sees central inventory; Agents & Clients see ONLY their own cards!
  const packages = useMemo<PackageDoc[]>(() => {
    const baseList = rawPackages.length > 0 ? rawPackages : (EXCLUSIVE_PACKAGES as PackageDoc[]);
    const activeUid = auth.currentUser?.uid || firebaseUser?.uid || profile?.uid || '';
    const isAdmin = profile?.role === 'super_admin';

    // Subtract any unsynced offline sales for instant accurate counts
    const offlineSoldByPkg: Record<string, number> = {};
    for (const qSale of pendingOfflineSales) {
      if (qSale.sellerId !== activeUid) continue;
      if (qSale.saleType === 'direct' || qSale.saleType === 'electronic_wholesale') {
        for (const item of qSale.items) {
          offlineSoldByPkg[item.packageId] = (offlineSoldByPkg[item.packageId] || 0) + item.delivered;
        }
      }
    }

    if (isAdmin) {
      return baseList.map((pkg) => {
        const offlineUsed = offlineSoldByPkg[pkg.id] || 0;
        return {
          ...pkg,
          availableCount: Math.max(0, (Number(pkg.availableCount) || 0) - offlineUsed),
          soldCount: (Number(pkg.soldCount) || 0) + offlineUsed,
        };
      });
    }

    // Strict Isolation for Agent & Client: NEVER expose Admin's availableCount/uploadedCount/soldCount/injectedCount
    const cachedOfflinePool = activeUid ? getCachedAvailableCards(activeUid) : [];
    const cachedByPkg: Record<string, number> = {};
    for (const c of cachedOfflinePool) {
      cachedByPkg[c.packageId] = (cachedByPkg[c.packageId] || 0) + 1;
    }

    return baseList.map((pkg) => {
      const livePersonal = personalCardCounts[pkg.id];
      const baseAvail =
        livePersonal !== undefined ? livePersonal : cachedByPkg[pkg.id] || 0;
      const offlineUsed = offlineSoldByPkg[pkg.id] || 0;
      return {
        ...pkg,
        availableCount: Math.max(0, baseAvail - offlineUsed),
        soldCount: (personalSoldCounts[pkg.id] || 0) + offlineUsed,
        uploadedCount: 0,
        injectedCount: 0,
      };
    });
  }, [rawPackages, profile?.role, profile?.uid, firebaseUser?.uid, personalCardCounts, personalSoldCounts, pendingOfflineSales, offlinePoolVersion]);

  // Merge pending offline sales at the top of live Firestore sales so they show up immediately in all lists/reports
  const mergedSales = useMemo<SaleDoc[]>(() => {
    const activeUid = auth.currentUser?.uid || firebaseUser?.uid || profile?.uid;
    const relevantOffline = pendingOfflineSales
      .filter((q) => !activeUid || q.sellerId === activeUid || profile?.role === 'super_admin')
      .map(offlineSaleToSaleDoc);
    if (relevantOffline.length === 0) return sales;
    const liveIds = new Set(sales.map((s) => s.id));
    return [...relevantOffline.filter((s) => !liveIds.has(s.id)), ...sales];
  }, [pendingOfflineSales, sales, firebaseUser?.uid, profile?.uid, profile?.role]);

  const totalAvailableCards = useMemo(
    () => packages.reduce((sum, p) => sum + (Number(p.availableCount) || 0), 0),
    [packages]
  );

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const pendingTopups = useMemo(
    () => topupRequests.filter((t) => t.status === 'pending'),
    [topupRequests]
  );

  // Automatic Background Sync for Offline Queued Sales whenever internet reconnects
  const flushOfflineSalesQueue = useCallback(async () => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!activeUser || !profile || !navigator.onLine) return;
    const queue = getPendingOfflineSales(activeUser.uid);
    if (queue.length === 0) return;

    let syncedCount = 0;
    for (const qSale of queue) {
      const syncKey = `sync_offline_${qSale.localId}`;
      if (inFlightOpsRef.current.has(syncKey)) continue;
      inFlightOpsRef.current.add(syncKey);
      try {
        await runTransaction(db, async (tx) => {
          const isElectronic =
            qSale.saleType === 'direct' || qSale.saleType === 'electronic_wholesale';

          // Update card documents
          if (isElectronic && qSale.cardDocIds.length > 0) {
            for (const cardDocId of qSale.cardDocIds) {
              const cardRef = doc(db, 'cards', cardDocId);
              const cSnap = await tx.get(cardRef);
              if (cSnap.exists()) {
                if (qSale.transferOwnershipToBuyer && qSale.buyerId) {
                  tx.update(cardRef, {
                    status: 'available',
                    ownerId: qSale.buyerId,
                    soldTo: (qSale.buyerPhone || qSale.buyerName).slice(0, 128),
                    saleId: qSale.localId,
                    updatedAt: serverTimestamp(),
                  });
                } else {
                  tx.update(cardRef, {
                    status: 'sold',
                    soldTo: (qSale.buyerPhone || qSale.buyerName).slice(0, 128),
                    saleId: qSale.localId,
                    updatedAt: serverTimestamp(),
                  });
                }
              }
            }

            // Decrement global Admin package counters only when Super Admin executed the sale
            if (profile.role === 'super_admin') {
              for (const item of qSale.items) {
                if (item.delivered <= 0) continue;
                const pkgRef = doc(db, 'packages', item.packageId);
                const pSnap = await tx.get(pkgRef);
                if (pSnap.exists()) {
                  const pData = pSnap.data() as PackageDoc;
                  tx.update(pkgRef, {
                    availableCount: Math.max(0, (Number(pData.availableCount) || 0) - item.delivered),
                    soldCount: (Number(pData.soldCount) || 0) + item.delivered,
                    updatedAt: serverTimestamp(),
                  });
                }
              }
            }
          }

          tx.set(doc(db, 'sales', qSale.localId), {
            invoiceNumber: qSale.invoiceNumber,
            sellerId: qSale.sellerId,
            buyerId: (qSale.buyerId || '').slice(0, 128),
            buyerName: qSale.buyerName.slice(0, 100),
            buyerPhone: (qSale.buyerPhone || '').slice(0, 20),
            buyerRole: qSale.buyerRole || 'consumer',
            saleType: qSale.saleType,
            paymentMethod: qSale.paymentMethod,
            discountRate: qSale.discountRate,
            totalAmount: qSale.totalAmount,
            paidAmount: qSale.paidAmount,
            remainingAmount: qSale.remainingAmount,
            expectedProfit: qSale.expectedProfit,
            realizedProfit: qSale.realizedProfit,
            totalCards: qSale.totalCards,
            deliveredCards: qSale.deliveredCards,
            returnedCards: 0,
            items: qSale.items.slice(0, 20),
            cardNumbers: qSale.cardNumbers.slice(0, 200),
            status: qSale.remainingAmount > 0 ? 'partial' : 'completed',
            notes: (qSale.notes || '').slice(0, 500),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

        removeSyncedOfflineSale(qSale.localId);
        syncedCount++;
      } catch {
        // Keep in queue for next connectivity retry
      } finally {
        inFlightOpsRef.current.delete(syncKey);
      }
    }

    if (syncedCount > 0) {
      setPendingOfflineSales(getPendingOfflineSales());
      setOfflinePoolVersion((v) => v + 1);
      notifySuccess(`تمت مزامنة ${syncedCount} عملية بيع محلية مع السحابة بنجاح ✅`);
    }
  }, [firebaseUser, notifySuccess, profile]);

  useEffect(() => {
    if (isOnline && authReady && profile?.status === 'active') {
      flushOfflineSalesQueue().catch(() => {});
    }
  }, [isOnline, authReady, profile?.status, flushOfflineSalesQueue]);

  const refreshVerificationStatus = useCallback(async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    try {
      await auth.currentUser.reload();
      const adminSnap = await getDoc(doc(db, 'admins', auth.currentUser.uid)).catch(() => null);
      const alreadyApprovedAdmin = !!adminSnap?.exists();
      const verified = auth.currentUser.emailVerified || alreadyApprovedAdmin;
      if (alreadyApprovedAdmin) {
        setAdminDocApproved(true);
      }
      if (verified) {
        await auth.currentUser.getIdToken(true);
        setFirebaseUser(auth.currentUser);
        setVerificationVersion((v) => v + 1);
        const bootstrapped = await bootstrapSuperAdminIfNeeded(auth.currentUser);
        setSyncNonce((n) => n + 1);
        if (bootstrapped || alreadyApprovedAdmin) {
          notifySuccess('تم التحقق من حساب المدير الأساسي وفتح لوحة التحكم مباشرة');
        }
      } else {
        notifyInfo('بانتظار التأكيد', 'لم يتم النقر على رابط التفعيل في البريد الإلكتروني بعد.');
      }
      return verified;
    } catch {
      notifyError('تعذر التحقق', 'يرجى المحاولة مرة أخرى.');
      return false;
    }
  }, [bootstrapSuperAdminIfNeeded, notifyError, notifyInfo, notifySuccess]);

  const writeAuditLog = useCallback(
    async (action: string, details: string) => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile) return;
      const logId = generateSafeDocId('log');
      try {
        await setDoc(doc(db, 'auditLogs', logId), {
          actorId: activeUser.uid,
          actorName: profile.name.slice(0, 100),
          action: action.slice(0, 100),
          details: details.slice(0, 500),
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `auditLogs/${logId}`);
      }
    },
    [firebaseUser, profile]
  );

  const sendCloudNotification = useCallback(
    async (params: {
      recipientId: string;
      title: string;
      body: string;
      category: NotificationDoc['category'];
      targetRoute: AppRoute;
    }) => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser) return;
      const notifId = generateSafeDocId('notif');
      try {
        await setDoc(doc(db, 'notifications', notifId), {
          recipientId: params.recipientId.slice(0, 128),
          senderId: activeUser.uid,
          title: params.title.slice(0, 150),
          body: params.body.slice(0, 500),
          category: params.category,
          targetRoute: params.targetRoute,
          isRead: false,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `notifications/${notifId}`);
      }
    },
    [firebaseUser]
  );

  const syncNow = useCallback(async () => {
    setIsSyncing(true);
    try {
      const ok = await testFirestoreConnection();
      setFirestoreConnected(ok);
      const activeUser = auth.currentUser || firebaseUser;
      if (ok) {
        if (activeUser && (!profile || pendingProfileLookupRef.current)) {
          await resolveAndLinkUserProfile(activeUser);
        }
        await flushOfflineSalesQueue();
      }
      setSyncNonce((n) => n + 1);
      if (ok) {
        notifySuccess('تمت المزامنة السحابية اللحظية مع Firebase Firestore');
      } else {
        notifyError('لا يوجد اتصال بالسحابة', 'يرجى التحقق من اتصال الإنترنت والمحاولة مجدداً.');
      }
    } finally {
      setTimeout(() => setIsSyncing(false), 500);
    }
  }, [firebaseUser, flushOfflineSalesQueue, notifyError, notifySuccess, profile, resolveAndLinkUserProfile]);

  const signOutUser = useCallback(async () => {
    try {
      explicitSignOutRef.current = true;
      clearActiveSession(true);
      clearMemorySessionCredentials();
      await firebaseSignOut(auth);
      notifySuccess('تم تسجيل الخروج بأمان');
    } catch {
      notifyError('تعذر تسجيل الخروج');
    }
  }, [notifyError, notifySuccess]);

  const markNotificationRead = useCallback(async (notificationId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), { isRead: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${notificationId}`);
    }
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.isRead);
    if (unread.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const n of unread) {
        batch.update(doc(db, 'notifications', n.id), { isRead: true });
      }
      await batch.commit();
      notifySuccess('تم تحديد جميع الإشعارات كمقروءة');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'notifications/batch_read');
      notifyError('فشل تحديث الإشعارات');
    }
  }, [notifications, notifyError, notifySuccess]);

  const updateAppSettings = useCallback(
    async (updates: Partial<Omit<AppSettingsDoc, 'updatedAt'>>) => {
      if (!profile || profile.role !== 'super_admin') return;
      const cleanSlides = (updates.sliderSlides ?? appSettings.sliderSlides ?? DEFAULT_APP_SETTINGS.sliderSlides ?? [])
        .slice(0, 6)
        .map((s, idx) => ({
          id: (s.id || `slide_${idx + 1}`).slice(0, 40),
          image: (s.image || '').slice(0, 120000),
          title: (s.title || '').slice(0, 120),
          subtitle: (s.subtitle || '').slice(0, 200),
        }));

      const merged: Omit<AppSettingsDoc, 'updatedAt'> = {
        newsTicker: (updates.newsTicker ?? appSettings.newsTicker).slice(0, 500),
        newsTickerEnabled: updates.newsTickerEnabled ?? appSettings.newsTickerEnabled ?? true,
        newsTickerSpeed: Math.min(90, Math.max(6, Number(updates.newsTickerSpeed ?? appSettings.newsTickerSpeed ?? 22))),
        sliderEnabled: updates.sliderEnabled ?? appSettings.sliderEnabled ?? true,
        sliderSpeed: Math.min(30, Math.max(2, Number(updates.sliderSpeed ?? appSettings.sliderSpeed ?? 5))),
        sliderSlides: cleanSlides,
        lowStockThreshold: Math.max(0, Number(updates.lowStockThreshold ?? appSettings.lowStockThreshold)),
        agentDiscountPercent: Math.min(100, Math.max(1, Number(updates.agentDiscountPercent ?? appSettings.agentDiscountPercent))),
        clientDiscountPercent: Math.min(100, Math.max(1, Number(updates.clientDiscountPercent ?? appSettings.clientDiscountPercent))),
        directSaleMessageTemplate: (updates.directSaleMessageTemplate ?? appSettings.directSaleMessageTemplate).slice(0, 1000),
        smsMessageTemplate: (updates.smsMessageTemplate ?? appSettings.smsMessageTemplate ?? DEFAULT_APP_SETTINGS.smsMessageTemplate ?? '').slice(0, 1000),
        whatsappMessageTemplate: (updates.whatsappMessageTemplate ?? appSettings.whatsappMessageTemplate ?? DEFAULT_APP_SETTINGS.whatsappMessageTemplate ?? '').slice(0, 1500),
        pdfHeaderTitle: (updates.pdfHeaderTitle ?? appSettings.pdfHeaderTitle ?? DEFAULT_APP_SETTINGS.pdfHeaderTitle ?? '').slice(0, 150),
        pdfHeaderSubtitle: (updates.pdfHeaderSubtitle ?? appSettings.pdfHeaderSubtitle ?? DEFAULT_APP_SETTINGS.pdfHeaderSubtitle ?? '').slice(0, 250),
        pdfFooterText: (updates.pdfFooterText ?? appSettings.pdfFooterText ?? DEFAULT_APP_SETTINGS.pdfFooterText ?? '').slice(0, 300),
        appDescription: (updates.appDescription ?? appSettings.appDescription ?? DEFAULT_APP_SETTINGS.appDescription ?? '').slice(0, 600),
        apkDownloadUrl: (updates.apkDownloadUrl ?? appSettings.apkDownloadUrl ?? '').slice(0, 300),
      };
      try {
        await setDoc(doc(db, 'settings', 'global'), {
          ...merged,
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog('تحديث الإعدادات العامة', 'تم تعديل إعدادات شبكة طيبة نت والسلايدر وشريط الأخبار وصيغ الرسائل');
        notifySuccess('تم حفظ إعدادات الشبكة وتعميمها لحظياً ✅');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'settings/global');
        notifyError('فشل حفظ الإعدادات', 'تحقق من صلاحيات المدير العام أو حجم صور السلايدر.');
      }
    },
    [appSettings, notifyError, notifySuccess, profile, writeAuditLog]
  );

  // =========================================================================
  // ULTRA-FAST PARALLEL CARD IMPORT ENGINE (Exact 500-card writeBatch × Promise.all)
  // =========================================================================
  const importCardsBatch = useCallback(
    async (
      packageId: string,
      rawCardNumbers: string[],
      onProgress?: (percent: number, done: number, total: number) => void
    ): Promise<ImportCardsResult> => {
      const startedAt = performance.now();
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile || profile.role !== 'super_admin') {
        notifyError('صلاحية الإدارة فقط', 'استيراد الكروت متاح للمدير العام فقط.');
        return { totalParsed: 0, importedCount: 0, duplicateCount: 0, invalidCount: 0, elapsedMs: 0 };
      }

      // Fast O(n) in-memory validation & deduplication via Set (zero per-card Firestore reads!)
      const validRegex = /^[0-9]{10,11}$/;
      const existingPoolSet = new Set<string>(
        getCachedAvailableCards(activeUser.uid).map((c) => c.cardNumber)
      );
      const uniqueSet = new Set<string>();
      let invalidCount = 0;
      let duplicateCount = 0;

      for (let i = 0; i < rawCardNumbers.length; i++) {
        const clean = String(rawCardNumbers[i] ?? '').trim();
        if (!validRegex.test(clean)) {
          invalidCount++;
          continue;
        }
        if (uniqueSet.has(clean) || existingPoolSet.has(clean)) {
          duplicateCount++;
          continue;
        }
        uniqueSet.add(clean);
      }

      const toInsert = Array.from(uniqueSet);
      if (toInsert.length === 0) {
        notifyWarning('لا توجد كروت جديدة للاستيراد', `تم استبعاد ${duplicateCount} كرت مكرر.`);
        return {
          totalParsed: rawCardNumbers.length,
          importedCount: 0,
          duplicateCount,
          invalidCount,
          elapsedMs: Math.round(performance.now() - startedAt),
        };
      }

      const batchId = generateSafeDocId('batch');
      const CHUNK_SIZE = 480; // Optimal 450–500 cards per Firestore writeBatch
      const PARALLEL_WAVES = 10; // Commit batches in parallel via Promise.all
      const chunks: string[][] = [];
      for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
        chunks.push(toInsert.slice(i, i + CHUNK_SIZE));
      }

      // Pre-populate local RAM + localStorage card pool IMMEDIATELY so newly imported cards
      // are readable at 0ms latency right away!
      const addedCards: CachedAvailableCard[] = toInsert.slice(0, 5000).map((cardNumber) => ({
        id: cardNumber,
        packageId,
        cardNumber,
        ownerId: activeUser.uid,
      }));
      appendCachedAvailableCards(activeUser.uid, addedCards);

      let done = 0;
      try {
        // Build & commit all 500-card batches in parallel waves via Promise.all
        const createdTs = serverTimestamp();
        for (let wave = 0; wave < chunks.length; wave += PARALLEL_WAVES) {
          const waveChunks = chunks.slice(wave, wave + PARALLEL_WAVES);
          await Promise.all(
            waveChunks.map(async (chunk) => {
              const batch = writeBatch(db);
              for (let j = 0; j < chunk.length; j++) {
                const cardNumber = chunk[j];
                batch.set(doc(db, 'cards', cardNumber), {
                  packageId,
                  cardNumber,
                  status: 'available',
                  ownerId: activeUser.uid,
                  batchId,
                  createdAt: createdTs,
                  updatedAt: createdTs,
                });
              }
              await batch.commit();
              done += chunk.length;
              if (onProgress) {
                const pct = Math.min(98, Math.round((done / toInsert.length) * 100));
                onProgress(pct, done, toInsert.length);
              }
            })
          );
        }

        // Optimistic immediate package counter update in local state & cache
        setRawPackages((prev) => {
          const base = prev.length > 0 ? prev : (EXCLUSIVE_PACKAGES as PackageDoc[]);
          const next = base.map((pkg) =>
            pkg.id === packageId
              ? {
                  ...pkg,
                  availableCount: (Number(pkg.availableCount) || 0) + done,
                  uploadedCount: (Number(pkg.uploadedCount) || 0) + done,
                }
              : pkg
          );
          writeCachedJson(
            CACHE_PACKAGES_KEY,
            next.map(({ updatedAt: _u, ...rest }) => rest)
          );
          return next;
        });

        // Single atomic counter increment on the package document + lightweight stats/summary doc
        await Promise.all([
          updateDoc(doc(db, 'packages', packageId), {
            availableCount: increment(done),
            uploadedCount: increment(done),
            updatedAt: serverTimestamp(),
          }),
          applyStatsSummaryDelta('summary', activeUser.uid, {
            [packageId]: { available: done, uploaded: done },
          }),
        ]);

        setOfflinePoolVersion((v) => v + 1);
        const elapsedMs = Math.max(100, Math.round(performance.now() - startedAt));
        const elapsedSec = (elapsedMs / 1000).toFixed(1);

        if (onProgress) {
          onProgress(100, done, toInsert.length);
        }

        // Fire-and-forget audit & notification so UI finishes immediately
        writeAuditLog(
          'استيراد دفعة كروت',
          `تم استيراد ${done} كرت جديد للباقة ${packageId} خلال ${elapsedSec} ثانية (استبعاد ${duplicateCount} مكرر محلياً)`
        ).catch(() => {});
        sendCloudNotification({
          recipientId: 'super_admin',
          title: 'تم استيراد دفعة كروت جديدة',
          body: `تمت إضافة ${done} كرت للباقة ${packageId} بنجاح خلال ${elapsedSec} ثانية.`,
          category: 'inventory',
          targetRoute: 'packages',
        }).catch(() => {});

        notifySuccess(`تم استيراد ${done} كرت بنجاح خلال ${elapsedSec} ثانية ⚡`);
        return {
          totalParsed: rawCardNumbers.length,
          importedCount: done,
          duplicateCount,
          invalidCount,
          elapsedMs,
        };
      } catch (err) {
        // Rollback pre-cached cards if cloud commit failed
        removeCardsFromCache(activeUser.uid, toInsert);
        handleFirestoreError(err, OperationType.WRITE, 'cards/batch_import');
        notifyError('حدث خطأ أثناء الاستيراد', 'يرجى التحقق من الاتصال والمحاولة مجدداً.');
      }

      return {
        totalParsed: rawCardNumbers.length,
        importedCount: done,
        duplicateCount,
        invalidCount,
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    },
    [firebaseUser, notifyError, notifySuccess, notifyWarning, profile, sendCloudNotification, writeAuditLog]
  );

  const updatePackageInfo = useCallback(
    async (
      packageId: string,
      updates: Partial<Pick<PackageDoc, 'dataLabel' | 'hoursLabel' | 'validityLabel' | 'price'>>
    ) => {
      if (!profile || profile.role !== 'super_admin') return;
      try {
        await updateDoc(doc(db, 'packages', packageId), {
          ...updates,
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog('تعديل بيانات باقة', `تم تحديث الباقة ${packageId}`);
        notifySuccess('تم تعديل بيانات الباقة بنجاح');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `packages/${packageId}`);
        notifyError('تعذر تعديل الباقة');
      }
    },
    [notifyError, notifySuccess, profile, writeAuditLog]
  );

  // =========================================================================
  // UPDATE 4: ULTRA-FAST OPTIMISTIC UI (<0.5s) + BACKGROUND writeBatch SALES
  // =========================================================================
  const executeSaleTransaction = useCallback(
    async (input: SaleExecutionInput): Promise<SaleDoc | null> => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile) return null;

      const requestedItems = input.items.filter((i) => i.quantity > 0);
      if (requestedItems.length === 0) {
        notifyWarning('اختر باقة واحدة على الأقل');
        return null;
      }

      const opKey = `sale_${input.saleType}_${input.buyerName.trim()}`;
      if (inFlightOpsRef.current.has(opKey)) {
        notifyWarning('جاري تنفيذ العملية بالفعل', 'يرجى الانتظار لحظة لتجنب تكرار الفاتورة.');
        return null;
      }
      inFlightOpsRef.current.add(opKey);

      const isElectronic = input.saleType === 'direct' || input.saleType === 'electronic_wholesale';
      const transferOwnershipToBuyer =
        input.saleType === 'electronic_wholesale' &&
        !!input.buyerId &&
        (input.buyerRole === 'agent' || input.buyerRole === 'client');

      const saleId = generateSafeDocId('sale');
      const nowMs = Date.now();
      const invoiceNumber = `TN-${String(nowMs).slice(-6)}`;
      const localTimestamp = {
        toDate: () => new Date(nowMs),
        toMillis: () => nowMs,
        seconds: Math.floor(nowMs / 1000),
        nanoseconds: 0,
      } as unknown as SaleDoc['createdAt'];

      const pickedCardsByPkg: Record<string, Array<{ id: string; cardNumber: string }>> = {};
      const consumedFromCacheList: Array<{ pkgId: string; cards: CachedAvailableCard[] }> = [];
      const fetchedAndLockedNumbers: string[] = [];

      const rollbackLocalSelection = () => {
        for (const entry of consumedFromCacheList) {
          releaseCardLocksLocally(entry.cards.map((c) => c.cardNumber));
          appendCachedAvailableCards(activeUser.uid, entry.cards);
        }
        if (fetchedAndLockedNumbers.length > 0) {
          releaseCardLocksLocally(fetchedAndLockedNumbers);
        }
      };

      try {
        // STEP 1: INSTANT CARD PULL (0ms synchronous RAM/storage cache first -> parallel Firestore fallback ONLY if needed)
        if (isElectronic) {
          const allCachedLocally = requestedItems.every((item) => {
            const deliverTarget = Math.min(item.quantity, item.deliverNow ?? item.quantity);
            if (deliverTarget <= 0) return true;
            return getCachedAvailableCards(activeUser.uid, item.packageId).length >= deliverTarget;
          });

          if (allCachedLocally) {
            // 0ms Synchronous Optimistic Pool Consumption (strict local lock prevents duplicate card numbers)
            for (const item of requestedItems) {
              const deliverTarget = Math.min(item.quantity, item.deliverNow ?? item.quantity);
              if (deliverTarget <= 0) {
                pickedCardsByPkg[item.packageId] = [];
                continue;
              }
              const picked = consumeCachedAvailableCards(activeUser.uid, item.packageId, deliverTarget);
              if (!picked || picked.length < deliverTarget) {
                rollbackLocalSelection();
                notifyWarning('أحد الكروت قيد التنفيذ حالياً، يرجى إعادة المحاولة فوراً.');
                return null;
              }
              consumedFromCacheList.push({ pkgId: item.packageId, cards: picked });
              pickedCardsByPkg[item.packageId] = picked.map((c) => ({
                id: c.id,
                cardNumber: c.cardNumber,
              }));
            }
          } else {
            // Offline guard when local cache cannot fulfill request
            if (!navigator.onLine) {
              const shortageItem = requestedItems.find((item) => {
                const deliverTarget = Math.min(item.quantity, item.deliverNow ?? item.quantity);
                return getCachedAvailableCards(activeUser.uid, item.packageId).length < deliverTarget;
              });
              const pkgMeta = packages.find((p) => p.id === shortageItem?.packageId);
              const deliverTarget = shortageItem
                ? Math.min(shortageItem.quantity, shortageItem.deliverNow ?? shortageItem.quantity)
                : 0;
              notifyError(
                'المخزون المحلي غير كافٍ دون إنترنت',
                `المتوفر محلياً لباقة ${pkgMeta?.price || shortageItem?.packageId || ''} ر.ي أقل من المطلوب (${deliverTarget}). يرجى الاتصال بالإنترنت للمزامنة.`
              );
              return null;
            }

            // Cache-First (`localStorage` -> `getDocsFromCache`) then EXACT-LIMIT Firestore fetch (`limit(1)` direct / `limit(qty)` wholesale)
            const fetchedAll = await Promise.all(
              requestedItems.map(async (item) => {
                const deliverTarget = Math.min(item.quantity, item.deliverNow ?? item.quantity);
                if (deliverTarget <= 0) {
                  return { item, deliverTarget, list: [] as Array<{ id: string; cardNumber: string }>, fromCache: true };
                }
                const localPool = getCachedAvailableCards(activeUser.uid, item.packageId);
                if (localPool.length >= deliverTarget) {
                  return {
                    item,
                    deliverTarget,
                    list: localPool.slice(0, deliverTarget).map((c) => ({ id: c.id, cardNumber: c.cardNumber })),
                    fromCache: true,
                  };
                }

                const ownerExactQ = query(
                  collection(db, 'cards'),
                  where('ownerId', '==', activeUser.uid),
                  where('packageId', '==', item.packageId),
                  where('status', '==', 'available'),
                  limit(deliverTarget)
                );

                // Try IndexedDB cache FIRST (0 Firestore server reads!)
                try {
                  const idbSnap = await getDocsFromCache(ownerExactQ);
                  const idbList = idbSnap.docs
                    .map((d) => ({ id: d.id, cardNumber: (d.data() as CardDoc).cardNumber }))
                    .filter((c) => !isCardLocallyLocked(c.cardNumber));
                  if (idbList.length >= deliverTarget) {
                    return { item, deliverTarget, list: idbList.slice(0, deliverTarget), fromCache: true };
                  }
                } catch {
                  // Cache miss -> proceed to exact-limit server fetch
                }

                // Exact-limit server query: `limit(1)` for Direct Sale, `limit(deliverTarget)` for Wholesale
                let snap = await getDocs(ownerExactQ);
                if (profile.role === 'super_admin' && snap.docs.length < deliverTarget) {
                  snap = await getDocs(
                    query(
                      collection(db, 'cards'),
                      where('packageId', '==', item.packageId),
                      where('status', '==', 'available'),
                      limit(deliverTarget)
                    )
                  );
                }
                const list = snap.docs
                  .map((d) => ({ id: d.id, cardNumber: (d.data() as CardDoc).cardNumber }))
                  .filter((c) => !isCardLocallyLocked(c.cardNumber));

                return { item, deliverTarget, list, fromCache: false };
              })
            );

            for (const { item, deliverTarget, list } of fetchedAll) {
              if (list.length < deliverTarget) {
                rollbackLocalSelection();
                const pkgMeta = packages.find((p) => p.id === item.packageId);
                notifyError(
                  'المخزون غير كافٍ',
                  `المتوفر لباقة ${pkgMeta?.price || item.packageId} ر.ي هو ${list.length} كرت والمطلوب تسليمه ${deliverTarget}.`
                );
                return null;
              }
              const chosen = list.slice(0, deliverTarget);
              pickedCardsByPkg[item.packageId] = chosen;
              for (const c of chosen) {
                fetchedAndLockedNumbers.push(c.cardNumber);
              }
            }

            if (fetchedAndLockedNumbers.length > 0) {
              if (!lockCardsLocally(fetchedAndLockedNumbers)) {
                rollbackLocalSelection();
                notifyWarning('أحد الكروت قيد التنفيذ حالياً، يرجى إعادة المحاولة فوراً.');
                return null;
              }
              removeCardsFromCache(activeUser.uid, fetchedAndLockedNumbers);
            }
          }
        }

        // STEP 2: BUILD INVOICE & OPTIMISTIC SALE DOCUMENT IN RAM (<1ms)
        const lineItems: SaleLineItem[] = [];
        const allPulledNumbers: string[] = [];
        const allPulledDocIds: string[] = [];
        const deliveredByPkg: Record<string, number> = {};
        let totalAmount = 0;
        let faceValueTotal = 0;
        let totalCards = 0;
        let deliveredCards = 0;

        for (const item of requestedItems) {
          const pkg =
            packages.find((p) => p.id === item.packageId) ||
            (EXCLUSIVE_PACKAGES.find((p) => p.id === item.packageId) as PackageDoc | undefined);
          if (!pkg) continue;

          const unitPrice = Math.round((pkg.price * input.discountRate) / 100);
          const picked = pickedCardsByPkg[item.packageId] || [];
          const deliverCount = isElectronic ? picked.length : item.quantity;

          if (isElectronic && deliverCount > 0) {
            deliveredByPkg[item.packageId] = (deliveredByPkg[item.packageId] || 0) + deliverCount;
          }

          for (const c of picked) {
            allPulledNumbers.push(c.cardNumber);
            allPulledDocIds.push(c.id);
          }

          lineItems.push({
            packageId: item.packageId,
            packageLabel: `باقة ${pkg.price} ر.ي (${pkg.dataLabel})`,
            price: pkg.price,
            unitPrice,
            quantity: item.quantity,
            delivered: deliverCount,
            returned: 0,
            cardNumbers: picked.map((p) => p.cardNumber),
          });

          totalAmount += unitPrice * item.quantity;
          faceValueTotal += pkg.price * item.quantity;
          totalCards += item.quantity;
          deliveredCards += deliverCount;
        }

        const paidAmount =
          input.paymentMethod === 'cash'
            ? totalAmount
            : input.paymentMethod === 'credit'
              ? 0
              : Math.min(totalAmount, Math.max(0, input.paidAmount));
        const remainingAmount = Math.max(0, totalAmount - paidAmount);
        const expectedProfit = Math.max(0, totalAmount - Math.round(faceValueTotal * 0.65));
        const realizedProfit =
          totalAmount > 0 ? Math.round((expectedProfit * paidAmount) / totalAmount) : 0;
        const status: SaleDoc['status'] =
          deliveredCards < totalCards || remainingAmount > 0 ? 'partial' : 'completed';

        const cleanBuyerName = input.buyerName.trim().slice(0, 100) || 'زبون مباشر';
        const cleanBuyerPhone = (input.buyerPhone || '').slice(0, 20);
        const cleanBuyerId = (input.buyerId || '').slice(0, 128);
        const cleanNotes = (input.notes || '').slice(0, 500);

        const optimisticSale: SaleDoc = {
          id: saleId,
          invoiceNumber,
          sellerId: activeUser.uid,
          buyerId: cleanBuyerId,
          buyerName: cleanBuyerName,
          buyerPhone: cleanBuyerPhone,
          buyerRole: input.buyerRole,
          saleType: input.saleType,
          paymentMethod: input.paymentMethod,
          discountRate: input.discountRate,
          totalAmount,
          paidAmount,
          remainingAmount,
          expectedProfit,
          realizedProfit,
          totalCards,
          deliveredCards,
          returnedCards: 0,
          items: lineItems,
          cardNumbers: allPulledNumbers,
          status,
          notes: cleanNotes,
          createdAt: localTimestamp,
          updatedAt: localTimestamp,
        };

        const queuedFallbackPayload: OfflineQueuedSale = {
          localId: saleId,
          createdAtMs: nowMs,
          sellerId: activeUser.uid,
          buyerId: cleanBuyerId,
          buyerName: cleanBuyerName,
          buyerPhone: cleanBuyerPhone,
          buyerRole: input.buyerRole,
          saleType: input.saleType,
          paymentMethod: input.paymentMethod,
          discountRate: input.discountRate,
          totalAmount,
          paidAmount,
          remainingAmount,
          expectedProfit,
          realizedProfit,
          totalCards,
          deliveredCards,
          items: lineItems,
          cardNumbers: allPulledNumbers,
          cardDocIds: allPulledDocIds,
          invoiceNumber,
          notes: cleanNotes,
          transferOwnershipToBuyer,
        };

        const typeLabel =
          input.saleType === 'direct'
            ? 'بيع مباشر'
            : input.saleType === 'electronic_wholesale'
              ? 'جملة إلكترونية'
              : 'فاتورة كروت ورقية';

        // STEP 3: INSTANT OPTIMISTIC UI UPDATES (Stock + Sales list updated immediately at ~5ms)
        const applyOptimisticStockDelta = (direction: -1 | 1) => {
          if (!isElectronic || Object.keys(deliveredByPkg).length === 0) return;
          if (profile.role === 'super_admin') {
            setRawPackages((prev) =>
              prev.map((pkg) => {
                const delta = deliveredByPkg[pkg.id] || 0;
                if (!delta) return pkg;
                return {
                  ...pkg,
                  availableCount: Math.max(0, (Number(pkg.availableCount) || 0) + direction * delta),
                  soldCount: Math.max(0, (Number(pkg.soldCount) || 0) - direction * delta),
                };
              })
            );
          } else {
            setPersonalCardCounts((prev) => {
              const next = { ...prev };
              for (const [pkgId, delta] of Object.entries(deliveredByPkg)) {
                if (next[pkgId] !== undefined) {
                  next[pkgId] = Math.max(0, (Number(next[pkgId]) || 0) + direction * delta);
                }
              }
              return next;
            });
            setPersonalSoldCounts((prev) => {
              const next = { ...prev };
              for (const [pkgId, delta] of Object.entries(deliveredByPkg)) {
                next[pkgId] = Math.max(0, (Number(next[pkgId]) || 0) - direction * delta);
              }
              return next;
            });
          }
        };

        const isOnlineNow = typeof navigator === 'undefined' ? true : navigator.onLine;
        if (!isOnlineNow) {
          // Offline mode: queue directly (pendingOfflineSales memo handles stock subtraction once)
          enqueueOfflineSale(queuedFallbackPayload);
          setPendingOfflineSales(getPendingOfflineSales());
          setOfflinePoolVersion((v) => v + 1);
          notifySuccess(
            `تم تنفيذ ${typeLabel} محلياً دون إنترنت (${totalCards} كرت) ✅ — محمي من التكرار وستتم المزامنة تلقائياً`
          );
          return offlineSaleToSaleDoc(queuedFallbackPayload);
        }

        // Online Optimistic UI: update UI state immediately and open voucher modal in < 0.5s!
        applyOptimisticStockDelta(-1);
        setSales((prev) => [optimisticSale, ...prev.filter((s) => s.id !== saleId)]);
        setOfflinePoolVersion((v) => v + 1);
        notifySuccess(`تم تنفيذ ${typeLabel} (${totalCards} كرت) بنجاح ✅`);

        // STEP 4: ASYNCHRONOUS BACKGROUND FIRESTORE writeBatch COMMIT (Zero UI Blocking!)
        const commitSaleInBackground = async () => {
          try {
            // Prepare atomic write operations
            type BatchOp = (b: ReturnType<typeof writeBatch>) => void;
            const ops: BatchOp[] = [];

            // 4A. Card document status / ownership updates
            if (isElectronic && allPulledDocIds.length > 0) {
              const soldToValue = (cleanBuyerPhone || cleanBuyerName).slice(0, 128);
              for (const cardDocId of allPulledDocIds) {
                const cardRef = doc(db, 'cards', cardDocId);
                if (transferOwnershipToBuyer && cleanBuyerId) {
                  ops.push((b) =>
                    b.update(cardRef, {
                      status: 'available',
                      ownerId: cleanBuyerId,
                      soldTo: soldToValue,
                      saleId,
                      updatedAt: serverTimestamp(),
                    })
                  );
                } else {
                  ops.push((b) =>
                    b.update(cardRef, {
                      status: 'sold',
                      soldTo: soldToValue,
                      saleId,
                      updatedAt: serverTimestamp(),
                    })
                  );
                }
              }
            }

            // 4B. Package inventory counter updates (Super Admin central pool — fetch fresh counts in parallel so availableCount >= 0 rule always passes)
            const touchedPkgIds = Object.keys(deliveredByPkg);
            if (isElectronic && profile.role === 'super_admin' && touchedPkgIds.length > 0) {
              const pkgSnapList = await Promise.all(
                touchedPkgIds.map((pkgId) => getDoc(doc(db, 'packages', pkgId)))
              );
              for (const pSnap of pkgSnapList) {
                if (!pSnap.exists()) continue;
                const pData = pSnap.data() as PackageDoc;
                const deliverCount = deliveredByPkg[pSnap.id] || 0;
                if (deliverCount <= 0) continue;
                ops.push((b) =>
                  b.update(doc(db, 'packages', pSnap.id), {
                    availableCount: Math.max(0, (Number(pData.availableCount) || 0) - deliverCount),
                    soldCount: (Number(pData.soldCount) || 0) + deliverCount,
                    updatedAt: serverTimestamp(),
                  })
                );
              }
            }

            // 4C. Sale document write
            ops.push((b) =>
              b.set(doc(db, 'sales', saleId), {
                invoiceNumber,
                sellerId: activeUser.uid,
                buyerId: cleanBuyerId,
                buyerName: cleanBuyerName,
                buyerPhone: cleanBuyerPhone,
                buyerRole: input.buyerRole,
                saleType: input.saleType,
                paymentMethod: input.paymentMethod,
                discountRate: input.discountRate,
                totalAmount,
                paidAmount,
                remainingAmount,
                expectedProfit,
                realizedProfit,
                totalCards,
                deliveredCards,
                returnedCards: 0,
                items: lineItems.slice(0, 20),
                cardNumbers: allPulledNumbers.slice(0, 200),
                status,
                notes: cleanNotes,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              })
            );

            // Commit in chunks of 450 ops (Firestore hard limit is 500 ops per writeBatch)
            const CHUNK_SIZE = 450;
            const batchPromises: Array<Promise<void>> = [];
            for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
              const b = writeBatch(db);
              const slice = ops.slice(i, i + CHUNK_SIZE);
              for (const applyOp of slice) {
                applyOp(b);
              }
              batchPromises.push(b.commit());
            }
            await Promise.all(batchPromises);

            // 4D. Non-blocking buyer balance update, audit log & cloud notification
            if (cleanBuyerId && remainingAmount > 0 && profile.role === 'super_admin') {
              const buyerUser = managedUsers.find((u) => u.uid === cleanBuyerId);
              if (buyerUser) {
                updateDoc(doc(db, 'users', cleanBuyerId), {
                  balance: (Number(buyerUser.balance) || 0) + remainingAmount,
                  updatedAt: serverTimestamp(),
                }).catch(() => {});
              }
            }

            writeAuditLog(
              typeLabel,
              `فاتورة ${invoiceNumber} للمشتري ${cleanBuyerName} — ${totalCards} كرت — الإجمالي ${totalAmount} ر.ي`
            ).catch(() => {});

            sendCloudNotification({
              recipientId: cleanBuyerId || 'super_admin',
              title: `تم تسجيل ${typeLabel} (${invoiceNumber})`,
              body: `${cleanBuyerName} • ${totalCards} كرت • الإجمالي ${totalAmount} ر.ي`,
              category: input.saleType === 'paper_invoice' ? 'invoice' : 'sale',
              targetRoute: 'sales_list',
            }).catch(() => {});

            // 4E. Atomic single-doc `stats/summary` (and buyer `stats/user_{buyerId}`) counter increments (ZERO card scans!)
            if (isElectronic && touchedPkgIds.length > 0) {
              const sellerDeltas: Record<string, { available: number; sold: number }> = {};
              const buyerDeltas: Record<string, { available: number }> = {};
              for (const pkgId of touchedPkgIds) {
                const qtyDelivered = deliveredByPkg[pkgId] || 0;
                if (qtyDelivered <= 0) continue;
                sellerDeltas[pkgId] = { available: -qtyDelivered, sold: qtyDelivered };
                buyerDeltas[pkgId] = { available: qtyDelivered };
              }
              const sellerStatId = profile.role === 'super_admin' ? 'summary' : `user_${activeUser.uid}`;
              void applyStatsSummaryDelta(sellerStatId, activeUser.uid, sellerDeltas);
              if (transferOwnershipToBuyer && cleanBuyerId && profile.role === 'super_admin') {
                void applyStatsSummaryDelta(`user_${cleanBuyerId}`, cleanBuyerId, buyerDeltas);
              }
            }
          } catch (bgErr) {
            // Automatic Offline Queue Safety Net: if network dropped during background commit,
            // keep cards locked against duplication and enqueue for automatic cloud sync!
            applyOptimisticStockDelta(1);
            enqueueOfflineSale(queuedFallbackPayload);
            setPendingOfflineSales(getPendingOfflineSales());
            setOfflinePoolVersion((v) => v + 1);
            handleFirestoreError(bgErr, OperationType.WRITE, 'sales/background_batch');
          }
        };

        void commitSaleInBackground();
        return optimisticSale;
      } catch (err) {
        rollbackLocalSelection();
        const msg = err instanceof Error ? err.message : 'تعذر إتمام عملية البيع';
        handleFirestoreError(err, OperationType.WRITE, 'sales/transaction');
        notifyError('تعذر إتمام البيع', msg);
        return null;
      } finally {
        inFlightOpsRef.current.delete(opKey);
      }
    },
    [firebaseUser, managedUsers, notifyError, notifySuccess, notifyWarning, packages, profile, sendCloudNotification, writeAuditLog]
  );

  // Deliver remaining cards for a partial electronic wholesale order
  const deliverPartialCards = useCallback(
    async (sale: SaleDoc, packageId: string, countToDeliver: number): Promise<string[]> => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile || countToDeliver <= 0) return [];

      try {
        const q =
          profile.role === 'super_admin'
            ? query(
                collection(db, 'cards'),
                where('packageId', '==', packageId),
                where('status', '==', 'available'),
                limit(countToDeliver)
              )
            : query(
                collection(db, 'cards'),
                where('ownerId', '==', activeUser.uid),
                where('packageId', '==', packageId),
                where('status', '==', 'available'),
                limit(countToDeliver)
              );
        const snap = await getDocs(q);
        if (snap.docs.length < countToDeliver) {
          notifyError('المخزون غير كافٍ', `المتاح حالياً ${snap.docs.length} كرت فقط.`);
          return [];
        }

        const pulled: string[] = [];
        const batch = writeBatch(db);
        for (const d of snap.docs) {
          const cardData = d.data() as CardDoc;
          pulled.push(cardData.cardNumber);
          batch.update(d.ref, {
            status: 'sold',
            soldTo: (sale.buyerPhone || sale.buyerName).slice(0, 128),
            saleId: sale.id,
            updatedAt: serverTimestamp(),
          });
        }

        const nextItems = (sale.items || []).map((it) =>
          it.packageId === packageId
            ? {
                ...it,
                delivered: it.delivered + pulled.length,
                cardNumbers: [...(it.cardNumbers || []), ...pulled],
              }
            : it
        );
        const nextDelivered = (sale.deliveredCards || 0) + pulled.length;
        const nextCards = [...(sale.cardNumbers || []), ...pulled].slice(0, 200);
        const nextStatus: SaleDoc['status'] =
          nextDelivered >= sale.totalCards && sale.remainingAmount <= 0 ? 'completed' : 'partial';

        batch.update(doc(db, 'sales', sale.id), {
          items: nextItems,
          deliveredCards: nextDelivered,
          cardNumbers: nextCards,
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });

        const pkg = packages.find((p) => p.id === packageId);
        if (pkg) {
          batch.update(doc(db, 'packages', packageId), {
            availableCount: Math.max(0, (Number(pkg.availableCount) || 0) - pulled.length),
            soldCount: (Number(pkg.soldCount) || 0) + pulled.length,
            updatedAt: serverTimestamp(),
          });
        }

        await batch.commit();
        const sellerStatId = profile?.role === 'super_admin' ? 'summary' : `user_${activeUser.uid}`;
        void applyStatsSummaryDelta(sellerStatId, activeUser.uid, {
          [packageId]: { available: -pulled.length, sold: pulled.length },
        });
        await writeAuditLog('تسليم دفعة كروت', `تسليم ${pulled.length} كرت إضافي للفاتورة ${sale.invoiceNumber || sale.id}`);
        notifySuccess(`تم تسليم ${pulled.length} كرت من الدفعة المتبقية بنجاح`);
        return pulled;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `sales/${sale.id}/deliver`);
        notifyError('تعذر تسليم الدفعة');
        return [];
      }
    },
    [firebaseUser, notifyError, notifySuccess, packages, profile, writeAuditLog]
  );

  // Process returned cards for a sale
  const processSaleReturn = useCallback(
    async (sale: SaleDoc, packageId: string, returnQty: number): Promise<boolean> => {
      if (returnQty <= 0) return false;
      try {
        const targetItem = (sale.items || []).find((i) => i.packageId === packageId);
        if (!targetItem) return false;
        const maxReturnable = Math.max(0, targetItem.delivered - (targetItem.returned || 0));
        const qty = Math.min(returnQty, maxReturnable);
        if (qty <= 0) {
          notifyWarning('لا توجد كروت قابلة للإرجاع في هذه الباقة');
          return false;
        }

        const batch = writeBatch(db);
        const returnedCodes = (targetItem.cardNumbers || []).slice(-qty);

        if (sale.saleType !== 'paper_invoice' && returnedCodes.length > 0) {
          for (const code of returnedCodes) {
            // Support both Update 14 direct cardNumber ID and legacy card_${packageId}_${code} ID
            const directRef = doc(db, 'cards', code);
            const directSnap = await getDoc(directRef);
            const targetCardRef = directSnap.exists()
              ? directRef
              : doc(db, 'cards', `card_${packageId}_${code}`);
            batch.update(targetCardRef, {
              status: 'available',
              soldTo: '',
              saleId: '',
              updatedAt: serverTimestamp(),
            });
          }
          batch.update(doc(db, 'packages', packageId), {
            availableCount: increment(returnedCodes.length),
            soldCount: increment(-returnedCodes.length),
            updatedAt: serverTimestamp(),
          });
        }

        const nextItems = (sale.items || []).map((i) =>
          i.packageId === packageId
            ? {
                ...i,
                returned: (i.returned || 0) + qty,
                cardNumbers: (i.cardNumbers || []).slice(0, Math.max(0, (i.cardNumbers || []).length - qty)),
              }
            : i
        );
        const nextReturnedTotal = (sale.returnedCards || 0) + qty;
        const refundAmount = targetItem.unitPrice * qty;
        const nextRemaining = Math.max(0, sale.remainingAmount - refundAmount);

        batch.update(doc(db, 'sales', sale.id), {
          items: nextItems,
          returnedCards: nextReturnedTotal,
          remainingAmount: nextRemaining,
          status: nextReturnedTotal >= sale.totalCards ? 'returned' : sale.status,
          updatedAt: serverTimestamp(),
        });

        await batch.commit();
        const activeUser = auth.currentUser || firebaseUser;
        if (sale.saleType !== 'paper_invoice' && returnedCodes.length > 0 && activeUser) {
          const sellerStatId = profile?.role === 'super_admin' ? 'summary' : `user_${activeUser.uid}`;
          void applyStatsSummaryDelta(sellerStatId, activeUser.uid, {
            [packageId]: { available: returnedCodes.length, sold: -returnedCodes.length },
          });
        }
        await writeAuditLog('مرتجع كروت', `إرجاع ${qty} كرت من الفاتورة ${sale.invoiceNumber || sale.id}`);
        notifySuccess(`تم تسجيل إرجاع ${qty} كرت وتحديث المخزون والحساب`);
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `sales/${sale.id}/return`);
        notifyError('تعذر تسجيل المرتجع');
        return false;
      }
    },
    [firebaseUser, notifyError, notifySuccess, notifyWarning, packages, profile, writeAuditLog]
  );

  const updateSaleRecord = useCallback(
    async (
      saleId: string,
      updates: Partial<
        Pick<
          SaleDoc,
          'buyerName' | 'buyerPhone' | 'paidAmount' | 'remainingAmount' | 'realizedProfit' | 'paymentMethod' | 'notes' | 'status'
        >
      >
    ) => {
      try {
        await updateDoc(doc(db, 'sales', saleId), {
          ...updates,
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog('تعديل عملية بيع', `تم تعديل سجل البيع ${saleId}`);
        notifySuccess('تم تعديل بيانات عملية البيع بنجاح');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `sales/${saleId}`);
        notifyError('تعذر تعديل عملية البيع');
      }
    },
    [notifyError, notifySuccess, writeAuditLog]
  );

  const deleteSaleRecord = useCallback(
    async (saleId: string) => {
      try {
        await deleteDoc(doc(db, 'sales', saleId));
        await writeAuditLog('حذف عملية بيع', `تم حذف سجل البيع ${saleId}`);
        notifySuccess('تم حذف سجل البيع بنجاح');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `sales/${saleId}`);
        notifyError('تعذر حذف سجل البيع');
      }
    },
    [notifyError, notifySuccess, writeAuditLog]
  );

  // =========================================================================
  // UPDATE 5: CUSTOMERS & GENERAL ACCOUNTING LEDGER
  // =========================================================================
  const createCustomerAccount = useCallback(
    async (input: {
      name: string;
      phone?: string;
      category?: string;
      notes?: string;
      initialDebit?: number;
      initialCredit?: number;
    }): Promise<CustomerAccount | null> => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser) return null;
      const customerId = generateSafeDocId('cust');
      const debit = Math.max(0, Number(input.initialDebit) || 0);
      const credit = Math.max(0, Number(input.initialCredit) || 0);
      const balance = debit - credit;

      try {
        await setDoc(doc(db, 'customers', customerId), {
          ownerId: activeUser.uid,
          name: input.name.trim().slice(0, 100),
          phone: (input.phone || '').slice(0, 20),
          category: (input.category || 'عميل كروت').slice(0, 50),
          totalDebit: debit,
          totalCredit: credit,
          balance,
          notes: (input.notes || '').slice(0, 500),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (debit > 0) {
          await setDoc(doc(db, 'ledgerEntries', generateSafeDocId('led')), {
            ownerId: activeUser.uid,
            customerId,
            entryType: 'debit',
            amount: debit,
            description: 'رصيد افتتاحي مستحق (عليه)',
            createdAt: serverTimestamp(),
          });
        }
        if (credit > 0) {
          await setDoc(doc(db, 'ledgerEntries', generateSafeDocId('led')), {
            ownerId: activeUser.uid,
            customerId,
            entryType: 'credit',
            amount: credit,
            description: 'دفعة افتتاحية مسلّمة (له)',
            createdAt: serverTimestamp(),
          });
        }

        await writeAuditLog('إضافة حساب عميل', `تم فتح حساب دفتر محاسبي: ${input.name}`);
        notifySuccess(`تم إضافة حساب ${input.name} بنجاح`);
        return {
          id: customerId,
          ownerId: activeUser.uid,
          name: input.name.trim(),
          phone: input.phone,
          category: input.category || 'عميل كروت',
          totalDebit: debit,
          totalCredit: credit,
          balance,
          notes: input.notes,
        };
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `customers/${customerId}`);
        notifyError('تعذر إضافة الحساب');
        return null;
      }
    },
    [firebaseUser, notifyError, notifySuccess, writeAuditLog]
  );

  const updateCustomerAccount = useCallback(
    async (
      customerId: string,
      updates: Partial<Pick<CustomerAccount, 'name' | 'phone' | 'category' | 'notes'>>
    ) => {
      try {
        await updateDoc(doc(db, 'customers', customerId), {
          ...updates,
          updatedAt: serverTimestamp(),
        });
        notifySuccess('تم تعديل بيانات العميل بنجاح');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `customers/${customerId}`);
        notifyError('تعذر تعديل بيانات العميل');
      }
    },
    [notifyError, notifySuccess]
  );

  const deleteCustomerAccount = useCallback(
    async (customerId: string) => {
      try {
        await deleteDoc(doc(db, 'customers', customerId));
        await writeAuditLog('حذف حساب عميل', `تم حذف الحساب المحاسبي ${customerId}`);
        notifySuccess('تم حذف حساب العميل بنجاح');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `customers/${customerId}`);
        notifyError('تعذر حذف الحساب');
      }
    },
    [notifyError, notifySuccess, writeAuditLog]
  );

  const addLedgerEntry = useCallback(
    async (input: {
      customerId: string;
      entryType: 'debit' | 'credit' | 'adjustment';
      amount: number;
      description: string;
    }): Promise<boolean> => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || input.amount <= 0) return false;
      const opKey = `ledger_${input.customerId}_${input.entryType}_${input.amount}`;
      if (inFlightOpsRef.current.has(opKey)) {
        notifyWarning('جاري حفظ القيد المحاسبي بالفعل...');
        return false;
      }
      inFlightOpsRef.current.add(opKey);
      const entryId = generateSafeDocId('led');

      try {
        const custRef = doc(db, 'customers', input.customerId);
        await runTransaction(db, async (tx) => {
          const cSnap = await tx.get(custRef);
          if (!cSnap.exists()) throw new Error('الحساب غير موجود');
          const cData = cSnap.data() as CustomerAccount;
          const nextDebit =
            input.entryType === 'debit'
              ? (Number(cData.totalDebit) || 0) + input.amount
              : Number(cData.totalDebit) || 0;
          const nextCredit =
            input.entryType === 'credit'
              ? (Number(cData.totalCredit) || 0) + input.amount
              : Number(cData.totalCredit) || 0;
          const nextBalance =
            input.entryType === 'adjustment'
              ? (Number(cData.balance) || 0) - input.amount
              : nextDebit - nextCredit;

          tx.set(doc(db, 'ledgerEntries', entryId), {
            ownerId: activeUser.uid,
            customerId: input.customerId,
            entryType: input.entryType,
            amount: input.amount,
            description: input.description.trim().slice(0, 300),
            createdAt: serverTimestamp(),
          });
          tx.update(custRef, {
            totalDebit: nextDebit,
            totalCredit: nextCredit,
            balance: nextBalance,
            updatedAt: serverTimestamp(),
          });
        });

        await writeAuditLog(
          input.entryType === 'credit' ? 'تسديد مالي' : 'قيد محاسبي',
          `${input.description} — المبلغ ${input.amount} ر.ي`
        );
        notifySuccess(
          input.entryType === 'credit'
            ? `تم تسجيل التسديد (${input.amount} ر.ي) بنجاح`
            : `تم إضافة القيد (${input.amount} ر.ي) بنجاح`
        );
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `ledgerEntries/${entryId}`);
        notifyError('تعذر حفظ القيد المحاسبي');
        return false;
      } finally {
        inFlightOpsRef.current.delete(opKey);
      }
    },
    [firebaseUser, notifyError, notifySuccess, notifyWarning, writeAuditLog]
  );

  const deleteLedgerEntry = useCallback(
    async (entry: LedgerEntry) => {
      try {
        const custRef = doc(db, 'customers', entry.customerId);
        await runTransaction(db, async (tx) => {
          const cSnap = await tx.get(custRef);
          if (cSnap.exists()) {
            const cData = cSnap.data() as CustomerAccount;
            const nextDebit =
              entry.entryType === 'debit'
                ? Math.max(0, (Number(cData.totalDebit) || 0) - entry.amount)
                : Number(cData.totalDebit) || 0;
            const nextCredit =
              entry.entryType === 'credit'
                ? Math.max(0, (Number(cData.totalCredit) || 0) - entry.amount)
                : Number(cData.totalCredit) || 0;
            tx.update(custRef, {
              totalDebit: nextDebit,
              totalCredit: nextCredit,
              balance: nextDebit - nextCredit,
              updatedAt: serverTimestamp(),
            });
          }
          tx.delete(doc(db, 'ledgerEntries', entry.id));
        });
        notifySuccess('تم حذف القيد وتصحيح الرصيد بنجاح');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `ledgerEntries/${entry.id}`);
        notifyError('تعذر حذف القيد');
      }
    },
    [notifyError, notifySuccess]
  );

  // =========================================================================
  // UPDATE 7: TWO-TIER TOPUP / FEED REQUESTS
  // =========================================================================
  const submitTopupRequest = useCallback(
    async (input: { items: TopupLineItem[]; notes?: string }): Promise<boolean> => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile) return false;
      const validItems = input.items.filter((i) => i.quantity > 0);
      if (validItems.length === 0) {
        notifyWarning('اختر كمية كروت واحدة على الأقل');
        return false;
      }

      const opKey = `topup_submit_${activeUser.uid}`;
      if (inFlightOpsRef.current.has(opKey)) {
        notifyWarning('جاري إرسال طلب التغذية بالفعل...');
        return false;
      }
      inFlightOpsRef.current.add(opKey);

      const reqId = generateSafeDocId('topup');
      const totalCards = validItems.reduce((s, i) => s + i.quantity, 0);
      const totalAmount = validItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
      const targetId =
        profile.role === 'client' && profile.parentAgentId ? profile.parentAgentId : 'super_admin';
      const parentAgent = managedUsers.find((u) => u.uid === targetId);
      const targetName =
        targetId === 'super_admin'
          ? SUPER_ADMIN_CONFIG.name
          : parentAgent?.name || 'الوكيل المباشر';

      try {
        await setDoc(doc(db, 'topupRequests', reqId), {
          requesterId: activeUser.uid,
          requesterName: profile.name.slice(0, 100),
          requesterPhone: (profile.phone || '').slice(0, 20),
          requesterRole: profile.role === 'agent' ? 'agent' : 'client',
          discountRate: profile.discountRate || (profile.role === 'agent' ? appSettings.agentDiscountPercent : appSettings.clientDiscountPercent),
          targetId,
          targetName: targetName.slice(0, 100),
          items: validItems.slice(0, 20),
          totalCards,
          totalAmount,
          status: 'pending',
          notes: (input.notes || '').slice(0, 500),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await sendCloudNotification({
          recipientId: targetId,
          title: 'طلب تغذية جديد',
          body: `أرسل ${profile.name} طلب تغذية (${totalCards} كرت — ${totalAmount} ر.ي)`,
          category: 'topup',
          targetRoute: 'topup_requests',
        });

        await writeAuditLog('طلب تغذية', `طلب ${totalCards} كرت بإجمالي ${totalAmount} ر.ي إلى ${targetName}`);
        notifySuccess(`تم إرسال طلب التغذية (${totalCards} كرت) إلى ${targetName} بنجاح`);
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `topupRequests/${reqId}`);
        notifyError('تعذر إرسال طلب التغذية');
        return false;
      } finally {
        inFlightOpsRef.current.delete(opKey);
      }
    },
    [appSettings, firebaseUser, managedUsers, notifyError, notifySuccess, notifyWarning, profile, sendCloudNotification, writeAuditLog]
  );

  const approveTopupRequest = useCallback(
    async (req: TopupRequest): Promise<boolean> => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile) return false;
      if (req.status !== 'pending') {
        notifyWarning('تمت معالجة هذا الطلب مسبقاً');
        return false;
      }
      const opKey = `topup_approve_${req.id}`;
      if (inFlightOpsRef.current.has(opKey)) {
        notifyWarning('جاري اعتماد طلب التغذية بالفعل...');
        return false;
      }
      inFlightOpsRef.current.add(opKey);
      try {
        // Re-verify live Firestore status to prevent double-approval across devices
        const liveSnap = await getDoc(doc(db, 'topupRequests', req.id));
        if (!liveSnap.exists() || (liveSnap.data() as TopupRequest).status !== 'pending') {
          notifyWarning('تمت معالجة طلب التغذية مسبقاً من جهاز آخر');
          return false;
        }

        // Transfer real available cards if items are specified — abort approval if sale fails!
        const items = req.items || [];
        if (items.length > 0) {
          const saleResult = await executeSaleTransaction({
            saleType: 'electronic_wholesale',
            buyerId: req.requesterId,
            buyerName: req.requesterName,
            buyerPhone: req.requesterPhone,
            buyerRole: req.requesterRole,
            paymentMethod: 'credit',
            discountRate: req.discountRate || (req.requesterRole === 'agent' ? appSettings.agentDiscountPercent : appSettings.clientDiscountPercent),
            paidAmount: 0,
            notes: `تنفيذ طلب التغذية #${req.id.slice(-6)}`,
            items: items.map((i) => ({ packageId: i.packageId, quantity: i.quantity })),
          });
          if (!saleResult) {
            return false;
          }
        }

        await updateDoc(doc(db, 'topupRequests', req.id), {
          status: 'approved',
          updatedAt: serverTimestamp(),
        });

        await sendCloudNotification({
          recipientId: req.requesterId,
          title: 'تمت الموافقة وتنفيذ طلب التغذية ✅',
          body: `تم اعتماد وتنفيذ طلبك (${req.totalCards} كرت — ${req.totalAmount} ر.ي) وتحديث رصيدك ومخزونك.`,
          category: 'topup',
          targetRoute: 'topup_requests',
        });

        await writeAuditLog('تنفيذ طلب تغذية', `تم قبول وتنفيذ طلب ${req.requesterName} (${req.totalCards} كرت)`);
        notifySuccess(`تم قبول وتنفيذ طلب التغذية لـ ${req.requesterName}`);
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `topupRequests/${req.id}`);
        notifyError('تعذر تنفيذ طلب التغذية');
        return false;
      } finally {
        inFlightOpsRef.current.delete(opKey);
      }
    },
    [appSettings, executeSaleTransaction, firebaseUser, notifyError, notifySuccess, notifyWarning, profile, sendCloudNotification, writeAuditLog]
  );

  const rejectTopupRequest = useCallback(
    async (req: TopupRequest, reason: string) => {
      const cleanReason = reason.trim().slice(0, 300) || 'تم رفض الطلب من الإدارة';
      try {
        await updateDoc(doc(db, 'topupRequests', req.id), {
          status: 'rejected',
          rejectionReason: cleanReason,
          updatedAt: serverTimestamp(),
        });
        await sendCloudNotification({
          recipientId: req.requesterId,
          title: 'تم رفض طلب التغذية',
          body: `السبب: ${cleanReason}`,
          category: 'topup',
          targetRoute: 'topup_requests',
        });
        await writeAuditLog('رفض طلب تغذية', `رفض طلب ${req.requesterName} — السبب: ${cleanReason}`);
        notifySuccess('تم رفض طلب التغذية وإشعار صاحب الطلب');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `topupRequests/${req.id}`);
        notifyError('تعذر رفض الطلب');
      }
    },
    [notifyError, notifySuccess, sendCloudNotification, writeAuditLog]
  );

  // =========================================================================
  // UPDATES 8 & 10: AGENTS, CLIENTS, APPROVALS, UPGRADE/DEMOTE, TRANSFER
  // =========================================================================
  const approveRegistration = useCallback(
    async (req: RegistrationRequest, roleOverride?: 'agent' | 'client') => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile) return;
      const finalRole = roleOverride || req.requestedRole;
      const rate =
        finalRole === 'agent'
          ? appSettings.agentDiscountPercent
          : appSettings.clientDiscountPercent;

      try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'registrationRequests', req.id), {
          status: 'approved',
          reviewedBy: activeUser.uid,
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'users', req.applicantUid), {
          status: 'active',
          role: finalRole,
          discountRate: rate,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        await sendCloudNotification({
          recipientId: req.applicantUid,
          title: 'تمت الموافقة على حسابك في طيبة نت ✅',
          body: `مرحباً ${req.name}، تم تفعيل حسابك بدور ${finalRole === 'agent' ? 'وكيل معتمد' : 'عميل / نقطة بيع'}.`,
          category: 'registration',
          targetRoute: 'home',
        });
        await writeAuditLog('قبول طلب انضمام', `تفعيل ${req.name} (${req.phone}) بدور ${finalRole}`);
        notifySuccess(`تم قبول وتفعيل ${req.name} كـ ${finalRole === 'agent' ? 'وكيل معتمد' : 'عميل'}`);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `registrationRequests/${req.id}`);
        notifyError('تعذر قبول الطلب');
      }
    },
    [appSettings, firebaseUser, notifyError, notifySuccess, profile, sendCloudNotification, writeAuditLog]
  );

  const rejectRegistration = useCallback(
    async (req: RegistrationRequest, reason: string) => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile) return;
      const cleanReason = reason.trim().slice(0, 300) || 'تم رفض الطلب من قبل الإدارة';
      try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'registrationRequests', req.id), {
          status: 'rejected',
          rejectionReason: cleanReason,
          reviewedBy: activeUser.uid,
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'users', req.applicantUid), {
          status: 'rejected',
          rejectionReason: cleanReason,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        await sendCloudNotification({
          recipientId: req.applicantUid,
          title: 'تحديث بخصوص طلب الانضمام',
          body: `عذراً ${req.name}، لم تتم الموافقة على الطلب. السبب: ${cleanReason}`,
          category: 'registration',
          targetRoute: 'home',
        });
        await writeAuditLog('رفض طلب انضمام', `رفض ${req.name} — السبب: ${cleanReason}`);
        notifySuccess(`تم رفض طلب ${req.name} وإرسال الإشعار`);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `registrationRequests/${req.id}`);
        notifyError('تعذر رفض الطلب');
      }
    },
    [firebaseUser, notifyError, notifySuccess, profile, sendCloudNotification, writeAuditLog]
  );

  const createManualUser = useCallback(
    async (input: {
      name: string;
      phone: string;
      email?: string;
      role: 'agent' | 'client';
      parentAgentId?: string;
      discountRate?: number;
    }): Promise<boolean> => {
      if (!profile || profile.role !== 'super_admin') return false;
      const uid = generateSafeDocId('usr');
      const rate =
        input.discountRate ??
        (input.role === 'agent' ? appSettings.agentDiscountPercent : appSettings.clientDiscountPercent);
      const normalizedPhoneDigits = normalizeDigits(input.phone)
        .replace(/[^\d]/g, '')
        .replace(/^00967|^967/, '');
      const cleanPhone = (normalizedPhoneDigits.length >= 7 ? normalizedPhoneDigits : input.phone.trim()).slice(0, 20);
      const cleanEmail = (
        input.email?.trim().toLowerCase() || `${normalizedPhoneDigits || cleanPhone.replace(/[^\d]/g, '')}@taibah.net`
      ).slice(0, 120);
      try {
        await setDoc(doc(db, 'users', uid), {
          uid,
          name: input.name.trim().slice(0, 100),
          phone: cleanPhone,
          email: cleanEmail,
          role: input.role,
          status: 'active',
          parentAgentId: input.role === 'client' ? (input.parentAgentId || '').slice(0, 128) : '',
          discountRate: rate,
          balance: 0,
          fcmTokens: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog('إضافة حساب جديد', `إضافة ${input.role === 'agent' ? 'وكيل' : 'عميل'}: ${input.name} (${input.phone})`);
        notifySuccess(`تم إضافة ${input.name} بنجاح`);
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${uid}`);
        notifyError('تعذر إضافة الحساب');
        return false;
      }
    },
    [appSettings, notifyError, notifySuccess, profile, writeAuditLog]
  );

  const updateManagedUser = useCallback(
    async (
      uid: string,
      updates: Partial<Pick<UserProfile, 'name' | 'phone' | 'role' | 'status' | 'discountRate' | 'balance' | 'parentAgentId'>>
    ) => {
      try {
        await updateDoc(doc(db, 'users', uid), {
          ...updates,
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog('تعديل بيانات حساب', `تم تعديل بيانات المستخدم ${uid}`);
        notifySuccess('تم تعديل بيانات الحساب بنجاح');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
        notifyError('تعذر تعديل الحساب');
      }
    },
    [notifyError, notifySuccess, writeAuditLog]
  );

  const toggleUserRoleUpgrade = useCallback(
    async (user: UserProfile) => {
      if (user.role === 'super_admin') return;
      const nextRole: 'agent' | 'client' = user.role === 'client' ? 'agent' : 'client';
      const nextRate =
        nextRole === 'agent' ? appSettings.agentDiscountPercent : appSettings.clientDiscountPercent;
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          role: nextRole,
          discountRate: nextRate,
          parentAgentId: nextRole === 'agent' ? '' : user.parentAgentId || '',
          updatedAt: serverTimestamp(),
        });
        await sendCloudNotification({
          recipientId: user.uid,
          title: nextRole === 'agent' ? 'تهانينا! تمت ترقيتك إلى وكيل معتمد' : 'تحديث مستوى الحساب',
          body:
            nextRole === 'agent'
              ? `تمت ترقية حسابك إلى وكيل معتمد بنسبة تسعير ${nextRate}%.`
              : `تم تحويل حسابك إلى عميل / نقطة بيع بنسبة تسعير ${nextRate}%.`,
          category: 'account',
          targetRoute: 'home',
        });
        await writeAuditLog(
          nextRole === 'agent' ? 'ترقية عميل إلى وكيل' : 'تحويل وكيل إلى عميل',
          `${user.name} (${user.phone}) ← ${nextRole} (${nextRate}%)`
        );
        notifySuccess(
          nextRole === 'agent'
            ? `تمت ترقية ${user.name} إلى وكيل معتمد (${nextRate}%)`
            : `تم تحويل ${user.name} إلى عميل / نقطة بيع (${nextRate}%)`
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
        notifyError('تعذر تغيير الصلاحية');
      }
    },
    [appSettings, notifyError, notifySuccess, sendCloudNotification, writeAuditLog]
  );

  const transferClientsToAgent = useCallback(
    async (clientUids: string[], targetAgentId: string) => {
      if (clientUids.length === 0) return;
      try {
        const batch = writeBatch(db);
        for (const uid of clientUids) {
          batch.update(doc(db, 'users', uid), {
            parentAgentId: targetAgentId,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
        await writeAuditLog('نقل عملاء', `تم نقل ${clientUids.length} عميل إلى ${targetAgentId || 'الإدارة العامة'}`);
        notifySuccess(`تم نقل ${clientUids.length} حساب بنجاح`);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'users/transfer');
        notifyError('تعذر نقل الحسابات');
      }
    },
    [notifyError, notifySuccess, writeAuditLog]
  );

  const deleteManagedUser = useCallback(
    async (user: UserProfile) => {
      if (user.role === 'super_admin') return;
      try {
        await deleteDoc(doc(db, 'users', user.uid));
        await writeAuditLog('حذف حساب', `تم حذف حساب ${user.name} (${user.phone})`);
        notifySuccess(`تم حذف حساب ${user.name} بنجاح`);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}`);
        notifyError('تعذر حذف الحساب');
      }
    },
    [notifyError, notifySuccess, writeAuditLog]
  );

  const resolvePasswordReset = useCallback(
    async (req: PasswordResetRequest, status: 'approved' | 'rejected') => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser) return;
      try {
        await updateDoc(doc(db, 'passwordResetRequests', req.id), {
          status,
          resolvedBy: activeUser.uid,
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog('طلب استعادة كلمة المرور', `${status === 'approved' ? 'اعتماد' : 'رفض'} طلب ${req.identifier}`);
        notifySuccess(status === 'approved' ? 'تم اعتماد طلب استعادة الحساب' : 'تم رفض طلب الاستعادة');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `passwordResetRequests/${req.id}`);
        notifyError('تعذر تحديث الطلب');
      }
    },
    [firebaseUser, notifyError, notifySuccess, writeAuditLog]
  );

  const enablePushNotifications = useCallback(async (): Promise<boolean> => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!activeUser || !profile) return false;
    const token = await requestFCMToken();
    if (!token) {
      notifySuccess('الإشعارات اللحظية مفعّلة بنجاح على هذا المتصفح');
      return true;
    }
    try {
      const existingTokens = Array.isArray(profile.fcmTokens) ? profile.fcmTokens : [];
      const nextTokens = Array.from(new Set([token, ...existingTokens])).slice(0, 5);
      await updateDoc(doc(db, 'users', activeUser.uid), {
        fcmTokens: nextTokens,
        updatedAt: serverTimestamp(),
      });
      notifySuccess('تم تفعيل الإشعارات الخارجية (FCM) لهذا الجهاز');
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${activeUser.uid}`);
      return false;
    }
  }, [firebaseUser, notifySuccess, profile]);

  const exportCloudBackup = useCallback(async () => {
    if (!profile) return;
    try {
      const serializedUsers = (profile.role === 'super_admin' ? managedUsers : [profile]).map((u) =>
        serializePlainAccountForBackup(u as unknown as Record<string, unknown>, u.uid)
      );
      const serializedPackages = packages.slice(0, 20).map((p) => ({
        id: p.id,
        code: p.code,
        price: p.price,
        availableCount: p.availableCount,
        soldCount: p.soldCount,
      }));
      const backupPayload = {
        exportedAt: new Date().toISOString(),
        app: 'TAIBAH NET — كروت طيبة نت',
        credit: SUPER_ADMIN_CONFIG.developerCredit,
        exportedBy: { uid: profile.uid, name: profile.name, role: profile.role },
        settings: appSettings,
        packages,
        sales,
        customers,
        ledgerEntries,
        topupRequests,
        users: profile.role === 'super_admin' ? managedUsers : [profile],
        pendingRegistrations,
        notificationsCount: notifications.length,
        auditLogsCount: auditLogs.length,
      };
      // Also store a cloud + local snapshot for Super Admin so one-click recovery can restore from it
      if (profile.role === 'super_admin') {
        const activeUid = auth.currentUser?.uid || profile.uid;
        writeCachedJson(CACHE_USERS_LIST_KEY, serializedUsers);
        writeCachedJson(CACHE_AUTO_BACKUP_KEY, {
          backupType: 'manual_backup',
          createdBy: activeUid,
          createdAt: new Date().toISOString(),
          usersCount: serializedUsers.length,
          clientsCount: 0,
          salesCount: sales.length,
          customersCount: customers.length,
          users: serializedUsers,
          clients: [],
          packages: serializedPackages,
        });
        await setDoc(doc(db, 'backups', `manual_backup_${Date.now()}`), {
          backupType: 'manual_backup',
          createdBy: activeUid,
          createdAt: serverTimestamp(),
          scope: 'manual_export',
          usersCount: serializedUsers.length,
          clientsCount: 0,
          salesCount: sales.length,
          customersCount: customers.length,
          users: serializedUsers.slice(0, 500),
          clients: [],
          packages: serializedPackages,
        }).catch(() => {});
      }

      const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `taibah-net-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await writeAuditLog('نسخة احتياطية سحابية', 'تم تصدير وحفظ النسخة الاحتياطية الكاملة (سحابياً + JSON)');
      notifySuccess('تم تنزيل وحفظ النسخة الاحتياطية السحابية بنجاح');
    } catch {
      notifyError('فشل التصدير');
    }
  }, [
    appSettings,
    auditLogs.length,
    customers,
    ledgerEntries,
    managedUsers,
    notifications.length,
    notifyError,
    notifySuccess,
    packages,
    pendingRegistrations,
    profile,
    sales,
    topupRequests,
    writeAuditLog,
  ]);

  // =========================================================================
  // SUPER ADMIN ONLY: RESTORE DELETED AGENTS & CLIENTS FROM ALL SOURCES
  // 1) Cloud Backups (`backups`) + Local Backups (`localStorage` & `IndexedDB`)
  // 2) Historical logs & records (`auditLogs`, `audit_logs`, `registrationRequests`,
  //    `topupRequests`, `sales`, `customers`, `passwordResetRequests`)
  // Writes recovered accounts cleanly to BOTH `users` and `clients` via writeBatch
  // =========================================================================
  const restoreDeletedAgentsAndClients = useCallback(
    async (
      onProgress?: (stage: string) => void
    ): Promise<{
      ok: boolean;
      restoredCount: number;
      updatedClientsMirrorCount: number;
      totalFound: number;
      sourcesSummary: string;
      summary: string;
    }> => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile || profile.role !== 'super_admin') {
        const msg = 'هذه الأداة محصورة بالمدير العام (super_admin) فقط.';
        notifyError('صلاحية غير كافية', msg);
        return {
          ok: false,
          restoredCount: 0,
          updatedClientsMirrorCount: 0,
          totalFound: 0,
          sourcesSummary: '',
          summary: msg,
        };
      }

      if (!navigator.onLine) {
        const msg = 'يرجى التأكد من الاتصال بالإنترنت لاسترجاع الحسابات ومزامنتها مع قاعدة البيانات السحابية.';
        notifyWarning('لا يوجد اتصال بالإنترنت', msg);
        return {
          ok: false,
          restoredCount: 0,
          updatedClientsMirrorCount: 0,
          totalFound: 0,
          sourcesSummary: '',
          summary: msg,
        };
      }

      interface RecoveredCandidate {
        uid: string;
        name: string;
        phone: string;
        email: string;
        role: 'agent' | 'client';
        status: 'active' | 'pending' | 'rejected' | 'suspended';
        parentAgentId: string;
        discountRate: number;
        balance: number;
        priority: number;
        source: string;
      }

      const defaultAgentRate = appSettings.agentDiscountPercent || 70;
      const defaultClientRate = appSettings.clientDiscountPercent || 80;
      const adminPhone = SUPER_ADMIN_CONFIG.phone;
      const isSuperAdminIdentity = (uid: string, email: string, phone: string) => {
        if (uid && uid === activeUser.uid) return true;
        if (email && isSuperAdminEmail(email)) return true;
        if (phone && phone === adminPhone) return true;
        return false;
      };

      const candidatesByKey = new Map<string, RecoveredCandidate>();
      const sourceHitCounts = new Map<string, number>();

      const bumpSource = (src: string) => {
        sourceHitCounts.set(src, (sourceHitCounts.get(src) || 0) + 1);
      };

      const isValidDocId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(id);

      const addCandidate = (input: {
        uid?: unknown;
        name?: unknown;
        phone?: unknown;
        email?: unknown;
        role?: unknown;
        status?: unknown;
        parentAgentId?: unknown;
        discountRate?: unknown;
        balance?: unknown;
        priority: number;
        source: string;
      }) => {
        const rawEmail = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        let phone = normalizePhoneDigits(input.phone);
        if (!phone && rawEmail.includes('@')) {
          phone = normalizePhoneDigits(rawEmail.split('@')[0]);
        }
        const rawUid = typeof input.uid === 'string' && isValidDocId(input.uid.trim()) ? input.uid.trim() : '';
        const email = rawEmail && rawEmail.includes('@') ? rawEmail.slice(0, 120) : phone ? `${phone}@taibah.net` : '';

        if (!phone && !email && !rawUid) return;
        if (isSuperAdminIdentity(rawUid, email, phone)) return;

        const key = phone ? `p:${phone}` : email ? `e:${email}` : `u:${rawUid}`;
        const parsedRole: 'agent' | 'client' = input.role === 'agent' ? 'agent' : 'client';
        const parsedStatus: 'active' | 'pending' | 'rejected' | 'suspended' =
          input.status === 'suspended' ? 'suspended' : 'active';
        const rawName = typeof input.name === 'string' ? input.name.trim() : '';
        const cleanName =
          rawName.length >= 2 && !rawName.startsWith('حساب ')
            ? rawName.slice(0, 100)
            : rawName.length >= 2
            ? rawName.slice(0, 100)
            : phone
            ? `حساب ${phone}`
            : 'عميل طيبة نت';
        const parsedDiscount =
          typeof input.discountRate === 'number' && input.discountRate >= 1 && input.discountRate <= 100
            ? input.discountRate
            : parsedRole === 'agent'
            ? defaultAgentRate
            : defaultClientRate;
        const parsedBalance = typeof input.balance === 'number' && Number.isFinite(input.balance) ? input.balance : 0;
        const parsedParent =
          typeof input.parentAgentId === 'string' && input.parentAgentId.trim()
            ? input.parentAgentId.trim().slice(0, 128)
            : '';

        const existing = candidatesByKey.get(key);
        if (!existing) {
          candidatesByKey.set(key, {
            uid: rawUid,
            name: cleanName,
            phone: (phone || '770000000').slice(0, 20),
            email: (email || `${phone || rawUid}@taibah.net`).slice(0, 120),
            role: parsedRole,
            status: parsedStatus,
            parentAgentId: parsedParent,
            discountRate: parsedDiscount,
            balance: parsedBalance,
            priority: input.priority,
            source: input.source,
          });
          bumpSource(input.source);
          return;
        }

        // Merge with higher-priority or richer details (never downgrade an authoritative 'agent' to 'client')
        const mergedRole: 'agent' | 'client' =
          existing.role === 'agent' || (parsedRole === 'agent' && input.priority >= 60) ? 'agent' : 'client';
        const preferIncomingName =
          (existing.name.startsWith('حساب ') || existing.name === 'عميل طيبة نت' || input.priority > existing.priority) &&
          rawName.length >= 2 &&
          !rawName.startsWith('حساب ');
        const mergedUid =
          existing.uid && !existing.uid.startsWith('rec_') && !existing.uid.startsWith('usr_')
            ? existing.uid
            : rawUid || existing.uid;
        const mergedDiscount =
          mergedRole === 'agent'
            ? existing.role === 'agent'
              ? existing.discountRate
              : defaultAgentRate
            : input.priority > existing.priority
            ? parsedDiscount
            : existing.discountRate;

        candidatesByKey.set(key, {
          uid: mergedUid,
          name: preferIncomingName ? cleanName : existing.name,
          phone: phone || existing.phone,
          email: rawEmail && rawEmail.includes('@') && input.priority >= existing.priority ? email : existing.email,
          role: mergedRole,
          status: input.priority > existing.priority ? parsedStatus : existing.status,
          parentAgentId: existing.parentAgentId || parsedParent,
          discountRate: mergedDiscount,
          balance: existing.balance !== 0 ? existing.balance : parsedBalance,
          priority: Math.max(existing.priority, input.priority),
          source: input.priority > existing.priority ? input.source : existing.source,
        });
      };

      const extractFromFreeText = (text: string, sourceLabel: string, priority: number, fallbackUid?: string) => {
        if (!text) return;
        const normalized = normalizeDigits(text);
        const phoneMatches = normalized.match(/(?:00967|967)?(7[01378]\d{7})/g) || [];
        const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        const isAgentHint = /وكيل|70%|تخفيض\s*70|ترقية\s*إلى\s*وكيل/i.test(text);
        const roleGuess: 'agent' | 'client' = isAgentHint ? 'agent' : 'client';

        // Extract Arabic name before phone number in parentheses or after action keywords
        const parenNameMatch = text.match(
          /(?:الوكيل|العميل|حساب|المستخدم|تقدّم|الموافقة على|اعتماد|إنشاء|إضافة|حذف)?\s*([^\d():,\-–—\n]{2,45}?)\s*\(\s*(?:00967|967)?7[01378]\d{7}\s*\)/
        );
        const guessedName = parenNameMatch?.[1]?.trim() || '';

        for (const pm of phoneMatches) {
          const p = normalizePhoneDigits(pm);
          if (!p) continue;
          addCandidate({
            uid: fallbackUid,
            name: guessedName || `حساب ${p}`,
            phone: p,
            email: emailMatches[0] || `${p}@taibah.net`,
            role: roleGuess,
            status: 'active',
            discountRate: roleGuess === 'agent' ? defaultAgentRate : defaultClientRate,
            priority,
            source: sourceLabel,
          });
        }
        for (const em of emailMatches) {
          const p = normalizePhoneDigits(em.split('@')[0]);
          addCandidate({
            uid: fallbackUid,
            name: guessedName || (p ? `حساب ${p}` : em.split('@')[0]),
            phone: p,
            email: em,
            role: roleGuess,
            status: 'active',
            discountRate: roleGuess === 'agent' ? defaultAgentRate : defaultClientRate,
            priority,
            source: sourceLabel,
          });
        }
      };

      try {
        // Step 0: Snapshot current live `users` & `clients` collections in Firestore
        onProgress?.('جاري فحص الحسابات الحالية في السحابة (users & clients)...');
        const [liveUsersSnap, liveClientsSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'clients')).catch(() => null),
        ]);

        const liveUsersById = new Map<string, Record<string, unknown>>();
        const liveUsersByPhone = new Map<string, { id: string; data: Record<string, unknown> }>();
        const liveUsersByEmail = new Map<string, { id: string; data: Record<string, unknown> }>();
        for (const d of liveUsersSnap.docs) {
          const data = d.data() as Record<string, unknown>;
          liveUsersById.set(d.id, data);
          const p = normalizePhoneDigits(data.phone);
          const em = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
          if (p) liveUsersByPhone.set(p, { id: d.id, data });
          if (em) liveUsersByEmail.set(em, { id: d.id, data });
        }

        const liveClientsById = new Map<string, Record<string, unknown>>();
        const liveClientsByPhone = new Map<string, { id: string; data: Record<string, unknown> }>();
        if (liveClientsSnap) {
          for (const d of liveClientsSnap.docs) {
            const data = d.data() as Record<string, unknown>;
            liveClientsById.set(d.id, data);
            const p = normalizePhoneDigits(data.phone);
            if (p) liveClientsByPhone.set(p, { id: d.id, data });
            // Any account currently only in `clients` is also a top-priority candidate for `users`!
            addCandidate({
              uid: (typeof data.uid === 'string' && data.uid) || d.id,
              name: data.name,
              phone: data.phone,
              email: data.email,
              role: data.role,
              status: data.status,
              parentAgentId: data.parentAgentId,
              discountRate: data.discountRate,
              balance: data.balance,
              priority: 95,
              source: 'مجموعة clients السحابية',
            });
          }
        }

        // Step 1A: Scan Firestore `backups` collection
        onProgress?.('جاري مسح النسخ الاحتياطية السحابية (backups)...');
        try {
          const backupsSnap = await getDocs(query(collection(db, 'backups'), limit(30)));
          const sortedBackups = [...backupsSnap.docs].sort((a, b) => {
            const ta = (a.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
            const tb = (b.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
            return tb - ta;
          });
          for (const bDoc of sortedBackups) {
            const bData = bDoc.data() as {
              users?: Array<Record<string, unknown>>;
              clients?: Array<Record<string, unknown>>;
            };
            if (Array.isArray(bData.users)) {
              for (const u of bData.users) {
                if (!u || typeof u !== 'object') continue;
                addCandidate({
                  uid: u.uid,
                  name: u.name,
                  phone: u.phone,
                  email: u.email,
                  role: u.role,
                  status: u.status,
                  parentAgentId: u.parentAgentId,
                  discountRate: u.discountRate,
                  balance: u.balance,
                  priority: 100,
                  source: 'النسخ الاحتياطية السحابية',
                });
              }
            }
            if (Array.isArray(bData.clients)) {
              for (const c of bData.clients) {
                if (!c || typeof c !== 'object') continue;
                addCandidate({
                  uid: c.uid,
                  name: c.name,
                  phone: c.phone,
                  email: c.email,
                  role: c.role,
                  status: c.status,
                  parentAgentId: c.parentAgentId,
                  discountRate: c.discountRate,
                  balance: c.balance,
                  priority: 98,
                  source: 'النسخ الاحتياطية السحابية',
                });
              }
            }
          }
        } catch {
          // Ignore if backups collection is empty
        }

        // Step 1B: Scan Local Backups (`localStorage` & non-Firebase `IndexedDB`)
        onProgress?.('جاري فحص النسخ المحلية في localStorage و IndexedDB...');
        try {
          const localAutoBackup = readCachedJson<{
            users?: Array<Record<string, unknown>>;
            clients?: Array<Record<string, unknown>>;
          } | null>(CACHE_AUTO_BACKUP_KEY, null);
          if (localAutoBackup?.users && Array.isArray(localAutoBackup.users)) {
            for (const u of localAutoBackup.users) {
              addCandidate({
                uid: u.uid,
                name: u.name,
                phone: u.phone,
                email: u.email,
                role: u.role,
                status: u.status,
                parentAgentId: u.parentAgentId,
                discountRate: u.discountRate,
                balance: u.balance,
                priority: 92,
                source: 'النسخ المحلية (localStorage)',
              });
            }
          }
          if (localAutoBackup?.clients && Array.isArray(localAutoBackup.clients)) {
            for (const c of localAutoBackup.clients) {
              addCandidate({
                uid: c.uid,
                name: c.name,
                phone: c.phone,
                email: c.email,
                role: c.role,
                status: c.status,
                parentAgentId: c.parentAgentId,
                discountRate: c.discountRate,
                balance: c.balance,
                priority: 90,
                source: 'النسخ المحلية (localStorage)',
              });
            }
          }

          const cachedUsers = readCachedJson<Array<Record<string, unknown>>>(CACHE_USERS_LIST_KEY, []);
          if (Array.isArray(cachedUsers)) {
            for (const u of cachedUsers) {
              addCandidate({
                uid: u.uid,
                name: u.name,
                phone: u.phone,
                email: u.email,
                role: u.role,
                status: u.status,
                parentAgentId: u.parentAgentId,
                discountRate: u.discountRate,
                balance: u.balance,
                priority: 91,
                source: 'النسخ المحلية (localStorage)',
              });
            }
          }

          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (
              key.startsWith(CACHE_PROFILE_UID_PREFIX) ||
              key.startsWith(CACHE_PROFILE_EMAIL_PREFIX)
            ) {
              const pObj = readCachedJson<Record<string, unknown> | null>(key, null);
              if (pObj) {
                addCandidate({
                  uid: pObj.uid,
                  name: pObj.name,
                  phone: pObj.phone,
                  email: pObj.email,
                  role: pObj.role,
                  status: pObj.status,
                  parentAgentId: pObj.parentAgentId,
                  discountRate: pObj.discountRate,
                  balance: pObj.balance,
                  priority: 88,
                  source: 'ذاكرة الملفات المحلية',
                });
              }
            } else if (key.startsWith(CACHE_SALES_PREFIX)) {
              const cachedSales = readCachedJson<Array<Record<string, unknown>>>(key, []);
              if (Array.isArray(cachedSales)) {
                for (const s of cachedSales) {
                  if (s && (s.buyerRole === 'agent' || s.buyerRole === 'client')) {
                    addCandidate({
                      uid: s.buyerId,
                      name: s.buyerName,
                      phone: s.buyerPhone,
                      role: s.buyerRole,
                      discountRate: s.discountRate,
                      priority: 72,
                      source: 'فواتير الكاش المحلي',
                    });
                  }
                }
              }
            } else if (key.startsWith(CACHE_CUSTOMERS_PREFIX)) {
              const cachedCustomers = readCachedJson<Array<Record<string, unknown>>>(key, []);
              if (Array.isArray(cachedCustomers)) {
                for (const c of cachedCustomers) {
                  if (c && normalizePhoneDigits(c.phone)) {
                    const cat = typeof c.category === 'string' ? c.category : '';
                    addCandidate({
                      name: c.name,
                      phone: c.phone,
                      role: /وكيل/.test(cat) ? 'agent' : 'client',
                      priority: 52,
                      source: 'عملاء الكاش المحلي',
                    });
                  }
                }
              }
            }
          }
        } catch {
          // Ignore localStorage access restrictions
        }

        // Non-destructive scan of any app-owned IndexedDB databases (strictly skipping firebase internal DBs)
        try {
          const idb = window.indexedDB as IDBFactory & {
            databases?: () => Promise<Array<{ name?: string }>>;
          };
          if (typeof idb?.databases === 'function') {
            const dbs = await idb.databases();
            const appDbs = dbs.filter(
              (d) =>
                !!d.name &&
                d.name.toLowerCase().includes('taibah') &&
                !d.name.toLowerCase().includes('firebase')
            );
            for (const entry of appDbs) {
              await new Promise<void>((resolve) => {
                const openReq = window.indexedDB.open(entry.name!);
                openReq.onerror = () => resolve();
                openReq.onsuccess = () => {
                  const idbConn = openReq.result;
                  const storeNames = Array.from(idbConn.objectStoreNames);
                  if (storeNames.length === 0) {
                    idbConn.close();
                    resolve();
                    return;
                  }
                  let remaining = storeNames.length;
                  for (const sName of storeNames) {
                    try {
                      const tx = idbConn.transaction(sName, 'readonly');
                      const req = tx.objectStore(sName).getAll();
                      req.onsuccess = () => {
                        const rows = Array.isArray(req.result) ? req.result : [];
                        for (const row of rows) {
                          if (!row || typeof row !== 'object') continue;
                          const obj = row as Record<string, unknown>;
                          if (obj.phone || obj.email || obj.buyerPhone) {
                            addCandidate({
                              uid: obj.uid || obj.buyerId,
                              name: obj.name || obj.buyerName,
                              phone: obj.phone || obj.buyerPhone,
                              email: obj.email,
                              role: obj.role || obj.buyerRole,
                              discountRate: obj.discountRate,
                              priority: 86,
                              source: 'IndexedDB المحلي',
                            });
                          }
                        }
                        remaining--;
                        if (remaining <= 0) {
                          idbConn.close();
                          resolve();
                        }
                      };
                      req.onerror = () => {
                        remaining--;
                        if (remaining <= 0) {
                          idbConn.close();
                          resolve();
                        }
                      };
                    } catch {
                      remaining--;
                      if (remaining <= 0) {
                        idbConn.close();
                        resolve();
                      }
                    }
                  }
                };
              });
            }
          }
        } catch {
          // Ignore IndexedDB scan errors
        }

        // Step 2: Scan Historical Logs, Requests, Sales, and Ledger Customers in Firestore
        onProgress?.('جاري تحليل سجل العمليات (auditLogs / audit_logs) والطلبات والفواتير التاريخية...');

        const [
          auditSnapA,
          auditSnapB,
          regReqSnap,
          topupSnap,
          salesSnap,
          customersSnap,
          pwdResetSnap,
        ] = await Promise.all([
          getDocs(query(collection(db, 'auditLogs'), limit(500))).catch(() => null),
          getDocs(query(collection(db, 'audit_logs'), limit(500))).catch(() => null),
          getDocs(query(collection(db, 'registrationRequests'), limit(500))).catch(() => null),
          getDocs(query(collection(db, 'topupRequests'), limit(500))).catch(() => null),
          getDocs(query(collection(db, 'sales'), limit(500))).catch(() => null),
          getDocs(query(collection(db, 'customers'), limit(500))).catch(() => null),
          getDocs(query(collection(db, 'passwordResetRequests'), limit(500))).catch(() => null),
        ]);

        // 2a. Registration Requests (authoritative role + UID + phone + email)
        if (regReqSnap) {
          for (const d of regReqSnap.docs) {
            const data = d.data() as Record<string, unknown>;
            if (data.status === 'rejected') continue;
            addCandidate({
              uid: data.applicantUid,
              name: data.name,
              phone: data.phone,
              email: data.email,
              role: data.requestedRole,
              status: 'active',
              parentAgentId: data.parentAgentId,
              priority: 82,
              source: 'طلبات الانضمام التاريخية',
            });
          }
        }

        // 2b. Topup Requests (authoritative requesterId + requesterRole + discountRate)
        if (topupSnap) {
          for (const d of topupSnap.docs) {
            const data = d.data() as Record<string, unknown>;
            addCandidate({
              uid: data.requesterId,
              name: data.requesterName,
              phone: data.requesterPhone,
              role: data.requesterRole,
              discountRate: data.discountRate,
              status: 'active',
              priority: 85,
              source: 'طلبات التغذية التاريخية',
            });
          }
        }

        // 2c. Sales & Wholesale Invoices
        if (salesSnap) {
          for (const d of salesSnap.docs) {
            const data = d.data() as Record<string, unknown>;
            const buyerRole = data.buyerRole;
            if (buyerRole === 'agent' || buyerRole === 'client') {
              addCandidate({
                uid: data.buyerId,
                name: data.buyerName,
                phone: data.buyerPhone,
                role: buyerRole,
                discountRate: data.discountRate,
                status: 'active',
                priority: 76,
                source: 'الفواتير والمبيعات التاريخية',
              });
            }
          }
        }

        // 2d. Audit Logs (`auditLogs` + legacy `audit_logs`)
        for (const snap of [auditSnapA, auditSnapB]) {
          if (!snap) continue;
          for (const d of snap.docs) {
            const data = d.data() as Record<string, unknown>;
            const details = typeof data.details === 'string' ? data.details : '';
            const action = typeof data.action === 'string' ? data.action : '';
            extractFromFreeText(`${action} ${details}`, 'سجل العمليات (Audit Log)', 68);
          }
        }

        // 2e. Password Reset Requests
        if (pwdResetSnap) {
          for (const d of pwdResetSnap.docs) {
            const data = d.data() as Record<string, unknown>;
            const ident = typeof data.identifier === 'string' ? data.identifier.trim() : '';
            const phone = normalizePhoneDigits(data.phone) || normalizePhoneDigits(ident);
            const email = ident.includes('@') ? ident.toLowerCase() : '';
            if (phone || email) {
              addCandidate({
                uid: data.requesterUid,
                name: data.name || (phone ? `حساب ${phone}` : email.split('@')[0]),
                phone,
                email,
                role: 'client',
                status: 'active',
                priority: 60,
                source: 'طلبات استعادة المرور',
              });
            }
          }
        }

        // 2f. Customers Ledger Accounts (with valid phone numbers)
        if (customersSnap) {
          for (const d of customersSnap.docs) {
            const data = d.data() as Record<string, unknown>;
            const phone = normalizePhoneDigits(data.phone);
            if (!phone) continue;
            const cat = typeof data.category === 'string' ? data.category : '';
            addCandidate({
              name: data.name,
              phone,
              role: /وكيل/.test(cat) ? 'agent' : 'client',
              status: 'active',
              priority: 55,
              source: 'حسابات العملاء والدفتر',
            });
          }
        }

        // Step 3: Batch-write all recovered accounts into BOTH `users` and `clients`
        const allCandidates = Array.from(candidatesByKey.values());
        onProgress?.(`تم العثور على ${allCandidates.length} حساب مرشح — جاري الاسترجاع والكتابة في السحابة...`);

        interface WriteItem {
          targetId: string;
          candidate: RecoveredCandidate;
          writeUser: boolean;
          writeClient: boolean;
          preserveExistingCreatedAt?: Timestamp;
          preserveExistingBalance?: number;
        }

        const itemsToWrite: WriteItem[] = [];
        for (const cand of allCandidates) {
          const existingUser =
            (cand.uid && liveUsersById.has(cand.uid)
              ? { id: cand.uid, data: liveUsersById.get(cand.uid)! }
              : null) ||
            (cand.phone && liveUsersByPhone.get(cand.phone)) ||
            (cand.email && liveUsersByEmail.get(cand.email)) ||
            null;

          const targetId =
            existingUser?.id ||
            (cand.uid && isValidDocId(cand.uid) ? cand.uid : `rec_${cand.phone.replace(/[^\d]/g, '') || Date.now()}`);

          const hasUserDoc = !!existingUser;
          const needsRoleRestore =
            hasUserDoc &&
            existingUser.data.role === 'client' &&
            cand.role === 'agent' &&
            cand.priority >= 75;
          const hasClientMirror =
            liveClientsById.has(targetId) || (!!cand.phone && liveClientsByPhone.has(cand.phone));

          if (!hasUserDoc || needsRoleRestore || !hasClientMirror) {
            itemsToWrite.push({
              targetId,
              candidate: cand,
              writeUser: !hasUserDoc || needsRoleRestore,
              writeClient: !hasClientMirror || needsRoleRestore,
              preserveExistingCreatedAt: existingUser?.data.createdAt as Timestamp | undefined,
              preserveExistingBalance:
                typeof existingUser?.data.balance === 'number' ? existingUser.data.balance : undefined,
            });
          }
        }

        let restoredCount = 0;
        let updatedClientsMirrorCount = 0;
        const CHUNK_SIZE = 200; // Up to 400 writes per batch (< 500 Firestore batch limit)

        for (let i = 0; i < itemsToWrite.length; i += CHUNK_SIZE) {
          const chunk = itemsToWrite.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          for (const item of chunk) {
            const c = item.candidate;
            const finalRole = c.role;
            const finalDiscount =
              finalRole === 'agent'
                ? c.discountRate > 0 && c.discountRate <= 100
                  ? c.discountRate
                  : defaultAgentRate
                : c.discountRate > 0 && c.discountRate <= 100
                ? c.discountRate
                : defaultClientRate;
            const finalBalance =
              item.preserveExistingBalance !== undefined ? item.preserveExistingBalance : c.balance;

            if (item.writeUser) {
              batch.set(doc(db, 'users', item.targetId), {
                uid: item.targetId,
                name: c.name.slice(0, 100),
                phone: c.phone.slice(0, 20),
                email: c.email.slice(0, 120),
                role: finalRole,
                status: 'active',
                parentAgentId: c.parentAgentId.slice(0, 128),
                discountRate: finalDiscount,
                balance: finalBalance,
                fcmTokens: [],
                createdAt: item.preserveExistingCreatedAt || serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              restoredCount++;
            }

            if (item.writeClient) {
              batch.set(doc(db, 'clients', item.targetId), {
                uid: item.targetId,
                name: c.name.slice(0, 100),
                phone: c.phone.slice(0, 20),
                email: c.email.slice(0, 120),
                role: finalRole,
                status: 'active',
                parentAgentId: c.parentAgentId.slice(0, 128),
                discountRate: finalDiscount,
                balance: finalBalance,
                createdAt: item.preserveExistingCreatedAt || serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              updatedClientsMirrorCount++;
            }
          }
          await batch.commit();
          onProgress?.(
            `جاري الاسترجاع السحابي... (${Math.min(i + chunk.length, itemsToWrite.length)} / ${itemsToWrite.length})`
          );
        }

        // Refresh local cache with all live + recovered accounts
        const mergedCacheList = allCandidates.map((c) =>
          serializePlainAccountForBackup(c as unknown as Record<string, unknown>, c.uid || `rec_${c.phone}`)
        );
        if (mergedCacheList.length > 0) {
          writeCachedJson(CACHE_USERS_LIST_KEY, mergedCacheList);
        }

        const sourcesSummary = Array.from(sourceHitCounts.entries())
          .map(([src, cnt]) => `${src} (${cnt})`)
          .join(' • ');

        const summary =
          restoredCount > 0
            ? `تم استرجاع ${restoredCount} حساب وكيل/عميل بنجاح ومزامنة ${updatedClientsMirrorCount} سجل في مجموعة clients ✅`
            : updatedClientsMirrorCount > 0
            ? `جميع حسابات الوكلاء والعملاء موجودة بالفعل (${allCandidates.length} حساب) وتمت مزامنة ${updatedClientsMirrorCount} سجل في clients ✅`
            : allCandidates.length > 0
            ? `تم فحص جميع المصادر (${allCandidates.length} حساب) — جميع حسابات الوكلاء والعملاء سليمة وموجودة بالفعل ✅`
            : 'تم فحص النسخ الاحتياطية والسجلات التاريخية ولم يتم العثور على حسابات محذوفة إضافية.';

        await writeAuditLog(
          'استرجاع الوكلاء والعملاء',
          `فحص ${allCandidates.length} حساب مرشح • استرجاع ${restoredCount} حساب في users ومزامنة ${updatedClientsMirrorCount} في clients`
        );

        if (restoredCount > 0 || updatedClientsMirrorCount > 0) {
          notifySuccess(summary);
        } else {
          notifyInfo('نتيجة فحص الاسترجاع', summary);
        }

        return {
          ok: true,
          restoredCount,
          updatedClientsMirrorCount,
          totalFound: allCandidates.length,
          sourcesSummary,
          summary,
        };
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'restoreDeletedAgentsAndClients');
        const msg =
          err instanceof Error && err.message
            ? `تعذر إكمال عملية الاسترجاع: ${err.message}`
            : 'تعذر إكمال عملية الاسترجاع، يرجى التحقق من الاتصال والمحاولة مجدداً.';
        notifyError('فشل الاسترجاع', msg);
        return {
          ok: false,
          restoredCount: 0,
          updatedClientsMirrorCount: 0,
          totalFound: 0,
          sourcesSummary: '',
          summary: msg,
        };
      }
    },
    [
      appSettings.agentDiscountPercent,
      appSettings.clientDiscountPercent,
      firebaseUser,
      notifyError,
      notifyInfo,
      notifySuccess,
      notifyWarning,
      profile,
      writeAuditLog,
    ]
  );

  // =========================================================================
  // SUPER ADMIN ONLY: SAFE CLOUD + LOCAL APP DATA RESET (500-doc writeBatch)
  // 1) Mandatory `auto_backup` in Firestore (`backups`) + `localStorage` BEFORE any deletion
  // 2) Resets ONLY cards, sales, invoices, ledger/topup/notifications & zeroes balances to 0
  // 3) STRICTLY PRESERVES Super Admin + ALL registered Agents & Clients (never deleted!)
  // =========================================================================
  const resetAppData = useCallback(
    async (
      scope: 'sales_only' | 'full_reset',
      adminPassword: string,
      onProgress?: (stage: string) => void
    ): Promise<{ ok: boolean; error?: string; deletedCount: number }> => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile || profile.role !== 'super_admin' || !activeUser.email) {
        return {
          ok: false,
          error: 'هذه الصلاحية محصورة بالمدير العام (super_admin) فقط.',
          deletedCount: 0,
        };
      }

      if (!navigator.onLine) {
        return {
          ok: false,
          error: 'يتطلب تصفير البيانات السحابية اتصالاً نشطاً بالإنترنت لضمان أخذ النسخة الاحتياطية وتصفير السجلات بأمان.',
          deletedCount: 0,
        };
      }

      const cleanPass = adminPassword.trim();
      if (cleanPass.length < 6) {
        return {
          ok: false,
          error: 'يرجى إدخال كلمة مرور المدير العام الصحيحة لتأكيد التصفير.',
          deletedCount: 0,
        };
      }

      // Mandatory Firebase Auth Re-Authentication with Super Admin's real password
      onProgress?.('جاري التحقق من كلمة مرور المدير العام...');
      try {
        const credential = EmailAuthProvider.credential(activeUser.email, cleanPass);
        await reauthenticateWithCredential(activeUser, credential);
        await activeUser.getIdToken(true);
      } catch (err) {
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/too-many-requests') {
          return {
            ok: false,
            error: 'تم تجاوز محاولات إدخال كلمة المرور، يرجى الانتظار قليلاً ثم المحاولة.',
            deletedCount: 0,
          };
        }
        return {
          ok: false,
          error: 'كلمة مرور المدير العام غير صحيحة. تم إلغاء عملية التصفير لحماية البيانات.',
          deletedCount: 0,
        };
      }

      let currentStepPath = `resetAppData/${scope}`;

      // Exact 500-document writeBatch deletion loop (Firestore maximum batch size)
      const BATCH_LIMIT = 500;
      const deleteCollectionInBatches = async (colName: string, arLabel: string): Promise<number> => {
        currentStepPath = colName;
        let removed = 0;
        let safetyLoops = 0;
        while (safetyLoops < 400) {
          safetyLoops++;
          const snap = await getDocs(query(collection(db, colName), limit(BATCH_LIMIT)));
          if (snap.empty) break;
          const batch = writeBatch(db);
          for (const d of snap.docs) {
            batch.delete(d.ref);
          }
          await batch.commit();
          removed += snap.docs.length;
          onProgress?.(`جاري حذف ${arLabel}... (${removed})`);
          if (snap.docs.length < BATCH_LIMIT) break;
        }
        return removed;
      };

      // Helper to produce an exact 12-field package payload matching isValidPackageDoc in firestore.rules
      const buildValidPackagePayload = (
        basePkg: (typeof EXCLUSIVE_PACKAGES)[number],
        existingData?: Partial<PackageDoc>,
        zeroAllCounters = true
      ) => ({
        code: String(existingData?.code || basePkg.code).slice(0, 32),
        price:
          typeof existingData?.price === 'number' && existingData.price > 0 && existingData.price <= 100000
            ? existingData.price
            : basePkg.price,
        dataLabel: String(existingData?.dataLabel || basePkg.dataLabel).slice(0, 40),
        hoursLabel: String(existingData?.hoursLabel || basePkg.hoursLabel).slice(0, 40),
        validityLabel: String(existingData?.validityLabel || basePkg.validityLabel).slice(0, 40),
        colorTheme: String(existingData?.colorTheme || basePkg.colorTheme).slice(0, 32),
        availableCount: zeroAllCounters ? 0 : Math.max(0, Number(existingData?.availableCount ?? 0)),
        soldCount: 0,
        uploadedCount: zeroAllCounters ? 0 : Math.max(0, Number(existingData?.uploadedCount ?? 0)),
        injectedCount: zeroAllCounters ? 0 : Math.max(0, Number(existingData?.injectedCount ?? 0)),
        sortOrder:
          typeof existingData?.sortOrder === 'number' && existingData.sortOrder >= 1 && existingData.sortOrder <= 20
            ? existingData.sortOrder
            : basePkg.sortOrder,
        updatedAt: serverTimestamp(),
      });

      let totalDeleted = 0;
      try {
        // =====================================================================
        // MANDATORY STEP 0: AUTOMATIC `auto_backup` BEFORE ANY DELETION
        // =====================================================================
        onProgress?.('جاري إنشاء نسخة احتياطية تلقائية (auto_backup) في السحابة والهاتف قبل التصفير...');
        currentStepPath = 'backups/auto_backup';
        const [usersPreSnap, clientsPreSnap, pkgPreSnap, salesPreSnap, customersPreSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'clients')).catch(() => null),
          getDocs(query(collection(db, 'packages'), where('price', '>', 0))).catch(() => null),
          getDocs(query(collection(db, 'sales'), limit(500))).catch(() => null),
          getDocs(query(collection(db, 'customers'), limit(500))).catch(() => null),
        ]);

        const serializedUsers = usersPreSnap.docs.map((d) =>
          serializePlainAccountForBackup(d.data() as Record<string, unknown>, d.id)
        );
        const serializedClients = clientsPreSnap
          ? clientsPreSnap.docs.map((d) =>
              serializePlainAccountForBackup(d.data() as Record<string, unknown>, d.id)
            )
          : [];
        const serializedPackages = (pkgPreSnap?.docs || []).slice(0, 20).map((d) => {
          const pd = d.data() as Partial<PackageDoc>;
          return {
            id: d.id,
            code: String(pd.code || d.id),
            price: Number(pd.price || 0),
            availableCount: Number(pd.availableCount || 0),
            soldCount: Number(pd.soldCount || 0),
          };
        });

        const autoBackupId = `auto_backup_${Date.now()}`;
        const autoBackupCloudDoc = {
          backupType: 'auto_backup' as const,
          createdBy: activeUser.uid,
          createdAt: serverTimestamp(),
          scope,
          usersCount: serializedUsers.length,
          clientsCount: serializedClients.length,
          salesCount: salesPreSnap?.docs.length ?? 0,
          customersCount: customersPreSnap?.docs.length ?? 0,
          users: serializedUsers.slice(0, 500),
          clients: serializedClients.slice(0, 500),
          packages: serializedPackages,
        };
        await setDoc(doc(db, 'backups', autoBackupId), autoBackupCloudDoc);
        await setDoc(doc(db, 'backups', 'latest_auto_backup'), autoBackupCloudDoc);

        // Also persist local auto_backup immediately (and preserve it during cache cleanup)
        writeCachedJson(CACHE_AUTO_BACKUP_KEY, {
          ...autoBackupCloudDoc,
          backupId: autoBackupId,
          createdAt: new Date().toISOString(),
        });
        writeCachedJson(CACHE_USERS_LIST_KEY, serializedUsers);

        if (scope === 'sales_only') {
          onProgress?.('جاري حذف فواتير وسجل المبيعات...');
          totalDeleted += await deleteCollectionInBatches('sales', 'فواتير المبيعات');

          // Reset soldCount on all 8 packages while preserving available/uploaded/injected stock
          onProgress?.('جاري تصفير عدادات المباع في الباقات...');
          currentStepPath = 'packages';
          const pkgSnap = await getDocs(query(collection(db, 'packages'), where('price', '>', 0)));
          const existingPkgMap = new Map(pkgSnap.docs.map((d) => [d.id, d.data() as Partial<PackageDoc>]));
          const pkgBatch = writeBatch(db);
          for (const basePkg of EXCLUSIVE_PACKAGES) {
            const existingData = existingPkgMap.get(basePkg.id);
            pkgBatch.set(
              doc(db, 'packages', basePkg.id),
              buildValidPackagePayload(basePkg, existingData, false)
            );
          }
          await pkgBatch.commit();

          const salesResetPkgStats: Record<string, PackageCounterStats> = {};
          let totalAvail = 0;
          let totalUp = 0;
          let totalInj = 0;
          for (const basePkg of EXCLUSIVE_PACKAGES) {
            const existingData = existingPkgMap.get(basePkg.id);
            const avail = Math.max(0, Number(existingData?.availableCount ?? 0));
            const up = Math.max(0, Number(existingData?.uploadedCount ?? 0));
            const inj = Math.max(0, Number(existingData?.injectedCount ?? 0));
            salesResetPkgStats[basePkg.id] = {
              availableCount: avail,
              soldCount: 0,
              uploadedCount: up,
              injectedCount: inj,
            };
            totalAvail += avail;
            totalUp += up;
            totalInj += inj;
          }
          await setDoc(doc(db, 'stats', 'summary'), {
            ownerId: activeUser.uid,
            totalAvailable: totalAvail,
            totalSold: 0,
            totalUploaded: totalUp,
            totalInjected: totalInj,
            packages: salesResetPkgStats,
            updatedAt: serverTimestamp(),
          }).catch(() => {});

          clearOfflineSalesQueueOnly();
          writeCachedJson(`${CACHE_SALES_PREFIX}${activeUser.uid}`, []);
          setSales([]);
          setPendingOfflineSales([]);

          await writeAuditLog(
            'تصفير المبيعات والتقارير',
            `تم حفظ نسخة auto_backup وتصفير سجل المبيعات والتقارير (حذف ${totalDeleted} فاتورة مع الإبقاء على الكروت والوكلاء والعملاء)`
          );
          notifySuccess(`تم حفظ نسخة احتياطية وتصفير المبيعات والتقارير بنجاح (حذف ${totalDeleted} سجل) ✅`);
          return { ok: true, deletedCount: totalDeleted };
        }

        // =====================================================================
        // SAFE FULL OPERATIONAL RESET:
        // Deletes ONLY cards, sales, invoices, ledger/topup/notifications,
        // zeroes balances to 0, and STRICTLY PRESERVES Super Admin + ALL Agents & Clients
        // as well as `backups` and `auditLogs`!
        // =====================================================================
        const targetCollections: Array<{ name: string; label: string }> = [
          { name: 'cards', label: 'جميع الكروت (المتاحة والمباعة والمحجوزة)' },
          { name: 'sales', label: 'فواتير البيع المباشر والجملة والورقية' },
          { name: 'ledgerEntries', label: 'قيود الدفتر المحاسبي' },
          { name: 'customers', label: 'سجلات الدفتر المحاسبي' },
          { name: 'topupRequests', label: 'طلبات التغذية' },
          { name: 'notifications', label: 'الإشعارات' },
          { name: 'registrationRequests', label: 'طلبات الانضمام المعلقة' },
          { name: 'passwordResetRequests', label: 'طلبات استعادة كلمة المرور' },
        ];

        for (const col of targetCollections) {
          onProgress?.(`جاري حذف ${col.label}...`);
          totalDeleted += await deleteCollectionInBatches(col.name, col.label);
        }

        // STRICTLY PRESERVE ALL ACCOUNTS (Super Admin + Agents + Clients) — ONLY zero their balance to 0!
        onProgress?.(
          `جاري تصفير أرصدة جميع الحسابات إلى (0) مع الإبقاء الكامل على المدير والوكلاء والعملاء (${usersPreSnap.docs.length} حساب)...`
        );
        currentStepPath = 'users';
        for (let i = 0; i < usersPreSnap.docs.length; i += BATCH_LIMIT) {
          const chunk = usersPreSnap.docs.slice(i, i + BATCH_LIMIT);
          const uBatch = writeBatch(db);
          for (const uDoc of chunk) {
            uBatch.update(uDoc.ref, {
              balance: 0,
              updatedAt: serverTimestamp(),
            });
          }
          await uBatch.commit();
        }

        if (clientsPreSnap && !clientsPreSnap.empty) {
          currentStepPath = 'clients';
          for (let i = 0; i < clientsPreSnap.docs.length; i += BATCH_LIMIT) {
            const chunk = clientsPreSnap.docs.slice(i, i + BATCH_LIMIT);
            const cBatch = writeBatch(db);
            for (const cDoc of chunk) {
              cBatch.update(cDoc.ref, {
                balance: 0,
                updatedAt: serverTimestamp(),
              });
            }
            await cBatch.commit();
          }
        }

        // Preserve ONLY the 8 official base packages with exact 0 counts (ready for fresh import)
        onProgress?.('جاري تصفير هيكل الباقات الثماني الأساسية إلى الصفر (0)...');
        currentStepPath = 'packages';
        const pkgSnap = await getDocs(query(collection(db, 'packages'), where('price', '>', 0)));
        const existingPkgMap = new Map(pkgSnap.docs.map((d) => [d.id, d.data() as Partial<PackageDoc>]));
        const officialIds = new Set(EXCLUSIVE_PACKAGES.map((p) => p.id));
        const pkgBatch = writeBatch(db);
        for (const basePkg of EXCLUSIVE_PACKAGES) {
          const existingData = existingPkgMap.get(basePkg.id);
          pkgBatch.set(
            doc(db, 'packages', basePkg.id),
            buildValidPackagePayload(basePkg, existingData, true)
          );
        }
        for (const pDoc of pkgSnap.docs) {
          if (!officialIds.has(pDoc.id)) {
            pkgBatch.delete(pDoc.ref);
            totalDeleted++;
          }
        }
        await pkgBatch.commit();

        // Also zero single lightweight `stats/summary` counters
        const zeroPkgStats: Record<string, PackageCounterStats> = {};
        for (const basePkg of EXCLUSIVE_PACKAGES) {
          zeroPkgStats[basePkg.id] = {
            availableCount: 0,
            soldCount: 0,
            uploadedCount: 0,
            injectedCount: 0,
          };
        }
        await setDoc(doc(db, 'stats', 'summary'), {
          ownerId: activeUser.uid,
          totalAvailable: 0,
          totalSold: 0,
          totalUploaded: 0,
          totalInjected: 0,
          packages: zeroPkgStats,
          updatedAt: serverTimestamp(),
        }).catch(() => {});

        // Write audit log BEFORE cleaning up local caches / reloading
        await writeAuditLog(
          'تصفير بيانات التطبيق بأمان',
          `تم حفظ نسخة auto_backup (${autoBackupId}) وحذف ${totalDeleted} سجل تشغيلي وتصفير الأرصدة مع الاحتفاظ بجميع حسابات الإدارة والوكلاء والعملاء (${usersPreSnap.docs.length} حساب)`
        );

        // =====================================================================
        // CLEAR OPERATIONAL LOCAL CACHES while strictly preserving Firebase Auth,
        // biometric vault, auto_backup, and cached accounts!
        // =====================================================================
        onProgress?.('جاري تنظيف الكاش التشغيلي مع الحفاظ على النسخة الاحتياطية وجلسة المدير...');
        clearAllLocalOfflineCardCaches();
        try {
          const preservePrefixes = [
            'firebase:',
            'taibah_theme',
            'taibah_bio',
            'taibah_auto_backup',
            'taibah_cached_users',
            'taibah_cached_profile',
          ];
          const keysToDelete: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            const shouldPreserve = preservePrefixes.some((prefix) => k.startsWith(prefix));
            if (!shouldPreserve) {
              keysToDelete.push(k);
            }
          }
          for (const k of keysToDelete) {
            localStorage.removeItem(k);
          }
          persistProfileToLocalCache(buildSuperAdminProfile(activeUser));
        } catch {
          // Ignore storage errors
        }

        // Reset operational in-memory React states while keeping preserved accounts with 0 balance
        setSales([]);
        setCustomers([]);
        setLedgerEntries([]);
        setTopupRequests([]);
        setNotifications([]);
        setManagedUsers((prev) => prev.map((u) => ({ ...u, balance: 0 })));
        setPendingRegistrations([]);
        setPendingPasswordResets([]);
        setPendingOfflineSales([]);
        setPersonalCardCounts({});
        setPersonalSoldCounts({});

        // Wipe Firestore IndexedDB cache cleanly without touching Firebase Auth's firebaseLocalStorageDb
        try {
          await terminate(db);
          await clearIndexedDbPersistence(db);
        } catch {
          // Ignore if running in memoryLocalCache mode
        }
        try {
          const idb = window.indexedDB as IDBFactory & {
            databases?: () => Promise<Array<{ name?: string }>>;
          };
          if (typeof idb?.databases === 'function') {
            const dbs = await idb.databases();
            await Promise.all(
              dbs
                .filter(
                  (entry) =>
                    !!entry.name &&
                    entry.name.toLowerCase().includes('firestore') &&
                    !entry.name.toLowerCase().includes('firebaselocalstorage')
                )
                .map(
                  (entry) =>
                    new Promise<void>((resolve) => {
                      const req = window.indexedDB.deleteDatabase(entry.name!);
                      req.onsuccess = () => resolve();
                      req.onerror = () => resolve();
                      req.onblocked = () => resolve();
                    })
                )
            );
          }
        } catch {
          // Ignore IndexedDB enumeration restrictions
        }

        onProgress?.('تم حفظ النسخة الاحتياطية والتصفير بنجاح — جاري إعادة تحميل التطبيق...');
        notifySuccess(
          `تم أخذ نسخة احتياطية تلقائية وتصفير الكروت والفواتير والأرصدة (حذف ${totalDeleted} سجل) مع الإبقاء الكامل على الإدارة والوكلاء والعملاء ✅`
        );

        window.setTimeout(() => {
          try {
            window.sessionStorage.setItem('taibah_post_reset_unlock_once', '1');
          } catch {
            // ignore storage restrictions
          }
          window.location.reload();
        }, 700);

        return { ok: true, deletedCount: totalDeleted };
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, currentStepPath);
        const msg =
          err instanceof Error && err.message
            ? `تعذر إكمال التصفير (${currentStepPath}): ${err.message}`
            : 'تعذر إكمال عملية التصفير، يرجى التحقق من الاتصال والمحاولة مجدداً.';
        notifyError('فشل تصفير البيانات', msg);
        return { ok: false, error: msg, deletedCount: totalDeleted };
      }
    },
    [firebaseUser, notifyError, notifySuccess, profile, writeAuditLog]
  );

  const value = useMemo<FirebaseContextValue>(
    () => ({
      authReady,
      firebaseUser,
      profile,
      profileLoading,
      needsAdminEmailVerification,
      isOnline,
      firestoreConnected,
      isSyncing,
      packages,
      totalAvailableCards,
      sales: mergedSales,
      customers,
      ledgerEntries,
      notifications,
      unreadNotificationsCount,
      pendingRegistrations,
      pendingPasswordResets,
      topupRequests,
      pendingTopups,
      appSettings,
      auditLogs,
      managedUsers,
      activeRoute,
      setActiveRoute,
      hasMoreSales: mergedSales.length >= salesLimit,
      loadMoreSales,
      hasMoreCustomers: customers.length >= customersLimit,
      loadMoreCustomers,
      hasMoreAuditLogs: auditLogs.length >= auditLogsLimit,
      loadMoreAuditLogs,
      refreshVerificationStatus,
      syncNow,
      signOutUser,
      writeAuditLog,
      sendCloudNotification,
      markNotificationRead,
      markAllNotificationsRead,
      updateAppSettings,
      importCardsBatch,
      updatePackageInfo,
      executeSaleTransaction,
      deliverPartialCards,
      processSaleReturn,
      updateSaleRecord,
      deleteSaleRecord,
      createCustomerAccount,
      updateCustomerAccount,
      deleteCustomerAccount,
      addLedgerEntry,
      deleteLedgerEntry,
      submitTopupRequest,
      approveTopupRequest,
      rejectTopupRequest,
      approveRegistration,
      rejectRegistration,
      createManualUser,
      updateManagedUser,
      toggleUserRoleUpgrade,
      transferClientsToAgent,
      deleteManagedUser,
      resolvePasswordReset,
      enablePushNotifications,
      exportCloudBackup,
      restoreDeletedAgentsAndClients,
      resetAppData,
    }),
    [
      authReady,
      firebaseUser,
      profile,
      profileLoading,
      needsAdminEmailVerification,
      isOnline,
      firestoreConnected,
      isSyncing,
      packages,
      totalAvailableCards,
      mergedSales,
      customers,
      ledgerEntries,
      notifications,
      unreadNotificationsCount,
      pendingRegistrations,
      pendingPasswordResets,
      topupRequests,
      pendingTopups,
      appSettings,
      auditLogs,
      managedUsers,
      activeRoute,
      salesLimit,
      loadMoreSales,
      customersLimit,
      loadMoreCustomers,
      auditLogsLimit,
      loadMoreAuditLogs,
      refreshVerificationStatus,
      syncNow,
      signOutUser,
      writeAuditLog,
      sendCloudNotification,
      markNotificationRead,
      markAllNotificationsRead,
      updateAppSettings,
      importCardsBatch,
      updatePackageInfo,
      executeSaleTransaction,
      deliverPartialCards,
      processSaleReturn,
      updateSaleRecord,
      deleteSaleRecord,
      createCustomerAccount,
      updateCustomerAccount,
      deleteCustomerAccount,
      addLedgerEntry,
      deleteLedgerEntry,
      submitTopupRequest,
      approveTopupRequest,
      rejectTopupRequest,
      approveRegistration,
      rejectRegistration,
      createManualUser,
      updateManagedUser,
      toggleUserRoleUpgrade,
      transferClientsToAgent,
      deleteManagedUser,
      resolvePasswordReset,
      enablePushNotifications,
      exportCloudBackup,
      restoreDeletedAgentsAndClients,
      resetAppData,
    ]
  );

  return <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>;
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used within FirebaseProvider');
  }
  return ctx;
}
