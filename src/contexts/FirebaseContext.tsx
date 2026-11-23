import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
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
  // Push & Backup
  enablePushNotifications: () => Promise<boolean>;
  exportCloudBackup: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

const CACHE_PROFILE_KEY = 'taibah_cached_profile_v1';
const CACHE_PACKAGES_KEY = 'taibah_cached_packages_v1';
const CACHE_SETTINGS_KEY = 'taibah_cached_settings_v1';

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
  const [sales, setSales] = useState<SaleDoc[]>([]);
  const [customers, setCustomers] = useState<CustomerAccount[]>([]);
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
      // Background refresh of Admin's offline-ready pool (up to 400 available cards across packages)
      getDocs(
        query(
          collection(db, 'cards'),
          where('ownerId', '==', activeUser.uid),
          where('status', '==', 'available'),
          limit(400)
        )
      )
        .then((snap) => {
          const cachedAvail: CachedAvailableCard[] = snap.docs
            .map((d) => {
              const data = d.data() as CardDoc;
              return {
                id: d.id,
                packageId: data.packageId,
                cardNumber: data.cardNumber,
                ownerId: activeUser.uid,
              };
            })
            .filter((c) => !isCardLocallyLocked(c.cardNumber));
          if (cachedAvail.length > 0) {
            saveCachedAvailableCards(activeUser.uid, cachedAvail);
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
  // ULTRA-FAST PARALLEL CARD IMPORT ENGINE (480 ops × 6 parallel waves)
  // =========================================================================
  const importCardsBatch = useCallback(
    async (
      packageId: string,
      rawCardNumbers: string[],
      onProgress?: (percent: number, done: number, total: number) => void
    ): Promise<ImportCardsResult> => {
      const activeUser = auth.currentUser || firebaseUser;
      if (!activeUser || !profile || profile.role !== 'super_admin') {
        notifyError('صلاحية الإدارة فقط', 'استيراد الكروت متاح للمدير العام فقط.');
        return { totalParsed: 0, importedCount: 0, duplicateCount: 0, invalidCount: 0 };
      }

      // Fast O(n) local validation & deduplication via Set
      const validRegex = /^[0-9]{10,11}$/;
      const uniqueSet = new Set<string>();
      let invalidCount = 0;
      let duplicateCount = 0;

      for (const raw of rawCardNumbers) {
        const clean = raw.trim();
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
        };
      }

      const batchId = generateSafeDocId('batch');
      const CHUNK_SIZE = 480; // Maximized safely under Firestore 500-op writeBatch limit
      const PARALLEL_BATCHES = 6; // Commit 6 batches concurrently for maximum speed
      const chunks: string[][] = [];
      for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
        chunks.push(toInsert.slice(i, i + CHUNK_SIZE));
      }

      let done = 0;
      try {
        for (let wave = 0; wave < chunks.length; wave += PARALLEL_BATCHES) {
          const waveChunks = chunks.slice(wave, wave + PARALLEL_BATCHES);
          await Promise.all(
            waveChunks.map(async (chunk) => {
              const batch = writeBatch(db);
              for (const cardNumber of chunk) {
                batch.set(doc(db, 'cards', cardNumber), {
                  packageId,
                  cardNumber,
                  status: 'available',
                  ownerId: activeUser.uid,
                  batchId,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              }
              await batch.commit();
              done += chunk.length;
              if (onProgress) {
                const pct = Math.min(99, Math.round((done / toInsert.length) * 100));
                onProgress(pct, done, toInsert.length);
              }
            })
          );
        }

        // Single atomic counter increment on the package document
        await updateDoc(doc(db, 'packages', packageId), {
          availableCount: increment(done),
          uploadedCount: increment(done),
          updatedAt: serverTimestamp(),
        });

        // Pre-populate Admin's offline card pool with newly imported cards immediately
        const existingPool = getCachedAvailableCards(activeUser.uid);
        const addedCards: CachedAvailableCard[] = toInsert.slice(0, 300).map((cardNumber) => ({
          id: cardNumber,
          packageId,
          cardNumber,
          ownerId: activeUser.uid,
        }));
        saveCachedAvailableCards(activeUser.uid, [...addedCards, ...existingPool]);

        if (onProgress) {
          onProgress(100, done, toInsert.length);
        }

        // Fire-and-forget audit & notification so UI finishes instantly
        writeAuditLog(
          'استيراد دفعة كروت',
          `تم استيراد ${done} كرت جديد للباقة ${packageId} (استبعاد ${duplicateCount} مكرر محلياً)`
        ).catch(() => {});
        sendCloudNotification({
          recipientId: 'super_admin',
          title: 'تم استيراد دفعة كروت جديدة',
          body: `تمت إضافة ${done} كرت للباقة ${packageId} بنجاح.`,
          category: 'inventory',
          targetRoute: 'packages',
        }).catch(() => {});

        notifySuccess(`تم استيراد ${done} كرت بنجاح ✅`);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'cards/batch_import');
        notifyError('حدث خطأ أثناء الاستيراد', 'يرجى التحقق من الاتصال والمحاولة مجدداً.');
      }

      return {
        totalParsed: rawCardNumbers.length,
        importedCount: done,
        duplicateCount,
        invalidCount,
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
  // UPDATE 4: TRANSACTIONAL MULTI-PACKAGE DIRECT, ELECTRONIC & PAPER SALES
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

      // OFFLINE-FIRST EXECUTION PATH (Zero Duplicate Guarantee via Local Card Lock)
      const executeOfflineSale = (): SaleDoc | null => {
        const saleId = generateSafeDocId('sale');
        const invoiceNumber = `TN-${String(Date.now()).slice(-6)}`;
        const lineItems: SaleLineItem[] = [];
        const allPulledNumbers: string[] = [];
        const allPulledDocIds: string[] = [];
        let totalAmount = 0;
        let faceValueTotal = 0;
        let totalCards = 0;
        let deliveredCards = 0;

        const consumedByPkg: Array<{ pkgId: string; picked: CachedAvailableCard[] }> = [];

        if (isElectronic) {
          for (const item of requestedItems) {
            const deliverTarget = Math.min(item.quantity, item.deliverNow ?? item.quantity);
            if (deliverTarget <= 0) continue;
            const picked = consumeCachedAvailableCards(activeUser.uid, item.packageId, deliverTarget);
            if (!picked || picked.length < deliverTarget) {
              // Release any already-locked cards from earlier items in this offline batch
              for (const prev of consumedByPkg) {
                releaseCardLocksLocally(prev.picked.map((c) => c.cardNumber));
              }
              const pkgMeta = packages.find((p) => p.id === item.packageId);
              notifyError(
                'المخزون المحلي غير كافٍ دون إنترنت',
                `المتوفر محلياً لباقة ${pkgMeta?.price || item.packageId} ر.ي أقل من المطلوب (${deliverTarget}). يرجى الاتصال بالإنترنت للمزامنة.`
              );
              return null;
            }
            consumedByPkg.push({ pkgId: item.packageId, picked });
          }
        }

        for (const item of requestedItems) {
          const pkg =
            packages.find((p) => p.id === item.packageId) ||
            (EXCLUSIVE_PACKAGES.find((p) => p.id === item.packageId) as PackageDoc | undefined);
          if (!pkg) continue;
          const unitPrice = Math.round((pkg.price * input.discountRate) / 100);
          const picked = consumedByPkg.find((c) => c.pkgId === item.packageId)?.picked || [];
          const deliverCount = isElectronic ? picked.length : item.quantity;

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

        const queued: OfflineQueuedSale = {
          localId: saleId,
          createdAtMs: Date.now(),
          sellerId: activeUser.uid,
          buyerId: input.buyerId,
          buyerName: input.buyerName.trim() || 'زبون مباشر',
          buyerPhone: input.buyerPhone,
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
          notes: input.notes,
          transferOwnershipToBuyer,
        };

        enqueueOfflineSale(queued);
        setPendingOfflineSales(getPendingOfflineSales());
        setOfflinePoolVersion((v) => v + 1);
        notifySuccess(
          `تم تنفيذ البيع محلياً دون إنترنت (${totalCards} كرت) ✅ — محمي من التكرار وستتم المزامنة تلقائياً`
        );
        return offlineSaleToSaleDoc(queued);
      };

      const lockedCandidateNumbers: string[] = [];

      try {
        if (!navigator.onLine) {
          return executeOfflineSale();
        }

        // Step 1: Pre-fetch candidate available cards for each requested package (if electronic)
        const candidateCardDocsByPkg: Record<string, Array<{ id: string; cardNumber: string }>> = {};
        if (isElectronic) {
          for (const item of requestedItems) {
            const deliverTarget = Math.min(item.quantity, item.deliverNow ?? item.quantity);
            if (deliverTarget <= 0) {
              candidateCardDocsByPkg[item.packageId] = [];
              continue;
            }
            const q =
              profile.role === 'super_admin'
                ? query(
                    collection(db, 'cards'),
                    where('ownerId', '==', activeUser.uid),
                    where('packageId', '==', item.packageId),
                    where('status', '==', 'available'),
                    limit(deliverTarget + 25)
                  )
                : query(
                    collection(db, 'cards'),
                    where('ownerId', '==', activeUser.uid),
                    where('packageId', '==', item.packageId),
                    where('status', '==', 'available'),
                    limit(deliverTarget + 25)
                  );
            let snap = await getDocs(q);
            // Fallback for legacy Super Admin cards if ownerId differed from current admin uid
            if (profile.role === 'super_admin' && snap.docs.length < deliverTarget) {
              snap = await getDocs(
                query(
                  collection(db, 'cards'),
                  where('packageId', '==', item.packageId),
                  where('status', '==', 'available'),
                  limit(deliverTarget + 25)
                )
              );
            }
            // Exclude ANY locally locked card number to guarantee zero duplicate sales
            const list = snap.docs
              .map((d) => ({
                id: d.id,
                cardNumber: (d.data() as CardDoc).cardNumber,
              }))
              .filter((c) => !isCardLocallyLocked(c.cardNumber));

            if (list.length < deliverTarget) {
              const pkgMeta = packages.find((p) => p.id === item.packageId);
              notifyError(
                'المخزون غير كافٍ',
                `المتوفر لباقة ${pkgMeta?.price || item.packageId} ر.ي هو ${list.length} كرت والمطلوب تسليمه ${deliverTarget}.`
              );
              return null;
            }
            const chosen = list.slice(0, deliverTarget);
            candidateCardDocsByPkg[item.packageId] = chosen;
            for (const c of chosen) {
              lockedCandidateNumbers.push(c.cardNumber);
            }
          }

          // Synchronously lock all candidate cards BEFORE entering Firestore transaction
          if (lockedCandidateNumbers.length > 0 && !lockCardsLocally(lockedCandidateNumbers)) {
            notifyWarning('أحد الكروت قيد التنفيذ حالياً، يرجى إعادة المحاولة فوراً.');
            return null;
          }
        }

        const saleId = generateSafeDocId('sale');
        const invoiceNumber = `TN-${String(Date.now()).slice(-6)}`;
        const lineItems: SaleLineItem[] = [];
        const allPulledNumbers: string[] = [];
        let totalAmount = 0;
        let faceValueTotal = 0;
        let totalCards = 0;
        let deliveredCards = 0;

        // Step 2: Atomic Firestore Transaction to prevent double-selling any voucher!
        await runTransaction(db, async (tx) => {
          const pkgSnaps = new Map<string, PackageDoc>();
          for (const item of requestedItems) {
            const pSnap = await tx.get(doc(db, 'packages', item.packageId));
            if (!pSnap.exists()) throw new Error(`الباقة ${item.packageId} غير موجودة`);
            pkgSnaps.set(item.packageId, {
              id: pSnap.id,
              ...(pSnap.data() as Omit<PackageDoc, 'id'>),
            });
          }

          // Re-verify all candidate card docs inside the transaction
          const verifiedCardsByPkg = new Map<string, Array<{ id: string; cardNumber: string }>>();
          if (isElectronic) {
            for (const item of requestedItems) {
              const candidates = candidateCardDocsByPkg[item.packageId] || [];
              const verified: Array<{ id: string; cardNumber: string }> = [];
              for (const c of candidates) {
                const cSnap = await tx.get(doc(db, 'cards', c.id));
                const cData = cSnap.exists() ? (cSnap.data() as CardDoc) : null;
                if (
                  !cData ||
                  cData.status !== 'available' ||
                  (profile.role !== 'super_admin' && cData.ownerId !== activeUser.uid)
                ) {
                  throw new Error('أحد الكروت تم بيعه للتو في عملية أخرى، يرجى المحاولة مجدداً.');
                }
                verified.push(c);
              }
              verifiedCardsByPkg.set(item.packageId, verified);
            }
          }

          // Apply card updates & package inventory updates
          for (const item of requestedItems) {
            const pkg = pkgSnaps.get(item.packageId)!;
            const unitPrice = Math.round((pkg.price * input.discountRate) / 100);
            const verified = verifiedCardsByPkg.get(item.packageId) || [];
            const deliverCount = isElectronic ? verified.length : item.quantity;

            if (isElectronic && verified.length > 0) {
              for (const c of verified) {
                if (transferOwnershipToBuyer && input.buyerId) {
                  // Transfer real cards into the Agent/Client's isolated personal inventory
                  tx.update(doc(db, 'cards', c.id), {
                    status: 'available',
                    ownerId: input.buyerId,
                    soldTo: (input.buyerPhone || input.buyerName).slice(0, 128),
                    saleId,
                    updatedAt: serverTimestamp(),
                  });
                } else {
                  tx.update(doc(db, 'cards', c.id), {
                    status: 'sold',
                    soldTo: (input.buyerPhone || input.buyerName).slice(0, 128),
                    saleId,
                    updatedAt: serverTimestamp(),
                  });
                }
                allPulledNumbers.push(c.cardNumber);
              }

              // Update global central package counters ONLY when Super Admin deducts from central pool
              if (profile.role === 'super_admin') {
                tx.update(doc(db, 'packages', item.packageId), {
                  availableCount: Math.max(0, (Number(pkg.availableCount) || 0) - verified.length),
                  soldCount: (Number(pkg.soldCount) || 0) + verified.length,
                  updatedAt: serverTimestamp(),
                });
              }
            }

            lineItems.push({
              packageId: item.packageId,
              packageLabel: `باقة ${pkg.price} ر.ي (${pkg.dataLabel})`,
              price: pkg.price,
              unitPrice,
              quantity: item.quantity,
              delivered: deliverCount,
              returned: 0,
              cardNumbers: verified.map((v) => v.cardNumber),
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
          const realizedProfit = totalAmount > 0 ? Math.round((expectedProfit * paidAmount) / totalAmount) : 0;
          const status: SaleDoc['status'] =
            deliveredCards < totalCards || remainingAmount > 0 ? 'partial' : 'completed';

          tx.set(doc(db, 'sales', saleId), {
            invoiceNumber,
            sellerId: activeUser.uid,
            buyerId: (input.buyerId || '').slice(0, 128),
            buyerName: input.buyerName.trim().slice(0, 100) || 'زبون مباشر',
            buyerPhone: (input.buyerPhone || '').slice(0, 20),
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
            notes: (input.notes || '').slice(0, 500),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

        // Remove sold/transferred cards from seller's local cache immediately
        if (allPulledNumbers.length > 0) {
          removeCardsFromCache(activeUser.uid, allPulledNumbers);
        }

        const paidAmount =
          input.paymentMethod === 'cash'
            ? totalAmount
            : input.paymentMethod === 'credit'
              ? 0
              : Math.min(totalAmount, Math.max(0, input.paidAmount));
        const remainingAmount = Math.max(0, totalAmount - paidAmount);

        // Update buyer balance if it's a registered user with remaining balance
        if (input.buyerId && remainingAmount > 0 && profile.role === 'super_admin') {
          const buyerUser = managedUsers.find((u) => u.uid === input.buyerId);
          if (buyerUser) {
            await updateDoc(doc(db, 'users', input.buyerId), {
              balance: (Number(buyerUser.balance) || 0) + remainingAmount,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }
        }

        const typeLabel =
          input.saleType === 'direct'
            ? 'بيع مباشر'
            : input.saleType === 'electronic_wholesale'
              ? 'جملة إلكترونية'
              : 'فاتورة كروت ورقية';

        await writeAuditLog(
          typeLabel,
          `فاتورة ${invoiceNumber} للمشتري ${input.buyerName} — ${totalCards} كرت — الإجمالي ${totalAmount} ر.ي`
        );
        await sendCloudNotification({
          recipientId: input.buyerId || 'super_admin',
          title: `تم تسجيل ${typeLabel} (${invoiceNumber})`,
          body: `${input.buyerName} • ${totalCards} كرت • الإجمالي ${totalAmount} ر.ي`,
          category: input.saleType === 'paper_invoice' ? 'invoice' : 'sale',
          targetRoute: 'sales_list',
        });

        notifySuccess(`تم تنفيذ ${typeLabel} (${totalCards} كرت) بنجاح`);

        return {
          id: saleId,
          invoiceNumber,
          sellerId: activeUser.uid,
          buyerId: input.buyerId,
          buyerName: input.buyerName.trim() || 'زبون مباشر',
          buyerPhone: input.buyerPhone,
          buyerRole: input.buyerRole,
          saleType: input.saleType,
          paymentMethod: input.paymentMethod,
          discountRate: input.discountRate,
          totalAmount,
          paidAmount,
          remainingAmount,
          totalCards,
          deliveredCards,
          returnedCards: 0,
          items: lineItems,
          cardNumbers: allPulledNumbers,
          status: deliveredCards < totalCards || remainingAmount > 0 ? 'partial' : 'completed',
          notes: input.notes,
        };
      } catch (err) {
        if (lockedCandidateNumbers.length > 0) {
          releaseCardLocksLocally(lockedCandidateNumbers);
        }
        const msg = err instanceof Error ? err.message : 'تعذر إتمام عملية البيع';
        const isNetworkOffline =
          !navigator.onLine ||
          /offline|unavailable|failed to get document|network|client is offline/i.test(msg);
        if (isNetworkOffline) {
          return executeOfflineSale();
        }
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
