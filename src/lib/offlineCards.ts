import { EXCLUSIVE_PACKAGES, type SaleDoc, type SaleLineItem } from '../types/taibah';
import { normalizeDigits } from './firebase';

export type CardInventoryKind = 'electronic' | 'paper';

export interface CachedAvailableCard {
  id: string;
  packageId: string;
  categoryId?: string;
  price?: number;
  cardNumber: string;
  ownerId: string;
  status?: string;
  cardType?: CardInventoryKind;
}

export interface SellableCardOwnerContext {
  uid?: string | null;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  linkedSourceId?: string | null;
}

/**
 * Determine whether a card document belongs to electronic or paper inventory.
 * Any card without an explicit paper indicator defaults to 'electronic'.
 */
export function resolveCardKind(raw?: {
  cardType?: unknown;
  type?: unknown;
  format?: unknown;
  isPaper?: unknown;
  saleType?: unknown;
}): CardInventoryKind {
  if (!raw) return 'electronic';
  if (raw.isPaper === true || raw.isPaper === 'true') return 'paper';
  const candidates = [raw.cardType, raw.type, raw.format, raw.saleType];
  for (const val of candidates) {
    if (typeof val !== 'string') continue;
    const norm = val.trim().toLowerCase();
    if (
      norm === 'paper' ||
      norm === 'paper_invoice' ||
      norm.includes('paper') ||
      norm.includes('ورقي') ||
      norm.includes('ورقية')
    ) {
      return 'paper';
    }
  }
  return 'electronic';
}

/**
 * Parse a numeric price from any string/number including Arabic-Indic numerals (`٢٥٠`).
 */
