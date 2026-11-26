import type { CustomerAccount, LedgerEntry, TopupLineItem, TopupRequest } from '../types/taibah';

/**
 * Unified Offline-First Sync Queue (`offlineSyncQueue`) for TAIBAH NET.
 * - Executes feeding requests, customer additions, and ledger payments instantaneously offline.
 * - Uses deterministic `clientOpId` so reconnecting NEVER duplicates records in Firestore.
 * - Provides safe local caches for `topupRequests` and `customers` with a strict
 *   "No Empty Overwrite" guard so losing connectivity NEVER wipes visible data.
 */

export type OfflineOpKind = 'topup_request' | 'create_customer' | 'ledger_entry';

export interface OfflineTopupPayload {
  reqId: string;
  requesterId: string;
  requesterName: string;
  requesterPhone: string;
  requesterRole: 'agent' | 'client';
  discountRate: number;
  targetId: string;
  targetName: string;
  items: TopupLineItem[];
  totalCards: number;
  totalAmount: number;
  notes: string;
}

export interface OfflineCreateCustomerPayload {
  customerId: string;
  ownerId: string;
  name: string;
  phone: string;
  category: string;
  notes: string;
  initialDebit: number;
  initialCredit: number;
}

export interface OfflineLedgerEntryPayload {
  entryId: string;
  ownerId: string;
  customerId: string;
  entryType: 'debit' | 'credit' | 'adjustment';
  amount: number;
  description: string;
}

export interface OfflineQueuedOp {
  clientOpId: string;
  kind: OfflineOpKind;
  ownerUid: string;
  createdAtMs: number;
  topup?: OfflineTopupPayload;
  customer?: OfflineCreateCustomerPayload;
  ledger?: OfflineLedgerEntryPayload;
}

const OFFLINE_OPS_QUEUE_KEY = 'taibah_offline_sync_queue_v1';
const CACHED_TOPUPS_PREFIX = 'taibah_cached_topups_v1_';
const CACHED_CUSTOMERS_PREFIX = 'taibah_cached_customers_v1_';

function makeFakeTimestamp(ms: number): TopupRequest['createdAt'] {
  return {
    toDate: () => new Date(ms),
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
  } as unknown as TopupRequest['createdAt'];
}

export function getOfflineSyncQueue(ownerUid?: string): OfflineQueuedOp[] {
  try {
    const raw = localStorage.getItem(OFFLINE_OPS_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (op): op is OfflineQueuedOp =>
          !!op &&
          typeof op.clientOpId === 'string' &&
          typeof op.kind === 'string' &&
          (!ownerUid || op.ownerUid === ownerUid)
      )
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
  } catch {
    return [];
  }
}

