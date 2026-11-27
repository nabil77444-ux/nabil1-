import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Square,
  X,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { normalizeDigits } from '../lib/firebase';
import { getPendingSoldCardIds } from '../lib/offlineCards';
import { useFeedback } from '../lib/feedback';
import { useDebounce } from '../hooks/useDebounce';
import { openSmsShare, openWhatsAppShare } from '../lib/exportUtils';
import {
  EXCLUSIVE_PACKAGES,
  formatCount,
  formatYER,
  getRoleArabicLabel,
  type AgentCardInventoryReport,
  type RecallCardsResult,
  type UserProfile,
} from '../types/taibah';

const PAGE_SIZE = 50;

interface RecallCardsPanelProps {
  defaultExpanded?: boolean;
}

function isLinkedClientOfAgent(u: UserProfile, agentUid: string): boolean {
  if (!agentUid || u.uid === agentUid || u.role !== 'client') return false;
  return (
    u.parentAgentId === agentUid ||
    u.agentId === agentUid ||
    u.parentId === agentUid ||
    u.createdBy === agentUid
  );
}

export const RecallCardsPanel: React.FC<RecallCardsPanelProps> = React.memo(
  ({ defaultExpanded = false }) => {
  const { profile, managedUsers, fetchUserCardInventory, recallCardsFromUser } = useFirebase();
  const { notifySuccess, notifyWarning, notifyInfo } = useFeedback();

  const isSuperAdmin = profile?.role === 'super_admin';
  const isAgent = profile?.role === 'agent';
  const canRecall = isSuperAdmin || isAgent;

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [userSearch, setUserSearch] = useState('');
  const debouncedUserSearch = useDebounce(userSearch, 180);
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [inventory, setInventory] = useState<AgentCardInventoryReport | null>(null);
  const [loadingInv, setLoadingInv] = useState(false);

  const [mode, setMode] = useState<'all' | 'by_package_qty' | 'specific_cards'>('all');
  const [selectedPkgId, setSelectedPkgId] = useState<string>(EXCLUSIVE_PACKAGES[0].id);
  const [qtyInput, setQtyInput] = useState<string>('1');
  const [cardSearch, setCardSearch] = useState('');
  const debouncedCardSearch = useDebounce(cardSearch, 180);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [visibleCardsCount, setVisibleCardsCount] = useState(PAGE_SIZE);
  const [reason, setReason] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<RecallCardsResult | null>(null);

  const eligibleUsers = useMemo(() => {
    const q = debouncedUserSearch.trim().toLowerCase();
    const myUid = profile?.uid || '';
    return managedUsers
      .filter((u) => {
        if (isSuperAdmin) return u.role === 'agent' || u.role === 'client';
        if (isAgent) return isLinkedClientOfAgent(u, myUid);
        return false;
      })
      .filter((u) => {
        if (!q) return true;
        return (
          u.name.toLowerCase().includes(q) ||
          (u.phone || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [debouncedUserSearch, isAgent, isSuperAdmin, managedUsers, profile?.uid]);

  const selectedUser: UserProfile | null = useMemo(
    () => eligibleUsers.find((u) => u.uid === selectedUid) || null,
    [eligibleUsers, selectedUid]
  );

  const loadUserUnsoldCards = useCallback(
    async (user: UserProfile, force = true) => {
      setLoadingInv(true);
      setSelectedCardIds(new Set());
      setVisibleCardsCount(PAGE_SIZE);
      try {
        const rep = await fetchUserCardInventory(user, force);
        const pendingIds = getPendingSoldCardIds();
        const safeRemaining = rep.remainingCards.filter(
          (c) => c.status !== 'sold' && !pendingIds.has(c.id)
        );
        const safeByPkg = rep.byPackage.map((p) => ({
          ...p,
          remainingCount: safeRemaining.filter((c) => c.packageId === p.packageId).length,
        }));
        const safeRep: AgentCardInventoryReport = {
          ...rep,
          remainingCards: safeRemaining,
          byPackage: safeByPkg,
          totalRemaining: safeRemaining.length,
        };
        setInventory(safeRep);
        const firstNonEmpty = safeRep.byPackage.find((p) => p.remainingCount > 0);
        if (firstNonEmpty) {
          setSelectedPkgId(firstNonEmpty.packageId);
          setQtyInput(String(Math.min(10, firstNonEmpty.remainingCount)));
        }
      } finally {
        setLoadingInv(false);
      }
    },
    [fetchUserCardInventory]
  );

  useEffect(() => {
    if (canRecall && selectedUser && expanded) {
      setLastResult(null);
      void loadUserUnsoldCards(selectedUser, true);
    } else {
      setInventory(null);
    }
  }, [canRecall, expanded, loadUserUnsoldCards, selectedUser]);

  const discountRate = useMemo(() => {
    if (!selectedUser) return 100;
    if (typeof selectedUser.discountRate === 'number' && selectedUser.discountRate > 0) {
      return selectedUser.discountRate;
    }
    return selectedUser.role === 'agent' ? 70 : 80;
  }, [selectedUser]);

  const remainingForSelectedPkg = useMemo(() => {
    if (!inventory) return 0;
    return inventory.byPackage.find((p) => p.packageId === selectedPkgId)?.remainingCount || 0;
  }, [inventory, selectedPkgId]);

  const filteredRemainingCards = useMemo(() => {
    if (!inventory) return [];
    const q = debouncedCardSearch.trim().toLowerCase();
    return inventory.remainingCards.filter((c) => {
      if (!q) return true;
      return (
        c.cardNumber.toLowerCase().includes(q) ||
        c.packageLabel.toLowerCase().includes(q) ||
        String(c.packagePrice).includes(q)
      );
    });
  }, [debouncedCardSearch, inventory]);

  // Compute exact preview of cards to be recalled & credit amount
  const recallPreview = useMemo(() => {
    if (!inventory || inventory.remainingCards.length === 0) {
      return {
        count: 0,
        creditAmount: 0,
        electronicCount: 0,
        paperCount: 0,
        cardKindLabel: 'إلكترونية',
        byPkg: [] as Array<{ price: number; count: number; credit: number }>,
      };
    }
    let chosen = inventory.remainingCards;
    if (mode === 'by_package_qty') {
      const qty = Math.max(0, Math.min(remainingForSelectedPkg, Math.floor(Number(qtyInput) || 0)));
      chosen = inventory.remainingCards
        .filter((c) => c.packageId === selectedPkgId)
        .slice(0, qty);
    } else if (mode === 'specific_cards') {
      chosen = inventory.remainingCards.filter((c) => selectedCardIds.has(c.id));
    }

    const pkgCounts = new Map<number, { count: number; credit: number }>();
    let totalCredit = 0;
    let electronicCount = 0;
    let paperCount = 0;
    for (const c of chosen) {
      if (c.cardType === 'paper') paperCount += 1;
      else electronicCount += 1;
      const unitCredit = Math.round((c.packagePrice * discountRate) / 100);
      totalCredit += unitCredit;
      const prev = pkgCounts.get(c.packagePrice) || { count: 0, credit: 0 };
      pkgCounts.set(c.packagePrice, { count: prev.count + 1, credit: prev.credit + unitCredit });
    }
    const byPkg = Array.from(pkgCounts.entries())
      .map(([price, v]) => ({ price, count: v.count, credit: v.credit }))
      .sort((a, b) => a.price - b.price);

    const cardKindLabel =
      electronicCount > 0 && paperCount > 0
        ? `إلكترونية (${electronicCount}) + ورقية (${paperCount})`
        : paperCount > 0
          ? 'ورقية'
          : 'إلكترونية';

    return {
      count: chosen.length,
      creditAmount: totalCredit,
      electronicCount,
      paperCount,
      cardKindLabel,
      byPkg,
    };
  }, [discountRate, inventory, mode, qtyInput, remainingForSelectedPkg, selectedCardIds, selectedPkgId]);

  const toggleCardSelection = (cardId: string) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const handleOpenConfirm = () => {
    if (!selectedUser || recallPreview.count <= 0) {
      notifyWarning('حدد الكروت أولاً', 'يرجى اختيار وكيل/عميل وتحديد كرت واحد غير مباع على الأقل للسحب.');
      return;
    }
    setConfirmOpen(true);
  };

  const handleExecuteRecall = async () => {
    if (!selectedUser || executing) return;
    setExecuting(true);
    try {
      const res = await recallCardsFromUser({
        targetUser: selectedUser,
        mode,
        packageId: mode === 'by_package_qty' ? selectedPkgId : undefined,
        quantity: mode === 'by_package_qty' ? Math.floor(Number(qtyInput) || 0) : undefined,
        selectedCardIds: mode === 'specific_cards' ? Array.from(selectedCardIds) : undefined,
        reason,
      });
      setConfirmOpen(false);
      if (res.ok) {
        setLastResult(res);
        setSelectedCardIds(new Set());
        setReason('');
        await loadUserUnsoldCards(selectedUser, true);
      }
    } finally {
      setExecuting(false);
    }
  };

  // STRICT SUPER ADMIN & AGENT ONLY RENDER GUARD (clients completely blocked)
  if (!canRecall) {
    return null;
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-3.5 shadow-sm" dir="rtl">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between gap-2 text-right"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-red-600/15 dark:bg-red-900/40 border border-red-500/40 text-red-700 dark:text-red-300 flex items-center justify-center shrink-0">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] leading-snug">
              {isSuperAdmin
                ? 'سحب الكروت من الوكيل أو العميل'
                : 'سحب الكروت من عملائك التابعين لك'}
            </h3>
            <p className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400">
              {isSuperAdmin
                ? 'استرداد الكروت غير المباعة للمخزون الرئيسي وخصم قيمتها تلقائياً من رصيد الحساب'
                : 'استرداد الكروت غير المباعة من عملائك التابعين لك وإعادتها مباشرة إلى مخزونك مع تحديث الرصيد'}
            </p>
          </div>
        </div>
        <span className="shrink-0 w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-3">
          {/* Security Notice */}
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 px-3 py-2 text-[11px] font-bold text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span>
              {isSuperAdmin
                ? 'يتم تحميل الكروت المتبقية غير المباعة فقط لدى الحساب المختار. يُمنع برمجياً سحب أي كرت تم بيعه، وتُعاد الكروت المسحوبة للمخزون الرئيسي بأرقامها الأصلية.'
                : 'تظهر هنا قائمة عملائك التابعين لك فقط. يتم تحميل الكروت غير المباعة المتاحة فقط وتُعاد الكروت المسحوبة مباشرة إلى مخزونك الشخصي بأرقامها الأصلية.'}
            </span>
          </div>

          {/* Step 1: Select Agent / Client */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                inputMode="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder={
                  isSuperAdmin
                    ? 'ابحث باسم أو رقم الوكيل / العميل...'
                    : 'ابحث باسم أو رقم أحد عملائك...'
                }
                className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-8 pl-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
              />
            </div>
            <select
              value={selectedUid}
              onChange={(e) => setSelectedUid(e.target.value)}
              className="w-full min-h-[38px] rounded-xl border-2 border-[#D4AF37]/60 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
            >
              <option value="">
                {isSuperAdmin
                  ? '— اختر الوكيل أو العميل —'
                  : eligibleUsers.length > 0
                    ? '— اختر عميلاً من عملائك التابعين لك —'
                    : '— لا يوجد عملاء تابعون لحسابك حالياً —'}
              </option>
              {eligibleUsers.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.name} ({getRoleArabicLabel(u.role)}) — {u.phone}
                </option>
              ))}
            </select>
          </div>

          {/* Loaded Inventory */}
          {selectedUser && (
            <>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-2.5 flex items-center justify-between flex-wrap gap-2">
                <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                  الحساب: <strong className="text-[#1A365D] dark:text-[#FDE68A]">{selectedUser.name}</strong> •
                  الرصيد الحالي: <strong className="tabular-nums">{formatYER(Number(selectedUser.balance) || 0)}</strong> •
                  تسعيرة السحب: <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">{discountRate}%</strong>
                </div>
                <button
                  type="button"
                  disabled={loadingInv}
                  onClick={() => void loadUserUnsoldCards(selectedUser, true)}
                  className="px-2.5 py-1 rounded-lg bg-[#1A365D] text-[#FDE68A] text-[10.5px] font-extrabold flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingInv ? 'animate-spin' : ''}`} />
                  تحديث المتبقي
                </button>
              </div>

              {loadingInv ? (
                <div className="py-6 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#1A365D] dark:text-[#FDE68A] mx-auto" />
                  <p className="mt-1.5 text-xs font-bold text-slate-500">جاري جلب الكروت المتبقية غير المباعة...</p>
                </div>
              ) : inventory && inventory.totalRemaining === 0 ? (
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-4 text-center text-xs font-extrabold text-slate-600 dark:text-slate-300">
                  لا توجد أي كروت متبقية (غير مباعة) لدى {selectedUser.name} حالياً.
                </div>
              ) : inventory ? (
                <>
                  {/* 8-Package Remaining Stock Chips */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {inventory.byPackage.map((p) => (
                      <div
                        key={p.packageId}
                        className={`rounded-xl border px-2.5 py-1.5 text-center ${
                          p.remainingCount > 0
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400/60'
                            : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 opacity-60'
                        }`}
                      >
                        <p className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300">
                          باقة {p.price} ر.ي ({p.dataLabel})
                        </p>
                        <p className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                          متبقي: {formatCount(p.remainingCount)} كرت
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* 3 Recall Modes */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setMode('all')}
                      className={`min-h-[38px] rounded-xl border-2 px-2 text-[11px] font-extrabold transition-all ${
                        mode === 'all'
                          ? 'bg-[#1A365D] text-white border-[#D4AF37]'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      1. سحب جميع المتبقي ({formatCount(inventory.totalRemaining)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('by_package_qty')}
                      className={`min-h-[38px] rounded-xl border-2 px-2 text-[11px] font-extrabold transition-all ${
                        mode === 'by_package_qty'
                          ? 'bg-[#1A365D] text-white border-[#D4AF37]'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      2. كمية محددة من فئة معيّنة
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('specific_cards')}
                      className={`min-h-[38px] rounded-xl border-2 px-2 text-[11px] font-extrabold transition-all ${
                        mode === 'specific_cards'
                          ? 'bg-[#1A365D] text-white border-[#D4AF37]'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      3. تحديد أرقام كروت بعينها ({selectedCardIds.size})
                    </button>
                  </div>

                  {/* Mode 2 Controls */}
                  {mode === 'by_package_qty' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5 border border-slate-200 dark:border-slate-700">
                      <div>
                        <label className="block text-[10.5px] font-extrabold text-slate-600 dark:text-slate-300 mb-1">
                          اختر الفئة
                        </label>
                        <select
                          value={selectedPkgId}
                          onChange={(e) => {
                            const nextId = e.target.value;
                            setSelectedPkgId(nextId);
                            const max = inventory.byPackage.find((p) => p.packageId === nextId)?.remainingCount || 0;
                            setQtyInput(String(Math.min(Math.max(1, Number(qtyInput) || 1), Math.max(0, max))));
                          }}
                          className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 text-xs font-bold"
                        >
                          {inventory.byPackage.map((p) => (
                            <option key={p.packageId} value={p.packageId} disabled={p.remainingCount === 0}>
                              باقة {p.price} ر.ي ({p.dataLabel}) — المتبقي: {p.remainingCount}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10.5px] font-extrabold text-slate-600 dark:text-slate-300 mb-1">
                          الكمية المطلوب سحبها (الحد الأقصى: {formatCount(remainingForSelectedPkg)})
                        </label>
                        <input
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          dir="ltr"
                          value={qtyInput}
                          onChange={(e) => setQtyInput(normalizeDigits(e.target.value).replace(/[^\d]/g, ''))}
                          className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 text-xs font-extrabold tabular-nums text-right"
                        />
                      </div>
                    </div>
                  )}

                  {/* Mode 3 Controls (Specific Cards Picker with 50/page pagination) */}
                  {mode === 'specific_cards' && (
                    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5 border border-slate-200 dark:border-slate-700 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative flex-1 min-w-[180px]">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            dir="ltr"
                            value={cardSearch}
                            onChange={(e) => setCardSearch(normalizeDigits(e.target.value))}
                            placeholder="بحث برقم الكرت أو الفئة..."
                            className="w-full min-h-[34px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 pr-8 pl-2 text-xs font-bold text-right"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedCardIds(
                              new Set(filteredRemainingCards.slice(0, visibleCardsCount).map((c) => c.id))
                            )
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-[#1A365D] text-white text-[10.5px] font-extrabold"
                        >
                          تحديد المعروض
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedCardIds(new Set())}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-[10.5px] font-extrabold"
                        >
                          إلغاء التحديد
                        </button>
                      </div>

                      <div className="max-h-[220px] overflow-y-auto space-y-1">
                        {filteredRemainingCards.slice(0, visibleCardsCount).map((card) => {
                          const checked = selectedCardIds.has(card.id);
                          return (
                            <button
                              key={card.id}
                              type="button"
                              onClick={() => toggleCardSelection(card.id)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-right text-xs font-bold transition-colors ${
                                checked
                                  ? 'bg-red-50 dark:bg-red-950/40 border-red-400 text-red-900 dark:text-red-200'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              <span className="flex items-center gap-2 font-mono tabular-nums font-extrabold">
                                {checked ? (
                                  <CheckSquare className="w-4 h-4 text-red-600" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-400" />
                                )}
                                {card.cardNumber}
                              </span>
                              <span className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                {card.packageLabel}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {filteredRemainingCards.length > visibleCardsCount && (
                        <button
                          type="button"
                          onClick={() => setVisibleCardsCount((c) => c + PAGE_SIZE)}
                          className="w-full py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A]"
                        >
                          عرض المزيد (50 كرت إضافي من أصل {formatCount(filteredRemainingCards.length)})
                        </button>
                      )}
                    </div>
                  )}

                  {/* Optional Reason */}
                  <input
                    type="text"
                    inputMode="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="سبب السحب / ملاحظة (اختياري — يُحفظ في كشف الحساب وسجل العمليات)..."
                    className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
                  />

                  {/* Live Credit Calculation Strip + Execute Button */}
                  <div className="rounded-xl bg-gradient-to-l from-red-950/90 to-[#1A365D] border-2 border-[#D4AF37] p-3 text-white flex items-center justify-between flex-wrap gap-2">
                    <div className="space-y-0.5">
                      <p className="text-[11px] font-bold text-[#FDE68A]">
                        المحدد للسحب الآن: <strong>{formatCount(recallPreview.count)} كرت</strong> (بسعر {discountRate}%)
                      </p>
                      <p className="text-xs font-extrabold tabular-nums">
                        قيمة القيد الدائن «سحب / مرتجع كروت (له)»: {formatYER(recallPreview.creditAmount)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={recallPreview.count <= 0 || executing}
                      onClick={handleOpenConfirm}
                      className="min-h-[40px] px-4 rounded-xl bg-red-600 hover:bg-red-700 border-2 border-[#FDE68A] text-white text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>تنفيذ سحب الكروت</span>
                    </button>
                  </div>
                </>
              ) : null}
            </>
          )}

          {/* Post-Recall Notification Share Card */}
          {lastResult?.ok && selectedUser && (
            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/35 border-2 border-emerald-500 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  تم سحب {formatCount(lastResult.recalledCount)} كرت وإعادتها للمخزون وتحديث الرصيد بنجاح!
                </span>
                <button
                  type="button"
                  onClick={() => setLastResult(null)}
                  className="text-slate-500 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                المخصوم (له): {formatYER(lastResult.creditAmount)} • الرصيد السابق: {formatYER(lastResult.previousBalance)} ← الرصيد الحالي: {formatYER(lastResult.newBalance)}
              </p>
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <button
                  type="button"
                  onClick={() => openWhatsAppShare(selectedUser.phone, lastResult.notificationMessage)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> إشعار واتساب للوكيل/العميل
                </button>
                <button
                  type="button"
                  onClick={() => openSmsShare(selectedUser.phone, lastResult.notificationMessage)}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-extrabold flex items-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> إرسال رسالة SMS
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(lastResult.notificationMessage);
                      notifySuccess('تم نسخ إشعار السحب بنجاح ✅');
                    } catch {
                      notifyInfo('تعذر النسخ');
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 text-white text-[11px] font-extrabold flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" /> نسخ الإشعار
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal Before Executing Atomic Recall */}
      {confirmOpen && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl space-y-3" dir="rtl">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-extrabold">تأكيد سحب الكروت وإعادتها للمخزون</h3>
            </div>
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 space-y-1.5 text-xs font-bold">
              <p>
                الحساب المستهدف: <strong className="text-[#1A365D] dark:text-[#FDE68A]">{selectedUser.name}</strong> ({selectedUser.phone})
              </p>
              <p>
                الوجهة بعد السحب: <strong className="text-emerald-700 dark:text-emerald-400">{isSuperAdmin ? 'مخزون الإدارة الرئيسي' : 'مخزونك الشخصي (الوكيل)'}</strong>
              </p>
              <p>
                نوع الكروت المسحوبة: <strong className="text-indigo-700 dark:text-indigo-300">{recallPreview.cardKindLabel}</strong>
              </p>
              <p>
                إجمالي الكروت التي ستُسحب: <strong className="text-red-600 dark:text-red-400 tabular-nums">{formatCount(recallPreview.count)} كرت</strong>
              </p>
              <div className="pt-1 border-t border-slate-200 dark:border-slate-700 space-y-0.5 text-[11px]">
                {recallPreview.byPkg.map((b) => (
                  <p key={b.price} className="tabular-nums">
                    • فئة {b.price} ر.ي: {formatCount(b.count)} كرت ← خصم {formatYER(b.credit)}
                  </p>
                ))}
              </div>
              <p className="pt-1 border-t border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 tabular-nums">
                إجمالي القيد الدائن (له) بنسبة {discountRate}%: <strong>{formatYER(recallPreview.creditAmount)}</strong>
              </p>
              <p className="tabular-nums">
                الرصيد الحالي: {formatYER(Number(selectedUser.balance) || 0)} ← بعد السحب:{' '}
                <strong>{formatYER((Number(selectedUser.balance) || 0) - recallPreview.creditAmount)}</strong>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                disabled={executing}
                onClick={() => void handleExecuteRecall()}
                className="min-h-[42px] rounded-xl bg-red-600 hover:bg-red-700 border-2 border-[#D4AF37] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                {executing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                <span>{executing ? 'جاري السحب والمطابقة...' : 'تأكيد السحب الآن'}</span>
              </button>
              <button
                type="button"
                disabled={executing}
                onClick={() => setConfirmOpen(false)}
                className="min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-extrabold"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  }
);

RecallCardsPanel.displayName = 'RecallCardsPanel';