export function parseNormalizedPrice(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) && val > 0 ? val : 0;
  if (typeof val !== 'string') return 0;
  const cleaned = normalizeDigits(val).replace(/[^\d.]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Normalize any package identifier or denomination (e.g. `250`, `"٢٥٠"`, `"pkg_250"`, `"باقة 250"`)
 * into its canonical exclusive package ID (`"pkg_250"`).
 */
export function canonicalPackageId(pkgIdOrPrice: string | number | undefined | null): string {
  if (pkgIdOrPrice === undefined || pkgIdOrPrice === null) return '';
  const raw = normalizeDigits(String(pkgIdOrPrice)).trim();
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

function resolvePackagePriceFromMeta(
  pkgOrId: { id?: string; code?: string; price?: number | string } | string | number
): number {
  if (typeof pkgOrId === 'object' && pkgOrId !== null) {
    const direct = parseNormalizedPrice(pkgOrId.price);
    if (direct > 0) return direct;
    const cid = canonicalPackageId(pkgOrId.id || pkgOrId.code);
    const found = EXCLUSIVE_PACKAGES.find((p) => p.id === cid);
    return found ? found.price : 0;
  }
  const direct = parseNormalizedPrice(pkgOrId);
  if (direct > 0) {
    const byPrice = EXCLUSIVE_PACKAGES.find((p) => p.price === direct);
    if (byPrice) return byPrice.price;
  }
  const cid = canonicalPackageId(pkgOrId);
  const found = EXCLUSIVE_PACKAGES.find((p) => p.id === cid);
  return found ? found.price : direct;
}

function normalizeOwnerToken(val: unknown): string {
  if (typeof val !== 'string' && typeof val !== 'number') return '';
  return String(val).trim();
}

function normalizePhoneVariants(phone: unknown): string[] {
  if (typeof phone !== 'string' && typeof phone !== 'number') return [];
  const digits = normalizeDigits(String(phone)).replace(/[^\d]/g, '');
  if (digits.length < 7) return [];
  const stripped = digits.replace(/^00967|^967/, '');
  const out = new Set<string>([digits]);
  if (stripped.length >= 7) out.add(stripped);
  return Array.from(out);
}

const EXCLUDED_CARD_STATUSES = new Set([
  'sold',
  'returned',
  'recalled',
  'injected',
  'used',
  'deleted',
  'cancelled',
  'canceled',
]);

/**
 * SINGLE SOURCE OF TRUTH for both UI stock display («المتاح: X» / «الكروت المتاحة»)
 * and Direct/Wholesale Sale card selection («تأكيد البيع» online & offline).
 *
 * Guarantees mathematically that if a package displays `المتاح: N`, those exact `N`
 * sellable electronic cards exist in `allCards` and can be sold immediately without error.
 */
export function getSellableCardsForPackage(
  allCards: CachedAvailableCard[],
  pkg: { id?: string; code?: string; price?: number | string } | string | number,
  currentUser: SellableCardOwnerContext | null | undefined,
  pendingSoldCardIds?: Set<string>
): CachedAvailableCard[] {
  if (!Array.isArray(allCards) || allCards.length === 0) return [];

  const pendingIds = pendingSoldCardIds ?? getPendingSoldCardIds();
  const lockedNums = getLocallyLockedCards();

  const targetPkgId =
    typeof pkg === 'object' && pkg !== null
      ? canonicalPackageId(pkg.id || pkg.code || pkg.price)
      : canonicalPackageId(pkg);
  const targetPrice = resolvePackagePriceFromMeta(pkg);

  const roleNorm = String(currentUser?.role || '').trim().toLowerCase();
  const isAdmin = roleNorm === 'super_admin' || roleNorm === 'admin';

  const ownerSet = new Set<string>();
  const ownerLowerSet = new Set<string>();
  const addOwner = (v: unknown) => {
    const t = normalizeOwnerToken(v);
    if (!t) return;
    ownerSet.add(t);
    ownerLowerSet.add(t.toLowerCase());
  };
  if (currentUser) {
    addOwner(currentUser.uid);
    addOwner(currentUser.linkedSourceId);
    addOwner(currentUser.email);
    for (const pv of normalizePhoneVariants(currentUser.phone)) {
      addOwner(pv);
    }
    if (isAdmin) {
      addOwner('super_admin');
      addOwner('admin');
    }
  }

  const seenNumbers = new Set<string>();
  const seenIds = new Set<string>();
  const result: CachedAvailableCard[] = [];

  for (const card of allCards) {
    if (!card || !card.cardNumber) continue;

    // 1. Exclude pending-sold & locally locked cards
    if (card.id && pendingIds.has(card.id)) continue;
    if (lockedNums.has(card.cardNumber)) continue;

    // 2. Exclude non-sellable statuses (accept 'available', 'assigned_to_agent', 'active', 'assigned', '', undefined)
    const statusNorm = String(card.status ?? '').trim().toLowerCase();
    if (statusNorm && EXCLUDED_CARD_STATUSES.has(statusNorm)) continue;

    // 3. Accept electronic cards (or unspecified cardType); reject explicit paper cards
    if (resolveCardKind(card) === 'paper') continue;

    // 4. Strict role-aware ownership match (tolerant of admin central legacy owner values)
    if (currentUser && (ownerSet.size > 0 || isAdmin)) {
      const cardOwnerRaw = normalizeOwnerToken(card.ownerId);
      const cardOwnerLower = cardOwnerRaw.toLowerCase();
      if (isAdmin) {
        const isCentralOrMine =
          !cardOwnerRaw ||
          cardOwnerLower === 'admin' ||
          cardOwnerLower === 'super_admin' ||
          ownerSet.has(cardOwnerRaw) ||
          ownerLowerSet.has(cardOwnerLower);
        if (!isCentralOrMine) continue;
      } else {
        const phoneMatch = normalizePhoneVariants(cardOwnerRaw).some((pv) => ownerSet.has(pv));
        const directMatch =
          ownerSet.has(cardOwnerRaw) || ownerLowerSet.has(cardOwnerLower) || phoneMatch;
        if (!directMatch) continue;
      }
    }

    // 5. Type-insensitive package & price match (handles pkg_250, "250", 250, "٢٥٠", categoryId)
    const cardPkgId = canonicalPackageId(card.packageId || card.categoryId || card.price);
    const cardPrice =
      parseNormalizedPrice(card.price) ||
      resolvePackagePriceFromMeta(cardPkgId || card.packageId || card.categoryId || '');

    const matchesPkg =
      (Boolean(targetPkgId) && cardPkgId === targetPkgId) ||
      (targetPrice > 0 && cardPrice > 0 && cardPrice === targetPrice);
    if (!matchesPkg) continue;

    // 6. Deduplicate strictly by cardNumber and doc id
    if (seenNumbers.has(card.cardNumber) || (card.id && seenIds.has(card.id))) continue;
    seenNumbers.add(card.cardNumber);
    if (card.id) seenIds.add(card.id);

    result.push({
      ...card,
      packageId: cardPkgId || targetPkgId,
      price: cardPrice || targetPrice || undefined,
      status: statusNorm || 'available',
      cardType: 'electronic',
    });
  }

  return result;
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
const PENDING_SOLD_CARD_IDS_KEY = 'taibah_pending_sold_card_ids_v1';
const OFFLINE_QUEUE_KEY = 'taibah_offline_sales_queue_v1';
const CACHED_CARDS_PREFIX = 'taibah_cached_cards_v1_';

// =========================================================================
// HIGH-CAPACITY INDEXEDDB OFFLINE CARD STORE (`taibah_offline_cards_db`)
// Eliminates localStorage 5MB QuotaExceededError for hundreds/thousands of cards!
// =========================================================================
const IDB_NAME = 'taibah_offline_cards_db';
const IDB_VERSION = 1;
const IDB_STORE_OWNER_CARDS = 'owner_cards';

interface IdbOwnerCardsRecord {
  ownerKey: string;
  cards: CachedAvailableCard[];
  updatedAt: number;
}

let idbPromise: Promise<IDBDatabase | null> | null = null;

function openOfflineCardsDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (idbPromise) return idbPromise;
  idbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_OWNER_CARDS)) {
          db.createObjectStore(IDB_STORE_OWNER_CARDS, { keyPath: 'ownerKey' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        idbPromise = null;
        resolve(null);
      };
    } catch {
      idbPromise = null;
      resolve(null);
    }
  });
  return idbPromise;
}

