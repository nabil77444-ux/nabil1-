import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calendar,
  CreditCard,
  FileDown,
  FileSpreadsheet,
  FileText,
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
import {
  EXCLUSIVE_PACKAGES,
  formatCount,
  formatDateTimeAr,
  formatYER,
  getRoleArabicLabel,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type PackageDoc,
} from '../types/taibah';

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
}

const TEN_REPORTS: ReportCardMeta[] = [
  { id: 'direct_sales', num: 1, title: 'البيع المباشر', subtitle: 'كروت المستهلك 100%', accent: 'from-green-600 to-emerald-800', icon: Zap },
  { id: 'electronic_wholesale', num: 2, title: 'الجملة الإلكترونية', subtitle: 'توريد الوكلاء والعملاء', accent: 'from-blue-600 to-[#1A365D]', icon: CreditCard },
  { id: 'paper_invoices', num: 3, title: 'الفواتير الورقية', subtitle: 'مبيعات الكروت الورقية', accent: 'from-indigo-600 to-slate-800', icon: FileText },
  { id: 'customers_ledger', num: 4, title: 'الدفتر المحاسبي', subtitle: 'حسابات العملاء والقيود', accent: 'from-amber-500 to-yellow-700', icon: BookOpen },
  { id: 'debts_receivables', num: 5, title: 'الديون والمتبقي', subtitle: 'المبالغ الآجلة للتحصيل', accent: 'from-red-600 to-rose-800', icon: ShieldAlert },
  { id: 'profits_analysis', num: 6, title: 'تقرير الأرباح', subtitle: 'المتوقعة والمحققة فعلياً', accent: 'from-emerald-600 to-teal-800', icon: TrendingUp },
  { id: 'agents_performance', num: 7, title: 'الوكلاء ونقاط البيع', subtitle: 'الحسابات والأرصدة', accent: 'from-slate-700 to-[#0F172A]', icon: UserCheck },
  { id: 'topup_requests', num: 8, title: 'طلبات التغذية', subtitle: 'المعتمدة والمعلقة والمرفوضة', accent: 'from-cyan-600 to-blue-800', icon: Send },
  { id: 'packages_inventory', num: 9, title: 'جرد الباقات الثماني', subtitle: 'المتاح والمباع والمرفوع', accent: 'from-purple-600 to-violet-900', icon: Layers },
  { id: 'comprehensive_summary', num: 10, title: 'التقرير المالي الشامل', subtitle: 'ملخص الأداء العام', accent: 'from-[#B4860B] to-[#1A365D]', icon: Wallet },
];

