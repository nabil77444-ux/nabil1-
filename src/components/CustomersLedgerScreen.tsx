import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
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
  type CustomerAccount,
} from '../types/taibah';

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

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      if (categoryFilter !== 'الكل' && (c.category || 'عميل شبكة') !== categoryFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          (c.phone || '').includes(q) ||
          (c.notes || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [customers, categoryFilter, search]);

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

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setBusy(true);
    try {
      if (editingCustomer) {
        await updateCustomerAccount(editingCustomer.id, {
          name: formName.trim(),
          phone: formPhone.trim(),
          category: formCategory,
          notes: formNotes.trim(),
        });
      } else {
        await createCustomerAccount({
          name: formName.trim(),
          phone: formPhone.trim(),
          category: formCategory,
          notes: formNotes.trim(),
          initialDebit: Number(formInitialDebit) || 0,
          initialCredit: Number(formInitialCredit) || 0,
        });
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
      const ok = await addLedgerEntry({
        customerId: selectedCustomer.id,
        entryType,
        amount: amt,
        description:
          entryDesc.trim() ||
          (entryType === 'debit' ? 'قيد مدين (عليه)' : entryType === 'credit' ? 'سند قبض / سداد (له)' : 'قيد تسوية وتصحيح'),
      });
      if (ok) {
        setEntryAmount('');
        setEntryDesc('');
      }
    } finally {
      setBusy(false);
    }
  };

  const buildStatementShareText = (c: CustomerAccount): string => {
    const statusText =
      c.balance > 0
        ? `عليه: ${c.balance} ر.ي`
        : c.balance < 0
          ? `له: ${Math.abs(c.balance)} ر.ي`
          : 'الحساب متوازن (0 ر.ي)';
    const lines = [
      `📶 شبكة طيبة نت اللاسلكية (TAIBAH NET)`,
      `📒 كشف حساب تفصيلي`,
      `👤 الحساب: ${c.name}${c.phone ? ` (${c.phone})` : ''}`,
      `🏷 التصنيف: ${c.category || 'عميل شبكة'}`,
      `────────────────────`,
      `📈 إجمالي عليه (مدين): ${c.totalDebit} ر.ي`,
      `📉 إجمالي له (دائن/مسدد): ${c.totalCredit} ر.ي`,
      `💰 الصافي الحالي: ${statusText}`,
      `────────────────────`,
    ];
    if (customerEntries.length > 0) {
      lines.push(`آخر القيود (${Math.min(10, customerEntries.length)}):`);
      for (const e of customerEntries.slice(0, 10)) {
        const lbl = e.entryType === 'debit' ? 'عليه +' : e.entryType === 'credit' ? 'له -' : 'تصحيح';
        lines.push(`• ${lbl} ${e.amount} ر.ي — ${e.description} (${formatDateTimeAr(e.createdAt)})`);
      }
    }
    lines.push(`📞 ${SUPER_ADMIN_CONFIG.developerCredit}`);
    return lines.join('\n');
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
    <div className="space-y-3.5">
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
        <img
          src={TAIBAH_ASSETS.logo}
          alt="شعار طيبة نت"
          className="w-11 h-11 rounded-full object-cover border-2 border-[#D4AF37] shrink-0"
        />
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
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم العميل أو رقم الهاتف..."
            className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
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
                <img
                  src={TAIBAH_ASSETS.logo}
                  alt="طيبة نت"
                  className="w-9 h-9 rounded-full object-cover border border-[#D4AF37] shrink-0"
                />
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
                    className={`min-h-[36px] rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 ${
                      entryType === 'debit'
                        ? 'bg-red-600 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    عليه (مدين)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryType('credit')}
                    className={`min-h-[36px] rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 ${
                      entryType === 'credit'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <ArrowDownLeft className="w-3.5 h-3.5" />
                    له (سداد)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntryType('adjustment')}
                    className={`min-h-[36px] rounded-xl text-[11px] font-extrabold ${
                      entryType === 'adjustment'
                        ? 'bg-amber-600 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    قيد تصحيح
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="number"
                    required
                    min={1}
                    value={entryAmount}
                    onChange={(e) => setEntryAmount(e.target.value)}
                    placeholder="المبلغ بالريال اليمني"
                    className="min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-extrabold tabular-nums"
                  />
                  <input
                    type="text"
                    value={entryDesc}
                    onChange={(e) => setEntryDesc(e.target.value)}
                    placeholder="البيان / سبب القيد (مثال: دفعة نقدية)"
                    className="min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold"
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
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
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
                  className="col-span-2 sm:col-span-1 min-h-[38px] rounded-xl bg-[#1A365D] text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
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
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-xs font-extrabold tabular-nums ${
                            entry.entryType === 'debit'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {entry.entryType === 'debit' ? '+' : '-'} {formatYER(entry.amount, hideNumbers)}
                        </span>
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
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="مثال: بقالة النور / حساب خاص"
                className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold mb-1">رقم الهاتف</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="tel"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="77xxxxxxx"
                  className="flex-1 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold tabular-nums"
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
                className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
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
                    min={0}
                    value={formInitialDebit}
                    onChange={(e) => setFormInitialDebit(e.target.value)}
                    placeholder="0"
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-extrabold mb-1 text-emerald-600">رصيد افتتاحي له</label>
                  <input
                    type="number"
                    min={0}
                    value={formInitialCredit}
                    onChange={(e) => setFormInitialCredit(e.target.value)}
                    placeholder="0"
                    className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold tabular-nums"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-extrabold mb-1">ملاحظات</label>
              <input
                type="text"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="ملاحظات إضافية (اختياري)"
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
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

      <ExportPreviewModal result={exportPreview} onClose={() => setExportPreview(null)} />
    </div>
  );
};
