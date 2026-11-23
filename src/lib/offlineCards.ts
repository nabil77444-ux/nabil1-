import type { SaleDoc, SaleLineItem } from '../types/taibah';

export interface CachedAvailableCard {
  id: string;
  packageId: string;
  cardNumber: string;
  ownerId: string;
}

export interface OfflineQueuedSale {
  localId: string;
  createdAtMs: number;
  sellerId: string;
  buyerId?: string;
  buyerName: string;
  buyerPhone?: string;
  buyerRole?: 'consumer' | 'client' | 'agent';
  saleType: 'direct' | 'electronic_wholesale' | 'paper_invoice';
  paymentMethod: 'cash' | 'credit' | 'partial';
  discountRate: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  expectedProfit: number;
  realizedProfit: number;
  totalCards: number;
  deliveredCards: number;
  items: SaleLineItem[];
  cardNumbers: string[];
  cardDocIds: string[];
  invoiceNumber: string;
  notes?: string;
  transferOwnershipToBuyer: boolean;
}

const LOCKED_CARDS_KEY = 'taibah_locked_cards_v1';
const OFFLINE_QUEUE_KEY = 'taibah_offline_sales_queue_v1';
const CACHED_CARDS_PREFIX = 'taibah_cached_cards_v1_';

// Synchronous in-memory lock set to block rapid double-taps or concurrent sales instantly
const memoryLockedCards = new Set<string>();

function loadPersistedLocks(): Set<string> {
  try {
    const raw = localStorage.getItem(LOCKED_CARDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === 'string' && v.length > 0));
    }
  } catch {
    // Ignore storage read errors
  }
  return new Set();
}

