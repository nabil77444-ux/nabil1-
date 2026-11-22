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
 * Update 15: Unified 8-Package Card Tile
 * Matches the exact attached visual layout & color system while strictly preserving
 * compact 2-column dimensions across Direct Sale, Electronic Wholesale, and Paper Invoices.
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
        className={`rounded-2xl border-2 ${theme.border} ${theme.cardBg} p-2.5 shadow-sm flex flex-col justify-between gap-2 transition-transform ${
          qty > 0 ? 'ring-2 ring-[#D4AF37]' : ''
        }`}
      >
        {/* Top Row: 3D Colored Price Pill Capsule + Gift Corner Icon */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex-1 flex justify-center">
            <div
              className={`w-full max-w-[138px] py-1 px-2.5 rounded-full ${theme.capsuleBg} text-white shadow-md flex items-center justify-center gap-1.5`}
            >
              <Coins className="w-3.5 h-3.5 text-[#FDE68A] shrink-0" />
              <span className="text-xs sm:text-sm font-extrabold tabular-nums whitespace-nowrap">
                {hideNumbers ? '•••' : `${pkg.price} ريال`}
              </span>
            </div>
          </div>
          <Gift className={`w-4 h-4 shrink-0 ${theme.giftColor}`} />
        </div>

        {/* Title Row: باقة X ريال + Red-bordered Available Pill */}
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs sm:text-[13px] font-extrabold text-slate-900 dark:text-white truncate">
            باقة {hideNumbers ? '•••' : pkg.price} ريال
          </span>
          {showStock && (
            <span
              className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-extrabold border tabular-nums ${
                stockZero
                  ? 'bg-red-50 dark:bg-red-950/60 border-red-400 text-red-600 dark:text-red-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-400 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              المتاح: {formatCount(pkg.availableCount, hideNumbers)}
            </span>
          )}
        </div>

        {/* Clean White Inner Box: 2×2 Grid (السعر | الرصيد | الساعات | الصلاحية) */}
        <div className="rounded-xl bg-white dark:bg-slate-900/95 p-1.5 shadow-inner border border-white/80 dark:border-slate-700/70">
          <div className="grid grid-cols-2 gap-1.5 text-center">
            <div className="rounded-lg border border-slate-200/80 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 py-1 px-1">
              <div className="text-[9px] font-bold text-slate-500 dark:text-slate-400">السعر</div>
              <div className="text-[11px] sm:text-xs font-extrabold text-slate-900 dark:text-white tabular-nums truncate">
                {hideNumbers ? '•••' : `${displayPrice} ريال`}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200/80 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 py-1 px-1">
              <div className="text-[9px] font-bold text-slate-500 dark:text-slate-400">الرصيد</div>
              <div className="text-[11px] sm:text-xs font-extrabold text-blue-700 dark:text-blue-300 truncate">
                {pkg.dataLabel}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200/80 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 py-1 px-1">
              <div className="text-[9px] font-bold text-slate-500 dark:text-slate-400">الساعات</div>
              <div className="text-[11px] sm:text-xs font-extrabold text-slate-900 dark:text-white truncate">
                {pkg.hoursLabel}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200/80 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 py-1 px-1">
              <div className="text-[9px] font-bold text-slate-500 dark:text-slate-400">الصلاحية</div>
              <div className="text-[11px] sm:text-xs font-extrabold text-emerald-700 dark:text-emerald-400 truncate">
                {pkg.validityLabel}
              </div>
            </div>
          </div>
        </div>

        {/* White Rounded-Full Quantity Stepper (+ Green right, Count center, - Gray left) */}
        <div className="rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-1.5 py-1 flex items-center justify-between shadow-sm">
          <button
            type="button"
            onClick={onIncrement}
            aria-label="زيادة الكمية"
            className="w-7 h-7 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center active:scale-95 transition-transform shrink-0 shadow"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {onSetQty ? (
            <input
              type="number"
              min={0}
              value={qty}
              onChange={(e) => onSetQty(Math.max(0, Number(e.target.value) || 0))}
              aria-label="الكمية"
              className="w-12 text-center bg-transparent text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white tabular-nums focus:outline-none"
            />
          ) : (
            <span className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white tabular-nums px-2">
              {qty}
            </span>
          )}

          <button
            type="button"
            onClick={onDecrement}
            disabled={qty === 0}
            aria-label="إنقاص الكمية"
            className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform shrink-0"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Wide 3D Emerald Confirm Button */}
        <button
          type="button"
          disabled={disabledConfirm}
          onClick={onConfirm}
          className="w-full min-h-[36px] rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white text-xs font-extrabold shadow-md active:scale-[0.98] transition-all disabled:opacity-45 flex items-center justify-center gap-1.5"
        >
          <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{confirmLabel}</span>
        </button>

        {/* Bottom 2 Rounded-Full Pills: Edit (Light Blue) & Delete/Clear (Light Red) */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={!canEdit || !onEdit}
            onClick={onEdit}
            className="min-h-[30px] rounded-full bg-white dark:bg-slate-900 border border-blue-400/80 text-blue-700 dark:text-blue-300 text-[11px] font-extrabold flex items-center justify-center gap-1 disabled:opacity-45 active:scale-95 transition-transform"
          >
            <Edit3 className="w-3 h-3 shrink-0" />
            <span>تعديل</span>
          </button>
          <button
            type="button"
            onClick={onClearOrDelete}
            className="min-h-[30px] rounded-full bg-white dark:bg-slate-900 border border-red-400/80 text-red-600 dark:text-red-400 text-[11px] font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-transform"
          >
            <Trash2 className="w-3 h-3 shrink-0" />
            <span>{clearLabel}</span>
          </button>
        </div>
      </div>
    );
  }
);

PackageCardTile.displayName = 'PackageCardTile';