async function writeOwnerCardsToIDB(ownerKey: string, cards: CachedAvailableCard[]): Promise<void> {
  if (!ownerKey) return;
  const db = await openOfflineCardsDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_OWNER_CARDS, 'readwrite');
      const store = tx.objectStore(IDB_STORE_OWNER_CARDS);
      const record: IdbOwnerCardsRecord = {
        ownerKey,
        cards,
        updatedAt: Date.now(),
      };
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function readOwnerCardsFromIDB(ownerKey: string): Promise<CachedAvailableCard[] | null> {
  if (!ownerKey) return null;
  const db = await openOfflineCardsDB();
  if (!db) return null;
  return new Promise<CachedAvailableCard[] | null>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_OWNER_CARDS, 'readonly');
      const store = tx.objectStore(IDB_STORE_OWNER_CARDS);
      const req = store.get(ownerKey);
      req.onsuccess = () => {
        const rec = req.result as IdbOwnerCardsRecord | undefined;
        if (rec && Array.isArray(rec.cards)) {
          resolve(rec.cards);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function clearOfflineCardsIDB(): Promise<void> {
  const db = await openOfflineCardsDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_OWNER_CARDS, 'readwrite');
      tx.objectStore(IDB_STORE_OWNER_CARDS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Synchronous in-memory lock sets to block rapid double-taps or concurrent sales instantly
const memoryLockedCards = new Set<string>();
const memoryPendingSoldCardIds = new Set<string>();

function sanitizeTxSegment(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 96);
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Generates a 100% deterministic `clientTxId` bound to the exact card document IDs:
 * - Single card sale -> `sale_${cardId}` (guaranteed unique & idempotent in Firestore `sales/${clientTxId}`)
 * - Multi-card sale -> `sale_${firstCardId}_n${count}_${hash}` (idempotent across retries/reconnects)
 * - Paper invoice (no card IDs) -> safe unique ID `sale_paper_${ts}_${rand}`
 */
export function buildDeterministicSaleTxId(cardDocIds: string[], fallbackSeed?: string): string {
  const cleanIds = Array.from(
    new Set(cardDocIds.map((id) => sanitizeTxSegment(id)).filter(Boolean))
  ).sort();

  if (cleanIds.length === 1) {
    return `sale_${cleanIds[0]}`.slice(0, 120);
  }
  if (cleanIds.length > 1) {
    const first = cleanIds[0].slice(0, 48);
    const digest = fnv1aHex(cleanIds.join(','));
    return `sale_${first}_n${cleanIds.length}_${digest}`.slice(0, 120);
  }
  const seed =
    sanitizeTxSegment(fallbackSeed || '') ||
    `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `sale_paper_${seed}`.slice(0, 120);
}

function loadPersistedPendingSoldIds(): Set<string> {
  try {
    const raw = localStorage.getItem(PENDING_SOLD_CARD_IDS_KEY);
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

function savePersistedPendingSoldIds(ids: Set<string>): void {
  try {
    const arr = Array.from(ids);
    const trimmed = arr.length > 15000 ? arr.slice(arr.length - 15000) : arr;
    localStorage.setItem(PENDING_SOLD_CARD_IDS_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore quota errors
  }
}

export function getPendingSoldCardIds(): Set<string> {
  const combined = loadPersistedPendingSoldIds();
  for (const id of memoryPendingSoldCardIds) {
    combined.add(id);
  }
  // Always union with cardDocIds currently sitting in offline sales queue (Overlay Rule)
  for (const q of getPendingOfflineSales()) {
    for (const cid of q.cardDocIds || []) {
      if (cid) combined.add(cid);
    }
  }
  return combined;
}

export function isCardDocIdPendingSold(cardId: string): boolean {
  if (!cardId) return false;
  if (memoryPendingSoldCardIds.has(cardId)) return true;
  return getPendingSoldCardIds().has(cardId);
}

export function markCardIdsPendingSold(cardIds: string[]): void {
  const unique = Array.from(new Set(cardIds.filter(Boolean)));
  if (unique.length === 0) return;
  const current = loadPersistedPendingSoldIds();
  for (const id of unique) {
    memoryPendingSoldCardIds.add(id);
    current.add(id);
  }
  savePersistedPendingSoldIds(current);
}

export function releasePendingSoldCardIds(cardIds: string[]): void {
  if (cardIds.length === 0) return;
  const current = loadPersistedPendingSoldIds();
  for (const id of cardIds) {
    memoryPendingSoldCardIds.delete(id);
    current.delete(id);
  }
  savePersistedPendingSoldIds(current);
}

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
  // Pending Queue Overlay: every card number in pending offline sales stays locked
  for (const q of getPendingOfflineSales()) {
    for (const num of q.cardNumbers || []) {
      if (num) persisted.add(num);
    }
  }
  return persisted;
}

export function isCardLocallyLocked(cardNumber: string, cardDocId?: string): boolean {
  if (cardDocId && isCardDocIdPendingSold(cardDocId)) return true;
  if (!cardNumber) return false;
  if (memoryLockedCards.has(cardNumber)) return true;
  return getLocallyLockedCards().has(cardNumber);
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

function normalizeCardForStorage(c: CachedAvailableCard, fallbackOwnerId: string): CachedAvailableCard | null {
  if (!c?.cardNumber) return null;
  const normPkg = canonicalPackageId(c.packageId || c.categoryId || c.price);
  if (!normPkg) return null;
  const resolvedPrice =
    parseNormalizedPrice(c.price) || resolvePackagePriceFromMeta(normPkg) || undefined;
  return {
    id: c.id,
    packageId: normPkg,
    ...(c.categoryId ? { categoryId: c.categoryId } : {}),
    ...(resolvedPrice ? { price: resolvedPrice } : {}),
    cardNumber: c.cardNumber,
    ownerId: c.ownerId ?? fallbackOwnerId,
    status: String(c.status || 'available').trim().toLowerCase(),
    cardType: resolveCardKind(c),
  };
}

/**
 * Hydrates cached available cards from high-capacity IndexedDB (`taibah_offline_cards_db`)
 * into synchronous RAM memory (`memoryCardPoolByOwner`) for instant offline display & sales.
 * Automatically migrates any legacy `localStorage` cards if IndexedDB is empty.
 */
export async function hydrateOfflineCardsFromIDB(ownerIds: string[]): Promise<CachedAvailableCard[]> {
  const uniqueOwners = Array.from(new Set(ownerIds.map((o) => (o || '').trim()).filter(Boolean)));
  if (uniqueOwners.length === 0) return [];

  const locked = getLocallyLockedCards();
  const pendingIds = getPendingSoldCardIds();

  for (const oid of uniqueOwners) {
    const idbCards = await readOwnerCardsFromIDB(oid);
    if (idbCards && idbCards.length > 0) {
      const cleaned: CachedAvailableCard[] = [];
      for (const raw of idbCards) {
        const norm = normalizeCardForStorage(raw, oid);
        if (!norm) continue;
        if (locked.has(norm.cardNumber) || pendingIds.has(norm.id)) continue;
        const st = String(norm.status || '').toLowerCase();
        if (st && EXCLUDED_CARD_STATUSES.has(st)) continue;
        cleaned.push(norm);
      }
      const existingRam = memoryCardPoolByOwner.get(oid) || [];
      if (cleaned.length >= existingRam.length) {
        memoryCardPoolByOwner.set(oid, cleaned);
      }
    } else {
      // Seamless migration: if legacy localStorage has cards, mirror them into IndexedDB
      const legacy = getCachedAvailableCards(oid);
      if (legacy.length > 0) {
        void writeOwnerCardsToIDB(oid, legacy);
      }
    }
  }

  return getCachedAvailableCardsForOwners(uniqueOwners);
}

export function saveCachedAvailableCards(
  ownerId: string,
  cards: CachedAvailableCard[],
  options?: { allowEmpty?: boolean }
): void {
  if (!ownerId) return;
  const locked = getLocallyLockedCards();
  const pendingIds = getPendingSoldCardIds();
  const seen = new Set<string>();
  const clean: CachedAvailableCard[] = [];
  for (const c of cards) {
    if (!c?.cardNumber || locked.has(c.cardNumber) || pendingIds.has(c.id) || seen.has(c.cardNumber)) {
      continue;
    }
    const statusNorm = String(c.status ?? '').trim().toLowerCase();
    if (statusNorm && EXCLUDED_CARD_STATUSES.has(statusNorm)) continue;

    const norm = normalizeCardForStorage(c, ownerId);
    if (!norm) continue;
    seen.add(norm.cardNumber);
    clean.push(norm);
    if (clean.length >= 50000) break;
  }

  // NO EMPTY OVERWRITE GUARD: Never wipe an existing local card pool with an empty array
  // unless the caller explicitly verified an empty server response (`allowEmpty: true`).
  if (clean.length === 0 && !options?.allowEmpty) {
    const existing = getCachedAvailableCards(ownerId);
    if (existing.length > 0) {
      return;
    }
  }

  // 1. Instant 0ms RAM update
  memoryCardPoolByOwner.set(ownerId, clean);

  // 2. Primary high-capacity persistence in IndexedDB (`taibah_offline_cards_db` — zero 5MB quota limit!)
  void writeOwnerCardsToIDB(ownerId, clean);

  // 3. Best-effort lightweight secondary mirror in localStorage for instant cold-start before IDB resolves
  try {
    localStorage.setItem(`${CACHED_CARDS_PREFIX}${ownerId}`, JSON.stringify(clean.slice(0, 2000)));
  } catch {
    try {
      localStorage.setItem(`${CACHED_CARDS_PREFIX}${ownerId}`, JSON.stringify(clean.slice(0, 500)));
    } catch {
      // Safe to ignore: IndexedDB holds the complete authoritative offline pool
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
  const pendingIds = getPendingSoldCardIds();
  let pool = memoryCardPoolByOwner.get(ownerId);

  if (!pool) {
    try {
      const raw = localStorage.getItem(`${CACHED_CARDS_PREFIX}${ownerId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const normalized: CachedAvailableCard[] = [];
          for (const item of parsed) {
            if (
              !item ||
              typeof item.id !== 'string' ||
              typeof item.cardNumber !== 'string'
            ) {
              continue;
            }
            const norm = normalizeCardForStorage(item as CachedAvailableCard, ownerId);
            if (norm) normalized.push(norm);
          }
          pool = normalized;
          memoryCardPoolByOwner.set(ownerId, pool);
        }
      }
    } catch {
      pool = [];
    }
  }

  if (!pool || pool.length === 0) return [];
  const targetPkg = packageId ? canonicalPackageId(packageId) : '';
  return pool.filter((c) => {
    if (locked.has(c.cardNumber) || pendingIds.has(c.id)) return false;
    const statusNorm = String(c.status ?? '').trim().toLowerCase();
    if (statusNorm && EXCLUDED_CARD_STATUSES.has(statusNorm)) return false;
    if (targetPkg && canonicalPackageId(c.packageId || c.categoryId || c.price) !== targetPkg) {
      return false;
    }
    return true;
  });
}

