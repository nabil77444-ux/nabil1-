import React, { useEffect, useState } from 'react';
import { Coins, Edit3, Gift, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { formatCount, getPackageThemeStyle, type PackageDoc } from '../types/taibah';
import { normalizeDigits } from '../lib/firebase';

interface PackageCardTileProps {
  pkg: PackageDoc;
  qty: number;
  hideNumbers: boolean;
  /** Optional net unit price shown when selling wholesale with discount */
  effectiveUnitPrice?: number;
  /** Show stock badge (true for Direct Sale & Electronic Wholesale; optional for Paper) */
  showStock?: boolean;
  /** Compact density for Electronic Wholesale & Paper Invoices */
  compact?: boolean;
  /** Primary confirm button label (defaults to "تأكيد البيع") */
  confirmLabel?: string;
  /** Button color theme: 'royal' (vivid deep royal navy + gold border) or 'emerald' */
  confirmVariant?: 'royal' | 'emerald';
  disabledConfirm?: boolean;
  canEdit?: boolean;
  onIncrement: (pkgId: string) => void;
  onDecrement: (pkgId: string) => void;
  onSetQty?: (pkgId: string, nextQty: number) => void;
  onConfirm: (pkg: PackageDoc) => void;
  onEdit?: (pkg: PackageDoc) => void;
  onClearOrDelete: (pkgId: string) => void;
  clearLabel?: string;
  /** Optional quick feeding shortcut shown to Agents & Clients when package stock is low (<10) */
  onRequestTopup?: (pkgId: string) => void;
}

/**
 * Unified 8-Package Card Tile
 * - Vivid true-color Royal Navy + Gold "تأكيد البيع" button (never washed out or grayed!)
 * - Exact unified 8 denomination color themes across Direct Sale, Electronic Wholesale, and Paper Invoices
 * - Compact mode for wholesale screens to show more packages clearly
 * - Local draft input state + inputMode="numeric" for instantaneous keyboard response
 */
export const PackageCardTile: React.FC<PackageCardTileProps> = React.memo(
  ({
    pkg,
    qty,
    hideNumbers,
    effectiveUnitPrice,
    showStock = true,
    compact = false,
    confirmLabel = 'تأكيد البيع',
    confirmVariant = 'royal',
    disabledConfirm = false,
    canEdit = false,
    onIncrement,
    onDecrement,
    onSetQty,
    onConfirm,
    onEdit,
    onClearOrDelete,
    clearLabel = 'حذف',
    onRequestTopup,
  }) => {
    const safePrice = Number(pkg?.price ?? 0);
    const safeAvail = Number(pkg?.availableCount ?? 0);
    const safeQty = Number(qty ?? 0);
    const theme = getPackageThemeStyle(safePrice);
    const displayPrice = Number(effectiveUnitPrice ?? safePrice);
    const stockZero = safeAvail <= 0;
    const stockLow = safeAvail > 0 && safeAvail < 10;

    // Lightweight local draft state keeps typing & keyboard focus instant with zero lag
    const [draftQty, setDraftQty] = useState<string>(safeQty === 0 ? '' : String(safeQty));

    useEffect(() => {
      const target = safeQty === 0 ? '' : String(safeQty);
      setDraftQty((prev) => (prev === target ? prev : target));
    }, [safeQty]);

    return (
      <div
        className={`royal-card-frame rounded-2xl border-2 ${theme.border} ${theme.cardBg} ${
          compact ? 'p-1.5 gap-1' : 'p-1.5 sm:p-2 gap-1.5'
        } flex flex-col justify-between transition-transform ${
          safeQty > 0 ? 'ring-2 ring-[#D4AF37]' : ''
        }`}
      >
        {/* Top Row: Compact 3D Colored Price Pill Capsule + Gift Corner Icon */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex-1 flex justify-center min-w-0">
            <div
              className={`w-full ${compact ? 'max-w-[106px] py-0.5 px-1.5' : 'max-w-[120px] py-0.5 px-2'} rounded-full ${theme.capsuleBg} border border-[#D4AF37]/85 text-white shadow-sm flex items-center justify-center gap-1`}
            >
              <Coins className={`${compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-[#FDE68A] shrink-0`} />
              <span
                className={`${
                  compact ? 'text-[10.5px] sm:text-[11.5px]' : 'text-[11px] sm:text-[12.5px]'
                } font-extrabold tabular-nums whitespace-nowrap`}
              >
                {hideNumbers ? '•••' : `${safePrice} ريال`}
              </span>
            </div>
          </div>
          <Gift className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0 ${theme.giftColor}`} />
        </div>

        {/* Title Row: باقة X ريال + Smart Low-Stock Badge */}
        <div className="flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5 px-0.5">
          <span
            className={`${
              compact ? 'text-[10px] sm:text-[11px]' : 'text-[10.5px] sm:text-xs'
            } font-extrabold text-slate-900 dark:text-white leading-tight whitespace-nowrap`}
          >
            باقة {hideNumbers ? '•••' : safePrice} ريال
          </span>
          {showStock && (
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded-full ${
                compact ? 'text-[8.5px] sm:text-[9.5px]' : 'text-[9px] sm:text-[10px]'
              } font-extrabold border-[1.5px] tabular-nums whitespace-nowrap leading-none ${
                stockZero
                  ? 'bg-red-50 dark:bg-red-950/80 border-red-500 text-red-700 dark:text-red-300'
                  : stockLow
                    ? 'bg-amber-50 dark:bg-amber-950/80 border-amber-500 text-amber-800 dark:text-amber-300'
                    : 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-600 text-emerald-800 dark:text-emerald-300'
              }`}
            >
              {stockZero
                ? 'نفد: 0'
                : stockLow
                  ? `منخفض: ${formatCount(safeAvail, hideNumbers)}`
                  : `المتاح: ${formatCount(safeAvail, hideNumbers)}`}
            </span>
          )}
        </div>

        {/* Quick Feeding Shortcut for Agents & Clients when package stock < 10 */}
        {showStock && (stockZero || stockLow) && onRequestTopup && (
          <button
            type="button"
            onClick={() => onRequestTopup(pkg.id)}
            className={`w-full py-0.5 px-2 rounded-lg text-[9.5px] font-extrabold border flex items-center justify-center gap-1 transition-colors ${
              stockZero
                ? 'bg-red-600 hover:bg-red-700 border-red-700 text-white'
                : 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 border-amber-500 text-amber-900 dark:text-amber-200'
            }`}
          >
            <span>+ اطلب تغذية لهذه الباقة</span>
          </button>
        )}

        {/* Clean White Inner Box: 2×2 Grid with crisp colored borders */}
        <div
          className={`rounded-xl bg-white dark:bg-slate-900/95 ${
            compact ? 'p-0.5' : 'p-1'
          } shadow-inner border-2 border-[#1A365D]/45 dark:border-[#D4AF37]/55`}
        >
          <div className={`grid grid-cols-2 ${compact ? 'gap-0.5' : 'gap-1'} text-center`}>
            <div className="rounded-lg border-[1.5px] border-[#1A365D]/30 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/90 py-0.5 px-1">
              <div className="text-[8px] font-bold text-slate-600 dark:text-slate-300 leading-tight">
                السعر
              </div>
              <div
                className={`${
                  compact ? 'text-[9.5px] sm:text-[10.5px]' : 'text-[10.5px] sm:text-[11.5px]'
                } font-extrabold text-slate-900 dark:text-white tabular-nums whitespace-nowrap leading-snug`}
              >
                {hideNumbers ? '•••' : `${displayPrice} ريال`}
              </div>
            </div>

            <div className="rounded-lg border-[1.5px] border-blue-600/35 dark:border-blue-500/45 bg-blue-50/40 dark:bg-slate-800/90 py-0.5 px-1">
              <div className="text-[8px] font-bold text-slate-600 dark:text-slate-300 leading-tight">
                الرصيد
              </div>
              <div
                className={`${
                  compact ? 'text-[9.5px] sm:text-[10.5px]' : 'text-[10.5px] sm:text-[11.5px]'
                } font-extrabold text-blue-700 dark:text-blue-300 whitespace-nowrap leading-snug`}
              >
                {pkg?.dataLabel || '—'}
              </div>
            </div>

            <div className="rounded-lg border-[1.5px] border-[#1A365D]/30 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/90 py-0.5 px-1">
              <div className="text-[8px] font-bold text-slate-600 dark:text-slate-300 leading-tight">
                الساعات
              </div>
              <div
                className={`${
                  compact ? 'text-[9.5px] sm:text-[10.5px]' : 'text-[10.5px] sm:text-[11.5px]'
                } font-extrabold text-slate-900 dark:text-white whitespace-nowrap leading-snug`}
              >
                {pkg?.hoursLabel || '—'}
              </div>
            </div>

            <div className="rounded-lg border-[1.5px] border-emerald-600/35 dark:border-emerald-500/45 bg-emerald-50/40 dark:bg-slate-800/90 py-0.5 px-1">
              <div className="text-[8px] font-bold text-slate-600 dark:text-slate-300 leading-tight">
                الصلاحية
              </div>
              <div
                className={`${
                  compact ? 'text-[9.5px] sm:text-[10.5px]' : 'text-[10.5px] sm:text-[11.5px]'
                } font-extrabold text-emerald-700 dark:text-emerald-400 whitespace-nowrap leading-snug`}
              >
                {pkg?.validityLabel || '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Crisp Rounded-Full Quantity Stepper (Instant Keyboard Focus + Auto-hidden 0) */}
        <div
          className={`rounded-full bg-white dark:bg-slate-900 border-2 border-[#1A365D]/65 dark:border-[#D4AF37]/75 ${
            compact ? 'px-1 py-0.5' : 'px-1 py-0.5'
          } flex items-center justify-between shadow-xs`}
        >
          <button
            type="button"
            onClick={() => onIncrement(pkg.id)}
            aria-label="زيادة الكمية"
            className={`${
              compact ? 'w-5 h-5' : 'w-6 h-6'
            } rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center active:scale-95 transition-transform shrink-0 shadow-xs`}
          >
            <Plus className="w-3 h-3" />
          </button>

          {onSetQty ? (
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              dir="ltr"
              enterKeyHint="done"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              data-lpignore="true"
              data-form-type="other"
              value={draftQty}
              placeholder="0"
              onChange={(e) => {
                const digitsOnly = normalizeDigits(e.target.value).replace(/[^\d]/g, '').slice(0, 5);
                setDraftQty(digitsOnly);
                const parsed = digitsOnly ? Number.parseInt(digitsOnly, 10) : 0;
                onSetQty(pkg.id, Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
              }}
              aria-label="الكمية"
              className={`${
                compact ? 'w-10 text-[11px]' : 'w-11 text-xs'
              } text-center bg-transparent font-extrabold text-slate-900 dark:text-white placeholder:text-slate-400 tabular-nums focus:outline-none`}
            />
          ) : (
            <span className="text-xs font-extrabold text-slate-900 dark:text-white tabular-nums px-1.5">
              {safeQty}
            </span>
          )}

          <button
            type="button"
            onClick={() => onDecrement(pkg.id)}
            disabled={safeQty === 0}
            aria-label="إنقاص الكمية"
            className={`${
              compact ? 'w-5 h-5' : 'w-6 h-6'
            } rounded-full bg-slate-200 dark:bg-slate-700 border border-slate-400/70 dark:border-slate-500 text-slate-800 dark:text-slate-100 flex items-center justify-center disabled:opacity-45 active:scale-95 transition-transform shrink-0`}
          >
            <Minus className="w-3 h-3" />
          </button>
        </div>

        {/* Confirm Button: ALWAYS VIVID TRUE ROYAL NAVY + GOLD BORDER (ZERO FADED GRAY WASHOUT!) */}
        <button
          type="button"
          disabled={disabledConfirm}
          onClick={() => onConfirm(pkg)}
          className={
            confirmVariant === 'royal'
              ? `w-full ${
                  compact ? 'min-h-[30px] text-[10.5px]' : 'min-h-[34px] text-[11px] sm:text-xs'
                } rounded-full bg-gradient-to-b from-[#1E3A8A] via-[#1A365D] to-[#0F172A] hover:from-[#2547A6] hover:to-[#0B1220] border-2 border-[#D4AF37] text-white font-extrabold shadow-md active:scale-[0.98] transition-transform disabled:opacity-80 flex items-center justify-center gap-1 px-2`
              : `w-full ${
                  compact ? 'min-h-[30px] text-[10.5px]' : 'min-h-[34px] text-[11px] sm:text-xs'
                } rounded-full bg-gradient-to-b from-emerald-600 to-emerald-800 hover:from-emerald-700 hover:to-emerald-900 border-2 border-[#D4AF37] text-white font-extrabold shadow-md active:scale-[0.98] transition-transform disabled:opacity-80 flex items-center justify-center gap-1 px-2`
          }
        >
          <ShoppingCart
            className={`${compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} shrink-0 text-[#FDE68A]`}
          />
          <span className="whitespace-nowrap">{confirmLabel}</span>
        </button>

        {/* Bottom 2 Rounded-Full Pills: Edit & Delete/Clear */}
        {!compact && (
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              disabled={!canEdit || !onEdit}
              onClick={() => onEdit?.(pkg)}
              className="min-h-[27px] rounded-full bg-white dark:bg-slate-900 border-2 border-blue-600/90 text-blue-700 dark:text-blue-300 text-[10.5px] font-extrabold flex items-center justify-center gap-1 disabled:opacity-45 active:scale-95 transition-transform"
            >
              <Edit3 className="w-2.5 h-2.5 shrink-0" />
              <span>تعديل</span>
            </button>
            <button
              type="button"
              onClick={() => onClearOrDelete(pkg.id)}
              className="min-h-[27px] rounded-full bg-white dark:bg-slate-900 border-2 border-red-600/90 text-red-600 dark:text-red-400 text-[10.5px] font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-transform"
            >
              <Trash2 className="w-2.5 h-2.5 shrink-0" />
              <span>{clearLabel}</span>
            </button>
          </div>
        )}
      </div>
    );
  }
);

PackageCardTile.displayName = 'PackageCardTile';
