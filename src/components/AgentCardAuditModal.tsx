import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  CreditCard,
  FileDown,
  FileSpreadsheet,
  ImageDown,
  Layers,
  Loader2,
  MessageSquare,
  Package,
  Printer,
  RefreshCw,
  Search,
  Send,
  TrendingUp,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import { useDebounce } from '../hooks/useDebounce';
import {
  exportAsArabicPDF,
  exportAsExcel,
  exportAsHDImage,
  openSmsShare,
  openWhatsAppShare,
  printRoyalDocument,
  type PrintableDocumentPayload,
} from '../lib/exportUtils';
import {
  formatCount,
  formatDateDDMMYYYY,
  formatDateTimeAr,
  formatYER,
  getRoleArabicLabel,
  SUPER_ADMIN_CONFIG,
  type AgentCardInventoryReport,
  type UserProfile,
} from '../types/taibah';

interface AgentCardAuditModalProps {
  targetUser: UserProfile;
  hideNumbers?: boolean;
  mode?: 'modal' | 'inline';
  onClose?: () => void;
}

const PAGE_SIZE = 50;

function getSaleTypeAr(saleType: 'direct' | 'electronic_wholesale' | 'paper_invoice'): string {
  if (saleType === 'direct') return 'بيع مباشر';
  if (saleType === 'electronic_wholesale') return 'جملة إلكترونية';
  return 'فاتورة ورقية';
}