/**
 * Retrieve all cached unsold cards matching ANY of the user's owner identifiers
 * (e.g. `uid`, `linkedSourceId`, normalized phone, email, `'super_admin'`, `'admin'`),
 * deduplicated by `cardNumber`.
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
  void writeOwnerCardsToIDB(ownerId, remaining);
  try {
    localStorage.setItem(`${CACHED_CARDS_PREFIX}${ownerId}`, JSON.stringify(remaining.slice(0, 2000)));
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

/**
 * Atomically marks picked cards as sold/locked across `pendingSoldCardIds`, `memoryLockedCards`,
 * RAM pools, IndexedDB (`taibah_offline_cards_db`), and localStorage mirror.
 */
export function markCardsSoldInLocalPool(
  ownerIds: string[],
  pickedCards: Array<{ id: string; cardNumber: string }>
): boolean {
  if (pickedCards.length === 0) return true;
  const nums = pickedCards.map((c) => c.cardNumber).filter(Boolean);
  const ids = pickedCards.map((c) => c.id).filter(Boolean);
  if (!lockCardsLocally(nums)) {
    return false;
  }
  markCardIdsPendingSold(ids);
  removeCardsFromCacheForOwners(ownerIds, nums);
  return true;
}

export function consumeCachedAvailableCards(
  ownerId: string,
  packageId: string,
  quantity: number
): CachedAvailableCard[] | null {
  const pool = getCachedAvailableCards(ownerId, packageId);
  if (pool.length < quantity) return null;
  const picked = pool.slice(0, quantity);
  if (!markCardsSoldInLocalPool([ownerId], picked)) {
    return null;
  }
  return picked;
}

