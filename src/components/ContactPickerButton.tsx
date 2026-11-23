import React, { useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';
import {
  Contact,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  Smartphone,
  User,
  UserPlus,
  X,
} from 'lucide-react';
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

// Module-level session cache so opening the official phonebook across screens is instant
let cachedDevicePhonebook: PickedContact[] | null = null;

function extractContactsList(
  entries: Array<{
    name?: { display?: string | null; given?: string | null; family?: string | null } | null;
    phones?: Array<{ number?: string | null }> | null;
  }>
): PickedContact[] {
  const seen = new Set<string>();
  const out: PickedContact[] = [];
  for (const entry of entries) {
    const displayName = (
      entry?.name?.display ||
      [entry?.name?.given, entry?.name?.family].filter(Boolean).join(' ') ||
      ''
    ).trim();
    const phones = entry?.phones || [];
    if (phones.length === 0) continue;
    for (const p of phones) {
      const cleaned = cleanYemeniPhone(p?.number || '');
      if (!cleaned) continue;
      const dedupeKey = `${cleaned}__${displayName.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        name: displayName || cleaned,
        phone: cleaned,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return out;
}

/**
 * Full Official Device Phonebook Contacts Picker + Instant Customer Registration:
 * 1. Native Android APK via `@capacitor-community/contacts` (auto-requests `READ_CONTACTS`,
 *    loads and displays the ENTIRE official phonebook directly as the primary view + native picker).
 * 2. Mobile Web / PWA via `navigator.contacts.select`.
 * 3. Instant registration & save option whenever a customer/consumer is not yet saved in the phonebook.
 */
export const ContactPickerButton: React.FC<ContactPickerButtonProps> = ({
  onSelect,
  className,
  title = 'جلب من سجل أسماء الهاتف الرسمي',
  unauthenticated = false,
}) => {
  const { customers, managedUsers, createCustomerAccount } = useFirebase();
  const { notifySuccess, notifyInfo, notifyWarning } = useFeedback();

  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loadingPhonebook, setLoadingPhonebook] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [phonebookContacts, setPhonebookContacts] = useState<PickedContact[]>(
    () => cachedDevicePhonebook || []
  );
  // Default directly to the official device phonebook on native Android!
  const [activeTab, setActiveTab] = useState<'phone' | 'all' | 'app'>(() =>
    Capacitor.isNativePlatform() ? 'phone' : 'all'
  );

  // Instant register & save new customer/contact form
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [savingQuick, setSavingQuick] = useState(false);

  const isNative = Capacitor.isNativePlatform();

  const directoryContacts = useMemo(() => {
    const map = new Map<string, PickedContact & { tag: string; source: 'phone' | 'app' }>();

    // 1. Official Device Phonebook Contacts (always prioritized first)
    if (activeTab === 'phone' || activeTab === 'all') {
      for (const c of phonebookContacts) {
        const phone = cleanYemeniPhone(c.phone);
        const key = `p_${phone}_${c.name}`;
        if (phone && !map.has(key)) {
          map.set(key, { name: c.name || phone, phone, tag: 'سجل الهاتف', source: 'phone' });
        }
      }
    }

    // 2. App Directory (Agents & Customers)
    if (!unauthenticated && (activeTab === 'app' || activeTab === 'all')) {
      for (const u of managedUsers) {
        if (u.role === 'super_admin') continue;
        const phone = cleanYemeniPhone(u.phone);
        const key = `a_${phone || u.uid}`;
        if (!map.has(key)) {
          map.set(key, {
            name: u.name,
            phone,
            tag: u.role === 'agent' ? 'وكيل' : 'عميل',
            source: 'app',
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
            source: 'app',
          });
        }
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
  }, [activeTab, customers, managedUsers, phonebookContacts, search, unauthenticated]);

  const handleFinishPick = (picked: PickedContact) => {
    const cleanPhone = cleanYemeniPhone(picked.phone);
    onSelect({ name: picked.name.trim(), phone: cleanPhone });
    notifySuccess('تم جلب الاسم والرقم بنجاح ✅');
    setModalOpen(false);
    setShowQuickCreate(false);
  };

  const ensureContactsPermission = async (): Promise<boolean> => {
    try {
      const check = await Contacts.checkPermissions();
      if (check?.contacts === 'granted') {
        setPermissionDenied(false);
        return true;
      }
      const req = await Contacts.requestPermissions();
      if (req?.contacts === 'granted') {
        setPermissionDenied(false);
        return true;
      }
      setPermissionDenied(true);
      notifyWarning(
        'صلاحية جهات الاتصال مطلوبة',
        'يرجى السماح بصلاحية قراءة جهات الاتصال (READ_CONTACTS) لعرض سجل أسماء الهاتف الرسمي بالكامل.'
      );
      return false;
    } catch {
      return false;
    }
  };

  const fetchFullDevicePhonebook = async (forceRefresh = false): Promise<PickedContact[]> => {
    if (!isNative) return [];
    if (!forceRefresh && cachedDevicePhonebook && cachedDevicePhonebook.length > 0) {
      setPhonebookContacts(cachedDevicePhonebook);
      setPermissionDenied(false);
      return cachedDevicePhonebook;
    }
    setLoadingPhonebook(true);
    try {
      const granted = await ensureContactsPermission();
      if (!granted) return [];
      const res = await Contacts.getContacts({
        projection: { name: true, phones: true },
      });
      const extracted = extractContactsList(res?.contacts || []);
      cachedDevicePhonebook = extracted;
      setPhonebookContacts(extracted);
      return extracted;
    } catch {
      return [];
    } finally {
      setLoadingPhonebook(false);
    }
  };

  const handleOpenNativeAndroidPicker = async () => {
    if (!isNative) return;
    try {
      const granted = await ensureContactsPermission();
      if (!granted) return;
      const res = await Contacts.pickContact({
        projection: { name: true, phones: true },
      });
      const entry = res?.contact;
      const displayName = (
        entry?.name?.display ||
        [entry?.name?.given, entry?.name?.family].filter(Boolean).join(' ') ||
        ''
      ).trim();
      const rawNumber = entry?.phones?.find((p) => p?.number)?.number || '';
      const phone = cleanYemeniPhone(rawNumber);
      if (displayName || phone) {
        handleFinishPick({ name: displayName || phone, phone });
      }
    } catch {
      notifyInfo('تم إلغاء منتقي جهات اتصال الهاتف');
    }
  };

  const openQuickCreatePrefilled = () => {
    const trimmed = search.trim();
    const digitsOnly = cleanYemeniPhone(trimmed);
    const looksLikePhone = digitsOnly.length >= 6 && /^[\d\s+\-٠-٩۰-۹]+$/.test(trimmed);
    setQuickName(looksLikePhone ? '' : trimmed);
    setQuickPhone(looksLikePhone ? digitsOnly : '');
    setShowQuickCreate(true);
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
      // Also append to local session phonebook list so it is immediately searchable
      if (cleanPhone) {
        const nextEntry: PickedContact = { name: cleanName, phone: cleanPhone };
        const merged = [nextEntry, ...(cachedDevicePhonebook || phonebookContacts)];
        cachedDevicePhonebook = merged;
        setPhonebookContacts(merged);
      }
      onSelect({ name: cleanName, phone: cleanPhone });
      setShowQuickCreate(false);
      setQuickName('');
      setQuickPhone('');
      setModalOpen(false);
      notifySuccess('تم تسجيل وحفظ الاسم واختياره فوراً ✅');
    } finally {
      setSavingQuick(false);
    }
  };

  const handleClick = async () => {
    setSearch('');
    setShowQuickCreate(false);

    // Tier 1: Native Android APK — Open & Load FULL Official Phonebook Directly
    if (isNative) {
      setActiveTab('phone');
      setModalOpen(true);
      const list = await fetchFullDevicePhonebook(false);
      if (list.length === 0 && !permissionDenied) {
        await handleOpenNativeAndroidPicker();
      }
      return;
    }

    // Tier 2: Mobile Web / PWA Contact Picker API (Direct Phone Contacts)
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
            handleFinishPick({ name: name || phone, phone });
            return;
          }
        }
      }
    } catch {
      // Fall through to unified searchable modal + instant registration
    }

    // Tier 3: Unified Searchable Directory Modal + Quick Registration
    setActiveTab('all');
    setModalOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={title}
        aria-label={title}
        className={
          className ||
          'min-h-[42px] min-w-[42px] rounded-xl bg-[#1A365D] hover:bg-[#142a4a] text-[#FDE68A] border-2 border-[#D4AF37]/80 flex items-center justify-center shrink-0 active:scale-95 transition-transform shadow-sm'
        }
      >
        <Contact className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      {modalOpen && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-3 safe-top safe-bottom overflow-y-auto"
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[86dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-white min-w-0">
                <Phone className="w-5 h-5 text-[#FDE68A] shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold truncate">سجل أسماء الهاتف الرسمي</h3>
                  <p className="text-[10.5px] font-bold text-[#FDE68A] tabular-nums truncate">
                    {phonebookContacts.length > 0
                      ? `جهات اتصال الهاتف: ${phonebookContacts.length} اسم`
                      : 'اختر من سجل الهاتف أو سجّل اسماً جديداً فوراً'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {isNative && (
                  <button
                    type="button"
                    onClick={() => void fetchFullDevicePhonebook(true)}
                    title="تحديث سجل الهاتف"
                    aria-label="تحديث سجل الهاتف"
                    className="w-8 h-8 rounded-full bg-white/15 border border-[#D4AF37]/60 text-[#FDE68A] flex items-center justify-center"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingPhonebook ? 'animate-spin' : ''}`} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  aria-label="إغلاق"
                  className="w-8 h-8 rounded-full bg-white/15 border border-white/25 text-white flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-3.5 space-y-2.5 flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Top Action Strip: Native Android Official Picker + Instant Register New Customer */}
              <div className={`grid gap-1.5 shrink-0 ${isNative ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {isNative && (
                  <button
                    type="button"
                    onClick={handleOpenNativeAndroidPicker}
                    className="min-h-[40px] rounded-xl gold-btn-3d text-[#0F172A] px-2.5 text-[11px] font-extrabold flex items-center justify-center gap-1.5"
                  >
                    <Smartphone className="w-4 h-4 shrink-0" />
                    <span className="truncate">منتقي الهاتف الرسمي</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (showQuickCreate) setShowQuickCreate(false);
                    else openQuickCreatePrefilled();
                  }}
                  className="min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white border-2 border-[#D4AF37]/80 px-2.5 text-[11px] font-extrabold flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <UserPlus className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    {showQuickCreate ? 'العودة لسجل الأسماء' : '+ تسجيل وحفظ عميل/زبون جديد'}
                  </span>
                </button>
              </div>

              {/* Instant Registration & Save Form (when contact is not saved in phonebook) */}
              {showQuickCreate ? (
                <form
                  onSubmit={handleQuickSaveNewContact}
                  className="rounded-2xl bg-slate-50 dark:bg-slate-800/90 border-2 border-[#D4AF37] p-3.5 space-y-2.5 shrink-0"
                >
                  <div className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                    تسجيل وحفظ اسم جديد (غير محفوظ بالهاتف)
                  </div>
                  <input
                    type="text"
                    required
                    value={quickName}
                    onChange={(e) => setQuickName(e.target.value)}
                    placeholder="الاسم الكامل للزبون / العميل / المحل"
                    className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                  <input
                    type="tel"
                    value={quickPhone}
                    onChange={(e) => setQuickPhone(e.target.value)}
                    placeholder="رقم الهاتف (مثال: 77XXXXXXX)"
                    className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-white tabular-nums focus:border-[#D4AF37] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={savingQuick}
                    className="w-full min-h-[44px] royal-btn-3d text-white text-xs font-extrabold rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    <UserPlus className="w-4 h-4 text-[#FDE68A]" />
                    <span>{savingQuick ? 'جاري الحفظ...' : 'حفظ واختيار الاسم فوراً ✅'}</span>
                  </button>
                </form>
              ) : (
                <>
                  {/* Source Filter Tabs — Official Phonebook First */}
                  {!unauthenticated && (
                    <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0">
                      {(
                        [
                          { id: 'phone', label: `سجل الهاتف (${phonebookContacts.length})` },
                          { id: 'all', label: 'الكل' },
                          { id: 'app', label: 'دليل التطبيق' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={`min-h-[32px] rounded-lg text-[11px] font-extrabold transition-colors ${
                            activeTab === tab.id
                              ? 'bg-[#1A365D] text-[#FDE68A] shadow-sm'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Search Input */}
                  <div className="relative shrink-0">
                    <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="ابحث بالاسم أو رقم الهاتف في سجل الهاتف..."
                      className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>

                  {/* Permission Grant Banner if READ_CONTACTS was denied */}
                  {isNative && permissionDenied && (
                    <button
                      type="button"
                      onClick={() => void fetchFullDevicePhonebook(true)}
                      className="w-full min-h-[40px] rounded-xl bg-amber-50 dark:bg-amber-950/40 border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold px-3 shrink-0"
                    >
                      السماح بصلاحية قراءة سجل الهاتف الرسمي (READ_CONTACTS)
                    </button>
                  )}

                  {/* Contacts List */}
                  {loadingPhonebook ? (
                    <div className="py-10 flex flex-col items-center justify-center gap-2 text-[#1A365D] dark:text-[#FDE68A]">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="text-xs font-extrabold">جاري جلب سجل أسماء الهاتف الرسمي...</span>
                    </div>
                  ) : directoryContacts.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 p-4 text-center space-y-2.5">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300 leading-relaxed">
                        {search.trim()
                          ? `لم يُعثر على "${search.trim()}" في سجل الهاتف.`
                          : 'لا توجد جهات اتصال معروضة في هذا التبويب حالياً.'}
                      </p>
                      <button
                        type="button"
                        onClick={openQuickCreatePrefilled}
                        className="w-full min-h-[40px] rounded-xl bg-emerald-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>
                          {search.trim()
                            ? `تسجيل وحفظ "${search.trim()}" فوراً`
                            : 'تسجيل وحفظ عميل / زبون جديد الآن'}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5 flex-1 overflow-y-auto taibah-scroll pl-0.5">
                      {directoryContacts.slice(0, 300).map((c, idx) => (
                        <button
                          key={`${c.source}_${c.phone}_${idx}`}
                          type="button"
                          onClick={() => handleFinishPick({ name: c.name, phone: c.phone })}
                          className="w-full rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-[#D4AF37] bg-slate-50 dark:bg-slate-800/90 p-2.5 flex items-center justify-between gap-2 text-right transition-colors shadow-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
                                c.source === 'phone'
                                  ? 'bg-emerald-700 text-white border-emerald-400'
                                  : 'bg-[#1A365D] text-[#FDE68A] border-[#D4AF37]'
                              }`}
                            >
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
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md shrink-0 border ${
                              c.source === 'phone'
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300'
                                : 'bg-amber-50 dark:bg-amber-900/40 border-[#D4AF37]/60 text-[#1A365D] dark:text-[#FDE68A]'
                            }`}
                          >
                            {c.tag}
                          </span>
                        </button>
                      ))}
                      {directoryContacts.length > 300 && (
                        <p className="text-center text-[11px] font-bold text-slate-500 py-2">
                          يتم عرض أول 300 نتيجة — استخدم البحث للوصول السريع لأي اسم من أصل{' '}
                          {directoryContacts.length}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
