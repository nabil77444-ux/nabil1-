import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  CloudOff,
  Inbox,
  MessageCircle,
  Minus,
  Phone,
  Plus,
  Send,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { normalizeDigits } from '../lib/firebase';
import { openWhatsAppShare } from '../lib/exportUtils';
import { isOfflineQueuedTopupId } from '../lib/offlineSyncQueue';
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
  offlinePendingCount: number;
  totalCards: number;
  totalAmount: number;
}

function getParentAgentIdOf(user?: {
  parentAgentId?: string;
  agentId?: string;
  parentId?: string;
  createdBy?: string;
} | null): string {
  if (!user) return '';
  for (const cand of [user.parentAgentId, user.agentId, user.parentId, user.createdBy]) {
    if (typeof cand === 'string') {
      const t = cand.trim();
      if (t && t !== 'super_admin') return t;
    }
  }
  return '';
}

export const TopupRequestsScreen: React.FC<TopupRequestsScreenProps> = ({ hideNumbers }) => {
  const {
    profile,
    packages,
    topupRequests,
    managedUsers,
    personalStockSplit,
    appSettings,
    isOnline,
    prefillTopupPackageId,
    clearPrefillTopupPackage,
    submitTopupRequest,
    approveTopupRequest,
    rejectTopupRequest,
  } = useFirebase();

  const displayPackages = packages.length > 0 ? packages : (EXCLUSIVE_PACKAGES as PackageDoc[]);
  const isAdmin = profile?.role === 'super_admin';
  const isAgent = profile?.role === 'agent';
  const isClient = profile?.role === 'client';
  const canSubmitRequest = !isAdmin;

  // Agent 2-tab switcher: 'incoming' (طلبات عملائي) | 'outgoing' (طلباتي للإدارة)
  const [agentTab, setAgentTab] = useState<'incoming' | 'outgoing'>('incoming');

  // Resolve client's parent agent ID & display name gracefully without reading agent PII docs
  const clientParentAgentId = useMemo(
    () => (isClient ? getParentAgentIdOf(profile) : ''),
    [isClient, profile]
  );

  const resolvedTargetLabel = useMemo(() => {
    if (isClient && clientParentAgentId) {
      const fromProfile = profile?.parentAgentName?.trim();
      if (fromProfile) return fromProfile;
      const fromUsers = managedUsers.find((u) => u.uid === clientParentAgentId)?.name;
      if (fromUsers) return fromUsers;
      const fromPrevTopup = topupRequests.find(
        (r) =>
          (r.targetAgentId === clientParentAgentId || r.targetId === clientParentAgentId) &&
          r.targetName &&
          r.targetName !== 'الوكيل المباشر'
      )?.targetName;
      if (fromPrevTopup) return fromPrevTopup;
      return 'وكيلك المباشر';
    }
    return SUPER_ADMIN_CONFIG.name;
  }, [isClient, clientParentAgentId, profile?.parentAgentName, managedUsers, topupRequests]);

  // Sub-clients belonging to this agent (for legacy backward compatibility)
  const mySubClientIds = useMemo(() => {
    if (!isAgent || !profile?.uid) return new Set<string>();
    return new Set(
      managedUsers
        .filter((u) => getParentAgentIdOf(u) === profile.uid)
        .map((u) => u.uid)
    );
  }, [isAgent, profile?.uid, managedUsers]);

  // Agent Incoming Requests (strictly from clients belonging to this agent)
  const agentIncomingRequests = useMemo(() => {
    if (!isAgent || !profile?.uid) return [];
    const uid = profile.uid;
    return topupRequests
      .filter((req) => {
        if (req.requesterId === uid) return false;
        return (
          req.targetAgentId === uid ||
          req.targetId === uid ||
          mySubClientIds.has(req.requesterId)
        );
      })
      .sort((a, b) => {
        // Pending requests strictly pinned at the top, then newest-first
        const aPending = a.status === 'pending' ? 1 : 0;
        const bPending = b.status === 'pending' ? 1 : 0;
        if (aPending !== bPending) return bPending - aPending;
        return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
      });
  }, [isAgent, profile?.uid, topupRequests, mySubClientIds]);

  const agentIncomingPendingCount = useMemo(
    () => agentIncomingRequests.filter((r) => r.status === 'pending').length,
    [agentIncomingRequests]
  );

  // Agent Outgoing Requests (strictly agent's own requests sent to Super Admin)
  const agentOutgoingRequests = useMemo(() => {
    if (!isAgent || !profile?.uid) return [];
    return topupRequests
      .filter((req) => req.requesterId === profile.uid)
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }, [isAgent, profile?.uid, topupRequests]);

  // Client Own Requests
  const clientOwnRequests = useMemo(() => {
    if (!isClient || !profile?.uid) return [];
    return topupRequests
      .filter((req) => req.requesterId === profile.uid)
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }, [isClient, profile?.uid, topupRequests]);

  // Super Admin Requests: ONLY requests directed to Super Admin (agents + direct admin clients; never mix agent sub-clients)
  const adminDirectedRequests = useMemo(() => {
    if (!isAdmin) return [];
    return topupRequests.filter((req) => {
      if (req.targetRole === 'agent') return false;
      if (req.targetAgentId && req.targetAgentId !== 'super_admin') return false;
      if (req.targetId && req.targetId !== 'super_admin') return false;
      if (req.requesterRole === 'client') {
        const requesterDoc = managedUsers.find((u) => u.uid === req.requesterId);
        if (getParentAgentIdOf(requesterDoc)) return false;
      }
      return true;
    });
  }, [isAdmin, topupRequests, managedUsers]);

  // Group requests by Requester for Super Admin view
  const groupedAdminCards = useMemo<GroupedRequester[]>(() => {
    if (!isAdmin) return [];
    const map = new Map<string, GroupedRequester>();
    for (const req of adminDirectedRequests) {
      const isOff = isOfflineQueuedTopupId(req.id);
      const existing = map.get(req.requesterId);
      if (existing) {
        existing.requests.push(req);
        if (req.status === 'pending') existing.pendingCount += 1;
        if (isOff) existing.offlinePendingCount += 1;
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
          targetName: req.targetName || SUPER_ADMIN_CONFIG.name,
          requests: [req],
          pendingCount: req.status === 'pending' ? 1 : 0,
          offlinePendingCount: isOff ? 1 : 0,
          totalCards: Number(req.totalCards) || 0,
          totalAmount: Number(req.totalAmount) || 0,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.pendingCount - a.pendingCount);
  }, [isAdmin, adminDirectedRequests, appSettings]);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const selectedGroup = useMemo(
    () => groupedAdminCards.find((g) => g.requesterId === selectedGroupId) || null,
    [groupedAdminCards, selectedGroupId]
  );

  // New topup request modal (for Agents & Clients)
  const [showNewModal, setShowNewModal] = useState(false);
  const [reqCart, setReqCart] = useState<Record<string, number>>({});
  const [reqNotes, setReqNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Last submitted request summary for optional WhatsApp copy button
  const [lastSubmittedSummary, setLastSubmittedSummary] = useState<{
    items: TopupLineItem[];
    totalCards: number;
    totalAmount: number;
    notes: string;
    targetLabel: string;
    wasOffline: boolean;
  } | null>(null);

  // Reject reason modal
  const [rejectTarget, setRejectTarget] = useState<TopupRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Auto-open composer pre-filled when navigating via low-stock "اطلب تغذية" shortcut
  useEffect(() => {
    if (!prefillTopupPackageId || !canSubmitRequest) return;
    if (isAgent) setAgentTab('outgoing');
    setReqCart((prev) => ({
      ...prev,
      [prefillTopupPackageId]: Math.max(prev[prefillTopupPackageId] || 0, 10),
    }));
    setShowNewModal(true);
    clearPrefillTopupPackage();
  }, [prefillTopupPackageId, canSubmitRequest, isAgent, clearPrefillTopupPackage]);

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

  const setPackageQty = (pkgId: string, nextQty: number) => {
    const clean = Math.max(0, Math.min(9999, Math.floor(nextQty || 0)));
    setReqCart((prev) => {
      const copy = { ...prev };
      if (clean === 0) delete copy[pkgId];
      else copy[pkgId] = clean;
      return copy;
    });
  };

  const handleSubmitNewTopup = async () => {
    if (composedItems.length === 0 || busy) return;
    setBusy(true);
    const snapshotItems = [...composedItems];
    const snapshotCards = composedTotals.cards;
    const snapshotAmount = composedTotals.amount;
    const snapshotNotes = reqNotes.trim();
    const wasOffline = !isOnline;
    const targetLabel = resolvedTargetLabel;
    try {
      const ok = await submitTopupRequest({ items: snapshotItems, notes: snapshotNotes });
      if (ok) {
        setLastSubmittedSummary({
          items: snapshotItems,
          totalCards: snapshotCards,
          totalAmount: snapshotAmount,
          notes: snapshotNotes,
          targetLabel,
          wasOffline,
        });
        setReqCart({});
        setReqNotes('');
        setShowNewModal(false);
        if (isAgent) setAgentTab('outgoing');
      }
    } finally {
      setBusy(false);
    }
  };

  const buildWhatsAppTopupMessage = (summary: NonNullable<typeof lastSubmittedSummary>): string => {
    const lines = [
      '📶 *طلب تغذية كروت — شبكة طيبة نت (TAIBAH NET)*',
      `👤 مقدم الطلب: ${profile?.name || 'مستخدم طيبة نت'} (${getRoleArabicLabel(profile?.role || 'client')})`,
      profile?.phone ? `📞 الهاتف: ${profile.phone}` : '',
      `🎯 موجّه إلى: ${summary.targetLabel}`,
      '────────────────────',
      ...summary.items.map(
        (i) => `🔹 ${i.packageLabel}: ${i.quantity} كرت × ${i.unitPrice} = ${i.quantity * i.unitPrice} ر.ي`
      ),
      '────────────────────',
      `📦 إجمالي الكروت: ${summary.totalCards} كرت`,
      `💰 التكلفة الإجمالية: ${summary.totalAmount.toLocaleString('en-US')} ر.ي`,
      summary.notes ? `📝 ملاحظات: ${summary.notes}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  };

  const renderStatusPill = (req: TopupRequest) => {
    const isOffQueued = isOfflineQueuedTopupId(req.id);
    if (isOffQueued) {
      return (
        <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-lg flex items-center gap-1 bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200 border border-blue-400/60">
          <CloudOff className="w-3 h-3 shrink-0" />
          بانتظار الإرسال عند توفر الإنترنت
        </span>
      );
    }
    if (req.status === 'pending') {
      return (
        <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-lg flex items-center gap-1 bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          <Clock className="w-3 h-3 shrink-0" /> قيد الانتظار
        </span>
      );
    }
    if (req.status === 'approved') {
      return (
        <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-lg flex items-center gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          <CheckCircle2 className="w-3 h-3 shrink-0" /> تمت التغذية ✅
        </span>
      );
    }
    return (
      <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-lg flex items-center gap-1 bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">
        <XCircle className="w-3 h-3 shrink-0" /> مرفوض
      </span>
    );
  };

  // Reusable clean request card for Client Own Requests & Agent Outgoing Requests
  const renderOutgoingRequestCard = (req: TopupRequest) => {
    const targetDisplay =
      req.targetName && req.targetName !== 'الوكيل المباشر'
        ? req.targetName
        : req.targetRole === 'admin' || req.targetId === 'super_admin'
          ? SUPER_ADMIN_CONFIG.name
          : resolvedTargetLabel;

    return (
      <div
        key={req.id}
        className="royal-tile-3d rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/80 p-3.5 shadow-md space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A] truncate">
              موجّه إلى: {targetDisplay}
            </div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
              {formatDateTimeAr(req.createdAt)}
            </div>
          </div>
          {renderStatusPill(req)}
        </div>

        {req.items && req.items.length > 0 && (
          <div className="space-y-1 bg-slate-50 dark:bg-slate-800/80 rounded-xl p-2.5 text-xs font-bold">
            {req.items.map((i) => (
              <div key={i.packageId} className="flex items-center justify-between gap-2">
                <span>{i.packageLabel}</span>
                <span className="tabular-nums text-[#1A365D] dark:text-[#FDE68A]">
                  {i.quantity} كرت × {i.unitPrice} = {i.quantity * i.unitPrice} ر.ي
                </span>
              </div>
            ))}
          </div>
        )}

        {req.notes && (
          <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-lg px-2.5 py-1.5">
            ملاحظات: {req.notes}
          </div>
        )}

        <div className="flex items-center justify-between text-xs font-extrabold tabular-nums pt-1 border-t border-slate-200 dark:border-slate-800">
          <span>الإجمالي: {formatCount(req.totalCards, hideNumbers)} كرت</span>
          <span className="text-emerald-700 dark:text-emerald-400">
            {formatYER(req.totalAmount, hideNumbers)}
          </span>
        </div>

        {req.rejectionReason && (
          <div className="text-[11px] font-bold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-800/60 rounded-xl p-2.5">
            سبب الرفض: {req.rejectionReason}
          </div>
        )}
      </div>
    );
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
              {isAgent
                ? 'استقبال وتنفيذ طلبات عملائك مباشرة + إرسال طلباتك للإدارة'
                : isClient && clientParentAgentId
                  ? `سيتم إرسال طلباتك تلقائياً إلى وكيلك: ${resolvedTargetLabel}`
                  : `توجيه تلقائي لحظي (العميل ← الوكيل المباشر ← ${SUPER_ADMIN_CONFIG.name})`}
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

      {/* CLIENT ROUTING TARGET BANNER */}
      {isClient && (
        <div className="rounded-2xl bg-blue-50 dark:bg-blue-950/35 border-2 border-[#1A365D]/40 dark:border-blue-500/40 px-3.5 py-2.5 flex items-center gap-2.5 shadow-xs">
          <div className="w-9 h-9 rounded-xl bg-[#1A365D] text-[#FDE68A] flex items-center justify-center shrink-0">
            <UserCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0 text-xs font-extrabold text-[#1A365D] dark:text-blue-100 leading-snug">
            {clientParentAgentId ? (
              <>
                سيتم إرسال الطلب إلى وكيلك:{' '}
                <span className="text-emerald-700 dark:text-[#FDE68A]">{resolvedTargetLabel}</span>
              </>
            ) : (
              <>
                سيتم إرسال الطلب إلى الإدارة العامة:{' '}
                <span className="text-emerald-700 dark:text-[#FDE68A]">{SUPER_ADMIN_CONFIG.name}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* AGENT 2-TAB BAR: «طلبات عملائي» (الواردة) | «طلباتي للإدارة» (الصادرة) */}
      {isAgent && (
        <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/80 shadow-sm">
          <button
            type="button"
            onClick={() => setAgentTab('incoming')}
            className={`min-h-[44px] rounded-xl px-3 text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all ${
              agentTab === 'incoming'
                ? 'royal-btn-3d text-white shadow-md'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Inbox className="w-4 h-4 shrink-0" />
            <span>طلبات عملائي</span>
            {agentIncomingPendingCount > 0 && (
              <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-600 text-white text-[11px] font-black flex items-center justify-center tabular-nums shadow">
                {agentIncomingPendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setAgentTab('outgoing')}
            className={`min-h-[44px] rounded-xl px-3 text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all ${
              agentTab === 'outgoing'
                ? 'royal-btn-3d text-white shadow-md'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Send className="w-4 h-4 shrink-0" />
            <span>طلباتي للإدارة</span>
            {agentOutgoingRequests.length > 0 && (
              <span className="min-w-[20px] h-[20px] px-1 rounded-full bg-[#D4AF37]/25 text-current text-[10.5px] font-extrabold flex items-center justify-center tabular-nums">
                {agentOutgoingRequests.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Submit New Topup Request Button (Clients always, Agents on Outgoing tab or quick button) */}
      {canSubmitRequest && (!isAgent || agentTab === 'outgoing') && (
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="w-full min-h-[48px] gold-btn-3d text-[#0F172A] font-extrabold text-sm rounded-2xl flex items-center justify-center gap-2 shadow-lg"
        >
          <Plus className="w-5 h-5" />
          <span>
            {isAgent
              ? '+ إرسال طلب تغذية جديد للإدارة'
              : clientParentAgentId
                ? `+ إرسال طلب تغذية إلى وكيلك (${resolvedTargetLabel})`
                : '+ إرسال طلب تغذية جديد'}
          </span>
        </button>
      )}

      {/* Post-Submit Confirmation & Optional WhatsApp Copy Banner */}
      {lastSubmittedSummary && canSubmitRequest && (!isAgent || agentTab === 'outgoing') && (
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/35 border-2 border-emerald-500 p-3.5 shadow-md space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-extrabold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {lastSubmittedSummary.wasOffline
                    ? 'تم حفظ طلب التغذية محلياً وسيُرسل تلقائياً فور عودة الإنترنت'
                    : `تم إرسال طلب التغذية إلى ${lastSubmittedSummary.targetLabel} بنجاح ✅`}
                </span>
              </h3>
              <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mt-0.5 tabular-nums">
                الإجمالي: {lastSubmittedSummary.totalCards} كرت —{' '}
                {formatYER(lastSubmittedSummary.totalAmount, hideNumbers)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLastSubmittedSummary(null)}
              aria-label="إغلاق"
              className="w-7 h-7 rounded-full bg-emerald-600/15 text-emerald-800 dark:text-emerald-200 flex items-center justify-center shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              openWhatsAppShare(
                SUPER_ADMIN_CONFIG.phone,
                buildWhatsAppTopupMessage(lastSubmittedSummary)
              )
            }
            className="w-full min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow"
          >
            <MessageCircle className="w-4 h-4" />
            <span>إرسال نسخة للواتساب — اختياري</span>
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* VIEW 1: AGENT — TAB 1 «طلبات عملائي» (INCOMING CLIENT REQUESTS)   */}
      {/* ================================================================= */}
      {isAgent && agentTab === 'incoming' && (
        <>
          {agentIncomingRequests.length === 0 ? (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/60 p-8 text-center">
              <Inbox className="w-10 h-10 mx-auto text-[#D4AF37] mb-2" />
              <h3 className="text-sm font-extrabold">لا توجد طلبات تغذية واردة من عملائك حالياً (0)</h3>
              <p className="text-xs text-slate-500 mt-1">
                أي طلب تغذية يرسله أحد عملائك سيظهر هنا فوراً لتتمكن من تغذيته مباشرة من مخزونك أو رفضه.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {agentIncomingRequests.map((req) => {
                const firstLetter = req.requesterName.trim().charAt(0) || 'ع';
                const isPending = req.status === 'pending' && !isOfflineQueuedTopupId(req.id);
                return (
                  <div
                    key={req.id}
                    className={`royal-tile-3d rounded-2xl bg-white dark:bg-slate-900 border-2 p-3.5 shadow-md space-y-3 ${
                      isPending
                        ? 'border-amber-500 dark:border-[#D4AF37] ring-1 ring-amber-400/40'
                        : 'border-[#D4AF37]/65'
                    }`}
                  >
                    {/* Top Row: Client Identity + Status */}
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-11 h-11 rounded-2xl bg-[#1A365D] border-2 border-[#D4AF37] text-[#FDE68A] text-lg font-extrabold flex items-center justify-center shrink-0 shadow">
                          {firstLetter}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                            {req.requesterName}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            {req.requesterPhone && (
                              <span dir="ltr" className="inline-flex items-center gap-0.5 tabular-nums">
                                <Phone className="w-3 h-3 text-[#1A365D] dark:text-[#FDE68A]" />
                                {req.requesterPhone}
                              </span>
                            )}
                            <span className="tabular-nums">{formatDateTimeAr(req.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0">{renderStatusPill(req)}</div>
                    </div>

                    {/* Requested Packages Breakdown + Agent's Current Available Stock */}
                    {req.items && req.items.length > 0 && (
                      <div className="space-y-1.5 bg-slate-50 dark:bg-slate-800/80 rounded-xl p-2.5 text-xs font-bold">
                        {req.items.map((item) => {
                          const myAvail = personalStockSplit.electronicByPkg[item.packageId] ?? 0;
                          const isShort = isPending && myAvail < item.quantity;
                          return (
                            <div
                              key={item.packageId}
                              className="flex flex-wrap items-center justify-between gap-1.5"
                            >
                              <div className="min-w-0">
                                <span>{item.packageLabel}</span>
                                {isPending && (
                                  <span
                                    className={`mr-1.5 text-[10px] font-extrabold px-1.5 py-0.5 rounded-md tabular-nums ${
                                      isShort
                                        ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                    }`}
                                  >
                                    مخزونك: {myAvail}
                                  </span>
                                )}
                              </div>
                              <span className="tabular-nums text-[#1A365D] dark:text-[#FDE68A]">
                                {item.quantity} كرت × {item.unitPrice} = {item.quantity * item.unitPrice} ر.ي
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {req.notes && (
                      <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-lg px-2.5 py-1.5">
                        ملاحظات العميل: {req.notes}
                      </div>
                    )}

                    {/* Totals Strip */}
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#1A365D]/5 dark:bg-slate-800/90 px-3 py-2 text-xs font-extrabold tabular-nums">
                      <div className="text-slate-700 dark:text-slate-200">
                        إجمالي الكروت:{' '}
                        <span className="text-blue-700 dark:text-blue-400">
                          {formatCount(req.totalCards, hideNumbers)} كرت
                        </span>
                      </div>
                      <div className="text-left text-emerald-700 dark:text-emerald-400">
                        {formatYER(req.totalAmount, hideNumbers)}
                      </div>
                    </div>

                    {req.rejectionReason && (
                      <div className="text-[11px] font-bold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/35 rounded-xl p-2">
                        سبب الرفض: {req.rejectionReason}
                      </div>
                    )}

                    {/* Direct Agent Action Buttons */}
                    {isPending && (
                      <div className="grid grid-cols-2 gap-2 pt-0.5">
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
                          className="min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-60"
                        >
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>موافقة وتغذية العميل</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRejectTarget(req);
                            setRejectReason('');
                          }}
                          className="min-h-[42px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-60"
                        >
                          <XCircle className="w-4 h-4 shrink-0" />
                          <span>رفض الطلب</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* VIEW 2: AGENT — TAB 2 «طلباتي للإدارة» (AGENT OUTGOING REQUESTS)  */}
      {/* ================================================================= */}
      {isAgent && agentTab === 'outgoing' && (
        <>
          {agentOutgoingRequests.length === 0 ? (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/60 p-8 text-center">
              <Send className="w-10 h-10 mx-auto text-[#D4AF37] mb-2" />
              <h3 className="text-sm font-extrabold">لم ترسل أي طلبات تغذية للإدارة بعد (0)</h3>
              <p className="text-xs text-slate-500 mt-1">
                اضغط على «+ إرسال طلب تغذية جديد للإدارة» لطلب كروت جديدة وتغذية مخزونك.
              </p>
            </div>
          ) : (
            <div className="space-y-3">{agentOutgoingRequests.map(renderOutgoingRequestCard)}</div>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* VIEW 3: CLIENT — OWN REQUESTS LIST                                */}
      {/* ================================================================= */}
      {isClient && (
        <>
          {clientOwnRequests.length === 0 ? (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/60 p-8 text-center">
              <Send className="w-10 h-10 mx-auto text-[#D4AF37] mb-2" />
              <h3 className="text-sm font-extrabold">لا توجد طلبات تغذية مسجلة حالياً (0)</h3>
              <p className="text-xs text-slate-500 mt-1">
                {clientParentAgentId
                  ? `سيتم إرسال طلبات التغذية مباشرة إلى وكيلك (${resolvedTargetLabel}) لتغذية مخزونك فوراً.`
                  : `سيتم إرسال طلبات التغذية مباشرة إلى الإدارة العامة (${SUPER_ADMIN_CONFIG.name}).`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">{clientOwnRequests.map(renderOutgoingRequestCard)}</div>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* VIEW 4: SUPER ADMIN — GROUPED REQUESTS DIRECTED TO SUPER ADMIN    */}
      {/* ================================================================= */}
      {isAdmin && (
        <>
          {groupedAdminCards.length === 0 ? (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/60 p-8 text-center">
              <Send className="w-10 h-10 mx-auto text-[#D4AF37] mb-2" />
              <h3 className="text-sm font-extrabold">لا توجد طلبات تغذية موجّهة للإدارة حالياً (0)</h3>
              <p className="text-xs text-slate-500 mt-1">
                طلبات التغذية من الوكلاء والعملاء المباشرين تظهر هنا فوراً للتنفيذ، بينما تُوجَّه طلبات عملاء الوكلاء تلقائياً إلى وكلائهم.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {groupedAdminCards.map((group) => {
                const firstLetter = group.requesterName.trim().charAt(0) || 'ط';
                const hasPending = group.pendingCount > 0;
                const actionablePending = group.requests.find(
                  (r) => r.status === 'pending' && !isOfflineQueuedTopupId(r.id)
                );
                return (
                  <div
                    key={group.requesterId}
                    className="royal-tile-3d rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-3.5 shadow-md space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2.5">
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

                      <span
                        className={`shrink-0 px-2.5 py-1 rounded-xl text-[11px] font-extrabold ${
                          group.offlinePendingCount > 0
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200'
                            : hasPending
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}
                      >
                        {group.offlinePendingCount > 0
                          ? `أوفلاين (${group.offlinePendingCount})`
                          : hasPending
                            ? `قيد الانتظار (${group.pendingCount})`
                            : 'تمت التغذية ✅'}
                      </span>
                    </div>

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

                    {actionablePending && (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await approveTopupRequest(actionablePending);
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1 shadow-xs disabled:opacity-60"
                        >
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>قبول وتغذية مباشرة ✅</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRejectTarget(actionablePending);
                            setRejectReason('');
                          }}
                          className="min-h-[38px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center justify-center gap-1 shadow-xs disabled:opacity-60"
                        >
                          <XCircle className="w-4 h-4 shrink-0" />
                          <span>رفض الطلب</span>
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                        إلى: {group.targetName}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedGroupId(group.requesterId)}
                        className="min-h-[38px] px-4 rounded-xl royal-btn-3d text-white text-xs font-extrabold flex items-center gap-1.5"
                      >
                        <span>عرض السجل والتفاصيل</span>
                        <ArrowLeft className="w-4 h-4 text-[#FDE68A]" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* GROUP DETAIL & EXECUTION MODAL (Super Admin) */}
      {selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 overflow-y-auto">
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
                const isOffQueued = isOfflineQueuedTopupId(req.id);
                const canExecute = req.status === 'pending' && !isOffQueued && isAdmin;

                return (
                  <div
                    key={req.id}
                    className="rounded-2xl border-2 border-[#D4AF37]/70 dark:border-[#D4AF37]/55 p-3.5 space-y-2.5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-extrabold tabular-nums">
                        {formatDateTimeAr(req.createdAt)}
                      </span>
                      {renderStatusPill(req)}
                    </div>

                    {req.items && req.items.length > 0 && (
                      <div className="space-y-1 bg-slate-50 dark:bg-slate-800/80 rounded-xl p-2.5 text-xs font-bold">
                        {req.items.map((i) => (
                          <div key={i.packageId} className="flex items-center justify-between gap-2">
                            <span>{i.packageLabel}</span>
                            <span className="tabular-nums text-[#1A365D] dark:text-[#FDE68A]">
                              {i.quantity} كرت × {i.unitPrice} = {i.quantity * i.unitPrice} ر.ي
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {req.notes && (
                      <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-lg px-2.5 py-1.5">
                        ملاحظات: {req.notes}
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
                          قبول وتغذية مباشرة ✅
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[92dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3.5 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-white">إرسال طلب تغذية جديد</h3>
                <p className="text-[11px] font-bold text-[#FDE68A] truncate">
                  {isClient && clientParentAgentId
                    ? `سيتم إرسال الطلب إلى وكيلك: ${resolvedTargetLabel}`
                    : `سيتم إرسال الطلب إلى: ${SUPER_ADMIN_CONFIG.name}`}{' '}
                  · تسعيرة حسابك ({myRate}%)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!isOnline && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-400 px-3 py-2 text-[11px] font-extrabold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                  <CloudOff className="w-4 h-4 shrink-0" />
                  <span>أنت بدون إنترنت حالياً — سيُحفظ طلبك محلياً ويُرسل تلقائياً فور عودة الاتصال.</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {displayPackages.map((pkg) => {
                  const theme = getPackageThemeStyle(pkg.price);
                  const qty = reqCart[pkg.id] || 0;
                  const unitPrice = Math.round((pkg.price * myRate) / 100);
                  return (
                    <div
                      key={pkg.id}
                      className={`rounded-2xl border-2 ${theme.border} overflow-hidden bg-slate-50 dark:bg-slate-800 ${
                        qty > 0 ? 'ring-2 ring-[#D4AF37]' : ''
                      }`}
                    >
                      <div className={`bg-gradient-to-l ${theme.headerBg} px-2.5 py-1.5 text-white`}>
                        <div className="text-xs font-extrabold">
                          {pkg.price} ر.ي ({pkg.dataLabel})
                        </div>
                        <div className="text-[10px] font-bold opacity-95">
                          سعر التغذية: {unitPrice} ر.ي
                        </div>
                      </div>
                      <div className="p-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => setPackageQty(pkg.id, qty + 1)}
                            aria-label="زيادة 1"
                            className="w-7 h-7 rounded-lg bg-[#1A365D] text-white flex items-center justify-center shrink-0 active:scale-95"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
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
                            value={qty === 0 ? '' : String(qty)}
                            placeholder="0"
                            onChange={(e) => {
                              const digits = normalizeDigits(e.target.value).replace(/[^\d]/g, '').slice(0, 4);
                              setPackageQty(pkg.id, digits ? Number.parseInt(digits, 10) : 0);
                            }}
                            aria-label={`عدد كروت باقة ${pkg.price}`}
                            className="w-12 h-7 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-center text-xs font-extrabold tabular-nums focus:border-[#D4AF37] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setPackageQty(pkg.id, Math.max(0, qty - 1))}
                            disabled={qty === 0}
                            aria-label="إنقاص 1"
                            className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 disabled:opacity-45 active:scale-95"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => setPackageQty(pkg.id, qty + 10)}
                            className="flex-1 py-0.5 rounded-md bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/40 text-[10px] font-extrabold"
                          >
                            +10
                          </button>
                          <button
                            type="button"
                            onClick={() => setPackageQty(pkg.id, qty + 25)}
                            className="flex-1 py-0.5 rounded-md bg-blue-600/15 text-blue-800 dark:text-blue-300 border border-blue-500/40 text-[10px] font-extrabold"
                          >
                            +25
                          </button>
                          {qty > 0 && (
                            <button
                              type="button"
                              onClick={() => setPackageQty(pkg.id, 0)}
                              className="px-1.5 py-0.5 rounded-md bg-red-600/15 text-red-700 dark:text-red-300 text-[10px] font-extrabold"
                            >
                              مسح
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <input
                type="text"
                inputMode="text"
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
                {busy
                  ? 'جاري إرسال الطلب...'
                  : isOnline
                    ? 'تأكيد وإرسال طلب التغذية فوراً'
                    : 'حفظ الطلب محلياً وإرساله فور عودة الإنترنت'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECT REASON MODAL */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
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
            <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
              صاحب الطلب: <span className="font-extrabold text-slate-900 dark:text-white">{rejectTarget.requesterName}</span> ({rejectTarget.totalCards} كرت)
            </div>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="اكتب سبب الرفض (اختياري) لإشعار صاحب الطلب..."
              className="w-full rounded-xl border-2 border-red-500/75 dark:border-red-400/70 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold shadow-sm focus:border-red-600 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await rejectTopupRequest(rejectTarget, rejectReason);
                  setRejectTarget(null);
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full min-h-[42px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold disabled:opacity-60"
            >
              تأكيد الرفض وإرسال الإشعار
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
