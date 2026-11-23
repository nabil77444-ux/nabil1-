import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LogIn,
  MailCheck,
  Moon,
  Phone,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Sun,
  UserPlus,
  Users,
  AlertCircle,
  ExternalLink,
  Clock,
  XCircle,
  LogOut,
  X,
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
  getSavedBiometricEnrollment,
  isBiometricHardwareAvailable,
  rememberSessionCredentialInMemory,
  syncBiometricVaultOnPasswordLogin,
  verifyDeviceBiometric,
  type BiometricMethod,
} from '../lib/biometric';
import { useFeedback } from '../lib/feedback';
import { useFirebase } from '../contexts/FirebaseContext';
import { SUPER_ADMIN_CONFIG, TAIBAH_ASSETS } from '../types/taibah';
import { ContactPickerButton } from './ContactPickerButton';

const SAVED_IDENTIFIER_KEY = 'taibah_saved_identifier_v1';
const REMEMBER_ME_KEY = 'taibah_remember_me_v1';

type AuthView = 'login' | 'register' | 'reset';

interface AuthScreenProps {
  isDark: boolean;
  onToggleTheme: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ isDark, onToggleTheme }) => {
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
  const [identifier, setIdentifier] = useState(() => localStorage.getItem(SAVED_IDENTIFIER_KEY) || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saveUsername, setSaveUsername] = useState(() => !!localStorage.getItem(SAVED_IDENTIFIER_KEY));
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem(REMEMBER_ME_KEY) !== 'false');
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

  // Biometric & Quick-PIN fallback modal state
  const [hasEnrolledBiometric, setHasEnrolledBiometric] = useState(() => !!getSavedBiometricEnrollment());
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pendingBioMethod, setPendingBioMethod] = useState<BiometricMethod>('fingerprint');

  useEffect(() => {
    isBiometricHardwareAvailable().then(() => {
      setHasEnrolledBiometric(!!getSavedBiometricEnrollment());
    });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      notifyWarning('بيانات ناقصة', 'يرجى إدخال البريد الإلكتروني أو رقم الهاتف وكلمة المرور.');
      return;
    }

    setSubmitting(true);
    setEmailAuthDisabledError(false);

    try {
      await applyAuthPersistence(rememberMe);
      localStorage.setItem(REMEMBER_ME_KEY, String(rememberMe));
      if (saveUsername) {
        localStorage.setItem(SAVED_IDENTIFIER_KEY, identifier.trim());
      } else {
        localStorage.removeItem(SAVED_IDENTIFIER_KEY);
      }

      const { email } = normalizeAuthIdentifier(identifier);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // Automatically arm encrypted local vault so Fingerprint & Face Unlock work independently right away
      await syncBiometricVaultOnPasswordLogin(
        email,
        password,
        identifier.trim(),
        cred.user.displayName || (isSuperAdminEmail(email) ? SUPER_ADMIN_CONFIG.name : identifier.trim()),
        rememberMe
      );
      setHasEnrolledBiometric(!!getSavedBiometricEnrollment());
      notifySuccess('مرحباً بك في كروت طيبة نت — تم تسجيل الدخول وتفعيل الدخول السريع بالبصمة والوجه');
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
            'إذا كانت هذه أول مرة تدخل فيها كمدير، اضغط "تفعيل حساب الإدارة الآن" بالأسفل.'
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
      notifySuccess('تم إنشاء حساب المدير الأساسي وإرسال رابط التحقق إلى بريدك الإلكتروني');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
        setEmailAuthDisabledError(true);
        notifyError('تفعيل مزود الدخول مطلوب', 'يرجى تفعيل Email/Password في Firebase Console أولاً.');
      } else if (code === 'auth/email-already-in-use') {
        notifyInfo('الحساب موجود مسبقاً', 'استخدم زر تسجيل الدخول بكلمة المرور الصحيحة أو استعادة كلمة المرور.');
      } else {
        notifyError('تعذر تفعيل حساب المدير', 'تأكد من كلمة المرور واتصال الإنترنت.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const completeStandaloneBiometricSignIn = async (
    displayName: string,
    savedIdentifier: string,
    credentials: { email: string; password: string } | null | undefined,
    method: BiometricMethod
  ) => {
    const methodLabel = method === 'face' ? 'التعرف على الوجه' : 'البصمة';
    setIdentifier(savedIdentifier);

    if (auth.currentUser) {
      notifySuccess(`تم الدخول الفوري عبر ${methodLabel} — مرحباً ${displayName} ✅`);
      return;
    }

    if (credentials?.email && credentials?.password) {
      setSubmitting(true);
      try {
        await applyAuthPersistence(true);
        await signInWithEmailAndPassword(auth, credentials.email, credentials.password);
        rememberSessionCredentialInMemory(credentials.email, credentials.password);
        notifySuccess(`تم الدخول الفوري عبر ${methodLabel} — مرحباً ${displayName} ✅`);
      } catch {
        notifyError(
          'تعذر إتمام الجلسة السحابية',
          'ربما تم تغيير كلمة مرور الحساب مؤخراً — سجّل الدخول بكلمة المرور الجديدة لتحديث خزنة البصمة تلقائياً.'
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    notifyWarning(
      'يلزم ربط الخزنة الآمنة مرة واحدة فقط',
      'سجّل الدخول بكلمة المرور مرة واحدة فقط ليتم تشفير الجلسة، وبعدها ستدخل بالبصمة والوجه مباشرة دون كلمة مرور نهائياً.'
    );
  };

  const handleBiometricLogin = async (method: BiometricMethod) => {
    const methodLabel = method === 'face' ? 'التعرف على الوجه' : 'البصمة';
    let saved = getSavedBiometricEnrollment();

    // If first time on this device and the user entered their credentials above, arm & verify in 1 step!
    if (!saved && identifier.trim() && password) {
      setSubmitting(true);
      try {
        await applyAuthPersistence(true);
        const { email } = normalizeAuthIdentifier(identifier);
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await syncBiometricVaultOnPasswordLogin(
          email,
          password,
          identifier.trim(),
          cred.user.displayName || (isSuperAdminEmail(email) ? SUPER_ADMIN_CONFIG.name : identifier.trim()),
          true
        );
        saved = getSavedBiometricEnrollment();
        setHasEnrolledBiometric(!!saved);
        notifySuccess(`تم الدخول وتفعيل ${methodLabel} تلقائياً للمرات القادمة ✅`);
        return;
      } catch {
        notifyError('بيانات الحساب غير صحيحة', 'تأكد من البريد أو رقم الهاتف وكلمة المرور لربط الخزنة الآمنة.');
        return;
      } finally {
        setSubmitting(false);
      }
    }

    if (!saved) {
      notifyInfo(
        method === 'face' ? 'ربط الدخول بالوجه (مرة واحدة فقط)' : 'ربط الدخول بالبصمة (مرة واحدة فقط)',
        'سجّل الدخول بالرمز مرة واحدة فقط لحفظ الجلسة مشفرة على هذا الجهاز، وبعدها ستدخل بالوجه أو البصمة فوراً دون كلمة مرور.'
      );
      return;
    }

    setPendingBioMethod(method);
    const result = await verifyDeviceBiometric(undefined, method);
    if (result.requiresPin) {
      setPinInput('');
      setShowPinModal(true);
      return;
    }

    if (result.verified && result.enrollment) {
      await completeStandaloneBiometricSignIn(
        result.enrollment.displayName,
        result.enrollment.identifier,
        result.credentials,
        method
      );
    } else {
      notifyWarning(`لم يكتمل التحقق عبر ${methodLabel}`, 'أعد المحاولة بالوجه أو البصمة أو الدخول بالرمز.');
    }
  };

  const handlePinConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await verifyDeviceBiometric(pinInput.trim(), pendingBioMethod);
    if (res.verified && res.enrollment) {
      setShowPinModal(false);
      await completeStandaloneBiometricSignIn(
        res.enrollment.displayName,
        res.enrollment.identifier,
        res.credentials,
        pendingBioMethod
      );
    } else {
      notifyWarning('الرمز غير مطابق', 'يرجى التأكد من رمز الدخول السريع والمحاولة مجدداً.');
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

  // State 0: Authenticated and hydrating profile — smooth immediate transition to HomeScreen
  if (firebaseUser && profileLoading && !needsAdminEmailVerification) {
    return (
      <div
        dir="rtl"
        className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1A365D] to-[#0F172A] p-4 safe-top safe-bottom"
      >
        <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-6 shadow-2xl text-center">
          <div className="w-20 h-20 rounded-full mx-auto p-1 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg">
            <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
              <img
                src={TAIBAH_ASSETS.logo}
                alt="شعار شبكة طيبة نت"
                referrerPolicy="no-referrer"
                className="w-full h-full rounded-full object-contain"
              />
            </div>
          </div>
          <div className="mt-4 inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-[#1A365D] dark:text-[#FDE68A]">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
          <h2 className="mt-3 text-lg font-extrabold text-slate-900 dark:text-white">
            جاري فتح لوحة التحكم...
          </h2>
          <p className="mt-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            تم التحقق من هويتك بنجاح، جاري الانتقال مباشرة إلى الصفحة الرئيسية.
          </p>
          <button
            type="button"
            onClick={signOutUser}
            className="mt-5 w-full min-h-[40px] rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-red-600 flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  // State A: Super Admin Email Verification Gate (only if first-time & not yet in admins/{uid})
  if (firebaseUser && needsAdminEmailVerification) {
    return (
      <div
        dir="rtl"
        className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1A365D] to-[#0F172A] p-4 safe-top safe-bottom"
      >
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-6 shadow-2xl text-center">
          <div className="w-20 h-20 rounded-full mx-auto p-1 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg">
            <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
              <img
                src={TAIBAH_ASSETS.logo}
                alt="شعار شبكة طيبة نت"
                referrerPolicy="no-referrer"
                className="w-full h-full rounded-full object-contain"
              />
            </div>
          </div>
          <div className="mt-4 inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
            <MailCheck className="w-6 h-6" />
          </div>
          <h2 className="mt-3 text-xl font-extrabold text-slate-900 dark:text-white">
            تأكيد بريد المدير الأساسي
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            لحماية لوحة الإدارة وقواعد الأمان السحابية، يرجى فتح البريد الإلكتروني{' '}
            <strong className="text-[#1A365D] dark:text-[#FDE68A]">{firebaseUser.email}</strong> والنقر على رابط التفعيل، ثم الضغط على زر التحقق أدناه.
          </p>

          <div className="mt-5 space-y-2.5">
            <button
              type="button"
              onClick={() => refreshVerificationStatus()}
              className="w-full min-h-[48px] royal-btn-3d text-white font-extrabold rounded-xl flex items-center justify-center gap-2"
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
              className="w-full min-h-[44px] rounded-xl border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] font-bold text-sm hover:bg-amber-50 dark:hover:bg-slate-800 transition-colors"
            >
              إعادة إرسال رابط التفعيل
            </button>
            <button
              type="button"
              onClick={signOutUser}
              className="w-full min-h-[42px] rounded-xl text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-red-600 flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              تسجيل الخروج
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State B: Authenticated User Pending Approval or Rejected (Live onSnapshot!)
  if (firebaseUser && profile && profile.status !== 'active') {
    const isRejected = profile.status === 'rejected';
    return (
      <div
        dir="rtl"
        className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1A365D] to-[#0F172A] p-4 safe-top safe-bottom"
      >
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-6 shadow-2xl text-center">
          <div className="w-20 h-20 rounded-full mx-auto p-1 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg">
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
            className={`mt-4 inline-flex items-center justify-center w-12 h-12 rounded-2xl ${
              isRejected
                ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
            }`}
          >
            {isRejected ? <XCircle className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
          </div>
          <h2 className="mt-3 text-xl font-extrabold text-slate-900 dark:text-white">
            {isRejected ? 'تم رفض طلب الانضمام' : 'طلبك قيد المراجعة الفورية'}
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {isRejected
              ? `عذراً ${profile.name}، لم تتم الموافقة على تفعيل حسابك. السبب: ${profile.rejectionReason || 'يرجى التواصل مع الإدارة'}`
              : `مرحباً ${profile.name} (${profile.phone})، تم إرسال طلبك لحظياً إلى إدارة شبكة طيبة نت. سيتم فتح التطبيق تلقائياً فور الاعتماد.`}
          </p>
          <p className="mt-3 text-xs font-bold text-[#1A365D] dark:text-[#FDE68A]">
            للتواصل مع الإدارة: {SUPER_ADMIN_CONFIG.phone}
          </p>
          <button
            type="button"
            onClick={signOutUser}
            className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-900 dark:bg-slate-800 text-white font-bold text-sm flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            العودة لشاشة الدخول
          </button>
        </div>
      </div>
    );
  }

  // State C: Authenticated in Firebase Auth, but profile document not loaded yet
  if (firebaseUser && !profileLoading && !profile) {
    return (
      <div
        dir="rtl"
        className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1A365D] to-[#0F172A] p-4 safe-top safe-bottom"
      >
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-6 shadow-2xl text-center">
          <div className="w-20 h-20 rounded-full mx-auto p-1 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg">
            <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
              <img
                src={TAIBAH_ASSETS.logo}
                alt="شعار شبكة طيبة نت"
                referrerPolicy="no-referrer"
                className="w-full h-full rounded-full object-contain"
              />
            </div>
          </div>
          <h2 className="mt-4 text-lg font-extrabold text-slate-900 dark:text-white">
            تعذر تحميل ملف الحساب
          </h2>
          <p className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300 leading-relaxed">
            تم التحقق من دخولك ({firebaseUser.email})، لكن لم نتمكن من قراءة ملف الحساب من قاعدة البيانات السحابية حالياً. تحقق من الاتصال ثم اضغط إعادة المحاولة.
          </p>
          <div className="mt-5 space-y-2.5">
            <button
              type="button"
              onClick={() => {
                void refreshVerificationStatus();
                void syncNow();
              }}
              className="w-full min-h-[46px] royal-btn-3d text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة التحقق وفتح الشاشة الرئيسية
            </button>
            <button
              type="button"
              onClick={signOutUser}
              className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1.5"
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
      className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-slate-200 dark:from-[#0B1220] dark:via-[#0F172A] dark:to-[#1A365D] p-4 safe-top safe-bottom relative overflow-y-auto"
    >
      {/* Theme Toggle floating corner */}
      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={isDark ? 'التبديل للوضع النهاري' : 'التبديل للوضع الليلي'}
        className="fixed top-[max(1rem,env(safe-area-inset-top))] left-4 z-20 w-11 h-11 rounded-full bg-white dark:bg-slate-800 border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] shadow-lg flex items-center justify-center active:scale-95 transition-transform"
      >
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      <div className="w-full max-w-md my-auto space-y-3.5 py-2">
        <div>
          {/* Royal Brand Card Header */}
          <div className="rounded-t-3xl royal-header-3d px-6 pt-6 pb-5 text-center border-x-2 border-t-2 border-[#D4AF37]/80">
            <div className="w-20 h-20 rounded-full mx-auto p-1 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-xl">
              <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
                <img
                  src={TAIBAH_ASSETS.logo}
                  alt="الشعار الرسمي لشبكة طيبة نت"
                  referrerPolicy="no-referrer"
                  className="w-full h-full rounded-full object-contain"
                />
              </div>
            </div>
            <h1 className="mt-3 text-xl font-extrabold text-white tracking-tight">
              كروت طيبة نت — TAIBAH NET
            </h1>
            <p className="text-xs font-semibold text-[#FDE68A] mt-0.5">
              — شبكة طيبة نت - {SUPER_ADMIN_CONFIG.name} —
            </p>
          </div>

          {/* Main 3D Card Body */}
          <div className="rounded-b-3xl bg-white dark:bg-slate-900 border-x-2 border-b-2 border-[#D4AF37]/70 px-5 py-5 shadow-2xl">
            {/* Segmented Mode Tabs */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 mb-5">
              <button
                type="button"
                onClick={() => setView('login')}
                className={`min-h-[40px] rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
                  view === 'login'
                    ? 'bg-[#1A365D] text-white shadow-md'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <LogIn className="w-3.5 h-3.5 shrink-0" />
                <span>دخول</span>
              </button>
              <button
                type="button"
                onClick={() => setView('register')}
                className={`min-h-[40px] rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
                  view === 'register'
                    ? 'bg-[#1A365D] text-white shadow-md'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0" />
                <span>فتح حساب</span>
              </button>
              <button
                type="button"
                onClick={() => setView('reset')}
                className={`min-h-[40px] rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
                  view === 'reset'
                    ? 'bg-[#1A365D] text-white shadow-md'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                <span>استعادة</span>
              </button>
            </div>

            {emailAuthDisabledError && (
              <div className="mb-4 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-400 p-3.5 text-right">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-800 dark:text-amber-100 leading-relaxed">
                    <p className="font-extrabold mb-1">خطوة واحدة مطلوبة في لوحة Firebase:</p>
                    <p>
                      قم بتفعيل خيار <strong>Email/Password</strong> في قسم Authentication داخل مشروع Firebase ليعمل تسجيل الدخول مباشرة:
                    </p>
                    <a
                      href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/providers`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 font-extrabold text-[#1A365D] dark:text-[#FDE68A] underline"
                    >
                      فتح إعدادات Authentication
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW 1: LOGIN */}
            {view === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1.5">
                    البريد الإلكتروني أو رقم الهاتف
                  </label>
                  <div className="relative flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <Phone className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="772466998 أو nabil77444@gmail.com"
                        autoComplete="username"
                        className="w-full min-h-[46px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-10 pl-3 text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#D4AF37] focus:outline-none transition-colors"
                      />
                    </div>
                    <ContactPickerButton
                      unauthenticated
                      className="min-h-[46px] min-w-[46px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[#1A365D] dark:text-[#FDE68A] flex items-center justify-center hover:border-[#D4AF37] transition-colors shrink-0"
                      onSelect={(picked) => {
                        if (picked.phone) setIdentifier(picked.phone);
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1.5">
                    كلمة المرور
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="أدخل كلمة المرور"
                      autoComplete="current-password"
                      className="w-full min-h-[46px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-3.5 pl-11 text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#D4AF37] focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                  <label className="flex items-center gap-2 cursor-pointer select-none min-h-[36px]">
                    <input
                      type="checkbox"
                      checked={saveUsername}
                      onChange={(e) => setSaveUsername(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#1A365D]"
                    />
                    <span>حفظ اسم المستخدم</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none min-h-[36px]">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#1A365D]"
                    />
                    <span>تذكرني</span>
                  </label>
                </div>

                {/* Method 1: Primary 3D Password / Passcode Login Button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[48px] royal-btn-3d text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <LogIn className="w-4 h-4" />
                  <span>{submitting ? 'جاري التحقق...' : 'الدخول بالرمز (كلمة المرور)'}</span>
                </button>

                {/* Methods 2 & 3: Independent Instant Fingerprint + Face Unlock (Always Visible & Active Together) */}
                <div className="space-y-1.5 pt-0.5">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleBiometricLogin('fingerprint')}
                      className={`min-h-[46px] rounded-xl px-3 text-xs font-extrabold flex items-center justify-center gap-1.5 relative transition-transform active:scale-[0.98] ${
                        hasEnrolledBiometric
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-2 border-[#D4AF37] shadow-md'
                          : 'gold-btn-3d text-[#0F172A]'
                      }`}
                      aria-label="الدخول الفوري بالبصمة"
                    >
                      <Fingerprint className="w-4 h-4 shrink-0" />
                      <span>الدخول بالبصمة</span>
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleBiometricLogin('face')}
                      className={`min-h-[46px] rounded-xl px-3 text-xs font-extrabold flex items-center justify-center gap-1.5 relative transition-transform active:scale-[0.98] ${
                        hasEnrolledBiometric
                          ? 'bg-[#1A365D] hover:bg-[#142a4a] text-[#FDE68A] border-2 border-[#D4AF37] shadow-md'
                          : 'bg-[#1A365D] hover:bg-[#142a4a] text-[#FDE68A] border-2 border-[#D4AF37]/85 shadow-sm'
                      }`}
                      aria-label="الدخول الفوري بالتعرف على الوجه"
                    >
                      <ScanFace className="w-4 h-4 shrink-0" />
                      <span>الدخول بالوجه</span>
                    </button>
                  </div>
                  <p className="text-[10.5px] font-bold text-center text-slate-500 dark:text-slate-400">
                    {hasEnrolledBiometric
                      ? 'طرق الدخول الثلاث مفعّلة ومستقلة: الرمز • البصمة • الوجه (دخول فوري بدون كلمة مرور)'
                      : 'متاح الدخول بالرمز أو بالبصمة أو بالوجه (يُحفظ التشفير تلقائياً بعد أول دخول)'}
                  </p>
                </div>

                {isSuperAdminEmail(normalizeAuthIdentifier(identifier).email) && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleFirstTimeAdminSetup}
                    className="w-full min-h-[42px] rounded-xl border border-dashed border-[#D4AF37] bg-amber-50/70 dark:bg-amber-950/25 text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center justify-center gap-1.5 hover:bg-amber-100/70 dark:hover:bg-amber-950/40 transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>أول دخول للمدير الأساسي؟ تفعيل حساب الإدارة الآن</span>
                  </button>
                )}

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setView('register')}
                    className="text-[#1A365D] dark:text-[#FDE68A] hover:underline py-1"
                  >
                    طلب فتح حساب جديد
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('reset')}
                    className="text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 py-1"
                  >
                    نسيت كلمة المرور؟
                  </button>
                </div>
              </form>
            )}

            {/* VIEW 2: REGISTER NEW ACCOUNT (ZERO DISCOUNT % SHOWN) */}
            {view === 'register' && (
              <form onSubmit={handleRegister} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRegRole('client')}
                    className={`min-h-[44px] rounded-xl border-2 text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                      regRole === 'client'
                        ? 'border-[#D4AF37] bg-[#1A365D] text-white shadow-md'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>حساب عميل / نقطة بيع</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegRole('agent')}
                    className={`min-h-[44px] rounded-xl border-2 text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                      regRole === 'agent'
                        ? 'border-[#D4AF37] bg-[#1A365D] text-white shadow-md'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>حساب وكيل معتمد</span>
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                    الاسم الكامل / اسم المحل
                  </label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="مثال: بقالة الأمانة"
                    className="w-full min-h-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                    رقم الهاتف (واتساب / اتصال)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="tel"
                      required
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      placeholder="77xxxxxxx"
                      className="flex-1 min-h-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none tabular-nums"
                    />
                    <ContactPickerButton
                      unauthenticated
                      className="min-h-[44px] min-w-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[#1A365D] dark:text-[#FDE68A] flex items-center justify-center shrink-0"
                      onSelect={(picked) => {
                        if (picked.name && !regName) setRegName(picked.name);
                        if (picked.phone) setRegPhone(picked.phone);
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                    البريد الإلكتروني (اختياري)
                  </label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="example@email.com"
                    className="w-full min-h-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                    كلمة المرور
                  </label>
                  <input
                    type="password"
                    required
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="6 أحرف أو أرقام على الأقل"
                    className="w-full min-h-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[48px] gold-btn-3d text-[#0F172A] font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{submitting ? 'جاري إرسال الطلب...' : 'إرسال طلب فتح الحساب'}</span>
                </button>
              </form>
            )}

            {/* VIEW 3: PASSWORD RECOVERY */}
            {view === 'reset' && (
              <form onSubmit={handlePasswordReset} className="space-y-3.5">
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  أدخل رقم هاتفك أو بريدك الإلكتروني لإرسال طلب استعادة كلمة المرور مباشرة إلى إدارة شبكة طيبة نت للاعتماد الفوري.
                </p>
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                    رقم الهاتف أو البريد الإلكتروني
                  </label>
                  <input
                    type="text"
                    required
                    value={resetIdentifier}
                    onChange={(e) => setResetIdentifier(e.target.value)}
                    placeholder="77xxxxxxx أو البريد الإلكتروني"
                    className="w-full min-h-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                    الاسم الكامل (لتسريع التحقق)
                  </label>
                  <input
                    type="text"
                    value={resetName}
                    onChange={(e) => setResetName(e.target.value)}
                    placeholder="اسم صاحب الحساب"
                    className="w-full min-h-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[48px] royal-btn-3d text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{submitting ? 'جاري الإرسال...' : 'إرسال طلب استعادة الحساب'}</span>
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Official Developer Footer */}
        <p className="text-center text-xs font-extrabold text-slate-700 dark:text-[#FDE68A]">
          {SUPER_ADMIN_CONFIG.developerCredit}
        </p>
      </div>

      {/* Quick-PIN Fallback Modal (when biometric uses PIN inside preview iframe) */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handlePinConfirm}
            className="w-full max-w-xs rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                رمز الدخول السريع
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
              className="w-full min-h-[44px] text-center tracking-widest rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-base font-extrabold focus:border-[#D4AF37] focus:outline-none"
            />
            <button
              type="submit"
              className="mt-3 w-full min-h-[44px] gold-btn-3d text-[#0F172A] font-extrabold text-sm rounded-xl"
            >
              تأكيد الدخول
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
