import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  FileDown,
  FileText,
  ImageDown,
  MessageSquare,
  Printer,
  Send,
  ShoppingBag,
  Truck,
  UserPlus,
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
import { PackageCardTile } from './PackageCardTile';
import {
  EXCLUSIVE_PACKAGES,
  formatDateTimeAr,
  formatYER,
  getRoleArabicLabel,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type PackageDoc,
  type SaleDoc,
} from '../types/taibah';

interface WholesaleCardsScreenProps {
  mode: 'electronic' | 'paper';
  hideNumbers: boolean;
}

export const WholesaleCardsScreen: React.FC<WholesaleCardsScreenProps> = ({ mode, hideNumbers }) => {
  const {
    packages,
    managedUsers,
    customers,
    sales,
    appSettings,
    executeSaleTransaction,
    deliverPartialCards,
    createCustomerAccount,
  } = useFirebase();
  const { notifySuccess, notifyWarning, notifyError } = useFeedback();

  const displayPackages = packages.length > 0 ? packages : (EXCLUSIVE_PACKAGES as PackageDoc[]);
  const isElectronic = mode === 'electronic';

  // Recipient Selection
  const [selectedRecipientKey, setSelectedRecipientKey] = useState('');
  const [customName, setCustomName] = useState('');
  const [customPhone, setCustomPhone] = useState('');
  const [buyerRole, setBuyerRole] = useState<'agent' | 'client' | 'consumer'>('client');
  const [discountRate, setDiscountRate] = useState<number>(appSettings.clientDiscountPercent || 80);

  // Payment & Delivery
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit' | 'partial'>('cash');
  const [paidAmountInput, setPaidAmountInput] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<'full' | 'partial'>('full');
  const [partialDeliverRatio, setPartialDeliverRatio] = useState('50');
  const [notes, setNotes] = useState('');

  // Multi-package cart
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  // Modals
  const [showNewRecipientModal, setShowNewRecipientModal] = useState(false);
  const [newRecName, setNewRecName] = useState('');
  const [newRecPhone, setNewRecPhone] = useState('');
  const [completedSale, setCompletedSale] = useState<SaleDoc | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportShareResult | null>(null);

  const recipientOptions = useMemo(() => {
    const opts: Array<{
      key: string;
      id: string;
      name: string;
      phone: string;
      role: 'agent' | 'client' | 'consumer';
      rate: number;
      tag: string;
    }> = [];

    for (const u of managedUsers) {
      if (u.role === 'super_admin' || u.status !== 'active') continue;
      opts.push({
        key: `user_${u.uid}`,
        id: u.uid,
        name: u.name,
        phone: u.phone,
        role: u.role === 'agent' ? 'agent' : 'client',
        rate:
          u.discountRate ||
          (u.role === 'agent' ? appSettings.agentDiscountPercent : appSettings.clientDiscountPercent),
        tag: getRoleArabicLabel(u.role),
      });
    }
    for (const c of customers) {
      opts.push({
        key: `cust_${c.id}`,
        id: '',
        name: c.name,
        phone: c.phone || '',
        role: 'client',
        rate: appSettings.clientDiscountPercent || 80,
        tag: c.category || 'عميل',
      });
    }
    return opts;
  }, [managedUsers, customers, appSettings]);

  const handleSelectRecipient = (key: string) => {
    setSelectedRecipientKey(key);
    const found = recipientOptions.find((o) => o.key === key);
    if (found) {
      setCustomName(found.name);
      setCustomPhone(found.phone);
      setBuyerRole(found.role);
      setDiscountRate(found.rate);
    }
  };

  const selectedItems = useMemo(
    () =>
      displayPackages
        .map((pkg) => ({ pkg, qty: cart[pkg.id] || 0 }))
        .filter((x) => x.qty > 0),
    [displayPackages, cart]
  );

  const totalCards = useMemo(() => selectedItems.reduce((s, x) => s + x.qty, 0), [selectedItems]);
  const totalAmount = useMemo(
    () =>
      selectedItems.reduce(
        (s, x) => s + Math.round((x.pkg.price * discountRate) / 100) * x.qty,
        0
      ),
    [selectedItems, discountRate]
  );

  const pendingDeliverySales = useMemo(
    () =>
      sales.filter(
        (s) =>
          s.saleType === (isElectronic ? 'electronic_wholesale' : 'paper_invoice') &&
          s.deliveredCards < s.totalCards
      ),
    [sales, isElectronic]
  );

  const adjustQty = (pkgId: string, delta: number) => {
    setCart((prev) => {
      const next = Math.max(0, (prev[pkgId] || 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[pkgId];
      else copy[pkgId] = next;
      return copy;
    });
  };

  const setQtyDirect = (pkgId: string, nextQty: number) => {
    const val = Math.max(0, nextQty);
    setCart((prev) => {
      const copy = { ...prev };
      if (val === 0) delete copy[pkgId];
      else copy[pkgId] = val;
      return copy;
    });
  };

  const handleExecuteWholesale = async (autoPrint = false) => {
    if (selectedItems.length === 0) {
      notifyWarning('اختر باقة واحدة على الأقل');
      return;
    }
    if (!customName.trim()) {
      notifyWarning('حدد المستلم', 'اختر وكيلاً/عميلاً أو اكتب اسم المستلم أولاً.');
      return;
    }

    setSubmitting(true);
    try {
      const selectedOpt = recipientOptions.find((o) => o.key === selectedRecipientKey);
      const ratio = Math.min(100, Math.max(0, Number(partialDeliverRatio) || 50));

      const sale = await executeSaleTransaction({
        saleType: isElectronic ? 'electronic_wholesale' : 'paper_invoice',
        buyerId: selectedOpt?.id || '',
        buyerName: customName.trim(),
        buyerPhone: customPhone.trim(),
        buyerRole,
        paymentMethod,
        discountRate,
        paidAmount:
          paymentMethod === 'cash'
            ? totalAmount
            : paymentMethod === 'credit'
              ? 0
              : Number(paidAmountInput) || 0,
        notes: notes.trim(),
        items: selectedItems.map((x) => ({
          packageId: x.pkg.id,
          quantity: x.qty,
          deliverNow:
            !isElectronic || deliveryMode === 'full'
              ? x.qty
              : Math.max(1, Math.floor((x.qty * ratio) / 100)),
        })),
      });

      if (sale) {
        setCompletedSale(sale);
        setCart({});
        setNotes('');
        if (autoPrint) {
          setTimeout(() => printRoyalDocument(buildWholesalePrintable(sale)), 250);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const buildWholesaleMessage = (sale: SaleDoc): string => {
    const title =
      sale.saleType === 'electronic_wholesale'
        ? 'فاتورة كروت إلكترونية (جملة)'
        : 'فاتورة كروت ورقية معتمدة';
    const lines = [
      `📶 شبكة طيبة نت اللاسلكية (TAIBAH NET)`,
      `📄 ${title} — رقم: ${sale.invoiceNumber}`,
      `👤 المستلم: ${sale.buyerName}${sale.buyerPhone ? ` (${sale.buyerPhone})` : ''}`,
      `📅 التاريخ: ${formatDateTimeAr(sale.createdAt)}`,
      `────────────────────`,
    ];
    for (const item of sale.items || []) {
      lines.push(
        `🔹 ${item.packageLabel} | العدد: ${item.quantity} | المُسلّم: ${item.delivered} | السعر: ${item.unitPrice} ر.ي | الإجمالي: ${item.unitPrice * item.quantity} ر.ي`
      );
      if (item.cardNumbers.length > 0) {
        lines.push(`   الأرقام: ${item.cardNumbers.join(' ، ')}`);
      }
    }
    lines.push(`────────────────────`);
    lines.push(`📦 الإجمالي: ${sale.totalCards} كرت | المُسلّم: ${sale.deliveredCards} كرت`);
    lines.push(`💰 المطلوب: ${sale.totalAmount} ر.ي | المدفوع: ${sale.paidAmount} ر.ي | المتبقي: ${sale.remainingAmount} ر.ي`);
    lines.push(`📞 ${SUPER_ADMIN_CONFIG.developerCredit}`);
    return lines.join('\n');
  };

  const buildWholesalePrintable = (sale: SaleDoc): PrintableDocumentPayload => ({
    title: sale.saleType === 'electronic_wholesale' ? 'فاتورة كروت إلكترونية (جملة)' : 'فاتورة كروت ورقية رسمية',
    subtitle: `رقم الفاتورة: ${sale.invoiceNumber || sale.id.slice(-6)}`,
    metaRows: [
      { label: 'اسم المستلم', value: sale.buyerName },
      { label: 'رقم الهاتف', value: sale.buyerPhone || 'غير مسجل' },
      { label: 'نسبة التسعير', value: `${sale.discountRate || 100}%` },
      { label: 'التاريخ', value: formatDateTimeAr(sale.createdAt) },
    ],
    tableHeaders: ['الباقة', 'العدد', 'المُسلّم', 'سعر الوحدة', 'الإجمالي'],
    tableRows: (sale.items || []).map((i) => [
      i.packageLabel,
      String(i.quantity),
      String(i.delivered),
      `${i.unitPrice} ر.ي`,
      `${i.unitPrice * i.quantity} ر.ي`,
    ]),
    summaryRows: [
      { label: 'إجمالي الكروت', value: `${sale.totalCards} كرت` },
      { label: 'المُسلّم حتى الآن', value: `${sale.deliveredCards} كرت` },
      { label: 'المبلغ المدفوع', value: `${sale.paidAmount} ر.ي` },
      { label: 'المتبقي (آجل)', value: `${sale.remainingAmount} ر.ي` },
      { label: 'الإجمالي النهائي', value: `${sale.totalAmount} ر.ي`, highlight: true },
    ],
    extraSectionTitle: sale.cardNumbers && sale.cardNumbers.length > 0 ? 'أرقام الكروت الإلكترونية' : undefined,
    extraLines: sale.cardNumbers || [],
    fileName: `${sale.saleType === 'electronic_wholesale' ? 'جملة' : 'ورقية'}_${sale.invoiceNumber || sale.id.slice(-6)}`,
    sharePhone: sale.buyerPhone,
    shareText: buildWholesaleMessage(sale),
  });

  return (
    <div className="space-y-3.5 pb-24">
      {/* Compact Royal Header Banner */}
      <div className="royal-header-3d rounded-3xl border-2 border-[#D4AF37] p-3.5 shadow-lg flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-white/15 border border-[#D4AF37] flex items-center justify-center text-[#FDE68A] shrink-0">
            {isElectronic ? <CreditCard className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-extrabold text-white truncate">
              {isElectronic ? 'الكروت الإلكترونية (بيع الجملة)' : 'الفواتير والكروت الورقية'}
            </h2>
            <p className="text-[11px] font-bold text-[#FDE68A] truncate">
              {isElectronic
                ? 'تسعير تلقائي (وكيل / عميل / مستهلك) + دعم التسليم على دفعات'
                : 'فواتير ورقية محاسبية مستقلة بدون سحب من المخزون الإلكتروني'}
            </p>
          </div>
        </div>
        <img
          src={TAIBAH_ASSETS.logo}
          alt="شعار طيبة نت"
          className="w-11 h-11 rounded-full object-cover border-2 border-[#D4AF37] shrink-0"
        />
      </div>

      {/* Recipient + Pricing + Payment Configuration Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 p-3.5 shadow-md space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
            بيانات المستلم والتسعير التلقائي
          </span>
          <button
            type="button"
            onClick={() => setShowNewRecipientModal(true)}
            className="min-h-[34px] px-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-[11px] font-extrabold flex items-center gap-1"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+ إضافة مستلم جديد</span>
          </button>
        </div>

        {/* Saved Recipient Dropdown */}
        {recipientOptions.length > 0 && (
          <select
            value={selectedRecipientKey}
            onChange={(e) => handleSelectRecipient(e.target.value)}
            className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
          >
            <option value="">-- اختر من الوكلاء أو العملاء المسجلين --</option>
            {recipientOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.name} ({o.tag}) — {o.phone || 'بدون هاتف'}
              </option>
            ))}
          </select>
        )}

        {/* Direct Name + Phone + Contact Picker */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="اسم الوكيل / العميل / المحل"
            className="min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
          />
          <div className="flex items-center gap-1.5">
            <input
              type="tel"
              value={customPhone}
              onChange={(e) => setCustomPhone(e.target.value)}
              placeholder="رقم الهاتف"
              className="flex-1 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold tabular-nums focus:border-[#D4AF37] focus:outline-none"
            />
            <ContactPickerButton
              onSelect={(c) => {
                if (c.name) setCustomName(c.name);
                if (c.phone) setCustomPhone(c.phone);
              }}
            />
          </div>
        </div>

        {/* Auto Pricing Tier Pills (70% Agent / 80% Client / 100% Consumer) */}
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { role: 'agent' as const, rate: appSettings.agentDiscountPercent || 70, label: `وكيل (${appSettings.agentDiscountPercent || 70}%)` },
            { role: 'client' as const, rate: appSettings.clientDiscountPercent || 80, label: `عميل (${appSettings.clientDiscountPercent || 80}%)` },
            { role: 'consumer' as const, rate: 100, label: 'سعر كامل (100%)' },
          ].map((tier) => (
            <button
              key={tier.role}
              type="button"
              onClick={() => {
                setBuyerRole(tier.role);
                setDiscountRate(tier.rate);
              }}
              className={`min-h-[38px] rounded-xl border text-[11px] font-extrabold transition-all ${
                buyerRole === tier.role && discountRate === tier.rate
                  ? 'bg-[#1A365D] text-[#FDE68A] border-[#D4AF37] shadow'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {tier.label}
            </button>
          ))}
        </div>

        {/* Payment Method & Delivery Mode */}
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              { id: 'cash', label: 'نقداً' },
              { id: 'credit', label: 'آجل (دين)' },
              { id: 'partial', label: 'دفع جزئي' },
            ] as const
          ).map((pm) => (
            <button
              key={pm.id}
              type="button"
              onClick={() => setPaymentMethod(pm.id)}
              className={`min-h-[36px] rounded-xl border text-xs font-extrabold ${
                paymentMethod === pm.id
                  ? 'bg-emerald-600 text-white border-emerald-700 shadow'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              }`}
            >
              {pm.label}
            </button>
          ))}
        </div>

        {paymentMethod === 'partial' && (
          <input
            type="number"
            min={0}
            value={paidAmountInput}
            onChange={(e) => setPaidAmountInput(e.target.value)}
            placeholder={`المبلغ المدفوع مقدماً (من أصل ${totalAmount} ر.ي)`}
            className="w-full min-h-[40px] rounded-xl border border-[#D4AF37] bg-amber-50/40 dark:bg-slate-800 px-3 text-xs font-extrabold tabular-nums"
          />
        )}

        {isElectronic && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800 p-2 border border-slate-200 dark:border-slate-700">
            <span className="text-[11px] font-extrabold flex items-center gap-1">
              <Truck className="w-3.5 h-3.5 text-[#D4AF37]" />
              آلية التسليم:
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDeliveryMode('full')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold ${
                  deliveryMode === 'full' ? 'bg-[#1A365D] text-[#FDE68A]' : 'bg-white dark:bg-slate-700'
                }`}
              >
                كامل الآن
              </button>
              <button
                type="button"
                onClick={() => setDeliveryMode('partial')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold ${
                  deliveryMode === 'partial' ? 'bg-orange-600 text-white' : 'bg-white dark:bg-slate-700'
                }`}
              >
                على دفعات
              </button>
              {deliveryMode === 'partial' && (
                <select
                  value={partialDeliverRatio}
                  onChange={(e) => setPartialDeliverRatio(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 py-1 text-[11px] font-bold"
                >
                  <option value="25">25%</option>
                  <option value="50">50%</option>
                  <option value="75">75%</option>
                </select>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Update 15: Unified 8-Package Grid (Electronic & Paper Modes) */}
      <div className="grid grid-cols-2 gap-2.5">
        {displayPackages.map((pkg) => {
          const qty = cart[pkg.id] || 0;
          const unitPrice = Math.round((pkg.price * discountRate) / 100);
          return (
            <PackageCardTile
              key={pkg.id}
              pkg={pkg}
              qty={qty}
              hideNumbers={hideNumbers}
              effectiveUnitPrice={unitPrice}
              showStock={isElectronic}
              confirmLabel={
                qty > 0
                  ? isElectronic
                    ? `تأكيد البيع (${qty})`
                    : `إصدار الفاتورة (${qty})`
                  : 'تأكيد البيع (+10)'
              }
              disabledConfirm={submitting || (isElectronic && pkg.availableCount <= 0)}
              canEdit={false}
              onIncrement={() => adjustQty(pkg.id, 1)}
              onDecrement={() => adjustQty(pkg.id, -1)}
              onSetQty={(next) => setQtyDirect(pkg.id, next)}
              onConfirm={() => {
                if (qty === 0) {
                  adjustQty(pkg.id, 10);
                } else {
                  void handleExecuteWholesale(false);
                }
              }}
              onClearOrDelete={() => setQtyDirect(pkg.id, 0)}
            />
          );
        })}
      </div>

      {/* Pending Partial Delivery Batches Section */}
      {isElectronic && pendingDeliverySales.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-orange-400 p-3.5 space-y-2.5">
          <h3 className="text-xs font-extrabold text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
            <Truck className="w-4 h-4" />
            فواتير الجملة بانتظار استكمال الدفعات ({pendingDeliverySales.length})
          </h3>
          {pendingDeliverySales.map((s) => (
            <div
              key={s.id}
              className="rounded-xl bg-slate-50 dark:bg-slate-800 p-2.5 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-xs font-extrabold truncate">
                  {s.buyerName} ({s.invoiceNumber})
                </div>
                <div className="text-[11px] font-bold text-slate-500 tabular-nums">
                  مُسلّم {s.deliveredCards} من أصل {s.totalCards} كرت
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const pendingItem = (s.items || []).find(
                    (i) => i.quantity - i.delivered - (i.returned || 0) > 0
                  );
                  if (pendingItem) {
                    const rem = pendingItem.quantity - pendingItem.delivered - (pendingItem.returned || 0);
                    await deliverPartialCards(s, pendingItem.packageId, rem);
                  }
                }}
                className="min-h-[34px] px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold shrink-0"
              >
                تسليم المتبقي
              </button>
            </div>
          ))}
        </div>
      )}

      {/* UPDATE 4: FLOATING BOTTOM MULTI-PACKAGE CONFIRMATION BAR */}
      {selectedItems.length > 0 && (
        <div className="fixed bottom-3 inset-x-3 z-40 max-w-2xl mx-auto">
          <div className="rounded-2xl royal-header-3d border-2 border-[#D4AF37] p-3 shadow-2xl flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-[#FDE68A] tabular-nums">
                {selectedItems.length} باقات · {totalCards} كرت ({discountRate}%)
              </div>
              <div className="text-sm font-extrabold text-white tabular-nums">
                الإجمالي: {formatYER(totalAmount, hideNumbers)}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {!isElectronic && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleExecuteWholesale(true)}
                  className="min-h-[42px] px-3 rounded-xl bg-white/15 border border-[#D4AF37] text-white text-xs font-extrabold flex items-center gap-1"
                >
                  <Printer className="w-4 h-4 text-[#FDE68A]" />
                  <span>حفظ وطباعة</span>
                </button>
              )}
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleExecuteWholesale(false)}
                className="min-h-[42px] px-3.5 rounded-xl gold-btn-3d text-[#0F172A] text-xs font-extrabold flex items-center gap-1.5"
              >
                <ShoppingBag className="w-4 h-4" />
                <span>تأكيد وإرسال الدفعة المحددة ({selectedItems.length} باقات)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW RECIPIENT MODAL */}
      {showNewRecipientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newRecName.trim()) return;
              const created = await createCustomerAccount({
                name: newRecName.trim(),
                phone: newRecPhone.trim(),
                category: 'عميل شبكة',
              });
              if (created) {
                setCustomName(created.name);
                setCustomPhone(created.phone || '');
                setNewRecName('');
                setNewRecPhone('');
                setShowNewRecipientModal(false);
              }
            }}
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold">إضافة مستلم / نقطة بيع جديدة</h3>
              <button type="button" onClick={() => setShowNewRecipientModal(false)} className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              required
              value={newRecName}
              onChange={(e) => setNewRecName(e.target.value)}
              placeholder="الاسم الكامل أو اسم البقالة"
              className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
            />
            <div className="flex items-center gap-1.5">
              <input
                type="tel"
                value={newRecPhone}
                onChange={(e) => setNewRecPhone(e.target.value)}
                placeholder="رقم الهاتف"
                className="flex-1 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold tabular-nums"
              />
              <ContactPickerButton
                onSelect={(c) => {
                  if (c.name) setNewRecName(c.name);
                  if (c.phone) setNewRecPhone(c.phone);
                }}
              />
            </div>
            <button type="submit" className="w-full min-h-[44px] gold-btn-3d text-[#0F172A] text-sm font-extrabold rounded-xl">
              حفظ واختيار المستلم
            </button>
          </form>
        </div>
      )}

      {/* POST-SALE UNIFIED INVOICE & SHARE MODAL */}
      {completedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 overflow-y-auto">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto">
            <div className="royal-header-3d px-4 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-extrabold text-white">تم إصدار الفاتورة بنجاح ✅</h3>
                  <p className="text-[11px] font-bold text-[#FDE68A]">
                    {completedSale.invoiceNumber} · {completedSale.buyerName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCompletedSale(null)}
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-xs font-bold whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                {buildWholesaleMessage(completedSale)}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => openWhatsAppShare(completedSale.buyerPhone, buildWholesaleMessage(completedSale))}
                  className="min-h-[42px] rounded-xl bg-emerald-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  واتساب
                </button>
                <button
                  type="button"
                  onClick={() => openSmsShare(completedSale.buyerPhone, buildWholesaleMessage(completedSale))}
                  className="min-h-[42px] rounded-xl bg-blue-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <MessageSquare className="w-4 h-4" />
                  SMS
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await exportAsHDImage(buildWholesalePrintable(completedSale));
                      notifySuccess('تم تجهيز الملف بنجاح ✅');
                      if (!res.sharedNatively) setExportPreview(res);
                    } catch {
                      notifyError('تعذر إنشاء الصورة');
                    }
                  }}
                  className="min-h-[40px] rounded-xl gold-btn-3d text-[#0F172A] text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <ImageDown className="w-4 h-4" />
                  صورة HD
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await exportAsArabicPDF(buildWholesalePrintable(completedSale));
                      notifySuccess('تم تجهيز الملف بنجاح ✅');
                      if (!res.sharedNatively) setExportPreview(res);
                    } catch {
                      notifyError('تعذر إنشاء PDF');
                    }
                  }}
                  className="min-h-[40px] rounded-xl bg-red-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <FileDown className="w-4 h-4" />
                  PDF عربي
                </button>
                <button
                  type="button"
                  onClick={() => void printRoyalDocument(buildWholesalePrintable(completedSale))}
                  className="col-span-2 min-h-[40px] rounded-xl bg-[#1A365D] text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <Printer className="w-4 h-4 text-[#FDE68A]" />
                  طباعة الفاتورة الرسمية
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
