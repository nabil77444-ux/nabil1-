import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import {
  buildSingleSaleBreakdown,
  formatDenominationFormula,
  formatNumEn,
  getBuyerPriceTierLabel,
  getBuyerRoleArabicLabel,
  toPrintableBreakdownItems,
} from '../utils/salesBreakdown';

interface WholesaleCardsScreenProps {
  mode: 'electronic' | 'paper';
  hideNumbers: boolean;
}

export const WholesaleCardsScreen: React.FC<WholesaleCardsScreenProps> = ({ mode, hideNumbers }) => {
  const {
    profile,
    packages,
    managedUsers,
    customers,
    sales,
    appSettings,
    executeSaleTransaction,
    deliverPartialCards,
    createCustomerAccount,
    openTopupForPackage,
  } = useFirebase();
  const { notifySuccess, notifyWarning, notifyError } = useFeedback();

  const displayPackages = packages.length > 0 ? packages : (EXCLUSIVE_PACKAGES as PackageDoc[]);
  const isElectronic = mode === 'electronic';
  const isAdmin = profile?.role === 'super_admin';

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

    for (const u of managedUsers || []) {
      if (!u || u.role === 'super_admin' || u.status !== 'active') continue;
      opts.push({
        key: `user_${u.uid}`,
        id: u.uid,
        name: u.name || 'حساب بدون اسم',
        phone: u.phone || '',
        role: u.role === 'agent' ? 'agent' : 'client',
        rate:
          u.discountRate ||
          (u.role === 'agent' ? appSettings?.agentDiscountPercent || 70 : appSettings?.clientDiscountPercent || 80),
        tag: getRoleArabicLabel(u.role),
      });
    }
    for (const c of customers || []) {
      if (!c) continue;
      opts.push({
        key: `cust_${c.id}`,
        id: '',
        name: c.name || 'عميل',
        phone: c.phone || '',
        role: 'client',
        rate: appSettings?.clientDiscountPercent || 80,
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

  /**
   * Automatically detect buyer account type (Agent / Client / Consumer) when a contact
   * is picked from the official phonebook so unit prices adjust immediately.
   */
  const applyAutoPricingFromContact = (name?: string, phone?: string) => {
    const cleanPhone = (phone || '').replace(/[^\d]/g, '').slice(-9);
    const cleanName = (name || '').trim().toLowerCase();
    const matched = recipientOptions.find((o) => {
      const optPhone = (o.phone || '').replace(/[^\d]/g, '').slice(-9);
      if (cleanPhone && optPhone && optPhone === cleanPhone) return true;
      if (cleanName && o.name.trim().toLowerCase() === cleanName) return true;
      return false;
    });
    if (matched) {
      setSelectedRecipientKey(matched.key);
      setBuyerRole(matched.role);
      setDiscountRate(matched.rate);
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
      (sales || []).filter(
        (s) =>
          s &&
          s.saleType === (isElectronic ? 'electronic_wholesale' : 'paper_invoice') &&
          (s.deliveredCards ?? 0) < (s.totalCards ?? 0)
      ),
    [sales, isElectronic]
  );

  const adjustQty = useCallback((pkgId: string, delta: number) => {
    setCart((prev) => {
      const next = Math.max(0, (prev[pkgId] || 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[pkgId];
      else copy[pkgId] = next;
      return copy;
    });
  }, []);

  const handleIncrement = useCallback(
    (pkgId: string) => adjustQty(pkgId, 1),
    [adjustQty]
  );

  const handleDecrement = useCallback(
    (pkgId: string) => adjustQty(pkgId, -1),
    [adjustQty]
  );

  const setQtyDirect = useCallback((pkgId: string, nextQty: number) => {
    const val = Math.max(0, nextQty);
    setCart((prev) => {
      const copy = { ...prev };
      if (val === 0) delete copy[pkgId];
      else copy[pkgId] = val;
      return copy;
    });
  }, []);

  const handleClearPkg = useCallback(
    (pkgId: string) => setQtyDirect(pkgId, 0),
    [setQtyDirect]
  );

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
          setTimeout(() => {
            void printRoyalDocument(buildWholesalePrintable(sale));
          }, 250);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const tileActionRef = useRef({ cart, handleExecuteWholesale });
  tileActionRef.current = { cart, handleExecuteWholesale };

  const handleTileConfirm = useCallback(
    (pkg: PackageDoc) => {
      const curQty = tileActionRef.current.cart[pkg.id] || 0;
      if (curQty === 0) {
        adjustQty(pkg.id, 10);
      } else {
        void tileActionRef.current.handleExecuteWholesale(false);
      }
    },
    [adjustQty]
  );

  const buildWholesaleMessage = (sale: SaleDoc): string => {
    const title =
      sale.saleType === 'electronic_wholesale'
        ? 'فاتورة كروت إلكترونية (جملة)'
        : 'فاتورة كروت ورقية معتمدة';
    const breakdown = buildSingleSaleBreakdown(sale, appSettings);
    const buyerRoleText = getBuyerRoleArabicLabel(sale.buyerRole, sale.saleType);
    const tierText = getBuyerPriceTierLabel(sale.buyerRole, sale.saleType, sale.discountRate);
    const lines = [
      `📶 شبكة طيبة نت اللاسلكية (TAIBAH NET)`,
      `📄 ${title} — رقم: ${sale.invoiceNumber}`,
      `👤 المستلم: ${sale.buyerName}${sale.buyerPhone ? ` (${sale.buyerPhone})` : ''}`,
      `🏷 نوع الحساب: ${buyerRoleText} — ${tierText}`,
      `📅 التاريخ: ${formatDateTimeAr(sale.createdAt)}`,
      `────────────────────`,
      `📊 تفصيل الفئات المباعة (العدد × سعر الفئة = الإجمالي):`,
    ];
    for (const b of breakdown) {
      lines.push(`🔹 ${b.fullLineText}`);
    }
    for (const item of sale.items || []) {
      if (item.cardNumbers.length > 0) {
        lines.push(`🔑 أرقام ${item.packageLabel} (المُسلّم: ${item.delivered}/${item.quantity}):`);
        lines.push(`   ${item.cardNumbers.join(' ، ')}`);
      }
    }
    lines.push(`────────────────────`);
    lines.push(`📦 الإجمالي: ${formatNumEn(sale.totalCards)} كرت | المُسلّم: ${formatNumEn(sale.deliveredCards)} كرت`);
    lines.push(`💰 المطلوب: ${formatNumEn(sale.totalAmount)} ر.ي | المدفوع: ${formatNumEn(sale.paidAmount)} ر.ي | المتبقي: ${formatNumEn(sale.remainingAmount)} ر.ي`);
    lines.push(`📞 ${SUPER_ADMIN_CONFIG.developerCredit}`);
    return lines.join('\n');
  };

  const buildWholesalePrintable = (sale: SaleDoc): PrintableDocumentPayload => {
    const breakdown = buildSingleSaleBreakdown(sale, appSettings);
    const buyerRoleText = getBuyerRoleArabicLabel(sale.buyerRole, sale.saleType);
    const tierText = getBuyerPriceTierLabel(sale.buyerRole, sale.saleType, sale.discountRate);
    return {
      title: sale.saleType === 'electronic_wholesale' ? 'فاتورة كروت إلكترونية (جملة)' : 'فاتورة كروت ورقية رسمية',
      subtitle: `رقم الفاتورة: ${sale.invoiceNumber || sale.id.slice(-6)}`,
      metaRows: [
        { label: 'اسم المستلم', value: sale.buyerName },
        { label: 'نوع الحساب / التسعير', value: `${buyerRoleText} — ${tierText}` },
        { label: 'رقم الهاتف', value: sale.buyerPhone || 'غير مسجل' },
        { label: 'التاريخ', value: formatDateTimeAr(sale.createdAt) },
      ],
      tableHeaders: ['الفئة / الباقة', 'العدد', 'المُسلّم', 'سعر الوحدة', 'تفصيل الحساب (العدد × السعر = الإجمالي)'],
      tableRows: (sale.items || []).map((i) => {
        const unit = i.unitPrice || Math.round((i.price * (sale.discountRate || 100)) / 100);
        return [
          i.packageLabel,
          formatNumEn(i.quantity),
          formatNumEn(i.delivered),
          `${formatNumEn(unit)} ر.ي`,
          formatDenominationFormula(i.quantity, unit, unit * i.quantity),
        ];
      }),
      breakdownTitle: `تفصيل الفئات المباعة — ${buyerRoleText} (العدد × سعر الفئة = الإجمالي)`,
      breakdownItems: toPrintableBreakdownItems(breakdown),
      summaryRows: [
        { label: 'إجمالي الكروت', value: `${formatNumEn(sale.totalCards)} كرت` },
        { label: 'المُسلّم حتى الآن', value: `${formatNumEn(sale.deliveredCards)} كرت` },
        { label: 'المبلغ المدفوع', value: `${formatNumEn(sale.paidAmount)} ر.ي` },
        { label: 'المتبقي (آجل)', value: `${formatNumEn(sale.remainingAmount)} ر.ي` },
        { label: 'الإجمالي النهائي', value: `${formatNumEn(sale.totalAmount)} ر.ي`, highlight: true },
      ],
      extraSectionTitle: sale.cardNumbers && sale.cardNumbers.length > 0 ? 'أرقام الكروت الإلكترونية' : undefined,
      extraLines: sale.cardNumbers || [],
      fileName: `${sale.saleType === 'electronic_wholesale' ? 'جملة' : 'ورقية'}_${sale.invoiceNumber || sale.id.slice(-6)}`,
      sharePhone: sale.buyerPhone,
      shareText: buildWholesaleMessage(sale),
    };
  };

  return (
    <div className="space-y-3.5 safe-bottom">
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
        <div className="w-11 h-11 rounded-full bg-[#061124] p-0.5 border-2 border-[#D4AF37] shrink-0 overflow-hidden shadow">
          <img
            src={TAIBAH_ASSETS.logo}
            alt="شعار طيبة نت"
            className="w-full h-full rounded-full object-contain"
          />
        </div>
      </div>

      {/* Recipient + Pricing + Payment Configuration Card — Vivid Color-Coded Borders */}
      <div className="royal-card-frame rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-3 shadow-md space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
            بيانات المستلم والتسعير التلقائي
          </span>
          <button
            type="button"
            onClick={() => setShowNewRecipientModal(true)}
            className="min-h-[34px] px-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-[11px] font-extrabold flex items-center gap-1 shadow-xs active:scale-95 transition-transform"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+ إضافة مستلم جديد</span>
          </button>
        </div>

        {/* Saved Recipient Dropdown — Crisp Royal Navy Border */}
        {recipientOptions.length > 0 && (
          <select
            value={selectedRecipientKey}
            onChange={(e) => handleSelectRecipient(e.target.value)}
            className="w-full min-h-[42px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold text-slate-900 dark:text-white shadow-xs focus:border-[#D4AF37] focus:outline-none"
          >
            <option value="">-- اختر من الوكلاء أو العملاء المسجلين --</option>
            {recipientOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.name} ({o.tag}) — {o.phone || 'بدون هاتف'}
              </option>
            ))}
          </select>
        )}

        {/* Direct Name + Phone + Contact Picker — Crisp Royal Navy Borders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            autoComplete="off"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="اسم الوكيل / العميل / المحل"
            className="min-h-[42px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold text-slate-900 dark:text-white shadow-xs focus:border-[#D4AF37] focus:outline-none"
          />
          <div className="flex items-center gap-1.5">
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              value={customPhone}
              onChange={(e) => setCustomPhone(e.target.value)}
              placeholder="رقم الهاتف"
              className="flex-1 min-h-[42px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold text-slate-900 dark:text-white tabular-nums shadow-xs focus:border-[#D4AF37] focus:outline-none"
            />
            <ContactPickerButton
              onSelect={(c) => {
                if (c.name) setCustomName(c.name);
                if (c.phone) setCustomPhone(c.phone);
                applyAutoPricingFromContact(c.name, c.phone);
              }}
            />
          </div>
        </div>

        {/* Auto Pricing Tier Pills (70% Agent / 80% Client / 100% Consumer) — Balanced Blue/Navy Borders */}
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { role: 'agent' as const, rate: appSettings?.agentDiscountPercent || 70, label: `وكيل (${appSettings?.agentDiscountPercent || 70}%)` },
            { role: 'client' as const, rate: appSettings?.clientDiscountPercent || 80, label: `عميل (${appSettings?.clientDiscountPercent || 80}%)` },
            { role: 'consumer' as const, rate: 100, label: 'سعر كامل (100%)' },
          ].map((tier) => (
            <button
              key={tier.role}
              type="button"
              onClick={() => {
                setBuyerRole(tier.role);
                setDiscountRate(tier.rate);
              }}
              className={`min-h-[38px] rounded-xl border-2 text-[11px] font-extrabold transition-all shadow-xs ${
                buyerRole === tier.role && discountRate === tier.rate
                  ? 'bg-[#1A365D] text-[#FDE68A] border-[#D4AF37] shadow-md'
                  : 'bg-blue-50/75 dark:bg-slate-800 border-blue-700/70 dark:border-blue-400/70 text-[#1A365D] dark:text-blue-100'
              }`}
            >
              {tier.label}
            </button>
          ))}
        </div>

        {/* Payment Method Buttons — Balanced Emerald Borders */}
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
              className={`min-h-[36px] rounded-xl border-2 text-xs font-extrabold transition-all shadow-xs ${
                paymentMethod === pm.id
                  ? 'bg-emerald-600 text-white border-emerald-800 shadow-md'
                  : 'bg-emerald-50/65 dark:bg-slate-800 border-emerald-600/70 dark:border-emerald-400/70 text-emerald-900 dark:text-emerald-100'
              }`}
            >
              {pm.label}
            </button>
          ))}
        </div>

        {paymentMethod === 'partial' && (
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={paidAmountInput === '0' ? '' : paidAmountInput}
            onChange={(e) => setPaidAmountInput(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={`المبلغ المدفوع مقدماً (من أصل ${totalAmount} ر.ي)`}
            className="w-full min-h-[40px] rounded-xl border-2 border-[#D4AF37] bg-amber-50/60 dark:bg-slate-800 px-3 text-xs font-extrabold text-slate-900 dark:text-white tabular-nums shadow-xs focus:outline-none"
          />
        )}

        {/* Delivery Mechanism Box — Calm Sky-Blue Prominent Border */}
        {isElectronic && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-sky-50/85 dark:bg-sky-950/35 p-2 border-2 border-sky-600/75 dark:border-sky-400/75 shadow-xs">
            <span className="text-[11px] font-extrabold text-sky-950 dark:text-sky-100 flex items-center gap-1">
              <Truck className="w-3.5 h-3.5 text-sky-700 dark:text-[#FDE68A]" />
              آلية التسليم:
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDeliveryMode('full')}
                className={`px-2.5 py-1 rounded-lg border-[1.5px] text-[11px] font-extrabold shadow-xs ${
                  deliveryMode === 'full'
                    ? 'bg-[#1A365D] text-[#FDE68A] border-[#D4AF37]'
                    : 'bg-white dark:bg-slate-800 border-sky-600/65 dark:border-sky-400/65 text-sky-900 dark:text-sky-100'
                }`}
              >
                كامل الآن
              </button>
              <button
                type="button"
                onClick={() => setDeliveryMode('partial')}
                className={`px-2.5 py-1 rounded-lg border-[1.5px] text-[11px] font-extrabold shadow-xs ${
                  deliveryMode === 'partial'
                    ? 'bg-orange-600 text-white border-orange-800'
                    : 'bg-white dark:bg-slate-800 border-sky-600/65 dark:border-sky-400/65 text-sky-900 dark:text-sky-100'
                }`}
              >
                على دفعات
              </button>
              {deliveryMode === 'partial' && (
                <select
                  value={partialDeliverRatio}
                  onChange={(e) => setPartialDeliverRatio(e.target.value)}
                  className="rounded-lg border-2 border-sky-600/75 dark:border-sky-400/75 bg-white dark:bg-slate-900 px-1.5 py-1 text-[11px] font-extrabold text-sky-950 dark:text-white"
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

      {/* Unified Compact 8-Package Grid (Exact Direct-Sale Colors + Compact Wholesale Density) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(displayPackages || []).map((pkg) => {
          const qty = cart[pkg.id] || 0;
          const unitPrice = Math.round(((pkg.price ?? 0) * discountRate) / 100);
          return (
            <PackageCardTile
              key={pkg.id}
              pkg={pkg}
              qty={qty}
              hideNumbers={hideNumbers}
              effectiveUnitPrice={unitPrice}
              showStock={isElectronic}
              compact={true}
              confirmVariant="royal"
              confirmLabel={
                qty > 0
                  ? isElectronic
                    ? `تأكيد البيع (${qty})`
                    : `إصدار الفاتورة (${qty})`
                  : 'تأكيد البيع (+10)'
              }
              disabledConfirm={submitting}
              canEdit={false}
              onIncrement={handleIncrement}
              onDecrement={handleDecrement}
              onSetQty={setQtyDirect}
              onConfirm={handleTileConfirm}
              onClearOrDelete={handleClearPkg}
              onRequestTopup={!isAdmin && isElectronic ? openTopupForPackage : undefined}
            />
          );
        })}
      </div>

      {/* NORMAL-FLOW VERTICAL BATCH SUMMARY CARD (Directly below the 8th package / 3000 YER — never fixed/sticky) */}
      {selectedItems.length > 0 && (
        <div className="w-full !mt-[16px] !mb-[28px]">
          <div className="rounded-2xl royal-header-3d border-2 border-[#D4AF37] p-[14px] shadow-2xl flex flex-col gap-[12px]">
            {/* Top Row: Single clear summary line on right + independent close (×) button on left */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-xs sm:text-sm font-extrabold text-white tabular-nums leading-snug">
                  <span className="text-[#FDE68A]">
                    {selectedItems.length} باقات • {totalCards} كرت
                  </span>
                  <span className="mx-1.5 text-[#D4AF37]">|</span>
                  <span>الإجمالي: {formatYER(totalAmount, hideNumbers)}</span>
                </div>
                {!hideNumbers && (
                  <div className="text-[10.5px] font-bold text-slate-200 tabular-nums truncate">
                    {getBuyerRoleArabicLabel(
                      buyerRole,
                      isElectronic ? 'electronic_wholesale' : 'paper_invoice'
                    )}{' '}
                    ({discountRate}%):{' '}
                    {selectedItems
                      .map((x) => {
                        const u = Math.round((x.pkg.price * discountRate) / 100);
                        return `فئة ${x.pkg.price}: ${x.qty}×${u}=${formatNumEn(x.qty * u)}`;
                      })
                      .join(' | ')}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCart({})}
                className="w-8 h-8 rounded-xl bg-white/15 hover:bg-red-600/80 border border-[#D4AF37]/70 text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                aria-label="مسح التحديد"
                title="مسح التحديد"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Bottom Row: Full-width confirmation button(s) */}
            <div className={`grid gap-2 ${!isElectronic ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleExecuteWholesale(false)}
                className="w-full min-h-[44px] px-3.5 rounded-xl gold-btn-3d border-2 border-[#92400E] text-[#0F172A] text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                <ShoppingBag className="w-4 h-4 shrink-0" />
                <span>تأكيد وإرسال الدفعة المحددة</span>
              </button>
              {!isElectronic && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleExecuteWholesale(true)}
                  className="w-full min-h-[44px] px-3 rounded-xl bg-white/15 hover:bg-white/25 border-2 border-[#D4AF37] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  <Printer className="w-4 h-4 text-[#FDE68A] shrink-0" />
                  <span>حفظ وطباعة</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
              autoComplete="off"
              value={newRecName}
              onChange={(e) => setNewRecName(e.target.value)}
              placeholder="الاسم الكامل أو اسم البقالة"
              className="w-full min-h-[42px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold focus:border-[#D4AF37] focus:outline-none"
            />
            <div className="flex items-center gap-1.5">
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                value={newRecPhone}
                onChange={(e) => setNewRecPhone(e.target.value)}
                placeholder="رقم الهاتف"
                className="flex-1 min-h-[42px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold tabular-nums focus:border-[#D4AF37] focus:outline-none"
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
              {/* Per-Denomination Breakdown Summary */}
              <div className="rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-[#D4AF37]/60 p-2.5 space-y-1">
                <div className="text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                  تفصيل الفئات ({getBuyerRoleArabicLabel(completedSale.buyerRole, completedSale.saleType)} — {getBuyerPriceTierLabel(completedSale.buyerRole, completedSale.saleType, completedSale.discountRate)}):
                </div>
                {buildSingleSaleBreakdown(completedSale, appSettings).map((b) => (
                  <div
                    key={b.key}
                    className="flex items-center justify-between gap-2 text-[11px] font-extrabold tabular-nums"
                  >
                    <span className="text-slate-700 dark:text-slate-200">فئة {formatNumEn(b.denomination)} ريال</span>
                    <span className="text-[#1A365D] dark:text-[#FDE68A]">{b.formulaText}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border-2 border-[#1A365D]/50 dark:border-[#D4AF37]/50 p-3 text-xs font-bold whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
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
