import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Minus,
  Plus,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  EXCLUSIVE_PACKAGES,
  formatCount,
  formatDateTimeAr,
  formatYER,
  getPackageThemeStyle,
  getRoleArabicLabel,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type PackageDoc,
  type TopupLineItem,
  type TopupRequest,
} from '../types/taibah';

interface TopupRequestsScreenProps {
  hideNumbers: boolean;
}

interface GroupedRequester {
  requesterId: string;
  requesterName: string;
  requesterPhone: string;
  requesterRole: 'agent' | 'client';
  discountRate: number;
  targetName: string;
  requests: TopupRequest[];
  pendingCount: number;
  totalCards: number;
  totalAmount: number;
}

export const TopupRequestsScreen: React.FC<TopupRequestsScreenProps> = ({ hideNumbers }) => {
  const {
    profile,
    packages,
    topupRequests,
    appSettings,
    submitTopupRequest,
    approveTopupRequest,
    rejectTopupRequest,
  } = useFirebase();

  const displayPackages = packages.length > 0 ? packages : (EXCLUSIVE_PACKAGES as PackageDoc[]);
  const isAdmin = profile?.role === 'super_admin';
  const isAgent = profile?.role === 'agent';
  const canSubmitRequest = !isAdmin;

  // Group requests by Agent / Client (Update 7)
  const groupedCards = useMemo<GroupedRequester[]>(() => {
    const map = new Map<string, GroupedRequester>();
    for (const req of topupRequests) {
      const existing = map.get(req.requesterId);
      if (existing) {
        existing.requests.push(req);
        if (req.status === 'pending') existing.pendingCount += 1;
        existing.totalCards += Number(req.totalCards) || 0;
        existing.totalAmount += Number(req.totalAmount) || 0;
      } else {
        map.set(req.requesterId, {
          requesterId: req.requesterId,
          requesterName: req.requesterName,
          requesterPhone: req.requesterPhone || '',
          requesterRole: req.requesterRole,
          discountRate:
            req.discountRate ||
            (req.requesterRole === 'agent'
              ? appSettings.agentDiscountPercent
              : appSettings.clientDiscountPercent),
          targetName:
            req.targetName ||
            (req.targetId === 'super_admin' ? SUPER_ADMIN_CONFIG.name : 'الوكيل المباشر'),
          requests: [req],
          pendingCount: req.status === 'pending' ? 1 : 0,
          totalCards: Number(req.totalCards) || 0,
          totalAmount: Number(req.totalAmount) || 0,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.pendingCount - a.pendingCount);
  }, [topupRequests, appSettings]);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const selectedGroup = useMemo(
    () => groupedCards.find((g) => g.requesterId === selectedGroupId) || null,
    [groupedCards, selectedGroupId]
  );

  // New topup request modal (for Agents & Clients)
  const [showNewModal, setShowNewModal] = useState(false);
  const [reqCart, setReqCart] = useState<Record<string, number>>({});
  const [reqNotes, setReqNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Reject reason modal
  const [rejectTarget, setRejectTarget] = useState<TopupRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const myRate =
    profile?.discountRate ||
    (profile?.role === 'agent'
      ? appSettings.agentDiscountPercent || 70
      : appSettings.clientDiscountPercent || 80);

  const composedItems = useMemo<TopupLineItem[]>(() => {
    return displayPackages
      .filter((p) => (reqCart[p.id] || 0) > 0)
      .map((p) => ({
        packageId: p.id,
        packageLabel: `باقة ${p.price} ر.ي (${p.dataLabel})`,
        price: p.price,
        unitPrice: Math.round((p.price * myRate) / 100),
        quantity: reqCart[p.id],
      }));
  }, [displayPackages, reqCart, myRate]);

  const composedTotals = useMemo(
    () => ({
      cards: composedItems.reduce((s, i) => s + i.quantity, 0),
      amount: composedItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
    }),
    [composedItems]
  );

  const handleSubmitNewTopup = async () => {
    if (composedItems.length === 0) return;
    setBusy(true);
    try {
      const ok = await submitTopupRequest({ items: composedItems, notes: reqNotes.trim() });
      if (ok) {
        setReqCart({});
        setReqNotes('');
        setShowNewModal(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 safe-bottom-clear">
      {/* Header Banner */}
      <div className="royal-header-3d rounded-3xl border-2 border-[#D4AF37] p-4 shadow-xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-white/15 border border-[#D4AF37] flex items-center justify-center text-[#FDE68A] shrink-0">
            <Send className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-white truncate">طلبات التغذية ثنائية المستوى</h2>
            <p className="text-[11px] font-bold text-[#FDE68A] truncate">
              توجيه تلقائي لحظي (العميل ← الوكيل المباشر ← {SUPER_ADMIN_CONFIG.name})
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

      {/* Submit New Topup Request Button (Clients & Agents) */}
      {canSubmitRequest && (
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="w-full min-h-[48px] gold-btn-3d text-[#0F172A] font-extrabold text-sm rounded-2xl flex items-center justify-center gap-2 shadow-lg"
        >
          <Plus className="w-5 h-5" />
          <span>+ إرسال طلب تغذية جديد</span>
        </button>
      )}

      {/* UPDATE 7: Grouped Gold-Bordered Cards per Agent / Client */}
      {groupedCards.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/60 p-8 text-center">
          <Send className="w-10 h-10 mx-auto text-[#D4AF37] mb-2" />
          <h3 className="text-sm font-extrabold">لا توجد طلبات تغذية مسجلة حالياً (0)</h3>
          <p className="text-xs text-slate-500 mt-1">
            أي طلب تغذية يُرسل من الوكلاء أو العملاء سيظهر هنا فوراً في بطاقة مجمّعة للتنفيذ المباشر.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groupedCards.map((group) => {
            const firstLetter = group.requesterName.trim().charAt(0) || 'ط';
            const hasPending = group.pendingCount > 0;
            return (
              <div
                key={group.requesterId}
                className="royal-tile-3d rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-3.5 shadow-md space-y-3"
              >
                <div className="flex items-center justify-between gap-2.5">
                  {/* Right: Navy First-Letter Box + Name / Role / Rate */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-[#1A365D] border-2 border-[#D4AF37] text-[#FDE68A] text-lg font-extrabold flex items-center justify-center shrink-0 shadow">
                      {firstLetter}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                        {group.requesterName}
                      </h3>
                      <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        {getRoleArabicLabel(group.requesterRole)} · نسبة {group.discountRate}%
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-xl text-[11px] font-extrabold ${
                      hasPending
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                    }`}
                  >
                    {hasPending ? `معلق (${group.pendingCount})` : 'مكتمل ✅'}
                  </span>
                </div>

                {/* Summary Bar (Requests / Cards / YER + Routing Target) */}
                <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 p-2 text-center text-[11px] font-extrabold tabular-nums">
                  <div>
                    <div className="text-[10px] text-slate-500">الطلبات</div>
                    <div>{formatCount(group.requests.length, hideNumbers)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">إجمالي الكروت</div>
                    <div className="text-blue-700 dark:text-blue-400">
                      {formatCount(group.totalCards, hideNumbers)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">الإجمالي</div>
                    <div className="text-emerald-700 dark:text-emerald-400">
                      {formatYER(group.totalAmount, hideNumbers)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                    إلى: {group.targetName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedGroupId(group.requesterId)}
                    className="min-h-[38px] px-4 rounded-xl royal-btn-3d text-white text-xs font-extrabold flex items-center gap-1.5"
                  >
                    <span>عرض الطلبات والتنفيذ</span>
                    <ArrowLeft className="w-4 h-4 text-[#FDE68A]" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* GROUP DETAIL & EXECUTION MODAL */}
      {selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[90dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3.5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-white">
                  طلبات التغذية — {selectedGroup.requesterName}
                </h3>
                <p className="text-[11px] font-bold text-[#FDE68A]">
                  {getRoleArabicLabel(selectedGroup.requesterRole)} · إلى: {selectedGroup.targetName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedGroupId(null)}
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {selectedGroup.requests.map((req) => {
                const canExecute =
                  req.status === 'pending' &&
                  (isAdmin || (isAgent && req.targetId === profile?.uid));

                return (
                  <div
                    key={req.id}
                    className="rounded-2xl border-2 border-[#D4AF37]/70 dark:border-[#D4AF37]/55 p-3.5 space-y-2.5 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold tabular-nums">
                        {formatDateTimeAr(req.createdAt)}
                      </span>
                      <span
                        className={`text-[11px] font-extrabold px-2 py-0.5 rounded-lg flex items-center gap-1 ${
                          req.status === 'pending'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                            : req.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                        }`}
                      >
                        {req.status === 'pending' ? (
                          <>
                            <Clock className="w-3 h-3" /> بانتظار التنفيذ
                          </>
                        ) : req.status === 'approved' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" /> تم التنفيذ ✅
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3" /> مرفوض
                          </>
                        )}
                      </span>
                    </div>

                    {req.items && req.items.length > 0 && (
                      <div className="space-y-1 bg-slate-50 dark:bg-slate-800/80 rounded-xl p-2.5 text-xs font-bold">
                        {req.items.map((i) => (
                          <div key={i.packageId} className="flex items-center justify-between">
                            <span>{i.packageLabel}</span>
                            <span className="tabular-nums text-[#1A365D] dark:text-[#FDE68A]">
                              {i.quantity} كرت × {i.unitPrice} = {i.quantity * i.unitPrice} ر.ي
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs font-extrabold tabular-nums">
                      <span>الإجمالي: {req.totalCards} كرت</span>
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {formatYER(req.totalAmount, hideNumbers)}
                      </span>
                    </div>

                    {req.rejectionReason && (
                      <div className="text-[11px] font-bold text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg p-2">
                        سبب الرفض: {req.rejectionReason}
                      </div>
                    )}

                    {canExecute && (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await approveTopupRequest(req);
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          اعتماد وتنفيذ ✅
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRejectTarget(req);
                            setRejectReason('');
                          }}
                          className="min-h-[40px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center justify-center gap-1"
                        >
                          <XCircle className="w-4 h-4" />
                          رفض مع السبب
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* NEW TOPUP REQUEST COMPOSER MODAL (Agents & Clients) */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[92dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3.5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-white">إرسال طلب تغذية جديد</h3>
                <p className="text-[11px] font-bold text-[#FDE68A]">
                  سيُوجّه تلقائياً إلى:{' '}
                  {profile?.role === 'client' && profile.parentAgentId
                    ? 'الوكيل المباشر'
                    : SUPER_ADMIN_CONFIG.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {displayPackages.map((pkg) => {
                  const theme = getPackageThemeStyle(pkg.price);
                  const qty = reqCart[pkg.id] || 0;
                  const unitPrice = Math.round((pkg.price * myRate) / 100);
                  return (
                    <div
                      key={pkg.id}
                      className={`rounded-2xl border-2 ${theme.border} overflow-hidden bg-slate-50 dark:bg-slate-800`}
                    >
                      <div className={`bg-gradient-to-l ${theme.headerBg} px-2.5 py-1.5 text-white`}>
                        <div className="text-xs font-extrabold">{pkg.price} ر.ي ({pkg.dataLabel})</div>
                        <div className="text-[10px]">سعر التغذية: {unitPrice} ر.ي</div>
                      </div>
                      <div className="p-2 flex items-center justify-between gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setReqCart((prev) => ({ ...prev, [pkg.id]: (prev[pkg.id] || 0) + 10 }))
                          }
                          className="w-8 h-8 rounded-lg bg-[#1A365D] text-white flex items-center justify-center"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-extrabold tabular-nums">{qty}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setReqCart((prev) => ({
                              ...prev,
                              [pkg.id]: Math.max(0, (prev[pkg.id] || 0) - 10),
                            }))
                          }
                          className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <input
                type="text"
                value={reqNotes}
                onChange={(e) => setReqNotes(e.target.value)}
                placeholder="ملاحظات إضافية لطلب التغذية (اختياري)"
                className="w-full min-h-[42px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
              />

              <div className="rounded-xl bg-[#1A365D] text-white p-3 flex items-center justify-between text-xs font-extrabold tabular-nums">
                <span>الإجمالي: {composedTotals.cards} كرت</span>
                <span className="text-[#FDE68A]">{formatYER(composedTotals.amount)}</span>
              </div>

              <button
                type="button"
                disabled={busy || composedItems.length === 0}
                onClick={handleSubmitNewTopup}
                className="w-full min-h-[46px] gold-btn-3d text-[#0F172A] text-sm font-extrabold rounded-xl disabled:opacity-50"
              >
                {busy ? 'جاري إرسال الطلب...' : 'تأكيد وإرسال طلب التغذية فوراً'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECT REASON MODAL */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-red-500 p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-red-600">سبب رفض طلب التغذية</h3>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="اكتب سبب الرفض لإشعار مقدم الطلب..."
              className="w-full rounded-xl border-2 border-red-500/75 dark:border-red-400/70 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold shadow-sm focus:border-red-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                await rejectTopupRequest(rejectTarget, rejectReason);
                setRejectTarget(null);
              }}
              className="w-full min-h-[42px] rounded-xl bg-red-600 text-white text-xs font-extrabold"
            >
              تأكيد الرفض وإرسال الإشعار
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