export const AgentCardAuditModal: React.FC<AgentCardAuditModalProps> = React.memo(
  ({ targetUser, hideNumbers = false, mode = 'modal', onClose }) => {
    const { fetchUserCardInventory } = useFirebase();
    const { notifySuccess, notifyError, notifyInfo } = useFeedback();

    const [report, setReport] = useState<AgentCardInventoryReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'sold' | 'remaining'>('sold');
    const [searchText, setSearchText] = useState('');
    const debouncedSearch = useDebounce(searchText, 180);
    const [pkgFilter, setPkgFilter] = useState<string>('all');
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [exporting, setExporting] = useState(false);

    const loadReport = useCallback(
      async (forceRefresh = false) => {
        setLoading(true);
        try {
          const data = await fetchUserCardInventory(targetUser, forceRefresh);
          setReport(data);
        } catch {
          notifyError('تعذر جلب كشف الكروت', 'يرجى التحقق من الاتصال والمحاولة مجدداً.');
        } finally {
          setLoading(false);
        }
      },
      [fetchUserCardInventory, notifyError, targetUser]
    );

    useEffect(() => {
      setVisibleCount(PAGE_SIZE);
      setSearchText('');
      setPkgFilter('all');
      void loadReport(false);
    }, [loadReport, targetUser.uid]);

    useEffect(() => {
      setVisibleCount(PAGE_SIZE);
    }, [activeTab, debouncedSearch, pkgFilter]);

    const filteredSold = useMemo(() => {
      if (!report) return [];
      const q = debouncedSearch.trim().toLowerCase();
      return report.soldCards.filter((row) => {
        if (pkgFilter !== 'all' && row.packageId !== pkgFilter) return false;
        if (!q) return true;
        return (
          row.cardNumber.toLowerCase().includes(q) ||
          row.buyerName.toLowerCase().includes(q) ||
          row.buyerPhone.toLowerCase().includes(q) ||
          row.packageLabel.toLowerCase().includes(q) ||
          row.invoiceNumber.toLowerCase().includes(q)
        );
      });
    }, [debouncedSearch, pkgFilter, report]);

    const filteredRemaining = useMemo(() => {
      if (!report) return [];
      const q = debouncedSearch.trim().toLowerCase();
      return report.remainingCards.filter((row) => {
        if (pkgFilter !== 'all' && row.packageId !== pkgFilter) return false;
        if (!q) return true;
        return (
          row.cardNumber.toLowerCase().includes(q) ||
          row.packageLabel.toLowerCase().includes(q)
        );
      });
    }, [debouncedSearch, pkgFilter, report]);

    const visibleSold = useMemo(
      () => filteredSold.slice(0, visibleCount),
      [filteredSold, visibleCount]
    );
    const visibleRemaining = useMemo(
      () => filteredRemaining.slice(0, visibleCount),
      [filteredRemaining, visibleCount]
    );

    const buildSummaryShareText = useCallback((): string => {
      if (!report) return '';
      const pkgLines = report.byPackage
        .filter((p) => p.receivedCount > 0 || p.soldCount > 0 || p.remainingCount > 0)
        .map(
          (p) =>
            `• باقة ${p.price} ر.ي (${p.dataLabel}): مستلم ${p.receivedCount} | مباع ${p.soldCount} | متبقي ${p.remainingCount}${p.recalledCount > 0 ? ` | مسحوب ${p.recalledCount}` : ''}`
        );
      return [
        '🌐 *شبكة طيبة نت اللاسلكية — TAIBAH NET*',
        '📋 *كشف حركة الكروت والمبيعات التفصيلي*',
        '━━━━━━━━━━━━━━━━━━',
        `👤 *الحساب:* ${report.targetName} (${getRoleArabicLabel(report.targetRole)})`,
        `📱 *الهاتف:* ${report.targetPhone}`,
        `📅 *تاريخ الكشف:* ${formatDateDDMMYYYY(new Date())}`,
        '━━━━━━━━━━━━━━━━━━',
        `📥 *إجمالي الكروت المستلمة:* ${formatCount(report.totalReceived)} كرت`,
        `✅ *إجمالي المباع:* ${formatCount(report.totalSold)} كرت`,
        `📦 *المتبقي لديه حالياً:* ${formatCount(report.totalRemaining)} كرت`,
        report.totalRecalled > 0
          ? `↩️ *المرتجع / المسحوب:* ${formatCount(report.totalRecalled)} كرت`
          : '',
        '━━━━━━━━━━━━━━━━━━',
        ...(pkgLines.length > 0 ? pkgLines : ['لا توجد حركات كروت مسجلة بعد.']),
        '━━━━━━━━━━━━━━━━━━',
        `📞 *الإدارة:* ${SUPER_ADMIN_CONFIG.name} (${SUPER_ADMIN_CONFIG.phone})`,
      ]
        .filter(Boolean)
        .join('\n');
    }, [report]);

    const buildPrintablePayload = useCallback((): PrintableDocumentPayload | null => {
      if (!report) return null;
      return {
        title: `كشف كروت ومبيعات — ${report.targetName}`,
        subtitle: `${getRoleArabicLabel(report.targetRole)} • ${report.targetPhone} • ${formatDateDDMMYYYY(new Date())}`,
        fileName: `taibah_cards_audit_${report.targetPhone || report.targetUid}`,
        metaRows: [
          { label: 'الاسم', value: report.targetName },
          { label: 'الهاتف', value: report.targetPhone },
          { label: 'الصفة', value: getRoleArabicLabel(report.targetRole) },
          { label: 'إجمالي المستلمة', value: `${formatCount(report.totalReceived)} كرت` },
          { label: 'إجمالي المباع', value: `${formatCount(report.totalSold)} كرت` },
          { label: 'المتبقي حالياً', value: `${formatCount(report.totalRemaining)} كرت` },
        ],
        tableHeaders: [
          'رقم الكرت',
          'الفئة',
          'الحالة / المشتري',
          'هاتف المشتري',
          'نوع البيع',
          'التاريخ والوقت',
        ],
        tableRows: [
          ...report.soldCards.slice(0, 500).map((r) => [
            r.cardNumber,
            `${r.packagePrice} ر.ي`,
            r.buyerName,
            r.buyerPhone || '-',
            getSaleTypeAr(r.saleType),
            formatDateTimeAr(new Date(r.soldAtMs)),
          ]),
          ...report.remainingCards.slice(0, 500).map((r) => [
            r.cardNumber,
            `${r.packagePrice} ر.ي`,
            'متبقي غير مباع',
            '-',
            'رصيد حالي',
            '-',
          ]),
        ],
        summaryRows: [
          { label: 'إجمالي المستلمة', value: `${formatCount(report.totalReceived)} كرت` },
          { label: 'إجمالي المباع', value: `${formatCount(report.totalSold)} كرت` },
          { label: 'المتبقي حالياً', value: `${formatCount(report.totalRemaining)} كرت`, highlight: true },
        ],
        shareText: buildSummaryShareText(),
      };
    }, [buildSummaryShareText, report]);

    const handleExport = async (kind: 'pdf' | 'hd' | 'excel' | 'print' | 'wa' | 'sms' | 'copy') => {
      if (!report) return;
      if (kind === 'wa') {
        openWhatsAppShare(report.targetPhone, buildSummaryShareText());
        return;
      }
      if (kind === 'sms') {
        openSmsShare(report.targetPhone, buildSummaryShareText());
        return;
      }
      if (kind === 'copy') {
        try {
          await navigator.clipboard.writeText(buildSummaryShareText());
          notifySuccess('تم نسخ كشف الكروت والمبيعات بنجاح ✅');
        } catch {
          notifyInfo('تعذر النسخ التلقائي');
        }
        return;
      }
      const payload = buildPrintablePayload();
      if (!payload) return;
      setExporting(true);
      try {
        if (kind === 'pdf') await exportAsArabicPDF(payload);
        else if (kind === 'hd') await exportAsHDImage(payload);
        else if (kind === 'excel') {
          await exportAsExcel(
            payload.title,
            payload.tableHeaders,
            payload.tableRows,
            payload.fileName
          );
        } else if (kind === 'print') {
          await printRoyalDocument(payload);
        }
        notifySuccess('تم تجهيز وتصدير الكشف بنجاح ✅');
      } catch {
        notifyError('تعذر التصدير', 'يرجى إعادة المحاولة.');
      } finally {
        setExporting(false);
      }
    };

    const effectiveDiscountRate = Number(
      targetUser.discountRate || (targetUser.role === 'agent' ? 70 : targetUser.role === 'client' ? 80 : 100)
    );
    const entityShareLabel = targetUser.role === 'agent' ? 'حق الوكيل' : 'حق العميل';

    const content = (
      <div className="space-y-2.5" dir="rtl">
        {/* Top Account Bar & Actions (Rendered ONLY in standalone modal mode to avoid duplicating Reports header) */}
        {mode === 'modal' && (
          <div className="rounded-2xl bg-gradient-to-l from-[#0F172A] to-[#1A365D] border-2 border-[#D4AF37] p-3 text-white shadow-md">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37] flex items-center justify-center shrink-0">
                <UserCheck className="w-5 h-5 text-[#FDE68A]" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-[#FDE68A] truncate">
                  كشف الكروت والمبيعات — {targetUser.name}
                </h3>
                <p className="text-[11px] font-bold text-slate-200 tabular-nums">
                  {getRoleArabicLabel(targetUser.role)} • {targetUser.phone}
                  {report?.fromCache ? ' • (عرض فوري من الكاش)' : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadReport(true)}
                className="min-h-[34px] px-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-[#D4AF37]/60 text-[11px] font-extrabold text-[#FDE68A] flex items-center gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>تحديث سحابي</span>
              </button>
              {mode === 'modal' && onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 rounded-xl bg-white/10 hover:bg-red-500/80 text-white flex items-center justify-center"
                  aria-label="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Export / Share Strip */}
          <div className="mt-2.5 pt-2 border-t border-white/15 flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              disabled={!report || exporting}
              onClick={() => void handleExport('wa')}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10.5px] font-extrabold flex items-center gap-1"
            >
              <Send className="w-3 h-3" /> واتساب
            </button>
            <button
              type="button"
              disabled={!report || exporting}
              onClick={() => void handleExport('sms')}
              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10.5px] font-extrabold flex items-center gap-1"
            >
              <MessageSquare className="w-3 h-3" /> SMS
            </button>
            <button
              type="button"
              disabled={!report || exporting}
              onClick={() => void handleExport('pdf')}
              className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10.5px] font-extrabold flex items-center gap-1"
            >
              <FileDown className="w-3 h-3" /> PDF
            </button>
            <button
              type="button"
              disabled={!report || exporting}
              onClick={() => void handleExport('hd')}
              className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-[#0F172A] text-[10.5px] font-extrabold flex items-center gap-1"
            >
              <ImageDown className="w-3 h-3" /> صورة HD
            </button>
            <button
              type="button"
              disabled={!report || exporting}
              onClick={() => void handleExport('excel')}
              className="px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[10.5px] font-extrabold flex items-center gap-1"
            >
              <FileSpreadsheet className="w-3 h-3" /> Excel
            </button>
            <button
              type="button"
              disabled={!report || exporting}
              onClick={() => void handleExport('print')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-[10.5px] font-extrabold flex items-center gap-1"
            >
              <Printer className="w-3 h-3" /> طباعة
            </button>
            <button
              type="button"
              disabled={!report}
              onClick={() => void handleExport('copy')}
              className="px-2.5 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[10.5px] font-extrabold flex items-center gap-1"
            >
              <Copy className="w-3 h-3" /> نسخ
            </button>
          </div>
        </div>
        )}

        {loading && !report ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/40 p-6 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-[#1A365D] dark:text-[#FDE68A] mx-auto" />
            <p className="mt-1.5 text-xs font-extrabold text-slate-600 dark:text-slate-300">
              جاري مطابقة الكروت المستلمة والمباعة والمتبقية...
            </p>
          </div>
        ) : report ? (
          <>
            {/* Top 4 Summary Icons Strip: المستلم | الباقي | باع | المحاسبة والرصيد */}
            <div className="grid grid-cols-4 gap-1.5">
              <div className="rounded-xl bg-[#1A365D] text-white border border-[#D4AF37]/80 px-1.5 py-2 text-center shadow-sm">
                <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-[#FDE68A]">
                  <Layers className="w-3 h-3 shrink-0" />
                  <span className="truncate">المستلم</span>
                </div>
                <p className="mt-0.5 text-sm font-black tabular-nums">
                  {hideNumbers ? '••' : formatCount(report.totalReceived)}
                </p>
              </div>
              <div className="rounded-xl bg-amber-500 text-[#0F172A] border border-amber-700/70 px-1.5 py-2 text-center shadow-sm">
                <div className="flex items-center justify-center gap-1 text-[10px] font-extrabold">
                  <Package className="w-3 h-3 shrink-0" />
                  <span className="truncate">الباقي</span>
                </div>
                <p className="mt-0.5 text-sm font-black tabular-nums">
                  {hideNumbers ? '••' : formatCount(report.totalRemaining)}
                </p>
              </div>
              <div className="rounded-xl bg-emerald-600 text-white border border-emerald-400/80 px-1.5 py-2 text-center shadow-sm">
                <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-emerald-100">
                  <TrendingUp className="w-3 h-3 shrink-0" />
                  <span className="truncate">باع</span>
                </div>
                <p className="mt-0.5 text-sm font-black tabular-nums">
                  {hideNumbers ? '••' : formatCount(report.totalSold)}
                </p>
              </div>
              <div className="rounded-xl bg-gradient-to-br from-[#0F172A] to-indigo-950 text-white border border-[#D4AF37]/70 px-1.5 py-2 text-center shadow-sm">
                <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-[#FDE68A]">
                  <Wallet className="w-3 h-3 shrink-0" />
                  <span className="truncate">الرصيد</span>
                </div>
                <p className="mt-0.5 text-[11px] font-black tabular-nums truncate">
                  {hideNumbers ? '••••' : formatYER(targetUser.balance || 0)}
                </p>
              </div>
            </div>

            {/* 8 Exclusive Packages Exact Breakdown Strip & Table */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#D4AF37]/60 overflow-hidden shadow-sm">
              <div className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                <span className="text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-1.5 truncate">
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>الباقات الثماني (استلم • باع • باقي)</span>
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-0.5">
                    <CheckCircle2 className="w-3 h-3" /> مطابق
                  </span>
                  {mode === 'inline' && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void loadReport(true)}
                      aria-label="تحديث كشف الكروت"
                      className="w-6 h-6 rounded-lg bg-[#1A365D] text-[#FDE68A] flex items-center justify-center"
                    >
                      <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-[11px]">
                  <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 font-extrabold">
                    <tr>
                      <th className="px-2.5 py-2">الفئة</th>
                      <th className="px-2 py-2 text-center">المستلم</th>
                      <th className="px-2 py-2 text-center">المباع</th>
                      <th className="px-2 py-2 text-center">المتبقي حالياً</th>
                      <th className="px-2 py-2 text-center">مسحوب/مرتجع</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {report.byPackage.map((row) => (
                      <tr
                        key={row.packageId}
                        className="hover:bg-blue-50/50 dark:hover:bg-slate-800/40 font-bold"
                      >
                        <td className="px-2.5 py-1.5 text-slate-900 dark:text-white whitespace-nowrap">
                          {row.price} ر.ي ({row.dataLabel})
                        </td>
                        <td className="px-2 py-1.5 text-center tabular-nums text-[#1A365D] dark:text-blue-300">
                          {hideNumbers ? '••' : formatCount(row.receivedCount)}
                        </td>
                        <td className="px-2 py-1.5 text-center tabular-nums text-emerald-700 dark:text-emerald-400">
                          {hideNumbers ? '••' : formatCount(row.soldCount)}
                        </td>
                        <td className="px-2 py-1.5 text-center tabular-nums text-amber-700 dark:text-amber-300 font-extrabold">
                          {hideNumbers ? '••' : formatCount(row.remainingCount)}
                        </td>
                        <td className="px-2 py-1.5 text-center tabular-nums text-slate-500 dark:text-slate-400">
                          {hideNumbers ? '••' : formatCount(row.recalledCount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tabs: "لمن باع" vs "الكروت المتبقية حالياً" */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/50 p-3 shadow-sm space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('sold')}
                  className={`min-h-[38px] rounded-xl border-2 text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                    activeTab === 'sold'
                      ? 'bg-[#1A365D] text-white border-[#D4AF37]'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-transparent'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>سجل «لمن باع» ({formatCount(report.soldCards.length)})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('remaining')}
                  className={`min-h-[38px] rounded-xl border-2 text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                    activeTab === 'remaining'
                      ? 'bg-amber-500 text-[#0F172A] border-[#92400E]'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-transparent'
                  }`}
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>المتبقي غير المباع ({formatCount(report.remainingCards.length)})</span>
                </button>
              </div>

              {/* Debounced Instant Search + Package Filter */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2 relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder={
                      activeTab === 'sold'
                        ? 'بحث برقم الكرت أو اسم المشتري أو الهاتف أو الفاتورة...'
                        : 'بحث برقم الكرت المتبقي أو الفئة...'
                    }
                    className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-8 pl-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
                <select
                  value={pkgFilter}
                  onChange={(e) => setPkgFilter(e.target.value)}
                  className="min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                >
                  <option value="all">جميع الباقات الثماني</option>
                  {report.byPackage.map((p) => (
                    <option key={p.packageId} value={p.packageId}>
                      باقة {p.price} ر.ي ({p.dataLabel})
                    </option>
                  ))}
                </select>
              </div>

              {/* Table View with 50/page Pagination */}
              {activeTab === 'sold' ? (
                filteredSold.length === 0 ? (
                  <p className="text-center py-6 text-xs font-bold text-slate-500 dark:text-slate-400">
                    لا توجد مبيعات مطابقة لخيارات البحث الحالية.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto max-h-[340px] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
                      <table className="w-full text-right text-[11px]">
                        <thead className="sticky top-0 bg-[#1A365D] text-white font-extrabold">
                          <tr>
                            <th className="px-2 py-2">رقم الكرت</th>
                            <th className="px-2 py-2">الفئة</th>
                            <th className="px-2 py-2">المشتري (لمن باع)</th>
                            <th className="px-2 py-2">التاريخ والوقت</th>
                            <th className="px-2 py-2">السعر</th>
                            <th className="px-2 py-2">حق الإدارة</th>
                            <th className="px-2 py-2">{entityShareLabel}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {visibleSold.map((row, idx) => {
                            const price = Number(row.packagePrice || 0);
                            const adminShare = Math.round((price * effectiveDiscountRate) / 100);
                            const entityShare = Math.max(0, price - adminShare);
                            return (
                              <tr
                                key={`${row.cardNumber}_${idx}`}
                                className="hover:bg-slate-50 dark:hover:bg-slate-800/50 font-bold"
                              >
                                <td className="px-2 py-1.5 font-mono font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums whitespace-nowrap">
                                  {row.cardNumber}
                                </td>
                                <td className="px-2 py-1.5 whitespace-nowrap">
                                  {formatYER(price)}
                                </td>
                                <td className="px-2 py-1.5 text-slate-900 dark:text-white">
                                  <div className="font-extrabold leading-tight">{row.buyerName}</div>
                                  <div className="text-[9.5px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                                    {row.buyerPhone || '—'} • {getSaleTypeAr(row.saleType)}
                                  </div>
                                </td>
                                <td className="px-2 py-1.5 whitespace-nowrap text-slate-500 dark:text-slate-400 tabular-nums">
                                  {formatDateTimeAr(new Date(row.soldAtMs))}
                                </td>
                                <td className="px-2 py-1.5 whitespace-nowrap font-extrabold text-slate-900 dark:text-white tabular-nums">
                                  {hideNumbers ? '••••' : formatYER(price)}
                                </td>
                                <td className="px-2 py-1.5 whitespace-nowrap font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                                  {hideNumbers ? '••••' : formatYER(adminShare)}
                                </td>
                                <td className="px-2 py-1.5 whitespace-nowrap font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                  {hideNumbers ? '••••' : formatYER(entityShare)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {filteredSold.length > visibleCount && (
                      <button
                        type="button"
                        onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                        className="w-full min-h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]"
                      >
                        عرض المزيد ({formatCount(Math.min(PAGE_SIZE, filteredSold.length - visibleCount))} كرت إضافي من أصل {formatCount(filteredSold.length)})
                      </button>
                    )}
                  </>
                )
              ) : filteredRemaining.length === 0 ? (
                <p className="text-center py-6 text-xs font-bold text-slate-500 dark:text-slate-400">
                  لا توجد كروت متبقية غير مباعة مطابقة للبحث.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto max-h-[340px] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-right text-[11px]">
                      <thead className="sticky top-0 bg-amber-600 text-white font-extrabold">
                        <tr>
                          <th className="px-2.5 py-2">#</th>
                          <th className="px-2.5 py-2">رقم الكرت المتبقي</th>
                          <th className="px-2.5 py-2">الفئة</th>
                          <th className="px-2.5 py-2">الحالة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {visibleRemaining.map((row, idx) => (
                          <tr
                            key={row.id}
                            className="hover:bg-amber-50/50 dark:hover:bg-slate-800/50 font-bold"
                          >
                            <td className="px-2.5 py-1.5 text-slate-500 tabular-nums">{idx + 1}</td>
                            <td className="px-2.5 py-1.5 font-mono font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                              {row.cardNumber}
                            </td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap">{row.packageLabel}</td>
                            <td className="px-2.5 py-1.5 text-emerald-700 dark:text-emerald-400">
                              متاح لدى الحساب (غير مباع)
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredRemaining.length > visibleCount && (
                    <button
                      type="button"
                      onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                      className="w-full min-h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]"
                    >
                      عرض المزيد ({formatCount(Math.min(PAGE_SIZE, filteredRemaining.length - visibleCount))} كرت إضافي من أصل {formatCount(filteredRemaining.length)})
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        ) : null}
      </div>
    );

    if (mode === 'inline') {
      return content;
    }

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) onClose();
        }}
      >
        <div className="w-full max-w-3xl max-h-[92dvh] overflow-y-auto rounded-3xl bg-slate-100 dark:bg-slate-950 border-2 border-[#D4AF37] p-3 sm:p-4 shadow-2xl">
          {content}
        </div>
      </div>
    );
  }
);

AgentCardAuditModal.displayName = 'AgentCardAuditModal';
