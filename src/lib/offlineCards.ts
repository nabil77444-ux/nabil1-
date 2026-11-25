import { EXCLUSIVE_PACKAGES, type SaleDoc, type SaleLineItem } from '../types/taibah';

export interface CachedAvailableCard {
  id: string;
  packageId: string;
  cardNumber: string;
  ownerId: string;
}

/**
 * Normalize any package identifier or denomination (e.g. `250`, `"250"`, `"pkg_250"`, `"باقة 250"`)
 * into its canonical exclusive package ID (`"pkg_250"`).
 */
export function canonicalPackageId(pkgIdOrPrice: string | number | undefined | null): string {
  if (pkgIdOrPrice === undefined || pkgIdOrPrice === null) return '';
  const raw = String(pkgIdOrPrice).trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const exact = EXCLUSIVE_PACKAGES.find(
    (p) => p.id.toLowerCase() === lower || p.code.toLowerCase() === lower
  );
  if (exact) return exact.id;
  const numeric = Number(raw.replace(/[^\d]/g, ''));
  if (Number.isFinite(numeric) && numeric > 0) {
    const byPrice = EXCLUSIVE_PACKAGES.find((p) => p.price === numeric);
    if (byPrice) return byPrice.id;
  }
  return raw;
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

// Fast in-memory RAM cache per owner so reading/filtering available cards takes <1ms
const memoryCardPoolByOwner = new Map<string, CachedAvailableCard[]>();

export function saveCachedAvailableCards(
  ownerId: string,
  cards: CachedAvailableCard[],
  options?: { allowEmpty?: boolean }
): void {
  if (!ownerId) return;
  const locked = getLocallyLockedCards();
  const seen = new Set<string>();
  const clean: CachedAvailableCard[] = [];
  for (const c of cards) {
    if (!c?.cardNumber || locked.has(c.cardNumber) || seen.has(c.cardNumber)) continue;
    const normPkg = canonicalPackageId(c.packageId);
    if (!normPkg) continue;
    seen.add(c.cardNumber);
    clean.push({
      id: c.id,
      packageId: normPkg,
      cardNumber: c.cardNumber,
      ownerId: c.ownerId || ownerId,
    });
    if (clean.length >= 6000) break;
  }

  // NO EMPTY OVERWRITE GUARD: Never wipe an existing local card pool with an empty array
  // unless the caller explicitly verified an empty server response (`allowEmpty: true`).
  if (clean.length === 0 && !options?.allowEmpty) {
    const existing = getCachedAvailableCards(ownerId);
    if (existing.length > 0) {
      return;
    }
  }

  memoryCardPoolByOwner.set(ownerId, clean);
  try {
    localStorage.setItem(`${CACHED_CARDS_PREFIX}${ownerId}`, JSON.stringify(clean));
  } catch {
    // If quota exceeded, persist top 2,500 while keeping full 6,000 in RAM
    try {
      localStorage.setItem(`${CACHED_CARDS_PREFIX}${ownerId}`, JSON.stringify(clean.slice(0, 2500)));
    } catch {
      // Ignore storage quota errors
    }
  }
}

export function appendCachedAvailableCards(ownerId: string, newCards: CachedAvailableCard[]): void {
  if (!ownerId || newCards.length === 0) return;
  const existing = getCachedAvailableCards(ownerId);
  saveCachedAvailableCards(ownerId, [...newCards, ...existing]);
}

export function getCachedAvailableCards(ownerId: string, packageId?: string): CachedAvailableCard[] {
  if (!ownerId) return [];
  const locked = getLocallyLockedCards();
  let pool = memoryCardPoolByOwner.get(ownerId);

  if (!pool) {
    try {
      const raw = localStorage.getItem(`${CACHED_CARDS_PREFIX}${ownerId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          pool = parsed
            .filter(
              (c): c is CachedAvailableCard =>
                !!c &&
                typeof c.id === 'string' &&
                typeof c.packageId === 'string' &&
                typeof c.cardNumber === 'string'
            )
            .map((c) => ({
              ...c,
              packageId: canonicalPackageId(c.packageId),
            }));
          memoryCardPoolByOwner.set(ownerId, pool);
        }
      }
    } catch {
      pool = [];
    }
  }

  if (!pool || pool.length === 0) return [];
  const targetPkg = packageId ? canonicalPackageId(packageId) : '';
  return pool.filter(
    (c) =>
      !locked.has(c.cardNumber) &&
      (!targetPkg || canonicalPackageId(c.packageId) === targetPkg)
  );
}

/**
 * Retrieve all cached unsold cards matching ANY of the user's owner identifiers
 * (e.g. `uid`, `linkedSourceId`, normalized phone, email), deduplicated by `cardNumber`.
 */
export function getCachedAvailableCardsForOwners(
  ownerIds: string[],
  packageId?: string
): CachedAvailableCard[] {
  const uniqueOwners = Array.from(new Set(ownerIds.map((o) => (o || '').trim()).filter(Boolean)));
  if (uniqueOwners.length === 0) return [];
  const seen = new Set<string>();
  const combined: CachedAvailableCard[] = [];
  for (const oid of uniqueOwners) {
    const list = getCachedAvailableCards(oid, packageId);
    for (const c of list) {
      if (seen.has(c.cardNumber)) continue;
      seen.add(c.cardNumber);
      combined.push(c);
    }
  }
  return combined;
}

export function removeCardsFromCache(ownerId: string, cardNumbers: string[]): void {
  if (!ownerId || cardNumbers.length === 0) return;
  const numSet = new Set(cardNumbers);
  const remaining = getCachedAvailableCards(ownerId).filter((c) => !numSet.has(c.cardNumber));
  memoryCardPoolByOwner.set(ownerId, remaining);
  try {
    localStorage.setItem(`${CACHED_CARDS_PREFIX}${ownerId}`, JSON.stringify(remaining.slice(0, 6000)));
  } catch {
    // Ignore storage errors
  }
}

export function removeCardsFromCacheForOwners(ownerIds: string[], cardNumbers: string[]): void {
  if (cardNumbers.length === 0) return;
  const uniqueOwners = Array.from(new Set(ownerIds.map((o) => (o || '').trim()).filter(Boolean)));
  for (const oid of uniqueOwners) {
    removeCardsFromCache(oid, cardNumbers);
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

export function consumeCachedAvailableCardsForOwners(
  ownerIds: string[],
  packageId: string,
  quantity: number
): CachedAvailableCard[] | null {
  const pool = getCachedAvailableCardsForOwners(ownerIds, packageId);
  if (pool.length < quantity) return null;
  const picked = pool.slice(0, quantity);
  const pickedNums = picked.map((c) => c.cardNumber);
  if (!lockCardsLocally(pickedNums)) {
    return null;
  }
  removeCardsFromCacheForOwners(ownerIds, pickedNums);
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

/**
 * Clears only the local offline sales queue (used during sales-only reset).
 */
export function clearOfflineSalesQueueOnly(): void {
  try {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clears all locally cached card pools, local card locks, and offline sales queue
 * (used during Super Admin full app data reset).
 */
export function clearAllLocalOfflineCardCaches(): void {
  memoryLockedCards.clear();
  memoryCardPoolByOwner.clear();
  try {
    localStorage.removeItem(LOCKED_CARDS_KEY);
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHED_CARDS_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
  } catch {
    // Ignore storage errors
  }
}
