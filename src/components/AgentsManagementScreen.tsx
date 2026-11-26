import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import { normalizeDigits } from '../lib/firebase';
import { ContactPickerButton } from './ContactPickerButton';
import { AgentCardAuditModal } from './AgentCardAuditModal';
import {
  formatCount,
  formatDateTimeAr,
  formatYER,
  getRoleArabicLabel,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type RegistrationRequest,
  type UserProfile,
} from '../types/taibah';

interface AgentsManagementScreenProps {
  hideNumbers: boolean;
}

export const AgentsManagementScreen: React.FC<AgentsManagementScreenProps> = ({ hideNumbers }) => {
  const {
    profile,
    managedUsers,
    pendingRegistrations,
    pendingPasswordResets,
    appSettings,
    approveRegistration,
    rejectRegistration,
    createManualUser,
    updateManagedUser,
    toggleUserRoleUpgrade,
    toggleUserSuspension,
    adminChangeUserPassword,
    transferClientsToAgent,
    deleteManagedUser,
    resolvePasswordReset,
    restoreDeletedAgentsAndClients,
  } = useFirebase();
  const { notifySuccess } = useFeedback();

  const isAdmin = profile?.role === 'super_admin';

  // Active sub-panels / modals
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'joins' | 'resets'>('hierarchy');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [managingUser, setManagingUser] = useState<UserProfile | null>(null);
  const [auditTargetUser, setAuditTargetUser] = useState<UserProfile | null>(null);
  const [suspendTargetUser, setSuspendTargetUser] = useState<UserProfile | null>(null);
  const [passwordTargetUser, setPasswordTargetUser] = useState<UserProfile | null>(null);
  const [newPwdValue, setNewPwdValue] = useState('');
  const [confirmPwdValue, setConfirmPwdValue] = useState('');
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [savedPwdSuccess, setSavedPwdSuccess] = useState<{
    name: string;
    phone: string;
    email: string;
    password: string;
  } | null>(null);
  const [copiedPwdCreds, setCopiedPwdCreds] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<RegistrationRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoringAccounts, setRestoringAccounts] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState('');
  const [restoreResult, setRestoreResult] = useState<{
    ok: boolean;
    summary: string;
    sourcesSummary?: string;
  } | null>(null);

  // Add User Form
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<'agent' | 'client'>('client');
  const [addParentAgent, setAddParentAgent] = useState('');

  // Manage Account Form
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRate, setEditRate] = useState('80');
  const [editBalance, setEditBalance] = useState('0');
  const [editStatus, setEditStatus] = useState<UserProfile['status']>('active');

  // Transfer Clients Form
  const [selectedTransferUids, setSelectedTransferUids] = useState<string[]>([]);
  const [targetTransferAgentId, setTargetTransferAgentId] = useState('');

  const agents = useMemo(
    () => managedUsers.filter((u) => u.role === 'agent'),
    [managedUsers]
  );

  const clients = useMemo(
    () => managedUsers.filter((u) => u.role === 'client'),
    [managedUsers]
  );

  const directAdminClients = useMemo(() => {
    const agentIds = new Set(agents.map((a) => a.uid));
    return clients.filter((c) => !c.parentAgentId || !agentIds.has(c.parentAgentId));
  }, [clients, agents]);

  const totalBalances = useMemo(
    () => managedUsers.reduce((acc, u) => acc + (Number(u.balance) || 0), 0),
    [managedUsers]
  );

  const openPasswordModal = (target: UserProfile) => {
    if (!isAdmin || target.role === 'super_admin') return;
    setPasswordTargetUser(target);
    setNewPwdValue('');
    setConfirmPwdValue('');
    setShowNewPwd(false);
    setShowConfirmPwd(false);
    setPwdError('');
    setSavedPwdSuccess(null);
    setCopiedPwdCreds(false);
  };

  const closePasswordModal = () => {
    setPasswordTargetUser(null);
    setNewPwdValue('');
    setConfirmPwdValue('');
    setPwdError('');
    setSavedPwdSuccess(null);
    setCopiedPwdCreds(false);
  };

  const buildCredentialsShareText = (info: {
    name: string;
    phone: string;
    email: string;
    password: string;
  }) => {
    const loginId = info.phone?.trim() || info.email?.trim() || '';
    return [
      '📶 تطبيق كروت طيبة نت — TAIBAH NET',
      `تم تحديث بيانات الدخول لحساب: ${info.name}`,
      `👤 اسم المستخدم / رقم الهاتف: ${loginId}`,
      `🔑 كلمة المرور الجديدة: ${info.password}`,
      'يرجى الاحتفاظ ببيانات الدخول بشكل آمن.',
    ].join('\n');
  };

  const handleSaveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !passwordTargetUser || busy) return;
    if (newPwdValue.length < 6) {
      setPwdError('يجب أن تتكون كلمة المرور الجديدة من 6 أحرف أو أرقام على الأقل.');
      return;
    }
    if (newPwdValue !== confirmPwdValue) {
      setPwdError('كلمتا المرور غير متطابقتين — يرجى التأكد وإعادة المحاولة.');
      return;
    }
    setPwdError('');
    setBusy(true);
    try {
      const res = await adminChangeUserPassword(passwordTargetUser, newPwdValue);
      if (res.ok) {
        setSavedPwdSuccess({
          name: passwordTargetUser.name,
          phone: passwordTargetUser.phone || '',
          email: passwordTargetUser.email || '',
          password: newPwdValue,
        });
      } else {
        setPwdError(res.error || 'تعذر حفظ كلمة المرور الجديدة.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCopySavedCredentials = async () => {
    if (!savedPwdSuccess) return;
    const text = buildCredentialsShareText(savedPwdSuccess);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPwdCreds(true);
      notifySuccess('تم نسخ بيانات الدخول الجديدة إلى الحافظة ✅');
    } catch {
      setPwdError('تعذر النسخ التلقائي — يمكنك نسخ كلمة المرور يدوياً.');
    }
  };

  const handleSendCredentialsWhatsApp = () => {
    if (!savedPwdSuccess) return;
    const text = buildCredentialsShareText(savedPwdSuccess);
    const digits = normalizeDigits(savedPwdSuccess.phone || '').replace(/\D/g, '');
    let waPhone = digits;
    if (digits.length === 9 && digits.startsWith('7')) {
      waPhone = `967${digits}`;
    } else if (digits.startsWith('00')) {
      waPhone = digits.slice(2);
    }
    const url = waPhone
      ? `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.location.href = url;
  };

  const openManageModal = (u: UserProfile) => {
    setManagingUser(u);
    setEditName(u.name);
    setEditPhone(u.phone);
    setEditRate(String(u.discountRate || (u.role === 'agent' ? 70 : 80)));
    setEditBalance(String(u.balance || 0));
    setEditStatus(u.status);
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim() || !addPhone.trim()) return;
    setBusy(true);
    try {
      const ok = await createManualUser({
        name: addName.trim(),
        phone: addPhone.trim(),
        email: addEmail.trim() || undefined,
        role: isAdmin ? addRole : 'client',
        parentAgentId: isAdmin ? addParentAgent : profile?.uid || '',
      });
      if (ok) {
        setAddName('');
        setAddPhone('');
        setAddEmail('');
        setShowAddModal(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSaveManage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingUser) return;
    setBusy(true);
    try {
      await updateManagedUser(managingUser.uid, {
        name: editName.trim() || managingUser.name,
        phone: editPhone.trim() || managingUser.phone,
        discountRate: Number(editRate) || managingUser.discountRate,
        balance: Number(editBalance) || 0,
        status: editStatus,
      });
      setManagingUser(null);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmTransfer = async () => {
    if (selectedTransferUids.length === 0) return;
    setBusy(true);
    try {
      await transferClientsToAgent(selectedTransferUids, targetTransferAgentId);
      setSelectedTransferUids([]);
      setShowTransferModal(false);
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreDeletedAccounts = async () => {
    if (!isAdmin || restoringAccounts) return;
    setRestoringAccounts(true);
    setRestoreResult(null);
    setRestoreProgress('جاري فحص النسخ الاحتياطية السحابية والمحلية وسجل العمليات...');
    try {
      const res = await restoreDeletedAgentsAndClients((stage) => {
        setRestoreProgress(stage);
      });
      setRestoreResult({
        ok: res.ok,
        summary: res.summary,
        sourcesSummary: res.sourcesSummary,
      });
    } finally {
      setRestoringAccounts(false);
      setRestoreProgress('');
    }
  };

  return (
    <div className="space-y-3 safe-bottom-clear">
      {/* Header Banner */}
      <div className="royal-header-3d rounded-3xl border-2 border-[#D4AF37] p-4 shadow-xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-white/15 border border-[#D4AF37] flex items-center justify-center text-[#FDE68A] shrink-0">
            <UserCheck className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-white truncate">إدارة الوكلاء والعملاء</h2>
            <p className="text-[11px] font-bold text-[#FDE68A] truncate">
              الهرمية المباشرة • طلبات الانضمام اللحظية • الترقية والنقل
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

      {/* Live Summary Strip */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-[#0F172A] text-white border-2 border-[#D4AF37] p-2.5 text-center shadow">
          <div className="text-[10px] font-bold text-[#FDE68A]">الوكلاء</div>
          <div className="text-base font-extrabold tabular-nums">
            {formatCount(agents.length, hideNumbers)}
          </div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 p-2.5 text-center shadow">
          <div className="text-[10px] font-bold text-slate-500">العملاء</div>
          <div className="text-base font-extrabold text-[#1A365D] dark:text-white tabular-nums">
            {formatCount(clients.length, hideNumbers)}
          </div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-500/70 p-2.5 text-center shadow">
          <div className="text-[10px] font-bold text-slate-500">الأرصدة</div>
          <div className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatYER(totalBalances, hideNumbers)}
          </div>
        </div>
      </div>

      {/* UPDATE 8: Control Bar (Add, Join Requests, Transfer, Password Resets) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="min-h-[42px] rounded-xl gold-btn-3d text-[#0F172A] text-xs font-extrabold flex items-center justify-center gap-1.5 px-2"
        >
          <UserPlus className="w-4 h-4 shrink-0" />
          <span>إضافة وكيل/عميل</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab(activeTab === 'joins' ? 'hierarchy' : 'joins')}
          className={`min-h-[42px] rounded-xl border-2 text-xs font-extrabold flex items-center justify-center gap-1.5 px-2 relative ${
            activeTab === 'joins'
              ? 'bg-[#1A365D] text-[#FDE68A] border-[#D4AF37]'
              : 'bg-white dark:bg-slate-900 border-[#D4AF37]/70 text-slate-800 dark:text-white'
          }`}
        >
          <UserCheck className="w-4 h-4 shrink-0" />
          <span>طلبات الانضمام</span>
          {pendingRegistrations.length > 0 && (
            <span className="min-w-[20px] h-5 px-1 rounded-full bg-[#DC2626] text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums">
              {pendingRegistrations.length}
            </span>
          )}
        </button>

        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              setSelectedTransferUids([]);
              setTargetTransferAgentId('');
              setShowTransferModal(true);
            }}
            className="min-h-[42px] rounded-xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-1.5 px-2"
          >
            <ArrowLeftRight className="w-4 h-4 shrink-0" />
            <span>نقل العملاء</span>
          </button>
        )}

        {isAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab(activeTab === 'resets' ? 'hierarchy' : 'resets')}
            className={`min-h-[42px] rounded-xl border-2 text-xs font-extrabold flex items-center justify-center gap-1.5 px-2 ${
              activeTab === 'resets'
                ? 'bg-[#1A365D] text-[#FDE68A] border-[#D4AF37]'
                : 'bg-white dark:bg-slate-900 border-[#D4AF37]/70 text-slate-800 dark:text-white'
            }`}
          >
            <KeyRound className="w-4 h-4 shrink-0" />
            <span>استعادة المرور</span>
            {pendingPasswordResets.length > 0 && (
              <span className="min-w-[20px] h-5 px-1 rounded-full bg-amber-600 text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                {pendingPasswordResets.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Super Admin Exclusive: Recover Deleted Agents & Clients Tool */}
      {isAdmin && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-600/80 p-3 shadow-sm space-y-2">
          <button
            type="button"
            disabled={restoringAccounts}
            onClick={() => void handleRestoreDeletedAccounts()}
            className="w-full min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-extrabold flex items-center justify-center gap-2 px-3 shadow transition-colors"
          >
            {restoringAccounts ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>جاري البحث والاسترجاع...</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4 shrink-0" />
                <span>استرجاع الوكلاء والعملاء المحذوفين</span>
              </>
            )}
          </button>
          {restoringAccounts && restoreProgress && (
            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 text-center">
              {restoreProgress}
            </p>
          )}
          {restoreResult && (
            <div
              className={`rounded-xl px-3 py-2 text-[11px] font-bold flex items-start justify-between gap-2 border ${
                restoreResult.ok
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200'
              }`}
            >
              <div className="space-y-0.5 leading-relaxed">
                <p>{restoreResult.summary}</p>
                {restoreResult.sourcesSummary && (
                  <p className="text-[10px] opacity-85">المصادر: {restoreResult.sourcesSummary}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRestoreResult(null)}
                className="p-0.5 opacity-70 hover:opacity-100 shrink-0"
                aria-label="إغلاق"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* SECTION A: LIVE JOIN REQUESTS QUEUE (Update 10 — Instant Approve as Client / Agent / Reject) */}
      {(activeTab === 'joins' || pendingRegistrations.length > 0) && (
        <section className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-3.5 shadow-md space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-1.5">
              <UserCheck className="w-4 h-4" />
              <span>طلبات الانضمام الفورية (onSnapshot)</span>
            </h3>
            <span className="text-xs font-extrabold text-red-600 tabular-nums">
              {pendingRegistrations.length} معلق
            </span>
          </div>

          {pendingRegistrations.length === 0 ? (
            <p className="text-center text-xs font-bold text-slate-500 py-3">
              لا توجد طلبات انضمام معلقة حالياً (0)
            </p>
          ) : (
            <div className="space-y-2.5">
              {pendingRegistrations.map((req) => (
                <div
                  key={req.id}
                  className="rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-[#D4AF37]/70 p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-extrabold">{req.name}</div>
                      <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                        {req.phone} · طلب: {req.requestedRole === 'agent' ? 'وكيل معتمد' : 'عميل / نقطة بيع'}
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500">
                      {formatDateTimeAr(req.createdAt)}
                    </span>
                  </div>

                  {/* Update 10: Explicit Approve as Client / Approve as Agent / Reject */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => approveRegistration(req, 'client')}
                      className="min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      قبول كعميل
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => approveRegistration(req, 'agent')}
                        className="min-h-[38px] rounded-xl bg-[#1A365D] hover:bg-[#142a4a] text-[#FDE68A] border border-[#D4AF37] text-[11px] font-extrabold flex items-center justify-center gap-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        قبول كوكيل
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setRejectTarget(req);
                        setRejectReason('');
                      }}
                      className="min-h-[38px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-extrabold flex items-center justify-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      رفض
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SECTION B: PASSWORD RESET REQUESTS QUEUE */}
      {isAdmin && activeTab === 'resets' && (
        <section className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-amber-500 p-3.5 shadow-md space-y-2.5">
          <h3 className="text-sm font-extrabold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <KeyRound className="w-4 h-4" />
            <span>طلبات استعادة كلمة المرور ({pendingPasswordResets.length})</span>
          </h3>
          {pendingPasswordResets.length === 0 ? (
            <p className="text-center text-xs font-bold text-slate-500 py-3">
              لا توجد طلبات استعادة كلمة مرور معلقة حالياً (0)
            </p>
          ) : (
            pendingPasswordResets.map((pr) => (
              <div
                key={pr.id}
                className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <div className="text-xs font-extrabold">{pr.name || 'مستخدم طيبة نت'}</div>
                  <div className="text-[11px] font-bold text-slate-500 tabular-nums">{pr.identifier}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => resolvePasswordReset(pr, 'approved')}
                    className="min-h-[34px] px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold"
                  >
                    اعتماد وتأكيد ✅
                  </button>
                  <button
                    type="button"
                    onClick={() => resolvePasswordReset(pr, 'rejected')}
                    className="min-h-[34px] px-3 rounded-lg bg-red-600 text-white text-[11px] font-extrabold"
                  >
                    رفض
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {/* SECTION C: UPDATE 8 HIERARCHICAL VIEW — DARK NAVY AGENT CARDS + VERTICAL GOLD LINE SUB-CLIENTS */}
      {isAdmin && agents.length > 0 && (
        <section className="space-y-3">
          <div className="rounded-xl bg-[#0F172A] border border-[#D4AF37] px-3.5 py-2 text-xs font-extrabold text-[#FDE68A] flex items-center justify-between">
            <span>الوكلاء المعتمدون وعملاؤهم التابعون</span>
            <span className="tabular-nums">{agents.length} وكيل</span>
          </div>

          {agents.map((agent, idx) => {
            const subClients = clients.filter((c) => c.parentAgentId === agent.uid);
            return (
              <div key={agent.uid} className="space-y-2">
                {/* Dark Navy Agent Card — Clean 2-Row Vertical Layout */}
                <div
                  className={`rounded-2xl bg-gradient-to-l from-[#0F172A] via-[#1A365D] to-[#1E3A8A] border-2 p-3.5 text-white shadow-lg flex flex-col gap-3 ${
                    agent.status === 'suspended' ? 'border-red-500' : 'border-[#D4AF37]'
                  }`}
                >
                  {/* Top Section: Full Agent Info Across Full Width */}
                  <div className="flex flex-col gap-2">
                    {/* Row 1: Badge + Full Agent Name (Right) | Balance (Left) */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                        <span className="px-2.5 py-0.5 rounded-full bg-gradient-to-b from-[#F59E0B] to-[#D4AF37] text-[#0F172A] text-[11px] font-extrabold shadow shrink-0 whitespace-nowrap">
                          الوكيل {idx + 1}
                        </span>
                        <h4 className="text-sm font-extrabold leading-snug break-words">
                          {agent.name}
                        </h4>
                        {agent.status === 'suspended' && (
                          <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-extrabold border border-white/50 shrink-0 whitespace-nowrap">
                            موقوف مؤقتاً
                          </span>
                        )}
                        {Number(agent.balance || 0) >= 20000 && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/95 text-[#0F172A] text-[10px] font-extrabold border border-[#FDE68A] shrink-0 whitespace-nowrap">
                            مديونية مرتفعة
                          </span>
                        )}
                      </div>
                      <div
                        className={`text-left shrink-0 text-xs font-extrabold tabular-nums whitespace-nowrap px-2.5 py-1 rounded-xl border ${
                          Number(agent.balance || 0) >= 20000
                            ? 'bg-red-600/85 text-white border-red-300'
                            : 'bg-white/10 text-[#FDE68A] border-[#D4AF37]/40'
                        }`}
                      >
                        {formatYER(agent.balance || 0, hideNumbers)}
                      </div>
                    </div>

                    {/* Row 2: Horizontal Metadata (Phone • Pricing % • Sub-clients Count) */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-200 tabular-nums">
                      <span className="whitespace-nowrap">{agent.phone || '—'}</span>
                      <span className="text-[#D4AF37] select-none">•</span>
                      <span className="whitespace-nowrap">
                        نسبة التسعير: {agent.discountRate || appSettings.agentDiscountPercent}%
                      </span>
                      <span className="text-[#D4AF37] select-none">•</span>
                      <span className="whitespace-nowrap">التابعون: ({subClients.length})</span>
                    </div>
                  </div>

                  {/* Bottom Section: Independent Action Bar (Includes Admin-Only Change Password) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full pt-2.5 border-t border-white/15">
                    <button
                      type="button"
                      onClick={() => setAuditTargetUser(agent)}
                      className="min-h-[36px] px-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 border border-[#FDE68A]/70 text-xs font-extrabold text-white flex items-center justify-center gap-1 whitespace-nowrap"
                    >
                      <CreditCard className="w-3.5 h-3.5 shrink-0" />
                      <span>كشف الكروت</span>
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => openPasswordModal(agent)}
                        className="min-h-[36px] px-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 border border-[#FDE68A] text-xs font-extrabold text-[#0F172A] flex items-center justify-center gap-1 whitespace-nowrap"
                      >
                        <KeyRound className="w-3.5 h-3.5 shrink-0" />
                        <span>كلمة المرور</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSuspendTargetUser(agent)}
                      className={`min-h-[36px] px-1.5 rounded-xl border text-xs font-extrabold text-white flex items-center justify-center gap-1 whitespace-nowrap ${
                        agent.status === 'suspended'
                          ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-300'
                          : 'bg-red-600 hover:bg-red-700 border-red-300'
                      }`}
                    >
                      {agent.status === 'suspended' ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>تفعيل</span>
                        </>
                      ) : (
                        <>
                          <Ban className="w-3.5 h-3.5 shrink-0" />
                          <span>إيقاف الحساب</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => openManageModal(agent)}
                      className="min-h-[36px] px-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-[#D4AF37] text-xs font-extrabold text-white flex items-center justify-center whitespace-nowrap"
                    >
                      إدارة الحساب
                    </button>
                  </div>
                </div>

                {/* Sub-Clients Nested Along a Vertical Gold Line — Clean 2-Row Layout */}
                {subClients.length > 0 && (
                  <div className="mr-3.5 pr-3 border-r-2 border-[#D4AF37] space-y-2">
                    {subClients.map((sub, sIdx) => (
                      <div
                        key={sub.uid}
                        className={`rounded-xl border-2 p-3 shadow-sm flex flex-col gap-2.5 ${
                          sub.status === 'suspended'
                            ? 'bg-red-50/60 dark:bg-red-950/25 border-red-500/80'
                            : 'bg-white dark:bg-slate-900 border-[#D4AF37]/70'
                        }`}
                      >
                        {/* Top Row: Number + Full Name + Phone/Rate (Right) | Balance (Left) */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            <span className="w-6 h-6 rounded-full bg-slate-950 border border-[#D4AF37] text-[#FDE68A] text-[11px] font-extrabold flex items-center justify-center shrink-0 tabular-nums mt-0.5">
                              {sIdx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-extrabold text-slate-900 dark:text-white leading-snug break-words">
                                  {sub.name}
                                </span>
                                {sub.status === 'suspended' && (
                                  <span className="px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-extrabold shrink-0 whitespace-nowrap">
                                    موقوف
                                  </span>
                                )}
                                {Number(sub.balance || 0) >= 20000 && (
                                  <span className="px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-400 text-[10px] font-extrabold shrink-0 whitespace-nowrap">
                                    مديونية مرتفعة
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                                <span className="whitespace-nowrap">{sub.phone || '—'}</span>
                                <span>•</span>
                                <span className="whitespace-nowrap">{sub.discountRate || 80}%</span>
                              </div>
                            </div>
                          </div>
                          <div
                            className={`text-left shrink-0 text-xs font-extrabold tabular-nums whitespace-nowrap px-2.5 py-1 rounded-lg border ${
                              Number(sub.balance || 0) >= 20000
                                ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-400'
                                : 'bg-slate-100 dark:bg-slate-800 text-[#1A365D] dark:text-[#FDE68A] border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {formatYER(sub.balance || 0, hideNumbers)}
                          </div>
                        </div>

                        {/* Bottom Row: Independent Action Bar (Includes Admin-Only Change Password) */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full pt-2 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => setAuditTargetUser(sub)}
                            className="min-h-[34px] px-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap"
                          >
                            <CreditCard className="w-3.5 h-3.5 shrink-0" />
                            <span>الكروت</span>
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => openPasswordModal(sub)}
                              className="min-h-[34px] px-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-[#0F172A] text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap"
                            >
                              <KeyRound className="w-3.5 h-3.5 shrink-0" />
                              <span>كلمة المرور</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSuspendTargetUser(sub)}
                            className={`min-h-[34px] px-1.5 rounded-xl text-white text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap ${
                              sub.status === 'suspended'
                                ? 'bg-emerald-600 hover:bg-emerald-700'
                                : 'bg-red-600 hover:bg-red-700'
                            }`}
                          >
                            {sub.status === 'suspended' ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>تفعيل</span>
                              </>
                            ) : (
                              <>
                                <Ban className="w-3.5 h-3.5 shrink-0" />
                                <span>إيقاف</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => openManageModal(sub)}
                            className="min-h-[34px] px-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-[#D4AF37]/60 text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center whitespace-nowrap"
                          >
                            إدارة
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* SECTION D: DIRECT ADMIN CLIENTS SECTION (Navy Header + Numbered White Cards) */}
      <section className="space-y-2.5 pb-20">
        <div className="rounded-xl bg-[#1A365D] border-2 border-[#D4AF37] px-3.5 py-2.5 text-xs font-extrabold text-white flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-[#FDE68A]" />
            {isAdmin ? 'العملاء التابعون للإدارة العامة مباشرة' : 'عملائي ونقاط البيع التابعة لي'}
          </span>
          <span className="text-[#FDE68A] tabular-nums">
            {formatCount(isAdmin ? directAdminClients.length : clients.length, hideNumbers)}
          </span>
        </div>

        {(isAdmin ? directAdminClients : clients).length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 text-center text-xs font-bold text-slate-500">
            لا يوجد عملاء مسجلون في هذا القسم حالياً (0)
          </div>
        ) : (
          <div className="space-y-2.5">
            {(isAdmin ? directAdminClients : clients).map((client, idx) => (
              <div
                key={client.uid}
                className={`royal-tile-3d rounded-2xl border-2 p-3 shadow-sm flex flex-col gap-2.5 ${
                  client.status === 'suspended'
                    ? 'bg-red-50/60 dark:bg-red-950/25 border-red-500/80'
                    : 'bg-white dark:bg-slate-900 border-[#D4AF37]/70'
                }`}
              >
                {/* Top Section: Number + Full Client Name + Phone/Rate (Right) | Balance (Left) */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <span className="w-7 h-7 rounded-full bg-slate-950 border-2 border-[#D4AF37] text-[#FDE68A] text-xs font-extrabold flex items-center justify-center shrink-0 tabular-nums mt-0.5">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-extrabold text-slate-900 dark:text-white leading-snug break-words">
                          {client.name}
                        </span>
                        {client.status === 'suspended' && (
                          <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-extrabold shrink-0 whitespace-nowrap">
                            موقوف مؤقتاً
                          </span>
                        )}
                        {Number(client.balance || 0) >= 20000 && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-400 text-[10px] font-extrabold shrink-0 whitespace-nowrap">
                            مديونية مرتفعة
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                        <span className="whitespace-nowrap">{client.phone || '—'}</span>
                        <span>•</span>
                        <span className="whitespace-nowrap">{client.discountRate || 80}%</span>
                        <span>•</span>
                        <span className="whitespace-nowrap">{getRoleArabicLabel(client.role)}</span>
                      </div>
                    </div>
                  </div>
                  <div
                    className={`text-left shrink-0 text-xs font-extrabold tabular-nums whitespace-nowrap px-2.5 py-1 rounded-lg border ${
                      Number(client.balance || 0) >= 20000
                        ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-400'
                        : 'bg-slate-100 dark:bg-slate-800 text-[#1A365D] dark:text-[#FDE68A] border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {formatYER(client.balance || 0, hideNumbers)}
                  </div>
                </div>

                {/* Bottom Section: Independent Horizontal Button Row */}
                <div
                  className={`grid ${
                    isAdmin ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'
                  } gap-2 w-full pt-2 border-t border-slate-100 dark:border-slate-800`}
                >
                  <button
                    type="button"
                    onClick={() => setAuditTargetUser(client)}
                    className="min-h-[34px] px-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap"
                  >
                    <CreditCard className="w-3.5 h-3.5 shrink-0" />
                    <span>الكروت</span>
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openPasswordModal(client)}
                      className="min-h-[34px] px-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-[#0F172A] text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap"
                    >
                      <KeyRound className="w-3.5 h-3.5 shrink-0" />
                      <span>كلمة المرور</span>
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setSuspendTargetUser(client)}
                      className={`min-h-[34px] px-1.5 rounded-xl text-white text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap ${
                        client.status === 'suspended'
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-red-600 hover:bg-red-700'
                      }`}
                    >
                      {client.status === 'suspended' ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>تفعيل</span>
                        </>
                      ) : (
                        <>
                          <Ban className="w-3.5 h-3.5 shrink-0" />
                          <span>إيقاف</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openManageModal(client)}
                    className="min-h-[34px] px-1.5 rounded-xl bg-[#1A365D] hover:bg-[#0F172A] text-white text-xs font-extrabold flex items-center justify-center whitespace-nowrap"
                  >
                    إدارة
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* MODAL 1: ADD AGENT / CLIENT MANUALLY */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleAddUser}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                إضافة وكيل أو عميل جديد
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isAdmin && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAddRole('client')}
                  className={`min-h-[40px] rounded-xl border-2 text-xs font-extrabold shadow-xs ${
                    addRole === 'client'
                      ? 'bg-[#1A365D] text-[#FDE68A] border-[#D4AF37]'
                      : 'bg-blue-50/75 dark:bg-slate-800 border-blue-700/70 dark:border-blue-400/70 text-[#1A365D] dark:text-blue-100'
                  }`}
                >
                  عميل / نقطة بيع ({appSettings?.clientDiscountPercent ?? 80}%)
                </button>
                <button
                  type="button"
                  onClick={() => setAddRole('agent')}
                  className={`min-h-[40px] rounded-xl border-2 text-xs font-extrabold shadow-xs ${
                    addRole === 'agent'
                      ? 'bg-[#1A365D] text-[#FDE68A] border-[#D4AF37]'
                      : 'bg-blue-50/75 dark:bg-slate-800 border-blue-700/70 dark:border-blue-400/70 text-[#1A365D] dark:text-blue-100'
                  }`}
                >
                  وكيل معتمد ({appSettings?.agentDiscountPercent ?? 70}%)
                </button>
              </div>
            )}

            <input
              type="text"
              inputMode="text"
              required
              autoComplete="off"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="الاسم الكامل / اسم المحل"
              className="w-full min-h-[42px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold shadow-xs focus:border-[#D4AF37] focus:outline-none"
            />

            <div className="flex items-center gap-1.5">
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                dir="ltr"
                required
                autoComplete="off"
                value={addPhone}
                onChange={(e) => setAddPhone(normalizeDigits(e.target.value))}
                onBlur={() => setAddPhone((v) => normalizeDigits(v))}
                placeholder="رقم الهاتف (77xxxxxxx)"
                className="flex-1 min-h-[42px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold tabular-nums text-right shadow-xs focus:border-[#D4AF37] focus:outline-none"
              />
              <ContactPickerButton
                onSelect={(c) => {
                  if (c.name && !addName) setAddName(c.name);
                  if (c.phone) setAddPhone(normalizeDigits(c.phone));
                }}
              />
            </div>

            <input
              type="email"
              inputMode="email"
              dir="ltr"
              autoComplete="off"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="البريد الإلكتروني (اختياري)"
              className="w-full min-h-[42px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold text-right shadow-xs focus:border-[#D4AF37] focus:outline-none"
            />

            {isAdmin && addRole === 'client' && agents.length > 0 && (
              <select
                value={addParentAgent}
                onChange={(e) => setAddParentAgent(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-extrabold shadow-xs focus:border-[#D4AF37] focus:outline-none"
              >
                <option value="">تابع للإدارة العامة مباشرة ({SUPER_ADMIN_CONFIG.name})</option>
                {agents.map((ag) => (
                  <option key={ag.uid} value={ag.uid}>
                    تابع للوكيل: {ag.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[44px] gold-btn-3d text-[#0F172A] text-sm font-extrabold rounded-xl"
            >
              {busy ? 'جاري الإضافة...' : 'حفظ وإضافة الحساب'}
            </button>
          </form>
        </div>
      )}

      {/* MODAL 2: MANAGE ACCOUNT (Upgrade 70% ⇄ Demote 80%, Edit, Delete) */}
      {managingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveManage}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl space-y-3 my-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                إدارة حساب: {managingUser.name}
              </h3>
              <button
                type="button"
                onClick={() => setManagingUser(null)}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Instant Card Inventory & "Who-Bought-What" Audit Button */}
            <button
              type="button"
              onClick={() => {
                const target = managingUser;
                setManagingUser(null);
                setAuditTargetUser(target);
              }}
              className="w-full min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 border border-[#D4AF37] text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow"
            >
              <CreditCard className="w-4 h-4" />
              <span>كشف الكروت والمبيعات (كم استلم • كم باع • كم باقي • لمن باع)</span>
            </button>

            {/* Instant Upgrade / Demote Button + Instant Suspend/Activate Button (Super Admin Only) */}
            {isAdmin && (
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await toggleUserRoleUpgrade(managingUser);
                    setManagingUser(null);
                  }}
                  className="w-full min-h-[42px] rounded-xl bg-gradient-to-l from-[#1A365D] to-[#2563EB] border border-[#D4AF37] text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-2 shadow"
                >
                  <ArrowUpDown className="w-4 h-4" />
                  <span>
                    {managingUser.role === 'client'
                      ? `ترقية فورية إلى وكيل معتمد (${appSettings.agentDiscountPercent}%)`
                      : `خفض فوري إلى عميل / نقطة بيع (${appSettings.clientDiscountPercent}%)`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = managingUser;
                    setManagingUser(null);
                    openPasswordModal(target);
                  }}
                  className="w-full min-h-[40px] rounded-xl bg-amber-500 hover:bg-amber-600 text-[#0F172A] text-xs font-extrabold flex items-center justify-center gap-2 shadow"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>تغيير كلمة مرور الحساب</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = managingUser;
                    setManagingUser(null);
                    setSuspendTargetUser(target);
                  }}
                  className={`w-full min-h-[40px] rounded-xl text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow ${
                    managingUser.status === 'suspended'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {managingUser.status === 'suspended' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>إعادة تفعيل الحساب فوراً</span>
                    </>
                  ) : (
                    <>
                      <Ban className="w-4 h-4" />
                      <span>إيقاف الحساب مؤقتاً (مع حفظ كامل الكروت والبيانات)</span>
                    </>
                  )}
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-extrabold mb-1">الاسم</label>
                <input
                  type="text"
                  inputMode="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-extrabold mb-1">الهاتف</label>
                <div className="flex items-center gap-1">
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    dir="ltr"
                    value={editPhone}
                    onChange={(e) => setEditPhone(normalizeDigits(e.target.value))}
                    onBlur={() => setEditPhone((v) => normalizeDigits(v))}
                    className="flex-1 min-w-0 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-bold tabular-nums text-right"
                  />
                  <ContactPickerButton
                    className="min-h-[40px] min-w-[38px] rounded-xl bg-[#1A365D] text-[#FDE68A] border border-[#D4AF37]/70 flex items-center justify-center shrink-0"
                    onSelect={(c) => {
                      if (c.name) setEditName(c.name);
                      if (c.phone) setEditPhone(normalizeDigits(c.phone));
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-extrabold mb-1">النسبة (%)</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  dir="ltr"
                  value={editRate === '0' ? '' : editRate}
                  placeholder="0"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setEditRate(normalizeDigits(e.target.value).replace(/[^\d]/g, ''))}
                  className="w-full min-h-[40px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-bold tabular-nums text-right focus:border-[#D4AF37] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-extrabold mb-1">الرصيد (ر.ي)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={editBalance === '0' ? '' : editBalance}
                  placeholder="0"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setEditBalance(normalizeDigits(e.target.value).replace(/[^\d.-]/g, ''))}
                  className="w-full min-h-[40px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs font-bold tabular-nums text-right focus:border-[#D4AF37] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-extrabold mb-1">الحالة</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as UserProfile['status'])}
                  className="w-full min-h-[40px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-2 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                >
                  <option value="active">نشط</option>
                  <option value="suspended">موقوف</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="min-h-[42px] royal-btn-3d text-white text-xs font-extrabold rounded-xl flex items-center justify-center gap-1"
              >
                <Edit3 className="w-3.5 h-3.5 text-[#FDE68A]" />
                حفظ التعديلات
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={async () => {
                    await deleteManagedUser(managingUser);
                    setManagingUser(null);
                  }}
                  className="min-h-[42px] rounded-xl bg-red-600 text-white text-xs font-extrabold flex items-center justify-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  حذف الحساب
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: TRANSFER CLIENTS BETWEEN AGENTS */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                نقل العملاء بين الوكلاء والإدارة
              </h3>
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-200 dark:border-slate-700 rounded-xl p-2">
              {clients.length === 0 ? (
                <p className="text-center text-xs font-bold text-slate-500 py-4">لا يوجد عملاء للنقل</p>
              ) : (
                clients.map((c) => {
                  const checked = selectedTransferUids.includes(c.uid);
                  return (
                    <label
                      key={c.uid}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-xs font-bold"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedTransferUids((prev) =>
                              checked ? prev.filter((id) => id !== c.uid) : [...prev, c.uid]
                            )
                          }
                          className="w-4 h-4 accent-[#1A365D]"
                        />
                        {c.name} ({c.phone})
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            <div>
              <label className="block text-xs font-extrabold mb-1">نقل التبعية إلى:</label>
              <select
                value={targetTransferAgentId}
                onChange={(e) => setTargetTransferAgentId(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold"
              >
                <option value="">الإدارة العامة مباشرة ({SUPER_ADMIN_CONFIG.name})</option>
                {agents.map((ag) => (
                  <option key={ag.uid} value={ag.uid}>
                    الوكيل: {ag.name} ({ag.phone})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={busy || selectedTransferUids.length === 0}
              onClick={handleConfirmTransfer}
              className="w-full min-h-[44px] gold-btn-3d text-[#0F172A] text-sm font-extrabold rounded-xl disabled:opacity-50"
            >
              تأكيد نقل ({selectedTransferUids.length}) عميل فوراً
            </button>
          </div>
        </div>
      )}

      {/* REJECT JOIN REQUEST REASON MODAL */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-red-500 p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-red-600">رفض طلب {rejectTarget.name}</h3>
              <button type="button" onClick={() => setRejectTarget(null)} className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="اكتب سبب الرفض لإشعار المتقدم..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold"
            />
            <button
              type="button"
              onClick={async () => {
                await rejectRegistration(rejectTarget, rejectReason);
                setRejectTarget(null);
              }}
              className="w-full min-h-[42px] rounded-xl bg-red-600 text-white text-xs font-extrabold"
            >
              تأكيد الرفض وإرسال الإشعار
            </button>
          </div>
        </div>
      )}
      {/* MODAL 4: DETAILED AGENT/CLIENT CARD INVENTORY & "WHO-BOUGHT-WHAT" AUDIT */}
      {auditTargetUser && (
        <AgentCardAuditModal
          targetUser={auditTargetUser}
          hideNumbers={hideNumbers}
          mode="modal"
          onClose={() => setAuditTargetUser(null)}
        />
      )}

      {/* MODAL 5: SUPER ADMIN ACCOUNT SUSPEND / REACTIVATE CONFIRMATION */}
      {isAdmin && suspendTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div
            className={`w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 p-5 shadow-2xl text-center space-y-3 ${
              suspendTargetUser.status === 'suspended' ? 'border-emerald-500' : 'border-red-500'
            }`}
          >
            <div
              className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center ${
                suspendTargetUser.status === 'suspended'
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600'
                  : 'bg-red-100 dark:bg-red-900/40 text-red-600'
              }`}
            >
              {suspendTargetUser.status === 'suspended' ? (
                <CheckCircle2 className="w-7 h-7" />
              ) : (
                <Ban className="w-7 h-7" />
              )}
            </div>
            <h3
              className={`text-base font-extrabold ${
                suspendTargetUser.status === 'suspended' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'
              }`}
            >
              {suspendTargetUser.status === 'suspended'
                ? 'تأكيد إعادة تفعيل الحساب'
                : 'تأكيد إيقاف الحساب مؤقتاً'}
            </h3>
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300 leading-relaxed">
              {suspendTargetUser.status === 'suspended' ? (
                <>
                  هل تريد إعادة تفعيل حساب <strong>{suspendTargetUser.name}</strong> ({suspendTargetUser.phone})؟ سيتمكن فوراً من تسجيل الدخول وممارسة البيع بكل كروته المحفوظة.
                </>
              ) : (
                <>
                  هل أنت متأكد من إيقاف حساب <strong>{suspendTargetUser.name}</strong> ({suspendTargetUser.phone}) مؤقتاً؟
                  <br />
                  <span className="text-emerald-700 dark:text-emerald-400">
                    ستبقى كافة كروته ومبيعاته وأرصدته محفوظة 100% دون أي حذف، ولن يتمكن من الدخول أو البيع حتى إعادة تفعيله.
                  </span>
                </>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => setSuspendTargetUser(null)}
                className="min-h-[42px] rounded-xl bg-slate-100 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 text-xs font-extrabold"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await toggleUserSuspension(suspendTargetUser);
                    setSuspendTargetUser(null);
                  } finally {
                    setBusy(false);
                  }
                }}
                className={`min-h-[42px] rounded-xl text-white text-xs font-extrabold disabled:opacity-60 ${
                  suspendTargetUser.status === 'suspended'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {busy
                  ? 'جاري التنفيذ...'
                  : suspendTargetUser.status === 'suspended'
                    ? 'نعم، تفعيل الحساب ✅'
                    : 'نعم، إيقاف مؤقت ⛔'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: SUPER ADMIN EXCLUSIVE CHANGE AGENT/CLIENT PASSWORD */}
      {isAdmin && passwordTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 safe-top safe-bottom">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="royal-header-3d px-4 py-3 border-b-2 border-[#D4AF37] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-[#0F172A] flex items-center justify-center shrink-0 shadow">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold text-white truncate">تغيير كلمة المرور</h3>
                  <p className="text-[11px] font-bold text-[#FDE68A] truncate">
                    {passwordTargetUser.name} • {passwordTargetUser.phone || passwordTargetUser.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={closePasswordModal}
                aria-label="إغلاق"
                className="w-8 h-8 rounded-full bg-white/15 border border-white/25 text-white flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {savedPwdSuccess ? (
              <div className="p-4 space-y-3">
                <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-500 p-3 space-y-2 text-center">
                  <div className="w-10 h-10 rounded-full bg-emerald-600 text-white mx-auto flex items-center justify-center">
                    <Check className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-extrabold text-emerald-800 dark:text-emerald-200">
                    تم حفظ كلمة المرور الجديدة بنجاح ✅
                  </p>
                  <div className="rounded-xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 p-2.5 text-right space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-500">الحساب:</span>
                      <span className="font-extrabold text-slate-900 dark:text-white truncate">
                        {savedPwdSuccess.name}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-500">رقم الهاتف:</span>
                      <span dir="ltr" className="font-extrabold text-slate-900 dark:text-white tabular-nums">
                        {savedPwdSuccess.phone || savedPwdSuccess.email}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-500">كلمة المرور:</span>
                      <span dir="ltr" className="font-extrabold text-[#1A365D] dark:text-[#FDE68A] select-all">
                        {savedPwdSuccess.password}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopySavedCredentials()}
                    className="min-h-[42px] rounded-xl bg-[#1A365D] hover:bg-[#0F172A] border border-[#D4AF37] text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                  >
                    {copiedPwdCreds ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-[#FDE68A]" />
                    )}
                    <span>{copiedPwdCreds ? 'تم النسخ' : 'نسخ البيانات'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSendCredentialsWhatsApp}
                    className="min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>إرسال عبر واتساب</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={closePasswordModal}
                  className="w-full min-h-[40px] rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-extrabold text-slate-700 dark:text-slate-200"
                >
                  إغلاق
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveNewPassword} className="p-4 space-y-3">
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 px-3 py-2 text-[11px] font-bold text-amber-900 dark:text-amber-200 leading-relaxed">
                  سيتم تحديث كلمة مرور <strong>{passwordTargetUser.name}</strong> ({getRoleArabicLabel(passwordTargetUser.role)}) وتأمينها فوراً مع إبطال الجلسات القديمة.
                </div>

                <div>
                  <label className="block text-xs font-extrabold mb-1 text-slate-800 dark:text-slate-200">
                    كلمة المرور الجديدة
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showNewPwd ? 'text' : 'password'}
                      inputMode="text"
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      dir="auto"
                      data-lpignore="true"
                      data-form-type="other"
                      required
                      minLength={6}
                      disabled={busy}
                      value={newPwdValue}
                      onChange={(e) => setNewPwdValue(e.target.value)}
                      placeholder="أدخل كلمة المرور الجديدة (حروف، أرقام، رموز)..."
                      className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 ps-3 pe-10 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPwd((v) => !v)}
                      aria-label={showNewPwd ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      className="absolute left-2.5 p-1 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                    >
                      {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold mb-1 text-slate-800 dark:text-slate-200">
                    تأكيد كلمة المرور الجديدة
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showConfirmPwd ? 'text' : 'password'}
                      inputMode="text"
                      autoComplete="new-password"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      dir="auto"
                      data-lpignore="true"
                      data-form-type="other"
                      required
                      minLength={6}
                      disabled={busy}
                      value={confirmPwdValue}
                      onChange={(e) => setConfirmPwdValue(e.target.value)}
                      placeholder="أعد كتابة كلمة المرور للتأكيد..."
                      className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 ps-3 pe-10 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPwd((v) => !v)}
                      aria-label={showConfirmPwd ? 'إخفاء التأكيد' : 'إظهار التأكيد'}
                      className="absolute left-2.5 p-1 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                    >
                      {showConfirmPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {pwdError && (
                  <p className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-400 px-3 py-2 text-[11px] font-extrabold text-red-700 dark:text-red-300">
                    {pwdError}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={closePasswordModal}
                    className="min-h-[42px] rounded-xl bg-slate-100 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 text-xs font-extrabold"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[42px] royal-btn-3d text-white text-xs font-extrabold rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#FDE68A]" />
                        <span>جاري الحفظ...</span>
                      </>
                    ) : (
                      <>
                        <KeyRound className="w-4 h-4 text-[#FDE68A]" />
                        <span>حفظ كلمة المرور</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
