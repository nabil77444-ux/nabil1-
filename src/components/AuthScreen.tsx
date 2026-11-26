import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { collection, doc, getDocFromServer, getDocs, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
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
  firebaseAuthRestSignIn,
  firebaseProjectId,
  firestoreRestGetUserDoc,
  firestoreRestLookupEmailByPhone,
  generateSafeDocId,
  handleFirestoreError,
  isSuperAdminEmail,
  normalizeAuthIdentifier,
  normalizeDigits,
  OperationType,
} from '../lib/firebase';
import {
  clearManualSignOutForBiometric,
  getBiometricMethodStatus,
  getSavedBiometricEnrollment,
  isBiometricHardwareAvailable,
  readBiometricVaultCredentials,
  rememberSessionCredentialInMemory,
  resetBiometricPromptLock,
  shouldAutoTriggerBiometricOnLaunch,
  syncBiometricVaultOnPasswordLogin,
  verifyDeviceBiometric,
} from '../lib/biometric';
import { useFeedback } from '../lib/feedback';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  CloudTimeoutError,
  findCachedLocalUserHint,
  findVaultAccountByIdentifier,
  raceWithTimeout,
  saveAccountToLocalVaultSync,
  updateVaultAccountHashDirectly,
  vaultAccountToUserProfile,
  verifyLocalVaultPassword,
  verifyPasswordAgainstSaltedHash,
} from '../lib/localAuthVault';
import { SUPER_ADMIN_CONFIG, TAIBAH_ASSETS, type UserProfile } from '../types/taibah';
import { ContactPickerButton } from './ContactPickerButton';

const SAVED_IDENTIFIER_KEY = 'taibah_saved_identifier_v1';

type AuthView = 'login' | 'register' | 'reset';

interface AuthScreenProps {
  isDark: boolean;
  onToggleTheme: () => void;
  sessionUnlocked: boolean;
  onUnlockSession: (uid?: string, email?: string) => void;
}