export function enqueueOfflineOp(op: OfflineQueuedOp): void {
  try {
    const existing = getOfflineSyncQueue();
    // Deduplicate strictly by deterministic clientOpId
    if (existing.some((item) => item.clientOpId === op.clientOpId)) {
      return;
    }
    const next = [...existing, op].sort((a, b) => a.createdAtMs - b.createdAtMs);
    localStorage.setItem(OFFLINE_OPS_QUEUE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

export function removeOfflineOp(clientOpId: string): void {
  try {
    const existing = getOfflineSyncQueue();
    const next = existing.filter((item) => item.clientOpId !== clientOpId);
    localStorage.setItem(OFFLINE_OPS_QUEUE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
}

export function clearOfflineOpsQueue(): void {
  try {
    localStorage.removeItem(OFFLINE_OPS_QUEUE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function offlineTopupOpToDoc(op: OfflineQueuedOp): TopupRequest | null {
  if (op.kind !== 'topup_request' || !op.topup) return null;
  const p = op.topup;
  const ts = makeFakeTimestamp(op.createdAtMs);
  return {
    id: p.reqId,
    requesterId: p.requesterId,
    requesterName: p.requesterName,
    requesterPhone: p.requesterPhone,
    requesterRole: p.requesterRole,
    discountRate: p.discountRate,
    targetId: p.targetId,
    targetName: p.targetName,
    items: p.items,
    totalCards: p.totalCards,
    totalAmount: p.totalAmount,
    status: 'pending',
    notes: p.notes
      ? `${p.notes} (بانتظار الإرسال عند توفر الإنترنت)`
      : 'بانتظار الإرسال عند توفر الإنترنت',
    createdAt: ts,
    updatedAt: ts,
  };
}

export function isOfflineQueuedTopupId(reqId: string): boolean {
  return getOfflineSyncQueue().some(
    (op) => op.kind === 'topup_request' && op.topup?.reqId === reqId
  );
}

export function offlineCustomerOpToDoc(op: OfflineQueuedOp): CustomerAccount | null {
  if (op.kind !== 'create_customer' || !op.customer) return null;
  const c = op.customer;
  const ts = makeFakeTimestamp(op.createdAtMs);
  return {
    id: c.customerId,
    ownerId: c.ownerId,
    name: c.name,
    phone: c.phone,
    category: c.category,
    totalDebit: c.initialDebit,
    totalCredit: c.initialCredit,
    balance: c.initialDebit - c.initialCredit,
    notes: c.notes ? `${c.notes} (محفوظ محلياً)` : 'محفوظ محلياً — قيد المزامنة',
    createdAt: ts,
    updatedAt: ts,
  };
}

export function offlineLedgerOpToDoc(op: OfflineQueuedOp): LedgerEntry | null {
  if (op.kind !== 'ledger_entry' || !op.ledger) return null;
  const l = op.ledger;
  return {
    id: l.entryId,
    ownerId: l.ownerId,
    customerId: l.customerId,
    entryType: l.entryType,
    amount: l.amount,
    description: `${l.description} (قيد المزامنة)`,
    createdAt: makeFakeTimestamp(op.createdAtMs),
  };
}

// =========================================================================
// SAFE LOCAL CACHES (0ms Instant Hydration + Strict No-Empty-Overwrite Guard)
// =========================================================================

interface SerializedTopup {
  id: string;
  requesterId: string;
  requesterName: string;
  requesterPhone?: string;
  requesterRole: 'agent' | 'client';
  discountRate?: number;
  targetId: string;
  targetName?: string;
  items?: TopupLineItem[];
  totalCards: number;
  totalAmount: number;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  notes?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export function saveCachedTopupRequests(uid: string, list: TopupRequest[]): void {
  if (!uid) return;
  // Never wipe existing local cache with empty list when offline
  if (list.length === 0 && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }
  try {
    const serialized: SerializedTopup[] = list.slice(0, 80).map((t) => ({
      id: t.id,
      requesterId: t.requesterId,
      requesterName: t.requesterName,
      requesterPhone: t.requesterPhone,
      requesterRole: t.requesterRole,
      discountRate: t.discountRate,
      targetId: t.targetId,
      targetName: t.targetName,
      items: t.items,
      totalCards: t.totalCards,
      totalAmount: t.totalAmount,
      status: t.status,
      rejectionReason: t.rejectionReason,
      notes: t.notes,
      createdAtMs: t.createdAt?.toMillis?.() ?? Date.now(),
      updatedAtMs: t.updatedAt?.toMillis?.() ?? Date.now(),
    }));
    localStorage.setItem(`${CACHED_TOPUPS_PREFIX}${uid}`, JSON.stringify(serialized));
  } catch {
    // Ignore quota errors
  }
}

export function loadCachedTopupRequests(uid: string): TopupRequest[] {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(`${CACHED_TOPUPS_PREFIX}${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is SerializedTopup => !!x && typeof x.id === 'string')
      .map((x) => ({
        id: x.id,
        requesterId: x.requesterId,
        requesterName: x.requesterName,
        requesterPhone: x.requesterPhone,
        requesterRole: x.requesterRole,
        discountRate: x.discountRate,
        targetId: x.targetId,
        targetName: x.targetName,
        items: x.items,
        totalCards: x.totalCards,
        totalAmount: x.totalAmount,
        status: x.status,
        rejectionReason: x.rejectionReason,
        notes: x.notes,
        createdAt: makeFakeTimestamp(x.createdAtMs || Date.now()),
        updatedAt: makeFakeTimestamp(x.updatedAtMs || Date.now()),
      }));
  } catch {
    return [];
  }
}

export function saveCachedCustomers(uid: string, list: CustomerAccount[]): void {
  if (!uid) return;
  if (list.length === 0 && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }
  try {
    const clean = list.slice(0, 200).map((c) => ({
      id: c.id,
      ownerId: c.ownerId,
      name: c.name,
      phone: c.phone,
      category: c.category,
      totalDebit: c.totalDebit,
      totalCredit: c.totalCredit,
      balance: c.balance,
      notes: c.notes,
      createdAtMs: c.createdAt?.toMillis?.() ?? Date.now(),
      updatedAtMs: c.updatedAt?.toMillis?.() ?? Date.now(),
    }));
    localStorage.setItem(`${CACHED_CUSTOMERS_PREFIX}${uid}`, JSON.stringify(clean));
  } catch {
    // Ignore quota errors
  }
}

export function loadCachedCustomers(uid: string): CustomerAccount[] {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(`${CACHED_CUSTOMERS_PREFIX}${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => !!c && typeof c.id === 'string')
      .map((c) => ({
        id: c.id,
        ownerId: c.ownerId,
        name: c.name,
        phone: c.phone,
        category: c.category,
        totalDebit: Number(c.totalDebit) || 0,
        totalCredit: Number(c.totalCredit) || 0,
        balance: Number(c.balance) || 0,
        notes: c.notes,
        createdAt: makeFakeTimestamp(c.createdAtMs || Date.now()),
        updatedAt: makeFakeTimestamp(c.updatedAtMs || Date.now()),
      }));
  } catch {
    return [];
  }
}
