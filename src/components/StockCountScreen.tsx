import React, { useMemo } from 'react';
import { CreditCard, FileText, Package, RefreshCw } from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { formatCount } from '../types/taibah';

interface StockCountScreenProps {
  hideNumbers: boolean;
}

interface DenominationSpec {
  packageId: string;
  price: number;
  label: string;
  gridSpanClass: string;
  tileClasses: string;
}

/**
 * Exact 8 Exclusive Denominations arranged in a symmetric 6-column (3 + 3 + 2) RTL grid:
 * Row 1: 100, 200, 250 (col-span-2 each)
 * Row 2: 500, 1000, 2000 (col-span-2 each)
 * Row 3: 2500 (col-start-2 col-span-2), 3000 (col-start-4 col-span-2)
 */
const STOCK_DENOMINATIONS: DenominationSpec[] = [
  {
    packageId: 'pkg_100',
    price: 100,
    label: 'فئة 100',
    gridSpanClass: 'col-span-2',
    tileClasses:
      'border-sky-500 bg-sky-50 text-sky-900 dark:border-sky-400 dark:bg-sky-950/45 dark:text-sky-100',
  },
  {
    packageId: 'pkg_200',
    price: 200,
    label: 'فئة 200',
    gridSpanClass: 'col-span-2',
    tileClasses:
      'border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-950/45 dark:text-emerald-100',
  },
  {
    packageId: 'pkg_250',
    price: 250,
    label: 'فئة 250',
    gridSpanClass: 'col-span-2',
    tileClasses:
      'border-violet-500 bg-violet-50 text-violet-900 dark:border-violet-400 dark:bg-violet-950/45 dark:text-violet-100',
  },
  {
    packageId: 'pkg_500',
    price: 500,
    label: 'فئة 500',
    gridSpanClass: 'col-span-2',
    tileClasses:
      'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-400 dark:bg-amber-950/45 dark:text-amber-100',
  },
  {
    packageId: 'pkg_1000',
    price: 1000,
    label: 'فئة 1000',
    gridSpanClass: 'col-span-2',
    tileClasses:
      'border-rose-500 bg-rose-50 text-rose-900 dark:border-rose-400 dark:bg-rose-950/45 dark:text-rose-100',
  },
  {
    packageId: 'pkg_2000',
    price: 2000,
    label: 'فئة 2000',
    gridSpanClass: 'col-span-2',
    tileClasses:
      'border-teal-500 bg-teal-50 text-teal-900 dark:border-teal-400 dark:bg-teal-950/45 dark:text-teal-100',
  },
  {
    packageId: 'pkg_2500',
    price: 2500,
    label: 'فئة 2500',
    gridSpanClass: 'col-start-2 col-span-2',
    tileClasses:
      'border-orange-500 bg-orange-50 text-orange-900 dark:border-orange-400 dark:bg-orange-950/45 dark:text-orange-100',
  },
  {
    packageId: 'pkg_3000',
    price: 3000,
    label: 'فئة 3000',
    gridSpanClass: 'col-start-4 col-span-2',
    tileClasses:
      'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/45 dark:text-indigo-100',
  },
];

export const StockCountScreen: React.FC<StockCountScreenProps> = ({ hideNumbers }) => {
  const {
    personalStockSplit,
    isRefreshingInventory,
    refreshMyInventory,
    isOnline,
  } = useFirebase();

  const grandTotal = useMemo(
    () => (personalStockSplit.totalElectronic || 0) + (personalStockSplit.totalPaper || 0),
    [personalStockSplit.totalElectronic, personalStockSplit.totalPaper]
  );

  const renderDenominationGrid = (countsMap: Record<string, number>) => (
    <div dir="rtl" className="grid grid-cols-6 gap-2">
      {STOCK_DENOMINATIONS.map((spec) => {
        const count = Math.max(0, Number(countsMap[spec.packageId] ?? 0));
        return (
          <div
            key={spec.packageId}
            className={`${spec.gridSpanClass} ${spec.tileClasses} rounded-xl border-2 py-2.5 px-1.5 flex flex-col items-center justify-center text-center shadow-xs`}
          >
            <span className="text-xs font-bold leading-snug whitespace-nowrap">
              {spec.label}
            </span>
            <div className="mt-1 flex items-baseline justify-center gap-1 tabular-nums">
              <span className="text-lg font-extrabold leading-tight">
                {formatCount(count, hideNumbers)}
              </span>
              <span className="text-[11px] font-bold opacity-85">كرت</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 pb-24">
      {/* Compact Top Summary & Refresh Bar */}
      <div className="rounded-2xl bg-gradient-to-l from-[#0F172A] via-[#1A365D] to-[#1E3A8A] border-2 border-[#D4AF37] px-3.5 py-2.5 shadow-md flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white/15 border border-[#D4AF37] text-[#FDE68A] flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-extrabold text-white truncate">
              إجمالي المخزون المتوفر: {formatCount(grandTotal, hideNumbers)} كرت
            </div>
            <div className="text-[10.5px] font-bold text-[#FDE68A] truncate">
              {isOnline ? 'تحديث لحظي متزامن مع حسابك' : 'عرض فوري من الذاكرة المحلية (أوفلاين)'}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={isRefreshingInventory}
          onClick={() => void refreshMyInventory(true)}
          className="shrink-0 min-h-[36px] px-3 rounded-xl gold-btn-3d border border-[#92400E] text-[#0F172A] text-xs font-extrabold flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-65"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingInventory ? 'animate-spin' : ''}`} />
          <span>{isRefreshingInventory ? 'تحديث...' : 'تحديث'}</span>
        </button>
      </div>

      {/* Frame 1 (Top): Electronic Cards */}
      <section
        aria-label="الكروت الإلكترونية"
        className="rounded-2xl border-2 border-blue-500/80 dark:border-blue-400/70 bg-white dark:bg-slate-900 p-3 shadow-sm space-y-2.5"
      >
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/60 border border-blue-400/70 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
              <CreditCard className="w-4 h-4" />
            </span>
            <h2 className="text-[15px] font-extrabold text-slate-900 dark:text-white truncate">
              الكروت الإلكترونية
            </h2>
          </div>
          <span className="shrink-0 px-2.5 py-1 rounded-xl bg-blue-600 text-white text-xs font-extrabold tabular-nums shadow-xs">
            {formatCount(personalStockSplit.totalElectronic, hideNumbers)} كرت
          </span>
        </div>

        {renderDenominationGrid(personalStockSplit.electronicByPkg)}
      </section>

      {/* Frame 2 (Bottom): Paper Cards */}
      <section
        aria-label="الكروت الورقية"
        className="rounded-2xl border-2 border-[#D4AF37] dark:border-[#D4AF37]/80 bg-white dark:bg-slate-900 p-3 shadow-sm space-y-2.5"
      >
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-[#D4AF37] text-amber-800 dark:text-[#FDE68A] flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </span>
            <h2 className="text-[15px] font-extrabold text-slate-900 dark:text-white truncate">
              الكروت الورقية
            </h2>
          </div>
          <span className="shrink-0 px-2.5 py-1 rounded-xl bg-[#1A365D] border border-[#D4AF37] text-[#FDE68A] text-xs font-extrabold tabular-nums shadow-xs">
            {formatCount(personalStockSplit.totalPaper, hideNumbers)} كرت
          </span>
        </div>

        {renderDenominationGrid(personalStockSplit.paperByPkg)}
      </section>
    </div>
  );
};