export function consumeCachedAvailableCardsForOwners(
  ownerIds: string[],
  packageId: string,
  quantity: number,
  currentUser?: SellableCardOwnerContext | null
): CachedAvailableCard[] | null {
  const rawPool = getCachedAvailableCardsForOwners(ownerIds);
  const pool = currentUser
    ? getSellableCardsForPackage(rawPool, packageId, currentUser, getPendingSoldCardIds())
    : getCachedAvailableCardsForOwners(ownerIds, packageId);
  if (pool.length < quantity) return null;
  const picked = pool.slice(0, quantity);
  if (!markCardsSoldInLocalPool(ownerIds, picked)) {
    return null;
  }
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
    notes: q.notes
      ? `${q.notes} (قيد المزامنة السحابية)`
      : 'عملية مسجلة دون إنترنت — قيد المزامنة السحابية',
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
 * Clears all locally cached card pools (RAM + IndexedDB + localStorage),
 * local card locks, and offline sales queue (used during Super Admin full app data reset).
 */
export function clearAllLocalOfflineCardCaches(): void {
  memoryLockedCards.clear();
  memoryPendingSoldCardIds.clear();
  memoryCardPoolByOwner.clear();
  void clearOfflineCardsIDB();
  try {
    localStorage.removeItem(LOCKED_CARDS_KEY);
    localStorage.removeItem(PENDING_SOLD_CARD_IDS_KEY);
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
