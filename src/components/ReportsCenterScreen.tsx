import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calendar,
  CheckCircle2,
  CreditCard,
  FileDown,
  FileSpreadsheet,
  FileText,
  Filter,
  ImageDown,
  Layers,
  MessageSquare,
  Printer,
  Search,
  Send,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  Wallet,
  X,
  Zap,
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
  type UserProfile,
} from '../types/taibah';
import {
  buildSalesListDenominationBreakdown,
  formatNumEn,
  getBuyerRoleArabicLabel,
  toPrintableBreakdownItems,
  type DenominationLineBreakdown,
} from '../utils/salesBreakdown';

interface ReportsCenterScreenProps {
  hideNumbers: boolean;
}

type ReportId =
  | 'direct_sales'
  | 'electronic_wholesale'
  | 'paper_invoices'
  | 'customers_ledger'
  | 'debts_receivables'
  | 'profits_analysis'
  | 'agents_performance'
  | 'topup_requests'
  | 'packages_inventory'
  | 'comprehensive_summary';

interface ReportCardMeta {
  id: ReportId;
  num: number;
  title: string;
  subtitle: string;
  accent: string;
  icon: React.FC<{ className?: string }>;
  adminOrAgentOnly?: boolean;
}

const ALL_REPORTS: ReportCardMeta[] = [
  { id: 'direct_sales', num: 1, title: 'البيع المباشر', subtitle: 'كروت المستهلك 100%', accent: 'from-green-600 to-emerald-800', icon: Zap },
  { id: 'electronic_wholesale', num: 2, title: 'الجملة الإلكترونية', subtitle: 'توريد الوكلاء والعملاء', accent: 'from-blue-600 to-[#1A365D]', icon: CreditCard },
  { id: 'paper_invoices', num: 3, title: 'الفواتير الورقية', subtitle: 'مبيعات الكروت الورقية', accent: 'from-indigo-600 to-slate-800', icon: FileText },
  { id: 'customers_ledger', num: 4, title: 'الدفتر المحاسبي', subtitle: 'حسابات العملاء والقيود', accent: 'from-amber-500 to-yellow-700', icon: BookOpen },
  { id: 'debts_receivables', num: 5, title: 'الديون والمتبقي', subtitle: 'المبالغ الآجلة للتحصيل', accent: 'from-red-600 to-rose-800', icon: ShieldAlert },
  { id: 'profits_analysis', num: 6, title: 'تقرير الأرباح', subtitle: 'المتوقعة والمحققة فعلياً', accent: 'from-emerald-600 to-teal-800', icon: TrendingUp },
  { id: 'agents_performance', num: 7, title: 'الوكلاء ونقاط البيع', subtitle: 'الحسابات والأرصدة', accent: 'from-slate-700 to-[#0F172A]', icon: UserCheck, adminOrAgentOnly: true },
  { id: 'topup_requests', num: 8, title: 'طلبات التغذية', subtitle: 'المعتمدة والمعلقة والمرفوضة', accent: 'from-cyan-600 to-blue-800', icon: Send },
  { id: 'packages_inventory', num: 9, title: 'جرد الباقات الثماني', subtitle: 'المتاح والمباع بحسابك', accent: 'from-purple-600 to-violet-900', icon: Layers },
  { id: 'comprehensive_summary', num: 10, title: 'التقرير المالي الشامل', subtitle: 'ملخص الأداء العام', accent: 'from-[#B4860B] to-[#1A365D]', icon: Wallet },
];

