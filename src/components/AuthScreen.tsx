import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  AlertCircle,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LogIn,
  LogOut,
  MailCheck,
  Moon,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sun,
  UserPlus,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import {
  applyAuthPersistence,
  auth,
  db,
  firebaseProjectId,
  generateSafeDocId,
  handleFirestoreError,
  isSuperAdminEmail,
  normalizeAuthIdentifier,
  normalizeDigits,
  OperationType,
} from '../lib/firebase';
import {
  getBiometricMethodStatus,
  isBiometricHardwareAvailable,
  rememberSessionCredentialInMemory,
  syncBiometricVaultOnPasswordLogin,
  verifyDeviceBiometric,
} from '../lib/biometric';
import { useFeedback } from '../lib/feedback';
import { useFirebase } from '../contexts/FirebaseContext';
import { SUPER_ADMIN_CONFIG, TAIBAH_ASSETS } from '../types/taibah';
import { ContactPickerButton } from './ContactPickerButton';

const SAVED_IDENTIFIER_KEY = 'taibah_saved_identifier_v1';

type AuthView = 'login' | 'register' | 'reset';

interface AuthScreenProps {
  isDark: boolean;
  onToggleTheme: () => void;
  sessionUnlocked: boolean;
  onUnlockSession: (uid?: string, email?: string) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  isDark,
  onToggleTheme,
  sessionUnlocked,
  onUnlockSession,
}) => {
  const { notifySuccess, notifyError, notifyWarning, notifyInfo } = useFeedback();
  const {
    firebaseUser,
    profile,
    profileLoading,
    needsAdminEmailVerification,
    refreshVerificationStatus,
    syncNow,
    signOutUser,
  } = useFirebase();

  const [view, setView] = useState<AuthView>('login');
  const [identifier, setIdentifier] = useState(() => {
    try {
      return localStorage.getItem(SAVED_IDENTIFIER_KEY) || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saveUsername, setSaveUsername] = useState(() => {
    try {
      return !!localStorage.getItem(SAVED_IDENTIFIER_KEY);
    } catch {
      return false;
    }
  });
  const [submitting, setSubmitting] = useState(false);
  const [emailAuthDisabledError, setEmailAuthDisabledError] = useState(false);

  // Registration state (strictly NO discount percentage shown!)
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState<'client' | 'agent'>('client');

  // Password reset state
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetName, setResetName] = useState('');

  // Unified BiometricPrompt status (Fingerprint + Face + Device PIN)
  const [bioStatus, setBioStatus] = useState(() => getBiometricMethodStatus());
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');

  useEffect(() => {
    void isBiometricHardwareAvailable().then(() => {
      setBioStatus(getBiometricMethodStatus());
    });
  }, []);

  // Auto-heal guard ONLY after user explicitly unlocked the current session
  useEffect(() => {
    if (sessionUnlocked && firebaseUser && !profileLoading && !profile && !needsAdminEmailVerification) {
      void syncNow();
    }
  }, [sessionUnlocked, firebaseUser, profileLoading, profile, needsAdminEmailVerification, syncNow]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      notifyWarning('بيانات ناقصة', 'يرجى إدخال البريد الإلكتروني أو رقم الهاتف وكلمة المرور.');
      return;
    }

    setSubmitting(true);
    setEmailAuthDisabledError(false);

    try {
      // Keep Firebase Auth token resilient across WebView file pickers & app switches;
      // cold-start login enforcement is managed by sessionGuard (sessionStorage).
      await applyAuthPersistence(true);
      try {
        if (saveUsername) {
          localStorage.setItem(SAVED_IDENTIFIER_KEY, identifier.trim());
        } else {
          localStorage.removeItem(SAVED_IDENTIFIER_KEY);
        }
      } catch {
        // ignore restricted storage
      }

      const { email } = normalizeAuthIdentifier(identifier);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await syncBiometricVaultOnPasswordLogin(
        email,
        password,
        identifier.trim(),
        cred.user.displayName || (isSuperAdminEmail(email) ? SUPER_ADMIN_CONFIG.name : identifier.trim())
      );
      setBioStatus(getBiometricMethodStatus());
      onUnlockSession(cred.user.uid, email);
      notifySuccess('مرحباً بك في كروت طيبة نت — تم تسجيل الدخول بنجاح ✅');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
        setEmailAuthDisabledError(true);
        notifyError('تفعيل مزود الدخول مطلوب', 'يرجى تفعيل Email/Password من لوحة Firebase Console.');
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password'
      ) {
        const { email } = normalizeAuthIdentifier(identifier);
        if (isSuperAdminEmail(email)) {
          notifyWarning(
            'حساب المدير غير مُنشأ بعد أو كلمة المرور خاطئة',
            'إذا كانت هذه أول مرة تدخل فيها كمدير، اضغط "تفعيل حساب الإدارة الآن".'
          );
        } else {
          notifyError('بيانات الدخول غير صحيحة', 'تأكد من البريد الإلكتروني / رقم الهاتف وكلمة المرور.');
        }
      } else if (code === 'auth/too-many-requests') {
        notifyError('محاولات كثيرة', 'يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.');
      } else {
        notifyError('تعذر تسجيل الدخول', 'يرجى التحقق من الاتصال بالإنترنت والبيانات المدخلة.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleFirstTimeAdminSetup = async () => {
    const { email } = normalizeAuthIdentifier(identifier || SUPER_ADMIN_CONFIG.email);
    if (!isSuperAdminEmail(email)) {
      notifyWarning('خاص بالمدير الأساسي فقط', `أدخل ${SUPER_ADMIN_CONFIG.email} أو ${SUPER_ADMIN_CONFIG.phone}`);
      return;
    }
    if (password.length < 6) {
      notifyWarning('كلمة مرور قصيرة', 'أدخل كلمة مرور قوية من 6 أحرف على الأقل لحساب المدير.');
      return;
    }

    setSubmitting(true);
    setEmailAuthDisabledError(false);
    try {
      await applyAuthPersistence(true);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      rememberSessionCredentialInMemory(email, password);
      await sendEmailVerification(cred.user);
      onUnlockSession(cred.user.uid, email);
      notifySuccess('تم إنشاء حساب المدير الأساسي وإرسال رابط التحقق إلى بريدك الإلكتروني');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
        setEmailAuthDisabledError(true);
        notifyError('تفعيل مزود الدخول مطلوب', 'يرجى تفعيل Email/Password في Firebase Console أولاً.');
      } else if (code === 'auth/email-already-in-use') {
        notifyInfo('الحساب موجود مسبقاً', 'استخدم زر تسجيل الدخول بكلمة المرور الصحيحة.');
      } else {
        notifyError('تعذر تفعيل حساب المدير', 'تأكد من كلمة المرور واتصال الإنترنت.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const completeUnifiedBiometricSignIn = async (
    displayName: string,
    savedIdentifier: string,
    credentials: { email: string; password: string } | null | undefined
  ) => {
    setIdentifier(savedIdentifier);

    if (!credentials?.email || !credentials?.password) {
      notifyWarning(
        'يلزم ربط الدخول الحيوي بكلمة المرور',
        'سجّل الدخول بكلمة المرور أولاً، ثم فعّل الدخول الحيوي من «الإعدادات وحول التطبيق».'
      );
      return;
    }

    setSubmitting(true);
    try {
      await applyAuthPersistence(true);
      const cred = await signInWithEmailAndPassword(auth, credentials.email, credentials.password);
      rememberSessionCredentialInMemory(credentials.email, credentials.password);
      onUnlockSession(cred.user.uid, credentials.email);
      notifySuccess(`تم التحقق الحيوي بنجاح — مرحباً ${displayName} ✅`);
    } catch {
      notifyError(
        'تعذر التحقق من بيانات الحساب',
        'ربما تم تغيير كلمة المرور مؤخراً — سجّل الدخول بكلمة المرور الجديدة لتحديث خزنة البصمة تلقائياً.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnifiedBiometricLogin = async () => {
    const currentStatus = getBiometricMethodStatus();
    setBioStatus(currentStatus);

    if (!currentStatus.hasAnyEnabled) {
      notifyInfo(
        'الدخول الحيوي غير مُفعّل بعد',
        'سجّل الدخول بكلمة المرور أولاً، ثم افتح «الإعدادات وحول التطبيق» لتفعيل البصمة / الوجه / رمز الجهاز.'
      );
      return;
    }

    const result = await verifyDeviceBiometric(undefined, 'unified');
    if (result.requiresPin) {
      setPinInput('');
      setShowPinModal(true);
      return;
    }

    if (result.verified && result.enrollment) {
      await completeUnifiedBiometricSignIn(
        result.enrollment.displayName,
        result.enrollment.identifier,
        result.credentials
      );
    } else {
      notifyWarning(
        'لم يكتمل التحقق الحيوي',
        result.errorMessage || 'أعد المحاولة أو استخدم كلمة المرور.'
      );
    }
  };

  const handlePinConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await verifyDeviceBiometric(pinInput.trim(), 'unified');
    if (res.verified && res.enrollment) {
      setShowPinModal(false);
      await completeUnifiedBiometricSignIn(
        res.enrollment.displayName,
        res.enrollment.identifier,
        res.credentials
      );
    } else {
      notifyWarning('الرمز غير مطابق', res.errorMessage || 'يرجى التأكد من الرمز والمحاولة مجدداً.');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = regName.trim();
    const cleanPhone = normalizeDigits(regPhone).replace(/[^\d]/g, '');
    if (cleanName.length < 2) {
      notifyWarning('الاسم مطلوب', 'يرجى إدخال الاسم الكامل (حرفان على الأقل).');
      return;
    }
    if (cleanPhone.length < 7) {
      notifyWarning('رقم الهاتف غير صالح', 'يرجى إدخال رقم هاتف صحيح.');
      return;
    }
    if (regPassword.length < 6) {
      notifyWarning('كلمة المرور قصيرة', 'يجب أن تكون كلمة المرور 6 أحرف على الأقل.');
      return;
    }

    setSubmitting(true);
    setEmailAuthDisabledError(false);

    try {
      const authEmail = regEmail.trim()
        ? regEmail.trim().toLowerCase()
        : `${cleanPhone}@taibah.net`;

      await applyAuthPersistence(false);
      const cred = await createUserWithEmailAndPassword(auth, authEmail, regPassword);
      const uid = cred.user.uid;

      // 1. Create pending user profile in Firestore (no discount % exposed on registration!)
      await setDoc(doc(db, 'users', uid), {
        uid,
        name: cleanName.slice(0, 100),
        phone: cleanPhone.slice(0, 20),
        email: authEmail.slice(0, 120),
        role: regRole,
        status: 'pending',
        parentAgentId: '',
        discountRate: 100,
        balance: 0,
        fcmTokens: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2. Create real-time registration request for Super Admin onSnapshot queue
      const reqId = generateSafeDocId('reg');
      await setDoc(doc(db, 'registrationRequests', reqId), {
        applicantUid: uid,
        name: cleanName.slice(0, 100),
        phone: cleanPhone.slice(0, 20),
        email: authEmail.slice(0, 120),
        requestedRole: regRole,
        parentAgentId: '',
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 3. Dispatch real-time notification to Super Admin
      const notifId = generateSafeDocId('notif');
      await setDoc(doc(db, 'notifications', notifId), {
        recipientId: 'super_admin',
        senderId: uid,
        title: 'طلب انضمام حساب جديد',
        body: `تقدّم ${cleanName} (${cleanPhone}) بطلب فتح حساب ${regRole === 'agent' ? 'وكيل' : 'عميل / نقطة بيع'}.`,
        category: 'registration',
        targetRoute: 'agents_management',
        isRead: false,
        createdAt: serverTimestamp(),
      });

      onUnlockSession();
      notifySuccess('تم إرسال طلب فتح الحساب للإدارة بنجاح — سيظهر لديكم التفعيل فور الاعتماد');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
        setEmailAuthDisabledError(true);
        notifyError('تفعيل مزود الدخول مطلوب', 'يرجى تفعيل Email/Password في لوحة Firebase Console.');
      } else if (code === 'auth/email-already-in-use') {
        notifyError('الحساب مسجل مسبقاً', 'رقم الهاتف أو البريد الإلكتروني مستخدم بالفعل.');
      } else {
        handleFirestoreError(err, OperationType.CREATE, 'registrationRequests');
        notifyError('تعذر إرسال الطلب', 'يرجى التحقق من البيانات والمحاولة مجدداً.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = normalizeDigits(resetIdentifier).trim();
    if (cleaned.length < 3) {
      notifyWarning('بيانات ناقصة', 'أدخل رقم الهاتف أو البريد الإلكتروني المرتبط بحسابك.');
      return;
    }

    setSubmitting(true);
    try {
      const reqId = generateSafeDocId('pwd');
      await setDoc(doc(db, 'passwordResetRequests', reqId), {
        requesterUid: auth.currentUser?.uid || '',
        identifier: cleaned.slice(0, 120),
        name: resetName.trim().slice(0, 100),
        phone: cleaned.includes('@') ? '' : cleaned.replace(/[^\d]/g, '').slice(0, 20),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (cleaned.includes('@') && !cleaned.endsWith('@taibah.net')) {
        await sendPasswordResetEmail(auth, cleaned.toLowerCase()).catch(() => {});
      }

      notifySuccess('تم إرسال طلب استعادة كلمة المرور للإدارة بنجاح');
      setResetIdentifier('');
      setResetName('');
      setView('login');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'passwordResetRequests');
      notifyError('تعذر إرسال الطلب', 'يرجى التحقق من اتصال الإنترنت والمحاولة مجدداً.');
    } finally {
      setSubmitting(false);
    }
  };

  // Post-login status gates — shown ONLY after user explicitly unlocked this session!
  if (sessionUnlocked && firebaseUser && profileLoading && !needsAdminEmailVerification) {
    return (
      <div
        dir="rtl"
        className="taibah-app-frame h-[100dvh] w-full overflow-hidden flex items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1A365D] to-[#0F172A] p-4 safe-top safe-bottom"
      >
        <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-6 shadow-2xl text-center">
          <div className="w-18 h-18 rounded-full mx-auto p-1 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg">
            <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
              <img
                src={TAIBAH_ASSETS.logo}
                alt="شعار شبكة طيبة نت"
                referrerPolicy="no-referrer"
                className="w-full h-full rounded-full object-contain"
              />
            </div>
          </div>
          <div className="mt-3.5 inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-[#1A365D] dark:text-[#FDE68A]">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
          <h2 className="mt-2.5 text-base font-extrabold text-slate-900 dark:text-white">
            جاري فتح لوحة التحكم...
          </h2>
          <p className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
            تم التحقق من هويتك بنجاح، جاري الانتقال مباشرة إلى الصفحة الرئيسية.
          </p>
          <button
            type="button"
            onClick={signOutUser}
            className="mt-4 w-full min-h-[40px] rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-red-600 flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  if (sessionUnlocked && firebaseUser && needsAdminEmailVerification) {
    return (
      <div
        dir="rtl"
        className="taibah-app-frame h-[100dvh] w-full overflow-hidden flex items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1A365D] to-[#0F172A] p-4 safe-top safe-bottom"
      >
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full mx-auto p-1 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg">
            <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
              <img
                src={TAIBAH_ASSETS.logo}
                alt="شعار شبكة طيبة نت"
                referrerPolicy="no-referrer"
                className="w-full h-full rounded-full object-contain"
              />
            </div>
          </div>
          <div className="mt-3 inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
            <MailCheck className="w-6 h-6" />
          </div>
          <h2 className="mt-2.5 text-lg font-extrabold text-slate-900 dark:text-white">
            تأكيد بريد المدير الأساسي
          </h2>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            يرجى فتح البريد الإلكتروني{' '}
            <strong className="text-[#1A365D] dark:text-[#FDE68A]">{firebaseUser.email}</strong> والنقر على رابط التفعيل، ثم الضغط على زر التحقق أدناه.
          </p>

          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={() => refreshVerificationStatus()}
              className="w-full min-h-[44px] royal-btn-3d border-2 border-[#D4AF37] text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              تم التفعيل — الدخول للوحة الإدارة
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await sendEmailVerification(firebaseUser);
                  notifySuccess('تم إرسال رابط التفعيل إلى بريدك الإلكتروني');
                } catch {
                  notifyWarning('انتظر قليلاً قبل إعادة إرسال الرابط');
                }
              }}
              className="w-full min-h-[42px] rounded-xl border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] font-bold text-xs"
            >
              إعادة إرسال رابط التفعيل
            </button>
            <button
              type="button"
              onClick={signOutUser}
              className="w-full min-h-[40px] rounded-xl text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-red-600 flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              تسجيل الخروج
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (sessionUnlocked && firebaseUser && profile && profile.status !== 'active') {
    const isRejected = profile.status === 'rejected';
    return (
      <div
        dir="rtl"
        className="taibah-app-frame h-[100dvh] w-full overflow-hidden flex items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1A365D] to-[#0F172A] p-4 safe-top safe-bottom"
      >
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full mx-auto p-1 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg">
            <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
              <img
                src={TAIBAH_ASSETS.logo}
                alt="شعار شبكة طيبة نت"
                referrerPolicy="no-referrer"
                className="w-full h-full rounded-full object-contain"
              />
            </div>
          </div>
          <div
            className={`mt-3 inline-flex items-center justify-center w-11 h-11 rounded-2xl ${
              isRejected
                ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
            }`}
          >
            {isRejected ? <XCircle className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
          </div>
          <h2 className="mt-2.5 text-lg font-extrabold text-slate-900 dark:text-white">
            {isRejected ? 'تم رفض طلب الانضمام' : 'طلبك قيد المراجعة الفورية'}
          </h2>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {isRejected
              ? `عذراً ${profile.name}، لم تتم الموافقة على تفعيل حسابك. السبب: ${profile.rejectionReason || 'يرجى التواصل مع الإدارة'}`
              : `مرحباً ${profile.name} (${profile.phone})، تم إرسال طلبك لحظياً إلى إدارة شبكة طيبة نت. سيتم فتح التطبيق تلقائياً فور الاعتماد.`}
          </p>
          <p className="mt-2.5 text-xs font-bold text-[#1A365D] dark:text-[#FDE68A]">
            للتواصل مع الإدارة: {SUPER_ADMIN_CONFIG.phone}
          </p>
          <button
            type="button"
            onClick={signOutUser}
            className="mt-4 w-full min-h-[42px] rounded-xl bg-slate-900 dark:bg-slate-800 border-2 border-[#D4AF37] text-white font-bold text-xs flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            العودة لشاشة الدخول
          </button>
        </div>
      </div>
    );
  }

  if (sessionUnlocked && firebaseUser && !profileLoading && !profile) {
    return (
      <div
        dir="rtl"
        className="taibah-app-frame h-[100dvh] w-full overflow-hidden flex items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1A365D] to-[#0F172A] p-4 safe-top safe-bottom"
      >
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full mx-auto p-1 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg">
            <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
              <img
                src={TAIBAH_ASSETS.logo}
                alt="شعار شبكة طيبة نت"
                referrerPolicy="no-referrer"
                className="w-full h-full rounded-full object-contain"
              />
            </div>
          </div>
          <div className="mt-3 inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
          <h2 className="mt-2.5 text-base font-extrabold text-slate-900 dark:text-white">
            جاري استعادة وفتح ملف الحساب...
          </h2>
          <p className="mt-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 leading-relaxed">
            تم التحقق من دخولك ({firebaseUser.email})، جاري ربط ملفك تلقائياً وفتح الشاشة الرئيسية مباشرة.
          </p>
          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={() => {
                void refreshVerificationStatus();
                void syncNow();
              }}
              className="w-full min-h-[44px] royal-btn-3d border-2 border-[#D4AF37] text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              فتح الشاشة الرئيسية الآن
            </button>
            <button
              type="button"
              onClick={signOutUser}
              className="w-full min-h-[40px] rounded-xl border-2 border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              تسجيل الخروج
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="taibah-app-frame h-[100dvh] w-full overflow-hidden flex flex-col items-center justify-between bg-gradient-to-br from-slate-100 via-blue-50 to-slate-200 dark:from-[#0B1220] dark:via-[#0F172A] dark:to-[#1A365D] px-3.5 pt-[calc(env(safe-area-inset-top,0px)+10px)] pb-[calc(env(safe-area-inset-bottom,0px)+14px)] relative select-none"
    >
      {/* Theme Toggle floating corner */}
      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={isDark ? 'التبديل للوضع النهاري' : 'التبديل للوضع الليلي'}
        className="fixed top-[calc(env(safe-area-inset-top,0px)+12px)] left-3.5 z-20 w-9 h-9 rounded-full bg-white dark:bg-slate-800 border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] shadow-lg flex items-center justify-center active:scale-95 transition-transform"
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      {/* Main Centered Compact Auth Card — 100% locked inside viewport with zero scroll */}
      <div className="w-full max-w-md my-auto flex flex-col justify-center min-h-0">
        {/* Royal Brand Card Header */}
        <div className="rounded-t-3xl royal-header-3d px-4 pt-3.5 pb-3 text-center border-x-2 border-t-2 border-[#D4AF37]">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full mx-auto p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-xl">
            <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
              <img
                src={TAIBAH_ASSETS.logo}
                alt="الشعار الرسمي لشبكة طيبة نت"
                referrerPolicy="no-referrer"
                className="w-full h-full rounded-full object-contain"
              />
            </div>
          </div>
          <h1 className="mt-2 text-base sm:text-lg font-extrabold text-white tracking-tight leading-tight">
            كروت طيبة نت — TAIBAH NET
          </h1>
          <p className="text-[11px] font-bold text-[#FDE68A] mt-0.5">
            — شبكة طيبة نت - {SUPER_ADMIN_CONFIG.name} —
          </p>
        </div>

        {/* Main 3D Card Body */}
        <div className="rounded-b-3xl bg-white dark:bg-slate-900 border-x-2 border-b-2 border-[#D4AF37] px-4 py-3.5 shadow-2xl">
          {/* Segmented Mode Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 mb-3">
            <button
              type="button"
              onClick={() => setView('login')}
              className={`min-h-[34px] rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
                view === 'login'
                  ? 'bg-[#1A365D] text-white border border-[#D4AF37] shadow-sm'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              <span>دخول</span>
            </button>
            <button
              type="button"
              onClick={() => setView('register')}
              className={`min-h-[34px] rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
                view === 'register'
                  ? 'bg-[#1A365D] text-white border border-[#D4AF37] shadow-sm'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              <span>فتح حساب</span>
            </button>
            <button
              type="button"
              onClick={() => setView('reset')}
              className={`min-h-[34px] rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
                view === 'reset'
                  ? 'bg-[#1A365D] text-white border border-[#D4AF37] shadow-sm'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5 shrink-0" />
              <span>استعادة</span>
            </button>
          </div>

          {emailAuthDisabledError && (
            <div className="mb-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border-2 border-amber-500 p-2.5 text-right">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[11px] text-slate-800 dark:text-amber-100 leading-snug">
                  <p className="font-extrabold">تفعيل Email/Password مطلوب في Firebase:</p>
                  <a
                    href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/providers`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 font-extrabold text-[#1A365D] dark:text-[#FDE68A] underline"
                  >
                    فتح إعدادات Authentication
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 1: LOGIN */}
          {view === 'login' && (
            <form onSubmit={handleLogin} className="space-y-2.5">
              <div>
                <label className="block text-[11.5px] font-extrabold text-slate-800 dark:text-slate-200 mb-1">
                  البريد الإلكتروني أو رقم الهاتف
                </label>
                <div className="relative flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Phone className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="772466998 أو nabil77444@gmail.com"
                      autoComplete="username"
                      className="w-full min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs sm:text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#D4AF37] focus:outline-none transition-colors"
                    />
                  </div>
                  <ContactPickerButton
                    unauthenticated
                    className="min-h-[42px] min-w-[42px] rounded-xl border-2 border-[#D4AF37] bg-[#1A365D] text-[#FDE68A] flex items-center justify-center active:scale-95 transition-transform shrink-0"
                    onSelect={(picked) => {
                      if (picked.phone) setIdentifier(picked.phone);
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11.5px] font-extrabold text-slate-800 dark:text-slate-200 mb-1">
                  كلمة المرور
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="أدخل كلمة المرور"
                    autoComplete="current-password"
                    className="w-full min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 pr-3 pl-10 text-xs sm:text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#D4AF37] focus:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute left-1.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-600 dark:text-slate-300"
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-[11.5px] font-extrabold text-slate-700 dark:text-slate-300">
                <label className="flex items-center gap-1.5 cursor-pointer select-none min-h-[30px]">
                  <input
                    type="checkbox"
                    checked={saveUsername}
                    onChange={(e) => setSaveUsername(e.target.checked)}
                    className="w-4 h-4 rounded accent-[#1A365D]"
                  />
                  <span>حفظ اسم المستخدم فقط</span>
                </label>
                <button
                  type="button"
                  onClick={() => setView('reset')}
                  className="text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 py-0.5"
                >
                  نسيت كلمة المرور؟
                </button>
              </div>

              {/* Primary Password Login Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] royal-btn-3d border-2 border-[#D4AF37] text-white font-extrabold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <LogIn className="w-4 h-4 text-[#FDE68A]" />
                <span>{submitting ? 'جاري التحقق...' : 'تسجيل الدخول بكلمة المرور'}</span>
              </button>

              {/* ONE Unified Native Android BiometricPrompt Button (Fingerprint + Face + Device PIN) */}
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleUnifiedBiometricLogin()}
                className={`w-full min-h-[44px] rounded-xl px-3 text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-transform active:scale-[0.98] border-2 border-[#D4AF37] shadow-md ${
                  bioStatus.hasAnyEnabled
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'gold-btn-3d text-[#0F172A]'
                }`}
                aria-label="الدخول بالبصمة أو الوجه أو رمز الجهاز"
              >
                <Fingerprint className="w-4 h-4 shrink-0" />
                <span>الدخول بالبصمة / الوجه / رمز الجهاز</span>
              </button>

              {isSuperAdminEmail(normalizeAuthIdentifier(identifier).email) && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleFirstTimeAdminSetup}
                  className="w-full min-h-[36px] rounded-xl border-2 border-dashed border-[#D4AF37] bg-amber-50/75 dark:bg-amber-950/25 text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center justify-center gap-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>أول دخول للمدير الأساسي؟ تفعيل حساب الإدارة الآن</span>
                </button>
              )}

              <div className="pt-1.5 border-t-2 border-slate-200 dark:border-slate-800 flex items-center justify-center text-[11.5px] font-extrabold">
                <button
                  type="button"
                  onClick={() => setView('register')}
                  className="text-[#1A365D] dark:text-[#FDE68A] hover:underline py-0.5"
                >
                  ليس لديك حساب؟ طلب فتح حساب وكيل / عميل جديد
                </button>
              </div>
            </form>
          )}

          {/* VIEW 2: REGISTER NEW ACCOUNT (ZERO DISCOUNT % SHOWN) */}
          {view === 'register' && (
            <form onSubmit={handleRegister} className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setRegRole('client')}
                  className={`min-h-[38px] rounded-xl border-2 text-[11.5px] font-extrabold flex items-center justify-center gap-1 transition-all ${
                    regRole === 'client'
                      ? 'border-[#D4AF37] bg-[#1A365D] text-white shadow-sm'
                      : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>عميل / نقطة بيع</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRegRole('agent')}
                  className={`min-h-[38px] rounded-xl border-2 text-[11.5px] font-extrabold flex items-center justify-center gap-1 transition-all ${
                    regRole === 'agent'
                      ? 'border-[#D4AF37] bg-[#1A365D] text-white shadow-sm'
                      : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>وكيل معتمد</span>
                </button>
              </div>

              <input
                type="text"
                required
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="الاسم الكامل / اسم المحل"
                className="w-full min-h-[39px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
              />

              <div className="flex items-center gap-1.5">
                <input
                  type="tel"
                  required
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  placeholder="رقم الهاتف (77xxxxxxx)"
                  className="flex-1 min-h-[39px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none tabular-nums"
                />
                <ContactPickerButton
                  unauthenticated
                  className="min-h-[39px] min-w-[39px] rounded-xl border-2 border-[#D4AF37] bg-[#1A365D] text-[#FDE68A] flex items-center justify-center shrink-0"
                  onSelect={(picked) => {
                    if (picked.name && !regName) setRegName(picked.name);
                    if (picked.phone) setRegPhone(picked.phone);
                  }}
                />
              </div>

              <input
                type="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                placeholder="البريد الإلكتروني (اختياري)"
                className="w-full min-h-[39px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
              />

              <input
                type="password"
                required
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="كلمة المرور (6 أحرف أو أرقام على الأقل)"
                className="w-full min-h-[39px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
              />

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[42px] gold-btn-3d border-2 border-[#92400E] text-[#0F172A] font-extrabold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <UserPlus className="w-4 h-4" />
                <span>{submitting ? 'جاري إرسال الطلب...' : 'إرسال طلب فتح الحساب'}</span>
              </button>
            </form>
          )}

          {/* VIEW 3: PASSWORD RECOVERY */}
          {view === 'reset' && (
            <form onSubmit={handlePasswordReset} className="space-y-2.5">
              <p className="text-[11.5px] font-semibold text-slate-600 dark:text-slate-300 leading-relaxed">
                أدخل رقم هاتفك أو بريدك الإلكتروني لإرسال طلب استعادة كلمة المرور مباشرة إلى إدارة شبكة طيبة نت.
              </p>
              <input
                type="text"
                required
                value={resetIdentifier}
                onChange={(e) => setResetIdentifier(e.target.value)}
                placeholder="77xxxxxxx أو البريد الإلكتروني"
                className="w-full min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
              />
              <input
                type="text"
                value={resetName}
                onChange={(e) => setResetName(e.target.value)}
                placeholder="الاسم الكامل (اختياري)"
                className="w-full min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] royal-btn-3d border-2 border-[#D4AF37] text-white font-extrabold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <KeyRound className="w-4 h-4 text-[#FDE68A]" />
                <span>{submitting ? 'جاري الإرسال...' : 'إرسال طلب استعادة الحساب'}</span>
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Always-Visible Official Footer above Android Navigation Buttons */}
      <footer className="shrink-0 w-full text-center pt-1.5">
        <span className="inline-block px-4 py-1 rounded-full bg-[#0F172A] border-2 border-[#D4AF37] text-xs font-extrabold text-[#FDE68A] shadow-md">
          {SUPER_ADMIN_CONFIG.developerCredit}
        </span>
      </footer>

      {/* Quick-PIN Fallback Modal (when PIN is configured in non-native preview) */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <form
            onSubmit={handlePinConfirm}
            className="w-full max-w-xs rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                رمز التحقق السريع
              </h3>
              <button
                type="button"
                onClick={() => setShowPinModal(false)}
                className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="password"
              inputMode="numeric"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="أدخل رمز PIN"
              className="w-full min-h-[44px] text-center tracking-widest rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-base font-extrabold focus:border-[#D4AF37] focus:outline-none"
            />
            <button
              type="submit"
              className="mt-3 w-full min-h-[44px] gold-btn-3d border-2 border-[#92400E] text-[#0F172A] font-extrabold text-sm rounded-xl"
            >
              تأكيد الدخول
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
