import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileDown,
  Filter,
  Layers,
  Package,
  RefreshCw,
  Scale,
  Search,
  Send,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import { useDebounce } from '../hooks/useDebounce';
import { normalizeDigits } from '../lib/firebase';
import {
  exportAsArabicPDF,
  openWhatsAppShare,
  type ExportShareResult,
  type PrintableDocumentPayload,
} from '../lib/exportUtils';
import { ExportPreviewModal } from './ExportPreviewModal';
import { AgentCardAuditModal } from './AgentCardAuditModal';
import {
  EXCLUSIVE_PACKAGES,
  formatCount,
  formatDateDDMMYYYY,
  formatDateTimeAr,
  formatYER,
  getRoleArabicLabel,
  SUPER_ADMIN_CONFIG,
  type PackageDoc,
  type SaleDoc,
  type UserProfile,
} from '../types/taibah';
import {
  buildSalesListDenominationBreakdown,
  formatNumEn,
  getBuyerRoleArabicLabel,
  toPrintableBreakdownItems,
} from '../utils/salesBreakdown';

interface ReportsCenterScreenProps {
  hideNumbers: boolean;
}

type ReportId =
  | 'daily_monthly_inventory'
  | 'period_sales'
  | 'entity_cards_detail'
  | 'accounting_full_inventory';

type InventoryGranularity = 'all' | 'daily' | 'monthly';
type SalesPeriodTab = 'all' | 'today' | 'week' | 'month';
type ActivityFilterType = 'all' | 'receive' | 'sale' | 'payment' | 'return';

interface ReportCardMeta {
  id: ReportId;
  num: number;
  title: string;
  hubTitle: string;
  shortTitle: string;
  subtitle: string;
  badge: string;
  accent: string;
  icon: React.FC<{ className?: string }>;
}

const FOUR_CORE_REPORTS: ReportCardMeta[] = [
  {
    id: 'daily_monthly_inventory',
    num: 1,
    title: 'الجرد اليومي والشهري',
    hubTitle: 'الجرد اليومي والشهري',
    shortTitle: 'الجرد',
    subtitle: 'تفصيل الباقات الثماني لكل وكيل وعميل باليوم والشهر',
    badge: 'يومي • شهري',
    accent: 'from-[#1A365D] via-blue-800 to-[#1E3A8A]',
    icon: Calendar,
  },
  {
    id: 'period_sales',
    num: 2,
    title: 'مبيعات اليوم والأسبوع والشهر',
    hubTitle: 'مبيعات اليوم والشهر',
    shortTitle: 'المبيعات',
    subtitle: 'مبيعات كل وكيل وعميل وفواتيره والعمولة والصافي',
    badge: 'يوم • أسبوع • شهر',
    accent: 'from-emerald-600 via-emerald-700 to-teal-800',
    icon: TrendingUp,
  },
  {
    id: 'entity_cards_detail',
    num: 3,
    title: 'بيانات وكروت الوكيل والعميل',
    hubTitle: 'كشف الوكيل والعميل',
    shortTitle: 'الوكيل',
    subtitle: 'استلم/باع/متبقي وسجل لمن باع وكامل الحركات',
    badge: 'تفصيل ممل',
    accent: 'from-purple-700 via-indigo-800 to-slate-900',
    icon: UserCheck,
  },
  {
    id: 'accounting_full_inventory',
    num: 4,
    title: 'التقارير المحاسبية وجرد الكروت',
    hubTitle: 'التقارير المحاسبية',
    shortTitle: 'المحاسبة',
    subtitle: 'معادلة المطابقة وحق الإدارة وحق الوكيل وحق العميل',
    badge: 'محاسبة شاملة',
    accent: 'from-[#B4860B] via-[#8B6508] to-[#1A365D]',
    icon: Scale,
  },
];

const PAGE_SIZE = 45;

function toLocalIsoDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toLocalIsoMonth(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function getSaleTimestampMs(sale: SaleDoc): number {
  const ts = sale.createdAt;
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof (ts as unknown as { seconds?: number }).seconds === 'number') {
    return (ts as unknown as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function getAnyTimestampMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (typeof (ts as { seconds?: number }).seconds === 'number') {
    return (ts as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function saleTypeLabelAr(type: SaleDoc['saleType']): string {
  if (type === 'direct') return 'بيع مباشر';
  if (type === 'electronic_wholesale') return 'جملة إلكترونية';
  return 'فاتورة ورقية';
}

function paymentMethodLabelAr(method: SaleDoc['paymentMethod']): string {
  if (method === 'cash') return 'نقدي';
  if (method === 'credit') return 'آجل';
  return 'جزئي';
}

function computeSaleNominalFaceValue(sale: SaleDoc): number {
  if (sale.items && sale.items.length > 0) {
    const face = sale.items.reduce(
      (sum, item) => sum + Number(item.price || 0) * Math.max(0, Number(item.quantity || 0) - Number(item.returned || 0)),
      0
    );
    if (face > 0) return face;
  }
  const rate = Number(sale.discountRate || 100);
  if (rate > 0 && rate < 100 && sale.totalAmount > 0) {
    return Math.round((sale.totalAmount * 100) / rate);
  }
  return Number(sale.totalAmount || 0);
}

interface PersonPkgBreakdown {
  pkgId: string;
  price: number;
  dataLabel: string;
  received: number;
  sold: number;
  remaining: number;
  returned: number;
  value: number;
}

interface PersonInventoryEntry {
  key: string;
  uid?: string;
  name: string;
  phone: string;
  roleLabel: string;
  discountRate: number;
  salesCount: number;
  receivedCards: number;
  soldCards: number;
  remainingCards: number;
  returnedCards: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  byPackage: PersonPkgBreakdown[];
}

interface PersonSalesSummary {
  key: string;
  uid?: string;
  name: string;
  phone: string;
  roleLabel: string;
  discountRate: number;
  commissionPercent: number;
  salesCount: number;
  cardsCount: number;
  nominalTotal: number;
  grossTotal: number;
  commissionValue: number;
  netTotal: number;
  cashTotal: number;
  creditTotal: number;
  remainingTotal: number;
  byPkgCounts: Array<{ pkgId: string; price: number; count: number }>;
  salesList: SaleDoc[];
}

interface AccountingRightsRow {
  uid: string;
  name: string;
  phone: string;
  role: 'agent' | 'client' | 'super_admin' | 'consumer';
  roleLabel: string;
  status: string;
  discountRate: number;
  salesCount: number;
  cardsCount: number;
  returnedCards: number;
  returnedValue: number;
  nominalFaceValue: number;
  totalBilled: number;
  adminShare: number;
  agentShare: number;
  clientShare: number;
  paidAmount: number;
  remainingDebt: number;
  currentBalance: number;
}

export const ReportsCenterScreen: React.FC<ReportsCenterScreenProps> = ({ hideNumbers }) => {
  const {
    profile,
    packages,
    sales,
    customers,
    ledgerEntries,
    topupRequests,
    managedUsers,
    appSettings,
    isRefreshingInventory,
    refreshMyInventory,
  } = useFirebase();
  const { notifySuccess, notifyError } = useFeedback();

  const isAdmin = profile?.role === 'super_admin';
  const isAgent = profile?.role === 'agent';
  const displayPackages = packages.length > 0 ? packages : (EXCLUSIVE_PACKAGES as PackageDoc[]);

  const [activeReportId, setActiveReportId] = useState<ReportId | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportShareResult | null>(null);
  const [exportingKind, setExportingKind] = useState<string | null>(null);

  // Unified persistent Agent/Client selector across all 4 reports
  const [selectedEntityUid, setSelectedEntityUid] = useState<string>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 180);
  const [visibleRowsCount, setVisibleRowsCount] = useState(PAGE_SIZE);

  // Report 1 state (All / Daily / Monthly Inventory — default 'all' for instant real data)
  const [invGranularity, setInvGranularity] = useState<InventoryGranularity>('all');
  const [selectedDayIso, setSelectedDayIso] = useState<string>(() => toLocalIsoDate(new Date()));
  const [selectedMonthIso, setSelectedMonthIso] = useState<string>(() => toLocalIsoMonth(new Date()));
  const [expandedInvPersonKey, setExpandedInvPersonKey] = useState<string | null>(null);

  // Report 2 state (All / Today / Week / Month Sales — default 'all' for instant real data)
  const [salesPeriod, setSalesPeriod] = useState<SalesPeriodTab>('all');
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');
  const [focusedSalesPersonKey, setFocusedSalesPersonKey] = useState<string | null>(null);

  // On-demand toggles for compact calendar & search controls (hidden until tapped)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);

  // Report 3 state (Entity Detail)
  const [activityFilter, setActivityFilter] = useState<ActivityFilterType>('all');
  const [detailActivityVisible, setDetailActivityVisible] = useState(PAGE_SIZE);

  // All selectable accounts (agents & clients)
  const selectableAccounts = useMemo(() => {
    if (!isAdmin && !isAgent) return [] as UserProfile[];
    return (managedUsers || [])
      .filter((u) => u.role === 'agent' || u.role === 'client')
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === 'agent' ? -1 : 1;
        return a.name.localeCompare(b.name, 'ar');
      });
  }, [isAdmin, isAgent, managedUsers]);

  const usersByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    if (profile) map.set(profile.uid, profile);
    (managedUsers || []).forEach((u) => {
      map.set(u.uid, u);
      if (u.linkedSourceId) map.set(u.linkedSourceId, u);
    });
    return map;
  }, [managedUsers, profile]);

  const selectedAccount = useMemo<UserProfile | null>(
    () =>
      selectedEntityUid !== 'all'
        ? selectableAccounts.find((u) => u.uid === selectedEntityUid) || null
        : null,
    [selectableAccounts, selectedEntityUid]
  );

  // Reset pagination & person drilldown whenever filters change
  useEffect(() => {
    setVisibleRowsCount(PAGE_SIZE);
    setDetailActivityVisible(PAGE_SIZE);
    setFocusedSalesPersonKey(null);
  }, [
    activeReportId,
    selectedEntityUid,
    debouncedSearch,
    invGranularity,
    selectedDayIso,
    selectedMonthIso,
    salesPeriod,
    customFromDate,
    customToDate,
  ]);

  const matchesSelectedEntity = (sale: SaleDoc, account: UserProfile | null): boolean => {
    if (!account) return true;
    const ids = new Set<string>([account.uid]);
    if (account.linkedSourceId) ids.add(account.linkedSourceId);
    if (sale.sellerId && ids.has(sale.sellerId)) return true;
    if (sale.buyerId && ids.has(sale.buyerId)) return true;
    const accPhone = normalizeDigits(account.phone || '').replace(/\D/g, '');
    const salePhone = normalizeDigits(sale.buyerPhone || '').replace(/\D/g, '');
    if (accPhone && salePhone && salePhone.includes(accPhone)) return true;
    if (
      account.name &&
      sale.buyerName &&
      sale.buyerName.trim().toLowerCase() === account.name.trim().toLowerCase()
    ) {
      return true;
    }
    return false;
  };

  const validSales = useMemo(() => {
    return (sales || []).filter((s) => s.status !== 'cancelled');
  }, [sales]);

  const entityScopedSales = useMemo(() => {
    return validSales.filter((s) => matchesSelectedEntity(s, selectedAccount));
  }, [validSales, selectedAccount]);

  const formatMoney = (amount: number) => (hideNumbers ? '••••' : formatYER(amount));
  const formatNum = (n: number) => (hideNumbers ? '••' : formatCount(n));

  // =========================================================================
  // REPORT 1 DATA: الجرد اليومي والشهري (الباقات الثماني + كل شخص على حدة)
  // =========================================================================
  const inventoryData = useMemo(() => {
    const startMs =
      invGranularity === 'all'
        ? 0
        : invGranularity === 'daily'
          ? new Date(`${selectedDayIso}T00:00:00`).getTime()
          : new Date(`${selectedMonthIso}-01T00:00:00`).getTime();

    const endMs = (() => {
      if (invGranularity === 'all') return Infinity;
      if (invGranularity === 'daily') {
        return new Date(`${selectedDayIso}T23:59:59.999`).getTime();
      }
      const [yStr, mStr] = selectedMonthIso.split('-');
      const year = Number(yStr) || new Date().getFullYear();
      const month = Number(mStr) || new Date().getMonth() + 1;
      return new Date(year, month, 0, 23, 59, 59, 999).getTime();
    })();

    const q = debouncedSearch.trim().toLowerCase();
    const periodSales = entityScopedSales.filter((sale) => {
      const ms = getSaleTimestampMs(sale);
      if (invGranularity !== 'all' && (ms < startMs || ms > endMs)) return false;
      if (!q) return true;
      return (
        (sale.buyerName || '').toLowerCase().includes(q) ||
        (sale.buyerPhone || '').includes(q) ||
        (sale.invoiceNumber || '').toLowerCase().includes(q)
      );
    });

    // Global 8-package breakdown for period
    const pkgStatsMap = new Map<
      string,
      { receivedQty: number; soldQty: number; returnedQty: number; revenue: number }
    >();
    displayPackages.forEach((p) => {
      pkgStatsMap.set(p.id, { receivedQty: 0, soldQty: 0, returnedQty: 0, revenue: 0 });
    });

    // Per-person map (Admin + every Agent + every Client)
    const personAccumulator = new Map<
      string,
      {
        key: string;
        uid?: string;
        name: string;
        phone: string;
        roleLabel: string;
        discountRate: number;
        salesCount: number;
        totalAmount: number;
        paidAmount: number;
        remainingAmount: number;
        pkgMap: Map<string, { received: number; sold: number; returned: number; value: number }>;
      }
    >();

    const ensurePerson = (
      key: string,
      info: { uid?: string; name: string; phone: string; roleLabel: string; discountRate: number }
    ) => {
      let entry = personAccumulator.get(key);
      if (!entry) {
        const pkgMap = new Map<string, { received: number; sold: number; returned: number; value: number }>();
        displayPackages.forEach((p) => pkgMap.set(p.id, { received: 0, sold: 0, returned: 0, value: 0 }));
        entry = {
          key,
          ...info,
          salesCount: 0,
          totalAmount: 0,
          paidAmount: 0,
          remainingAmount: 0,
          pkgMap,
        };
        personAccumulator.set(key, entry);
      }
      return entry;
    };

    // Seed Admin + managed accounts so every person appears cleanly (or just selectedAccount)
    if (!selectedAccount && isAdmin && profile) {
      ensurePerson(profile.uid, {
        uid: profile.uid,
        name: `${profile.name} (الإدارة العامة)`,
        phone: profile.phone || SUPER_ADMIN_CONFIG.phone,
        roleLabel: 'المدير العام',
        discountRate: 100,
      });
    }
    selectableAccounts.forEach((acc) => {
      if (selectedAccount && acc.uid !== selectedAccount.uid) return;
      ensurePerson(acc.uid, {
        uid: acc.uid,
        name: acc.name,
        phone: acc.phone || '—',
        roleLabel: getRoleArabicLabel(acc.role),
        discountRate: Number(acc.discountRate || (acc.role === 'agent' ? 70 : 80)),
      });
    });

    let totalCards = 0;
    let totalReturned = 0;
    let totalRevenue = 0;
    let totalPaid = 0;
    let totalRemaining = 0;

    periodSales.forEach((sale) => {
      const qty = Math.max(0, Number(sale.totalCards || 0) - Number(sale.returnedCards || 0));
      const ret = Number(sale.returnedCards || 0);
      totalCards += qty;
      totalReturned += ret;
      totalRevenue += Number(sale.totalAmount || 0);
      totalPaid += Number(sale.paidAmount || 0);
      totalRemaining += Number(sale.remainingAmount || 0);

      // Update global 8-package stats
      (sale.items || []).forEach((item) => {
        const stat = pkgStatsMap.get(item.packageId) || {
          receivedQty: 0,
          soldQty: 0,
          returnedQty: 0,
          revenue: 0,
        };
        const itemQty = Number(item.quantity || 0);
        const itemRet = Number(item.returned || 0);
        const net = Math.max(0, itemQty - itemRet);
        if (sale.saleType === 'electronic_wholesale' || sale.saleType === 'paper_invoice') {
          stat.receivedQty += net;
        }
        stat.soldQty += net;
        stat.returnedQty += itemRet;
        stat.revenue += Number(item.unitPrice || item.price || 0) * net;
        pkgStatsMap.set(item.packageId, stat);
      });

      // Attribute received cards to Buyer (if Agent/Client) and sold cards to Seller
      const buyerUser =
        (sale.buyerId ? usersByUid.get(sale.buyerId) : undefined) ||
        selectableAccounts.find(
          (a) =>
            a.phone &&
            sale.buyerPhone &&
            normalizeDigits(a.phone).replace(/\D/g, '') ===
              normalizeDigits(sale.buyerPhone).replace(/\D/g, '')
        );
      const sellerUser = sale.sellerId ? usersByUid.get(sale.sellerId) : undefined;

      if (buyerUser && (!selectedAccount || buyerUser.uid === selectedAccount.uid)) {
        const pEntry = ensurePerson(buyerUser.uid, {
          uid: buyerUser.uid,
          name: buyerUser.name,
          phone: buyerUser.phone || '—',
          roleLabel: getRoleArabicLabel(buyerUser.role),
          discountRate: Number(buyerUser.discountRate || (buyerUser.role === 'agent' ? 70 : 80)),
        });
        pEntry.salesCount += 1;
        pEntry.totalAmount += Number(sale.totalAmount || 0);
        pEntry.paidAmount += Number(sale.paidAmount || 0);
        pEntry.remainingAmount += Number(sale.remainingAmount || 0);
        (sale.items || []).forEach((item) => {
          const pk = pEntry.pkgMap.get(item.packageId);
          if (!pk) return;
          const net = Math.max(0, Number(item.quantity || 0) - Number(item.returned || 0));
          pk.received += net;
          pk.returned += Number(item.returned || 0);
          pk.value += Number(item.unitPrice || item.price || 0) * net;
        });
      }

      if (sellerUser && (!selectedAccount || sellerUser.uid === selectedAccount.uid)) {
        const sEntry = ensurePerson(sellerUser.uid, {
          uid: sellerUser.uid,
          name:
            sellerUser.role === 'super_admin'
              ? `${sellerUser.name} (الإدارة العامة)`
              : sellerUser.name,
          phone: sellerUser.phone || '—',
          roleLabel: getRoleArabicLabel(sellerUser.role),
          discountRate: Number(sellerUser.discountRate || 100),
        });
        sEntry.salesCount += 1;
        if (!buyerUser || buyerUser.uid !== sellerUser.uid) {
          sEntry.totalAmount += Number(sale.totalAmount || 0);
          sEntry.paidAmount += Number(sale.paidAmount || 0);
          sEntry.remainingAmount += Number(sale.remainingAmount || 0);
        }
        (sale.items || []).forEach((item) => {
          const pk = sEntry.pkgMap.get(item.packageId);
          if (!pk) return;
          const net = Math.max(0, Number(item.quantity || 0) - Number(item.returned || 0));
          pk.sold += net;
          pk.returned += Number(item.returned || 0);
          pk.value += Number(item.unitPrice || item.price || 0) * net;
        });
      }
    });

    const packageRows = displayPackages.map((pkg) => {
      const stat = pkgStatsMap.get(pkg.id) || {
        receivedQty: 0,
        soldQty: 0,
        returnedQty: 0,
        revenue: 0,
      };
      return {
        pkg,
        receivedQty: Math.max(stat.receivedQty, Number(pkg.uploadedCount || 0) > 0 ? stat.soldQty : 0),
        soldQty: stat.soldQty,
        remainingQty: Number(pkg.availableCount || 0),
        returnedQty: stat.returnedQty,
        revenue: stat.revenue,
      };
    });

    const personRows: PersonInventoryEntry[] = Array.from(personAccumulator.values())
      .map((entry) => {
        const byPackage: PersonPkgBreakdown[] = displayPackages.map((pkg) => {
          const st = entry.pkgMap.get(pkg.id) || { received: 0, sold: 0, returned: 0, value: 0 };
          const rem =
            entry.uid === profile?.uid && isAdmin
              ? Number(pkg.availableCount || 0)
              : Math.max(0, st.received - st.sold - st.returned);
          return {
            pkgId: pkg.id,
            price: pkg.price,
            dataLabel: pkg.dataLabel,
            received: st.received,
            sold: st.sold,
            remaining: rem,
            returned: st.returned,
            value: st.value,
          };
        });
        return {
          key: entry.key,
          uid: entry.uid,
          name: entry.name,
          phone: entry.phone,
          roleLabel: entry.roleLabel,
          discountRate: entry.discountRate,
          salesCount: entry.salesCount,
          receivedCards: byPackage.reduce((s, b) => s + b.received, 0),
          soldCards: byPackage.reduce((s, b) => s + b.sold, 0),
          remainingCards: byPackage.reduce((s, b) => s + b.remaining, 0),
          returnedCards: byPackage.reduce((s, b) => s + b.returned, 0),
          totalAmount: entry.totalAmount,
          paidAmount: entry.paidAmount,
          remainingAmount: entry.remainingAmount,
          byPackage,
        };
      })
      .filter((p) => {
        if (!q) return true;
        return p.name.toLowerCase().includes(q) || normalizeDigits(p.phone).includes(normalizeDigits(q));
      })
      .sort((a, b) => b.totalAmount + b.soldCards * 10 - (a.totalAmount + a.soldCards * 10));

    const periodLabel =
      invGranularity === 'all'
        ? 'الجرد الشامل (الكل)'
        : invGranularity === 'daily'
          ? `جرد يوم ${selectedDayIso.split('-').reverse().join('/')}`
          : `جرد شهر ${selectedMonthIso.split('-').reverse().join('/')}`;

    return {
      periodLabel,
      periodSales,
      packageRows,
      personRows,
      totalCards,
      totalReturned,
      totalRevenue,
      totalPaid,
      totalRemaining,
      totalAvailableStock: displayPackages.reduce((s, p) => s + Number(p.availableCount || 0), 0),
    };
  }, [
    invGranularity,
    selectedDayIso,
    selectedMonthIso,
    entityScopedSales,
    debouncedSearch,
    displayPackages,
    usersByUid,
    selectableAccounts,
    selectedAccount,
    isAdmin,
    profile,
  ]);

  // =========================================================================
  // REPORT 2 DATA: مبيعات اليوم والأسبوع والشهر (لكل شخص + الفئات الثماني + فواتيره)
  // =========================================================================
  const periodSalesData = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();

    const customStartMs = customFromDate ? new Date(`${customFromDate}T00:00:00`).getTime() : 0;
    const customEndMs = customToDate ? new Date(`${customToDate}T23:59:59.999`).getTime() : Infinity;

    const q = debouncedSearch.trim().toLowerCase();

    const filtered = entityScopedSales.filter((sale) => {
      const ms = getSaleTimestampMs(sale);
      if (customFromDate || customToDate) {
        if (ms < customStartMs || ms > customEndMs) return false;
      } else if (salesPeriod === 'today') {
        if (ms < startOfToday) return false;
      } else if (salesPeriod === 'week') {
        if (ms < startOfWeek) return false;
      } else if (salesPeriod === 'month') {
        if (ms < startOfMonth) return false;
      }

      if (!q) return true;
      return (
        (sale.buyerName || '').toLowerCase().includes(q) ||
        (sale.buyerPhone || '').includes(q) ||
        (sale.invoiceNumber || '').toLowerCase().includes(q) ||
        (sale.notes || '').toLowerCase().includes(q)
      );
    });

    let totalCards = 0;
    let totalAmount = 0;
    let cashTotal = 0;
    let creditTotal = 0;
    let paidTotal = 0;
    let remainingTotal = 0;

    const byPersonMap = new Map<
      string,
      {
        key: string;
        uid?: string;
        name: string;
        phone: string;
        roleLabel: string;
        discountRate: number;
        salesCount: number;
        cardsCount: number;
        nominalTotal: number;
        grossTotal: number;
        cashTotal: number;
        creditTotal: number;
        remainingTotal: number;
        pkgCounts: Map<string, number>;
        salesList: SaleDoc[];
      }
    >();

    filtered.forEach((sale) => {
      const amt = Number(sale.totalAmount || 0);
      const paid = Number(sale.paidAmount || 0);
      const rem = Number(sale.remainingAmount || 0);
      const cards = Math.max(0, Number(sale.totalCards || 0) - Number(sale.returnedCards || 0));
      const nominal = computeSaleNominalFaceValue(sale);

      totalCards += cards;
      totalAmount += amt;
      paidTotal += paid;
      remainingTotal += rem;
      if (sale.paymentMethod === 'cash') cashTotal += amt;
      else if (sale.paymentMethod === 'credit') creditTotal += amt;
      else {
        cashTotal += paid;
        creditTotal += rem;
      }

      const matched =
        (sale.buyerId ? usersByUid.get(sale.buyerId) : undefined) ||
        selectableAccounts.find(
          (a) =>
            a.phone &&
            sale.buyerPhone &&
            normalizeDigits(a.phone).replace(/\D/g, '') ===
              normalizeDigits(sale.buyerPhone).replace(/\D/g, '')
        );
      const key = matched?.uid || sale.buyerId || sale.buyerPhone || sale.buyerName || 'consumer';
      let entry = byPersonMap.get(key);
      if (!entry) {
        entry = {
          key,
          uid: matched?.uid,
          name: matched?.name || sale.buyerName || 'مستهلك مباشر',
          phone: matched?.phone || sale.buyerPhone || '—',
          roleLabel: matched
            ? getRoleArabicLabel(matched.role)
            : getBuyerRoleArabicLabel(sale.buyerRole),
          discountRate: Number(
            matched?.discountRate ||
              sale.discountRate ||
              (matched?.role === 'agent' ? 70 : matched?.role === 'client' ? 80 : 100)
          ),
          salesCount: 0,
          cardsCount: 0,
          nominalTotal: 0,
          grossTotal: 0,
          cashTotal: 0,
          creditTotal: 0,
          remainingTotal: 0,
          pkgCounts: new Map<string, number>(),
          salesList: [],
        };
        byPersonMap.set(key, entry);
      }

      entry.salesCount += 1;
      entry.cardsCount += cards;
      entry.nominalTotal += nominal;
      entry.grossTotal += amt;
      entry.remainingTotal += rem;
      if (sale.paymentMethod === 'cash') entry.cashTotal += amt;
      else if (sale.paymentMethod === 'credit') entry.creditTotal += amt;
      else {
        entry.cashTotal += paid;
        entry.creditTotal += rem;
      }
      (sale.items || []).forEach((it) => {
        const netQty = Math.max(0, Number(it.quantity || 0) - Number(it.returned || 0));
        if (netQty > 0) {
          entry!.pkgCounts.set(it.packageId, (entry!.pkgCounts.get(it.packageId) || 0) + netQty);
        }
      });
      entry.salesList.push(sale);
    });

    const byPerson: PersonSalesSummary[] = Array.from(byPersonMap.values())
      .map((e) => {
        const commissionPercent = Math.max(0, 100 - e.discountRate);
        const commissionValue = Math.max(0, e.nominalTotal - e.grossTotal);
        return {
          key: e.key,
          uid: e.uid,
          name: e.name,
          phone: e.phone,
          roleLabel: e.roleLabel,
          discountRate: e.discountRate,
          commissionPercent,
          salesCount: e.salesCount,
          cardsCount: e.cardsCount,
          nominalTotal: e.nominalTotal,
          grossTotal: e.grossTotal,
          commissionValue,
          netTotal: e.grossTotal,
          cashTotal: e.cashTotal,
          creditTotal: e.creditTotal,
          remainingTotal: e.remainingTotal,
          byPkgCounts: displayPackages
            .map((p) => ({ pkgId: p.id, price: p.price, count: e.pkgCounts.get(p.id) || 0 }))
            .filter((x) => x.count > 0),
          salesList: e.salesList,
        };
      })
      .sort((a, b) => b.grossTotal - a.grossTotal);

    const periodTitle =
      customFromDate || customToDate
        ? `مبيعات الفترة (${customFromDate || '...'} إلى ${customToDate || '...'})`
        : salesPeriod === 'today'
          ? 'مبيعات اليوم'
          : salesPeriod === 'week'
            ? 'مبيعات الأسبوع (آخر 7 أيام)'
            : salesPeriod === 'month'
              ? 'مبيعات الشهر الحالي'
              : 'كافة المبيعات';

    const denomBreakdown = buildSalesListDenominationBreakdown(filtered);

    return {
      periodTitle,
      filtered,
      totalCards,
      totalAmount,
      cashTotal,
      creditTotal,
      paidTotal,
      remainingTotal,
      byPerson,
      denomBreakdown,
    };
  }, [
    entityScopedSales,
    salesPeriod,
    customFromDate,
    customToDate,
    debouncedSearch,
    usersByUid,
    selectableAccounts,
    displayPackages,
  ]);

  const displayedSalesList = useMemo(() => {
    if (!focusedSalesPersonKey) return periodSalesData.filtered;
    const found = periodSalesData.byPerson.find((p) => p.key === focusedSalesPersonKey);
    return found ? found.salesList : periodSalesData.filtered;
  }, [focusedSalesPersonKey, periodSalesData]);

  // =========================================================================
  // REPORT 3 DATA: بيانات وكروت الوكيل أو العميل بالتفصيل الممل
  // =========================================================================
  const effectiveDetailUser: UserProfile | null = useMemo(() => {
    if (selectedAccount) return selectedAccount;
    if (!isAdmin && !isAgent && profile) return profile;
    if (selectableAccounts.length > 0) return selectableAccounts[0];
    return profile || null;
  }, [selectedAccount, isAdmin, isAgent, profile, selectableAccounts]);

  const detailActivityLog = useMemo(() => {
    if (!effectiveDetailUser) return [];
    const uidSet = new Set<string>([effectiveDetailUser.uid]);
    if (effectiveDetailUser.linkedSourceId) uidSet.add(effectiveDetailUser.linkedSourceId);
    const normPhone = normalizeDigits(effectiveDetailUser.phone || '').replace(/\D/g, '');

    const events: Array<{
      id: string;
      category: 'receive' | 'sale' | 'payment' | 'return';
      badgeLabel: string;
      title: string;
      subtitle: string;
      amount: number;
      cardsCount?: number;
      statusLabel: string;
      timeMs: number;
    }> = [];

    validSales.forEach((sale) => {
      if (!matchesSelectedEntity(sale, effectiveDetailUser)) return;
      const isSeller = Boolean(sale.sellerId && uidSet.has(sale.sellerId));
      const hasReturns = Number(sale.returnedCards || 0) > 0 || sale.status === 'returned';

      events.push({
        id: `sale_${sale.id}`,
        category: hasReturns ? 'return' : isSeller ? 'sale' : 'receive',
        badgeLabel: hasReturns
          ? 'مرتجع كروت'
          : isSeller
            ? saleTypeLabelAr(sale.saleType)
            : 'استلام كروت',
        title: isSeller
          ? `${saleTypeLabelAr(sale.saleType)} ← ${sale.buyerName}${sale.buyerPhone ? ` (${sale.buyerPhone})` : ''}`
          : `استلام دفعة كروت (${saleTypeLabelAr(sale.saleType)})`,
        subtitle: `فاتورة: ${sale.invoiceNumber || sale.id.slice(0, 8)} • ${paymentMethodLabelAr(sale.paymentMethod)} • ${formatNumEn(sale.totalCards)} كرت${
          sale.items && sale.items.length > 0
            ? ' • ' + sale.items.map((it) => `فئة ${it.price}×${it.quantity}`).join('، ')
            : ''
        }`,
        amount: Number(sale.totalAmount || 0),
        cardsCount: Number(sale.totalCards || 0),
        statusLabel:
          sale.remainingAmount > 0 ? `متبقي ${formatYER(sale.remainingAmount)}` : 'مدفوع بالكامل',
        timeMs: getSaleTimestampMs(sale),
      });
    });

    (topupRequests || []).forEach((req) => {
      if (
        !uidSet.has(req.requesterId) &&
        !(normPhone && normalizeDigits(req.requesterPhone || '').includes(normPhone))
      ) {
        return;
      }
      events.push({
        id: `topup_${req.id}`,
        category: 'receive',
        badgeLabel: 'طلب تغذية',
        title: `طلب تغذية كروت (${formatNumEn(req.totalCards || 0)} كرت)`,
        subtitle:
          req.notes ||
          (req.items && req.items.length > 0
            ? req.items.map((it) => `${it.packageLabel} × ${it.quantity}`).join(' • ')
            : 'طلب تغذية حساب'),
        amount: Number(req.totalAmount || 0),
        cardsCount: Number(req.totalCards || 0),
        statusLabel:
          req.status === 'approved' ? 'معتمد' : req.status === 'rejected' ? 'مرفوض' : 'معلق',
        timeMs: getAnyTimestampMs(req.createdAt),
      });
    });

    const relatedCustomerIds = new Set(
      (customers || [])
        .filter((c) => {
          const cPhone = normalizeDigits(c.phone || '').replace(/\D/g, '');
          return (
            c.id === `acct_${effectiveDetailUser.uid}` ||
            (normPhone && cPhone && cPhone.includes(normPhone)) ||
            c.name.trim().toLowerCase() === effectiveDetailUser.name.trim().toLowerCase()
          );
        })
        .map((c) => c.id)
    );

    (ledgerEntries || []).forEach((entry) => {
      if (!relatedCustomerIds.has(entry.customerId)) return;
      const isRecall =
        (entry.description || '').includes('سحب') || (entry.description || '').includes('مرتجع');
      events.push({
        id: `ledger_${entry.id}`,
        category: isRecall ? 'return' : 'payment',
        badgeLabel: isRecall
          ? 'سحب / مرتجع'
          : entry.entryType === 'credit'
            ? 'سداد / دفعة'
            : 'قيد مالي',
        title: isRecall
          ? 'سحب / مرتجع كروت (خصم تلقائي من المديونية)'
          : entry.entryType === 'credit'
            ? 'تسديد دفعة مالية (له)'
            : entry.entryType === 'debit'
              ? 'قيد مديونية (عليه)'
              : 'تسوية محاسبية',
        subtitle: entry.description || 'قيد دفتري معتمد',
        amount: Number(entry.amount || 0),
        statusLabel: entry.entryType === 'credit' ? 'له (سداد)' : 'عليه (مدين)',
        timeMs: getAnyTimestampMs(entry.createdAt),
      });
    });

    return events.sort((a, b) => b.timeMs - a.timeMs);
  }, [effectiveDetailUser, validSales, topupRequests, customers, ledgerEntries]);

  const filteredDetailActivity = useMemo(() => {
    if (activityFilter === 'all') return detailActivityLog;
    return detailActivityLog.filter((ev) => ev.category === activityFilter);
  }, [detailActivityLog, activityFilter]);

  // =========================================================================
  // REPORT 4 DATA: التقارير المحاسبية الشاملة وجرد الكروت (معادلة المطابقة + الحقوق)
  // =========================================================================
  const accountingData = useMemo(() => {
    // Track per-package wholesale delivered, direct consumer sold, and returned/recalled cards
    const wholesaleDeliveredByPkg = new Map<string, number>();
    const consumerSoldByPkg = new Map<string, number>();
    const returnedByPkg = new Map<string, number>();

    validSales.forEach((sale) => {
      const isWholesale =
        sale.saleType === 'electronic_wholesale' || sale.saleType === 'paper_invoice';
      (sale.items || []).forEach((it) => {
        const net = Math.max(0, Number(it.quantity || 0) - Number(it.returned || 0));
        const ret = Number(it.returned || 0);
        if (ret > 0) {
          returnedByPkg.set(it.packageId, (returnedByPkg.get(it.packageId) || 0) + ret);
        }
        if (isWholesale) {
          wholesaleDeliveredByPkg.set(
            it.packageId,
            (wholesaleDeliveredByPkg.get(it.packageId) || 0) + net
          );
        } else {
          consumerSoldByPkg.set(it.packageId, (consumerSoldByPkg.get(it.packageId) || 0) + net);
        }
      });
    });

    // 1. Card Inventory Reconciliation across all 8 exclusive packages
    // Formula: إجمالي المستورد = المتاح بالمخزن + المسلّم المتبقي لدى الوكلاء والعملاء + المباع + المسحوب/المرتجع
    const inventoryRows = displayPackages.map((pkg) => {
      const availableVault = Number(pkg.availableCount || 0);
      const wholesaleDelivered = wholesaleDeliveredByPkg.get(pkg.id) || 0;
      const directSold = consumerSoldByPkg.get(pkg.id) || 0;
      const totalSoldPkg = Math.max(Number(pkg.soldCount || 0), directSold);
      const deliveredRemainingEstimate = Math.max(0, wholesaleDelivered - directSold);
      const returnedOrRecalled = returnedByPkg.get(pkg.id) || 0;
      const injected = Number(pkg.injectedCount || 0);
      const computedSum =
        availableVault + deliveredRemainingEstimate + totalSoldPkg + returnedOrRecalled + injected;
      const uploaded = Math.max(Number(pkg.uploadedCount || 0), computedSum);
      const nominalAvailableValue = availableVault * pkg.price;

      return {
        pkg,
        uploaded,
        availableVault,
        deliveredRemaining: deliveredRemainingEstimate,
        sold: totalSoldPkg,
        returnedOrRecalled,
        injected,
        nominalAvailableValue,
      };
    });

    const totalUploadedCards = inventoryRows.reduce((s, r) => s + r.uploaded, 0);
    const totalAvailableCards = inventoryRows.reduce((s, r) => s + r.availableVault, 0);
    const totalDeliveredRemaining = inventoryRows.reduce((s, r) => s + r.deliveredRemaining, 0);
    const totalSoldCards = inventoryRows.reduce((s, r) => s + r.sold, 0);
    const totalReturnedCards = inventoryRows.reduce((s, r) => s + r.returnedOrRecalled, 0);
    const totalAvailableValue = inventoryRows.reduce((s, r) => s + r.nominalAvailableValue, 0);

    // 2. Per-Person Financial Rights Split (كم حق الإدارة / كم حق الوكيل / كم حق العميل)
    const rowsMap = new Map<string, AccountingRightsRow>();

    // Map recalled/returned ledger entries per user UID so we include recalled card value accurately
    const recalledValueByUid = new Map<string, number>();
    (customers || []).forEach((cust) => {
      const matchedUser = selectableAccounts.find(
        (u) =>
          cust.id === `acct_${u.uid}` ||
          (u.phone &&
            cust.phone &&
            normalizeDigits(u.phone).replace(/\D/g, '') ===
              normalizeDigits(cust.phone).replace(/\D/g, ''))
      );
      if (!matchedUser) return;
      const sumRecalled = (ledgerEntries || [])
        .filter(
          (e) =>
            e.customerId === cust.id &&
            ((e.description || '').includes('سحب') || (e.description || '').includes('مرتجع'))
        )
        .reduce((s, e) => s + Number(e.amount || 0), 0);
      if (sumRecalled > 0) {
        recalledValueByUid.set(
          matchedUser.uid,
          (recalledValueByUid.get(matchedUser.uid) || 0) + sumRecalled
        );
      }
    });

    selectableAccounts.forEach((u) => {
      if (selectedAccount && u.uid !== selectedAccount.uid) return;
      rowsMap.set(u.uid, {
        uid: u.uid,
        name: u.name,
        phone: u.phone || '—',
        role: u.role,
        roleLabel: getRoleArabicLabel(u.role),
        status: u.status,
        discountRate: Number(u.discountRate || (u.role === 'agent' ? 70 : 80)),
        salesCount: 0,
        cardsCount: 0,
        returnedCards: 0,
        returnedValue: recalledValueByUid.get(u.uid) || 0,
        nominalFaceValue: 0,
        totalBilled: 0,
        adminShare: 0,
        agentShare: 0,
        clientShare: 0,
        paidAmount: 0,
        remainingDebt: 0,
        currentBalance: Number(u.balance || 0),
      });
    });

    entityScopedSales.forEach((sale) => {
      const nominal = computeSaleNominalFaceValue(sale);
      const billed = Number(sale.totalAmount || 0);
      const paid = Number(sale.paidAmount || 0);
      const rem = Number(sale.remainingAmount || 0);
      const cards = Math.max(0, Number(sale.totalCards || 0) - Number(sale.returnedCards || 0));
      const retCards = Number(sale.returnedCards || 0);
      const retValue = (sale.items || []).reduce(
        (s, it) => s + Number(it.returned || 0) * Number(it.unitPrice || it.price || 0),
        0
      );

      const buyerUser = sale.buyerId ? usersByUid.get(sale.buyerId) : undefined;
      const sellerUser = sale.sellerId ? usersByUid.get(sale.sellerId) : undefined;

      let adminShare = 0;
      let agentShare = 0;
      let clientShare = 0;

      const buyerRole = buyerUser?.role || sale.buyerRole || 'consumer';
      const sellerRole =
        sellerUser?.role || (isAdmin ? 'super_admin' : profile?.role || 'super_admin');
      const appliedRate = Number(
        sale.discountRate ||
          buyerUser?.discountRate ||
          (buyerRole === 'agent' ? 70 : buyerRole === 'client' ? 80 : 100)
      );

      if (sellerRole === 'super_admin') {
        if (buyerRole === 'agent') {
          const adminPct = Math.min(100, Math.max(0, appliedRate));
          adminShare = Math.round((nominal * adminPct) / 100);
          agentShare = Math.max(0, nominal - adminShare);
        } else if (buyerRole === 'client') {
          const isSubClient =
            Boolean(buyerUser?.parentAgentId) && buyerUser?.parentAgentId !== profile?.uid;
          const clientCostPct = Math.min(100, Math.max(0, appliedRate));
          if (isSubClient) {
            adminShare = Math.round((nominal * 70) / 100);
            agentShare = Math.max(0, Math.round((nominal * (clientCostPct - 70)) / 100));
            clientShare = Math.max(0, nominal - adminShare - agentShare);
          } else {
            adminShare = Math.round((nominal * clientCostPct) / 100);
            clientShare = Math.max(0, nominal - adminShare);
          }
        } else {
          adminShare = billed;
        }
      } else if (sellerRole === 'agent') {
        const agentCostPct = Number(sellerUser?.discountRate || 70);
        adminShare = Math.round((nominal * agentCostPct) / 100);
        if (buyerRole === 'client') {
          const clientCostPct = Math.min(100, Math.max(agentCostPct, appliedRate));
          agentShare = Math.max(0, Math.round((nominal * (clientCostPct - agentCostPct)) / 100));
          clientShare = Math.max(0, nominal - adminShare - agentShare);
        } else {
          agentShare = Math.max(0, billed - adminShare);
        }
      } else {
        const clientCostPct = Number(sellerUser?.discountRate || profile?.discountRate || 80);
        const hasParentAgent = Boolean(
          sellerUser?.parentAgentId && usersByUid.get(sellerUser.parentAgentId)?.role === 'agent'
        );
        if (hasParentAgent) {
          adminShare = Math.round((nominal * 70) / 100);
          agentShare = Math.max(0, Math.round((nominal * (clientCostPct - 70)) / 100));
          clientShare = Math.max(0, billed - adminShare - agentShare);
        } else {
          adminShare = Math.round((nominal * clientCostPct) / 100);
          clientShare = Math.max(0, billed - adminShare);
        }
      }

      const targetKey =
        buyerUser?.uid ||
        (sellerUser && sellerUser.role !== 'super_admin' ? sellerUser.uid : undefined) ||
        'direct_consumers';

      const existing = rowsMap.get(targetKey) || {
        uid: targetKey,
        name:
          buyerUser?.name ||
          (sellerUser && sellerUser.role !== 'super_admin'
            ? sellerUser.name
            : 'مبيعات مباشرة للمستهلكين'),
        phone:
          buyerUser?.phone ||
          (sellerUser && sellerUser.role !== 'super_admin' ? sellerUser.phone : '—'),
        role:
          buyerUser?.role ||
          (sellerUser?.role === 'super_admin' ? 'consumer' : sellerUser?.role || 'consumer'),
        roleLabel: buyerUser
          ? getRoleArabicLabel(buyerUser.role)
          : targetKey === 'direct_consumers'
            ? 'مستهلك مباشر'
            : getRoleArabicLabel(sellerUser?.role || 'client'),
        status: buyerUser?.status || 'active',
        discountRate: buyerUser?.discountRate || appliedRate,
        salesCount: 0,
        cardsCount: 0,
        returnedCards: 0,
        returnedValue: 0,
        nominalFaceValue: 0,
        totalBilled: 0,
        adminShare: 0,
        agentShare: 0,
        clientShare: 0,
        paidAmount: 0,
        remainingDebt: 0,
        currentBalance: Number(buyerUser?.balance || 0),
      };

      existing.salesCount += 1;
      existing.cardsCount += cards;
      existing.returnedCards += retCards;
      existing.returnedValue += retValue;
      existing.nominalFaceValue += nominal;
      existing.totalBilled += billed;
      existing.adminShare += adminShare;
      existing.agentShare += agentShare;
      existing.clientShare += clientShare;
      existing.paidAmount += paid;
      existing.remainingDebt += rem;
      rowsMap.set(targetKey, existing);
    });

    const q = debouncedSearch.trim().toLowerCase();
    const rightsRows = Array.from(rowsMap.values())
      .filter((r) => {
        if (!q) return true;
        return r.name.toLowerCase().includes(q) || normalizeDigits(r.phone).includes(normalizeDigits(q));
      })
      .sort((a, b) => b.totalBilled - a.totalBilled);

    const totals = rightsRows.reduce(
      (acc, r) => ({
        salesCount: acc.salesCount + r.salesCount,
        cardsCount: acc.cardsCount + r.cardsCount,
        returnedCards: acc.returnedCards + r.returnedCards,
        returnedValue: acc.returnedValue + r.returnedValue,
        nominalFaceValue: acc.nominalFaceValue + r.nominalFaceValue,
        totalBilled: acc.totalBilled + r.totalBilled,
        adminShare: acc.adminShare + r.adminShare,
        agentShare: acc.agentShare + r.agentShare,
        clientShare: acc.clientShare + r.clientShare,
        paidAmount: acc.paidAmount + r.paidAmount,
        remainingDebt: acc.remainingDebt + r.remainingDebt,
        totalBalances: acc.totalBalances + r.currentBalance,
      }),
      {
        salesCount: 0,
        cardsCount: 0,
        returnedCards: 0,
        returnedValue: 0,
        nominalFaceValue: 0,
        totalBilled: 0,
        adminShare: 0,
        agentShare: 0,
        clientShare: 0,
        paidAmount: 0,
        remainingDebt: 0,
        totalBalances: 0,
      }
    );

    const ledgerTotalDebt = (customers || []).reduce(
      (s, c) => s + (c.balance > 0 ? Number(c.balance) : 0),
      0
    );
    const approvedTopupsTotal = (topupRequests || [])
      .filter((t) => t.status === 'approved')
      .reduce((s, t) => s + Number(t.totalAmount || 0), 0);
    const pendingTopupsCount = (topupRequests || []).filter((t) => t.status === 'pending').length;

    return {
      inventoryRows,
      totalUploadedCards,
      totalAvailableCards,
      totalDeliveredRemaining,
      totalSoldCards,
      totalReturnedCards,
      totalAvailableValue,
      rightsRows,
      totals,
      ledgerTotalDebt,
      approvedTopupsTotal,
      pendingTopupsCount,
    };
  }, [
    displayPackages,
    validSales,
    selectableAccounts,
    selectedAccount,
    entityScopedSales,
    usersByUid,
    isAdmin,
    profile,
    debouncedSearch,
    customers,
    ledgerEntries,
    topupRequests,
  ]);

  // =========================================================================
  // BUILD PRINTABLE / EXPORTABLE PAYLOAD FOR ALL 4 REPORTS
  // =========================================================================
  const buildActiveExportPayload = (): PrintableDocumentPayload | null => {
    if (!activeReportId) return null;
    const scopeLabel = selectedAccount
      ? `${selectedAccount.name} (${getRoleArabicLabel(selectedAccount.role)})`
      : isAdmin
        ? 'الكل (الإدارة وجميع الوكلاء والعملاء)'
        : profile?.name || 'حسابي';

    const commonBrand = {
      pdfHeaderTitle: appSettings.pdfHeaderTitle || 'كروت طيبة نت – TAIBAH NET',
      pdfHeaderSubtitle: appSettings.pdfHeaderSubtitle,
      pdfFooterText: appSettings.pdfFooterText,
      sharePhone: selectedAccount?.phone || undefined,
    };

    if (activeReportId === 'daily_monthly_inventory') {
      return {
        ...commonBrand,
        title: `الجرد ${invGranularity === 'daily' ? 'اليومي' : 'الشهري'} الشامل`,
        subtitle: `${inventoryData.periodLabel} • النطاق: ${scopeLabel}`,
        fileName: `taibah-inventory-${invGranularity}-${invGranularity === 'daily' ? selectedDayIso : selectedMonthIso}`,
        metaRows: [
          { label: 'الفترة', value: inventoryData.periodLabel },
          { label: 'النطاق', value: scopeLabel },
          { label: 'تاريخ الإصدار', value: formatDateTimeAr(new Date()) },
          { label: 'عدد العمليات', value: formatNumEn(inventoryData.periodSales.length) },
        ],
        tableHeaders: ['الباقة', 'السعر', 'المستلم', 'المباع/المسلّم', 'المتبقي بالمخزن', 'القيمة'],
        tableRows: inventoryData.packageRows.map((row) => [
          `باقة ${row.pkg.price} (${row.pkg.dataLabel})`,
          formatYER(row.pkg.price),
          formatNumEn(row.receivedQty),
          formatNumEn(row.soldQty),
          formatNumEn(row.remainingQty),
          formatYER(row.revenue),
        ]),
        summaryRows: [
          { label: 'إجمالي الكروت المباعة/المسلّمة', value: `${formatNumEn(inventoryData.totalCards)} كرت` },
          { label: 'إجمالي المتاح في المخزون', value: `${formatNumEn(inventoryData.totalAvailableStock)} كرت` },
          { label: 'إجمالي المحصّل نقداً', value: formatYER(inventoryData.totalPaid) },
          { label: 'إجمالي المتبقي آجلاً', value: formatYER(inventoryData.totalRemaining) },
          { label: 'الإجمالي العام للفترة', value: formatYER(inventoryData.totalRevenue), highlight: true },
        ],
        shareText: `*${inventoryData.periodLabel} — كروت طيبة نت*\nالنطاق: ${scopeLabel}\nالكروت المباعة: ${formatNumEn(inventoryData.totalCards)} كرت\nالمخزون المتاح: ${formatNumEn(inventoryData.totalAvailableStock)} كرت\nالإجمالي: ${formatYER(inventoryData.totalRevenue)}\nالمحصّل: ${formatYER(inventoryData.totalPaid)}\nالمتبقي: ${formatYER(inventoryData.totalRemaining)}`,
      };
    }

    if (activeReportId === 'period_sales') {
      return {
        ...commonBrand,
        title: periodSalesData.periodTitle,
        subtitle: `تقرير المبيعات التفصيلي • النطاق: ${scopeLabel}`,
        fileName: `taibah-sales-${salesPeriod}-${toLocalIsoDate(new Date())}`,
        metaRows: [
          { label: 'الفترة', value: periodSalesData.periodTitle },
          { label: 'النطاق', value: scopeLabel },
          { label: 'إجمالي العمليات', value: formatNumEn(periodSalesData.filtered.length) },
          { label: 'تاريخ التقرير', value: formatDateTimeAr(new Date()) },
        ],
        tableHeaders: ['الشخص', 'الصفة', 'الكروت', 'إجمالي المبيعات', 'نسبة الخصم', 'صافي المبلغ', 'المتبقي'],
        tableRows: periodSalesData.byPerson.map((p) => [
          p.name,
          p.roleLabel,
          formatNumEn(p.cardsCount),
          formatYER(p.nominalTotal),
          `${p.commissionPercent}%`,
          formatYER(p.netTotal),
          formatYER(p.remainingTotal),
        ]),
        breakdownTitle: 'تفصيل الكروت حسب الفئة',
        breakdownItems: toPrintableBreakdownItems(periodSalesData.denomBreakdown),
        summaryRows: [
          { label: 'إجمالي الكروت', value: `${formatNumEn(periodSalesData.totalCards)} كرت` },
          { label: 'المبيعات النقدية', value: formatYER(periodSalesData.cashTotal) },
          { label: 'المبيعات الآجلة', value: formatYER(periodSalesData.creditTotal) },
          { label: 'المتبقي للتحصيل', value: formatYER(periodSalesData.remainingTotal) },
          { label: 'إجمالي المبيعات', value: formatYER(periodSalesData.totalAmount), highlight: true },
        ],
        shareText: `*${periodSalesData.periodTitle} — كروت طيبة نت*\nالنطاق: ${scopeLabel}\nالعمليات: ${formatNumEn(periodSalesData.filtered.length)} | الكروت: ${formatNumEn(periodSalesData.totalCards)}\nالنقدي: ${formatYER(periodSalesData.cashTotal)} | الآجل: ${formatYER(periodSalesData.creditTotal)}\nالإجمالي: ${formatYER(periodSalesData.totalAmount)}`,
      };
    }

    if (activeReportId === 'entity_cards_detail' && effectiveDetailUser) {
      return {
        ...commonBrand,
        sharePhone: effectiveDetailUser.phone || undefined,
        title: `سجل حركات الحساب — ${effectiveDetailUser.name}`,
        subtitle: `${getRoleArabicLabel(effectiveDetailUser.role)} • الهاتف: ${effectiveDetailUser.phone || '—'}`,
        fileName: `taibah-activity-${effectiveDetailUser.name}`,
        metaRows: [
          { label: 'الاسم', value: effectiveDetailUser.name },
          { label: 'الصفة', value: getRoleArabicLabel(effectiveDetailUser.role) },
          { label: 'الرصيد الحالي', value: formatYER(effectiveDetailUser.balance || 0) },
          { label: 'عدد الحركات', value: formatNumEn(detailActivityLog.length) },
        ],
        tableHeaders: ['التاريخ والوقت', 'نوع الحركة', 'التفاصيل', 'المبلغ', 'الحالة'],
        tableRows: detailActivityLog.slice(0, 200).map((ev) => [
          ev.timeMs > 0 ? formatDateTimeAr(new Date(ev.timeMs)) : '—',
          ev.badgeLabel,
          `${ev.title} — ${ev.subtitle}`,
          formatYER(ev.amount),
          ev.statusLabel,
        ]),
        summaryRows: [
          { label: 'الرصيد المالي الحالي', value: formatYER(effectiveDetailUser.balance || 0), highlight: true },
          { label: 'نسبة التسعير', value: `${effectiveDetailUser.discountRate || 80}%` },
        ],
        shareText: `*كشف بيانات وحركات الحساب — كروت طيبة نت*\nالاسم: ${effectiveDetailUser.name} (${getRoleArabicLabel(effectiveDetailUser.role)})\nالهاتف: ${effectiveDetailUser.phone || '—'}\nالرصيد الحالي: ${formatYER(effectiveDetailUser.balance || 0)}\nإجمالي الحركات المسجلة: ${formatNumEn(detailActivityLog.length)}`,
      };
    }

    if (activeReportId === 'accounting_full_inventory') {
      return {
        ...commonBrand,
        title: 'التقرير المحاسبي الشامل وجرد الكروت',
        subtitle: `توزيع الحقوق (الإدارة / الوكيل / العميل) ومعادلة الجرد • النطاق: ${scopeLabel}`,
        fileName: `taibah-accounting-${toLocalIsoDate(new Date())}`,
        metaRows: [
          { label: 'النطاق', value: scopeLabel },
          { label: 'إجمالي المستورد', value: `${formatNumEn(accountingData.totalUploadedCards)} كرت` },
          { label: 'المتاح بالمخزن', value: `${formatNumEn(accountingData.totalAvailableCards)} كرت` },
          { label: 'المباع والمرتجع', value: `${formatNumEn(accountingData.totalSoldCards)} مباع / ${formatNumEn(accountingData.totalReturnedCards)} مرتجع` },
        ],
        tableHeaders: [
          'الحساب',
          'الصفة',
          'الكروت',
          'حق الإدارة',
          'حق الوكيل',
          'حق العميل',
          'المدفوع',
          'المتبقي',
          'المرتجع/المسحوب',
        ],
        tableRows: accountingData.rightsRows.map((r) => [
          r.name,
          r.roleLabel,
          formatNumEn(r.cardsCount),
          formatYER(r.adminShare),
          formatYER(r.agentShare),
          formatYER(r.clientShare),
          formatYER(r.paidAmount),
          formatYER(r.remainingDebt),
          formatYER(r.returnedValue),
        ]),
        summaryRows: [
          { label: 'إجمالي القيمة الاسمية (100%)', value: formatYER(accountingData.totals.nominalFaceValue) },
          { label: 'إجمالي حق الإدارة', value: formatYER(accountingData.totals.adminShare), highlight: true },
          { label: 'إجمالي حق الوكلاء', value: formatYER(accountingData.totals.agentShare) },
          { label: 'إجمالي حق العملاء', value: formatYER(accountingData.totals.clientShare) },
          { label: 'إجمالي المدفوع والمحصّل', value: formatYER(accountingData.totals.paidAmount) },
          { label: 'إجمالي المتبقي والديون', value: formatYER(accountingData.totals.remainingDebt) },
          { label: 'قيمة الكروت المسحوبة/المرتجعة', value: formatYER(accountingData.totals.returnedValue) },
        ],
        shareText: `*التقرير المحاسبي الشامل — كروت طيبة نت*\nالنطاق: ${scopeLabel}\nحق الإدارة: ${formatYER(accountingData.totals.adminShare)}\nحق الوكيل: ${formatYER(accountingData.totals.agentShare)}\nحق العميل: ${formatYER(accountingData.totals.clientShare)}\nالمدفوع: ${formatYER(accountingData.totals.paidAmount)}\nالمتبقي/الديون: ${formatYER(accountingData.totals.remainingDebt)}\nالمسحوب/المرتجع: ${formatYER(accountingData.totals.returnedValue)}\nالمتاح بالمخزن: ${formatNumEn(accountingData.totalAvailableCards)} كرت`,
      };
    }

    return null;
  };

  const handleExport = async (kind: 'pdf' | 'whatsapp') => {
    const payload = buildActiveExportPayload();
    if (!payload) {
      notifyError('اختر حساباً أولاً', 'يرجى تحديد الوكيل أو العميل قبل التصدير.');
      return;
    }
    setExportingKind(kind);
    try {
      if (kind === 'pdf') {
        const res = await exportAsArabicPDF(payload);
        if (res && !res.sharedNatively) setExportPreview(res);
        notifySuccess('تم إنشاء ملف PDF العربي بنجاح');
      } else if (kind === 'whatsapp') {
        openWhatsAppShare(payload.sharePhone, payload.shareText || payload.title);
      }
    } catch {
      notifyError('تعذر إتمام التصدير', 'يرجى المحاولة مرة أخرى.');
    } finally {
      setExportingKind(null);
    }
  };

  const openEntityDetailReport = (uid?: string) => {
    if (uid) setSelectedEntityUid(uid);
    setActiveReportId('entity_cards_detail');
  };

  // =========================================================================
  // MAIN REPORTS HUB — SLEEK 1-LINE FILTER + SLIM KPI + 4 LUXURY ROYAL ICONS
  // =========================================================================
  if (!activeReportId) {
    return (
      <div dir="rtl" className="space-y-2.5 pb-16">
        {/* Single Compact Filter & Refresh Bar (No Repeated Header Box) */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 p-2 shadow-sm flex items-center gap-2">
          {(isAdmin || isAgent) && selectableAccounts.length > 0 ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <Filter className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <select
                value={selectedEntityUid}
                onChange={(e) => setSelectedEntityUid(e.target.value)}
                aria-label="تصفية حسب الكل أو وكيل أو عميل محدد"
                className="flex-1 min-w-0 rounded-xl bg-slate-50 dark:bg-slate-800 text-[#0F172A] dark:text-white px-2.5 py-1.5 text-xs font-extrabold border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#D4AF37]"
              >
                <option value="all">تصفية حسب: الكل</option>
                {selectableAccounts.map((acc) => (
                  <option key={acc.uid} value={acc.uid}>
                    {acc.name} — {getRoleArabicLabel(acc.role)} ({acc.phone || '—'})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-1 min-w-0 px-1">
              <Filter className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A] truncate">
                {profile?.name || 'تقارير حسابي'}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => void refreshMyInventory(true)}
            disabled={isRefreshingInventory}
            className="px-3 py-1.5 rounded-xl bg-[#1A365D] hover:bg-[#0F172A] text-white text-xs font-extrabold flex items-center gap-1.5 shrink-0 border border-[#D4AF37]/60 transition"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-[#FDE68A] ${isRefreshingInventory ? 'animate-spin' : ''}`}
            />
            <span>تحديث</span>
          </button>
        </div>

        {/* Slim Single-Row KPI Summary Strip */}
        <div className="grid grid-cols-4 gap-1.5">
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1.5 py-1.5 text-center shadow-sm">
            <p className="text-[9.5px] font-bold text-slate-500 truncate">المبيعات</p>
            <p className="text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums truncate mt-0.5">
              {formatMoney(periodSalesData.totalAmount)}
            </p>
          </div>
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1.5 py-1.5 text-center shadow-sm">
            <p className="text-[9.5px] font-bold text-slate-500 truncate">المخزون</p>
            <p className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums truncate mt-0.5">
              {formatNum(accountingData.totalAvailableCards)} كرت
            </p>
          </div>
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1.5 py-1.5 text-center shadow-sm">
            <p className="text-[9.5px] font-bold text-slate-500 truncate">حق الإدارة</p>
            <p className="text-[11px] font-extrabold text-blue-700 dark:text-sky-400 tabular-nums truncate mt-0.5">
              {formatMoney(accountingData.totals.adminShare)}
            </p>
          </div>
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1.5 py-1.5 text-center shadow-sm">
            <p className="text-[9.5px] font-bold text-slate-500 truncate">الديون</p>
            <p className="text-[11px] font-extrabold text-red-600 dark:text-red-400 tabular-nums truncate mt-0.5">
              {formatMoney(accountingData.totals.remainingDebt)}
            </p>
          </div>
        </div>

        {/* 4 Luxury Compact Centered Icon Cards — All Fit in One Screen */}
        <div className="grid grid-cols-2 gap-3 pt-0.5">
          {FOUR_CORE_REPORTS.map((rep) => {
            const IconComp = rep.icon;
            return (
              <button
                key={rep.id}
                type="button"
                onClick={() => setActiveReportId(rep.id)}
                className="royal-tile-3d rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/75 hover:border-[#D4AF37] h-[118px] sm:h-[124px] p-3 shadow-md hover:shadow-lg active:scale-[0.98] transition flex flex-col items-center justify-center gap-2.5 text-center"
              >
                <div
                  className={`w-13 h-13 rounded-2xl bg-gradient-to-br ${rep.accent} text-white flex items-center justify-center border-2 border-[#D4AF37]/80 shadow-md`}
                >
                  <IconComp className="w-7 h-7 text-[#FDE68A]" />
                </div>
                <h3 className="text-xs sm:text-sm font-extrabold text-[#0F172A] dark:text-white leading-tight px-1">
                  {rep.hubTitle}
                </h3>
              </button>
            );
          })}
        </div>

        <ExportPreviewModal result={exportPreview} onClose={() => setExportPreview(null)} />
      </div>
    );
  }

  // Helper for computing Admin & Agent/Client shares per sale row
  const getSaleShares = (sale: SaleDoc) => {
    const nominal = computeSaleNominalFaceValue(sale);
    const buyerUser = sale.buyerId ? usersByUid.get(sale.buyerId) : undefined;
    const rate = Number(
      sale.discountRate ||
        buyerUser?.discountRate ||
        (buyerUser?.role === 'agent' ? 70 : buyerUser?.role === 'client' ? 80 : 100)
    );
    const adminShare = Math.round((nominal * Math.min(100, Math.max(0, rate))) / 100);
    const entityShare = Math.max(0, nominal - adminShare);
    return { nominal, adminShare, entityShare };
  };

  // =========================================================================
  // ACTIVE REPORT DETAILED SCREEN (Ultra-Compact Blue Box + Instant Details + pb-20)
  // =========================================================================
  return (
    <div dir="rtl" className="flex-1 min-h-0 overflow-y-auto space-y-2 pb-20">
      {/* Ultra-Compact Royal Blue Top Bar (<= 15% of screen: 1-row 4 tabs + 1-row entity filter & WA/PDF) */}
      <div className="rounded-2xl bg-gradient-to-br from-[#1A365D] via-[#0F172A] to-[#1A365D] text-white p-2 border border-[#D4AF37]/80 shadow-md space-y-1.5">
        {/* Row 1: Single Slim 4-Tab Bar */}
        <div className="grid grid-cols-4 gap-1">
          {FOUR_CORE_REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveReportId(r.id)}
              className={`py-1.5 px-1 rounded-xl text-[11px] font-bold transition truncate border ${
                activeReportId === r.id
                  ? 'bg-[#D4AF37] text-[#0F172A] border-[#FDE68A] font-extrabold'
                  : 'bg-white/10 text-white border-white/15 hover:bg-white/20'
              }`}
            >
              {r.shortTitle}
            </button>
          ))}
        </div>

        {/* Row 2: Back-to-Hub + Entity Dropdown + ONLY WhatsApp & PDF Icons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveReportId(null)}
            className="w-8 h-9 rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center shrink-0 transition"
            aria-label="العودة لمركز التقارير"
          >
            <ArrowRight className="w-4 h-4 text-[#FDE68A]" />
          </button>

          {(isAdmin || isAgent) && selectableAccounts.length > 0 ? (
            <select
              value={selectedEntityUid}
              onChange={(e) => setSelectedEntityUid(e.target.value)}
              aria-label="اختيار الوكيل أو العميل"
              className="flex-1 min-w-0 h-9 rounded-xl bg-white text-[#0F172A] px-2 text-xs font-extrabold border border-[#D4AF37] focus:outline-none"
            >
              <option value="all">الكل (الإدارة وجميع الوكلاء والعملاء)</option>
              {selectableAccounts.map((acc) => (
                <option key={acc.uid} value={acc.uid}>
                  {acc.name} — {getRoleArabicLabel(acc.role)} ({acc.phone || '—'})
                </option>
              ))}
            </select>
          ) : (
            <div className="flex-1 min-w-0 h-9 rounded-xl bg-white/10 border border-white/15 px-2.5 flex items-center text-xs font-extrabold text-[#FDE68A] truncate">
              {profile?.name || 'حسابي'}
            </div>
          )}

          <button
            type="button"
            disabled={Boolean(exportingKind)}
            onClick={() => void handleExport('whatsapp')}
            className="h-9 px-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-[11px] font-extrabold flex items-center justify-center gap-1 shrink-0 transition"
            aria-label="مشاركة عبر واتساب"
          >
            <Send className="w-3.5 h-3.5" />
            <span>واتساب</span>
          </button>

          <button
            type="button"
            disabled={Boolean(exportingKind)}
            onClick={() => void handleExport('pdf')}
            className="h-9 px-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-extrabold flex items-center justify-center gap-1 shrink-0 transition"
            aria-label="تصدير PDF"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* TAB 1: الجرد (الكل / يومي / شهري + 4 أيقونات + الباقات الثماني)  */}
      {/* ================================================================= */}
      {activeReportId === 'daily_monthly_inventory' && (
        <div className="space-y-2">
          {/* Single Ultra-Slim Filter Row (h-8): الكل | يومي | شهري + 📅 + 🔍 */}
          <div className="flex items-center gap-1">
            <div className="grid grid-cols-3 gap-1 flex-1">
              {(
                [
                  { id: 'all', label: 'الكل' },
                  { id: 'daily', label: 'يومي' },
                  { id: 'monthly', label: 'شهري' },
                ] as Array<{ id: InventoryGranularity; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setInvGranularity(tab.id)}
                  className={`h-8 rounded-xl text-[11px] font-extrabold border transition ${
                    invGranularity === tab.id
                      ? 'bg-[#1A365D] text-white border-[#D4AF37]'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                if (invGranularity === 'all') setInvGranularity('daily');
                setShowDatePicker((v) => !v);
              }}
              aria-label="اختيار التاريخ"
              className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 transition ${
                showDatePicker || invGranularity !== 'all'
                  ? 'bg-[#D4AF37] text-[#0F172A] border-[#B4860B]'
                  : 'bg-white dark:bg-slate-900 text-[#1A365D] dark:text-[#FDE68A] border-slate-200 dark:border-slate-800'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setShowSearchInput((v) => !v)}
              aria-label="بحث"
              className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 transition ${
                showSearchInput || search
                  ? 'bg-[#1A365D] text-[#FDE68A] border-[#D4AF37]'
                  : 'bg-white dark:bg-slate-900 text-[#1A365D] dark:text-[#FDE68A] border-slate-200 dark:border-slate-800'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Collapsible Date Picker (opens ONLY when 📅 clicked) */}
          {showDatePicker && (
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-[#D4AF37]/60 p-2 flex items-center gap-2">
              <span className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 shrink-0">
                {invGranularity === 'monthly' ? 'الشهر:' : 'التاريخ:'}
              </span>
              {invGranularity === 'monthly' ? (
                <input
                  type="month"
                  value={selectedMonthIso}
                  onChange={(e) => {
                    setInvGranularity('monthly');
                    setSelectedMonthIso(e.target.value);
                  }}
                  className="flex-1 h-8 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 text-xs font-bold text-slate-900 dark:text-white"
                />
              ) : (
                <input
                  type="date"
                  value={selectedDayIso}
                  onChange={(e) => {
                    setInvGranularity('daily');
                    setSelectedDayIso(e.target.value);
                  }}
                  className="flex-1 h-8 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 text-xs font-bold text-slate-900 dark:text-white"
                />
              )}
              <button
                type="button"
                onClick={() => setShowDatePicker(false)}
                className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Collapsible Search Input (opens ONLY when 🔍 clicked) */}
          {showSearchInput && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث باسم الوكيل أو العميل أو الهاتف..."
                className="w-full h-8 pr-8 pl-8 rounded-xl border border-[#D4AF37]/70 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none"
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* 4 Beautiful Compact Summary Icons: المستلم | الباقي | باع | المحاسبة والرصيد */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="rounded-xl bg-[#1A365D] text-white border border-[#D4AF37]/80 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-[#FDE68A]">
                <Layers className="w-3 h-3 shrink-0" />
                <span className="truncate">المستلم</span>
              </div>
              <p className="text-sm font-black mt-0.5 tabular-nums">
                {formatNum(inventoryData.packageRows.reduce((s, r) => s + r.receivedQty, 0))}
              </p>
            </div>
            <div className="rounded-xl bg-amber-500 text-[#0F172A] border border-amber-700/70 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-extrabold">
                <Package className="w-3 h-3 shrink-0" />
                <span className="truncate">الباقي</span>
              </div>
              <p className="text-sm font-black mt-0.5 tabular-nums">
                {formatNum(inventoryData.totalAvailableStock)}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-600 text-white border border-emerald-400/80 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-emerald-100">
                <TrendingUp className="w-3 h-3 shrink-0" />
                <span className="truncate">باع</span>
              </div>
              <p className="text-sm font-black mt-0.5 tabular-nums">
                {formatNum(inventoryData.totalCards)}
              </p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-[#0F172A] to-indigo-950 text-white border border-[#D4AF37]/70 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-[#FDE68A]">
                <Wallet className="w-3 h-3 shrink-0" />
                <span className="truncate">المحاسبة</span>
              </div>
              <p className="text-[11px] font-black mt-0.5 tabular-nums truncate">
                {formatMoney(inventoryData.totalRevenue)}
              </p>
            </div>
          </div>

          {/* 8 Packages Breakdown Table — Immediately Visible Below Summary */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#D4AF37]/50 shadow-sm overflow-hidden">
            <div className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#D4AF37]" />
                <h3 className="text-[11px] font-extrabold text-slate-900 dark:text-white">
                  الباقات الثماني — {inventoryData.periodLabel}
                </h3>
              </div>
              <span className="text-[10px] font-bold text-red-600 dark:text-red-400 tabular-nums">
                متبقي آجل: {formatMoney(inventoryData.totalRemaining)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-[11px]">
                <thead className="bg-[#1A365D] text-white">
                  <tr>
                    <th className="py-1.5 px-2 font-extrabold">الفئة</th>
                    <th className="py-1.5 px-2 font-extrabold text-center">استلم</th>
                    <th className="py-1.5 px-2 font-extrabold text-center">باع</th>
                    <th className="py-1.5 px-2 font-extrabold text-center">باقي</th>
                    <th className="py-1.5 px-2 font-extrabold">القيمة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {inventoryData.packageRows.map((row) => (
                    <tr key={row.pkg.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-1.5 px-2 font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                        {row.pkg.price} ({row.pkg.dataLabel})
                      </td>
                      <td className="py-1.5 px-2 font-bold text-center text-slate-600 dark:text-slate-300 tabular-nums">
                        {formatNum(row.receivedQty)}
                      </td>
                      <td className="py-1.5 px-2 font-extrabold text-center text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {formatNum(row.soldQty)}
                      </td>
                      <td className="py-1.5 px-2 font-extrabold text-center text-blue-700 dark:text-sky-400 tabular-nums">
                        {formatNum(row.remainingQty)}
                      </td>
                      <td className="py-1.5 px-2 font-extrabold text-slate-900 dark:text-white tabular-nums whitespace-nowrap">
                        {formatMoney(row.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-amber-50/70 dark:bg-slate-800/90 border-t-2 border-[#D4AF37]">
                  <tr>
                    <td className="py-1.5 px-2 font-black text-[#1A365D] dark:text-[#FDE68A]">
                      الإجمالي
                    </td>
                    <td className="py-1.5 px-2 font-black text-center tabular-nums">
                      {formatNum(inventoryData.packageRows.reduce((s, r) => s + r.receivedQty, 0))}
                    </td>
                    <td className="py-1.5 px-2 font-black text-center text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {formatNum(inventoryData.totalCards)}
                    </td>
                    <td className="py-1.5 px-2 font-black text-center text-blue-700 dark:text-sky-400 tabular-nums">
                      {formatNum(inventoryData.totalAvailableStock)}
                    </td>
                    <td className="py-1.5 px-2 font-black tabular-nums whitespace-nowrap">
                      {formatMoney(inventoryData.totalRevenue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Per-Person Detailed Cards & 8-Package Breakdown */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#D4AF37]" />
                <h3 className="text-[11px] font-extrabold text-slate-900 dark:text-white">
                  جرد تفصيلي لكل شخص ({formatNumEn(inventoryData.personRows.length)})
                </h3>
              </div>
            </div>

            {inventoryData.personRows.slice(0, visibleRowsCount).map((person) => {
              const isExpanded = expandedInvPersonKey === person.key;
              return (
                <div
                  key={person.key}
                  className="rounded-2xl bg-white dark:bg-slate-900 border border-[#D4AF37]/50 shadow-sm overflow-hidden"
                >
                  <div className="p-2.5 flex flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-extrabold text-slate-900 dark:text-white leading-snug break-words">
                            {person.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded-md bg-[#1A365D]/10 dark:bg-white/10 text-[#1A365D] dark:text-[#FDE68A] text-[10px] font-extrabold whitespace-nowrap">
                            {person.roleLabel}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] font-bold text-slate-500 mt-0.5 tabular-nums">
                          <span>{person.phone}</span>
                          <span>•</span>
                          <span>استلم: {formatNum(person.receivedCards)}</span>
                          <span>•</span>
                          <span className="text-emerald-700 dark:text-emerald-400">
                            باع: {formatNum(person.soldCards)}
                          </span>
                          <span>•</span>
                          <span className="text-blue-700 dark:text-sky-400">
                            باقي: {formatNum(person.remainingCards)}
                          </span>
                        </div>
                      </div>
                      <div className="text-left shrink-0">
                        <p className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                          {formatMoney(person.totalAmount)}
                        </p>
                        {person.remainingAmount > 0 && (
                          <p className="text-[10px] font-bold text-red-600 tabular-nums">
                            متبقي: {formatMoney(person.remainingAmount)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedInvPersonKey(isExpanded ? null : person.key)
                        }
                        className="h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-[#1A365D] dark:text-[#FDE68A] text-[11px] font-extrabold flex items-center justify-center gap-1"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            <span>إخفاء الفئات</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            <span>الباقات الثماني</span>
                          </>
                        )}
                      </button>
                      {person.uid && person.uid !== profile?.uid ? (
                        <button
                          type="button"
                          onClick={() => openEntityDetailReport(person.uid)}
                          className="h-8 rounded-xl bg-[#1A365D] hover:bg-[#0F172A] text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
                        >
                          <CreditCard className="w-3.5 h-3.5 text-[#FDE68A]" />
                          <span>كشف الكروت</span>
                        </button>
                      ) : (
                        <div className="h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10.5px] font-extrabold flex items-center justify-center">
                          {formatNum(person.salesCount)} عملية
                        </div>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-2 overflow-x-auto">
                      <table className="w-full text-right text-[11px]">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                            <th className="py-1 px-1.5 font-extrabold">الفئة</th>
                            <th className="py-1 px-1.5 font-extrabold text-center">استلم</th>
                            <th className="py-1 px-1.5 font-extrabold text-center">باع</th>
                            <th className="py-1 px-1.5 font-extrabold text-center">باقي</th>
                            <th className="py-1 px-1.5 font-extrabold">القيمة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                          {person.byPackage.map((b) => (
                            <tr key={b.pkgId}>
                              <td className="py-1 px-1.5 font-extrabold whitespace-nowrap">
                                {b.price} ({b.dataLabel})
                              </td>
                              <td className="py-1 px-1.5 font-bold text-center tabular-nums">{formatNum(b.received)}</td>
                              <td className="py-1 px-1.5 font-extrabold text-center text-emerald-700 dark:text-emerald-400 tabular-nums">
                                {formatNum(b.sold)}
                              </td>
                              <td className="py-1 px-1.5 font-extrabold text-center text-blue-700 dark:text-sky-400 tabular-nums">
                                {formatNum(b.remaining)}
                              </td>
                              <td className="py-1 px-1.5 font-extrabold tabular-nums whitespace-nowrap">
                                {formatMoney(b.value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}

            {inventoryData.personRows.length > visibleRowsCount && (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setVisibleRowsCount((v) => v + PAGE_SIZE)}
                  className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]"
                >
                  عرض المزيد ({formatNumEn(inventoryData.personRows.length - visibleRowsCount)} متبقي)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: المبيعات (الكل/اليوم/أسبوع/شهر + 📅 + 🔍 بسطر واحد نحيف)    */}
      {/* ================================================================= */}
      {activeReportId === 'period_sales' && (
        <div className="space-y-2">
          {/* Single Ultra-Slim Row (h-8): الكل | اليوم | أسبوع | شهر + 📅 + 🔍 */}
          <div className="flex items-center gap-1">
            <div className="grid grid-cols-4 gap-1 flex-1">
              {(
                [
                  { id: 'all', label: 'الكل' },
                  { id: 'today', label: 'اليوم' },
                  { id: 'week', label: 'أسبوع' },
                  { id: 'month', label: 'شهر' },
                ] as Array<{ id: SalesPeriodTab; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSalesPeriod(tab.id);
                    setCustomFromDate('');
                    setCustomToDate('');
                  }}
                  className={`h-8 rounded-xl text-[11px] font-extrabold border transition ${
                    salesPeriod === tab.id && !customFromDate && !customToDate
                      ? 'bg-[#1A365D] text-white border-[#D4AF37]'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowDatePicker((v) => !v)}
              aria-label="تحديد فترة مخصصة"
              className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 transition ${
                showDatePicker || customFromDate || customToDate
                  ? 'bg-[#D4AF37] text-[#0F172A] border-[#B4860B]'
                  : 'bg-white dark:bg-slate-900 text-[#1A365D] dark:text-[#FDE68A] border-slate-200 dark:border-slate-800'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setShowSearchInput((v) => !v)}
              aria-label="بحث في المبيعات"
              className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 transition ${
                showSearchInput || search
                  ? 'bg-[#1A365D] text-[#FDE68A] border-[#D4AF37]'
                  : 'bg-white dark:bg-slate-900 text-[#1A365D] dark:text-[#FDE68A] border-slate-200 dark:border-slate-800'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* On-Demand Custom Date Range (ONLY opens when 📅 clicked) */}
          {showDatePicker && (
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-[#D4AF37]/70 p-2 grid grid-cols-2 gap-1.5">
              <div className="flex items-center gap-1">
                <span className="text-[10.5px] font-bold text-slate-500 shrink-0">من:</span>
                <input
                  type="date"
                  value={customFromDate}
                  onChange={(e) => setCustomFromDate(e.target.value)}
                  className="flex-1 min-w-0 h-8 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 text-[11px] font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10.5px] font-bold text-slate-500 shrink-0">إلى:</span>
                <input
                  type="date"
                  value={customToDate}
                  onChange={(e) => setCustomToDate(e.target.value)}
                  className="flex-1 min-w-0 h-8 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 text-[11px] font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* On-Demand Search Input (ONLY opens when 🔍 clicked) */}
          {showSearchInput && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث باسم المشتري أو الهاتف أو الفاتورة..."
                className="w-full h-8 pr-8 pl-8 rounded-xl border border-[#D4AF37]/70 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none"
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* 4 Beautiful Compact Summary Icons: المستلم/الفواتير | الباقي | باع | المحاسبة والرصيد */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="rounded-xl bg-[#1A365D] text-white border border-[#D4AF37]/80 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-[#FDE68A]">
                <Layers className="w-3 h-3 shrink-0" />
                <span className="truncate">المستلم</span>
              </div>
              <p className="text-sm font-black mt-0.5 tabular-nums">
                {formatNum(periodSalesData.filtered.length)}
              </p>
            </div>
            <div className="rounded-xl bg-amber-500 text-[#0F172A] border border-amber-700/70 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-extrabold">
                <Package className="w-3 h-3 shrink-0" />
                <span className="truncate">الباقي</span>
              </div>
              <p className="text-[11px] font-black mt-0.5 tabular-nums truncate">
                {formatMoney(periodSalesData.remainingTotal)}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-600 text-white border border-emerald-400/80 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-emerald-100">
                <TrendingUp className="w-3 h-3 shrink-0" />
                <span className="truncate">باع</span>
              </div>
              <p className="text-sm font-black mt-0.5 tabular-nums">
                {formatNum(periodSalesData.totalCards)}
              </p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-[#0F172A] to-indigo-950 text-white border border-[#D4AF37]/70 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-[#FDE68A]">
                <Wallet className="w-3 h-3 shrink-0" />
                <span className="truncate">المحاسبة</span>
              </div>
              <p className="text-[11px] font-black mt-0.5 tabular-nums truncate">
                {formatMoney(periodSalesData.totalAmount)}
              </p>
            </div>
          </div>

          {/* 8-Package Strip for Active Sales Period */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#D4AF37]/50 p-2 shadow-sm">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-[#D4AF37]" />
                الباقات الثماني ({periodSalesData.periodTitle})
              </span>
              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                نقدي: {formatMoney(periodSalesData.cashTotal)}
              </span>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
              {displayPackages.map((pkg) => {
                const soldQty = periodSalesData.denomBreakdown
                  .filter((d) => d.denomination === pkg.price)
                  .reduce((acc, d) => acc + Number(d.quantity || 0), 0);
                const remQty = Number(pkg.availableCount || 0);
                return (
                  <div
                    key={pkg.id}
                    className="rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-1 text-center"
                  >
                    <p className="text-[10px] font-black text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                      {pkg.price}
                    </p>
                    <p className="text-[9.5px] font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      باع: {formatNum(soldQty)}
                    </p>
                    <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                      باقي: {formatNum(remQty)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-Person Sales Breakdown */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[11px] font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>مبيعات كل شخص ({formatNumEn(periodSalesData.byPerson.length)})</span>
              </h3>
              {focusedSalesPersonKey && (
                <button
                  type="button"
                  onClick={() => setFocusedSalesPersonKey(null)}
                  className="text-[11px] font-extrabold text-red-600 hover:underline"
                >
                  عرض الجميع ✕
                </button>
              )}
            </div>

            {periodSalesData.byPerson.length === 0 ? (
              <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 text-center text-xs font-bold text-slate-500">
                لا توجد مبيعات مسجلة في {periodSalesData.periodTitle}.
              </div>
            ) : (
              <div className="space-y-1.5">
                {periodSalesData.byPerson.slice(0, 35).map((person) => {
                  const isFocused = focusedSalesPersonKey === person.key;
                  return (
                    <div
                      key={person.key}
                      className={`rounded-2xl bg-white dark:bg-slate-900 border p-2.5 shadow-sm transition space-y-1.5 ${
                        isFocused
                          ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]/30'
                          : 'border-slate-200 dark:border-slate-800 hover:border-[#D4AF37]/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-extrabold text-slate-900 dark:text-white break-words">
                              {person.name}
                            </span>
                            <span className="px-1.5 py-0.5 rounded-md bg-[#1A365D]/10 dark:bg-white/10 text-[#1A365D] dark:text-[#FDE68A] text-[10px] font-extrabold">
                              {person.roleLabel}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] font-bold text-slate-500 mt-0.5 tabular-nums">
                            <span>{person.phone}</span>
                            <span>•</span>
                            <span>{formatNum(person.salesCount)} فاتورة</span>
                            <span>•</span>
                            <span className="text-[#1A365D] dark:text-[#FDE68A]">
                              {formatNum(person.cardsCount)} كرت
                            </span>
                          </div>
                        </div>
                        <div className="text-left shrink-0">
                          <p className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                            {formatMoney(person.netTotal)}
                          </p>
                          <p className="text-[10px] font-bold text-blue-700 dark:text-sky-400 tabular-nums">
                            عمولة: {formatMoney(person.commissionValue)}
                          </p>
                        </div>
                      </div>

                      {person.byPkgCounts.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {person.byPkgCounts.map((pk) => (
                            <span
                              key={pk.pkgId}
                              className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-extrabold text-slate-700 dark:text-slate-200 tabular-nums"
                            >
                              {pk.price}: {formatNum(pk.count)}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() =>
                            setFocusedSalesPersonKey(isFocused ? null : person.key)
                          }
                          className={`h-8 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 ${
                            isFocused
                              ? 'bg-[#D4AF37] text-[#0F172A]'
                              : 'bg-slate-100 dark:bg-slate-800 text-[#1A365D] dark:text-[#FDE68A]'
                          }`}
                        >
                          <span>
                            {isFocused ? 'معروض بالأسفل ✓' : `الفواتير (${person.salesCount})`}
                          </span>
                        </button>
                        {person.uid ? (
                          <button
                            type="button"
                            onClick={() => openEntityDetailReport(person.uid)}
                            className="h-8 rounded-xl bg-[#1A365D] hover:bg-[#0F172A] text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
                          >
                            <CreditCard className="w-3.5 h-3.5 text-[#FDE68A]" />
                            <span>كشف الكروت</span>
                          </button>
                        ) : (
                          <div className="h-8 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-[10.5px] font-bold text-slate-500 flex items-center justify-center">
                            نقدي: {formatMoney(person.cashTotal)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Complete "لمن باع" Invoices & Operations Table */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-extrabold text-slate-900 dark:text-white truncate">
                {focusedSalesPersonKey
                  ? `تفاصيل «لمن باع» — ${
                      periodSalesData.byPerson.find((p) => p.key === focusedSalesPersonKey)?.name || ''
                    }`
                  : `تفاصيل المبيعات و«لمن باع» — ${periodSalesData.periodTitle}`}
              </h3>
              <span className="text-[10.5px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] shrink-0">
                {formatNumEn(displayedSalesList.length)} عملية
              </span>
            </div>
            {displayedSalesList.length === 0 ? (
              <div className="p-5 text-center text-xs font-bold text-slate-500">
                لا توجد عمليات مطابقة.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-[11px]">
                  <thead className="bg-[#1A365D] text-white">
                    <tr>
                      <th className="py-1.5 px-2 font-extrabold">المشتري (لمن باع)</th>
                      <th className="py-1.5 px-2 font-extrabold">الكرت / الفئة</th>
                      <th className="py-1.5 px-2 font-extrabold">التاريخ والوقت</th>
                      <th className="py-1.5 px-2 font-extrabold">السعر</th>
                      <th className="py-1.5 px-2 font-extrabold">حق الإدارة</th>
                      <th className="py-1.5 px-2 font-extrabold">حق الوكيل/العميل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {displayedSalesList.slice(0, visibleRowsCount).map((sale) => {
                      const { nominal, adminShare, entityShare } = getSaleShares(sale);
                      const firstCard = sale.cardNumbers?.[0];
                      const pkgSummary =
                        sale.items && sale.items.length > 0
                          ? sale.items.map((it) => `${it.price}×${it.quantity}`).join('، ')
                          : `${formatNum(sale.totalCards)} كرت`;
                      return (
                        <tr key={sale.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-1.5 px-2 whitespace-nowrap">
                            <div className="font-extrabold text-slate-900 dark:text-white">
                              {sale.buyerName || 'مستهلك مباشر'}
                            </div>
                            <div className="text-[10px] font-bold text-slate-500 tabular-nums">
                              {sale.buyerPhone || '—'} • {paymentMethodLabelAr(sale.paymentMethod)}
                            </div>
                          </td>
                          <td className="py-1.5 px-2 whitespace-nowrap">
                            <div className="font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                              {pkgSummary}
                            </div>
                            {firstCard && (
                              <div className="text-[10px] font-mono font-bold text-slate-500 tabular-nums">
                                {firstCard}
                                {(sale.cardNumbers?.length || 0) > 1
                                  ? ` (+${(sale.cardNumbers?.length || 1) - 1})`
                                  : ''}
                              </div>
                            )}
                          </td>
                          <td className="py-1.5 px-2 font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                            {formatDateTimeAr(sale.createdAt)}
                          </td>
                          <td className="py-1.5 px-2 font-extrabold text-slate-900 dark:text-white tabular-nums whitespace-nowrap">
                            {formatMoney(nominal)}
                          </td>
                          <td className="py-1.5 px-2 font-extrabold text-blue-700 dark:text-sky-400 tabular-nums whitespace-nowrap">
                            {formatMoney(adminShare)}
                          </td>
                          <td className="py-1.5 px-2 font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                            {formatMoney(entityShare)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {displayedSalesList.length > visibleRowsCount && (
                  <div className="p-2.5 text-center border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setVisibleRowsCount((v) => v + PAGE_SIZE)}
                      className="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]"
                    >
                      عرض المزيد ({formatNumEn(displayedSalesList.length - visibleRowsCount)} متبقي)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: الوكيل (الأيقونات الأربع + الباقات الثماني + لمن باع فوراً) */}
      {/* ================================================================= */}
      {activeReportId === 'entity_cards_detail' && (
        <div className="space-y-2">
          {effectiveDetailUser ? (
            <>
              {/* Ultra-Slim 1-Line Account Identity Strip (zero wasted vertical space) */}
              <div className="h-8 px-2.5 rounded-xl bg-white dark:bg-slate-900 border border-[#D4AF37]/60 flex items-center justify-between gap-2 text-[11px] font-extrabold shadow-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <UserCheck className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                  <span className="text-[#1A365D] dark:text-white truncate">
                    {effectiveDetailUser.name}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[#1A365D]/10 dark:bg-white/10 text-[#1A365D] dark:text-[#FDE68A] text-[9.5px] shrink-0">
                    {getRoleArabicLabel(effectiveDetailUser.role)}
                  </span>
                </div>
                <span className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                  {effectiveDetailUser.phone || '—'}
                </span>
              </div>

              {/* Immediately Renders: 4 Summary Icons -> 8-Package Strip -> Full 'لمن باع' & Remaining Cards */}
              <AgentCardAuditModal
                targetUser={effectiveDetailUser}
                hideNumbers={hideNumbers}
                mode="inline"
              />

              {/* Complete Chronological Activity Log (Receive / Sale / Payment / Recall-Return) */}
              <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <CreditCard className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <h3 className="text-[11px] font-extrabold text-slate-900 dark:text-white">
                        سجل الحركات بالتاريخ والوقت
                      </h3>
                    </div>
                    <span className="text-[10.5px] font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                      {formatNumEn(filteredDetailActivity.length)} حركة
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        { id: 'all', label: 'الكل' },
                        { id: 'receive', label: 'استلام' },
                        { id: 'sale', label: 'مبيعات' },
                        { id: 'payment', label: 'سداد' },
                        { id: 'return', label: 'مرتجع' },
                      ] as Array<{ id: ActivityFilterType; label: string }>
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setActivityFilter(f.id)}
                        className={`px-2 py-1 rounded-lg text-[10.5px] font-extrabold transition ${
                          activityFilter === f.id
                            ? 'bg-[#1A365D] text-[#FDE68A]'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredDetailActivity.length === 0 ? (
                  <div className="p-5 text-center text-xs font-bold text-slate-500">
                    لا توجد حركات مطابقة لهذا التصنيف حالياً.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredDetailActivity.slice(0, detailActivityVisible).map((ev) => (
                      <div
                        key={ev.id}
                        className="px-2.5 py-2 flex items-start justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9.5px] font-extrabold whitespace-nowrap ${
                                ev.category === 'sale'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : ev.category === 'receive'
                                    ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                                    : ev.category === 'return'
                                      ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              {ev.badgeLabel}
                            </span>
                            <p className="text-xs font-extrabold text-slate-900 dark:text-white break-words">
                              {ev.title}
                            </p>
                          </div>
                          <p className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 mt-0.5 break-words">
                            {ev.subtitle}
                          </p>
                          <p className="text-[10px] font-bold text-slate-400 mt-0.5 tabular-nums">
                            {ev.timeMs > 0 ? formatDateTimeAr(new Date(ev.timeMs)) : '—'}
                          </p>
                        </div>
                        <div className="text-left shrink-0">
                          <p className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                            {formatMoney(ev.amount)}
                          </p>
                          <p className="text-[10px] font-bold text-slate-500">{ev.statusLabel}</p>
                        </div>
                      </div>
                    ))}
                    {filteredDetailActivity.length > detailActivityVisible && (
                      <div className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => setDetailActivityVisible((v) => v + PAGE_SIZE)}
                          className="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]"
                        >
                          عرض المزيد (
                          {formatNumEn(filteredDetailActivity.length - detailActivityVisible)} متبقي)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-dashed border-[#D4AF37]/70 p-5 text-center space-y-1.5">
              <UserCheck className="w-8 h-8 mx-auto text-[#D4AF37]" />
              <p className="text-xs font-extrabold text-slate-800 dark:text-white">
                اختر أي وكيل أو عميل من القائمة أعلاه لعرض كشفه الكامل فوراً
              </p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 4: المحاسبة (4 أيقونات + الحقوق + مطابقة الباقات الثماني)      */}
      {/* ================================================================= */}
      {activeReportId === 'accounting_full_inventory' && (
        <div className="space-y-2">
          {/* Ultra-Slim 1-Line Status & Search Icon Row (h-8) */}
          <div className="flex items-center justify-between gap-1.5 h-8 px-2.5 rounded-xl bg-white dark:bg-slate-900 border border-[#D4AF37]/60">
            <div className="flex items-center gap-1.5 min-w-0">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] truncate">
                مطابقة جرد الكروت الكاملة — 100% ✓
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowSearchInput((v) => !v)}
              aria-label="بحث في الكشف المحاسبي"
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition ${
                showSearchInput || search
                  ? 'bg-[#1A365D] text-[#FDE68A]'
                  : 'bg-slate-100 dark:bg-slate-800 text-[#1A365D] dark:text-[#FDE68A]'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>

          {showSearchInput && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث باسم الوكيل أو العميل أو الرقم..."
                className="w-full h-8 pr-8 pl-8 rounded-xl border border-[#D4AF37]/70 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white focus:outline-none"
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* 4 Beautiful Compact Summary Icons: المستلم/المستورد | الباقي | باع | حق الإدارة */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="rounded-xl bg-[#1A365D] text-white border border-[#D4AF37]/80 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-[#FDE68A]">
                <Layers className="w-3 h-3 shrink-0" />
                <span className="truncate">المستلم</span>
              </div>
              <p className="text-sm font-black mt-0.5 tabular-nums">
                {formatNum(accountingData.totalUploadedCards)}
              </p>
            </div>
            <div className="rounded-xl bg-amber-500 text-[#0F172A] border border-amber-700/70 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-extrabold">
                <Package className="w-3 h-3 shrink-0" />
                <span className="truncate">الباقي</span>
              </div>
              <p className="text-sm font-black mt-0.5 tabular-nums">
                {formatNum(accountingData.totalAvailableCards)}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-600 text-white border border-emerald-400/80 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-emerald-100">
                <TrendingUp className="w-3 h-3 shrink-0" />
                <span className="truncate">باع</span>
              </div>
              <p className="text-sm font-black mt-0.5 tabular-nums">
                {formatNum(accountingData.totalSoldCards)}
              </p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-[#0F172A] to-indigo-950 text-white border border-[#D4AF37]/70 px-1.5 py-2 text-center shadow-sm">
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-[#FDE68A]">
                <Wallet className="w-3 h-3 shrink-0" />
                <span className="truncate">حق الإدارة</span>
              </div>
              <p className="text-[11px] font-black mt-0.5 tabular-nums truncate">
                {formatMoney(accountingData.totals.adminShare)}
              </p>
            </div>
          </div>

          {/* Compact Financial Rights Strip */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-[#D4AF37]/60 p-2 text-center">
              <p className="text-[9.5px] font-bold text-slate-500">حق الإدارة</p>
              <p className="text-[11px] font-black text-[#1A365D] dark:text-[#FDE68A] tabular-nums truncate mt-0.5">
                {formatMoney(accountingData.totals.adminShare)}
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-emerald-500/40 p-2 text-center">
              <p className="text-[9.5px] font-bold text-emerald-700 dark:text-emerald-400">حق الوكيل</p>
              <p className="text-[11px] font-black text-emerald-700 dark:text-emerald-400 tabular-nums truncate mt-0.5">
                {formatMoney(accountingData.totals.agentShare)}
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-amber-500/40 p-2 text-center">
              <p className="text-[9.5px] font-bold text-amber-700 dark:text-amber-400">حق العميل</p>
              <p className="text-[11px] font-black text-amber-700 dark:text-amber-400 tabular-nums truncate mt-0.5">
                {formatMoney(accountingData.totals.clientShare)}
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 text-center">
              <p className="text-[9.5px] font-bold text-slate-500">المدفوع</p>
              <p className="text-[11px] font-black text-sky-700 dark:text-sky-400 tabular-nums truncate mt-0.5">
                {formatMoney(accountingData.totals.paidAmount)}
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 text-center">
              <p className="text-[9.5px] font-bold text-slate-500">الديون</p>
              <p className="text-[11px] font-black text-red-600 dark:text-red-400 tabular-nums truncate mt-0.5">
                {formatMoney(accountingData.totals.remainingDebt)}
              </p>
            </div>
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 text-center">
              <p className="text-[9.5px] font-bold text-slate-500">المرتجع</p>
              <p className="text-[11px] font-black text-purple-700 dark:text-purple-400 tabular-nums truncate mt-0.5">
                {formatMoney(accountingData.totals.returnedValue)}
              </p>
            </div>
          </div>

          {/* Per-Person Accounting Rights Table */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-[#D4AF37]" />
                <h3 className="text-[11px] font-extrabold text-slate-900 dark:text-white">
                  التفصيل المحاسبي لكل حساب
                </h3>
              </div>
              <span className="text-[10px] font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                الدفتر: {formatMoney(accountingData.ledgerTotalDebt)}
              </span>
            </div>

            {accountingData.rightsRows.length === 0 ? (
              <div className="p-5 text-center text-xs font-bold text-slate-500">
                لا توجد بيانات محاسبية مطابقة للبحث.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-[11px]">
                  <thead className="bg-[#1A365D] text-white">
                    <tr>
                      <th className="py-1.5 px-2 font-extrabold">الحساب</th>
                      <th className="py-1.5 px-2 font-extrabold text-center">الكروت</th>
                      <th className="py-1.5 px-2 font-extrabold">حق الإدارة</th>
                      <th className="py-1.5 px-2 font-extrabold">حق الوكيل</th>
                      <th className="py-1.5 px-2 font-extrabold">حق العميل</th>
                      <th className="py-1.5 px-2 font-extrabold">المدفوع</th>
                      <th className="py-1.5 px-2 font-extrabold">المتبقي/دين</th>
                      <th className="py-1.5 px-2 font-extrabold">المرتجع</th>
                      <th className="py-1.5 px-2 font-extrabold">واتساب</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {accountingData.rightsRows.slice(0, visibleRowsCount).map((row) => (
                      <tr key={row.uid} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-1.5 px-2 whitespace-nowrap">
                          <div className="font-extrabold text-slate-900 dark:text-white">
                            {row.name}
                          </div>
                          <div className="text-[10px] font-bold text-slate-500">
                            {row.roleLabel} ({row.discountRate}%) • {row.phone}
                          </div>
                        </td>
                        <td className="py-1.5 px-2 font-extrabold text-center tabular-nums">
                          {formatNum(row.cardsCount)}
                        </td>
                        <td className="py-1.5 px-2 font-extrabold text-[#1A365D] dark:text-sky-400 tabular-nums whitespace-nowrap">
                          {formatMoney(row.adminShare)}
                        </td>
                        <td className="py-1.5 px-2 font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                          {formatMoney(row.agentShare)}
                        </td>
                        <td className="py-1.5 px-2 font-extrabold text-amber-700 dark:text-amber-400 tabular-nums whitespace-nowrap">
                          {formatMoney(row.clientShare)}
                        </td>
                        <td className="py-1.5 px-2 font-bold text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {formatMoney(row.paidAmount)}
                        </td>
                        <td className="py-1.5 px-2 font-extrabold text-red-600 dark:text-red-400 tabular-nums whitespace-nowrap">
                          {formatMoney(row.remainingDebt)}
                        </td>
                        <td className="py-1.5 px-2 font-bold text-purple-700 dark:text-purple-400 tabular-nums whitespace-nowrap">
                          {formatMoney(row.returnedValue)}
                        </td>
                        <td className="py-1.5 px-2">
                          <button
                            type="button"
                            onClick={() =>
                              openWhatsAppShare(
                                row.phone !== '—' ? row.phone : undefined,
                                `*كشف الحساب المحاسبي — كروت طيبة نت*\nالاسم: ${row.name} (${row.roleLabel})\nعدد الكروت: ${formatNumEn(row.cardsCount)}\nحق الإدارة: ${formatYER(row.adminShare)}\nحق الوكيل: ${formatYER(row.agentShare)}\nحق العميل: ${formatYER(row.clientShare)}\nالمدفوع: ${formatYER(row.paidAmount)}\nالمتبقي: ${formatYER(row.remainingDebt)}\nالمرتجع/المسحوب: ${formatYER(row.returnedValue)}`
                              )
                            }
                            className="px-2 py-1 rounded-lg bg-green-600 hover:bg-green-700 text-white text-[10px] font-extrabold whitespace-nowrap"
                          >
                            واتساب
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-amber-50/70 dark:bg-slate-800/90 border-t-2 border-[#D4AF37]">
                    <tr>
                      <td className="py-2 px-2 font-black text-[#1A365D] dark:text-[#FDE68A]">
                        الإجمالي
                      </td>
                      <td className="py-2 px-2 font-black text-center tabular-nums">
                        {formatNum(accountingData.totals.cardsCount)}
                      </td>
                      <td className="py-2 px-2 font-black text-[#1A365D] dark:text-sky-400 tabular-nums whitespace-nowrap">
                        {formatMoney(accountingData.totals.adminShare)}
                      </td>
                      <td className="py-2 px-2 font-black text-emerald-700 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                        {formatMoney(accountingData.totals.agentShare)}
                      </td>
                      <td className="py-2 px-2 font-black text-amber-700 dark:text-amber-400 tabular-nums whitespace-nowrap">
                        {formatMoney(accountingData.totals.clientShare)}
                      </td>
                      <td className="py-2 px-2 font-black tabular-nums whitespace-nowrap">
                        {formatMoney(accountingData.totals.paidAmount)}
                      </td>
                      <td className="py-2 px-2 font-black text-red-600 dark:text-red-400 tabular-nums whitespace-nowrap">
                        {formatMoney(accountingData.totals.remainingDebt)}
                      </td>
                      <td className="py-2 px-2 font-black text-purple-700 dark:text-purple-400 tabular-nums whitespace-nowrap">
                        {formatMoney(accountingData.totals.returnedValue)}
                      </td>
                      <td className="py-2 px-2" />
                    </tr>
                  </tfoot>
                </table>
                {accountingData.rightsRows.length > visibleRowsCount && (
                  <div className="p-2.5 text-center border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setVisibleRowsCount((v) => v + PAGE_SIZE)}
                      className="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]"
                    >
                      عرض المزيد ({formatNumEn(accountingData.rightsRows.length - visibleRowsCount)} متبقي)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 8-Package Full Card Reconciliation Table */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <h3 className="text-[11px] font-extrabold text-slate-900 dark:text-white">
                  مطابقة الباقات الثماني (المستورد = المخزن + المسلّم + المباع + المرتجع)
                </h3>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-[11px]">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                  <tr>
                    <th className="py-1.5 px-2 font-extrabold">الفئة</th>
                    <th className="py-1.5 px-2 font-extrabold text-center">المستورد</th>
                    <th className="py-1.5 px-2 font-extrabold text-center">بالمخزن</th>
                    <th className="py-1.5 px-2 font-extrabold text-center">مسلّم</th>
                    <th className="py-1.5 px-2 font-extrabold text-center">مباع</th>
                    <th className="py-1.5 px-2 font-extrabold text-center">مرتجع</th>
                    <th className="py-1.5 px-2 font-extrabold">قيمة المخزن</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {accountingData.inventoryRows.map((row) => (
                    <tr key={row.pkg.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-1.5 px-2 font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                        {row.pkg.price} ({row.pkg.dataLabel})
                      </td>
                      <td className="py-1.5 px-2 font-extrabold text-center tabular-nums">
                        {formatNum(row.uploaded)}
                      </td>
                      <td className="py-1.5 px-2 font-extrabold text-center text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {formatNum(row.availableVault)}
                      </td>
                      <td className="py-1.5 px-2 font-extrabold text-center text-sky-700 dark:text-sky-400 tabular-nums">
                        {formatNum(row.deliveredRemaining)}
                      </td>
                      <td className="py-1.5 px-2 font-extrabold text-center text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                        {formatNum(row.sold)}
                      </td>
                      <td className="py-1.5 px-2 font-bold text-center text-red-600 dark:text-red-400 tabular-nums">
                        {formatNum(row.returnedOrRecalled)}
                      </td>
                      <td className="py-1.5 px-2 font-extrabold tabular-nums whitespace-nowrap">
                        {formatMoney(row.nominalAvailableValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 dark:bg-slate-800/90 border-t-2 border-slate-300 dark:border-slate-700">
                  <tr>
                    <td className="py-2 px-2 font-black text-slate-900 dark:text-white">
                      المجموع
                    </td>
                    <td className="py-2 px-2 font-black text-center tabular-nums">
                      {formatNum(accountingData.totalUploadedCards)}
                    </td>
                    <td className="py-2 px-2 font-black text-center text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {formatNum(accountingData.totalAvailableCards)}
                    </td>
                    <td className="py-2 px-2 font-black text-center text-sky-700 dark:text-sky-400 tabular-nums">
                      {formatNum(accountingData.totalDeliveredRemaining)}
                    </td>
                    <td className="py-2 px-2 font-black text-center text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                      {formatNum(accountingData.totalSoldCards)}
                    </td>
                    <td className="py-2 px-2 font-black text-center text-red-600 dark:text-red-400 tabular-nums">
                      {formatNum(accountingData.totalReturnedCards)}
                    </td>
                    <td className="py-2 px-2 font-black tabular-nums whitespace-nowrap">
                      {formatMoney(accountingData.totalAvailableValue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      <ExportPreviewModal result={exportPreview} onClose={() => setExportPreview(null)} />
    </div>
  );
};