export const ReportsCenterScreen: React.FC<ReportsCenterScreenProps> = ({ hideNumbers }) => {
  const { profile, packages, sales, customers, topupRequests, managedUsers, appSettings } = useFirebase();
  const { notifySuccess, notifyError } = useFeedback();

  const isAdmin = profile?.role === 'super_admin';
  const isAgent = profile?.role === 'agent';
  const displayPackages = packages.length > 0 ? packages : (EXCLUSIVE_PACKAGES as PackageDoc[]);

  const visibleReports = useMemo(
    () =>
      ALL_REPORTS.filter((rep) => !rep.adminOrAgentOnly || isAdmin || isAgent).map((rep, idx) => ({
        ...rep,
        displayNum: idx + 1,
        subtitle:
          rep.id === 'packages_inventory' && isAdmin
            ? 'المتاح والمباع والمرفوع'
            : rep.subtitle,
      })),
    [isAdmin, isAgent]
  );

  const [activeReportId, setActiveReportId] = useState<ReportId | null>(null);
  const [showStockMonitor, setShowStockMonitor] = useState(false);
  const [exportPreview, setExportPreview] = useState<ExportShareResult | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 180);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [visibleRowsCount, setVisibleRowsCount] = useState(50);

  // Unified Agent/Client Filter persisting across ALL 10 reports!
  const [selectedEntityUid, setSelectedEntityUid] = useState<string>('all');
  const [auditModalUser, setAuditModalUser] = useState<UserProfile | null>(null);

  const selectableAccounts = useMemo(() => {
    if (!isAdmin && !isAgent) return [] as UserProfile[];
    return (managedUsers || [])
      .filter((u) => u.role === 'agent' || u.role === 'client')
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [isAdmin, isAgent, managedUsers]);

  const selectedAccount = useMemo<UserProfile | null>(
    () =>
      selectedEntityUid !== 'all'
        ? selectableAccounts.find((u) => u.uid === selectedEntityUid) || null
        : null,
    [selectableAccounts, selectedEntityUid]
  );

  useEffect(() => {
    setVisibleRowsCount(50);
  }, [activeReportId, debouncedSearch, fromDate, toDate, selectedEntityUid]);

  const formatInputDateDisplay = (isoDate: string) => {
    if (!isoDate) return '';
    const [yyyy, mm, dd] = isoDate.split('-');
    return dd && mm && yyyy ? `${dd}/${mm}/${yyyy}` : isoDate;
  };

  // Build strict role-isolated + unified Agent/Client filtered data for ALL 10 reports
  const reportData = useMemo(() => {
    if (!activeReportId) return null;

    const inDateRange = (ms?: number) => {
      if (!ms) return true;
      if (fromDate && ms < new Date(`${fromDate}T00:00:00`).getTime()) return false;
      if (toDate && ms > new Date(`${toDate}T23:59:59.999`).getTime()) return false;
      return true;
    };
    const matchSearch = (fields: string[]) => {
      if (!debouncedSearch.trim()) return true;
      const q = debouncedSearch.trim().toLowerCase();
      return fields.some((f) => f.toLowerCase().includes(q));
    };

    const normPhone = (p?: string) => normalizeDigits(p || '').replace(/[^\d]/g, '');
    const selectedPhone = selectedAccount ? normPhone(selectedAccount.phone) : '';
    const selectedNameLower = selectedAccount ? selectedAccount.name.trim().toLowerCase() : '';
    const scopeSuffix = selectedAccount ? ` — (${selectedAccount.name})` : '';

    const matchSelectedSale = (s: (typeof sales)[number]) => {
      if (!selectedAccount) return true;
      if (s.sellerId === selectedAccount.uid || s.buyerId === selectedAccount.uid) return true;
      if (selectedPhone.length >= 7 && normPhone(s.buyerPhone) === selectedPhone) return true;
      if (selectedNameLower && (s.buyerName || '').trim().toLowerCase() === selectedNameLower) return true;
      return false;
    };

    const matchSelectedCustomer = (c: (typeof customers)[number]) => {
      if (!selectedAccount) return true;
      if (c.id === `acct_${selectedAccount.uid}`) return true;
      if (selectedPhone.length >= 7 && normPhone(c.phone) === selectedPhone) return true;
      if (selectedNameLower && (c.name || '').trim().toLowerCase() === selectedNameLower) return true;
      return false;
    };

    const matchSelectedTopup = (t: (typeof topupRequests)[number]) => {
      if (!selectedAccount) return true;
      return t.requesterId === selectedAccount.uid || t.targetId === selectedAccount.uid;
    };

    switch (activeReportId) {
      case 'direct_sales': {
        const list = sales.filter(
          (s) =>
            s.saleType === 'direct' &&
            matchSelectedSale(s) &&
            inDateRange(s.createdAt?.toMillis?.()) &&
            matchSearch([s.buyerName, s.buyerPhone || '', s.invoiceNumber || ''])
        );
        const total = list.reduce((a, b) => a + b.totalAmount, 0);
        const cards = list.reduce((a, b) => a + b.totalCards, 0);
        const breakdown = buildSalesListDenominationBreakdown(list, appSettings);
        return {
          title: `تقرير المبيعات المباشرة (100%)${scopeSuffix}`,
          headers: ['رقم الفاتورة', 'الزبون', 'الكروت', 'الإجمالي', 'التاريخ'],
          rows: list.map((s) => [
            s.invoiceNumber || s.id.slice(-6),
            s.buyerName,
            formatNumEn(s.totalCards),
            `${formatNumEn(s.totalAmount)} ر.ي`,
            formatDateTimeAr(s.createdAt),
          ]),
          breakdown,
          summary: [
            { label: 'عدد العمليات', value: formatNumEn(list.length) },
            { label: 'إجمالي الكروت المباعة', value: `${formatNumEn(cards)} كرت` },
            { label: 'إجمالي إيراد البيع المباشر', value: `${formatNumEn(total)} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_البيع_المباشر',
        };
      }

      case 'electronic_wholesale': {
        const list = sales.filter(
          (s) =>
            s.saleType === 'electronic_wholesale' &&
            matchSelectedSale(s) &&
            inDateRange(s.createdAt?.toMillis?.()) &&
            matchSearch([s.buyerName, s.buyerPhone || '', s.invoiceNumber || ''])
        );
        const total = list.reduce((a, b) => a + b.totalAmount, 0);
        const paid = list.reduce((a, b) => a + b.paidAmount, 0);
        const cards = list.reduce((a, b) => a + b.totalCards, 0);
        const breakdown = buildSalesListDenominationBreakdown(list, appSettings);
        return {
          title: `تقرير بيع الجملة الإلكتروني${scopeSuffix}`,
          headers: ['الفاتورة', 'المستلم', 'نوع الحساب', 'الكروت', 'المُسلّم', 'الإجمالي', 'المتبقي'],
          rows: list.map((s) => [
            s.invoiceNumber || s.id.slice(-6),
            s.buyerName,
            getBuyerRoleArabicLabel(s.buyerRole, s.saleType),
            formatNumEn(s.totalCards),
            formatNumEn(s.deliveredCards),
            `${formatNumEn(s.totalAmount)} ر.ي`,
            `${formatNumEn(s.remainingAmount)} ر.ي`,
          ]),
          breakdown,
          summary: [
            { label: 'إجمالي الكروت', value: `${formatNumEn(cards)} كرت` },
            { label: 'المدفوع نقداً', value: `${formatNumEn(paid)} ر.ي` },
            { label: 'إجمالي الجملة', value: `${formatNumEn(total)} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الجملة_الإلكترونية',
        };
      }

      case 'paper_invoices': {
        const list = sales.filter(
          (s) =>
            s.saleType === 'paper_invoice' &&
            matchSelectedSale(s) &&
            inDateRange(s.createdAt?.toMillis?.()) &&
            matchSearch([s.buyerName, s.buyerPhone || '', s.invoiceNumber || ''])
        );
        const total = list.reduce((a, b) => a + b.totalAmount, 0);
        const rem = list.reduce((a, b) => a + b.remainingAmount, 0);
        const breakdown = buildSalesListDenominationBreakdown(list, appSettings);
        return {
          title: `تقرير الفواتير والكروت الورقية${scopeSuffix}`,
          headers: ['الفاتورة', 'العميل', 'نوع الحساب', 'الكروت', 'الإجمالي', 'المدفوع', 'المتبقي'],
          rows: list.map((s) => [
            s.invoiceNumber || s.id.slice(-6),
            s.buyerName,
            getBuyerRoleArabicLabel(s.buyerRole, s.saleType),
            formatNumEn(s.totalCards),
            `${formatNumEn(s.totalAmount)} ر.ي`,
            `${formatNumEn(s.paidAmount)} ر.ي`,
            `${formatNumEn(s.remainingAmount)} ر.ي`,
          ]),
          breakdown,
          summary: [
            { label: 'عدد الفواتير الورقية', value: formatNumEn(list.length) },
            { label: 'إجمالي المتبقي', value: `${formatNumEn(rem)} ر.ي` },
            { label: 'إجمالي الفواتير الورقية', value: `${formatNumEn(total)} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الفواتير_الورقية',
        };
      }

      case 'customers_ledger': {
        const list = (customers || []).filter(
          (c) =>
            matchSelectedCustomer(c) &&
            matchSearch([c?.name || '', c?.phone || '', c?.category || ''])
        );
        const debit = list.reduce((a, c) => a + (c?.totalDebit || 0), 0);
        const credit = list.reduce((a, c) => a + (c?.totalCredit || 0), 0);
        return {
          title: `تقرير الدفتر المحاسبي العام وحسابات العملاء${scopeSuffix}`,
          headers: ['العميل', 'التصنيف', 'عليه (مدين)', 'له (دائن)', 'الصافي'],
          rows: list.map((c) => {
            const bal = c?.balance ?? 0;
            return [
              c?.name || '-',
              c?.category || 'عميل شبكة',
              `${formatNumEn(c?.totalDebit ?? 0)} ر.ي`,
              `${formatNumEn(c?.totalCredit ?? 0)} ر.ي`,
              bal > 0 ? `عليه ${formatNumEn(bal)}` : bal < 0 ? `له ${formatNumEn(Math.abs(bal))}` : '0',
            ];
          }),
          financialEquation: {
            debit,
            credit,
            balance: debit - credit,
          },
          summary: [
            { label: 'إجمالي المشتريات/الإضافات (عليه)', value: `${formatNumEn(debit)} ر.ي` },
            { label: 'إجمالي المدفوعات/المرتجعات (له)', value: `${formatNumEn(credit)} ر.ي` },
            { label: 'الرصيد الحالي الصافي', value: `${formatNumEn(debit - credit)} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الدفتر_المحاسبي',
        };
      }

      case 'debts_receivables': {
        const saleDebts = (sales || []).filter(
          (s) =>
            (s?.remainingAmount ?? 0) > 0 &&
            matchSelectedSale(s) &&
            inDateRange(s?.createdAt?.toMillis?.()) &&
            matchSearch([s?.buyerName || '', s?.buyerPhone || ''])
        );
        const custDebts = (customers || []).filter(
          (c) =>
            (c?.balance ?? 0) > 0 &&
            matchSelectedCustomer(c) &&
            matchSearch([c?.name || '', c?.phone || ''])
        );
        const rows = [
          ...saleDebts.map((s) => [s?.buyerName || '-', 'فاتورة آجلة', s?.buyerPhone || '-', `${formatNumEn(s?.remainingAmount ?? 0)} ر.ي`]),
          ...custDebts.map((c) => [c?.name || '-', `دفتر (${c?.category || 'عميل'})`, c?.phone || '-', `${formatNumEn(c?.balance ?? 0)} ر.ي`]),
        ];
        const totalDebts =
          saleDebts.reduce((a, s) => a + (s?.remainingAmount ?? 0), 0) +
          custDebts.reduce((a, c) => a + (c?.balance ?? 0), 0);
        return {
          title: `تقرير الديون والمبالغ المتبقية للتحصيل${scopeSuffix}`,
          headers: ['الاسم', 'المصدر', 'الهاتف', 'المبلغ المستحق'],
          rows,
          summary: [
            { label: 'عدد الذمم المفتوحة', value: formatNumEn(rows.length) },
            { label: 'إجمالي الديون المستحقة', value: `${formatNumEn(totalDebts)} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الديون_والمتبقي',
        };
      }

      case 'profits_analysis': {
        const list = (sales || []).filter(
          (s) =>
            matchSelectedSale(s) &&
            inDateRange(s?.createdAt?.toMillis?.()) &&
            matchSearch([s?.buyerName || '', s?.invoiceNumber || ''])
        );
        const expected = list.reduce((a, s) => a + (s?.expectedProfit || 0), 0);
        const realized = list.reduce((a, s) => a + (s?.realizedProfit || 0), 0);
        const breakdown = buildSalesListDenominationBreakdown(list, appSettings);
        return {
          title: `تقرير الأرباح المتوقعة والمحققة فعلياً${scopeSuffix}`,
          headers: ['الفاتورة', 'العميل', 'نوع الحساب', 'الإجمالي', 'الربح المتوقع', 'الربح المحقق'],
          rows: list.map((s) => [
            s?.invoiceNumber || (s?.id || '').slice(-6),
            s?.buyerName || '-',
            getBuyerRoleArabicLabel(s?.buyerRole, s?.saleType),
            `${formatNumEn(s?.totalAmount ?? 0)} ر.ي`,
            `${formatNumEn(s?.expectedProfit || 0)} ر.ي`,
            `${formatNumEn(s?.realizedProfit || 0)} ر.ي`,
          ]),
          breakdown,
          summary: [
            { label: 'إجمالي الأرباح المتوقعة', value: `${formatNumEn(expected)} ر.ي` },
            { label: 'إجمالي الأرباح المحققة نقداً', value: `${formatNumEn(realized)} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الأرباح',
        };
      }

      case 'agents_performance': {
        const list = (managedUsers || []).filter(
          (u) =>
            u?.role !== 'super_admin' &&
            (!selectedAccount || u.uid === selectedAccount.uid) &&
            matchSearch([u?.name || '', u?.phone || ''])
        );
        const totalBal = list.reduce((a, u) => a + (u?.balance || 0), 0);
        return {
          title: `تقرير الوكلاء ونقاط البيع والعملاء${scopeSuffix}`,
          headers: ['الاسم', 'الدور', 'الهاتف', 'النسبة', 'الرصيد'],
          rows: list.map((u) => [
            u?.name || '-',
            getRoleArabicLabel(u?.role),
            u?.phone || '-',
            `${u?.discountRate || 80}%`,
            `${formatNumEn(u?.balance || 0)} ر.ي`,
          ]),
          summary: [
            { label: 'إجمالي الحسابات', value: formatNumEn(list.length) },
            { label: 'مجموع الأرصدة', value: `${formatNumEn(totalBal)} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الوكلاء_والعملاء',
        };
      }

      case 'topup_requests': {
        const list = (topupRequests || []).filter(
          (t) =>
            matchSelectedTopup(t) &&
            inDateRange(t?.createdAt?.toMillis?.()) &&
            matchSearch([t?.requesterName || '', t?.targetName || ''])
        );
        const total = list.reduce((a, t) => a + (t?.totalAmount ?? 0), 0);
        return {
          title: `تقرير طلبات التغذية (ثنائي المستوى)${scopeSuffix}`,
          headers: ['مقدم الطلب', 'الموجّه إليه', 'الكروت', 'المبلغ', 'الحالة'],
          rows: list.map((t) => [
            t?.requesterName || '-',
            t?.targetName || SUPER_ADMIN_CONFIG.name,
            formatNumEn(t?.totalCards ?? 0),
            `${formatNumEn(t?.totalAmount ?? 0)} ر.ي`,
            t?.status === 'approved' ? 'مُنفّذ ✅' : t?.status === 'pending' ? 'معلق' : 'مرفوض',
          ]),
          summary: [
            { label: 'عدد الطلبات', value: formatNumEn(list.length) },
            { label: 'إجمالي قيمة التغذيات', value: `${formatNumEn(total)} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_طلبات_التغذية',
        };
      }

      case 'packages_inventory': {
        const list = (displayPackages || []).filter((p) => matchSearch([String(p?.price ?? ''), p?.dataLabel || '']));
        const avail = list.reduce((a, p) => a + (p?.availableCount ?? 0), 0);
        const sold = list.reduce((a, p) => a + (p?.soldCount ?? 0), 0);
        const returnedTotal = (sales || []).reduce((a, s) => a + (s?.returnedCards ?? 0), 0);
        if (!isAdmin) {
          return {
            title: `تقرير جرد الباقات المتاحة بحسابك${scopeSuffix}`,
            headers: ['الباقة', 'الكروت المتاحة', 'الكروت المباعة'],
            rows: list.map((p) => [
              `${p?.price ?? 0} ر.ي (${p?.dataLabel || ''})`,
              formatNumEn(p?.availableCount ?? 0),
              formatNumEn(p?.soldCount ?? 0),
            ]),
            inventoryEquation: {
              uploaded: avail + sold,
              available: avail,
              soldOrAssigned: sold,
              returned: returnedTotal,
            },
            summary: [
              { label: 'إجمالي المباعة', value: `${formatNumEn(sold)} كرت` },
              { label: 'إجمالي المتاح بحسابك', value: `${formatNumEn(avail)} كرت`, highlight: true },
            ],
            fileName: 'تقرير_جرد_مخزوني',
          };
        }
        const uploaded = list.reduce((a, p) => a + (p?.uploadedCount ?? 0), 0);
        const injected = list.reduce((a, p) => a + (p?.injectedCount ?? 0), 0);
        return {
          title: `تقرير جرد الباقات الثماني والمخزون${scopeSuffix}`,
          headers: ['الباقة', 'المرفوعة', 'المتاحة', 'المباعة/المسلّمة', 'المحقونة'],
          rows: list.map((p) => [
            `${p?.price ?? 0} ر.ي (${p?.dataLabel || ''})`,
            formatNumEn(p?.uploadedCount ?? 0),
            formatNumEn(p?.availableCount ?? 0),
            formatNumEn(p?.soldCount ?? 0),
            formatNumEn(p?.injectedCount ?? 0),
          ]),
          inventoryEquation: {
            uploaded: Math.max(uploaded, avail + sold + injected),
            available: avail,
            soldOrAssigned: sold + injected,
            returned: returnedTotal,
          },
          summary: [
            { label: 'إجمالي المستورد/المرفوع', value: `${formatNumEn(uploaded)} كرت` },
            { label: 'المباع والمسلّم للوكلاء', value: `${formatNumEn(sold)} كرت` },
            { label: 'إجمالي المحقونة', value: `${formatNumEn(injected)} كرت` },
            { label: 'المتاح بالمخزن حالياً', value: `${formatNumEn(avail)} كرت`, highlight: true },
          ],
          fileName: 'تقرير_جرد_الباقات',
        };
      }

      default: {
        const filteredAllSales = (sales || []).filter(
          (s) => matchSelectedSale(s) && inDateRange(s?.createdAt?.toMillis?.())
        );
        const filteredCustomers = (customers || []).filter(matchSelectedCustomer);
        const filteredTopups = (topupRequests || []).filter(matchSelectedTopup);
        const totalSalesAmt = filteredAllSales.reduce((a, s) => a + (s?.totalAmount ?? 0), 0);
        const totalPaidAmt = filteredAllSales.reduce((a, s) => a + (s?.paidAmount ?? 0), 0);
        const totalRemAmt = filteredAllSales.reduce((a, s) => a + (s?.remainingAmount ?? 0), 0);
        const totalCardsSold = filteredAllSales.reduce((a, s) => a + (s?.totalCards ?? 0), 0);
        const totalReturnedCards = filteredAllSales.reduce((a, s) => a + (s?.returnedCards ?? 0), 0);
        const totalAvail = (displayPackages || []).reduce((a, p) => a + (p?.availableCount ?? 0), 0);
        const totalUploaded = (displayPackages || []).reduce((a, p) => a + (p?.uploadedCount ?? 0), 0);
        const totalDebit = filteredCustomers.reduce((a, c) => a + (c?.totalDebit ?? 0), 0);
        const totalCredit = filteredCustomers.reduce((a, c) => a + (c?.totalCredit ?? 0), 0);
        const breakdown = buildSalesListDenominationBreakdown(filteredAllSales, appSettings);
        const rows: string[][] = [
          ['إجمالي عمليات البيع المسجلة', `${formatNumEn(filteredAllSales.length)} عملية`],
          ['إجمالي الكروت المباعة / المسلّمة', `${formatNumEn(totalCardsSold)} كرت`],
          ['إجمالي الكروت المرتجعة', `${formatNumEn(totalReturnedCards)} كرت`],
          ['إجمالي قيمة المبيعات', `${formatNumEn(totalSalesAmt)} ر.ي`],
          ['إجمالي التحصيل النقدي الفوري', `${formatNumEn(totalPaidAmt)} ر.ي`],
          ['إجمالي الآجل / المتبقي', `${formatNumEn(totalRemAmt)} ر.ي`],
          [isAdmin ? 'إجمالي الكروت المتاحة بالمخزون' : 'الكروت المتاحة بحسابك', `${formatNumEn(totalAvail)} كرت`],
          ['عدد حسابات الدفتر العام', `${formatNumEn(filteredCustomers.length)} حساب`],
          ['عدد طلبات التغذية المسجلة', `${formatNumEn(filteredTopups.length)} طلب`],
        ];
        if (isAdmin || isAgent) {
          rows.push([
            'عدد الوكلاء ونقاط البيع',
            `${formatNumEn(
              selectedAccount
                ? 1
                : managedUsers.filter((u) => u.role !== 'super_admin').length
            )} حساب`,
          ]);
        }
        return {
          title: `التقرير المالي الشامل — شبكة طيبة نت${scopeSuffix}`,
          headers: ['البند المالي / التشغيلي', 'القيمة الحية'],
          rows,
          breakdown,
          inventoryEquation: {
            uploaded: Math.max(totalUploaded, totalAvail + totalCardsSold),
            available: totalAvail,
            soldOrAssigned: totalCardsSold,
            returned: totalReturnedCards,
          },
          financialEquation: {
            debit: totalDebit + totalSalesAmt,
            credit: totalCredit + totalPaidAmt,
            balance: (totalDebit + totalSalesAmt) - (totalCredit + totalPaidAmt),
          },
          summary: [
            { label: 'التحصيل النقدي', value: `${formatNumEn(totalPaidAmt)} ر.ي` },
            { label: 'إجمالي المبيعات', value: `${formatNumEn(totalSalesAmt)} ر.ي`, highlight: true },
          ],
          fileName: 'التقرير_المالي_الشامل',
        };
      }
    }
  }, [
    activeReportId,
    sales,
    customers,
    managedUsers,
    topupRequests,
    displayPackages,
    debouncedSearch,
    fromDate,
    toDate,
    isAdmin,
    isAgent,
    appSettings,
    selectedAccount,
  ]);

  const getBreakdownList = (data: NonNullable<typeof reportData>): DenominationLineBreakdown[] =>
    'breakdown' in data && Array.isArray(data.breakdown) ? data.breakdown : [];

  const buildReportShareText = (data: NonNullable<typeof reportData>): string => {
    const breakdown = getBreakdownList(data);
    const lines = [
      `📶 شبكة طيبة نت اللاسلكية (TAIBAH NET)`,
      `📊 ${data.title}`,
      `🗓 ${formatDateDDMMYYYY(new Date())}`,
      `────────────────────`,
      ...data.summary.map((s) => `• ${s.label}: ${s.value}`),
    ];
    if (breakdown.length > 0) {
      lines.push(`────────────────────`);
      lines.push(`🧾 تفصيل الفئات المباعة (العدد × سعر الفئة = الإجمالي):`);
      for (const b of breakdown) {
        lines.push(`🔹 ${b.fullLineText}`);
      }
    }
    lines.push(`────────────────────`);
    lines.push(`عدد السجلات: ${data.rows.length}`);
    lines.push(`📞 ${SUPER_ADMIN_CONFIG.developerCredit}`);
    return lines.join('\n');
  };

  const buildReportPrintable = (data: NonNullable<typeof reportData>): PrintableDocumentPayload => {
    const breakdown = getBreakdownList(data);
    return {
      title: data.title,
      subtitle: `تقرير معتمد — ${profile?.name || SUPER_ADMIN_CONFIG.name}`,
      metaRows: [
        { label: 'الشبكة', value: 'شبكة طيبة نت اللاسلكية (TAIBAH NET)' },
        { label: 'تاريخ التصدير', value: formatDateTimeAr(new Date()) },
        { label: 'من تاريخ', value: fromDate ? formatInputDateDisplay(fromDate) : 'من البداية' },
        { label: 'إلى تاريخ', value: toDate ? formatInputDateDisplay(toDate) : 'حتى الآن' },
      ],
      tableHeaders: data.headers,
      tableRows: data.rows,
      breakdownTitle:
        breakdown.length > 0
          ? 'تفصيل الفئات المباعة حسب نوع الحساب (العدد × سعر الفئة = الإجمالي)'
          : undefined,
      breakdownItems: breakdown.length > 0 ? toPrintableBreakdownItems(breakdown) : undefined,
      summaryRows: data.summary,
      fileName: data.fileName,
      shareText: buildReportShareText(data),
    };
  };

  // Dedicated Independent Report View (scrollable internally inside fixed shell)
  if (activeReportId && reportData) {
    return (
      <div className="h-full min-h-0 overflow-y-auto taibah-scroll space-y-3 pb-4">
        <div className="royal-header-3d rounded-2xl border-2 border-[#D4AF37] p-3 flex items-center justify-between gap-2 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setActiveReportId(null);
              setSearch('');
            }}
            className="min-h-[36px] px-3 rounded-xl bg-white/15 border border-[#D4AF37] text-white text-xs font-extrabold flex items-center gap-1 shrink-0"
          >
            <ArrowRight className="w-4 h-4" />
            مركز التقارير
          </button>
          <h2 className="text-xs sm:text-sm font-extrabold text-[#FDE68A] truncate flex-1 text-center">
            {reportData.title}
          </h2>
          <div className="w-9 h-9 rounded-full bg-[#061124] p-0.5 border-2 border-[#D4AF37] shrink-0 overflow-hidden">
            <img src={TAIBAH_ASSETS.logo} alt="طيبة نت" className="w-full h-full rounded-full object-contain" />
          </div>
        </div>

        {/* Unified Agent/Client Filter + Date Range + Search Bar */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-3 space-y-2 shadow-sm">
          {(isAdmin || isAgent) && selectableAccounts.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex-1 min-w-[180px] flex items-center gap-1.5">
                <Filter className="w-4 h-4 text-[#1A365D] dark:text-[#FDE68A] shrink-0" />
                <select
                  value={selectedEntityUid}
                  onChange={(e) => setSelectedEntityUid(e.target.value)}
                  className="flex-1 min-h-[38px] rounded-xl border-2 border-[#D4AF37]/80 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A] focus:outline-none"
                >
                  <option value="all">الكل (تقرير عام لجميع الحسابات)</option>
                  {selectableAccounts.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.name} ({getRoleArabicLabel(u.role)}) — {u.phone}
                    </option>
                  ))}
                </select>
              </div>
              {selectedAccount && (
                <button
                  type="button"
                  onClick={() => setAuditModalUser(selectedAccount)}
                  className="min-h-[38px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold flex items-center gap-1 shrink-0 shadow"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>كشف كروت ولمن باع</span>
                </button>
              )}
            </div>
          )}

          <div className="relative">
            <Search className="w-4 h-4 text-[#1A365D] dark:text-[#FDE68A] absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث داخل التقرير..."
              className="w-full min-h-[40px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs font-extrabold shadow-xs focus:border-[#D4AF37] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#1A365D] dark:text-[#FDE68A] shrink-0" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="flex-1 min-h-[36px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-2 text-xs font-extrabold shadow-xs focus:border-[#D4AF37] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#1A365D] dark:text-[#FDE68A] shrink-0" />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="flex-1 min-h-[36px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-2 text-xs font-extrabold shadow-xs focus:border-[#D4AF37] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Live Summary Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {reportData.summary.map((s, i) => (
            <div
              key={i}
              className={`rounded-2xl p-2.5 text-center border-2 ${
                s.highlight
                  ? 'bg-[#1A365D] border-[#D4AF37] text-[#FDE68A]'
                  : 'bg-white dark:bg-slate-900 border-[#D4AF37]/60'
              }`}
            >
              <div className={`text-[11px] font-bold ${s.highlight ? 'text-slate-200' : 'text-slate-500'}`}>
                {s.label}
              </div>
              <div className="text-sm font-extrabold tabular-nums mt-0.5">
                {hideNumbers ? '••••' : s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Export Suite: WhatsApp, SMS, PDF, HD Image, Excel, Print */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          <button
            type="button"
            onClick={() => openWhatsAppShare(undefined, buildReportShareText(reportData))}
            className="min-h-[38px] rounded-xl bg-emerald-600 text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
          >
            <Send className="w-3.5 h-3.5" /> واتساب
          </button>
          <button
            type="button"
            onClick={() => openSmsShare(undefined, buildReportShareText(reportData))}
            className="min-h-[38px] rounded-xl bg-blue-600 text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
          >
            <MessageSquare className="w-3.5 h-3.5" /> SMS
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await exportAsArabicPDF(buildReportPrintable(reportData));
                notifySuccess('تم تجهيز ملف PDF بنجاح ✅');
                if (!res.sharedNatively) setExportPreview(res);
              } catch {
                notifyError('تعذر إنشاء PDF');
              }
            }}
            className="min-h-[38px] rounded-xl bg-red-600 text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
          >
            <FileDown className="w-3.5 h-3.5" /> PDF
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await exportAsHDImage(buildReportPrintable(reportData));
                notifySuccess('تم تجهيز الصورة HD بنجاح ✅');
                if (!res.sharedNatively) setExportPreview(res);
              } catch {
                notifyError('تعذر إنشاء الصورة');
              }
            }}
            className="min-h-[38px] rounded-xl gold-btn-3d text-[#0F172A] text-[11px] font-extrabold flex items-center justify-center gap-1"
          >
            <ImageDown className="w-3.5 h-3.5" /> صورة HD
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                const breakdown = getBreakdownList(reportData);
                const extraRows: string[][] =
                  breakdown.length > 0
                    ? [
                        ['', ...reportData.headers.slice(1).map(() => '')],
                        ['تفصيل الفئات المباعة (العدد × سعر الفئة = الإجمالي)', ...reportData.headers.slice(1).map(() => '')],
                        ...breakdown.map((b) => {
                          const padded = [
                            `فئة ${formatNumEn(b.denomination)} ريال (${b.buyerRoleLabel})`,
                            b.formulaText,
                          ];
                          while (padded.length < reportData.headers.length) padded.push('');
                          return padded.slice(0, reportData.headers.length);
                        }),
                      ]
                    : [];
                await exportAsExcel(
                  reportData.title,
                  reportData.headers,
                  [...reportData.rows, ...extraRows],
                  reportData.fileName
                );
                notifySuccess('تم تجهيز ملف Excel بنجاح ✅');
              } catch {
                notifyError('تعذر إنشاء ملف Excel');
              }
            }}
            className="min-h-[38px] rounded-xl bg-teal-600 text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
          <button
            type="button"
            onClick={() => void printRoyalDocument(buildReportPrintable(reportData))}
            className="min-h-[38px] rounded-xl bg-[#1A365D] text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
          >
            <Printer className="w-3.5 h-3.5 text-[#FDE68A]" /> طباعة
          </button>
        </div>

        {/* Per-Denomination Breakdown Card (Automatic Buyer-Type Pricing: Agent / Client / Consumer) */}
        {getBreakdownList(reportData).length > 0 && (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/80 p-3 shadow-sm space-y-1.5">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-1.5">
              <span className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                تفصيل الفئات المباعة (العدد × سعر الفئة = الإجمالي)
              </span>
              <span className="text-[10px] font-extrabold text-slate-500 tabular-nums">
                تسعير تلقائي حسب نوع الحساب
              </span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {getBreakdownList(reportData).map((b) => (
                <div
                  key={b.key}
                  className="py-1.5 flex items-center justify-between gap-2 text-xs font-extrabold tabular-nums"
                >
                  <span className="text-slate-700 dark:text-slate-200 truncate">
                    فئة {formatNumEn(b.denomination)} ريال ({b.buyerRoleLabel})
                  </span>
                  <span className="text-[#1A365D] dark:text-[#FDE68A] shrink-0">
                    {hideNumbers ? '••••' : b.formulaText}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transparent Inventory Reconciliation Equation (Zero Lost Cards) */}
        {'inventoryEquation' in reportData && reportData.inventoryEquation && (
          <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/35 border-2 border-emerald-500/70 p-3 text-xs font-extrabold text-emerald-900 dark:text-emerald-200 space-y-1">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>معادلة مطابقة الجرد (ضمان صفر كروت ضائعة):</span>
            </div>
            <p className="text-[11px] font-bold leading-relaxed tabular-nums">
              إجمالي المستورد/المرفوع ({hideNumbers ? '••' : formatNumEn(reportData.inventoryEquation.uploaded)}) =
              المتاح بالمخزن ({hideNumbers ? '••' : formatNumEn(reportData.inventoryEquation.available)}) +
              المسلّم للوكلاء والمباع ({hideNumbers ? '••' : formatNumEn(reportData.inventoryEquation.soldOrAssigned)})
              {reportData.inventoryEquation.returned > 0
                ? ` • المرتجع/المسحوب (${hideNumbers ? '••' : formatNumEn(reportData.inventoryEquation.returned)})`
                : ''}
            </p>
          </div>
        )}

        {/* Transparent Financial Statement Equation */}
        {'financialEquation' in reportData && reportData.financialEquation && (
          <div className="rounded-2xl bg-blue-50 dark:bg-blue-950/35 border-2 border-blue-500/70 p-3 text-xs font-extrabold text-[#1A365D] dark:text-blue-200 space-y-1">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
              <span>معادلة كشف الحساب المالي المطابق:</span>
            </div>
            <p className="text-[11px] font-bold leading-relaxed tabular-nums">
              المشتريات/الإضافات ({hideNumbers ? '••' : formatYER(reportData.financialEquation.debit)}) −
              المدفوعات/المرتجعات والسحب ({hideNumbers ? '••' : formatYER(reportData.financialEquation.credit)}) =
              الرصيد الحالي الصافي ({hideNumbers ? '••' : formatYER(reportData.financialEquation.balance)})
            </p>
          </div>
        )}

        {/* Embedded Detailed Card Inventory & "Who-Bought-What" Audit when viewing an Agent/Client */}
        {selectedAccount && (activeReportId === 'agents_performance' || activeReportId === 'packages_inventory') && (
          <AgentCardAuditModal
            targetUser={selectedAccount}
            hideNumbers={hideNumbers}
            mode="inline"
          />
        )}

        {/* Report Table (Paginated 50 rows/page for Zero Lag on older Android devices) */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 overflow-hidden shadow-md">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-[#1A365D] text-[#FDE68A]">
                  {reportData.headers.map((h, i) => (
                    <th key={i} className="px-3 py-2.5 font-extrabold whitespace-nowrap border-b border-[#D4AF37]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reportData.rows.length === 0 ? (
                  <tr>
                    <td colSpan={reportData.headers.length} className="p-8 text-center font-bold text-slate-500">
                      لا توجد سجلات مطابقة لهذا التقرير حالياً (0)
                    </td>
                  </tr>
                ) : (
                  reportData.rows.slice(0, visibleRowsCount).map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className="border-b border-slate-100 dark:border-slate-800 odd:bg-white dark:odd:bg-slate-900 even:bg-slate-50 dark:even:bg-slate-800/40"
                    >
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3 py-2 font-bold whitespace-nowrap tabular-nums">
                          {hideNumbers && /\d/.test(cell) ? '••••' : cell}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {reportData.rows.length > visibleRowsCount && (
            <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <button
                type="button"
                onClick={() => setVisibleRowsCount((c) => c + 50)}
                className="w-full min-h-[38px] rounded-xl bg-[#1A365D] text-[#FDE68A] text-xs font-extrabold"
              >
                عرض المزيد ({formatNumEn(Math.min(50, reportData.rows.length - visibleRowsCount))} سجل إضافي من أصل {formatNumEn(reportData.rows.length)})
              </button>
            </div>
          )}
        </div>

        <ExportPreviewModal result={exportPreview} onClose={() => setExportPreview(null)} />
        {auditModalUser && (
          <AgentCardAuditModal
            targetUser={auditModalUser}
            hideNumbers={hideNumbers}
            mode="modal"
            onClose={() => setAuditModalUser(null)}
          />
        )}
      </div>
    );
  }

  // FIXED SINGLE-SCREEN REPORTS CENTER HUB (100% Viewport — ZERO Vertical or Horizontal Scroll!)
  return (
    <div className="h-full min-h-0 flex flex-col gap-1.5 overflow-hidden">
      {/* Compact Royal Header Bar */}
      <div className="shrink-0 royal-header-3d rounded-2xl border-2 border-[#D4AF37] px-3 py-2 shadow-lg flex items-center justify-between gap-2">
        <div className="w-9 h-9 rounded-xl bg-white/15 border border-[#D4AF37] flex items-center justify-center text-[#FDE68A] shrink-0">
          <BarChart3 className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 text-center">
          <h2 className="text-sm sm:text-base font-extrabold text-white truncate leading-tight">
            مركز التقارير الشامل ({visibleReports.length} تقارير مستقلة)
          </h2>
          <p className="text-[10px] sm:text-[11px] font-bold text-[#FDE68A] truncate">
            {selectedAccount
              ? `مفلتر لحساب: ${selectedAccount.name} (${getRoleArabicLabel(selectedAccount.role)})`
              : 'تصدير ومشاركة فورية: PDF • صورة HD • Excel • واتساب • SMS'}
          </p>
        </div>
        <div className="w-9 h-9 rounded-full p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shrink-0 shadow">
          <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-0.5">
            <img src={TAIBAH_ASSETS.logo} alt="شعار طيبة نت" className="w-full h-full rounded-full object-contain" />
          </div>
        </div>
      </div>

      {/* Unified Fixed Agent/Client Selector Bar (Filters ALL 10 Reports + Instant Card Audit) */}
      <div className="shrink-0 flex items-center gap-1.5">
        {(isAdmin || isAgent) && selectableAccounts.length > 0 ? (
          <>
            <select
              value={selectedEntityUid}
              onChange={(e) => setSelectedEntityUid(e.target.value)}
              className="flex-1 min-w-0 h-9 rounded-xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] px-2.5 text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] shadow-sm focus:outline-none"
            >
              <option value="all">الكل (تقرير عام لجميع الحسابات)</option>
              {selectableAccounts.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.name} ({getRoleArabicLabel(u.role)}) — {u.phone}
                </option>
              ))}
            </select>
            {selectedAccount ? (
              <button
                type="button"
                onClick={() => setAuditModalUser(selectedAccount)}
                className="shrink-0 h-9 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 border-2 border-[#D4AF37] text-white text-[10.5px] font-extrabold flex items-center gap-1 shadow"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>كشف الكروت</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowStockMonitor(true)}
                className="shrink-0 h-9 px-2.5 rounded-xl bg-gradient-to-l from-[#0F172A] to-[#1A365D] border-2 border-[#D4AF37] text-[#FDE68A] text-[10.5px] font-extrabold flex items-center gap-1 shadow"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>جرد المخزون</span>
              </button>
            )}
          </>
        ) : (
          <div className="w-full flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowStockMonitor(true)}
              className="flex-1 h-9 rounded-xl bg-gradient-to-l from-[#0F172A] via-[#1A365D] to-[#1E3A8A] border-2 border-[#D4AF37] px-2.5 text-[#FDE68A] font-extrabold text-[11px] shadow flex items-center justify-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">مراقبة مخزون حسابك</span>
            </button>
            {profile && (
              <button
                type="button"
                onClick={() => setAuditModalUser(profile)}
                className="shrink-0 h-9 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 border-2 border-[#D4AF37] text-white font-extrabold text-[11px] shadow flex items-center gap-1"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>كشف كروتي ومبيعاتي</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Fixed Single-Viewport Grid (2×5 Mobile, 5×2 Desktop — ZERO SCROLL!) */}
      <div className="flex-1 min-h-0 grid grid-cols-2 md:grid-cols-5 auto-rows-fr gap-2 py-0.5 px-0.5 overflow-hidden">
        {visibleReports.map((rep) => {
          const Icon = rep.icon;
          return (
            <button
              key={rep.id}
              type="button"
              onClick={() => setActiveReportId(rep.id)}
              className="royal-tile-3d relative w-full h-full min-h-0 rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/85 hover:border-[#D4AF37] px-2 py-1 text-right flex flex-col justify-center gap-1 shadow-md overflow-hidden"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="w-5 h-5 rounded-full bg-slate-950 border border-[#D4AF37] text-[#FDE68A] text-[9.5px] font-extrabold flex items-center justify-center tabular-nums shrink-0">
                  {rep.displayNum}
                </span>
                <div
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-br ${rep.accent} border border-[#D4AF37]/70 text-[#FDE68A] flex items-center justify-center shadow shrink-0`}
                >
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
              </div>
              <div className="min-w-0">
                <h3 className="text-[11.5px] sm:text-[12.5px] font-extrabold text-slate-900 dark:text-white leading-tight truncate">
                  {rep.title}
                </h3>
                <p className="text-[9.5px] font-bold text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {rep.subtitle}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* LIVE STOCK MONITOR MATRIX MODAL */}
      {showStockMonitor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 overflow-y-auto">
          <div className="w-full max-w-xl rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[90dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-[#061124] p-0.5 border-2 border-[#D4AF37] overflow-hidden shrink-0">
                  <img src={TAIBAH_ASSETS.logo} alt="طيبة نت" className="w-full h-full rounded-full object-contain" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">
                    {isAdmin ? 'مراقبة مخزون الكروت والمبيعات' : 'مخزون الكروت المتاحة بحسابك'}
                  </h3>
                  <p className="text-[11px] font-bold text-[#FDE68A]">
                    {isAdmin ? 'المرفوعة • المتاحة • المباعة • المحقونة' : 'المتاحة • المباعة من رصيدك الخاص'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowStockMonitor(false)}
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-[#1A365D] text-[#FDE68A]">
                      <th className="p-2.5 font-extrabold">الباقة</th>
                      {isAdmin && <th className="p-2.5 font-extrabold text-center">المرفوعة</th>}
                      <th className="p-2.5 font-extrabold text-center">المتاحة</th>
                      <th className="p-2.5 font-extrabold text-center">المباعة</th>
                      {isAdmin && <th className="p-2.5 font-extrabold text-center">المحقونة</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {displayPackages.map((p) => (
                      <tr key={p.id} className="border-t border-slate-200 dark:border-slate-800 font-bold tabular-nums">
                        <td className="p-2.5">{p.price} ر.ي ({p.dataLabel})</td>
                        {isAdmin && (
                          <td className="p-2.5 text-center text-blue-600">{formatCount(p.uploadedCount, hideNumbers)}</td>
                        )}
                        <td className="p-2.5 text-center text-emerald-600">{formatCount(p.availableCount, hideNumbers)}</td>
                        <td className="p-2.5 text-center text-amber-600">{formatCount(p.soldCount, hideNumbers)}</td>
                        {isAdmin && (
                          <td className="p-2.5 text-center text-purple-600">{formatCount(p.injectedCount, hideNumbers)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowStockMonitor(false);
                  setActiveReportId('packages_inventory');
                }}
                className="w-full min-h-[42px] gold-btn-3d text-[#0F172A] text-xs font-extrabold rounded-xl"
              >
                تصدير جدول المخزون (PDF / HD / Excel)
              </button>
            </div>
          </div>
        </div>
      )}
      {auditModalUser && (
        <AgentCardAuditModal
          targetUser={auditModalUser}
          hideNumbers={hideNumbers}
          mode="modal"
          onClose={() => setAuditModalUser(null)}
        />
      )}
    </div>
  );
};
