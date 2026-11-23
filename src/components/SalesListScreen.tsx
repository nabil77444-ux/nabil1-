import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Edit3,
  Eye,
  FileDown,
  ImageDown,
  MessageSquare,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Send,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import {
  exportAsArabicPDF,
  exportAsHDImage,
  openSmsShare,
  openWhatsAppShare,
  printRoyalDocument,
  type ExportShareResult,
  type PrintableDocumentPayload,
} from '../lib/exportUtils';
import { ContactPickerButton } from './ContactPickerButton';
import { ExportPreviewModal } from './ExportPreviewModal';
import {
  formatCount,
  formatDateTimeAr,
  formatYER,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type AppRoute,
  type SaleDoc,
} from '../types/taibah';

interface SalesListScreenProps {
  hideNumbers: boolean;
  onNavigate: (route: AppRoute) => void;
}

type DateFilter = 'all' | 'today' | 'yesterday' | 'range';
type TypeFilter = 'all' | 'direct' | 'wholesale';

function buildSaleShareText(sale: SaleDoc): string {
  const typeLabel =
    sale.saleType === 'direct'
      ? 'فاتورة بيع مباشر'
      : sale.saleType === 'electronic_wholesale'
        ? 'فاتورة بيع جملة إلكترونية'
        : 'فاتورة كروت ورقية';
  const lines = [
    `📶 شبكة طيبة نت اللاسلكية (TAIBAH NET)`,
    `📄 ${typeLabel} — رقم: ${sale.invoiceNumber || sale.id.slice(-6)}`,
    `👤 المستلم: ${sale.buyerName}${sale.buyerPhone ? ` (${sale.buyerPhone})` : ''}`,
    `🗓 التاريخ: ${formatDateTimeAr(sale.createdAt)}`,
    `────────────────────`,
  ];
  if (sale.items && sale.items.length > 0) {
    for (const item of sale.items) {
      lines.push(
        `• ${item.packageLabel}: العدد ${item.quantity} | المُسلّم ${item.delivered} | السعر ${item.unitPrice} ر.ي`
      );
      if (item.cardNumbers && item.cardNumbers.length > 0) {
        lines.push(`  الأرقام: ${item.cardNumbers.join(' ، ')}`);
      }
    }
  } else if (sale.cardNumbers && sale.cardNumbers.length > 0) {
    lines.push(`🔑 أرقام الكروت:\n${sale.cardNumbers.join('\n')}`);
  }
  lines.push(`────────────────────`);
  lines.push(`📦 إجمالي الكروت: ${sale.totalCards} | المُسلّم: ${sale.deliveredCards}`);
  lines.push(`💰 الإجمالي: ${sale.totalAmount} ر.ي`);
  lines.push(`✅ المدفوع: ${sale.paidAmount} ر.ي | ⏳ المتبقي: ${sale.remainingAmount} ر.ي`);
  lines.push(`📞 ${SUPER_ADMIN_CONFIG.developerCredit}`);
  return lines.join('\n');
}

