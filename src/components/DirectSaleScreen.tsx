import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  FileDown,
  ImageDown,
  MessageSquare,
  Printer,
  RefreshCw,
  Save,
  Send,
  Settings2,
  ShoppingCart,
  X,
  Zap,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import { normalizeDigits } from '../lib/firebase';
import {
  applyMessageTemplate,
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
  formatCount,
  formatDateTimeAr,
  formatPackageBalanceFull,
  formatYER,
  resolveDirectSaleTemplate,
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

interface DirectSaleScreenProps {
  hideNumbers: boolean;
}

export const DirectSaleScreen: React.FC<DirectSaleScreenProps> = ({ hideNumbers }) => {
  const {
    profile,
    packages,
    totalAvailableCards,
    appSettings,
    isRefreshingInventory,
    refreshMyInventory,
    executeSaleTransaction,
    updateAppSettings,
    updatePackageInfo,
    openTopupForPackage,
  } = useFirebase();
  const { notifySuccess, notifyWarning, notifyError } = useFeedback();

  const displayPackages = packages.length > 0 ? packages : (EXCLUSIVE_PACKAGES as PackageDoc[]);
  const isAdmin = profile?.role === 'super_admin';

  // Consumer details (optional quick bar)
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');

  // Multi-package cart counts
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  // Modals (clean & focused — sales history lives strictly in «المبيعات» and «التقارير»)
  const [completedSale, setCompletedSale] = useState<SaleDoc | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportShareResult | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateText, setTemplateText] = useState(
    resolveDirectSaleTemplate(appSettings.directSaleMessageTemplate)
  );
  const [editingPkg, setEditingPkg] = useState<PackageDoc | null>(null);
  const [editPkgData, setEditPkgData] = useState('');
  const [editPkgHours, setEditPkgHours] = useState('');
  const [editPkgValidity, setEditPkgValidity] = useState('');

  const selectedItems = useMemo(() => {
    return displayPackages
      .map((pkg) => ({ pkg, qty: cart[pkg.id] || 0 }))
      .filter((x) => x.qty > 0);
  }, [displayPackages, cart]);

  const selectedPackagesCount = selectedItems.length;
  const selectedTotalCards = useMemo(
    () => selectedItems.reduce((s, x) => s + x.qty, 0),
    [selectedItems]
  );
  const selectedTotalAmount = useMemo(
    () => selectedItems.reduce((s, x) => s + x.pkg.price * x.qty, 0),
    [selectedItems]
  );

  const latestRef = useRef({
    cart,
    buyerName,
    buyerPhone,
  });
  latestRef.current = { cart, buyerName, buyerPhone };

  const adjustQty = useCallback((pkgId: string, delta: number) => {
    setCart((prev) => {
      const next = Math.max(0, (prev[pkgId] || 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[pkgId];
      else copy[pkgId] = next;
      return copy;
    });
  }, []);

  const setQtyDirect = useCallback((pkgId: string, nextQty: number) => {
    const clean = Math.max(0, Math.floor(nextQty || 0));
    setCart((prev) => {
      const copy = { ...prev };
      if (clean === 0) delete copy[pkgId];
      else copy[pkgId] = clean;
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

  const handleClearPkg = useCallback((pkgId: string) => {
    setCart((prev) => {
      if (!prev[pkgId]) return prev;
      const copy = { ...prev };
      delete copy[pkgId];
      return copy;
    });
  }, []);

  const handleOpenEdit = useCallback((pkg: PackageDoc) => {
    setEditingPkg(pkg);
    setEditPkgData(pkg.dataLabel);
    setEditPkgHours(pkg.hoursLabel);
    setEditPkgValidity(pkg.validityLabel);
  }, []);

  const handleQuickSingleSale = useCallback(
    async (pkg: PackageDoc) => {
      if ((pkg?.availableCount ?? 0) <= 0) {
        notifyWarning(
          'الرصيد غير متوفر لهذه الباقة',
          `لا توجد كروت متاحة حالياً في مخزون باقة ${pkg?.price ?? 0} ريال — اضغط «تحديث مخزوني» أو اطلب تغذية.`
        );
        return;
      }
      const { cart: curCart, buyerName: curName, buyerPhone: curPhone } = latestRef.current;
      const qty = curCart[pkg.id] || 1;
      setSubmitting(true);
      try {
        const sale = await executeSaleTransaction({
          saleType: 'direct',
          buyerName: curName.trim() || 'زبون مباشر',
          buyerPhone: curPhone.trim(),
          buyerRole: 'consumer',
          paymentMethod: 'cash',
          discountRate: 100,
          paidAmount: (pkg.price ?? 0) * qty,
          items: [{ packageId: pkg.id, quantity: qty, deliverNow: qty }],
        });
        if (sale) {
          setCompletedSale(sale);
          setCart((prev) => {
            if (!prev[pkg.id]) return prev;
            const copy = { ...prev };
            delete copy[pkg.id];
            return copy;
          });
        }
      } finally {
        setSubmitting(false);
      }
    },
    [executeSaleTransaction, notifyWarning]
  );

  const handleConfirmMultiBatch = useCallback(async () => {
    if (selectedItems.length === 0) return;
    setSubmitting(true);
    try {
      const { buyerName: curName, buyerPhone: curPhone } = latestRef.current;
      const sale = await executeSaleTransaction({
        saleType: 'direct',
        buyerName: curName.trim() || 'زبون مباشر',
        buyerPhone: curPhone.trim(),
        buyerRole: 'consumer',
        paymentMethod: 'cash',
        discountRate: 100,
        paidAmount: selectedTotalAmount,
        items: selectedItems.map((x) => ({
          packageId: x.pkg.id,
          quantity: x.qty,
          deliverNow: x.qty,
        })),
      });
      if (sale) {
        setCompletedSale(sale);
        setCart({});
      }
    } finally {
      setSubmitting(false);
    }
  }, [executeSaleTransaction, selectedItems, selectedTotalAmount]);

  const buildUnifiedDirectMessage = (
    sale: SaleDoc,
    channel: 'default' | 'sms' | 'whatsapp' = 'default'
  ): string => {
    const items = sale.items || [];
    const formattedDate = formatDateTimeAr(sale.createdAt);
    const invoiceNum = sale.invoiceNumber || sale.id.slice(-6);
    const rawTpl =
      channel === 'sms'
        ? appSettings.smsMessageTemplate || appSettings.directSaleMessageTemplate
        : channel === 'whatsapp'
          ? appSettings.whatsappMessageTemplate || appSettings.directSaleMessageTemplate
          : appSettings.directSaleMessageTemplate || appSettings.whatsappMessageTemplate;
    const tpl = resolveDirectSaleTemplate(rawTpl);

    const resolveItemMeta = (item: (typeof items)[number]) => {
      const pkgMeta =
        displayPackages.find((p) => p.id === item.packageId) ||
        EXCLUSIVE_PACKAGES.find((p) => p.id === item.packageId);
      const dataSize = pkgMeta?.dataLabel || item.packageLabel;
      const unitPrice = item.unitPrice || item.price;
      return {
        packageName: dataSize,
        priceLabel: `${formatNumEn(unitPrice)} ريال`,
        balanceLabel: formatPackageBalanceFull(dataSize),
      };
    };

    if (items.length === 1 && items[0].cardNumbers.length === 1) {
      const meta = resolveItemMeta(items[0]);
      return applyMessageTemplate(tpl, {
        package: meta.packageName,
        price: meta.priceLabel,
        card: items[0].cardNumbers[0],
        balance: meta.balanceLabel,
        buyer: sale.buyerName,
        total: `${formatNumEn(sale.totalAmount)} ريال`,
        invoice: invoiceNum,
        date: formattedDate,
      });
    }

    const blocks: string[] = [];
    for (const item of items) {
      const meta = resolveItemMeta(item);
      if (item.cardNumbers.length === 1) {
        blocks.push(
          applyMessageTemplate(tpl, {
            package: meta.packageName,
            price: meta.priceLabel,
            card: item.cardNumbers[0],
            balance: meta.balanceLabel,
            buyer: sale.buyerName,
            total: `${formatNumEn(sale.totalAmount)} ريال`,
            invoice: invoiceNum,
            date: formattedDate,
          })
        );
      } else if (item.cardNumbers.length > 1) {
        blocks.push(
          [
            '*شبكة طيبة نت اللاسلكية*',
            '-------------------------',
            `الباقة: ${meta.packageName}`,
            `السعر: ${meta.priceLabel} (العدد: ${formatNumEn(item.cardNumbers.length)})`,
            `الرصيد: ${meta.balanceLabel}`,
            'رموز الدخول:',
            ...item.cardNumbers.map((num, idx) => `${idx + 1}. ${num}`),
            '-------------------------',
            'نتمنى لكم تصفحاً ممتعاً!',
          ].join('\n')
        );
      }
    }

    if (blocks.length > 0) {
      return blocks.join('\n\n');
    }

    return [
      '*شبكة طيبة نت اللاسلكية*',
      '-------------------------',
      `الإجمالي: ${formatNumEn(sale.totalAmount)} ريال (${formatNumEn(sale.totalCards)} كرت)`,
      '-------------------------',
      'نتمنى لكم تصفحاً ممتعاً!',
    ].join('\n');
  };

  const buildDirectPrintable = (sale: SaleDoc): PrintableDocumentPayload => {
    const breakdown = buildSingleSaleBreakdown(sale, appSettings);
    return {
      title: 'فاتورة بيع مباشر للمستهلك',
      subtitle: `رقم الفاتورة: ${sale.invoiceNumber || sale.id.slice(-6)}`,
      metaRows: [
        { label: 'اسم الزبون', value: sale.buyerName },
        {
          label: 'نوع المشتري / التسعير',
          value: `${getBuyerRoleArabicLabel(sale.buyerRole, sale.saleType)} — ${getBuyerPriceTierLabel(sale.buyerRole, sale.saleType, sale.discountRate)}`,
        },
        { label: 'رقم الهاتف', value: sale.buyerPhone || 'مباشر' },
        { label: 'التاريخ', value: formatDateTimeAr(sale.createdAt) },
      ],
      tableHeaders: ['الفئة / الباقة', 'العدد', 'سعر الفئة', 'تفصيل الحساب (العدد × السعر = الإجمالي)'],
      tableRows: (sale.items || []).map((i) => {
        const unit = i.unitPrice || i.price;
        return [
          i.packageLabel,
          formatNumEn(i.quantity),
          `${formatNumEn(unit)} ر.ي`,
          formatDenominationFormula(i.quantity, unit, unit * i.quantity),
        ];
      }),
      breakdownTitle: 'تفصيل الفئات المباعة (العدد × سعر الفئة = الإجمالي)',
      breakdownItems: toPrintableBreakdownItems(breakdown),
      summaryRows: [
        { label: 'إجمالي الكروت', value: `${formatNumEn(sale.totalCards)} كرت` },
        { label: 'الإجمالي المدفوع نقداً', value: `${formatNumEn(sale.totalAmount)} ر.ي`, highlight: true },
      ],
      extraSectionTitle: 'أرقام الكروت المسحوبة',
      extraLines: sale.cardNumbers || [],
      fileName: `بيع_مباشر_${sale.invoiceNumber || sale.id.slice(-6)}`,
      sharePhone: sale.buyerPhone,
      shareText: buildUnifiedDirectMessage(sale),
    };
  };

  return (
    <div className="space-y-3 safe-bottom-clear">
      {/* Top Direct Sale Action Bar */}
      <div className="royal-header-3d rounded-3xl border-2 border-[#D4AF37] p-3 shadow-lg space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/15 border-2 border-[#D4AF37] flex items-center justify-center text-[#FDE68A] shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-extrabold text-white truncate">
                البيع المباشر للمستهلك (100%)
              </h2>
              <p className="text-[11px] font-bold text-[#FDE68A] tabular-nums">
                الكروت المتاحة: {formatCount(totalAvailableCards, hideNumbers)} كرت
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isRefreshingInventory}
            onClick={() => void refreshMyInventory(true)}
            className="min-h-[38px] px-3 rounded-xl gold-btn-3d border-2 border-[#92400E] text-[#0F172A] text-xs font-extrabold flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-65"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingInventory ? 'animate-spin' : ''}`} />
            <span>{isRefreshingInventory ? 'جاري التحديث...' : 'تحديث مخزوني'}</span>
          </button>
        </div>

        {/* Admin Message Template Editor Button */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              setTemplateText(resolveDirectSaleTemplate(appSettings.directSaleMessageTemplate));
              setShowTemplateModal(true);
            }}
            className="w-full min-h-[36px] rounded-xl bg-white/15 hover:bg-white/25 border border-[#D4AF37]/80 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
          >
            <Settings2 className="w-3.5 h-3.5 text-[#FDE68A]" />
            <span>تحرير صيغة رسالة البيع المباشر</span>
          </button>
        )}
      </div>

      {/* Optional Buyer Quick Bar with Full Official Phonebook Contact Picker */}
      <div className="royal-card-frame rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          value={buyerName}
          onChange={(e) => setBuyerName(e.target.value)}
          placeholder="اسم الزبون (اختياري — افتراضي: زبون مباشر)"
          className="min-h-[40px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold text-slate-900 dark:text-white shadow-xs focus:border-[#D4AF37] focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            dir="ltr"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            data-lpignore="true"
            data-form-type="other"
            value={buyerPhone}
            onChange={(e) => setBuyerPhone(e.target.value)}
            onBlur={(e) => setBuyerPhone(normalizeDigits(e.currentTarget.value).replace(/[^\d+]/g, ''))}
            placeholder="رقم هاتف الزبون لإرسال الكرت..."
            className="flex-1 min-h-[40px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold text-slate-900 dark:text-white tabular-nums text-right shadow-xs focus:border-[#D4AF37] focus:outline-none"
          />
          <ContactPickerButton
            title="فتح سجل أسماء الهاتف الرسمي"
            onSelect={(c) => {
              if (c.name) setBuyerName(c.name);
              if (c.phone) setBuyerPhone(normalizeDigits(c.phone));
            }}
          />
        </div>
      </div>

      {/* Unified 8 Color-Coded Exclusive Package Cards */}
      <div className="grid grid-cols-2 gap-2">
        {(displayPackages || []).map((pkg) => {
          const qty = cart[pkg.id] || 0;
          return (
            <PackageCardTile
              key={pkg.id}
              pkg={pkg}
              qty={qty}
              hideNumbers={hideNumbers}
              showStock
              confirmVariant="royal"
              confirmLabel={qty > 1 ? `تأكيد البيع (${qty})` : 'تأكيد البيع'}
              disabledConfirm={submitting}
              canEdit={isAdmin}
              onIncrement={handleIncrement}
              onDecrement={handleDecrement}
              onSetQty={setQtyDirect}
              onConfirm={handleQuickSingleSale}
              onEdit={handleOpenEdit}
              onClearOrDelete={handleClearPkg}
              onRequestTopup={!isAdmin ? openTopupForPackage : undefined}
            />
          );
        })}
      </div>

      {/* NORMAL-FLOW VERTICAL BATCH SUMMARY CARD — Directly below the 8th package (3000 YER) */}
      {selectedPackagesCount > 0 && (
        <div className="w-full !mt-[16px] !mb-[28px]">
          <div className="rounded-2xl royal-header-3d border-2 border-[#D4AF37] p-[14px] shadow-2xl flex flex-col gap-[12px]">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs sm:text-sm font-extrabold text-white tabular-nums leading-snug min-w-0">
                <span className="text-[#FDE68A]">
                  {selectedPackagesCount} باقات • {selectedTotalCards} كرت
                </span>
                <span className="mx-1.5 text-[#D4AF37]">|</span>
                <span>الإجمالي: {formatYER(selectedTotalAmount, hideNumbers)}</span>
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

            <button
              type="button"
              disabled={submitting}
              onClick={handleConfirmMultiBatch}
              className="w-full min-h-[44px] px-4 rounded-xl gold-btn-3d border-2 border-[#92400E] text-[#0F172A] text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <ShoppingCart className="w-4 h-4 shrink-0" />
              <span>تأكيد وإرسال الدفعة المحددة</span>
            </button>
          </div>
        </div>
      )}

      {/* POST-SALE UNIFIED MESSAGE & INVOICE MODAL */}
      {completedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 safe-top safe-bottom overflow-y-auto">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto">
            <div className="royal-header-3d px-4 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-extrabold text-white">تفاصيل الكرت والبيع المباشر</h3>
                  <p className="text-[11px] font-bold text-[#FDE68A]">
                    فاتورة {completedSale.invoiceNumber} · {completedSale.totalCards} كرت
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
              <div className="rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border-2 border-[#D4AF37]/75 p-2.5 space-y-1">
                <div className="text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                  تفصيل الفئات المباعة (سعر الزبون 100%):
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

              <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 p-3 text-xs font-bold whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                {buildUnifiedDirectMessage(completedSale)}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    openWhatsAppShare(
                      completedSale.buyerPhone,
                      buildUnifiedDirectMessage(completedSale, 'whatsapp')
                    );
                    notifySuccess('تم فتح واتساب لإرسال الكروت');
                  }}
                  className="min-h-[42px] rounded-xl bg-emerald-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  إرسال واتساب
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openSmsShare(
                      completedSale.buyerPhone,
                      buildUnifiedDirectMessage(completedSale, 'sms')
                    );
                    notifySuccess('تم فتح SMS لإرسال الكروت');
                  }}
                  className="min-h-[42px] rounded-xl bg-blue-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <MessageSquare className="w-4 h-4" />
                  إرسال SMS
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(buildUnifiedDirectMessage(completedSale));
                    notifySuccess('تم نسخ الرسالة وأرقام الكروت');
                  }}
                  className="min-h-[40px] rounded-xl bg-slate-100 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-4 h-4" />
                  نسخ الرسالة
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await exportAsHDImage(buildDirectPrintable(completedSale));
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
                      const res = await exportAsArabicPDF(buildDirectPrintable(completedSale));
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
                  onClick={() => void printRoyalDocument(buildDirectPrintable(completedSale))}
                  className="min-h-[40px] rounded-xl bg-[#1A365D] border border-[#D4AF37] text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <Printer className="w-4 h-4 text-[#FDE68A]" />
                  طباعة
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MESSAGE TEMPLATE EDITOR MODAL */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                تحرير صيغة رسالة البيع المباشر
              </h3>
              <button
                type="button"
                onClick={() => setShowTemplateModal(false)}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] font-bold text-slate-500">
              المتغيرات المتاحة: {'{package}'} للباقة، {'{price}'} للسعر، {'{card}'} لرمز الدخول، و {'{balance}'} للرصيد.
            </p>
            <textarea
              rows={5}
              value={templateText}
              onChange={(e) => setTemplateText(e.target.value)}
              className="w-full rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                if (isAdmin) {
                  await updateAppSettings({ directSaleMessageTemplate: templateText });
                } else {
                  notifySuccess('تم تحديث صيغة الرسالة للجلسة الحالية');
                }
                setShowTemplateModal(false);
              }}
              className="w-full min-h-[44px] royal-btn-3d border-2 border-[#D4AF37] text-white text-sm font-extrabold rounded-xl flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4 text-[#FDE68A]" />
              حفظ صيغة الرسالة
            </button>
          </div>
        </div>
      )}

      {/* ADMIN QUICK EDIT PACKAGE MODAL */}
      {editingPkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await updatePackageInfo(editingPkg.id, {
                dataLabel: editPkgData.trim(),
                hoursLabel: editPkgHours.trim(),
                validityLabel: editPkgValidity.trim(),
              });
              setEditingPkg(null);
            }}
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold">تعديل باقة {editingPkg.price} ر.ي</h3>
              <button type="button" onClick={() => setEditingPkg(null)} className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-extrabold mb-1">السعة (مثال: 400 ميجا)</label>
              <input
                type="text"
                inputMode="text"
                required
                value={editPkgData}
                onChange={(e) => setEditPkgData(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold mb-1">الساعات</label>
              <input
                type="text"
                inputMode="text"
                required
                value={editPkgHours}
                onChange={(e) => setEditPkgHours(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold mb-1">الصلاحية</label>
              <input
                type="text"
                inputMode="text"
                required
                value={editPkgValidity}
                onChange={(e) => setEditPkgValidity(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
              />
            </div>
            <button type="submit" className="w-full min-h-[44px] royal-btn-3d border-2 border-[#D4AF37] text-white text-sm font-extrabold rounded-xl">
              حفظ تعديل الباقة
            </button>
          </form>
        </div>
      )}

      <ExportPreviewModal result={exportPreview} onClose={() => setExportPreview(null)} />
    </div>
  );
};
