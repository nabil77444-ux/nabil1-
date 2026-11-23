import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  generateSafeDocId,
  handleFirestoreError,
  isSuperAdminEmail,
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
  // Push, Backup & Super Admin Reset
  enablePushNotifications: () => Promise<boolean>;
  exportCloudBackup: () => Promise<void>;
  resetAppData: (
    scope: 'sales_only' | 'full_reset',
    adminPassword: string
  ) => Promise<{ ok: boolean; error?: string; deletedCount: number }>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

const CACHE_PROFILE_KEY = 'taibah_cached_profile_v1';
const CACHE_PACKAGES_KEY = 'taibah_cached_packages_v1';
const CACHE_SETTINGS_KEY = 'taibah_cached_settings_v1';
const CACHE_SALES_PREFIX = 'taibah_cached_sales_v1_';
const CACHE_CUSTOMERS_PREFIX = 'taibah_cached_customers_v1_';

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

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isOnline = useOnlineStatus();
  const { notifySuccess, notifyError, notifyWarning, notifyInfo } = useFeedback();

  const cachedProfileInitial = useMemo(() => readCachedJson<UserProfile | null>(CACHE_PROFILE_KEY, null), []);

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
  const bootstrappingUidRef = useRef<string | null>(null);
  const inFlightOpsRef = useRef<Set<string>>(new Set());

  // Update 12: Active route & pagination limits for lazy on-demand Firestore subscriptions
  const [activeRoute, setActiveRoute] = useState<AppRoute>('home');
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

  // Silent background connectivity probe + public settings/global listener (non-blocking)
  useEffect(() => {
    let active = true;
    const probeTimer = window.setTimeout(() => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (active) setFirestoreConnected(false);
        return;
      }
      testFirestoreConnection().then((ok) => {
        if (active) setFirestoreConnected(ok);
      });
    }, 200);

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
      active = false;
      window.clearTimeout(probeTimer);
      unsubSettings();
    };
  }, [isOnline]);

  // Auth listener with instant local cache hydration
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setVerificationVersion((v) => v + 1);
      setAuthReady(true);
      if (!user) {
        bootstrappingUidRef.current = null;
        setAdminDocApproved(false);
        setAdminApprovalChecking(false);
        writeCachedJson(CACHE_PROFILE_KEY, null);
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
        const cached = readCachedJson<UserProfile | null>(CACHE_PROFILE_KEY, null);
        if (cached && cached.uid === user.uid) {
          setProfile(cached);
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

      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'bootstrap_super_admin');
      bootstrappingUidRef.current = null;
      return false;
    }
  }, [adminDocApproved]);

  // Listen to current user profile in real time IMMEDIATELY (never blocked behind bootstrap round-trips)
  useEffect(() => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!authReady || !activeUser) return;
    if (needsAdminEmailVerification) {
      setProfileLoading(false);
      return;
    }

    let cancelled = false;
    let bootstrapInProgress = false;
    const isAdminAccount = isSuperAdminEmail(activeUser.email);

    if (isAdminAccount && (activeUser.emailVerified || adminDocApproved)) {
      bootstrapInProgress = true;
      void bootstrapSuperAdminIfNeeded(activeUser).finally(() => {
        bootstrapInProgress = false;
        if (!cancelled) {
          setProfileLoading((prev) => (prev ? false : prev));
        }
      });
    }

    const userDocPath = `users/${activeUser.uid}`;
    const unsub = onSnapshot(
      doc(db, 'users', activeUser.uid),
      (snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          const p = snap.data() as UserProfile;
          setProfile(p);
          if (p.role === 'super_admin' && p.status === 'active') {
            setAdminDocApproved(true);
          }
          writeCachedJson(CACHE_PROFILE_KEY, {
            uid: p.uid,
            name: p.name,
            phone: p.phone,
            email: p.email,
            role: p.role,
            status: p.status,
            parentAgentId: p.parentAgentId,
            discountRate: p.discountRate,
            balance: p.balance,
          });
          setProfileLoading(false);
        } else if (!bootstrapInProgress && !adminApprovalChecking) {
          setProfile(null);
          writeCachedJson(CACHE_PROFILE_KEY, null);
          setProfileLoading(false);
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, userDocPath);
        if (!cancelled) setProfileLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [
    authReady,
    firebaseUser,
    verificationVersion,
    adminDocApproved,
    adminApprovalChecking,
    needsAdminEmailVerification,
    bootstrapSuperAdminIfNeeded,
    syncNonce,
  ]);

  // A. ALWAYS-ON LIGHTWEIGHT CORE LISTENERS (Home counters, Packages, Unread Notifications, Pending Queues)
  useEffect(() => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!authReady || !activeUser || !profile || profile.status !== 'active') {
      return;
    }

    const unsubscribers: Array<() => void> = [];
    const isAdmin = profile.role === 'super_admin';
    const isAgent = profile.role === 'agent';

    // 1. Live Packages Metadata (8 small documents — cached locally for instant display)
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'packages'), where('price', '>', 0)),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<PackageDoc, 'id'>) }))
            .sort((a, b) => a.sortOrder - b.sortOrder);
          setRawPackages(list);
          writeCachedJson(
            CACHE_PACKAGES_KEY,
            list.map(({ updatedAt: _u, ...rest }) => rest)
          );
          setFirestoreConnected(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'packages')
      )
    );

    // 1B. STRICT ACCOUNT ISOLATION + OFFLINE CARD POOL SYNC
    // Non-admins (agent/client) ONLY see their own cards (`ownerId == uid`), never Admin stock.
    // Super Admin caches a lightweight pool of own available cards for seamless offline selling.
    if (!isAdmin) {
      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'cards'), where('ownerId', '==', activeUser.uid), limit(1500)),
          (snap) => {
            const availCounts: Record<string, number> = {};
            const soldCounts: Record<string, number> = {};
            const cachedAvail: CachedAvailableCard[] = [];
            for (const d of snap.docs) {
              const data = d.data() as CardDoc;
              if (data.status === 'available' && !isCardLocallyLocked(data.cardNumber)) {
                availCounts[data.packageId] = (availCounts[data.packageId] || 0) + 1;
                cachedAvail.push({
                  id: d.id,
                  packageId: data.packageId,
                  cardNumber: data.cardNumber,
                  ownerId: activeUser.uid,
                });
              } else if (data.status === 'sold') {
                soldCounts[data.packageId] = (soldCounts[data.packageId] || 0) + 1;
              }
            }
            setPersonalCardCounts(availCounts);
            setPersonalSoldCounts(soldCounts);
            saveCachedAvailableCards(activeUser.uid, cachedAvail);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'cards')
        )
      );
    } else if (navigator.onLine) {
      // Parallel background warm-up across all 8 packages (up to 250 cards/package) so card retrieval is 0ms instant!
      Promise.allSettled(
        EXCLUSIVE_PACKAGES.map(async (pkg) => {
          let snap = await getDocs(
            query(
              collection(db, 'cards'),
              where('ownerId', '==', activeUser.uid),
              where('packageId', '==', pkg.id),
              where('status', '==', 'available'),
              limit(250)
            )
          );
          if (snap.docs.length === 0) {
            snap = await getDocs(
              query(
                collection(db, 'cards'),
                where('packageId', '==', pkg.id),
                where('status', '==', 'available'),
                limit(250)
              )
            );
          }
          return snap;
        })
      )
        .then((results) => {
          const cachedAvail: CachedAvailableCard[] = [];
          for (const res of results) {
            if (res.status !== 'fulfilled') continue;
            for (const d of res.value.docs) {
              const data = d.data() as CardDoc;
              if (!isCardLocallyLocked(data.cardNumber)) {
                cachedAvail.push({
                  id: d.id,
                  packageId: data.packageId,
                  cardNumber: data.cardNumber,
                  ownerId: activeUser.uid,
                });
              }
            }
          }
          if (cachedAvail.length > 0) {
            saveCachedAvailableCards(activeUser.uid, cachedAvail);
            setOfflinePoolVersion((v) => v + 1);
          }
        })
        .catch(() => {});
    }

    // 2. Lightweight Notifications Stream (limit 30)
    const notifQuery = isAdmin
      ? query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(30))
      : query(collection(db, 'notifications'), where('recipientId', '==', activeUser.uid), limit(30));
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

    // 3. Pending Registration Requests (Real-time badge on Home & instant queue — single-field query avoids composite index errors)
    if (isAdmin || isAgent) {
      const regQuery = isAdmin
        ? query(collection(db, 'registrationRequests'), where('status', '==', 'pending'), limit(40))
        : query(
            collection(db, 'registrationRequests'),
            where('parentAgentId', '==', activeUser.uid),
            limit(40)
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

    // 4. Lightweight Topup Requests (Admin: all; Agent: incoming from clients + own outgoing to Admin; Client: own)
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
          query(collection(db, 'topupRequests'), where('targetId', '==', activeUser.uid), limit(50)),
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
          query(collection(db, 'topupRequests'), where('requesterId', '==', activeUser.uid), limit(50)),
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
        ? query(collection(db, 'topupRequests'), limit(50))
        : query(collection(db, 'topupRequests'), where('requesterId', '==', activeUser.uid), limit(50));
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

    // 5. Pending Password Resets (Admin badge only)
    if (isAdmin) {
      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'passwordResetRequests'), where('status', '==', 'pending'), limit(30)),
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
      unsubscribers.forEach((u) => u());
    };
  }, [authReady, firebaseUser, profile?.uid, profile?.role, profile?.status, syncNonce]);

  // B. LAZY ROUTE-SCOPED LISTENERS (Update 12: Load on demand & auto-unsubscribe on screen exit!)
  useEffect(() => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!authReady || !activeUser || !profile || profile.status !== 'active') {
      return;
    }

    const unsubscribers: Array<() => void> = [];
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

    if (needsSales) {
      const limitCount = activeRoute === 'reports' || activeRoute === 'backup' ? 200 : salesLimit;
      const salesQuery = isAdmin
        ? query(collection(db, 'sales'), limit(limitCount))
        : query(collection(db, 'sales'), where('sellerId', '==', activeUser.uid), limit(limitCount));
      unsubscribers.push(
        onSnapshot(
          salesQuery,
          (snap) => {
            const list = snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<SaleDoc, 'id'>) }))
              .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
            setSales(list);
            writeCachedJson(
              `${CACHE_SALES_PREFIX}${activeUser.uid}`,
              list.slice(0, 60).map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest)
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'sales')
        )
      );
    }

    if (needsCustomers) {
      const limitCount = activeRoute === 'reports' || activeRoute === 'backup' ? 250 : customersLimit;
      const customersQuery = isAdmin
        ? query(collection(db, 'customers'), limit(limitCount))
        : query(collection(db, 'customers'), where('ownerId', '==', activeUser.uid), limit(limitCount));
      unsubscribers.push(
        onSnapshot(
          customersQuery,
          (snap) => {
            const list = snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerAccount, 'id'>) }))
              .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
            setCustomers(list);
            writeCachedJson(
              `${CACHE_CUSTOMERS_PREFIX}${activeUser.uid}`,
              list.slice(0, 100).map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest)
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'customers')
        )
      );
    }

    if (needsLedger) {
      const ledgerQuery = isAdmin
        ? query(collection(db, 'ledgerEntries'), limit(120))
        : query(collection(db, 'ledgerEntries'), where('ownerId', '==', activeUser.uid), limit(120));
      unsubscribers.push(
        onSnapshot(
          ledgerQuery,
          (snap) => {
            const list = snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<LedgerEntry, 'id'>) }))
              .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
            setLedgerEntries(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'ledgerEntries')
        )
      );
    }

    if (needsManagedUsers) {
      const usersQuery = isAdmin
        ? query(collection(db, 'users'), limit(150))
        : query(collection(db, 'users'), where('parentAgentId', '==', activeUser.uid), limit(150));
      unsubscribers.push(
        onSnapshot(
          usersQuery,
          (snap) => {
            setManagedUsers(snap.docs.map((d) => d.data() as UserProfile));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'users')
        )
      );
    }

    if (needsAuditLogs) {
      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(auditLogsLimit)),
          (snap) => {
            setAuditLogs(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<AuditLogDoc, 'id'>),
              }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
        )
      );
    }

    return () => {
      unsubscribers.forEach((u) => u());
    };
  }, [
    authReady,
    firebaseUser,
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
      if (ok) {
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
  }, [flushOfflineSalesQueue, notifyError, notifySuccess]);

  const signOutUser = useCallback(async () => {
    try {
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

      // Fast O(n) local validation & deduplication via Set
      const validRegex = /^[0-9]{10,11}$/;
      const uniqueSet = new Set<string>();
      let invalidCount = 0;
      let duplicateCount = 0;

      for (let i = 0; i < rawCardNumbers.length; i++) {
        const clean = rawCardNumbers[i].trim();
        if (!validRegex.test(clean)) {
          invalidCount++;
          continue;
        }
        if (uniqueSet.has(clean)) {
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
      const CHUNK_SIZE = 500; // Exact Firestore maximum 500 writes per batch
      const PARALLEL_WAVES = 10; // Fire up to 10 batches (5,000 cards) simultaneously via Promise.all
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

        // Single atomic counter increment on the package document in Firestore
        await updateDoc(doc(db, 'packages', packageId), {
          availableCount: increment(done),
          uploadedCount: increment(done),
          updatedAt: serverTimestamp(),
        });

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

            // Online fast parallel fetch ONLY for packages not fully satisfied by local RAM cache
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

                let snap = await getDocs(
                  query(
                    collection(db, 'cards'),
                    where('ownerId', '==', activeUser.uid),
                    where('packageId', '==', item.packageId),
                    where('status', '==', 'available'),
                    limit(Math.max(deliverTarget + 60, 150))
                  )
                );
                if (profile.role === 'super_admin' && snap.docs.length < deliverTarget) {
                  snap = await getDocs(
                    query(
                      collection(db, 'cards'),
                      where('packageId', '==', item.packageId),
                      where('status', '==', 'available'),
                      limit(Math.max(deliverTarget + 60, 150))
                    )
                  );
                }
                const list = snap.docs
                  .map((d) => ({ id: d.id, cardNumber: (d.data() as CardDoc).cardNumber }))
                  .filter((c) => !isCardLocallyLocked(c.cardNumber));

                // Top up local cache with surplus cards for subsequent instant sales
                if (list.length > deliverTarget) {
                  appendCachedAvailableCards(
                    activeUser.uid,
                    list.slice(deliverTarget).map((c) => ({
                      id: c.id,
                      packageId: item.packageId,
                      cardNumber: c.cardNumber,
                      ownerId: activeUser.uid,
                    }))
                  );
                }
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

            // 4E. Silent Background Cache Replenishment when any sold package drops below 60 cached cards
            if (isElectronic && touchedPkgIds.length > 0 && navigator.onLine) {
              for (const pkgId of touchedPkgIds) {
                if (getCachedAvailableCards(activeUser.uid, pkgId).length < 60) {
                  getDocs(
                    query(
                      collection(db, 'cards'),
                      where('ownerId', '==', activeUser.uid),
                      where('packageId', '==', pkgId),
                      where('status', '==', 'available'),
                      limit(150)
                    )
                  )
                    .then((snap) => {
                      const fresh = snap.docs
                        .map((d) => ({
                          id: d.id,
                          packageId: pkgId,
                          cardNumber: (d.data() as CardDoc).cardNumber,
                          ownerId: activeUser.uid,
                        }))
                        .filter((c) => !isCardLocallyLocked(c.cardNumber));
                      if (fresh.length > 0) {
                        appendCachedAvailableCards(activeUser.uid, fresh);
                      }
                    })
                    .catch(() => {});
                }
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
        await writeAuditLog('مرتجع كروت', `إرجاع ${qty} كرت من الفاتورة ${sale.invoiceNumber || sale.id}`);
        notifySuccess(`تم تسجيل إرجاع ${qty} كرت وتحديث المخزون والحساب`);
        return true;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `sales/${sale.id}/return`);
        notifyError('تعذر تسجيل المرتجع');
        return false;
      }
    },
    [notifyError, notifySuccess, notifyWarning, packages, writeAuditLog]
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
      try {
        await setDoc(doc(db, 'users', uid), {
          uid,
          name: input.name.trim().slice(0, 100),
          phone: input.phone.trim().slice(0, 20),
          email: (input.email?.trim() || `${input.phone.replace(/[^\d]/g, '')}@taibah.net`).slice(0, 120),
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
      await writeAuditLog('نسخة احتياطية سحابية', 'تم تصدير ملف النسخة الاحتياطية الكاملة JSON');
      notifySuccess('تم تنزيل ملف النسخة الاحتياطية بنجاح');
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
  // SUPER ADMIN ONLY: SECURE APP DATA RESET (Password Re-Auth + Chunked Batch)
  // =========================================================================
  const resetAppData = useCallback(
    async (
      scope: 'sales_only' | 'full_reset',
      adminPassword: string
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
          error: 'يتطلب تصفير البيانات السحابية اتصالاً نشطاً بالإنترنت لضمان حذف جميع السجلات بشكل كامل.',
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
      try {
        const credential = EmailAuthProvider.credential(activeUser.email, cleanPass);
        await reauthenticateWithCredential(activeUser, credential);
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

      // Helper to safely delete an entire Firestore collection in batches of <= 400 docs
      const deleteCollectionInBatches = async (colName: string): Promise<number> => {
        let removed = 0;
        let safetyLoops = 0;
        while (safetyLoops < 200) {
          safetyLoops++;
          const snap = await getDocs(query(collection(db, colName), limit(400)));
          if (snap.empty) break;
          const batch = writeBatch(db);
          for (const d of snap.docs) {
            batch.delete(d.ref);
          }
          await batch.commit();
          removed += snap.docs.length;
          if (snap.docs.length < 400) break;
        }
        return removed;
      };

      let totalDeleted = 0;
      try {
        if (scope === 'sales_only') {
          totalDeleted += await deleteCollectionInBatches('sales');

          // Reset soldCount on all 8 packages while preserving available/uploaded stock
          const pkgSnap = await getDocs(collection(db, 'packages'));
          if (!pkgSnap.empty) {
            const pkgBatch = writeBatch(db);
            for (const pDoc of pkgSnap.docs) {
              pkgBatch.update(pDoc.ref, {
                soldCount: 0,
                updatedAt: serverTimestamp(),
              });
            }
            await pkgBatch.commit();
          }

          clearOfflineSalesQueueOnly();
          writeCachedJson(`${CACHE_SALES_PREFIX}${activeUser.uid}`, []);
          setSales([]);
          setPendingOfflineSales([]);

          await writeAuditLog(
            'تصفير المبيعات والتقارير',
            `تم تصفير سجل المبيعات والتقارير بواسطة المدير العام (حذف ${totalDeleted} فاتورة وتصفير عداد المباع)`
          );
          notifySuccess(`تم تصفير المبيعات والتقارير بنجاح (حذف ${totalDeleted} سجل) ✅`);
          return { ok: true, deletedCount: totalDeleted };
        }

        // FULL RESET: Deletes operational collections while strictly preserving super_admin, admins, settings/global & immutable auditLogs
        const targetCollections = [
          'sales',
          'customers',
          'ledgerEntries',
          'topupRequests',
          'notifications',
          'cards',
          'registrationRequests',
          'passwordResetRequests',
        ];
        for (const colName of targetCollections) {
          totalDeleted += await deleteCollectionInBatches(colName);
        }

        // Reset all 8 packages stock counters to 0 (keeping the 8 official packages intact)
        const pkgSnap = await getDocs(collection(db, 'packages'));
        if (!pkgSnap.empty) {
          const pkgBatch = writeBatch(db);
          for (const pDoc of pkgSnap.docs) {
            pkgBatch.update(pDoc.ref, {
              availableCount: 0,
              soldCount: 0,
              uploadedCount: 0,
              injectedCount: 0,
              updatedAt: serverTimestamp(),
            });
          }
          await pkgBatch.commit();
        }

        // Reset balances of non-admin users to 0 (preserving user accounts & super_admin intact)
        const usersSnap = await getDocs(collection(db, 'users'));
        const nonAdminDocs = usersSnap.docs.filter((u) => {
          const role = (u.data() as Partial<UserProfile>)?.role;
          return role !== 'super_admin' && u.id !== activeUser.uid;
        });
        for (let i = 0; i < nonAdminDocs.length; i += 400) {
          const chunk = nonAdminDocs.slice(i, i + 400);
          const uBatch = writeBatch(db);
          for (const uDoc of chunk) {
            uBatch.update(uDoc.ref, {
              balance: 0,
              updatedAt: serverTimestamp(),
            });
          }
          await uBatch.commit();
        }

        // Clear all local offline caches & in-memory operational state
        clearAllLocalOfflineCardCaches();
        writeCachedJson(CACHE_PACKAGES_KEY, null);
        writeCachedJson(`${CACHE_SALES_PREFIX}${activeUser.uid}`, []);
        writeCachedJson(`${CACHE_CUSTOMERS_PREFIX}${activeUser.uid}`, []);
        setSales([]);
        setCustomers([]);
        setLedgerEntries([]);
        setTopupRequests([]);
        setNotifications([]);
        setPendingRegistrations([]);
        setPendingPasswordResets([]);
        setPendingOfflineSales([]);
        setPersonalCardCounts({});
        setPersonalSoldCounts({});
        setOfflinePoolVersion((v) => v + 1);
        setSyncNonce((n) => n + 1);

        await writeAuditLog(
          'تصفير شامل لبيانات التطبيق',
          `تم تنفيذ تصفير شامل لبيانات التطبيق بواسطة المدير العام (حذف ${totalDeleted} سجل وتصفير أرصدة الباقات والحسابات)`
        );
        notifySuccess(`تم التصفير الشامل لبيانات التطبيق بنجاح (حذف ${totalDeleted} سجل) ✅`);
        return { ok: true, deletedCount: totalDeleted };
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `resetAppData/${scope}`);
        const msg =
          err instanceof Error && err.message
            ? `تعذر إكمال التصفير: ${err.message}`
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