function buildSalePrintablePayload(sale: SaleDoc): PrintableDocumentPayload {
  const typeLabel =
    sale.saleType === 'direct'
      ? 'فاتورة بيع مباشر'
      : sale.saleType === 'electronic_wholesale'
        ? 'فاتورة بيع جملة (إلكترونية)'
        : 'فاتورة كروت ورقية';

  const rows =
    sale.items && sale.items.length > 0
      ? sale.items.map((item) => [
          item.packageLabel,
          String(item.quantity),
          String(item.delivered),
          String(item.returned || 0),
          `${item.unitPrice} ر.ي`,
          `${item.unitPrice * item.quantity} ر.ي`,
        ])
      : [
          [
            typeLabel,
            String(sale.totalCards),
            String(sale.deliveredCards),
            String(sale.returnedCards || 0),
            '-',
            `${sale.totalAmount} ر.ي`,
          ],
        ];

  return {
    title: typeLabel,
    subtitle: `رقم الفاتورة: ${sale.invoiceNumber || sale.id.slice(-6)}`,
    metaRows: [
      { label: 'اسم المستلم / العميل', value: sale.buyerName },
      { label: 'رقم الهاتف', value: sale.buyerPhone || 'غير مسجل' },
      { label: 'التاريخ والوقت', value: formatDateTimeAr(sale.createdAt) },
      {
        label: 'طريقة الدفع',
        value:
          sale.paymentMethod === 'cash'
            ? 'نقداً (مدفوع بالكامل)'
            : sale.paymentMethod === 'credit'
              ? 'آجل (على الحساب)'
              : 'دفع جزئي',
      },
    ],
    tableHeaders: ['الباقة', 'العدد', 'المُسلّم', 'المرتجع', 'سعر الكرت', 'الإجمالي'],
    tableRows: rows,
    summaryRows: [
      { label: 'إجمالي الكروت', value: `${sale.totalCards} كرت` },
      { label: 'الكروت المُسلّمة', value: `${sale.deliveredCards} كرت` },
      { label: 'المبلغ المدفوع', value: `${sale.paidAmount} ر.ي` },
      { label: 'المبلغ المتبقي', value: `${sale.remainingAmount} ر.ي` },
      { label: 'الإجمالي النهائي', value: `${sale.totalAmount} ر.ي`, highlight: true },
    ],
    extraSectionTitle: 'أرقام الكروت الإلكترونية المسحوبة',
    extraLines: sale.cardNumbers || [],
    fileName: `فاتورة_${sale.invoiceNumber || sale.id.slice(-6)}`,
    sharePhone: sale.buyerPhone,
    shareText: buildSaleShareText(sale),
  };
}