function readSavedIdentifierOnce(): string {
  try {
    return localStorage.getItem(SAVED_IDENTIFIER_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Isolated Password Eye Button:
 * Mutates `inputRef.current.type` directly in DOM with `onMouseDown={(e) => e.preventDefault()}`
 * so toggling visibility NEVER steals focus, NEVER closes/reopens the Android keyboard,
 * and NEVER re-renders the login form or AuthScreen.
 */
const PasswordEyeToggle = React.memo(function PasswordEyeToggle({
  inputRef,
}: {
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
}) {
  const [visible, setVisible] = useState(false);

  const handleToggle = useCallback(() => {
    const next = !visible;
    setVisible(next);
    if (inputRef.current) {
      inputRef.current.type = next ? 'text' : 'password';
    }
  }, [inputRef, visible]);

  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleToggle}
      className="absolute left-1.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-600 dark:text-slate-300"
      aria-label={visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
    >
      {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
    </button>
  );
});

interface IsolatedLoginFormProps {
  initialSavedId: string;
  identifierRef: React.MutableRefObject<HTMLInputElement | null>;
  passwordRef: React.MutableRefObject<HTMLInputElement | null>;
  saveUsernameRef: React.MutableRefObject<boolean>;
  submitting: boolean;
  bioBusy: boolean;
  hasAnyBioEnabled: boolean;
  networkRetryError: string | null;
  showAdminSetupBtn: boolean;
  onSubmitForm: (e: React.FormEvent) => void;
  onRetryLogin: () => void;
  onUnifiedBiometric: () => void;
  onFirstTimeAdminSetup: () => void;
  onOpenReset: () => void;
  onOpenRegister: () => void;
  onContactPicked: (phone: string) => void;
}

/**
 * Fully Isolated Uncontrolled Login Form (`React.memo`):
 * - ZERO `onChange` / `onBlur` state updates while typing
 * - ZERO `trim()`, Arabic-digit conversion, validation, or `localStorage` reads per keystroke
 * - Guaranteed 0 React re-renders during typing for instant 60fps input on Android 6+ & Samsung/Xiaomi WebViews
 */
const IsolatedLoginForm = React.memo(function IsolatedLoginForm({
  initialSavedId,
  identifierRef,
  passwordRef,
  saveUsernameRef,
  submitting,
  bioBusy,
  hasAnyBioEnabled,
  networkRetryError,
  showAdminSetupBtn,
  onSubmitForm,
  onRetryLogin,
  onUnifiedBiometric,
  onFirstTimeAdminSetup,
  onOpenReset,
  onOpenRegister,
  onContactPicked,
}: IsolatedLoginFormProps) {
  const [saveUsernameChecked, setSaveUsernameChecked] = useState(() => Boolean(initialSavedId));
  // Default to numbers-only keyboard (type="tel" + inputMode="numeric") since primary login is phone number;
  // 1-tap toggle switches cleanly to full text keyboard for email/letters
  const [idKeyboardMode, setIdKeyboardMode] = useState<'numeric' | 'text'>('numeric');

  // Populate saved username ONCE on mount via ref (never bound to React state!)
  useEffect(() => {
    if (initialSavedId && identifierRef.current && !identifierRef.current.value) {
      identifierRef.current.value = initialSavedId;
    }
  }, [initialSavedId, identifierRef]);

  const toggleIdKeyboardMode = useCallback(() => {
    setIdKeyboardMode((prev) => {
      const next = prev === 'numeric' ? 'text' : 'numeric';
      const el = identifierRef.current;
      if (el && document.activeElement === el) {
        // Brief blur + refocus on next frame so Android IME switches keypad immediately
        el.blur();
        window.requestAnimationFrame(() => {
          el.focus();
        });
      }
      return next;
    });
  }, [identifierRef]);

  const isNumericIdMode = idKeyboardMode === 'numeric';

  return (
    <form onSubmit={onSubmitForm} className="space-y-2.5" autoComplete="off" noValidate>
      <div>
        <label
          htmlFor="taibah-login-id"
          className="block text-[11.5px] font-extrabold text-slate-800 dark:text-slate-200 mb-1"
        >
          رقم الهاتف أو البريد الإلكتروني
        </label>
        <div className="relative flex items-center gap-1.5">
          <div className="relative flex-1">
            <Phone className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="taibah-login-id"
              name="taibah_user_id"
              ref={identifierRef}
              type={isNumericIdMode ? 'tel' : 'text'}
              inputMode={isNumericIdMode ? 'numeric' : 'text'}
              pattern={isNumericIdMode ? '[0-9]*' : undefined}
              dir={isNumericIdMode ? 'ltr' : 'auto'}
              defaultValue={initialSavedId}
              placeholder={isNumericIdMode ? '772466998' : 'البريد الإلكتروني أو رقم الهاتف'}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              data-lpignore="true"
              data-form-type="other"
              onBlur={() => {
                const el = identifierRef.current;
                if (el && el.value) {
                  const converted = normalizeDigits(el.value);
                  if (converted !== el.value) {
                    el.value = converted;
                  }
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  passwordRef.current?.focus();
                }
              }}
              className="w-full min-h-[44px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 pr-9 pl-12 text-base font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#D4AF37] focus:outline-none text-right"
            />
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleIdKeyboardMode}
              title={isNumericIdMode ? 'التبديل إلى لوحة الحروف والبريد' : 'التبديل إلى لوحة الأرقام فقط'}
              aria-label={isNumericIdMode ? 'التبديل إلى لوحة الحروف' : 'التبديل إلى لوحة الأرقام'}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 h-7 min-w-[34px] px-1.5 rounded-lg border border-[#D4AF37]/80 bg-white dark:bg-slate-900 text-[#1A365D] dark:text-[#FDE68A] text-[10.5px] font-extrabold flex items-center justify-center shadow-xs"
            >
              {isNumericIdMode ? 'أب' : '123'}
            </button>
          </div>
          <ContactPickerButton
            unauthenticated
            className="min-h-[44px] min-w-[44px] rounded-xl border-2 border-[#D4AF37] bg-[#1A365D] text-[#FDE68A] flex items-center justify-center shrink-0"
            onSelect={(picked) => {
              if (picked.phone && identifierRef.current) {
                identifierRef.current.value = normalizeDigits(picked.phone);
                onContactPicked(picked.phone);
              }
            }}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="taibah-login-pwd"
          className="block text-[11.5px] font-extrabold text-slate-800 dark:text-slate-200 mb-1"
        >
          كلمة المرور
        </label>
        <div className="relative">
          <input
            id="taibah-login-pwd"
            name="taibah_user_secret"
            ref={passwordRef}
            type="password"
            inputMode="text"
            defaultValue=""
            placeholder="أدخل كلمة المرور"
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            dir="auto"
            enterKeyHint="done"
            data-lpignore="true"
            data-form-type="other"
            className="w-full min-h-[44px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 pr-3 pl-10 text-base font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#D4AF37] focus:outline-none"
          />
          <PasswordEyeToggle inputRef={passwordRef} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11.5px] font-extrabold text-slate-700 dark:text-slate-300">
        <label className="flex items-center gap-1.5 cursor-pointer select-none min-h-[30px]">
          <input
            type="checkbox"
            checked={saveUsernameChecked}
            onChange={(e) => {
              const checked = e.target.checked;
              saveUsernameRef.current = checked;
              setSaveUsernameChecked(checked);
            }}
            className="w-4 h-4 rounded accent-[#1A365D]"
          />
          <span>حفظ اسم المستخدم فقط</span>
        </label>
        <button
          type="button"
          onClick={onOpenReset}
          className="text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 py-0.5"
        >
          نسيت كلمة المرور؟
        </button>
      </div>

      {networkRetryError && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border-2 border-red-400 dark:border-red-700 p-2.5 space-y-2">
          <p className="text-[11px] font-extrabold text-red-700 dark:text-red-300 leading-snug">
            {networkRetryError}
          </p>
          <button
            type="button"
            disabled={submitting}
            onClick={onRetryLogin}
            className="w-full min-h-[36px] rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${submitting ? 'animate-spin' : ''}`} />
            <span>إعادة المحاولة الآن</span>
          </button>
        </div>
      )}

      {/* Primary Password Login Button */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full min-h-[44px] bg-[#1A365D] active:bg-[#0F172A] border-2 border-[#D4AF37] text-white font-extrabold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 shadow-sm"
      >
        <LogIn className="w-4 h-4 text-[#FDE68A]" />
        <span>{submitting ? 'جاري التحقق والتفعيل...' : 'تسجيل الدخول بكلمة المرور'}</span>
      </button>

      {/* ONE Unified Native Android BiometricPrompt Button (Fingerprint + Face + Device PIN) */}
      <button
        type="button"
        disabled={submitting || bioBusy}
        onClick={onUnifiedBiometric}
        className={`w-full min-h-[44px] rounded-xl px-3 text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 border-2 border-[#D4AF37] shadow-sm disabled:opacity-65 ${
          hasAnyBioEnabled
            ? 'bg-emerald-600 active:bg-emerald-700 text-white'
            : 'bg-[#D4AF37] active:bg-[#B4860B] text-[#0F172A]'
        }`}
        aria-label="الدخول بالبصمة أو الوجه أو رمز الجهاز"
      >
        <Fingerprint className="w-4 h-4 shrink-0" />
        <span>{bioBusy ? 'جاري التحقق الحيوي...' : 'الدخول بالبصمة / الوجه / رمز الجهاز'}</span>
      </button>

      {showAdminSetupBtn && (
        <button
          type="button"
          disabled={submitting}
          onClick={onFirstTimeAdminSetup}
          className="w-full min-h-[36px] rounded-xl border-2 border-dashed border-[#D4AF37] bg-amber-50 dark:bg-amber-950/40 text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center justify-center gap-1.5"
        >
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span>أول دخول للمدير الأساسي؟ تفعيل حساب الإدارة الآن</span>
        </button>
      )}

      <div className="pt-1.5 border-t-2 border-slate-200 dark:border-slate-800 flex items-center justify-center text-[11.5px] font-extrabold">
        <button
          type="button"
          onClick={onOpenRegister}
          className="text-[#1A365D] dark:text-[#FDE68A] hover:underline py-0.5"
        >
          ليس لديك حساب؟ طلب فتح حساب وكيل / عميل جديد
        </button>
      </div>
    </form>
  );
});

export const AuthScreen: React.FC<AuthScreenProps> = React.memo(function AuthScreen({
  isDark,
  onToggleTheme,
  sessionUnlocked,
  onUnlockSession,
}: AuthScreenProps) {
  const { notifySuccess, notifyError, notifyWarning, notifyInfo } = useFeedback();
  const {
    firebaseUser,
    profile,
    profileLoading,
    needsAdminEmailVerification,
    refreshVerificationStatus,
    syncNow,
    signOutUser,
    activateLocalSession,
  } = useFirebase();

  const initialSavedId = useRef<string>(readSavedIdentifierOnce());

  // Uncontrolled input refs — ZERO setState / localStorage / regex per keystroke
  const identifierRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const saveUsernameRef = useRef<boolean>(Boolean(initialSavedId.current));
  const regNameRef = useRef<HTMLInputElement | null>(null);
  const regPhoneRef = useRef<HTMLInputElement | null>(null);
  const regEmailRef = useRef<HTMLInputElement | null>(null);
  const regPasswordRef = useRef<HTMLInputElement | null>(null);
  const resetIdentifierRef = useRef<HTMLInputElement | null>(null);
  const resetNameRef = useRef<HTMLInputElement | null>(null);
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  const autoBiometricTriedRef = useRef(false);

  const [view, setView] = useState<AuthView>('login');
  const [submitting, setSubmitting] = useState(false);
  const [emailAuthDisabledError, setEmailAuthDisabledError] = useState(false);
  const [networkRetryError, setNetworkRetryError] = useState<string | null>(null);
  const [showAdminSetupBtn, setShowAdminSetupBtn] = useState(() =>
    isSuperAdminEmail(normalizeAuthIdentifier(initialSavedId.current).email)
  );

  // Registration role toggle only (strictly NO discount percentage shown!)
  const [regRole, setRegRole] = useState<'client' | 'agent'>('client');

  // Unified BiometricPrompt status (Fingerprint + Face + Device PIN)
  const [bioStatus, setBioStatus] = useState(() => getBiometricMethodStatus());
  const [bioBusy, setBioBusy] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);

  useEffect(() => {
    resetBiometricPromptLock();
    void isBiometricHardwareAvailable().then(() => {
      setBioStatus(getBiometricMethodStatus());
    });
    return () => {
      resetBiometricPromptLock();
    };
  }, []);

  // Auto-heal guard ONLY after user explicitly unlocked the current session
  useEffect(() => {
    if (sessionUnlocked && firebaseUser && !profileLoading && !profile && !needsAdminEmailVerification) {
      void syncNow();
    }
  }, [sessionUnlocked, firebaseUser, profileLoading, profile, needsAdminEmailVerification, syncNow]);

  const buildVerifiedProfileFallback = (
    uid: string,
    email: string,
    phone: string,
    displayName?: string | null
  ): UserProfile => {
    const cachedHint = findCachedLocalUserHint(phone || email, uid);
    const isAdmin = isSuperAdminEmail(email) || cachedHint?.role === 'super_admin';
    const role = isAdmin ? 'super_admin' : cachedHint?.role || 'client';
    return {
      uid,
      name: isAdmin
        ? cachedHint?.name || SUPER_ADMIN_CONFIG.name
        : cachedHint?.name || displayName?.trim() || (phone ? `حساب ${phone}` : 'مستخدم طيبة نت'),
      phone: isAdmin ? SUPER_ADMIN_CONFIG.phone : cachedHint?.phone || phone || '770000000',
      email: (email || cachedHint?.email || `${phone || '770000000'}@taibah.net`).toLowerCase(),
      role,
      status: cachedHint?.status && cachedHint.status !== 'pending' ? cachedHint.status : 'active',
      parentAgentId: cachedHint?.parentAgentId || '',
      discountRate:
        typeof cachedHint?.discountRate === 'number'
          ? cachedHint.discountRate
          : role === 'super_admin'
            ? 100
            : role === 'agent'
              ? 70
              : 80,
      balance: typeof cachedHint?.balance === 'number' ? cachedHint.balance : 0,
      fcmTokens: [],
    };
  };

  const buildInstantSuperAdminProfile = (email: string): UserProfile => {
    const cachedHint = findCachedLocalUserHint(SUPER_ADMIN_CONFIG.phone);
    const knownUid =
      (auth.currentUser && isSuperAdminEmail(auth.currentUser.email) ? auth.currentUser.uid : '') ||
      (cachedHint?.uid && cachedHint.role === 'super_admin' ? cachedHint.uid : '') ||
      'super_admin_local_772466998';
    return {
      uid: knownUid,
      name: cachedHint?.name || SUPER_ADMIN_CONFIG.name,
      phone: SUPER_ADMIN_CONFIG.phone,
      email: email.trim().toLowerCase(),
      role: 'super_admin',
      status: 'active',
      parentAgentId: '',
      discountRate: 100,
      balance: typeof cachedHint?.balance === 'number' ? cachedHint.balance : 0,
      fcmTokens: [],
    };
  };

  const executeLoginFlow = async (rawIdentifier: string, rawPassword: string) => {
    const cleanId = rawIdentifier.trim();
    if (!cleanId || !rawPassword) {
      notifyWarning('بيانات ناقصة', 'يرجى إدخال البريد الإلكتروني أو رقم الهاتف وكلمة المرور.');
      return;
    }

    setSubmitting(true);
    setEmailAuthDisabledError(false);
    setNetworkRetryError(null);

    // 20-second generous watchdog for first-time cloud activation over VPN / weak Yemeni mobile networks
    let loginSettled = false;
    const safetyWatchdog = window.setTimeout(() => {
      if (!loginSettled) {
        loginSettled = true;
        setSubmitting(false);
        setNetworkRetryError('انتهت مهلة التفعيل السحابي (20 ثانية) — تحقق من الإنترنت أو الـ VPN واضغط إعادة المحاولة.');
        notifyError(
          'انتهت مهلة التفعيل السحابي',
          'الشبكة بطيئة أو محجوبة — يمكنك الضغط على «إعادة المحاولة» بالأسفل.'
        );
      }
    }, 20000);

    const { email: normalizedEmail, phone: normalizedPhone, isPhoneLogin } = normalizeAuthIdentifier(cleanId);
    if (isSuperAdminEmail(normalizedEmail)) {
      setShowAdminSetupBtn(true);
    }

    try {
      try {
        if (saveUsernameRef.current) {
          localStorage.setItem(SAVED_IDENTIFIER_KEY, cleanId);
        } else {
          localStorage.removeItem(SAVED_IDENTIFIER_KEY);
        }
      } catch {
        // ignore restricted storage
      }

      // =========================================================================
      // STEP 1A: 100% LOCAL VERIFICATION VIA `localAuthVault` (< 0.05s, Pure-JS SHA-256, 0 cloud calls!)
      // =========================================================================
      const localCheck = await verifyLocalVaultPassword(cleanId, rawPassword);

      if (localCheck.status === 'suspended') {
        notifyError('تم إيقاف الحساب', 'تم إيقاف هذا الحساب مؤقتاً من قِبل الإدارة — تواصل مع الإدارة لإعادة التفعيل.');
        return;
      }

      if (localCheck.status === 'wrong_password') {
        const isOfflineNow = typeof navigator !== 'undefined' && !navigator.onLine;
        const staleVaultAccount = localCheck.account;

        // If online and this account's password was updated remotely by Super Admin,
        // check Firestore salted hash before rejecting the password.
        if (!isOfflineNow && staleVaultAccount && auth.currentUser?.uid === staleVaultAccount.uid) {
          try {
            const remoteSnap = await raceWithTimeout(
              getDocFromServer(doc(db, 'users', staleVaultAccount.uid)),
              4500
            );
            if (remoteSnap.exists()) {
              const remoteData = remoteSnap.data() as UserProfile;
              if (remoteData.status === 'suspended' || remoteData.status === 'rejected') {
                notifyError('تم إيقاف الحساب', 'تم إيقاف هذا الحساب مؤقتاً من قِبل الإدارة.');
                return;
              }
              if (
                remoteData.localPasswordHash &&
                remoteData.localPasswordSalt &&
                verifyPasswordAgainstSaltedHash(
                  rawPassword,
                  remoteData.localPasswordHash,
                  remoteData.localPasswordSalt,
                  remoteData.localHashRounds
                )
              ) {
                updateVaultAccountHashDirectly(
                  staleVaultAccount.uid,
                  remoteData.localPasswordHash,
                  remoteData.localPasswordSalt,
                  remoteData.passwordVersion,
                  remoteData.localHashRounds
                );
                const refreshedProfile: UserProfile = {
                  ...vaultAccountToUserProfile(staleVaultAccount),
                  ...remoteData,
                  uid: staleVaultAccount.uid,
                };
                clearManualSignOutForBiometric();
                activateLocalSession(refreshedProfile, {
                  email: refreshedProfile.email,
                  password: rawPassword,
                });
                onUnlockSession(refreshedProfile.uid, refreshedProfile.email);
                void syncBiometricVaultOnPasswordLogin(
                  refreshedProfile.email,
                  rawPassword,
                  cleanId,
                  refreshedProfile.name
                );
                setBioStatus(getBiometricMethodStatus());
                notifySuccess('تم التحقق من كلمة المرور الجديدة وتسجيل الدخول بنجاح ✅');
                return;
              }
            }
          } catch {
            // Fall through to standard cloud sign-in or wrong_password error below
          }
        }

        if (isOfflineNow) {
          notifyError('كلمة المرور غير صحيحة', 'تأكد من كلمة المرور المدخلة وحاول مجدداً.');
          return;
        }
        // When online, allow falling through to Step 2 cloud sign-in in case password was changed remotely
      }

      if (localCheck.status === 'matched' && localCheck.account && localCheck.account.status === 'active') {
        const localProfile = vaultAccountToUserProfile(localCheck.account);
        clearManualSignOutForBiometric();
        activateLocalSession(localProfile, { email: localCheck.account.email, password: rawPassword });
        onUnlockSession(localCheck.account.uid, localCheck.account.email);
        void syncBiometricVaultOnPasswordLogin(
          localCheck.account.email,
          rawPassword,
          cleanId,
          localCheck.account.name
        );
        setBioStatus(getBiometricMethodStatus());
        notifySuccess('مرحباً بك في كروت طيبة نت — تم تسجيل الدخول بنجاح ✅');
        return;
      }

      // =========================================================================
      // STEP 1B: LEGACY LOCAL BIOMETRIC VAULT MIGRATION (bounded 300ms)
      // =========================================================================
      const savedBioMeta = getSavedBiometricEnrollment();
      if (savedBioMeta?.hasVault) {
        try {
          const legacyBioCreds = await raceWithTimeout(readBiometricVaultCredentials(), 300).catch(() => null);
          const cachedHint = findCachedLocalUserHint(cleanId);
          const matchesLegacyEmail =
            legacyBioCreds?.email &&
            (legacyBioCreds.email.toLowerCase() === normalizedEmail.toLowerCase() ||
              (cachedHint?.email && legacyBioCreds.email.toLowerCase() === cachedHint.email.toLowerCase()));
          if (matchesLegacyEmail) {
            if (legacyBioCreds.password !== rawPassword) {
              notifyError('كلمة المرور غير صحيحة', 'تأكد من كلمة المرور المدخلة وحاول مجدداً.');
              return;
            }
            if (cachedHint?.status === 'suspended') {
              notifyError('تم إيقاف الحساب', 'تم إيقاف هذا الحساب من قِبل الإدارة.');
              return;
            }
            const migratedProfile = isSuperAdminEmail(legacyBioCreds.email)
              ? buildInstantSuperAdminProfile(legacyBioCreds.email)
              : buildVerifiedProfileFallback(
                  cachedHint?.uid || `local_user_${normalizedPhone || Date.now()}`,
                  legacyBioCreds.email,
                  normalizedPhone || cachedHint?.phone || '',
                  cachedHint?.name
                );
            clearManualSignOutForBiometric();
            saveAccountToLocalVaultSync(migratedProfile, rawPassword, cleanId);
            activateLocalSession(migratedProfile, { email: legacyBioCreds.email, password: rawPassword });
            onUnlockSession(migratedProfile.uid, migratedProfile.email);
            notifySuccess('مرحباً بك في كروت طيبة نت — تم تسجيل الدخول بنجاح ✅');
            return;
          }
        } catch {
          // Continue to next step
        }
      }

      // =========================================================================
      // STEP 1C: ZERO-BLOCK 100% LOCAL SUPER ADMIN ENTRY (< 0.05s, works offline!)
      // =========================================================================
      if (isSuperAdminEmail(normalizedEmail)) {
        if (rawPassword.length < 6) {
          notifyWarning('كلمة مرور قصيرة', 'أدخل كلمة مرور المدير الصحيحة (6 أحرف على الأقل).');
          return;
        }
        const adminProfile = buildInstantSuperAdminProfile(normalizedEmail);
        clearManualSignOutForBiometric();
        saveAccountToLocalVaultSync(adminProfile, rawPassword, cleanId || SUPER_ADMIN_CONFIG.phone);
        rememberSessionCredentialInMemory(adminProfile.email, rawPassword);
        void syncBiometricVaultOnPasswordLogin(
          adminProfile.email,
          rawPassword,
          cleanId || SUPER_ADMIN_CONFIG.phone,
          adminProfile.name
        );
        setBioStatus(getBiometricMethodStatus());
        activateLocalSession(adminProfile, {
          email: adminProfile.email,
          password: rawPassword,
          isProvisionalAdmin: true,
        });
        onUnlockSession(adminProfile.uid, adminProfile.email);
        notifySuccess('مرحباً بالمدير العام — تم الدخول بنجاح ✅');
        return;
      }

      // =========================================================================
      // STEP 2: FIRST-TIME CLOUD ACTIVATION (20s Budget + Direct HTTPS REST API Fallback!)
      // =========================================================================
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setNetworkRetryError('لا يوجد اتصال بالإنترنت — يلزم الاتصال لمرة واحدة فقط لتفعيل هذا الحساب.');
        notifyError(
          'يلزم الإنترنت للتفعيل لأول مرة',
          'هذا الحساب غير مفعّل محلياً على هذا الجهاز بعد — اتصل بالإنترنت للتفعيل لمرة واحدة فقط.'
        );
        return;
      }

      const deadline = Date.now() + 19500;

      // Resolve phone -> real email from local cache synchronously first (0 cloud reads)
      let authEmailToUse = normalizedEmail;
      if (isPhoneLogin) {
        const cachedByPhone = findCachedLocalUserHint(normalizedPhone);
        if (cachedByPhone?.email && cachedByPhone.email.includes('@')) {
          authEmailToUse = cachedByPhone.email.toLowerCase();
        }
      }

      let verifiedUid = '';
      let verifiedEmail = authEmailToUse;
      let verifiedDisplayName = '';
      let restUserFields: Record<string, unknown> | null = null;

      // Helper: HTTPS REST Auth + Firestore User Doc fallback (bypasses stalled WebChannel/VPN sockets)
      const tryRestAuthSignIn = async (emailCandidate: string): Promise<boolean> => {
        const remaining = Math.max(3000, deadline - Date.now());
        const restRes = await firebaseAuthRestSignIn(emailCandidate, rawPassword, Math.min(12000, remaining));
        if (restRes.ok && restRes.localId && restRes.idToken) {
          verifiedUid = restRes.localId;
          verifiedEmail = restRes.email || emailCandidate;
          verifiedDisplayName = restRes.displayName || '';
          restUserFields = await firestoreRestGetUserDoc(
            restRes.localId,
            restRes.idToken,
            Math.max(2500, Math.min(6000, deadline - Date.now()))
          ).catch(() => null);
          return true;
        }
        // Check explicit wrong credentials from REST API
        const ec = String(restRes.errorCode || '').toUpperCase();
        if (ec.includes('INVALID_PASSWORD') || ec.includes('INVALID_LOGIN_CREDENTIALS')) {
          const e = new Error('INVALID_CREDENTIAL') as Error & { code?: string };
          e.code = 'auth/invalid-credential';
          throw e;
        }
        if (ec.includes('EMAIL_NOT_FOUND')) {
          const e = new Error('USER_NOT_FOUND') as Error & { code?: string };
          e.code = 'auth/user-not-found';
          throw e;
        }
        if (ec.includes('TOO_MANY_ATTEMPTS')) {
          const e = new Error('TOO_MANY_REQUESTS') as Error & { code?: string };
          e.code = 'auth/too-many-requests';
          throw e;
        }
        return false;
      };

      // Attempt A: Firebase SDK signInWithEmailAndPassword (bounded to 9s so 10s remains for REST fallback!)
      let sdkErr: unknown = null;
      try {
        const cred = await raceWithTimeout(
          signInWithEmailAndPassword(auth, authEmailToUse, rawPassword),
          Math.min(9000, Math.max(3000, deadline - Date.now()))
        );
        verifiedUid = cred.user.uid;
        verifiedEmail = cred.user.email || authEmailToUse;
        verifiedDisplayName = cred.user.displayName || '';
      } catch (firstErr: unknown) {
        sdkErr = firstErr;
        const firstCode = (firstErr as { code?: string })?.code || '';
        const isCredentialMiss =
          firstCode === 'auth/user-not-found' || firstCode === 'auth/invalid-credential';
        const isNetworkOrTimeout =
          firstErr instanceof CloudTimeoutError ||
          firstCode === 'cloud/timeout' ||
          firstCode === 'auth/network-request-failed';

        // If SDK stalled due to VPN/weak network, immediately fall back to direct HTTPS REST API!
        if (isNetworkOrTimeout && deadline - Date.now() > 2500) {
          const restOk = await tryRestAuthSignIn(authEmailToUse);
          if (restOk) sdkErr = null;
        }

        // If phone login didn't match `<phone>@taibah.net`, resolve real email via Firestore SDK or REST query
        if (sdkErr && isPhoneLogin && normalizedPhone.length >= 7 && (isCredentialMiss || isNetworkOrTimeout)) {
          let discoveredEmail: string | null = null;
          try {
            const snap = await raceWithTimeout(
              getDocs(query(collection(db, 'users'), where('phone', '==', normalizedPhone), limit(1))),
              Math.max(1500, Math.min(4500, deadline - Date.now() - 2000))
            );
            if (!snap.empty) {
              const rawEmail = String(snap.docs[0].data()?.email || '').trim().toLowerCase();
              if (rawEmail && rawEmail.includes('@') && rawEmail !== authEmailToUse) {
                discoveredEmail = rawEmail;
              }
            }
          } catch {
            discoveredEmail = await firestoreRestLookupEmailByPhone(
              normalizedPhone,
              Math.max(2000, Math.min(5000, deadline - Date.now() - 2000))
            );
          }

          if (discoveredEmail && discoveredEmail !== authEmailToUse && deadline - Date.now() > 1500) {
            authEmailToUse = discoveredEmail;
            try {
              const retryCred = await raceWithTimeout(
                signInWithEmailAndPassword(auth, authEmailToUse, rawPassword),
                Math.min(5000, Math.max(1500, deadline - Date.now()))
              );
              verifiedUid = retryCred.user.uid;
              verifiedEmail = retryCred.user.email || authEmailToUse;
              verifiedDisplayName = retryCred.user.displayName || '';
              sdkErr = null;
            } catch {
              const restOk = await tryRestAuthSignIn(authEmailToUse);
              if (restOk) sdkErr = null;
            }
          }
        }
      }

      if (sdkErr || !verifiedUid) {
        throw sdkErr || new CloudTimeoutError();
      }

      if (loginSettled) return;

      const baseProfile = buildVerifiedProfileFallback(
        verifiedUid,
        verifiedEmail,
        normalizedPhone,
        verifiedDisplayName
      );

      // Merge any live fields retrieved via REST API immediately (so role/status/discountRate are exact!)
      const resolvedRestFields = restUserFields as Record<string, unknown> | null;
      const instantProfile: UserProfile = resolvedRestFields
        ? {
            ...baseProfile,
            name:
              typeof resolvedRestFields.name === 'string' && resolvedRestFields.name.trim()
                ? resolvedRestFields.name.trim()
                : baseProfile.name,
            phone:
              typeof resolvedRestFields.phone === 'string' && resolvedRestFields.phone.trim()
                ? resolvedRestFields.phone.trim()
                : baseProfile.phone,
            role:
              resolvedRestFields.role === 'super_admin' ||
              resolvedRestFields.role === 'agent' ||
              resolvedRestFields.role === 'client'
                ? resolvedRestFields.role
                : baseProfile.role,
            status:
              resolvedRestFields.status === 'active' ||
              resolvedRestFields.status === 'pending' ||
              resolvedRestFields.status === 'rejected' ||
              resolvedRestFields.status === 'suspended'
                ? resolvedRestFields.status
                : baseProfile.status,
            parentAgentId:
              typeof resolvedRestFields.parentAgentId === 'string'
                ? resolvedRestFields.parentAgentId
                : baseProfile.parentAgentId,
            discountRate:
              typeof resolvedRestFields.discountRate === 'number'
                ? resolvedRestFields.discountRate
                : baseProfile.discountRate,
            balance:
              typeof resolvedRestFields.balance === 'number'
                ? resolvedRestFields.balance
                : baseProfile.balance,
            linkedSourceId:
              typeof resolvedRestFields.linkedSourceId === 'string'
                ? resolvedRestFields.linkedSourceId
                : baseProfile.linkedSourceId,
          }
        : baseProfile;

      if (instantProfile.status === 'suspended') {
        notifyError('تم إيقاف الحساب', 'تم إيقاف هذا الحساب مؤقتاً من قِبل الإدارة.');
        return;
      }

      clearManualSignOutForBiometric();
      saveAccountToLocalVaultSync(instantProfile, rawPassword, cleanId);
      void syncBiometricVaultOnPasswordLogin(
        instantProfile.email,
        rawPassword,
        cleanId,
        instantProfile.name
      );
      setBioStatus(getBiometricMethodStatus());

      activateLocalSession(instantProfile, {
        email: instantProfile.email,
        password: rawPassword,
        needsBackgroundProfileRefresh: true,
      });
      onUnlockSession(verifiedUid, instantProfile.email);
      notifySuccess('تم تفعيل الحساب على هذا الجهاز وتسجيل الدخول بنجاح ✅');
    } catch (err: unknown) {
      if (loginSettled) return;
      if (err instanceof CloudTimeoutError || (err as { code?: string })?.code === 'cloud/timeout') {
        setNetworkRetryError('انتهت مهلة التفعيل السحابي — تحقق من الإنترنت أو الـ VPN واضغط إعادة المحاولة.');
        notifyError(
          'انتهت مهلة التفعيل السحابي',
          'الشبكة بطيئة أو محجوبة — تحقق من اتصال الإنترنت أو الـ VPN واضغط «إعادة المحاولة».'
        );
        return;
      }
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
        setEmailAuthDisabledError(true);
        notifyError('تفعيل مزود الدخول مطلوب', 'يرجى تفعيل Email/Password من لوحة Firebase Console.');
      } else if (code === 'auth/wrong-password') {
        notifyError('كلمة المرور غير صحيحة', 'تأكد من كلمة المرور المدخلة وحاول مجدداً.');
      } else if (code === 'auth/user-not-found') {
        notifyError('الحساب غير مسجل', 'البريد الإلكتروني أو رقم الهاتف غير مسجل في النظام.');
      } else if (code === 'auth/invalid-credential') {
        notifyError('كلمة المرور غير صحيحة', 'تأكد من البريد الإلكتروني / رقم الهاتف وكلمة المرور.');
      } else if (code === 'auth/invalid-email') {
        notifyError('صيغة البريد غير صحيحة', 'يرجى إدخال بريد إلكتروني صحيح أو رقم هاتف صالح.');
      } else if (code === 'auth/too-many-requests') {
        notifyError('محاولات كثيرة', 'تم إيقاف المحاولات مؤقتاً لكثرة الإدخالات الخاطئة — انتظر قليلاً ثم أعد المحاولة.');
      } else if (code === 'auth/network-request-failed') {
        setNetworkRetryError('تعذر الاتصال بالشبكة — تحقق من الإنترنت أو الـ VPN ثم اضغط إعادة المحاولة.');
        notifyError(
          'تعذر الاتصال بالشبكة',
          'تحقق من اتصال الإنترنت أو إعدادات الـ VPN ثم أعد المحاولة.'
        );
      } else {
        setNetworkRetryError('تعذر إتمام الاتصال السحابي — يمكنك المحاولة مجدداً الآن.');
        notifyError('تعذر تسجيل الدخول', 'يرجى التحقق من البيانات المدخلة واتصال الإنترنت.');
      }
    } finally {
      loginSettled = true;
      window.clearTimeout(safetyWatchdog);
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawId = identifierRef.current?.value || '';
    const rawPwd = passwordRef.current?.value || '';
    await executeLoginFlow(rawId, rawPwd);
  };

  const handleFirstTimeAdminSetup = async () => {
    const rawId = (identifierRef.current?.value || '').trim();
    const rawPwd = passwordRef.current?.value || '';
    const { email } = normalizeAuthIdentifier(rawId || SUPER_ADMIN_CONFIG.email);
    if (!isSuperAdminEmail(email)) {
      notifyWarning('خاص بالمدير الأساسي فقط', `أدخل ${SUPER_ADMIN_CONFIG.email} أو ${SUPER_ADMIN_CONFIG.phone}`);
      return;
    }
    if (rawPwd.length < 6) {
      notifyWarning('كلمة مرور قصيرة', 'أدخل كلمة مرور قوية من 6 أحرف على الأقل لحساب المدير.');
      return;
    }

    setSubmitting(true);
    setEmailAuthDisabledError(false);
    try {
      const existingCheck = await verifyLocalVaultPassword(email, rawPwd);
      if (existingCheck.status === 'wrong_password') {
        notifyError('كلمة المرور غير صحيحة', 'حساب المدير مفعّل مسبقاً على هذا الجهاز بكلمة مرور مختلفة.');
        return;
      }
      if (existingCheck.status === 'matched' && existingCheck.account) {
        const localProfile = vaultAccountToUserProfile(existingCheck.account);
        clearManualSignOutForBiometric();
        activateLocalSession(localProfile, { email: localProfile.email, password: rawPwd });
        onUnlockSession(localProfile.uid, localProfile.email);
        notifySuccess('مرحباً بالمدير العام — تم الدخول بنجاح ✅');
        return;
      }

      const adminProfile = buildInstantSuperAdminProfile(email);
      clearManualSignOutForBiometric();
      saveAccountToLocalVaultSync(adminProfile, rawPwd, rawId || SUPER_ADMIN_CONFIG.phone);
      rememberSessionCredentialInMemory(email, rawPwd);
      void syncBiometricVaultOnPasswordLogin(
        email,
        rawPwd,
        rawId || SUPER_ADMIN_CONFIG.phone,
        SUPER_ADMIN_CONFIG.name
      );
      setBioStatus(getBiometricMethodStatus());

      activateLocalSession(adminProfile, {
        email,
        password: rawPwd,
        isFirstTimeAdminSetup: true,
        isProvisionalAdmin: true,
      });
      onUnlockSession(adminProfile.uid, email);
      notifySuccess('تم تفعيل حساب المدير العام على هذا الجهاز والدخول بنجاح ✅');
    } catch {
      notifyError('تعذر تفعيل حساب المدير', 'تأكد من كلمة المرور وحاول مجدداً.');
    } finally {
      setSubmitting(false);
    }
  };

  const completeUnifiedBiometricSignIn = useCallback(
    async (
      displayName: string,
      savedIdentifier: string,
      credentials: { email: string; password: string } | null | undefined
    ) => {
      if (identifierRef.current) {
        identifierRef.current.value = savedIdentifier;
      }

      // 100% LOCAL BIOMETRIC SIGN-IN (0 cloud calls, < 0.05s!)
      const vaultAcc =
        findVaultAccountByIdentifier(credentials?.email || '') ||
        findVaultAccountByIdentifier(savedIdentifier);

      if (vaultAcc) {
        if (vaultAcc.status === 'suspended' || vaultAcc.disabled === true) {
          notifyError('تم إيقاف الحساب', 'تم إيقاف هذا الحساب مؤقتاً من قِبل الإدارة.');
          return;
        }
        if (vaultAcc.status === 'active') {
          clearManualSignOutForBiometric();
          if (credentials?.email && credentials?.password) {
            rememberSessionCredentialInMemory(credentials.email, credentials.password);
          }
          activateLocalSession(
            vaultAccountToUserProfile(vaultAcc),
            credentials?.email && credentials?.password ? credentials : undefined
          );
          onUnlockSession(vaultAcc.uid, vaultAcc.email);
          notifySuccess(`تم التحقق الحيوي بنجاح — مرحباً ${vaultAcc.name || displayName} ✅`);
          return;
        }
      }

      if (!credentials?.email || !credentials?.password) {
        notifyWarning(
          'يلزم ربط الدخول الحيوي بكلمة المرور',
          'سجّل الدخول بكلمة المرور أولاً لتفعيل الحساب محلياً، ثم استخدم الدخول الحيوي.'
        );
        return;
      }

      if (isSuperAdminEmail(credentials.email)) {
        const adminProfile = buildInstantSuperAdminProfile(credentials.email);
        clearManualSignOutForBiometric();
        saveAccountToLocalVaultSync(adminProfile, credentials.password, savedIdentifier);
        rememberSessionCredentialInMemory(credentials.email, credentials.password);
        activateLocalSession(adminProfile, { email: credentials.email, password: credentials.password });
        onUnlockSession(adminProfile.uid, credentials.email);
        notifySuccess(`تم التحقق الحيوي بنجاح — مرحباً ${displayName} ✅`);
        return;
      }

      setSubmitting(true);
      try {
        const cred = await raceWithTimeout(
          signInWithEmailAndPassword(auth, credentials.email, credentials.password),
          12000
        );
        const instantProfile = buildVerifiedProfileFallback(
          cred.user.uid,
          credentials.email,
          savedIdentifier,
          displayName || cred.user.displayName
        );

        if (instantProfile.status === 'suspended') {
          notifyError('تم إيقاف الحساب', 'تم إيقاف هذا الحساب من قِبل الإدارة.');
          return;
        }

        clearManualSignOutForBiometric();
        saveAccountToLocalVaultSync(instantProfile, credentials.password, savedIdentifier);
        rememberSessionCredentialInMemory(credentials.email, credentials.password);
        activateLocalSession(instantProfile, {
          email: credentials.email,
          password: credentials.password,
          needsBackgroundProfileRefresh: true,
        });
        onUnlockSession(cred.user.uid, credentials.email);
        notifySuccess(`تم التحقق الحيوي بنجاح — مرحباً ${displayName} ✅`);
      } catch {
        notifyError(
          'تعذر التحقق من بيانات الحساب',
          'يرجى تسجيل الدخول بكلمة المرور مرة واحدة لتحديث الخزنة المحلية.'
        );
      } finally {
        setSubmitting(false);
      }
    },
    [activateLocalSession, notifyError, notifySuccess, notifyWarning, onUnlockSession]
  );

  const handleUnifiedBiometricLogin = useCallback(
    async (isAutoLaunch = false) => {
      if (bioBusy || submitting) return;
      const currentStatus = getBiometricMethodStatus();
      setBioStatus(currentStatus);

      if (!currentStatus.hasAnyEnabled) {
        if (!isAutoLaunch) {
          notifyInfo(
            'الدخول الحيوي غير مُفعّل بعد',
            'سجّل الدخول بكلمة المرور أولاً، ثم افتح «الإعدادات وحول التطبيق» لتفعيل البصمة / الوجه / رمز الجهاز.'
          );
        }
        return;
      }

      setBioBusy(true);
      const safetyTimer = window.setTimeout(() => {
        setBioBusy(false);
      }, 8500);
      try {
        const result = await verifyDeviceBiometric(undefined, 'unified');
        if (result.requiresPin) {
          if (pinInputRef.current) pinInputRef.current.value = '';
          setShowPinModal(true);
          return;
        }

        if (result.verified && result.enrollment) {
          await completeUnifiedBiometricSignIn(
            result.enrollment.displayName,
            result.enrollment.identifier,
            result.credentials
          );
        } else if (result.errorMessage && !isAutoLaunch) {
          notifyWarning('لم يكتمل التحقق الحيوي', result.errorMessage);
        }
      } catch {
        if (!isAutoLaunch) {
          notifyWarning(
            'لم يكتمل التحقق الحيوي',
            'تعذر فتح نافذة التحقق الحيوي — حاول مرة أخرى أو استخدم كلمة المرور.'
          );
        }
      } finally {
        window.clearTimeout(safetyTimer);
        setBioBusy(false);
      }
    },
    [bioBusy, completeUnifiedBiometricSignIn, notifyInfo, notifyWarning, submitting]
  );

  // Instant Auto-Trigger Native Android Biometric / Face / Device PIN on Cold Start (< 0.1s unlock!)
  useEffect(() => {
    if (autoBiometricTriedRef.current || sessionUnlocked) return;
    if (!shouldAutoTriggerBiometricOnLaunch()) return;
    autoBiometricTriedRef.current = true;
    const timer = window.setTimeout(() => {
      void handleUnifiedBiometricLogin(true);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [handleUnifiedBiometricLogin, sessionUnlocked]);

  const handlePinConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawPin = normalizeDigits(pinInputRef.current?.value || '').trim();
    const res = await verifyDeviceBiometric(rawPin, 'unified');
    if (res.verified && res.enrollment) {
      if (pinInputRef.current) pinInputRef.current.value = '';
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

  const handleOpenReset = useCallback(() => setView('reset'), []);
  const handleOpenRegister = useCallback(() => setView('register'), []);
  const handleRetryLogin = useCallback(() => {
    void executeLoginFlow(identifierRef.current?.value || '', passwordRef.current?.value || '');
  }, []);
  const handleUnifiedBioClick = useCallback(() => {
    void handleUnifiedBiometricLogin(false);
  }, [handleUnifiedBiometricLogin]);
  const handleContactPicked = useCallback((phone: string) => {
    setShowAdminSetupBtn(isSuperAdminEmail(normalizeAuthIdentifier(phone).email));
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = (regNameRef.current?.value || '').trim();
    const cleanPhone = normalizeDigits(regPhoneRef.current?.value || '').replace(/[^\d]/g, '');
    const cleanEmailInput = (regEmailRef.current?.value || '').trim();
    const rawRegPassword = regPasswordRef.current?.value || '';

    if (cleanName.length < 2) {
      notifyWarning('الاسم مطلوب', 'يرجى إدخال الاسم الكامل (حرفان على الأقل).');
      return;
    }
    if (cleanPhone.length < 7) {
      notifyWarning('رقم الهاتف غير صالح', 'يرجى إدخال رقم هاتف صحيح.');
      return;
    }
    if (rawRegPassword.length < 6) {
      notifyWarning('كلمة المرور قصيرة', 'يجب أن تكون كلمة المرور 6 أحرف على الأقل.');
      return;
    }

    setSubmitting(true);
    setEmailAuthDisabledError(false);

    try {
      const authEmail = cleanEmailInput
        ? cleanEmailInput.toLowerCase()
        : `${cleanPhone}@taibah.net`;

      await applyAuthPersistence(false);
      const cred = await createUserWithEmailAndPassword(auth, authEmail, rawRegPassword);
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
    const cleaned = normalizeDigits(resetIdentifierRef.current?.value || '').trim();
    const cleanResetName = (resetNameRef.current?.value || '').trim();
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
        name: cleanResetName.slice(0, 100),
        phone: cleaned.includes('@') ? '' : cleaned.replace(/[^\d]/g, '').slice(0, 20),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (cleaned.includes('@') && !cleaned.endsWith('@taibah.net')) {
        await sendPasswordResetEmail(auth, cleaned.toLowerCase()).catch(() => {});
      }

      notifySuccess('تم إرسال طلب استعادة كلمة المرور للإدارة بنجاح');
      if (resetIdentifierRef.current) resetIdentifierRef.current.value = '';
      if (resetNameRef.current) resetNameRef.current.value = '';
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
      className="taibah-app-frame min-h-[100dvh] w-full overflow-y-auto flex flex-col items-center justify-between bg-slate-100 dark:bg-[#0B1220] px-3.5 pt-[calc(env(safe-area-inset-top,0px)+10px)] pb-[calc(env(safe-area-inset-bottom,0px)+14px)] relative"
    >
      {/* Theme Toggle floating corner */}
      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={isDark ? 'التبديل للوضع النهاري' : 'التبديل للوضع الليلي'}
        className="fixed top-[calc(env(safe-area-inset-top,0px)+12px)] left-3.5 z-20 w-9 h-9 rounded-full bg-white dark:bg-slate-800 border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] shadow-sm flex items-center justify-center"
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      {/* Main Centered Compact Auth Card — ultra-lightweight DOM for 60fps Android WebView typing */}
      <div className="w-full max-w-md my-auto flex flex-col justify-center">
        {/* Royal Brand Card Header */}
        <div className="rounded-t-2xl bg-[#1A365D] px-4 pt-3.5 pb-3 text-center border-x-2 border-t-2 border-[#D4AF37]">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full mx-auto p-0.5 bg-[#D4AF37] shadow-sm">
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

        {/* Lightweight Card Body (zero backdrop-blur / shadow-2xl / GPU layer churn) */}
        <div className="rounded-b-2xl bg-white dark:bg-slate-900 border-x-2 border-b-2 border-[#D4AF37] px-4 py-3.5 shadow-sm">
          {/* Segmented Mode Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 mb-3">
            <button
              type="button"
              onClick={() => setView('login')}
              className={`min-h-[34px] rounded-xl text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap ${
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
              className={`min-h-[34px] rounded-xl text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap ${
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
              className={`min-h-[34px] rounded-xl text-xs font-extrabold flex items-center justify-center gap-1 whitespace-nowrap ${
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

          {/* VIEW 1: ISOLATED UNCONTROLLED LOGIN FORM (0 React re-renders while typing!) */}
          {view === 'login' && (
            <IsolatedLoginForm
              initialSavedId={initialSavedId.current}
              identifierRef={identifierRef}
              passwordRef={passwordRef}
              saveUsernameRef={saveUsernameRef}
              submitting={submitting}
              bioBusy={bioBusy}
              hasAnyBioEnabled={bioStatus.hasAnyEnabled}
              networkRetryError={networkRetryError}
              showAdminSetupBtn={showAdminSetupBtn}
              onSubmitForm={handleLogin}
              onRetryLogin={handleRetryLogin}
              onUnifiedBiometric={handleUnifiedBioClick}
              onFirstTimeAdminSetup={handleFirstTimeAdminSetup}
              onOpenReset={handleOpenReset}
              onOpenRegister={handleOpenRegister}
              onContactPicked={handleContactPicked}
            />
          )}

          {/* VIEW 2: REGISTER NEW ACCOUNT (ZERO DISCOUNT % SHOWN, Uncontrolled refs + safe keyboard attrs) */}
          {view === 'register' && (
            <form onSubmit={handleRegister} className="space-y-2" autoComplete="off">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setRegRole('client')}
                  className={`min-h-[38px] rounded-xl border-2 text-[11.5px] font-extrabold flex items-center justify-center gap-1 ${
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
                  className={`min-h-[38px] rounded-xl border-2 text-[11.5px] font-extrabold flex items-center justify-center gap-1 ${
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
                ref={regNameRef}
                type="text"
                inputMode="text"
                required
                defaultValue=""
                placeholder="الاسم الكامل / اسم المحل"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                dir="auto"
                enterKeyHint="next"
                data-lpignore="true"
                data-form-type="other"
                className="w-full min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-base font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
              />

              <div className="flex items-center gap-1.5">
                <input
                  ref={regPhoneRef}
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  dir="ltr"
                  required
                  defaultValue=""
                  placeholder="رقم الهاتف (77xxxxxxx)"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  data-lpignore="true"
                  data-form-type="other"
                  onBlur={() => {
                    if (regPhoneRef.current && regPhoneRef.current.value) {
                      regPhoneRef.current.value = normalizeDigits(regPhoneRef.current.value);
                    }
                  }}
                  className="flex-1 min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-base font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none tabular-nums text-right"
                />
                <ContactPickerButton
                  unauthenticated
                  className="min-h-[42px] min-w-[42px] rounded-xl border-2 border-[#D4AF37] bg-[#1A365D] text-[#FDE68A] flex items-center justify-center shrink-0"
                  onSelect={(picked) => {
                    if (picked.name && regNameRef.current && !regNameRef.current.value) {
                      regNameRef.current.value = picked.name;
                    }
                    if (picked.phone && regPhoneRef.current) {
                      regPhoneRef.current.value = normalizeDigits(picked.phone);
                    }
                  }}
                />
              </div>

              <input
                ref={regEmailRef}
                type="email"
                inputMode="email"
                defaultValue=""
                placeholder="البريد الإلكتروني (اختياري)"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                dir="ltr"
                enterKeyHint="next"
                data-lpignore="true"
                data-form-type="other"
                className="w-full min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-base font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none text-right"
              />

              <input
                ref={regPasswordRef}
                type="password"
                inputMode="text"
                required
                defaultValue=""
                placeholder="كلمة المرور (6 أحرف أو أرقام على الأقل)"
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                dir="auto"
                enterKeyHint="done"
                data-lpignore="true"
                data-form-type="other"
                className="w-full min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-base font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
              />

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] bg-[#D4AF37] active:bg-[#B4860B] border-2 border-[#92400E] text-[#0F172A] font-extrabold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 shadow-sm"
              >
                <UserPlus className="w-4 h-4" />
                <span>{submitting ? 'جاري إرسال الطلب...' : 'إرسال طلب فتح الحساب'}</span>
              </button>
            </form>
          )}

          {/* VIEW 3: PASSWORD RECOVERY (Uncontrolled refs + safe keyboard attrs) */}
          {view === 'reset' && (
            <form onSubmit={handlePasswordReset} className="space-y-2.5" autoComplete="off">
              <p className="text-[11.5px] font-semibold text-slate-600 dark:text-slate-300 leading-relaxed">
                أدخل رقم هاتفك أو بريدك الإلكتروني لإرسال طلب استعادة كلمة المرور مباشرة إلى إدارة شبكة طيبة نت.
              </p>
              <input
                ref={resetIdentifierRef}
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                dir="ltr"
                required
                defaultValue=""
                placeholder="77xxxxxxx أو البريد الإلكتروني"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="next"
                data-lpignore="true"
                data-form-type="other"
                onBlur={() => {
                  if (resetIdentifierRef.current && resetIdentifierRef.current.value) {
                    resetIdentifierRef.current.value = normalizeDigits(resetIdentifierRef.current.value);
                  }
                }}
                className="w-full min-h-[44px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-base font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none text-right"
              />
              <input
                ref={resetNameRef}
                type="text"
                inputMode="text"
                defaultValue=""
                placeholder="الاسم الكامل (اختياري)"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                dir="auto"
                enterKeyHint="done"
                data-lpignore="true"
                data-form-type="other"
                className="w-full min-h-[44px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-base font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] bg-[#1A365D] active:bg-[#0F172A] border-2 border-[#D4AF37] text-white font-extrabold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 shadow-sm"
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
        <span className="inline-block px-4 py-1 rounded-full bg-[#0F172A] border-2 border-[#D4AF37] text-xs font-extrabold text-[#FDE68A] shadow-sm">
          {SUPER_ADMIN_CONFIG.developerCredit}
        </span>
      </footer>

      {/* Quick-PIN Fallback Modal (uncontrolled ref, lightweight card) */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <form
            onSubmit={handlePinConfirm}
            autoComplete="off"
            className="w-full max-w-xs rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-sm"
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
              ref={pinInputRef}
              type="password"
              inputMode="text"
              defaultValue=""
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              dir="auto"
              enterKeyHint="done"
              data-lpignore="true"
              data-form-type="other"
              placeholder="أدخل رمز PIN"
              className="w-full min-h-[44px] text-center tracking-widest rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-base font-extrabold focus:border-[#D4AF37] focus:outline-none"
            />
            <button
              type="submit"
              className="mt-3 w-full min-h-[44px] bg-[#D4AF37] active:bg-[#B4860B] border-2 border-[#92400E] text-[#0F172A] font-extrabold text-sm rounded-xl shadow-sm"
            >
              تأكيد الدخول
            </button>
          </form>
        </div>
      )}
    </div>
  );
});