export const ReportsCenterScreen: React.FC<ReportsCenterScreenProps> = ({ hideNumbers }) => {
  const { packages, sales, customers, topupRequests, managedUsers } = useFirebase();
  const { notifySuccess, notifyError } = useFeedback();

  const displayPackages = packages.length > 0 ? packages : (EXCLUSIVE_PACKAGES as PackageDoc[]);

  const [activeReportId, setActiveReportId] = useState<ReportId | null>(null);
  const [showStockMonitor, setShowStockMonitor] = useState(false);
  const [exportPreview, setExportPreview] = useState<ExportShareResult | null>(null);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Build strict independent data for the selected report
  const reportData = useMemo(() => {
    if (!activeReportId) return null;

    const inDateRange = (ms?: number) => {
      if (!ms) return true;
      if (fromDate && ms < new Date(fromDate).setHours(0, 0, 0, 0)) return false;
      if (toDate && ms > new Date(toDate).setHours(23, 59, 59, 999)) return false;
      return true;
    };
    const matchSearch = (fields: string[]) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return fields.some((f) => f.toLowerCase().includes(q));
    };

    switch (activeReportId) {
      case 'direct_sales': {
        const list = sales.filter(
          (s) =>
            s.saleType === 'direct' &&
            inDateRange(s.createdAt?.toMillis?.()) &&
            matchSearch([s.buyerName, s.buyerPhone || '', s.invoiceNumber || ''])
        );
        const total = list.reduce((a, b) => a + b.totalAmount, 0);
        const cards = list.reduce((a, b) => a + b.totalCards, 0);
        return {
          title: 'تقرير المبيعات المباشرة (100%)',
          headers: ['رقم الفاتورة', 'الزبون', 'الكروت', 'الإجمالي', 'التاريخ'],
          rows: list.map((s) => [
            s.invoiceNumber || s.id.slice(-6),
            s.buyerName,
            String(s.totalCards),
            `${s.totalAmount} ر.ي`,
            formatDateTimeAr(s.createdAt),
          ]),
          summary: [
            { label: 'عدد العمليات', value: String(list.length) },
            { label: 'إجمالي الكروت المباعة', value: `${cards} كرت` },
            { label: 'إجمالي إيراد البيع المباشر', value: `${total} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_البيع_المباشر',
        };
      }

      case 'electronic_wholesale': {
        const list = sales.filter(
          (s) =>
            s.saleType === 'electronic_wholesale' &&
            inDateRange(s.createdAt?.toMillis?.()) &&
            matchSearch([s.buyerName, s.buyerPhone || '', s.invoiceNumber || ''])
        );
        const total = list.reduce((a, b) => a + b.totalAmount, 0);
        const paid = list.reduce((a, b) => a + b.paidAmount, 0);
        const cards = list.reduce((a, b) => a + b.totalCards, 0);
        return {
          title: 'تقرير بيع الجملة الإلكتروني',
          headers: ['الفاتورة', 'المستلم', 'الكروت', 'المُسلّم', 'الإجمالي', 'المتبقي'],
          rows: list.map((s) => [
            s.invoiceNumber || s.id.slice(-6),
            s.buyerName,
            String(s.totalCards),
            String(s.deliveredCards),
            `${s.totalAmount} ر.ي`,
            `${s.remainingAmount} ر.ي`,
          ]),
          summary: [
            { label: 'إجمالي الكروت', value: `${cards} كرت` },
            { label: 'المدفوع نقداً', value: `${paid} ر.ي` },
            { label: 'إجمالي الجملة', value: `${total} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الجملة_الإلكترونية',
        };
      }

      case 'paper_invoices': {
        const list = sales.filter(
          (s) =>
            s.saleType === 'paper_invoice' &&
            inDateRange(s.createdAt?.toMillis?.()) &&
            matchSearch([s.buyerName, s.buyerPhone || '', s.invoiceNumber || ''])
        );
        const total = list.reduce((a, b) => a + b.totalAmount, 0);
        const rem = list.reduce((a, b) => a + b.remainingAmount, 0);
        return {
          title: 'تقرير الفواتير والكروت الورقية',
          headers: ['الفاتورة', 'العميل', 'الكروت', 'الإجمالي', 'المدفوع', 'المتبقي'],
          rows: list.map((s) => [
            s.invoiceNumber || s.id.slice(-6),
            s.buyerName,
            String(s.totalCards),
            `${s.totalAmount} ر.ي`,
            `${s.paidAmount} ر.ي`,
            `${s.remainingAmount} ر.ي`,
          ]),
          summary: [
            { label: 'عدد الفواتير الورقية', value: String(list.length) },
            { label: 'إجمالي المتبقي', value: `${rem} ر.ي` },
            { label: 'إجمالي الفواتير الورقية', value: `${total} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الفواتير_الورقية',
        };
      }

      case 'customers_ledger': {
        const list = customers.filter((c) => matchSearch([c.name, c.phone || '', c.category || '']));
        const debit = list.reduce((a, c) => a + (c.totalDebit || 0), 0);
        const credit = list.reduce((a, c) => a + (c.totalCredit || 0), 0);
        return {
          title: 'تقرير الدفتر المحاسبي العام وحسابات العملاء',
          headers: ['العميل', 'التصنيف', 'عليه (مدين)', 'له (دائن)', 'الصافي'],
          rows: list.map((c) => [
            c.name,
            c.category || 'عميل شبكة',
            `${c.totalDebit} ر.ي`,
            `${c.totalCredit} ر.ي`,
            c.balance > 0 ? `عليه ${c.balance}` : c.balance < 0 ? `له ${Math.abs(c.balance)}` : '0',
          ]),
          summary: [
            { label: 'إجمالي المدين', value: `${debit} ر.ي` },
            { label: 'إجمالي الدائن', value: `${credit} ر.ي` },
            { label: 'صافي الدفتر العام', value: `${debit - credit} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الدفتر_المحاسبي',
        };
      }

      case 'debts_receivables': {
        const saleDebts = sales.filter(
          (s) => s.remainingAmount > 0 && inDateRange(s.createdAt?.toMillis?.()) && matchSearch([s.buyerName, s.buyerPhone || ''])
        );
        const custDebts = customers.filter((c) => c.balance > 0 && matchSearch([c.name, c.phone || '']));
        const rows = [
          ...saleDebts.map((s) => [s.buyerName, 'فاتورة آجلة', s.buyerPhone || '-', `${s.remainingAmount} ر.ي`]),
          ...custDebts.map((c) => [c.name, `دفتر (${c.category || 'عميل'})`, c.phone || '-', `${c.balance} ر.ي`]),
        ];
        const totalDebts =
          saleDebts.reduce((a, s) => a + s.remainingAmount, 0) +
          custDebts.reduce((a, c) => a + c.balance, 0);
        return {
          title: 'تقرير الديون والمبالغ المتبقية للتحصيل',
          headers: ['الاسم', 'المصدر', 'الهاتف', 'المبلغ المستحق'],
          rows,
          summary: [
            { label: 'عدد الذمم المفتوحة', value: String(rows.length) },
            { label: 'إجمالي الديون المستحقة', value: `${totalDebts} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الديون_والمتبقي',
        };
      }

      case 'profits_analysis': {
        const list = sales.filter(
          (s) => inDateRange(s.createdAt?.toMillis?.()) && matchSearch([s.buyerName, s.invoiceNumber || ''])
        );
        const expected = list.reduce((a, s) => a + (s.expectedProfit || 0), 0);
        const realized = list.reduce((a, s) => a + (s.realizedProfit || 0), 0);
        return {
          title: 'تقرير الأرباح المتوقعة والمحققة فعلياً',
          headers: ['الفاتورة', 'العميل', 'الإجمالي', 'الربح المتوقع', 'الربح المحقق'],
          rows: list.map((s) => [
            s.invoiceNumber || s.id.slice(-6),
            s.buyerName,
            `${s.totalAmount} ر.ي`,
            `${s.expectedProfit || 0} ر.ي`,
            `${s.realizedProfit || 0} ر.ي`,
          ]),
          summary: [
            { label: 'إجمالي الأرباح المتوقعة', value: `${expected} ر.ي` },
            { label: 'إجمالي الأرباح المحققة نقداً', value: `${realized} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الأرباح',
        };
      }

      case 'agents_performance': {
        const list = managedUsers.filter(
          (u) => u.role !== 'super_admin' && matchSearch([u.name, u.phone])
        );
        const totalBal = list.reduce((a, u) => a + (u.balance || 0), 0);
        return {
          title: 'تقرير الوكلاء ونقاط البيع والعملاء',
          headers: ['الاسم', 'الدور', 'الهاتف', 'النسبة', 'الرصيد'],
          rows: list.map((u) => [
            u.name,
            getRoleArabicLabel(u.role),
            u.phone,
            `${u.discountRate || 80}%`,
            `${u.balance || 0} ر.ي`,
          ]),
          summary: [
            { label: 'إجمالي الحسابات', value: String(list.length) },
            { label: 'مجموع الأرصدة', value: `${totalBal} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_الوكلاء_والعملاء',
        };
      }

      case 'topup_requests': {
        const list = topupRequests.filter(
          (t) =>
            inDateRange(t.createdAt?.toMillis?.()) &&
            matchSearch([t.requesterName, t.targetName || ''])
        );
        const total = list.reduce((a, t) => a + t.totalAmount, 0);
        return {
          title: 'تقرير طلبات التغذية (ثنائي المستوى)',
          headers: ['مقدم الطلب', 'الموجّه إليه', 'الكروت', 'المبلغ', 'الحالة'],
          rows: list.map((t) => [
            t.requesterName,
            t.targetName || SUPER_ADMIN_CONFIG.name,
            String(t.totalCards),
            `${t.totalAmount} ر.ي`,
            t.status === 'approved' ? 'مُنفّذ ✅' : t.status === 'pending' ? 'معلق' : 'مرفوض',
          ]),
          summary: [
            { label: 'عدد الطلبات', value: String(list.length) },
            { label: 'إجمالي قيمة التغذيات', value: `${total} ر.ي`, highlight: true },
          ],
          fileName: 'تقرير_طلبات_التغذية',
        };
      }

      case 'packages_inventory': {
        const list = displayPackages.filter((p) => matchSearch([String(p.price), p.dataLabel]));
        const avail = list.reduce((a, p) => a + p.availableCount, 0);
        const sold = list.reduce((a, p) => a + p.soldCount, 0);
        const uploaded = list.reduce((a, p) => a + p.uploadedCount, 0);
        const injected = list.reduce((a, p) => a + p.injectedCount, 0);
        return {
          title: 'تقرير جرد الباقات الثماني والمخزون',
          headers: ['الباقة', 'المرفوعة', 'المتاحة', 'المباعة', 'المحقونة'],
          rows: list.map((p) => [
            `${p.price} ر.ي (${p.dataLabel})`,
            String(p.uploadedCount),
            String(p.availableCount),
            String(p.soldCount),
            String(p.injectedCount),
          ]),
          summary: [
            { label: 'إجمالي المرفوعة', value: `${uploaded} كرت` },
            { label: 'إجمالي المباعة', value: `${sold} كرت` },
            { label: 'إجمالي المحقونة', value: `${injected} كرت` },
            { label: 'إجمالي المتاح حالياً', value: `${avail} كرت`, highlight: true },
          ],
          fileName: 'تقرير_جرد_الباقات',
        };
      }

      default: {
        const totalSalesAmt = sales.reduce((a, s) => a + s.totalAmount, 0);
        const totalPaidAmt = sales.reduce((a, s) => a + s.paidAmount, 0);
        const totalRemAmt = sales.reduce((a, s) => a + s.remainingAmount, 0);
        const totalCardsSold = sales.reduce((a, s) => a + s.totalCards, 0);
        const totalAvail = displayPackages.reduce((a, p) => a + p.availableCount, 0);
        return {
          title: 'التقرير المالي الشامل — شبكة طيبة نت',
          headers: ['البند المالي / التشغيلي', 'القيمة الحية'],
          rows: [
            ['إجمالي عمليات البيع المسجلة', `${sales.length} عملية`],
            ['إجمالي الكروت المباعة', `${totalCardsSold} كرت`],
            ['إجمالي قيمة المبيعات', `${totalSalesAmt} ر.ي`],
            ['إجمالي التحصيل النقدي الفوري', `${totalPaidAmt} ر.ي`],
            ['إجمالي الآجل / المتبقي', `${totalRemAmt} ر.ي`],
            ['إجمالي الكروت المتاحة بالمخزون', `${totalAvail} كرت`],
            ['عدد حسابات الدفتر العام', `${customers.length} حساب`],
            ['عدد الوكلاء ونقاط البيع', `${managedUsers.filter((u) => u.role !== 'super_admin').length} حساب`],
            ['عدد طلبات التغذية المسجلة', `${topupRequests.length} طلب`],
          ],
          summary: [
            { label: 'التحصيل النقدي', value: `${totalPaidAmt} ر.ي` },
            { label: 'إجمالي المبيعات', value: `${totalSalesAmt} ر.ي`, highlight: true },
          ],
          fileName: 'التقرير_المالي_الشامل',
        };
      }
    }
  }, [activeReportId, sales, customers, managedUsers, topupRequests, displayPackages, search, fromDate, toDate]);

  const buildReportPrintable = (data: NonNullable<typeof reportData>): PrintableDocumentPayload => ({
    title: data.title,
    subtitle: `تقرير معتمد — ${SUPER_ADMIN_CONFIG.name}`,
    metaRows: [
      { label: 'الشبكة', value: 'شبكة طيبة نت اللاسلكية (TAIBAH NET)' },
      { label: 'تاريخ التصدير', value: formatDateTimeAr(new Date()) },
      { label: 'من تاريخ', value: fromDate || 'من البداية' },
      { label: 'إلى تاريخ', value: toDate || 'حتى الآن' },
    ],
    tableHeaders: data.headers,
    tableRows: data.rows,
    summaryRows: data.summary,
    fileName: data.fileName,
    shareText: buildReportShareText(data),
  });

  const buildReportShareText = (data: NonNullable<typeof reportData>): string => {
    const lines = [
      `📶 شبكة طيبة نت اللاسلكية (TAIBAH NET)`,
      `📊 ${data.title}`,
      `🗓 ${formatDateTimeAr(new Date())}`,
      `────────────────────`,
      ...data.summary.map((s) => `• ${s.label}: ${s.value}`),
      `────────────────────`,
      `عدد السجلات: ${data.rows.length}`,
      `📞 ${SUPER_ADMIN_CONFIG.developerCredit}`,
    ];
    return lines.join('\n');
  };

  // Dedicated Independent Report View
  if (activeReportId && reportData) {
    return (
      <div className="space-y-3.5">
        <div className="royal-header-3d rounded-3xl border-2 border-[#D4AF37] p-3.5 flex items-center justify-between gap-2 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setActiveReportId(null);
              setSearch('');
            }}
            className="min-h-[38px] px-3 rounded-xl bg-white/15 border border-[#D4AF37] text-white text-xs font-extrabold flex items-center gap-1"
          >
            <ArrowRight className="w-4 h-4" />
            مركز التقارير
          </button>
          <h2 className="text-sm font-extrabold text-[#FDE68A] truncate flex-1 text-center">
            {reportData.title}
          </h2>
          <img src={TAIBAH_ASSETS.logo} alt="طيبة نت" className="w-9 h-9 rounded-full object-cover border border-[#D4AF37] shrink-0" />
        </div>

        {/* Date Range + Search Filters */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#D4AF37]/60 p-3 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث داخل التقرير..."
              className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs font-bold"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="flex-1 min-h-[36px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 text-xs font-bold"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="flex-1 min-h-[36px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 text-xs font-bold"
              />
            </div>
          </div>
        </div>

        {/* Live Summary Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {reportData.summary.map((s, i) => (
            <div
              key={i}
              className={`rounded-2xl p-3 text-center border-2 ${
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

        {/* Export Suite: WhatsApp, SMS, PDF, HD Image (scale 3), Excel, Print */}
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
                notifySuccess('تم تجهيز الملف بنجاح ✅');
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
                notifySuccess('تم تجهيز الملف بنجاح ✅');
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
                await exportAsExcel(reportData.title, reportData.headers, reportData.rows, reportData.fileName);
                notifySuccess('تم تجهيز الملف بنجاح ✅');
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

        {/* Report Table */}
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
                  reportData.rows.map((row, rIdx) => (
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
        </div>

        <ExportPreviewModal result={exportPreview} onClose={() => setExportPreview(null)} />
      </div>
    );
  }

  // Main Reports Center Overview (Update 9)
  return (
    <div className="space-y-3.5">
      {/* Royal Hero Card with Official Logo */}
      <div className="royal-header-3d rounded-3xl border-2 border-[#D4AF37] p-4 shadow-xl flex items-center justify-between gap-3">
        <div className="w-12 h-12 rounded-2xl bg-white/15 border border-[#D4AF37] flex items-center justify-center text-[#FDE68A] shrink-0">
          <BarChart3 className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0 text-center">
          <h2 className="text-base sm:text-lg font-extrabold text-white truncate">
            مركز التقارير الشامل (10 تقارير مستقلة)
          </h2>
          <p className="text-[11px] font-bold text-[#FDE68A] truncate">
            تصدير فوري PDF • صور HD • Excel • واتساب و SMS بالشعار الرسمي
          </p>
        </div>
        <div className="w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shrink-0 shadow-lg">
          <img
            src={TAIBAH_ASSETS.logo}
            alt="شعار طيبة نت"
            className="w-full h-full rounded-full object-cover"
          />
        </div>
      </div>

      {/* Prominent Gold-Bordered Stock & Sales Monitoring Button (Update 9) */}
      <button
        type="button"
        onClick={() => setShowStockMonitor(true)}
        className="w-full min-h-[52px] rounded-2xl bg-gradient-to-l from-[#0F172A] via-[#1A365D] to-[#1E3A8A] border-2 border-[#D4AF37] px-4 py-2.5 text-[#FDE68A] font-extrabold text-xs sm:text-sm shadow-xl flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
      >
        <Layers className="w-5 h-5 shrink-0" />
        <span>مراقبة مخزون الكروت والمبيعات (المرفوعة • المتاحة • المباعة • المحقونة)</span>
      </button>

      {/* 2×5 Grid of 10 Strictly Independent Reports */}
      <div className="grid grid-cols-2 gap-2.5">
        {TEN_REPORTS.map((rep) => {
          const Icon = rep.icon;
          return (
            <button
              key={rep.id}
              type="button"
              onClick={() => setActiveReportId(rep.id)}
              className="royal-tile-3d relative rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/80 hover:border-[#D4AF37] p-3 text-right flex flex-col justify-between gap-2 shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="w-6 h-6 rounded-full bg-slate-950 border border-[#D4AF37] text-[#FDE68A] text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                  {rep.num}
                </span>
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${rep.accent} border border-[#D4AF37]/70 text-[#FDE68A] flex items-center justify-center shadow`}
                >
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white leading-snug">
                  {rep.title}
                </h3>
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
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
                <img src={TAIBAH_ASSETS.logo} alt="طيبة نت" className="w-9 h-9 rounded-full object-cover border border-[#D4AF37]" />
                <div>
                  <h3 className="text-sm font-extrabold text-white">مراقبة مخزون الكروت والمبيعات</h3>
                  <p className="text-[11px] font-bold text-[#FDE68A]">المرفوعة • المتاحة • المباعة • المحقونة</p>
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
                      <th className="p-2.5 font-extrabold text-center">المرفوعة</th>
                      <th className="p-2.5 font-extrabold text-center">المتاحة</th>
                      <th className="p-2.5 font-extrabold text-center">المباعة</th>
                      <th className="p-2.5 font-extrabold text-center">المحقونة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayPackages.map((p) => (
                      <tr key={p.id} className="border-t border-slate-200 dark:border-slate-800 font-bold tabular-nums">
                        <td className="p-2.5">{p.price} ر.ي ({p.dataLabel})</td>
                        <td className="p-2.5 text-center text-blue-600">{formatCount(p.uploadedCount, hideNumbers)}</td>
                        <td className="p-2.5 text-center text-emerald-600">{formatCount(p.availableCount, hideNumbers)}</td>
                        <td className="p-2.5 text-center text-amber-600">{formatCount(p.soldCount, hideNumbers)}</td>
                        <td className="p-2.5 text-center text-purple-600">{formatCount(p.injectedCount, hideNumbers)}</td>
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
    </div>
  );
};
