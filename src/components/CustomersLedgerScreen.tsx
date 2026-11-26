import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Copy,
  Edit3,
  FileDown,
  ImageDown,
  MessageSquare,
  Plus,
  Printer,
  Search,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useDebounce } from '../hooks/useDebounce';
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
  TAIBAH_ASSETS,
  type CustomerAccount,
  type LedgerEntry,
} from '../types/taibah';
import { formatNumEn } from '../utils/salesBreakdown';

interface CustomersLedgerScreenProps {
  hideNumbers: boolean;
}

const ACCOUNT_CATEGORIES = ['الكل', 'عميل شبكة', 'تاجر / محل', 'حساب شخصي', 'مورد / أخرى'];

export const CustomersLedgerScreen: React.FC<CustomersLedgerScreenProps> = ({ hideNumbers }) => {
  const {
    customers,
    hasMoreCustomers,
    loadMoreCustomers,
    ledgerEntries,
    sales,
    createCustomerAccount,
    updateCustomerAccount,
    deleteCustomerAccount,
    addLedgerEntry,
    deleteLedgerEntry,
  } = useFirebase();
  const { notifySuccess, notifyError } = useFeedback();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 180);
  const [categoryFilter, setCategoryFilter] = useState('الكل');

  // Create / Edit Customer Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerAccount | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formCategory, setFormCategory] = useState('عميل شبكة');
  const [formNotes, setFormNotes] = useState('');
  const [formInitialDebit, setFormInitialDebit] = useState('');
  const [formInitialCredit, setFormInitialCredit] = useState('');
  const [busy, setBusy] = useState(false);

  // Selected customer detailed statement view
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportShareResult | null>(null);
  const [entryType, setEntryType] = useState<'debit' | 'credit' | 'adjustment'>('debit');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDesc, setEntryDesc] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CustomerAccount | null>(null);
  const [recentNotification, setRecentNotification] = useState<{
    customerName: string;
    phone?: string;
    message: string;
  } | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      if (categoryFilter !== 'الكل' && (c.category || 'عميل شبكة') !== categoryFilter) {
        return false;
      }
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.trim().toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          (c.phone || '').includes(q) ||
          (c.notes || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [customers, categoryFilter, debouncedSearch]);

  // 4 Live Summary Cards
  const summary = useMemo(() => {
    let totalOwedByCustomers = 0; // عليهم (موجب)
    let totalCreditToCustomers = 0; // لهم (سالب)
    for (const c of customers) {
      const bal = Number(c.balance) || 0;
      if (bal > 0) totalOwedByCustomers += bal;
      else if (bal < 0) totalCreditToCustomers += Math.abs(bal);
    }
    return {
      count: customers.length,
      owedBy: totalOwedByCustomers,
      creditTo: totalCreditToCustomers,
      net: totalOwedByCustomers - totalCreditToCustomers,
    };
  }, [customers]);

  const customerEntries = useMemo(
    () =>
      selectedCustomer
        ? ledgerEntries.filter((e) => e.customerId === selectedCustomer.id)
        : [],
    [ledgerEntries, selectedCustomer]
  );

  const customerSalesStats = useMemo(() => {
    if (!selectedCustomer) return { totalCards: 0, deliveredCards: 0, remainingCards: 0 };
    const matched = sales.filter(
      (s) =>
        s.buyerName.trim() === selectedCustomer.name.trim() ||
        (selectedCustomer.phone && s.buyerPhone === selectedCustomer.phone)
    );
    const totalCards = matched.reduce((acc, s) => acc + (s.totalCards || 0), 0);
    const deliveredCards = matched.reduce((acc, s) => acc + (s.deliveredCards || 0), 0);
    return { totalCards, deliveredCards, remainingCards: Math.max(0, totalCards - deliveredCards) };
  }, [sales, selectedCustomer]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    setFormName('');
    setFormPhone('');
    setFormCategory('عميل شبكة');
    setFormNotes('');
    setFormInitialDebit('');
    setFormInitialCredit('');
    setShowAddModal(true);
  };

  const openEditModal = (c: CustomerAccount) => {
    setEditingCustomer(c);
    setFormName(c.name);
    setFormPhone(c.phone || '');
    setFormCategory(c.category || 'عميل شبكة');
    setFormNotes(c.notes || '');
    setShowAddModal(true);
  };

  const buildCustomerNotificationMessage = (params: {
    customerName: string;
    direction: 'debit' | 'credit';
    amount: number;
    description: string;
    currentBalance: number;
  }): string => {
    const dirWord = params.direction === 'debit' ? 'عليك' : 'لك';
    const amtText = formatNumEn(Math.abs(Math.round(params.amount)));
    const roundedBal = Math.round(params.currentBalance);
    const balanceText = `${formatNumEn(Math.abs(roundedBal))} ر.ي`;
    return [
      `الأخ / ${params.customerName}`,
      `تم إضافة ${amtText} ر.ي ${dirWord}`,
      `البيان: ${params.description}`,
      `الرصيد الحالي: ${balanceText}`,
    ].join('\n');
  };

  const buildEntryNotificationMessage = (c: CustomerAccount, entry: LedgerEntry): string => {
    const direction: 'debit' | 'credit' = entry.entryType === 'debit' ? 'debit' : 'credit';
    return buildCustomerNotificationMessage({
      customerName: c.name,
      direction,
      amount: entry.amount,
      description:
        entry.description ||
        (entry.entryType === 'debit'
          ? 'رصيد'
          : entry.entryType === 'credit'
            ? 'تسليم نقدي'
            : 'خصم'),
      currentBalance: c.balance,
    });
  };

  const copyNotificationText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess('تم نسخ رسالة الإشعار بنجاح ✅');
    } catch {
      notifyError('تعذر نسخ الرسالة');
    }
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setBusy(true);
    try {
      const cleanName = formName.trim();
      const cleanPhone = formPhone.trim();
      const initDebit = Number(formInitialDebit) || 0;
      const initCredit = Number(formInitialCredit) || 0;
      if (editingCustomer) {
        await updateCustomerAccount(editingCustomer.id, {
          name: cleanName,
          phone: cleanPhone,
          category: formCategory,
          notes: formNotes.trim(),
        });
      } else {
        const created = await createCustomerAccount({
          name: cleanName,
          phone: cleanPhone,
          category: formCategory,
          notes: formNotes.trim(),
          initialDebit: initDebit,
          initialCredit: initCredit,
        });
        if (created && (initDebit > 0 || initCredit > 0)) {
          const isDebit = initDebit >= initCredit;
          const opAmount = isDebit ? initDebit : initCredit;
          const balance = initDebit - initCredit;
          setRecentNotification({
            customerName: cleanName,
            phone: cleanPhone,
            message: buildCustomerNotificationMessage({
              customerName: cleanName,
              direction: isDebit ? 'debit' : 'credit',
              amount: opAmount,
              description: formNotes.trim() || (isDebit ? 'رصيد' : 'تسليم نقدي'),
              currentBalance: balance,
            }),
          });
        }
      }
      setShowAddModal(false);
    } finally {
      setBusy(false);
    }
  };

  const handleAddLedgerEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const amt = Number(entryAmount);
    if (!amt || amt <= 0) return;
    setBusy(true);
    try {
      const resolvedDesc =
        entryDesc.trim() ||
        (entryType === 'debit' ? 'رصيد' : entryType === 'credit' ? 'تسليم نقدي' : 'خصم');
      const ok = await addLedgerEntry({
        customerId: selectedCustomer.id,
        entryType,
        amount: amt,
        description: resolvedDesc,
      });
      if (ok) {
        const nextBalance =
          entryType === 'debit'
            ? (Number(selectedCustomer.balance) || 0) + amt
            : (Number(selectedCustomer.balance) || 0) - amt;
        setRecentNotification({
          customerName: selectedCustomer.name,
          phone: selectedCustomer.phone,
          message: buildCustomerNotificationMessage({
            customerName: selectedCustomer.name,
            direction: entryType === 'debit' ? 'debit' : 'credit',
            amount: amt,
            description: resolvedDesc,
            currentBalance: nextBalance,
          }),
        });
        setEntryAmount('');
        setEntryDesc('');
      }
    } finally {
      setBusy(false);
    }
  };

  const buildStatementShareText = (c: CustomerAccount): string => {
    const latestEntry = customerEntries[0];
    if (latestEntry) {
      return buildEntryNotificationMessage(c, latestEntry);
    }
    const isDebit = c.balance >= 0;
    return buildCustomerNotificationMessage({
      customerName: c.name,
      direction: isDebit ? 'debit' : 'credit',
      amount: Math.abs(c.balance),
      description: c.notes?.trim() || (isDebit ? 'رصيد' : 'تسليم نقدي'),
      currentBalance: c.balance,
    });
  };

  const buildStatementPrintable = (c: CustomerAccount): PrintableDocumentPayload => {
    const statusText =
      c.balance > 0
        ? `عليه ${c.balance} ر.ي`
        : c.balance < 0
          ? `له ${Math.abs(c.balance)} ر.ي`
          : 'متوازن (0 ر.ي)';

    return {
      title: 'كشف حساب محاسبي تفصيلي',
      subtitle: `الحساب: ${c.name} (${c.category || 'عميل شبكة'})`,
      metaRows: [
        { label: 'اسم الحساب', value: c.name },
        { label: 'رقم الهاتف', value: c.phone || 'غير مسجل' },
        { label: 'الكروت المُسلّمة / المتبقية', value: `${customerSalesStats.deliveredCards} / ${customerSalesStats.remainingCards}` },
        { label: 'حالة الرصيد', value: statusText },
      ],
      tableHeaders: ['التاريخ', 'نوع القيد', 'المبلغ', 'البيان / التفاصيل'],
      tableRows: customerEntries.map((e) => [
        formatDateTimeAr(e.createdAt),
        e.entryType === 'debit' ? 'مدين (عليه)' : e.entryType === 'credit' ? 'دائن / قبض (له)' : 'تسوية / تصحيح',
        `${e.amount} ر.ي`,
        e.description,
      ]),
      summaryRows: [
        { label: 'إجمالي المدين (عليه)', value: `${c.totalDebit} ر.ي` },
        { label: 'إجمالي الدائن (له)', value: `${c.totalCredit} ر.ي` },
        { label: 'الصافي النهائي', value: statusText, highlight: true },
      ],
      fileName: `كشف_حساب_${c.name}`,
      sharePhone: c.phone,
      shareText: buildStatementShareText(c),
    };
  };

  return (
    <div className="space-y-3 safe-bottom-clear">
      {/* Header Banner */}
      <div className="royal-header-3d rounded-3xl border-2 border-[#D4AF37] p-4 shadow-xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-white/15 border border-[#D4AF37] flex items-center justify-center text-[#FDE68A] shrink-0">
            <BookOpen className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-white truncate">العملاء والدفتر المحاسبي العام</h2>
            <p className="text-[11px] font-bold text-[#FDE68A] truncate">
              حسابات الشبكة والحسابات التجارية والشخصية وكشوف الحساب HD
            </p>
          </div>
        </div>
        <div className="w-11 h-11 rounded-full bg-[#061124] p-0.5 border-2 border-[#D4AF37] shrink-0 overflow-hidden shadow">
          <img
            src={TAIBAH_ASSETS.logo}
            alt="شعار طيبة نت"
            className="w-full h-full rounded-full object-contain"
          />
        </div>
      </div>

      {/* Add New Account CTA */}
      <button
        type="button"
        onClick={openCreateModal}
        className="w-full min-h-[48px] gold-btn-3d text-[#0F172A] font-extrabold text-sm rounded-2xl flex items-center justify-center gap-2 shadow-lg"
      >
        <UserPlus className="w-5 h-5" />
        <span>+ إضافة حساب عميل جديد</span>
      </button>

      {/* 4 Live Financial Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/60 p-3 text-center shadow-sm">
          <div className="text-[11px] font-bold text-slate-500">عدد الحسابات</div>
          <div className="text-base font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums mt-0.5">
            {formatCount(summary.count, hideNumbers)}
          </div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-red-400/70 p-3 text-center shadow-sm">
          <div className="text-[11px] font-bold text-slate-500">إجمالي عليهم (مدين)</div>
          <div className="text-base font-extrabold text-red-600 dark:text-red-400 tabular-nums mt-0.5">
            {formatYER(summary.owedBy, hideNumbers)}
          </div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-500/70 p-3 text-center shadow-sm">
          <div className="text-[11px] font-bold text-slate-500">إجمالي لهم (دائن)</div>
          <div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
            {formatYER(summary.creditTo, hideNumbers)}
          </div>
        </div>
        <div className="rounded-2xl bg-[#1A365D] border-2 border-[#D4AF37] p-3 text-center shadow-sm">
          <div className="text-[11px] font-bold text-slate-200">صافي الرصيد العام</div>
          <div className="text-base font-extrabold text-[#FDE68A] tabular-nums mt-0.5">
            {formatYER(summary.net, hideNumbers)}
          </div>
        </div>
      </div>

      {/* Search & Category Filter */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/80 p-3 space-y-2.5 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-[#1A365D] dark:text-[#FDE68A] absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            dir="auto"
            enterKeyHint="search"
            data-lpignore="true"
            data-form-type="other"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم العميل أو رقم الهاتف..."
            className="w-full min-h-[42px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-base sm:text-sm font-extrabold shadow-xs focus:border-[#D4AF37] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {ACCOUNT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`min-h-[34px] px-3 rounded-xl text-xs font-extrabold whitespace-nowrap transition-all ${
                categoryFilter === cat
                  ? 'bg-[#1A365D] text-[#FDE68A] border border-[#D4AF37]'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Numbered 3D Customer Cards */}
      {filteredCustomers.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/60 p-8 text-center">
          <Users className="w-10 h-10 mx-auto text-[#D4AF37] mb-2" />
          <h3 className="text-sm font-extrabold">لا توجد حسابات عملاء مسجلة حالياً (0)</h3>
          <p className="text-xs text-slate-500 mt-1">
            اضغط «+ إضافة حساب عميل جديد» لبدء الدفتر المحاسبي العام المرتبط بالسحابة.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredCustomers.map((c, idx) => {
            const isOwed = c.balance > 0;
            const isCredit = c.balance < 0;
            return (
              <div
                key={c.id}
                className="royal-tile-3d rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/75 p-3.5 shadow-md"
              >
                <div className="flex items-center justify-between gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedCustomerId(c.id)}
                    className="flex-1 min-w-0 flex items-center gap-2.5 text-right"
                  >
                    <span className="w-8 h-8 rounded-full bg-slate-950 border-2 border-[#D4AF37] text-[#FDE68A] text-xs font-extrabold flex items-center justify-center shrink-0 tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                          {c.name}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {c.category || 'عميل شبكة'}
                        </span>
                      </div>
                      <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                        {c.phone || 'بدون رقم هاتف'}
                      </div>
                    </div>
                  </button>

                  {/* عليه / له Badge */}
                  <div className="text-left shrink-0">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-xl text-xs font-extrabold tabular-nums ${
                        isOwed
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                          : isCredit
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {isOwed
                        ? `عليه ${formatYER(c.balance, hideNumbers)}`
                        : isCredit
                          ? `له ${formatYER(Math.abs(c.balance), hideNumbers)}`
                          : 'متوازن (0)'}
                    </span>
                  </div>
                </div>

                {/* Card Quick Actions */}
                <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedCustomerId(c.id)}
                    className="min-h-[36px] rounded-xl bg-[#1A365D] text-white text-xs font-extrabold"
                  >
                    كشف الحساب والقيود
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(c)}
                    className="min-h-[36px] rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    تعديل
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(c)}
                    className="min-h-[36px] rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-extrabold flex items-center justify-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    حذف
                  </button>
                </div>
              </div>
            );
          })}

          {hasMoreCustomers && (
            <button
              type="button"
              onClick={loadMoreCustomers}
              className="w-full min-h-[44px] rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold shadow-sm hover:bg-amber-50 dark:hover:bg-slate-800 transition-colors"
            >
              تحميل المزيد من الحسابات...
            </button>
          )}
        </div>
      )}

      {/* DETAILED CUSTOMER STATEMENT MODAL */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 overflow-y-auto">
          <div className="w-full max-w-xl rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[93dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#061124] p-0.5 border-2 border-[#D4AF37] shrink-0 overflow-hidden">
                  <img
                    src={TAIBAH_ASSETS.logo}
                    alt="طيبة نت"
                    className="w-full h-full rounded-full object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold text-white truncate">{selectedCustomer.name}</h3>
                  <p className="text-[11px] font-bold text-[#FDE68A] tabular-nums">
                    {selectedCustomer.phone || 'بدون هاتف'} · {selectedCustomer.category || 'عميل شبكة'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomerId(null)}
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {/* Statement Totals */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-2.5">
                  <div className="text-[10px] font-bold text-red-700 dark:text-red-300">إجمالي عليه</div>
                  <div className="text-sm font-extrabold text-red-700 dark:text-red-300 tabular-nums">
                    {formatYER(selectedCustomer.totalDebit, hideNumbers)}
                  </div>
                </div>
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-2.5">
                  <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">إجمالي له</div>
                  <div className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                    {formatYER(selectedCustomer.totalCredit, hideNumbers)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#1A365D] border border-[#D4AF37] p-2.5">
                  <div className="text-[10px] font-bold text-slate-200">الصافي</div>
                  <div className="text-sm font-extrabold text-[#FDE68A] tabular-nums">
                    {selectedCustomer.balance > 0
                      ? `عليه ${formatYER(selectedCustomer.balance, hideNumbers)}`
                      : selectedCustomer.balance < 0
                        ? `له ${formatYER(Math.abs(selectedCustomer.balance), hideNumbers)}`
                        : '0 ر.ي'}
                  </div>
                </div>
              </div>

              {/* Add New Ledger Entry / Payment Form */}
              <form
                onSubmit={handleAddLedgerEntry}
                className="rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-[#D4AF37]/60 p-3 space-y-2.5"
              >
                <div className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                  إضافة قيد جديد / سند قبض / تصحيح
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEntryType('debit')}
                    className={`min-h-[36px] rounded-xl border-2 text-[11px] font-extrabold flex items-center justify-center gap-1 shadow-xs ${
                      entryType === 'debit'
                        ? 'bg-red-600 text-white border-red-800'
                        : 'bg-red-50/70 dark:bg-slate-900 border-red-500/75 text-red-700 dark:text-red-300'
                    }`}
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    عليه (مدين)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryType('credit')}
                    className={`min-h-[36px] rounded-xl border-2 text-[11px] font-extrabold flex items-center justify-center gap-1 shadow-xs ${
                      entryType === 'credit'
                        ? 'bg-emerald-600 text-white border-emerald-800'
                        : 'bg-emerald-50/70 dark:bg-slate-900 border-emerald-600/75 text-emerald-800 dark:text-emerald-300'
                    }`}
                  >
                    <ArrowDownLeft className="w-3.5 h-3.5" />
                    له (سداد)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryType('adjustment')}
                    className={`min-h-[36px] rounded-xl border-2 text-[11px] font-extrabold shadow-xs ${
                      entryType === 'adjustment'
                        ? 'bg-amber-600 text-white border-amber-800'
                        : 'bg-amber-50/75 dark:bg-slate-900 border-amber-600/75 text-amber-900 dark:text-amber-300'
                    }`}
                  >
                    قيد تصحيح
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    required
                    min={1}
                    value={entryAmount === '0' ? '' : entryAmount}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setEntryAmount(e.target.value)}
                    placeholder="المبلغ بالريال اليمني"
                    className="min-h-[40px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 text-xs font-extrabold tabular-nums focus:border-[#D4AF37] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={entryDesc}
                    onChange={(e) => setEntryDesc(e.target.value)}
                    placeholder="البيان / سبب القيد (مثال: تسليم نقدي أو رصيد)"
                    className="min-h-[40px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full min-h-[40px] royal-btn-3d text-white text-xs font-extrabold rounded-xl flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4 text-[#FDE68A]" />
                  <span>{busy ? 'جاري التسجيل...' : 'ترحيل القيد وتحديث الرصيد فوراً'}</span>
                </button>
              </form>

              {/* Export & Share Statement Buttons */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                <button
                  type="button"
                  onClick={() => openWhatsAppShare(selectedCustomer.phone, buildStatementShareText(selectedCustomer))}
                  className="min-h-[38px] rounded-xl bg-emerald-600 text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
                >
                  <Send className="w-3.5 h-3.5" /> واتساب
                </button>
                <button
                  type="button"
                  onClick={() => openSmsShare(selectedCustomer.phone, buildStatementShareText(selectedCustomer))}
                  className="min-h-[38px] rounded-xl bg-blue-600 text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> SMS
                </button>
                <button
                  type="button"
                  onClick={() => void copyNotificationText(buildStatementShareText(selectedCustomer))}
                  className="min-h-[38px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-700 text-[11px] font-extrabold flex items-center justify-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" /> نسخ
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await exportAsArabicPDF(buildStatementPrintable(selectedCustomer));
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
                      const res = await exportAsHDImage(buildStatementPrintable(selectedCustomer));
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
                  onClick={() => void printRoyalDocument(buildStatementPrintable(selectedCustomer))}
                  className="min-h-[38px] rounded-xl bg-[#1A365D] text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
                >
                  <Printer className="w-3.5 h-3.5 text-[#FDE68A]" /> طباعة
                </button>
              </div>

              {/* Ledger History Table */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-extrabold text-slate-700 dark:text-slate-300">
                  سجل القيود والحركات ({customerEntries.length})
                </h4>
                {customerEntries.length === 0 ? (
                  <p className="text-center text-xs font-bold text-slate-500 py-4">
                    لا توجد قيود مسجلة لهذا الحساب بعد (0)
                  </p>
                ) : (
                  customerEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold truncate">{entry.description}</div>
                        <div className="text-[10px] font-bold text-slate-500">
                          {formatDateTimeAr(entry.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className={`text-xs font-extrabold tabular-nums ml-1 ${
                            entry.entryType === 'debit'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {entry.entryType === 'debit' ? '+' : '-'} {formatYER(entry.amount, hideNumbers)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            openWhatsAppShare(
                              selectedCustomer.phone,
                              buildEntryNotificationMessage(selectedCustomer, entry)
                            )
                          }
                          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          aria-label="إرسال إشعار واتساب"
                          title="إرسال إشعار واتساب"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            openSmsShare(
                              selectedCustomer.phone,
                              buildEntryNotificationMessage(selectedCustomer, entry)
                            )
                          }
                          className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          aria-label="إرسال إشعار SMS"
                          title="إرسال إشعار SMS"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void copyNotificationText(buildEntryNotificationMessage(selectedCustomer, entry))
                          }
                          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          aria-label="نسخ الإشعار"
                          title="نسخ الإشعار"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteLedgerEntry(entry)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600"
                          aria-label="حذف القيد"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT CUSTOMER ACCOUNT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleSaveCustomer}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                {editingCustomer ? `تعديل حساب: ${editingCustomer.name}` : 'إضافة حساب عميل جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-extrabold mb-1">الاسم الكامل / اسم المحل</label>
              <input
                type="text"
                required
                autoComplete="off"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="مثال: بقالة النور / حساب خاص"
                className="w-full min-h-[42px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold mb-1">رقم الهاتف</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="77xxxxxxx"
                  className="flex-1 min-h-[42px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold tabular-nums shadow-sm focus:border-[#D4AF37] focus:outline-none"
                />
                <ContactPickerButton
                  onSelect={(c) => {
                    if (c.name && !formName) setFormName(c.name);
                    if (c.phone) setFormPhone(c.phone);
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-extrabold mb-1">تصنيف الحساب</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
              >
                {ACCOUNT_CATEGORIES.filter((c) => c !== 'الكل').map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {!editingCustomer && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-extrabold mb-1 text-red-600">رصيد افتتاحي عليه</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    autoComplete="off"
                    min={0}
                    value={formInitialDebit === '0' ? '' : formInitialDebit}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setFormInitialDebit(e.target.value)}
                    placeholder="0"
                    className="w-full min-h-[40px] rounded-xl border-2 border-red-500/70 dark:border-red-400/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold tabular-nums shadow-sm focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-extrabold mb-1 text-emerald-600">رصيد افتتاحي له</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    autoComplete="off"
                    min={0}
                    value={formInitialCredit === '0' ? '' : formInitialCredit}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setFormInitialCredit(e.target.value)}
                    placeholder="0"
                    className="w-full min-h-[40px] rounded-xl border-2 border-emerald-600/70 dark:border-emerald-400/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold tabular-nums shadow-sm focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-extrabold mb-1">ملاحظات</label>
              <input
                type="text"
                autoComplete="off"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="ملاحظات إضافية (اختياري)"
                className="w-full min-h-[40px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[44px] gold-btn-3d text-[#0F172A] text-sm font-extrabold rounded-xl"
            >
              {busy ? 'جاري الحفظ...' : editingCustomer ? 'حفظ التعديلات' : 'إنشاء الحساب'}
            </button>
          </form>
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-red-500 p-5 shadow-2xl text-center space-y-3">
            <h3 className="text-base font-extrabold text-red-600">تأكيد حذف الحساب</h3>
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
              هل تريد حذف حساب <strong>{deleteTarget.name}</strong>؟
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
                  await deleteCustomerAccount(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="min-h-[42px] rounded-xl bg-red-600 text-white text-xs font-extrabold"
              >
                تأكيد الحذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INSTANT CUSTOMER OPERATION NOTIFICATION SHARE MODAL (WhatsApp / SMS / Copy) */}
      {recentNotification && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 safe-top safe-bottom">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden">
            <div className="royal-header-3d px-4 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-white truncate">إشعار العميل جاهز للإرسال ✅</h3>
                <p className="text-[11px] font-bold text-[#FDE68A] truncate">
                  {recentNotification.customerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRecentNotification(null)}
                aria-label="إغلاق"
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-xs font-extrabold whitespace-pre-wrap leading-relaxed text-slate-900 dark:text-white">
                {recentNotification.message}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    openWhatsAppShare(recentNotification.phone, recentNotification.message);
                    notifySuccess('تم فتح واتساب لإرسال الإشعار');
                  }}
                  className="min-h-[42px] rounded-xl bg-emerald-600 text-white text-xs font-extrabold flex items-center justify-center gap-1"
                >
                  <Send className="w-3.5 h-3.5" />
                  واتساب
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openSmsShare(recentNotification.phone, recentNotification.message);
                    notifySuccess('تم فتح SMS لإرسال الإشعار');
                  }}
                  className="min-h-[42px] rounded-xl bg-blue-600 text-white text-xs font-extrabold flex items-center justify-center gap-1"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  SMS
                </button>
                <button
                  type="button"
                  onClick={() => void copyNotificationText(recentNotification.message)}
                  className="min-h-[42px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-700 text-xs font-extrabold flex items-center justify-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  نسخ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ExportPreviewModal result={exportPreview} onClose={() => setExportPreview(null)} />
    </div>
  );
};
