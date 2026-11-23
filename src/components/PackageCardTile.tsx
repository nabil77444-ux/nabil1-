import React from 'react';
import { Coins, Edit3, Gift, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { formatCount, getPackageThemeStyle, type PackageDoc } from '../types/taibah';

interface PackageCardTileProps {
  pkg: PackageDoc;
  qty: number;
  hideNumbers: boolean;
  /** Optional net unit price shown when selling wholesale with discount */
  effectiveUnitPrice?: number;
  /** Show stock badge (true for Direct Sale & Electronic Wholesale; optional for Paper) */
  showStock?: boolean;
  /** Primary green button label (defaults to "تأكيد البيع") */
  confirmLabel?: string;
  disabledConfirm?: boolean;
  canEdit?: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onSetQty?: (nextQty: number) => void;
  onConfirm: () => void;
  onEdit?: () => void;
  onClearOrDelete: () => void;
  clearLabel?: string;
}

/**
 * Unified 8-Package Card Tile
 * Slightly compact, zero text clipping ("باقة 100 ريال" and "المتاح" always render 100% intact)
 * while strictly preserving the exact color palette, shapes, and high contrast.
 */
export const PackageCardTile: React.FC<PackageCardTileProps> = React.memo(
  ({
    pkg,
    qty,
    hideNumbers,
    effectiveUnitPrice,
    showStock = true,
    confirmLabel = 'تأكيد البيع',
    disabledConfirm = false,
    canEdit = false,
    onIncrement,
    onDecrement,
    onSetQty,
    onConfirm,
    onEdit,
    onClearOrDelete,
    clearLabel = 'حذف',
  }) => {
    const theme = getPackageThemeStyle(pkg.price);
    const displayPrice = effectiveUnitPrice ?? pkg.price;
    const stockZero = pkg.availableCount <= 0;

    return (
      <div
        className={`rounded-2xl border-2 ${theme.border} ${theme.cardBg} p-2 shadow-sm flex flex-col justify-between gap-1.5 transition-transform ${
          qty > 0 ? 'ring-2 ring-[#D4AF37]' : ''
        }`}
      >
        {/* Top Row: Compact 3D Colored Price Pill Capsule + Gift Corner Icon */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex-1 flex justify-center min-w-0">
            <div
              className={`w-full max-w-[126px] py-0.5 px-2 rounded-full ${theme.capsuleBg} text-white shadow-sm flex items-center justify-center gap-1`}
            >
              <Coins className="w-3 h-3 text-[#FDE68A] shrink-0" />
              <span className="text-[11.5px] sm:text-[13px] font-extrabold tabular-nums whitespace-nowrap">
                {hideNumbers ? '•••' : `${pkg.price} ريال`}
              </span>
            </div>
          </div>
          <Gift className={`w-3.5 h-3.5 shrink-0 ${theme.giftColor}`} />
        </div>

        {/* Title Row: باقة X ريال + Available Badge — flex-wrap prevents ANY clipping */}
        <div className="flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5 px-0.5">
          <span className="text-[11px] sm:text-xs font-extrabold text-slate-900 dark:text-white leading-tight whitespace-nowrap">
            باقة {hideNumbers ? '•••' : pkg.price} ريال
          </span>
          {showStock && (
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9.5px] sm:text-[10px] font-extrabold border tabular-nums whitespace-nowrap leading-none ${
                stockZero
                  ? 'bg-red-50 dark:bg-red-950/70 border-red-400 text-red-700 dark:text-red-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-500 text-emerald-800 dark:text-emerald-300'
              }`}
            >
              المتاح: {formatCount(pkg.availableCount, hideNumbers)}
            </span>
          )}
        </div>

        {/* Clean White Inner Box: Compact 2×2 Grid — full crisp text with zero truncation */}
        <div className="rounded-xl bg-white dark:bg-slate-900/95 p-1 shadow-inner border border-slate-200/80 dark:border-slate-700/80">
          <div className="grid grid-cols-2 gap-1 text-center">
            <div className="rounded-lg border border-slate-200/90 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 py-0.5 px-1">
              <div className="text-[8.5px] font-bold text-slate-600 dark:text-slate-300 leading-tight">
                السعر
              </div>
              <div className="text-[10.5px] sm:text-[11.5px] font-extrabold text-slate-900 dark:text-white tabular-nums whitespace-nowrap leading-snug">
                {hideNumbers ? '•••' : `${displayPrice} ريال`}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200/90 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 py-0.5 px-1">
              <div className="text-[8.5px] font-bold text-slate-600 dark:text-slate-300 leading-tight">
                الرصيد
              </div>
              <div className="text-[10.5px] sm:text-[11.5px] font-extrabold text-blue-700 dark:text-blue-300 whitespace-nowrap leading-snug">
                {pkg.dataLabel}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200/90 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 py-0.5 px-1">
              <div className="text-[8.5px] font-bold text-slate-600 dark:text-slate-300 leading-tight">
                الساعات
              </div>
              <div className="text-[10.5px] sm:text-[11.5px] font-extrabold text-slate-900 dark:text-white whitespace-nowrap leading-snug">
                {pkg.hoursLabel}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200/90 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 py-0.5 px-1">
              <div className="text-[8.5px] font-bold text-slate-600 dark:text-slate-300 leading-tight">
                الصلاحية
              </div>
              <div className="text-[10.5px] sm:text-[11.5px] font-extrabold text-emerald-700 dark:text-emerald-400 whitespace-nowrap leading-snug">
                {pkg.validityLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Compact White Rounded-Full Quantity Stepper */}
        <div className="rounded-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-1 py-0.5 flex items-center justify-between shadow-xs">
          <button
            type="button"
            onClick={onIncrement}
            aria-label="زيادة الكمية"
            className="w-6 h-6 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center active:scale-95 transition-transform shrink-0 shadow-xs"
          >
            <Plus className="w-3 h-3" />
          </button>

          {onSetQty ? (
            <input
              type="number"
              min={0}
              value={qty}
              onChange={(e) => onSetQty(Math.max(0, Number(e.target.value) || 0))}
              aria-label="الكمية"
              className="w-11 text-center bg-transparent text-xs font-extrabold text-slate-900 dark:text-white tabular-nums focus:outline-none"
            />
          ) : (
            <span className="text-xs font-extrabold text-slate-900 dark:text-white tabular-nums px-1.5">
              {qty}
            </span>
          )}

          <button
            type="button"
            onClick={onDecrement}
            disabled={qty === 0}
            aria-label="إنقاص الكمية"
            className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform shrink-0"
          >
            <Minus className="w-3 h-3" />
          </button>
        </div>

        {/* Compact 3D Emerald Confirm Button */}
        <button
          type="button"
          disabled={disabledConfirm}
          onClick={onConfirm}
          className="w-full min-h-[32px] rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white text-[11px] sm:text-xs font-extrabold shadow-sm active:scale-[0.98] transition-all disabled:opacity-45 flex items-center justify-center gap-1 px-2"
        >
          <ShoppingCart className="w-3 h-3 shrink-0" />
          <span className="whitespace-nowrap">{confirmLabel}</span>
        </button>

        {/* Bottom 2 Rounded-Full Pills: Edit & Delete/Clear */}
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            disabled={!canEdit || !onEdit}
            onClick={onEdit}
            className="min-h-[27px] rounded-full bg-white dark:bg-slate-900 border border-blue-400/90 text-blue-700 dark:text-blue-300 text-[10.5px] font-extrabold flex items-center justify-center gap-1 disabled:opacity-45 active:scale-95 transition-transform"
          >
            <Edit3 className="w-2.5 h-2.5 shrink-0" />
            <span>تعديل</span>
          </button>
          <button
            type="button"
            onClick={onClearOrDelete}
            className="min-h-[27px] rounded-full bg-white dark:bg-slate-900 border border-red-400/90 text-red-600 dark:text-red-400 text-[10.5px] font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-transform"
          >
            <Trash2 className="w-2.5 h-2.5 shrink-0" />
            <span>{clearLabel}</span>
          </button>
        </div>
      </div>
    );
  }
);

PackageCardTile.displayName = 'PackageCardTile';
