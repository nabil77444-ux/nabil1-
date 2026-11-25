import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileDown,
  FileSpreadsheet,
  Filter,
  ImageDown,
  Layers,
  MessageSquare,
  Printer,
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
  exportAsExcel,
  exportAsHDImage,
  openSmsShare,
  openWhatsAppShare,
  printRoyalDocument,
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
  TAIBAH_ASSETS,
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

type InventoryGranularity = 'daily' | 'monthly';
type SalesPeriodTab = 'today' | 'week' | 'month' | 'all';
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
    shortTitle: 'الجرد اليومي والشهري',
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
    shortTitle: 'مبيعات الفترات',
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
    shortTitle: 'كشف الوكيل والعميل',
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
    shortTitle: 'التقارير المحاسبية',
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

  // Report 1 state (Daily / Monthly Inventory)
  const [invGranularity, setInvGranularity] = useState<InventoryGranularity>('daily');
  const [selectedDayIso, setSelectedDayIso] = useState<string>(() => toLocalIsoDate(new Date()));
  const [selectedMonthIso, setSelectedMonthIso] = useState<string>(() => toLocalIsoMonth(new Date()));
  const [expandedInvPersonKey, setExpandedInvPersonKey] = useState<string | null>(null);

  // Report 2 state (Today / Week / Month / All Sales)
  const [salesPeriod, setSalesPeriod] = useState<SalesPeriodTab>('today');
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');
  const [focusedSalesPersonKey, setFocusedSalesPersonKey] = useState<string | null>(null);

  // Report 3 state (Entity Detail)
  const [entitySearch, setEntitySearch] = useState('');
  const debouncedEntitySearch = useDebounce(entitySearch, 160);
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
      invGranularity === 'daily'
        ? new Date(`${selectedDayIso}T00:00:00`).getTime()
        : new Date(`${selectedMonthIso}-01T00:00:00`).getTime();

    const endMs = (() => {
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
      if (ms < startMs || ms > endMs) return false;
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
      invGranularity === 'daily'
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
    return null;
  }, [selectedAccount, isAdmin, isAgent, profile]);

  const filteredEntityChoices = useMemo(() => {
    const q = debouncedEntitySearch.trim().toLowerCase();
    if (!q) return selectableAccounts;
    return selectableAccounts.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        normalizeDigits(u.phone || '').includes(normalizeDigits(q))
    );
  }, [selectableAccounts, debouncedEntitySearch]);

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

  const handleExport = async (kind: 'pdf' | 'image' | 'excel' | 'print' | 'whatsapp' | 'sms') => {
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
      } else if (kind === 'image') {
        const res = await exportAsHDImage(payload);
        if (res && !res.sharedNatively) setExportPreview(res);
        notifySuccess('تم تجهيز صورة التقرير عالية الدقة بنجاح');
      } else if (kind === 'excel') {
        await exportAsExcel(
          payload.title,
          payload.tableHeaders,
          payload.tableRows,
          payload.fileName
        );
        notifySuccess('تم تصدير ملف Excel بنجاح');
      } else if (kind === 'print') {
        void printRoyalDocument(payload);
      } else if (kind === 'whatsapp') {
        openWhatsAppShare(payload.sharePhone, payload.shareText || payload.title);
      } else if (kind === 'sms') {
        openSmsShare(payload.sharePhone || '', payload.shareText || payload.title);
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
            <p className="text-[9.5px] font-bold text-slate-500 truncate">مبيعات اليوم</p>
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
                className="royal-tile-3d relative rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/75 hover:border-[#D4AF37] h-[118px] sm:h-[124px] p-3 shadow-md hover:shadow-lg active:scale-[0.98] transition flex flex-col items-center justify-center gap-2.5 text-center"
              >
                {/* Minimal Elegant Corner Number */}
                <span className="absolute top-2 left-2 w-5 h-5 rounded-full bg-amber-50 dark:bg-slate-800 border border-[#D4AF37]/70 text-[10px] font-black text-[#1A365D] dark:text-[#FDE68A] flex items-center justify-center tabular-nums">
                  {rep.num}
                </span>

                {/* Prominent Luxury Gradient Icon */}
                <div
                  className={`w-13 h-13 rounded-2xl bg-gradient-to-br ${rep.accent} text-white flex items-center justify-center border-2 border-[#D4AF37]/80 shadow-md`}
                >
                  <IconComp className="w-7 h-7 text-[#FDE68A]" />
                </div>

                {/* Concise Bold Arabic Title Only */}
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

  const activeMeta = FOUR_CORE_REPORTS.find((r) => r.id === activeReportId)!;

  // =========================================================================
  // ACTIVE REPORT DETAILED SCREEN (pb-24 so footer never overlaps)
  // =========================================================================
  return (
    <div dir="rtl" className="space-y-3.5 pb-24">
      {/* Compact Sticky-Style Report Header + 4-Tab Switcher + Persistent Filter + Exports */}
      <div className="rounded-2xl bg-gradient-to-br from-[#1A365D] via-[#0F172A] to-[#1A365D] text-white p-3 border-2 border-[#D4AF37]/80 shadow-lg space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setActiveReportId(null)}
              className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center shrink-0 transition"
              aria-label="العودة لمركز التقارير"
            >
              <ArrowRight className="w-5 h-5 text-[#FDE68A]" />
            </button>
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold truncate">{activeMeta.title}</h2>
              <p className="text-[10.5px] font-bold text-[#FDE68A]/90 truncate">
                {selectedAccount
                  ? `مصفّى على: ${selectedAccount.name} (${getRoleArabicLabel(selectedAccount.role)})`
                  : activeMeta.subtitle}
              </p>
            </div>
          </div>

          <img
            src={TAIBAH_ASSETS.logo}
            alt="شعار طيبة نت"
            className="w-9 h-9 rounded-xl object-cover border border-[#D4AF37] shrink-0 hidden sm:block"
          />
        </div>

        {/* Fast Switcher Between the 4 Reports */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {FOUR_CORE_REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveReportId(r.id)}
              className={`px-2 py-1.5 rounded-xl text-[11px] font-extrabold transition truncate border ${
                activeReportId === r.id
                  ? 'bg-[#D4AF37] text-[#0F172A] border-[#FDE68A]'
                  : 'bg-white/10 text-white border-white/15 hover:bg-white/20'
              }`}
            >
              {r.num}. {r.shortTitle}
            </button>
          ))}
        </div>

        {/* Persistent Filter + Universal Export Bar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
          {(isAdmin || isAgent) && selectableAccounts.length > 0 && (
            <select
              value={selectedEntityUid}
              onChange={(e) => setSelectedEntityUid(e.target.value)}
              className="md:w-64 rounded-xl bg-white text-[#0F172A] px-2.5 py-1.5 text-xs font-extrabold border border-[#D4AF37] focus:outline-none"
            >
              <option value="all">الكل (الإدارة وجميع الوكلاء والعملاء)</option>
              {selectableAccounts.map((acc) => (
                <option key={acc.uid} value={acc.uid}>
                  {acc.name} — {getRoleArabicLabel(acc.role)} ({acc.phone || '—'})
                </option>
              ))}
            </select>
          )}

          <div className="flex flex-wrap items-center gap-1.5 flex-1 justify-end">
            <button
              type="button"
              disabled={Boolean(exportingKind)}
              onClick={() => void handleExport('pdf')}
              className="px-2.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-extrabold flex items-center gap-1"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              disabled={Boolean(exportingKind)}
              onClick={() => void handleExport('image')}
              className="px-2.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-extrabold flex items-center gap-1"
            >
              <ImageDown className="w-3.5 h-3.5" />
              <span>صورة HD</span>
            </button>
            <button
              type="button"
              disabled={Boolean(exportingKind)}
              onClick={() => void handleExport('excel')}
              className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold flex items-center gap-1"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              disabled={Boolean(exportingKind)}
              onClick={() => void handleExport('print')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-extrabold flex items-center gap-1"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة</span>
            </button>
            <button
              type="button"
              disabled={Boolean(exportingKind)}
              onClick={() => void handleExport('whatsapp')}
              className="px-2.5 py-1.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-[11px] font-extrabold flex items-center gap-1"
            >
              <Send className="w-3.5 h-3.5" />
              <span>واتساب</span>
            </button>
            <button
              type="button"
              disabled={Boolean(exportingKind)}
              onClick={() => void handleExport('sms')}
              className="px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-extrabold flex items-center gap-1"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>SMS</span>
            </button>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* ICON 1: الجرد اليومي والشهري (تفصيل كل فئة وكل شخص على حدة)       */}
      {/* ================================================================= */}
      {activeReportId === 'daily_monthly_inventory' && (
        <div className="space-y-3.5">
          {/* Toggle Daily / Monthly + Picker + Search */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="grid grid-cols-2 gap-1.5 sm:w-52">
              <button
                type="button"
                onClick={() => setInvGranularity('daily')}
                className={`py-2 rounded-xl text-xs font-extrabold border transition ${
                  invGranularity === 'daily'
                    ? 'bg-[#1A365D] text-white border-[#D4AF37]'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-transparent'
                }`}
              >
                الجرد اليومي
              </button>
              <button
                type="button"
                onClick={() => setInvGranularity('monthly')}
                className={`py-2 rounded-xl text-xs font-extrabold border transition ${
                  invGranularity === 'monthly'
                    ? 'bg-[#1A365D] text-white border-[#D4AF37]'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-transparent'
                }`}
              >
                الجرد الشهري
              </button>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-extrabold text-slate-600 dark:text-slate-300 shrink-0">
                {invGranularity === 'daily' ? 'التاريخ:' : 'الشهر:'}
              </label>
              {invGranularity === 'daily' ? (
                <input
                  type="date"
                  value={selectedDayIso}
                  onChange={(e) => setSelectedDayIso(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-extrabold text-slate-900 dark:text-white"
                />
              ) : (
                <input
                  type="month"
                  value={selectedMonthIso}
                  onChange={(e) => setSelectedMonthIso(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-extrabold text-slate-900 dark:text-white"
                />
              )}
            </div>

            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث باسم الوكيل أو العميل أو الرقم..."
                className="w-full pr-9 pl-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* KPI Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] font-bold text-slate-500">الكروت المباعة/المسلّمة</p>
              <p className="text-base font-extrabold text-[#1A365D] dark:text-[#FDE68A] mt-0.5 tabular-nums">
                {formatNum(inventoryData.totalCards)} كرت
              </p>
              <p className="text-[10px] font-bold text-slate-400">
                {formatNum(inventoryData.periodSales.length)} عملية
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] font-bold text-slate-500">القيمة المالية الإجمالية</p>
              <p className="text-base font-extrabold text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                {formatMoney(inventoryData.totalRevenue)}
              </p>
              <p className="text-[10px] font-bold text-emerald-600">
                محصّل: {formatMoney(inventoryData.totalPaid)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] font-bold text-slate-500">المتبقي (آجل)</p>
              <p className="text-base font-extrabold text-red-600 dark:text-red-400 mt-0.5 tabular-nums">
                {formatMoney(inventoryData.totalRemaining)}
              </p>
              <p className="text-[10px] font-bold text-slate-400">{inventoryData.periodLabel}</p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] font-bold text-slate-500">المتبقي في المخزن</p>
              <p className="text-base font-extrabold text-blue-700 dark:text-sky-400 mt-0.5 tabular-nums">
                {formatNum(inventoryData.totalAvailableStock)} كرت
              </p>
              <p className="text-[10px] font-bold text-slate-400">عبر الباقات الثماني</p>
            </div>
          </div>

          {/* 8 Packages Breakdown Table */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-xs font-extrabold text-slate-900 dark:text-white">
                  جرد الباقات الثماني (100 → 3000) — {inventoryData.periodLabel}
                </h3>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-[#1A365D] text-white">
                  <tr>
                    <th className="py-2 px-2.5 font-extrabold">الفئة والباقة</th>
                    <th className="py-2 px-2.5 font-extrabold">المستلم</th>
                    <th className="py-2 px-2.5 font-extrabold">المباع</th>
                    <th className="py-2 px-2.5 font-extrabold">المتبقي</th>
                    <th className="py-2 px-2.5 font-extrabold">القيمة المالية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {inventoryData.packageRows.map((row) => (
                    <tr key={row.pkg.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-2.5 font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                        فئة {row.pkg.price} ({row.pkg.dataLabel})
                      </td>
                      <td className="py-2 px-2.5 font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                        {formatNum(row.receivedQty)}
                      </td>
                      <td className="py-2 px-2.5 font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {formatNum(row.soldQty)}
                      </td>
                      <td className="py-2 px-2.5 font-extrabold text-blue-700 dark:text-sky-400 tabular-nums">
                        {formatNum(row.remainingQty)}
                      </td>
                      <td className="py-2 px-2.5 font-extrabold text-slate-900 dark:text-white tabular-nums">
                        {formatMoney(row.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-amber-50/70 dark:bg-slate-800/90 border-t-2 border-[#D4AF37]">
                  <tr>
                    <td className="py-2.5 px-2.5 font-black text-[#1A365D] dark:text-[#FDE68A]">
                      الإجمالي
                    </td>
                    <td className="py-2.5 px-2.5 font-black tabular-nums">
                      {formatNum(inventoryData.packageRows.reduce((s, r) => s + r.receivedQty, 0))}
                    </td>
                    <td className="py-2.5 px-2.5 font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {formatNum(inventoryData.totalCards)}
                    </td>
                    <td className="py-2.5 px-2.5 font-black text-blue-700 dark:text-sky-400 tabular-nums">
                      {formatNum(inventoryData.totalAvailableStock)}
                    </td>
                    <td className="py-2.5 px-2.5 font-black tabular-nums">
                      {formatMoney(inventoryData.totalRevenue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Per-Person Detailed Cards & 8-Package Breakdown */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-xs font-extrabold text-slate-900 dark:text-white">
                  جرد تفصيلي باسم كل شخص على حدة ({formatNumEn(inventoryData.personRows.length)})
                </h3>
              </div>
              <span className="text-[10.5px] font-bold text-slate-500">
                اضغط لعرض تفصيل الباقات الثماني
              </span>
            </div>

            {inventoryData.personRows.slice(0, visibleRowsCount).map((person) => {
              const isExpanded = expandedInvPersonKey === person.key;
              return (
                <div
                  key={person.key}
                  className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/50 shadow-sm overflow-hidden"
                >
                  <div className="p-3 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-extrabold text-slate-900 dark:text-white leading-snug break-words">
                            {person.name}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg bg-[#1A365D]/10 dark:bg-white/10 text-[#1A365D] dark:text-[#FDE68A] text-[10px] font-extrabold whitespace-nowrap">
                            {person.roleLabel}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-bold text-slate-500 mt-0.5 tabular-nums">
                          <span>{person.phone}</span>
                          <span>•</span>
                          <span>مستلم: {formatNum(person.receivedCards)}</span>
                          <span>•</span>
                          <span className="text-emerald-700 dark:text-emerald-400">
                            مباع: {formatNum(person.soldCards)}
                          </span>
                          <span>•</span>
                          <span className="text-blue-700 dark:text-sky-400">
                            متبقي: {formatNum(person.remainingCards)}
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

                    <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedInvPersonKey(isExpanded ? null : person.key)
                        }
                        className="min-h-[34px] rounded-xl bg-slate-100 dark:bg-slate-800 text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-1"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            <span>إخفاء تفصيل الفئات</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            <span>تفصيل الفئات الثماني</span>
                          </>
                        )}
                      </button>
                      {person.uid && person.uid !== profile?.uid ? (
                        <button
                          type="button"
                          onClick={() => openEntityDetailReport(person.uid)}
                          className="min-h-[34px] rounded-xl bg-[#1A365D] hover:bg-[#0F172A] text-white text-xs font-extrabold flex items-center justify-center gap-1"
                        >
                          <CreditCard className="w-3.5 h-3.5 text-[#FDE68A]" />
                          <span>كشف الكروت الكامل</span>
                        </button>
                      ) : (
                        <div className="min-h-[34px] rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-extrabold flex items-center justify-center">
                          {formatNum(person.salesCount)} عملية في الفترة
                        </div>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-2.5 overflow-x-auto">
                      <table className="w-full text-right text-[11px]">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                            <th className="py-1.5 px-2 font-extrabold">الفئة</th>
                            <th className="py-1.5 px-2 font-extrabold">مستلم</th>
                            <th className="py-1.5 px-2 font-extrabold">مباع</th>
                            <th className="py-1.5 px-2 font-extrabold">متبقي</th>
                            <th className="py-1.5 px-2 font-extrabold">القيمة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                          {person.byPackage.map((b) => (
                            <tr key={b.pkgId}>
                              <td className="py-1.5 px-2 font-extrabold whitespace-nowrap">
                                {b.price} ({b.dataLabel})
                              </td>
                              <td className="py-1.5 px-2 font-bold tabular-nums">{formatNum(b.received)}</td>
                              <td className="py-1.5 px-2 font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                {formatNum(b.sold)}
                              </td>
                              <td className="py-1.5 px-2 font-extrabold text-blue-700 dark:text-sky-400 tabular-nums">
                                {formatNum(b.remaining)}
                              </td>
                              <td className="py-1.5 px-2 font-extrabold tabular-nums">
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
      {/* ICON 2: مبيعات اليوم والأسبوع والشهر (كل شخص + فئاته + فواتيره)   */}
      {/* ================================================================= */}
      {activeReportId === 'period_sales' && (
        <div className="space-y-3.5">
          {/* Period Tabs + Custom Range + Search */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 shadow-sm space-y-2.5">
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  { id: 'today', label: 'اليوم' },
                  { id: 'week', label: 'الأسبوع' },
                  { id: 'month', label: 'الشهر' },
                  { id: 'all', label: 'الكل' },
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
                  className={`py-2 rounded-xl text-xs font-extrabold border transition ${
                    salesPeriod === tab.id && !customFromDate && !customToDate
                      ? 'bg-[#1A365D] text-white border-[#D4AF37]'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث باسم المشتري أو الهاتف أو الفاتورة..."
                  className="w-full pr-9 pl-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-slate-500 shrink-0">من:</span>
                <input
                  type="date"
                  value={customFromDate}
                  onChange={(e) => setCustomFromDate(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-slate-500 shrink-0">إلى:</span>
                <input
                  type="date"
                  value={customToDate}
                  onChange={(e) => setCustomToDate(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Grand Total KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-2xl bg-gradient-to-br from-[#1A365D] to-[#0F172A] text-white p-3 border border-[#D4AF37]/70">
              <p className="text-[11px] font-bold text-[#FDE68A]">الإجمالي العام ({periodSalesData.periodTitle})</p>
              <p className="text-base font-extrabold mt-0.5 tabular-nums">
                {formatMoney(periodSalesData.totalAmount)}
              </p>
              <p className="text-[10px] font-bold text-slate-300">
                {formatNum(periodSalesData.filtered.length)} فاتورة • {formatNum(periodSalesData.totalCards)} كرت
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] font-bold text-slate-500">المبيعات النقدية</p>
              <p className="text-base font-extrabold text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                {formatMoney(periodSalesData.cashTotal)}
              </p>
              <p className="text-[10px] font-bold text-emerald-600">
                محصّل: {formatMoney(periodSalesData.paidTotal)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] font-bold text-slate-500">المبيعات الآجلة</p>
              <p className="text-base font-extrabold text-amber-600 dark:text-amber-400 mt-0.5 tabular-nums">
                {formatMoney(periodSalesData.creditTotal)}
              </p>
              <p className="text-[10px] font-bold text-slate-400">آجل وجزئي</p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[11px] font-bold text-slate-500">المتبقي للتحصيل</p>
              <p className="text-base font-extrabold text-red-600 dark:text-red-400 mt-0.5 tabular-nums">
                {formatMoney(periodSalesData.remainingTotal)}
              </p>
              <p className="text-[10px] font-bold text-slate-400">مجموع المتبقي</p>
            </div>
          </div>

          {/* Per-Person Sales Breakdown (Tap any person to inspect their invoices!) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#D4AF37]" />
                <span>مبيعات كل شخص على حدة ({formatNumEn(periodSalesData.byPerson.length)})</span>
              </h3>
              {focusedSalesPersonKey && (
                <button
                  type="button"
                  onClick={() => setFocusedSalesPersonKey(null)}
                  className="text-[11px] font-extrabold text-red-600 hover:underline"
                >
                  عرض فواتير الجميع ✕
                </button>
              )}
            </div>

            {periodSalesData.byPerson.length === 0 ? (
              <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 text-center text-xs font-bold text-slate-500">
                لا توجد مبيعات مسجلة في {periodSalesData.periodTitle}.
              </div>
            ) : (
              <div className="space-y-2">
                {periodSalesData.byPerson.slice(0, 35).map((person) => {
                  const isFocused = focusedSalesPersonKey === person.key;
                  return (
                    <div
                      key={person.key}
                      className={`rounded-2xl bg-white dark:bg-slate-900 border-2 p-3 shadow-sm transition space-y-2 ${
                        isFocused
                          ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]/30'
                          : 'border-slate-200 dark:border-slate-800 hover:border-[#D4AF37]/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-extrabold text-slate-900 dark:text-white break-words">
                              {person.name}
                            </span>
                            <span className="px-2 py-0.5 rounded-lg bg-[#1A365D]/10 dark:bg-white/10 text-[#1A365D] dark:text-[#FDE68A] text-[10px] font-extrabold">
                              {person.roleLabel}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-bold text-slate-500 mt-0.5 tabular-nums">
                            <span>{person.phone}</span>
                            <span>•</span>
                            <span>{formatNum(person.salesCount)} فاتورة</span>
                            <span>•</span>
                            <span className="text-[#1A365D] dark:text-[#FDE68A]">
                              {formatNum(person.cardsCount)} كرت
                            </span>
                            <span>•</span>
                            <span>الخصم/العمولة: {person.commissionPercent}%</span>
                          </div>
                        </div>
                        <div className="text-left shrink-0">
                          <p className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                            صافي: {formatMoney(person.netTotal)}
                          </p>
                          <p className="text-[10px] font-bold text-slate-500 tabular-nums">
                            اسمي: {formatMoney(person.nominalTotal)}
                          </p>
                        </div>
                      </div>

                      {/* Sold Cards Per Denomination Chips */}
                      {person.byPkgCounts.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {person.byPkgCounts.map((pk) => (
                            <span
                              key={pk.pkgId}
                              className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10.5px] font-extrabold text-slate-700 dark:text-slate-200 tabular-nums"
                            >
                              فئة {pk.price}: {formatNum(pk.count)} كرت
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() =>
                            setFocusedSalesPersonKey(isFocused ? null : person.key)
                          }
                          className={`min-h-[34px] rounded-xl text-xs font-extrabold flex items-center justify-center gap-1 ${
                            isFocused
                              ? 'bg-[#D4AF37] text-[#0F172A]'
                              : 'bg-slate-100 dark:bg-slate-800 text-[#1A365D] dark:text-[#FDE68A]'
                          }`}
                        >
                          <span>
                            {isFocused ? 'معروض أسفل الصفحة ✓' : `استعراض الفواتير (${person.salesCount})`}
                          </span>
                        </button>
                        {person.uid ? (
                          <button
                            type="button"
                            onClick={() => openEntityDetailReport(person.uid)}
                            className="min-h-[34px] rounded-xl bg-[#1A365D] hover:bg-[#0F172A] text-white text-xs font-extrabold flex items-center justify-center gap-1"
                          >
                            <CreditCard className="w-3.5 h-3.5 text-[#FDE68A]" />
                            <span>كشف الكروت</span>
                          </button>
                        ) : (
                          <div className="min-h-[34px] rounded-xl bg-slate-50 dark:bg-slate-800/50 text-[11px] font-bold text-slate-500 flex items-center justify-center">
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

          {/* Invoices & Operations Table */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <h3 className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                {focusedSalesPersonKey
                  ? `فواتير وعمليات: ${
                      periodSalesData.byPerson.find((p) => p.key === focusedSalesPersonKey)?.name || ''
                    }`
                  : `سجل الفواتير والعمليات — ${periodSalesData.periodTitle}`}
              </h3>
              <span className="text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] shrink-0">
                {formatNumEn(displayedSalesList.length)} عملية
              </span>
            </div>
            {displayedSalesList.length === 0 ? (
              <div className="p-6 text-center text-xs font-bold text-slate-500">
                لا توجد عمليات مطابقة.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                    <tr>
                      <th className="py-2 px-2.5 font-extrabold">التاريخ</th>
                      <th className="py-2 px-2.5 font-extrabold">المشتري</th>
                      <th className="py-2 px-2.5 font-extrabold">النوع</th>
                      <th className="py-2 px-2.5 font-extrabold">الكروت</th>
                      <th className="py-2 px-2.5 font-extrabold">الإجمالي</th>
                      <th className="py-2 px-2.5 font-extrabold">المتبقي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {displayedSalesList.slice(0, visibleRowsCount).map((sale) => (
                      <tr key={sale.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-2.5 font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                          {formatDateDDMMYYYY(sale.createdAt)}
                        </td>
                        <td className="py-2 px-2.5">
                          <div className="font-extrabold text-slate-900 dark:text-white">
                            {sale.buyerName || 'مستهلك مباشر'}
                          </div>
                          <div className="text-[10px] font-bold text-slate-500">
                            {sale.buyerPhone || sale.invoiceNumber || '—'} • {paymentMethodLabelAr(sale.paymentMethod)}
                          </div>
                        </td>
                        <td className="py-2 px-2.5 font-bold whitespace-nowrap">
                          {saleTypeLabelAr(sale.saleType)}
                        </td>
                        <td className="py-2 px-2.5 font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                          {formatNum(sale.totalCards)}
                        </td>
                        <td className="py-2 px-2.5 font-extrabold text-slate-900 dark:text-white tabular-nums">
                          {formatMoney(sale.totalAmount)}
                        </td>
                        <td className="py-2 px-2.5 font-extrabold text-red-600 dark:text-red-400 tabular-nums">
                          {formatMoney(sale.remainingAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {displayedSalesList.length > visibleRowsCount && (
                  <div className="p-3 text-center border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setVisibleRowsCount((v) => v + PAGE_SIZE)}
                      className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]"
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
      {/* ICON 3: بيانات وكروت الوكيل والعميل (بالتفصيل الممل)              */}
      {/* ================================================================= */}
      {activeReportId === 'entity_cards_detail' && (
        <div className="space-y-3.5">
          {/* Interactive Searchable List of ALL Agents & Clients */}
          {(isAdmin || isAgent) && (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 shadow-sm space-y-2.5">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-[#D4AF37]" />
                  <h3 className="text-xs font-extrabold text-slate-900 dark:text-white">
                    اضغط على أي وكيل أو عميل لعرض صفحته التفصيلية الكاملة ({selectableAccounts.length})
                  </h3>
                </div>
                <div className="relative sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}
                    placeholder="ابحث بالاسم أو رقم الهاتف..."
                    className="w-full pr-8 pl-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {filteredEntityChoices.length === 0 ? (
                <p className="text-xs font-bold text-slate-500 text-center py-4">
                  لا يوجد وكلاء أو عملاء مطابقون للبحث.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto p-0.5">
                  {filteredEntityChoices.map((acc) => {
                    const isSelected = effectiveDetailUser?.uid === acc.uid;
                    return (
                      <button
                        key={acc.uid}
                        type="button"
                        onClick={() => setSelectedEntityUid(acc.uid)}
                        className={`text-right p-2.5 rounded-xl border-2 transition flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'bg-[#1A365D] text-white border-[#D4AF37] shadow'
                            : 'bg-slate-50 dark:bg-slate-800/70 text-slate-900 dark:text-white border-slate-200 dark:border-slate-700 hover:border-[#D4AF37]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-extrabold leading-snug break-words">
                            {acc.name}
                          </div>
                          <div
                            className={`text-[10.5px] font-bold mt-0.5 tabular-nums ${
                              isSelected ? 'text-[#FDE68A]' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {getRoleArabicLabel(acc.role)} • {acc.phone || '—'} • {acc.discountRate || 80}%
                          </div>
                        </div>
                        <div className="text-left shrink-0 flex flex-col items-end gap-1">
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg whitespace-nowrap ${
                              acc.status === 'suspended'
                                ? 'bg-red-600 text-white'
                                : isSelected
                                  ? 'bg-white/20 text-[#FDE68A]'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            }`}
                          >
                            {acc.status === 'suspended' ? 'موقوف' : 'نشط'}
                          </span>
                          <span className="text-[10px] font-extrabold tabular-nums">
                            {formatMoney(acc.balance || 0)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Selected Agent/Client Full Detailed Page (4 Complete Subsections) */}
          {effectiveDetailUser ? (
            <div className="space-y-3.5">
              {/* 1. Profile & Financial Summary Header */}
              <div className="rounded-2xl bg-gradient-to-l from-[#1A365D] to-[#0F172A] text-white p-3.5 border-2 border-[#D4AF37]/80 shadow flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-extrabold break-words">
                        {effectiveDetailUser.name}
                      </h3>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-[#D4AF37] text-[#0F172A] whitespace-nowrap">
                        {getRoleArabicLabel(effectiveDetailUser.role)}
                      </span>
                      {effectiveDetailUser.status === 'suspended' && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-red-600 text-white whitespace-nowrap">
                          موقوف مؤقتاً
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-bold text-[#FDE68A] mt-1 tabular-nums">
                      الهاتف: {effectiveDetailUser.phone || '—'} • نسبة التسعير:{' '}
                      {effectiveDetailUser.discountRate ||
                        (effectiveDetailUser.role === 'agent' ? 70 : 80)}
                      %
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/10 px-3 py-1.5 text-center border border-[#D4AF37]/50 shrink-0">
                    <p className="text-[10px] font-bold text-slate-300">الرصيد المالي</p>
                    <p className="text-sm font-extrabold text-[#FDE68A] tabular-nums">
                      {formatMoney(effectiveDetailUser.balance || 0)}
                    </p>
                  </div>
                </div>
              </div>

              {/* 2 & 3. Embedded Complete Card Inventory Audit:
                  - Summary (Received / Sold / Remaining / Recalled)
                  - 8-Package Breakdown (100..3000)
                  - Exhaustive "Sold To Whom" log (Card #, Package, Buyer Name & Phone, Date/Time, Price/Method, Instant Search) */}
              <AgentCardAuditModal
                targetUser={effectiveDetailUser}
                hideNumbers={hideNumbers}
                mode="inline"
              />

              {/* 4. Complete Chronological Activity Log (Receive / Sale / Payment / Recall-Return) */}
              <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-[#D4AF37]" />
                      <h3 className="text-xs font-extrabold text-slate-900 dark:text-white">
                        سجل كافة الأعمال والحركات بالتاريخ والوقت
                      </h3>
                    </div>
                    <span className="text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                      {formatNumEn(filteredDetailActivity.length)} حركة
                    </span>
                  </div>

                  {/* Activity Category Filter Tabs */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { id: 'all', label: 'الكل' },
                        { id: 'receive', label: 'استلام كروت' },
                        { id: 'sale', label: 'مبيعات' },
                        { id: 'payment', label: 'سداد ودفعات' },
                        { id: 'return', label: 'سحب ومرتجع' },
                      ] as Array<{ id: ActivityFilterType; label: string }>
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setActivityFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition ${
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
                  <div className="p-6 text-center text-xs font-bold text-slate-500">
                    لا توجد حركات مطابقة لهذا التصنيف حالياً.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredDetailActivity.slice(0, detailActivityVisible).map((ev) => (
                      <div
                        key={ev.id}
                        className="px-3.5 py-2.5 flex items-start justify-between gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold whitespace-nowrap ${
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
                          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5 break-words">
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
                      <div className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => setDetailActivityVisible((v) => v + PAGE_SIZE)}
                          className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]"
                        >
                          عرض المزيد (
                          {formatNumEn(filteredDetailActivity.length - detailActivityVisible)} متبقي)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-dashed border-[#D4AF37]/70 p-6 text-center space-y-2">
              <UserCheck className="w-9 h-9 mx-auto text-[#D4AF37]" />
              <p className="text-sm font-extrabold text-slate-800 dark:text-white">
                اضغط على أي وكيل أو عميل من القائمة أعلاه
              </p>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                سيظهر فوراً ملفه الكامل: كم استلم وكم باع وكم بقي من كل فئة، سجل «لمن باع» لكل كرت، وسجل كافة أعماله وحركاته بالتاريخ والوقت.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* ICON 4: التقارير المحاسبية الشاملة وجرد الكروت                     */}
      {/* ================================================================= */}
      {activeReportId === 'accounting_full_inventory' && (
        <div className="space-y-3.5">
          {/* Reconciliation Formula Banner (Zero Lost Cards) */}
          <div className="rounded-2xl bg-gradient-to-l from-[#0F172A] via-[#1A365D] to-[#0F172A] text-white p-3.5 border-2 border-[#D4AF37] shadow space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                <h3 className="text-xs sm:text-sm font-extrabold">
                  معادلة جرد ومطابقة الكروت الكاملة (منع أي ضياع)
                </h3>
              </div>
              <span className="px-2 py-0.5 rounded-lg bg-emerald-600/30 border border-emerald-400/60 text-emerald-300 text-[10px] font-extrabold whitespace-nowrap">
                مطابقة 100% ✓
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-center">
              <div className="rounded-xl bg-white/10 p-2 border border-white/15">
                <p className="text-[10px] font-bold text-[#FDE68A]">إجمالي المستورد</p>
                <p className="text-sm font-black tabular-nums mt-0.5">
                  {formatNum(accountingData.totalUploadedCards)}
                </p>
              </div>
              <div className="rounded-xl bg-white/10 p-2 border border-emerald-400/40">
                <p className="text-[10px] font-bold text-emerald-300">المتاح بالمخزن</p>
                <p className="text-sm font-black tabular-nums mt-0.5">
                  {formatNum(accountingData.totalAvailableCards)}
                </p>
              </div>
              <div className="rounded-xl bg-white/10 p-2 border border-sky-400/40">
                <p className="text-[10px] font-bold text-sky-300">المسلّم للوكلاء (متبقي)</p>
                <p className="text-sm font-black tabular-nums mt-0.5">
                  {formatNum(accountingData.totalDeliveredRemaining)}
                </p>
              </div>
              <div className="rounded-xl bg-white/10 p-2 border border-amber-400/40">
                <p className="text-[10px] font-bold text-amber-300">إجمالي المباع</p>
                <p className="text-sm font-black tabular-nums mt-0.5">
                  {formatNum(accountingData.totalSoldCards)}
                </p>
              </div>
              <div className="rounded-xl bg-white/10 p-2 border border-red-400/40 col-span-2 sm:col-span-1">
                <p className="text-[10px] font-bold text-red-300">المسحوب / المرتجع</p>
                <p className="text-sm font-black tabular-nums mt-0.5">
                  {formatNum(accountingData.totalReturnedCards)}
                </p>
              </div>
            </div>
          </div>

          {/* Executive Financial Rights Summary (حق الإدارة / حق الوكيل / حق العميل / المدفوع / الديون / المرتجع) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="rounded-2xl bg-gradient-to-br from-[#1A365D] to-[#0F172A] text-white p-3 border border-[#D4AF37]/80">
              <p className="text-[10.5px] font-bold text-[#FDE68A]">كم حق الإدارة</p>
              <p className="text-sm font-black mt-0.5 tabular-nums">
                {formatMoney(accountingData.totals.adminShare)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-500/40 p-3">
              <p className="text-[10.5px] font-bold text-emerald-700 dark:text-emerald-400">
                كم حق الوكيل
              </p>
              <p className="text-sm font-black text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                {formatMoney(accountingData.totals.agentShare)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-amber-500/40 p-3">
              <p className="text-[10.5px] font-bold text-amber-700 dark:text-amber-400">
                كم حق العميل
              </p>
              <p className="text-sm font-black text-amber-700 dark:text-amber-400 mt-0.5 tabular-nums">
                {formatMoney(accountingData.totals.clientShare)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[10.5px] font-bold text-slate-500">إجمالي المدفوع</p>
              <p className="text-sm font-black text-sky-700 dark:text-sky-400 mt-0.5 tabular-nums">
                {formatMoney(accountingData.totals.paidAmount)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[10.5px] font-bold text-slate-500">المتبقي والديون</p>
              <p className="text-sm font-black text-red-600 dark:text-red-400 mt-0.5 tabular-nums">
                {formatMoney(accountingData.totals.remainingDebt)}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3">
              <p className="text-[10.5px] font-bold text-slate-500">قيمة المسحوب/المرتجع</p>
              <p className="text-sm font-black text-purple-700 dark:text-purple-400 mt-0.5 tabular-nums">
                {formatMoney(accountingData.totals.returnedValue)}
              </p>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم الوكيل أو العميل أو الرقم في الكشف المحاسبي..."
              className="w-full pr-9 pl-9 py-2 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Per-Person Accounting Rights Table + Cards */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-xs font-extrabold text-slate-900 dark:text-white">
                  التفصيل المحاسبي لكل شخص (حق الإدارة • حق الوكيل • حق العميل • المدفوع • الديون • المرتجع)
                </h3>
              </div>
              <span className="text-[10.5px] font-extrabold text-emerald-700 dark:text-emerald-400">
                الدفتر: {formatMoney(accountingData.ledgerTotalDebt)}
              </span>
            </div>

            {accountingData.rightsRows.length === 0 ? (
              <div className="p-6 text-center text-xs font-bold text-slate-500">
                لا توجد بيانات محاسبية مطابقة للبحث.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-[#1A365D] text-white">
                    <tr>
                      <th className="py-2 px-2.5 font-extrabold">الحساب</th>
                      <th className="py-2 px-2.5 font-extrabold">الكروت</th>
                      <th className="py-2 px-2.5 font-extrabold">حق الإدارة</th>
                      <th className="py-2 px-2.5 font-extrabold">حق الوكيل</th>
                      <th className="py-2 px-2.5 font-extrabold">حق العميل</th>
                      <th className="py-2 px-2.5 font-extrabold">المدفوع</th>
                      <th className="py-2 px-2.5 font-extrabold">المتبقي/دين</th>
                      <th className="py-2 px-2.5 font-extrabold">المسحوب/مرتجع</th>
                      <th className="py-2 px-2.5 font-extrabold">مشاركة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {accountingData.rightsRows.slice(0, visibleRowsCount).map((row) => (
                      <tr key={row.uid} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-2.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-extrabold text-slate-900 dark:text-white">
                              {row.name}
                            </span>
                            {row.status === 'suspended' && (
                              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[9px] font-extrabold">
                                موقوف
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-bold text-slate-500">
                            {row.roleLabel} ({row.discountRate}%) • {row.phone}
                          </div>
                        </td>
                        <td className="py-2 px-2.5 font-extrabold tabular-nums">
                          {formatNum(row.cardsCount)}
                        </td>
                        <td className="py-2 px-2.5 font-extrabold text-[#1A365D] dark:text-sky-400 tabular-nums">
                          {formatMoney(row.adminShare)}
                        </td>
                        <td className="py-2 px-2.5 font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {formatMoney(row.agentShare)}
                        </td>
                        <td className="py-2 px-2.5 font-extrabold text-amber-700 dark:text-amber-400 tabular-nums">
                          {formatMoney(row.clientShare)}
                        </td>
                        <td className="py-2 px-2.5 font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                          {formatMoney(row.paidAmount)}
                        </td>
                        <td className="py-2 px-2.5 font-extrabold text-red-600 dark:text-red-400 tabular-nums">
                          {formatMoney(row.remainingDebt)}
                        </td>
                        <td className="py-2 px-2.5 font-bold text-purple-700 dark:text-purple-400 tabular-nums">
                          {formatMoney(row.returnedValue)}
                        </td>
                        <td className="py-2 px-2.5">
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
                      <td className="py-2.5 px-2.5 font-black text-[#1A365D] dark:text-[#FDE68A]">
                        الإجمالي العام
                      </td>
                      <td className="py-2.5 px-2.5 font-black tabular-nums">
                        {formatNum(accountingData.totals.cardsCount)}
                      </td>
                      <td className="py-2.5 px-2.5 font-black text-[#1A365D] dark:text-sky-400 tabular-nums">
                        {formatMoney(accountingData.totals.adminShare)}
                      </td>
                      <td className="py-2.5 px-2.5 font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {formatMoney(accountingData.totals.agentShare)}
                      </td>
                      <td className="py-2.5 px-2.5 font-black text-amber-700 dark:text-amber-400 tabular-nums">
                        {formatMoney(accountingData.totals.clientShare)}
                      </td>
                      <td className="py-2.5 px-2.5 font-black tabular-nums">
                        {formatMoney(accountingData.totals.paidAmount)}
                      </td>
                      <td className="py-2.5 px-2.5 font-black text-red-600 dark:text-red-400 tabular-nums">
                        {formatMoney(accountingData.totals.remainingDebt)}
                      </td>
                      <td className="py-2.5 px-2.5 font-black text-purple-700 dark:text-purple-400 tabular-nums">
                        {formatMoney(accountingData.totals.returnedValue)}
                      </td>
                      <td className="py-2.5 px-2.5" />
                    </tr>
                  </tfoot>
                </table>
                {accountingData.rightsRows.length > visibleRowsCount && (
                  <div className="p-3 text-center border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setVisibleRowsCount((v) => v + PAGE_SIZE)}
                      className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]"
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
            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-extrabold text-slate-900 dark:text-white">
                  مطابقة جرد الفئات الثماني (المستورد = المخزن + المسلّم + المباع + المرتجع)
                </h3>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                  <tr>
                    <th className="py-2 px-2.5 font-extrabold">الفئة</th>
                    <th className="py-2 px-2.5 font-extrabold">المستورد</th>
                    <th className="py-2 px-2.5 font-extrabold">بالمخزن</th>
                    <th className="py-2 px-2.5 font-extrabold">مسلّم متبقي</th>
                    <th className="py-2 px-2.5 font-extrabold">المباع</th>
                    <th className="py-2 px-2.5 font-extrabold">مسحوب/مرتجع</th>
                    <th className="py-2 px-2.5 font-extrabold">قيمة المخزن</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {accountingData.inventoryRows.map((row) => (
                    <tr key={row.pkg.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-2.5 font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                        {row.pkg.price} ({row.pkg.dataLabel})
                      </td>
                      <td className="py-2 px-2.5 font-extrabold tabular-nums">
                        {formatNum(row.uploaded)}
                      </td>
                      <td className="py-2 px-2.5 font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {formatNum(row.availableVault)}
                      </td>
                      <td className="py-2 px-2.5 font-extrabold text-sky-700 dark:text-sky-400 tabular-nums">
                        {formatNum(row.deliveredRemaining)}
                      </td>
                      <td className="py-2 px-2.5 font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                        {formatNum(row.sold)}
                      </td>
                      <td className="py-2 px-2.5 font-bold text-red-600 dark:text-red-400 tabular-nums">
                        {formatNum(row.returnedOrRecalled)}
                      </td>
                      <td className="py-2 px-2.5 font-extrabold tabular-nums">
                        {formatMoney(row.nominalAvailableValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 dark:bg-slate-800/90 border-t-2 border-slate-300 dark:border-slate-700">
                  <tr>
                    <td className="py-2.5 px-2.5 font-black text-slate-900 dark:text-white">
                      المجموع
                    </td>
                    <td className="py-2.5 px-2.5 font-black tabular-nums">
                      {formatNum(accountingData.totalUploadedCards)}
                    </td>
                    <td className="py-2.5 px-2.5 font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {formatNum(accountingData.totalAvailableCards)}
                    </td>
                    <td className="py-2.5 px-2.5 font-black text-sky-700 dark:text-sky-400 tabular-nums">
                      {formatNum(accountingData.totalDeliveredRemaining)}
                    </td>
                    <td className="py-2.5 px-2.5 font-black text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                      {formatNum(accountingData.totalSoldCards)}
                    </td>
                    <td className="py-2.5 px-2.5 font-black text-red-600 dark:text-red-400 tabular-nums">
                      {formatNum(accountingData.totalReturnedCards)}
                    </td>
                    <td className="py-2.5 px-2.5 font-black tabular-nums">
                      {formatMoney(accountingData.totalAvailableValue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800/40 text-[10px] font-bold text-slate-500 flex items-center justify-between">
              <span>منظومة كروت طيبة نت — {SUPER_ADMIN_CONFIG.developerCredit}</span>
              <span>مطابقة فورية من السجلات المعتمدة</span>
            </div>
          </div>
        </div>
      )}

      <ExportPreviewModal result={exportPreview} onClose={() => setExportPreview(null)} />
    </div>
  );
};