export const SalesListScreen: React.FC<SalesListScreenProps> = ({ hideNumbers, onNavigate }) => {
  const {
    sales,
    hasMoreSales,
    loadMoreSales,
    updateSaleRecord,
    deleteSaleRecord,
    deliverPartialCards,
    processSaleReturn,
  } = useFirebase();
  const { notifySuccess, notifyError } = useFeedback();

  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Modals
  const [selectedSale, setSelectedSale] = useState<SaleDoc | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportShareResult | null>(null);
  const [editingSale, setEditingSale] = useState<SaleDoc | null>(null);
  const [editBuyerName, setEditBuyerName] = useState('');
  const [editBuyerPhone, setEditBuyerPhone] = useState('');
  const [editPaidAmount, setEditPaidAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SaleDoc | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const filteredSales = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

    return sales.filter((s) => {
      if (typeFilter === 'direct' && s.saleType !== 'direct') return false;
      if (typeFilter === 'wholesale' && s.saleType === 'direct') return false;

      const ts = s.createdAt?.toMillis?.() ?? Date.now();
      if (dateFilter === 'today' && ts < startOfToday) return false;
      if (dateFilter === 'yesterday' && (ts < startOfYesterday || ts >= startOfToday)) return false;
      if (dateFilter === 'range') {
        if (fromDate) {
          const fromMs = new Date(`${fromDate}T00:00:00`).getTime();
          if (ts < fromMs) return false;
        }
        if (toDate) {
          const toMs = new Date(`${toDate}T23:59:59.999`).getTime();
          if (ts > toMs) return false;
        }
      }

      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const match =
          s.buyerName.toLowerCase().includes(q) ||
          (s.buyerPhone || '').includes(q) ||
          (s.invoiceNumber || '').toLowerCase().includes(q) ||
          (s.notes || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [sales, typeFilter, dateFilter, fromDate, toDate, searchTerm]);

  const totalSoldCards = useMemo(
    () => filteredSales.reduce((acc, s) => acc + (Number(s.totalCards) || 0), 0),
    [filteredSales]
  );
  const totalRevenue = useMemo(
    () => filteredSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0),
    [filteredSales]
  );

  const openEditModal = (sale: SaleDoc) => {
    setEditingSale(sale);
    setEditBuyerName(sale.buyerName);
    setEditBuyerPhone(sale.buyerPhone || '');
    setEditPaidAmount(String(sale.paidAmount));
    setEditNotes(sale.notes || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSale) return;
    setBusyAction(true);
    try {
      const paid = Math.max(0, Math.min(editingSale.totalAmount, Number(editPaidAmount) || 0));
      const remaining = Math.max(0, editingSale.totalAmount - paid);
      const expectedProfit = Number(editingSale.expectedProfit) || 0;
      const realizedProfit =
        editingSale.totalAmount > 0
          ? Math.round((expectedProfit * paid) / editingSale.totalAmount)
          : 0;
      await updateSaleRecord(editingSale.id, {
        buyerName: editBuyerName.trim() || editingSale.buyerName,
        buyerPhone: editBuyerPhone.trim(),
        paidAmount: paid,
        remainingAmount: remaining,
        realizedProfit,
        paymentMethod: remaining === 0 ? 'cash' : paid === 0 ? 'credit' : 'partial',
        status: remaining === 0 && editingSale.deliveredCards >= editingSale.totalCards ? 'completed' : 'partial',
        notes: editNotes.trim(),
      });
      setEditingSale(null);
    } finally {
      setBusyAction(false);
    }
  };

  const getTopStripeColor = (sale: SaleDoc) => {
    if (sale.saleType === 'direct') return 'bg-gradient-to-l from-emerald-500 to-green-600';
    if (sale.saleType === 'electronic_wholesale') return 'bg-gradient-to-l from-orange-500 to-amber-500';
    return 'bg-gradient-to-l from-blue-600 to-[#1A365D]';
  };

  const getTypeBadge = (sale: SaleDoc) => {
    if (sale.saleType === 'direct') {
      return { label: 'بيع مباشر', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' };
    }
    if (sale.saleType === 'electronic_wholesale') {
      return { label: 'جملة إلكترونية', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300' };
    }
    return { label: 'فاتورة ورقية', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' };
  };

  return (
    <div className="space-y-3.5">
      {/* UPDATE 3: Royal Hero Card (Cart right, Title + Total Cards center, Official Logo left) */}
      <div className="royal-header-3d rounded-3xl border-2 border-[#D4AF37] p-4 shadow-xl flex items-center justify-between gap-3">
        <div className="w-12 h-12 rounded-2xl bg-white/15 border border-[#D4AF37] flex items-center justify-center text-[#FDE68A] shrink-0 shadow">
          <ShoppingCart className="w-6 h-6" />
        </div>

        <div className="flex-1 min-w-0 text-center">
          <h2 className="text-base sm:text-lg font-extrabold text-white truncate">
            المبيعات والتقارير المالية
          </h2>
          <div className="mt-1 flex items-center justify-center gap-3 text-xs font-extrabold text-[#FDE68A] tabular-nums">
            <span>إجمالي الكروت: {formatCount(totalSoldCards, hideNumbers)}</span>
            <span>•</span>
            <span>الإجمالي: {formatYER(totalRevenue, hideNumbers)}</span>
          </div>
        </div>

        <div className="w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shrink-0 shadow-lg">
          <img
            src={TAIBAH_ASSETS.logo}
            alt="شعار شبكة طيبة نت"
            className="w-full h-full rounded-full object-cover"
          />
        </div>
      </div>

      {/* Wide Orange Wholesale Button with Partial Delivery Support */}
      <button
        type="button"
        onClick={() => onNavigate('electronic_cards')}
        className="w-full min-h-[48px] rounded-2xl bg-gradient-to-b from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 border-2 border-[#D4AF37] text-white font-extrabold text-sm shadow-lg active:scale-[0.99] transition-all flex items-center justify-center gap-2 px-4"
      >
        <Plus className="w-5 h-5" />
        <span>+ بيع الجملة (مع دعم التسليم على دفعات)</span>
      </button>

      {/* Date Filter Bar */}
      <div className="grid grid-cols-4 gap-1.5 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-[#D4AF37]/60 shadow-sm">
        {(
          [
            { id: 'all', label: 'كل المبيعات' },
            { id: 'today', label: 'اليوم' },
            { id: 'yesterday', label: 'أمس' },
            { id: 'range', label: 'فترة / بحث' },
          ] as Array<{ id: DateFilter; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setDateFilter(tab.id)}
            className={`min-h-[38px] rounded-xl text-xs font-extrabold transition-all ${
              dateFilter === tab.id
                ? 'bg-[#1A365D] text-[#FDE68A] shadow'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Type Filter Bar */}
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            { id: 'all', label: 'الكل' },
            { id: 'direct', label: 'البيع المباشر' },
            { id: 'wholesale', label: 'بيع الجملة' },
          ] as Array<{ id: TypeFilter; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTypeFilter(t.id)}
            className={`min-h-[38px] rounded-xl border text-xs font-extrabold transition-all ${
              typeFilter === t.id
                ? 'bg-gradient-to-b from-[#F59E0B] to-[#D4AF37] text-[#0F172A] border-[#B4860B] shadow'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search & Custom Date Range (visible when range selected or always searchable) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث باسم العميل، رقم الهاتف، أو رقم الفاتورة..."
            className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
          />
        </div>
        {dateFilter === 'range' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> من تاريخ
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full min-h-[38px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> إلى تاريخ
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full min-h-[38px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-bold"
              />
            </div>
          </div>
        )}
      </div>

      {/* Multi-Colored Top-Striped White Sale Cards */}
      {filteredSales.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/60 p-8 text-center shadow-sm">
          <ShoppingCart className="w-10 h-10 mx-auto text-[#D4AF37] mb-2" />
          <h3 className="text-sm font-extrabold">لا توجد عمليات بيع مسجلة حالياً (0)</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            ابدأ من شاشة البيع المباشر أو بيع الجملة لتظهر العمليات هنا لحظياً من السحابة.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSales.map((sale) => {
            const badge = getTypeBadge(sale);
            return (
              <div
                key={sale.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/60 shadow-md overflow-hidden"
              >
                {/* Colored top stripe */}
                <div className={`h-2 w-full ${getTopStripeColor(sale)}`} />

                <div className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                          {sale.buyerName}
                        </span>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                        {sale.invoiceNumber || sale.id.slice(-6)} · {sale.buyerPhone || 'بدون هاتف'} ·{' '}
                        {formatDateTimeAr(sale.createdAt)}
                      </div>
                    </div>

                    <div className="text-left shrink-0">
                      <div className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                        {formatYER(sale.totalAmount, hideNumbers)}
                      </div>
                      <div className="text-[10px] font-bold text-slate-500 tabular-nums">
                        {formatCount(sale.totalCards, hideNumbers)} كرت (مُسلّم {formatCount(sale.deliveredCards, hideNumbers)})
                      </div>
                    </div>
                  </div>

                  {/* Financial mini-bar */}
                  <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 p-2 text-center text-[11px] font-extrabold tabular-nums">
                    <div className="text-emerald-700 dark:text-emerald-400">
                      المدفوع: {formatYER(sale.paidAmount, hideNumbers)}
                    </div>
                    <div className={sale.remainingAmount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}>
                      المتبقي: {formatYER(sale.remainingAmount, hideNumbers)}
                    </div>
                    <div className="text-[#1A365D] dark:text-[#FDE68A]">
                      {sale.deliveredCards < sale.totalCards ? 'تسليم جزئي' : 'مكتملة ✅'}
                    </div>
                  </div>

                  {/* Action Buttons: Details & Share / Edit / Delete */}
                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setSelectedSale(sale)}
                      className="min-h-[38px] rounded-xl bg-[#1A365D] hover:bg-[#142a4a] text-white text-xs font-extrabold flex items-center justify-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#FDE68A]" />
                      <span>التفاصيل والمشاركة</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(sale)}
                      className="min-h-[38px] rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(sale)}
                      className="min-h-[38px] rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 text-xs font-extrabold flex items-center justify-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {hasMoreSales && (
            <button
              type="button"
              onClick={loadMoreSales}
              className="w-full min-h-[44px] rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold shadow-sm hover:bg-amber-50 dark:hover:bg-slate-800 transition-colors"
            >
              تحميل المزيد من المبيعات...
            </button>
          )}
        </div>
      )}

      {/* DETAILS, PARTIAL DELIVERY, RETURNS & FULL SHARE/EXPORT MODAL */}
      {selectedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[92dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img
                  src={TAIBAH_ASSETS.logo}
                  alt="شعار طيبة نت"
                  className="w-9 h-9 rounded-full object-cover border border-[#D4AF37]"
                />
                <div>
                  <h3 className="text-sm font-extrabold text-white">
                    تفاصيل الفاتورة {selectedSale.invoiceNumber || selectedSale.id.slice(-6)}
                  </h3>
                  <p className="text-[11px] font-bold text-[#FDE68A]">{selectedSale.buyerName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSale(null)}
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Items & Partial Delivery / Return controls */}
              {selectedSale.items && selectedSale.items.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                    تفاصيل الباقات والتسليم على دفعات
                  </h4>
                  {selectedSale.items.map((item) => {
                    const remainingToDeliver = Math.max(0, item.quantity - item.delivered - (item.returned || 0));
                    return (
                      <div
                        key={item.packageId}
                        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between text-xs font-extrabold">
                          <span>{item.packageLabel}</span>
                          <span className="tabular-nums text-[#1A365D] dark:text-[#FDE68A]">
                            العدد: {item.quantity} | مُسلّم: {item.delivered} | مرتجع: {item.returned || 0}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedSale.saleType !== 'paper_invoice' && remainingToDeliver > 0 && (
                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={async () => {
                                setBusyAction(true);
                                try {
                                  const deliveredNums = await deliverPartialCards(
                                    selectedSale,
                                    item.packageId,
                                    remainingToDeliver
                                  );
                                  if (deliveredNums.length > 0) {
                                    setSelectedSale(null);
                                  }
                                } finally {
                                  setBusyAction(false);
                                }
                              }}
                              className="min-h-[34px] px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold flex items-center gap-1"
                            >
                              <Truck className="w-3.5 h-3.5" />
                              تسليم الدفعة المتبقية ({remainingToDeliver})
                            </button>
                          )}
                          {item.quantity - (item.returned || 0) > 0 && (
                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={async () => {
                                setBusyAction(true);
                                try {
                                  const ok = await processSaleReturn(selectedSale, item.packageId, 1);
                                  if (ok) setSelectedSale(null);
                                } finally {
                                  setBusyAction(false);
                                }
                              }}
                              className="min-h-[34px] px-3 rounded-lg bg-amber-600 text-white text-[11px] font-extrabold flex items-center gap-1"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              إرجاع 1 كرت للمخزون
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pulled Card Numbers */}
              {selectedSale.cardNumbers && selectedSale.cardNumbers.length > 0 && (
                <div className="rounded-xl border border-dashed border-[#D4AF37] bg-amber-50/50 dark:bg-amber-950/20 p-3">
                  <div className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A] mb-2">
                    أرقام الكروت ({selectedSale.cardNumbers.length})
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
                    {selectedSale.cardNumbers.map((num, i) => (
                      <div
                        key={`${num}_${i}`}
                        dir="ltr"
                        className="rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 text-center font-mono text-xs font-extrabold"
                      >
                        {num}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Share & Export Suite: WhatsApp, SMS, PDF, HD Image, Print */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    openWhatsAppShare(selectedSale.buyerPhone, buildSaleShareText(selectedSale));
                    notifySuccess('تم فتح واتساب لإرسال الفاتورة');
                  }}
                  className="min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  واتساب
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openSmsShare(selectedSale.buyerPhone, buildSaleShareText(selectedSale));
                    notifySuccess('تم فتح الرسائل النصية SMS');
                  }}
                  className="min-h-[42px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <MessageSquare className="w-4 h-4" />
                  رسالة SMS
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await exportAsArabicPDF(buildSalePrintablePayload(selectedSale));
                      notifySuccess('تم تجهيز الملف بنجاح ✅');
                      if (!res.sharedNatively) setExportPreview(res);
                    } catch {
                      notifyError('تعذر إنشاء ملف PDF');
                    }
                  }}
                  className="min-h-[42px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <FileDown className="w-4 h-4" />
                  ملف PDF
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await exportAsHDImage(buildSalePrintablePayload(selectedSale));
                      notifySuccess('تم تجهيز الملف بنجاح ✅');
                      if (!res.sharedNatively) setExportPreview(res);
                    } catch {
                      notifyError('تعذر إنشاء الصورة');
                    }
                  }}
                  className="min-h-[42px] rounded-xl gold-btn-3d text-[#0F172A] text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <ImageDown className="w-4 h-4" />
                  صورة HD
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void printRoyalDocument(buildSalePrintablePayload(selectedSale));
                    notifySuccess('تم تجهيز المستند للطباعة');
                  }}
                  className="col-span-2 sm:col-span-2 min-h-[42px] rounded-xl bg-[#1A365D] text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <Printer className="w-4 h-4 text-[#FDE68A]" />
                  طباعة رسمية بالشعار
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT SALE MODAL */}
      {editingSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                تعديل الفاتورة {editingSale.invoiceNumber}
              </h3>
              <button
                type="button"
                onClick={() => setEditingSale(null)}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-extrabold mb-1">اسم المشتري / المستلم</label>
              <input
                type="text"
                required
                value={editBuyerName}
                onChange={(e) => setEditBuyerName(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold mb-1">رقم الهاتف</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="tel"
                  value={editBuyerPhone}
                  onChange={(e) => setEditBuyerPhone(e.target.value)}
                  className="flex-1 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold tabular-nums"
                />
                <ContactPickerButton
                  onSelect={(c) => {
                    if (c.name) setEditBuyerName(c.name);
                    if (c.phone) setEditBuyerPhone(c.phone);
                  }}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-extrabold mb-1">
                المبلغ المدفوع (من أصل {editingSale.totalAmount} ر.ي)
              </label>
              <input
                type="number"
                min={0}
                max={editingSale.totalAmount}
                value={editPaidAmount}
                onChange={(e) => setEditPaidAmount(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold mb-1">ملاحظات</label>
              <textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs font-bold"
              />
            </div>
            <button
              type="submit"
              disabled={busyAction}
              className="w-full min-h-[44px] royal-btn-3d text-white text-sm font-extrabold rounded-xl"
            >
              {busyAction ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </button>
          </form>
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-red-500 p-5 shadow-2xl text-center space-y-3">
            <h3 className="text-base font-extrabold text-red-600">تأكيد حذف عملية البيع</h3>
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
              هل أنت متأكد من حذف فاتورة <strong>{deleteTarget.buyerName}</strong> بقيمة{' '}
              <strong>{formatYER(deleteTarget.totalAmount)}</strong>؟
            </p>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-h-[42px] rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-extrabold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={async () => {
                  await deleteSaleRecord(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="min-h-[42px] rounded-xl bg-red-600 text-white text-xs font-extrabold"
              >
                نعم، حذف نهائي
              </button>
            </div>
          </div>
        </div>
      )}

      <ExportPreviewModal result={exportPreview} onClose={() => setExportPreview(null)} />
    </div>
  );
};
