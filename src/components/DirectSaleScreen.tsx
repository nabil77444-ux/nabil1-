import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  FileDown,
  Fingerprint,
  ImageDown,
  MessageSquare,
  Printer,
  RotateCcw,
  Save,
  Send,
  Settings2,
  ShoppingCart,
  X,
  Zap,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import { verifyDeviceBiometric } from '../lib/biometric';
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
  formatYER,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type PackageDoc,
  type SaleDoc,
} from '../types/taibah';

interface DirectSaleScreenProps {
  hideNumbers: boolean;
}

export const DirectSaleScreen: React.FC<DirectSaleScreenProps> = ({ hideNumbers }) => {
  const {
    profile,
    packages,
    sales,
    totalAvailableCards,
    appSettings,
    executeSaleTransaction,
    processSaleReturn,
    updateAppSettings,
    updatePackageInfo,
  } = useFirebase();
  const { notifySuccess, notifyWarning, notifyError } = useFeedback();

  const displayPackages = packages.length > 0 ? packages : (EXCLUSIVE_PACKAGES as PackageDoc[]);
  const isAdmin = profile?.role === 'super_admin';

  // Consumer details
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');

  // Multi-package cart counts
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  // Modals
  const [completedSale, setCompletedSale] = useState<SaleDoc | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportShareResult | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateText, setTemplateText] = useState(appSettings.directSaleMessageTemplate);
  const [showReturnsModal, setShowReturnsModal] = useState(false);
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

  const recentDirectSales = useMemo(
    () => sales.filter((s) => s.saleType === 'direct').slice(0, 15),
    [sales]
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

  const handleQuickSingleSale = async (pkg: PackageDoc) => {
    const qty = cart[pkg.id] || 1;
    setSubmitting(true);
    try {
      const sale = await executeSaleTransaction({
        saleType: 'direct',
        buyerName: buyerName.trim() || 'زبون مباشر',
        buyerPhone: buyerPhone.trim(),
        buyerRole: 'consumer',
        paymentMethod: 'cash',
        discountRate: 100,
        paidAmount: pkg.price * qty,
        items: [{ packageId: pkg.id, quantity: qty, deliverNow: qty }],
      });
      if (sale) {
        setCompletedSale(sale);
        setCart((prev) => {
          const copy = { ...prev };
          delete copy[pkg.id];
          return copy;
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmMultiBatch = async () => {
    if (selectedItems.length === 0) return;
    setSubmitting(true);
    try {
      const sale = await executeSaleTransaction({
        saleType: 'direct',
        buyerName: buyerName.trim() || 'زبون مباشر',
        buyerPhone: buyerPhone.trim(),
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
  };

  const buildUnifiedDirectMessage = (
    sale: SaleDoc,
    channel: 'default' | 'sms' | 'whatsapp' = 'default'
  ): string => {
    const items = sale.items || [];
    const formattedDate = formatDateTimeAr(sale.createdAt);
    const invoiceNum = sale.invoiceNumber || sale.id.slice(-6);
    if (items.length === 1 && items[0].cardNumbers.length === 1) {
      const tpl =
        channel === 'sms'
          ? appSettings.smsMessageTemplate || appSettings.directSaleMessageTemplate || ''
          : channel === 'whatsapp'
            ? appSettings.whatsappMessageTemplate || appSettings.directSaleMessageTemplate || ''
            : appSettings.directSaleMessageTemplate || appSettings.whatsappMessageTemplate || '';
      return applyMessageTemplate(tpl, {
        package: items[0].packageLabel,
        card: items[0].cardNumbers[0],
        buyer: sale.buyerName,
        total: `${sale.totalAmount} ر.ي`,
        invoice: invoiceNum,
        date: formattedDate,
      });
    }
    const lines = [
      `📶 شبكة طيبة نت اللاسلكية (TAIBAH NET)`,
      `🧾 فاتورة بيع مباشر #${invoiceNum}`,
      `📅 التاريخ: ${formattedDate}`,
      `👤 الزبون: ${sale.buyerName}`,
      `────────────────────`,
    ];
    for (const item of items) {
      lines.push(`🔹 ${item.packageLabel} (العدد: ${item.quantity} | ${item.unitPrice * item.quantity} ر.ي)`);
      item.cardNumbers.forEach((num, idx) => {
        lines.push(`   ${idx + 1}. ${num}`);
      });
    }
    lines.push(`────────────────────`);
    lines.push(`💰 الإجمالي: ${sale.totalAmount} ر.ي (${sale.totalCards} كرت)`);
    lines.push(`📞 ${SUPER_ADMIN_CONFIG.developerCredit}`);
    return lines.join('\n');
  };

  const buildDirectPrintable = (sale: SaleDoc): PrintableDocumentPayload => ({
    title: 'فاتورة بيع مباشر للمستهلك',
    subtitle: `رقم الفاتورة: ${sale.invoiceNumber || sale.id.slice(-6)}`,
    metaRows: [
      { label: 'اسم الزبون', value: sale.buyerName },
      { label: 'رقم الهاتف', value: sale.buyerPhone || 'مباشر' },
      { label: 'التاريخ', value: formatDateTimeAr(sale.createdAt) },
      { label: 'عدد الكروت', value: `${sale.totalCards} كرت` },
    ],
    tableHeaders: ['الباقة', 'الكمية', 'سعر الكرت', 'الإجمالي'],
    tableRows: (sale.items || []).map((i) => [
      i.packageLabel,
      String(i.quantity),
      `${i.unitPrice} ر.ي`,
      `${i.unitPrice * i.quantity} ر.ي`,
    ]),
    summaryRows: [{ label: 'الإجمالي المدفوع نقداً', value: `${sale.totalAmount} ر.ي`, highlight: true }],
    extraSectionTitle: 'أرقام الكروت المسحوبة',
    extraLines: sale.cardNumbers || [],
    fileName: `بيع_مباشر_${sale.invoiceNumber || sale.id.slice(-6)}`,
    sharePhone: sale.buyerPhone,
    shareText: buildUnifiedDirectMessage(sale),
  });

  return (
    <div className="space-y-3 pb-28 safe-bottom">
      {/* Top Direct Sale Action Bar */}
      <div className="royal-header-3d rounded-3xl border-2 border-[#D4AF37] p-3 shadow-lg space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-white/15 border border-[#D4AF37] flex items-center justify-center text-[#FDE68A]">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-white">البيع المباشر للمستهلك (100%)</h2>
              <p className="text-[11px] font-bold text-[#FDE68A] tabular-nums">
                الكروت المتاحة: {formatCount(totalAvailableCards, hideNumbers)} كرت
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={async () => {
              const res = await verifyDeviceBiometric();
              if (res.verified) {
                notifySuccess('تم التحقق البيومتري الفوري — جلسة البيع مؤمّنة ✅');
              } else {
                notifyWarning('فعّل البصمة من الإعدادات للتحقق السريع');
              }
            }}
            title="تحقق سريع بالبصمة"
            className="w-10 h-10 rounded-xl gold-btn-3d text-[#0F172A] flex items-center justify-center shrink-0"
          >
            <Fingerprint className="w-5 h-5" />
          </button>
        </div>

        {/* Utility Buttons Row */}
        <div className={`grid gap-2 ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <button
            type="button"
            onClick={() => setShowReturnsModal(true)}
            className="min-h-[38px] rounded-xl bg-white/15 hover:bg-white/25 border border-[#D4AF37]/70 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#FDE68A]" />
            <span>التسليم / المرتجعات</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setTemplateText(appSettings.directSaleMessageTemplate);
                setShowTemplateModal(true);
              }}
              className="min-h-[38px] rounded-xl bg-white/15 hover:bg-white/25 border border-[#D4AF37]/70 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
            >
              <Settings2 className="w-3.5 h-3.5 text-[#FDE68A]" />
              <span>تحرير صيغة الرسالة</span>
            </button>
          )}
        </div>
      </div>

      {/* Optional Buyer Quick Bar with Full Official Phonebook Contact Picker */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/75 p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 shadow-sm">
        <input
          type="text"
          value={buyerName}
          onChange={(e) => setBuyerName(e.target.value)}
          placeholder="اسم الزبون (اختياري — افتراضي: زبون مباشر)"
          className="min-h-[40px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <input
            type="tel"
            value={buyerPhone}
            onChange={(e) => setBuyerPhone(e.target.value)}
            placeholder="رقم هاتف الزبون لإرسال الكرت..."
            className="flex-1 min-h-[40px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-900 dark:text-white tabular-nums focus:border-[#D4AF37] focus:outline-none"
          />
          <ContactPickerButton
            title="اختر من سجل أسماء الهاتف الرسمي"
            onSelect={(c) => {
              if (c.name) setBuyerName(c.name);
              if (c.phone) setBuyerPhone(c.phone);
            }}
          />
        </div>
      </div>

      {/* Update 15: Unified 8 Color-Coded Exclusive Package Cards (2 columns, compact & zero clipping) */}
      <div className="grid grid-cols-2 gap-2">
        {displayPackages.map((pkg) => {
          const qty = cart[pkg.id] || 0;
          return (
            <PackageCardTile
              key={pkg.id}
              pkg={pkg}
              qty={qty}
              hideNumbers={hideNumbers}
              showStock
              confirmLabel={qty > 1 ? `تأكيد البيع (${qty})` : 'تأكيد البيع'}
              disabledConfirm={submitting || pkg.availableCount <= 0}
              canEdit={isAdmin}
              onIncrement={() => adjustQty(pkg.id, 1)}
              onDecrement={() => adjustQty(pkg.id, -1)}
              onConfirm={() => handleQuickSingleSale(pkg)}
              onEdit={() => {
                setEditingPkg(pkg);
                setEditPkgData(pkg.dataLabel);
                setEditPkgHours(pkg.hoursLabel);
                setEditPkgValidity(pkg.validityLabel);
              }}
              onClearOrDelete={() => {
                if (qty > 0) {
                  setCart((prev) => {
                    const copy = { ...prev };
                    delete copy[pkg.id];
                    return copy;
                  });
                }
              }}
            />
          );
        })}
      </div>

      {/* UPDATE 4: FLOATING BOTTOM MULTI-PACKAGE CONFIRMATION BAR (Safe Area Protected) */}
      {selectedPackagesCount > 0 && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] inset-x-3 z-40 max-w-2xl mx-auto">
          <div className="rounded-2xl royal-header-3d border-2 border-[#D4AF37] p-3 shadow-2xl flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-[#FDE68A] tabular-nums">
                {selectedPackagesCount} باقات · {selectedTotalCards} كرت
              </div>
              <div className="text-sm font-extrabold text-white tabular-nums">
                الإجمالي: {formatYER(selectedTotalAmount, hideNumbers)}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setCart({})}
                className="w-10 h-10 rounded-xl bg-white/15 text-white flex items-center justify-center"
                aria-label="مسح التحديد"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmMultiBatch}
                className="min-h-[44px] px-4 rounded-xl gold-btn-3d text-[#0F172A] text-xs sm:text-sm font-extrabold flex items-center gap-1.5"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>تأكيد وإرسال الدفعة المحددة ({selectedPackagesCount} باقات)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POST-SALE UNIFIED MESSAGE & INVOICE MODAL */}
      {completedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 safe-top safe-bottom overflow-y-auto">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto">
            <div className="royal-header-3d px-4 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-extrabold text-white">تم البيع المباشر بنجاح ✅</h3>
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
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-xs font-bold whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
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
                  className="min-h-[40px] rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-extrabold flex items-center justify-center gap-1.5"
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
                  className="min-h-[40px] rounded-xl bg-[#1A365D] text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
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
              استخدم المتغيرات {'{package}'} لاسم الباقة و {'{card}'} لرقم الكرت.
            </p>
            <textarea
              rows={5}
              value={templateText}
              onChange={(e) => setTemplateText(e.target.value)}
              className="w-full rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
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
              className="w-full min-h-[44px] royal-btn-3d text-white text-sm font-extrabold rounded-xl flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4 text-[#FDE68A]" />
              حفظ صيغة الرسالة
            </button>
          </div>
        </div>
      )}

      {/* DIRECT SALE RETURNS MODAL */}
      {showReturnsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 safe-top safe-bottom">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden max-h-[85dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-[#061124] border-2 border-[#D4AF37] p-0.5 flex items-center justify-center overflow-hidden shrink-0">
                  <img src={TAIBAH_ASSETS.logo} alt="طيبة نت" className="w-full h-full rounded-full object-contain" />
                </div>
                <h3 className="text-sm font-extrabold text-white">سجل التسليم والمرتجعات المباشرة</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowReturnsModal(false)}
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3.5 space-y-2">
              {recentDirectSales.length === 0 ? (
                <p className="text-center text-xs font-bold text-slate-500 py-6">
                  لا توجد مبيعات مباشرة مسجلة بعد (0)
                </p>
              ) : (
                recentDirectSales.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs font-extrabold">
                      <span>{s.buyerName} ({s.invoiceNumber})</span>
                      <span className="tabular-nums text-[#1A365D] dark:text-[#FDE68A]">
                        {formatYER(s.totalAmount)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(s.items || []).map((item) => (
                        <button
                          key={item.packageId}
                          type="button"
                          disabled={item.quantity - (item.returned || 0) <= 0}
                          onClick={() => processSaleReturn(s, item.packageId, 1)}
                          className="min-h-[32px] px-2.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 text-[11px] font-extrabold flex items-center gap-1 disabled:opacity-40"
                        >
                          <RotateCcw className="w-3 h-3" />
                          إرجاع 1 من {item.price} ر.ي
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADMIN QUICK EDIT PACKAGE MODAL */}
      {editingPkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
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
                required
                value={editPkgData}
                onChange={(e) => setEditPkgData(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold mb-1">الساعات</label>
              <input
                type="text"
                required
                value={editPkgHours}
                onChange={(e) => setEditPkgHours(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold mb-1">الصلاحية</label>
              <input
                type="text"
                required
                value={editPkgValidity}
                onChange={(e) => setEditPkgValidity(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
              />
            </div>
            <button type="submit" className="w-full min-h-[44px] royal-btn-3d text-white text-sm font-extrabold rounded-xl">
              حفظ تعديل الباقة
            </button>
          </form>
        </div>
      )}

      <ExportPreviewModal result={exportPreview} onClose={() => setExportPreview(null)} />
    </div>
  );
};