function savePersistedLocks(locks: Set<string>): void {
  try {
    // Keep up to 15,000 most recent locked card numbers so storage stays lean
    const arr = Array.from(locks);
    const trimmed = arr.length > 15000 ? arr.slice(arr.length - 15000) : arr;
    localStorage.setItem(LOCKED_CARDS_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore quota errors
  }
}

export function getLocallyLockedCards(): Set<string> {
  const persisted = loadPersistedLocks();
  for (const num of memoryLockedCards) {
    persisted.add(num);
  }
  return persisted;
}

export function isCardLocallyLocked(cardNumber: string): boolean {
  if (!cardNumber) return false;
  if (memoryLockedCards.has(cardNumber)) return true;
  return loadPersistedLocks().has(cardNumber);
}

/**
 * Synchronously locks card numbers both in memory and in localStorage.
 * Returns true if all cards were unlocked and are now locked, or false if ANY card was already locked.
 */
export function lockCardsLocally(cardNumbers: string[]): boolean {
  const unique = Array.from(new Set(cardNumbers.filter(Boolean)));
  if (unique.length === 0) return true;
  const current = getLocallyLockedCards();
  for (const num of unique) {
    if (current.has(num)) {
      return false;
    }
  }
  for (const num of unique) {
    memoryLockedCards.add(num);
    current.add(num);
  }
  savePersistedLocks(current);
  return true;
}

/**
 * Releases card locks ONLY if a transaction failed before committing and before displaying cards to the user.
 */
export function releaseCardLocksLocally(cardNumbers: string[]): void {
  if (cardNumbers.length === 0) return;
  const current = loadPersistedLocks();
  for (const num of cardNumbers) {
    memoryLockedCards.delete(num);
    current.delete(num);
  }
  savePersistedLocks(current);
}

export function saveCachedAvailableCards(ownerId: string, cards: CachedAvailableCard[]): void {
  if (!ownerId) return;
  try {
    const locked = getLocallyLockedCards();
    // Never cache already locked cards
    const clean = cards.filter((c) => c.cardNumber && !locked.has(c.cardNumber));
    // Cap per-owner cache to 2,000 cards to stay fast and light in localStorage
    const capped = clean.slice(0, 2000);
    localStorage.setItem(`${CACHED_CARDS_PREFIX}${ownerId}`, JSON.stringify(capped));
  } catch {
    // Ignore storage quota errors
  }
}

export function getCachedAvailableCards(ownerId: string, packageId?: string): CachedAvailableCard[] {
  if (!ownerId) return [];
  try {
    const raw = localStorage.getItem(`${CACHED_CARDS_PREFIX}${ownerId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const locked = getLocallyLockedCards();
    return parsed.filter(
      (c): c is CachedAvailableCard =>
        !!c &&
        typeof c.id === 'string' &&
        typeof c.packageId === 'string' &&
        typeof c.cardNumber === 'string' &&
        !locked.has(c.cardNumber) &&
        (!packageId || c.packageId === packageId)
    );
  } catch {
    return [];
  }
}

export function removeCardsFromCache(ownerId: string, cardNumbers: string[]): void {
  if (!ownerId || cardNumbers.length === 0) return;
  try {
    const numSet = new Set(cardNumbers);
    const remaining = getCachedAvailableCards(ownerId).filter((c) => !numSet.has(c.cardNumber));
    localStorage.setItem(`${CACHED_CARDS_PREFIX}${ownerId}`, JSON.stringify(remaining));
  } catch {
    // Ignore storage errors
  }
}

export function consumeCachedAvailableCards(
  ownerId: string,
  packageId: string,
  quantity: number
): CachedAvailableCard[] | null {
  const pool = getCachedAvailableCards(ownerId, packageId);
  if (pool.length < quantity) return null;
  const picked = pool.slice(0, quantity);
  const pickedNums = picked.map((c) => c.cardNumber);
  if (!lockCardsLocally(pickedNums)) {
    return null;
  }
  removeCardsFromCache(ownerId, pickedNums);
  return picked;
}

export function getPendingOfflineSales(sellerId?: string): OfflineQueuedSale[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is OfflineQueuedSale =>
        !!item &&
        typeof item.localId === 'string' &&
        (!sellerId || item.sellerId === sellerId)
    );
  } catch {
    return [];
  }
}

export function enqueueOfflineSale(sale: OfflineQueuedSale): void {
  try {
    const existing = getPendingOfflineSales();
    const filtered = existing.filter((s) => s.localId !== sale.localId);
    filtered.unshift(sale);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(filtered));
  } catch {
    // Ignore storage quota errors
  }
}

export function removeSyncedOfflineSale(localId: string): void {
  try {
    const existing = getPendingOfflineSales();
    const next = existing.filter((s) => s.localId !== localId);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
}

export function offlineSaleToSaleDoc(q: OfflineQueuedSale): SaleDoc {
  const fakeTs = {
    toDate: () => new Date(q.createdAtMs),
    toMillis: () => q.createdAtMs,
    seconds: Math.floor(q.createdAtMs / 1000),
    nanoseconds: 0,
  } as unknown as SaleDoc['createdAt'];

  return {
    id: q.localId,
    invoiceNumber: q.invoiceNumber,
    sellerId: q.sellerId,
    buyerId: q.buyerId,
    buyerName: q.buyerName,
    buyerPhone: q.buyerPhone,
    buyerRole: q.buyerRole,
    saleType: q.saleType,
    paymentMethod: q.paymentMethod,
    discountRate: q.discountRate,
    totalAmount: q.totalAmount,
    paidAmount: q.paidAmount,
    remainingAmount: q.remainingAmount,
    expectedProfit: q.expectedProfit,
    realizedProfit: q.realizedProfit,
    totalCards: q.totalCards,
    deliveredCards: q.deliveredCards,
    returnedCards: 0,
    items: q.items,
    cardNumbers: q.cardNumbers,
    status: q.remainingAmount > 0 ? 'partial' : 'completed',
    notes: q.notes ? `${q.notes} (قيد المزامنة السحابية)` : 'عملية مسجلة دون إنترنت — قيد المزامنة السحابية',
    createdAt: fakeTs,
    updatedAt: fakeTs,
  };
}
