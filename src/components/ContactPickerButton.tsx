import React, { useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';
import { Contact, Phone, Search, User, UserPlus, X } from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import { cleanYemeniPhone } from '../utils/shareExport';

export interface PickedContact {
  name: string;
  phone: string;
}

interface ContactPickerButtonProps {
  onSelect: (contact: PickedContact) => void;
  className?: string;
  title?: string;
  /** When used inside AuthScreen before authentication, disables reading/writing app customer list */
  unauthenticated?: boolean;
}

/**
 * Direct Official Android Phonebook Contact Picker (`@capacitor-community/contacts`):
 * - On Native Android APK: Immediately requests `READ_CONTACTS` via `Contacts.requestPermissions()`
 *   and opens the official Android system Contacts Picker directly via
 *   `Contacts.pickContact({ projection: { name: true, phones: true } })` — ZERO broken intermediate modal!
 * - Auto-extracts `result.contact.name.display` and the first cleaned phone number into the screen inputs.
 * - On Mobile Web / PWA: Uses `navigator.contacts.select` if supported, otherwise opens a clean app directory picker.
 */
export const ContactPickerButton: React.FC<ContactPickerButtonProps> = ({
  onSelect,
  className,
  title = 'اختيار اسم من سجل الهاتف الرسمي',
  unauthenticated = false,
}) => {
  const { customers, managedUsers, createCustomerAccount } = useFirebase();
  const { notifySuccess, notifyWarning, notifyInfo } = useFeedback();

  // Web-only fallback modal (NEVER shown on Native Android!)
  const [webModalOpen, setWebModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [savingQuick, setSavingQuick] = useState(false);

  const isNative = Capacitor.isNativePlatform();

  const appDirectoryContacts = useMemo(() => {
    if (unauthenticated) return [];
    const map = new Map<string, PickedContact & { tag: string }>();

    for (const u of managedUsers) {
      if (u.role === 'super_admin') continue;
      const phone = cleanYemeniPhone(u.phone);
      const key = `a_${phone || u.uid}`;
      if (!map.has(key)) {
        map.set(key, {
          name: u.name,
          phone,
          tag: u.role === 'agent' ? 'وكيل' : 'عميل',
        });
      }
    }
    for (const c of customers) {
      const phone = cleanYemeniPhone(c.phone || '');
      const key = `c_${phone || c.id}`;
      if (!map.has(key)) {
        map.set(key, {
          name: c.name,
          phone,
          tag: c.category || 'دفتر العملاء',
        });
      }
    }

    const q = search.trim().toLowerCase();
    return Array.from(map.values()).filter(
      (item) =>
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.phone.includes(q) ||
        item.tag.toLowerCase().includes(q)
    );
  }, [customers, managedUsers, search, unauthenticated]);

  const pickFromNativeAndroidPhonebook = async (): Promise<void> => {
    try {
      // Step 1: Check & request official Android READ_CONTACTS permission
      let perm = await Contacts.checkPermissions();
      if (perm?.contacts !== 'granted') {
        perm = await Contacts.requestPermissions();
      }
      if (perm?.contacts !== 'granted') {
        notifyWarning(
          'صلاحية جهات الاتصال مطلوبة',
          'يرجى السماح بصلاحية قراءة جهات الاتصال (READ_CONTACTS) لاختيار الاسم من سجل الهاتف.'
        );
        return;
      }

      // Step 2: Open official Android system Contacts Picker directly
      const result = await Contacts.pickContact({
        projection: {
          name: true,
          phones: true,
        },
      });

      const entry = result?.contact;
      if (!entry) return;

      // Step 3: Extract display name and first cleaned phone number
      const displayName = (
        entry.name?.display ||
        [entry.name?.given, entry.name?.family].filter(Boolean).join(' ') ||
        ''
      ).trim();

      const rawFirstPhone =
        entry.phones?.find((p) => p?.number && p.number.trim().length > 0)?.number || '';
      const cleanedPhone = cleanYemeniPhone(rawFirstPhone);

      if (!displayName && !cleanedPhone) {
        notifyWarning('جهة الاتصال لا تحتوي على اسم أو رقم هاتف');
        return;
      }

      onSelect({
        name: displayName || cleanedPhone,
        phone: cleanedPhone,
      });
      notifySuccess(`تم جلب ${displayName || cleanedPhone} من سجل الهاتف ✅`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      if (/cancel|abort|dismiss|back/i.test(message)) {
        return;
      }
      notifyWarning(
        'تعذر فتح سجل جهات اتصال الهاتف',
        'تأكد من منح التطبيق صلاحية جهات الاتصال من إعدادات الهاتف.'
      );
    }
  };

  const handleClick = async () => {
    // 1. Native Android APK — Open Android's official Contacts Picker IMMEDIATELY (no intermediate modal!)
    if (isNative) {
      await pickFromNativeAndroidPhonebook();
      return;
    }

    // 2. Mobile Web / PWA Contact Picker API (Direct OS Phonebook)
    try {
      const nav = navigator as Navigator & {
        contacts?: {
          select: (
            props: string[],
            opts?: { multiple?: boolean }
          ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
        };
      };
      if (nav.contacts && typeof nav.contacts.select === 'function') {
        const picked = await nav.contacts.select(['name', 'tel'], { multiple: false });
        if (picked && picked.length > 0) {
          const name = (picked[0].name?.[0] || '').trim();
          const phone = cleanYemeniPhone(picked[0].tel?.[0] || '');
          if (name || phone) {
            onSelect({ name: name || phone, phone });
            notifySuccess('تم جلب الاسم والرقم من الهاتف بنجاح ✅');
            return;
          }
        }
      }
    } catch {
      // Fall through to clean desktop web directory picker
    }

    // 3. Desktop Web fallback (only when running in a browser without native phonebook API)
    if (unauthenticated) {
      notifyInfo('سجل جهات اتصال الهاتف يعمل تلقائياً في تطبيق أندرويد (APK)');
      return;
    }
    setSearch('');
    setShowQuickCreate(false);
    setWebModalOpen(true);
  };

  const handleQuickSaveNewContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = quickName.trim();
    const cleanPhone = cleanYemeniPhone(quickPhone);
    if (cleanName.length < 2) {
      notifyWarning('الاسم مطلوب', 'أدخل اسم الزبون أو العميل (حرفان على الأقل).');
      return;
    }

    setSavingQuick(true);
    try {
      if (!unauthenticated) {
        await createCustomerAccount({
          name: cleanName,
          phone: cleanPhone,
          category: 'عميل شبكة',
        });
      }
      onSelect({ name: cleanName, phone: cleanPhone });
      setShowQuickCreate(false);
      setQuickName('');
      setQuickPhone('');
      setWebModalOpen(false);
      notifySuccess('تم تسجيل وحفظ الاسم واختياره فوراً ✅');
    } finally {
      setSavingQuick(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        title={title}
        aria-label={title}
        className={
          className ||
          'min-h-[42px] min-w-[42px] rounded-xl bg-[#1A365D] hover:bg-[#142a4a] text-[#FDE68A] border-2 border-[#D4AF37]/80 flex items-center justify-center shrink-0 active:scale-95 transition-transform shadow-sm'
        }
      >
        <Contact className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      {/* Desktop Browser Directory Fallback (never displayed on Android APK) */}
      {!isNative && webModalOpen && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-3 safe-top safe-bottom overflow-y-auto"
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[84dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-white min-w-0">
                <Phone className="w-5 h-5 text-[#FDE68A] shrink-0" />
                <h3 className="text-sm font-extrabold truncate">اختيار عميل / وكيل مسجّل</h3>
              </div>
              <button
                type="button"
                onClick={() => setWebModalOpen(false)}
                aria-label="إغلاق"
                className="w-8 h-8 rounded-full bg-white/15 border border-white/25 text-white flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 space-y-2.5 flex-1 min-h-0 flex flex-col overflow-hidden">
              <button
                type="button"
                onClick={() => setShowQuickCreate((v) => !v)}
                className="min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white border-2 border-[#D4AF37]/80 px-3 text-xs font-extrabold flex items-center justify-center gap-1.5 shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                <span>{showQuickCreate ? 'العودة للدليل' : '+ تسجيل وحفظ عميل جديد'}</span>
              </button>

              {showQuickCreate ? (
                <form
                  onSubmit={handleQuickSaveNewContact}
                  className="rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-[#D4AF37] p-3.5 space-y-2.5"
                >
                  <input
                    type="text"
                    required
                    value={quickName}
                    onChange={(e) => setQuickName(e.target.value)}
                    placeholder="الاسم الكامل للزبون / العميل"
                    className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                  <input
                    type="tel"
                    value={quickPhone}
                    onChange={(e) => setQuickPhone(e.target.value)}
                    placeholder="رقم الهاتف"
                    className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-white tabular-nums focus:border-[#D4AF37] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={savingQuick}
                    className="w-full min-h-[44px] royal-btn-3d text-white text-xs font-extrabold rounded-xl"
                  >
                    {savingQuick ? 'جاري الحفظ...' : 'حفظ واختيار فوراً ✅'}
                  </button>
                </form>
              ) : (
                <>
                  <div className="relative shrink-0">
                    <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="ابحث بالاسم أو رقم الهاتف..."
                      className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5 flex-1 overflow-y-auto taibah-scroll">
                    {appDirectoryContacts.length === 0 ? (
                      <p className="text-center text-xs font-bold text-slate-500 py-6">
                        لا توجد أسماء مطابقة — اضغط "+ تسجيل وحفظ عميل جديد" بالأعلى.
                      </p>
                    ) : (
                      appDirectoryContacts.map((c, idx) => (
                        <button
                          key={`${c.phone}_${idx}`}
                          type="button"
                          onClick={() => {
                            onSelect({ name: c.name, phone: c.phone });
                            setWebModalOpen(false);
                            notifySuccess('تم اختيار الاسم والرقم ✅');
                          }}
                          className="w-full rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-[#D4AF37] bg-slate-50 dark:bg-slate-800 p-2.5 flex items-center justify-between gap-2 text-right"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-8 h-8 rounded-full bg-[#1A365D] text-[#FDE68A] border border-[#D4AF37] flex items-center justify-center shrink-0">
                              <User className="w-4 h-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                                {c.name}
                              </div>
                              <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                                {c.phone || 'بدون رقم'}
                              </div>
                            </div>
                          </div>
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/40 border border-[#D4AF37]/60 text-[#1A365D] dark:text-[#FDE68A] shrink-0">
                            {c.tag}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
