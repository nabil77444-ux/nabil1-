import React, { useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';
import { Contact, Loader2, Phone, RefreshCw, Search, Smartphone, User, X } from 'lucide-react';
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
  /** When used inside AuthScreen before authentication, disables reading app customer list */
  unauthenticated?: boolean;
}

// Module-level session cache so opening the phonebook across different screens is instant
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
 * Full Official Phonebook Contacts Picker:
 * 1. Native Android APK via `@capacitor-community/contacts` (auto-requests `READ_CONTACTS`,
 *    loads the ENTIRE official phonebook for instant search + supports native Android `pickContact`).
 * 2. Mobile Web / PWA via `navigator.contacts.select`.
 * 3. Searchable unified modal combining full device phonebook + app directory (NO .vcf button).
 */
export const ContactPickerButton: React.FC<ContactPickerButtonProps> = ({
  onSelect,
  className,
  title = 'جلب من سجل أسماء الهاتف الرسمي',
  unauthenticated = false,
}) => {
  const { customers, managedUsers } = useFirebase();
  const { notifySuccess, notifyInfo, notifyWarning } = useFeedback();

  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loadingPhonebook, setLoadingPhonebook] = useState(false);
  const [phonebookContacts, setPhonebookContacts] = useState<PickedContact[]>(
    () => cachedDevicePhonebook || []
  );
  const [activeTab, setActiveTab] = useState<'all' | 'phone' | 'app'>('all');

  const isNative = Capacitor.isNativePlatform();

  const directoryContacts = useMemo(() => {
    const map = new Map<string, PickedContact & { tag: string; source: 'phone' | 'app' }>();

    // 1. Official Device Phonebook Contacts (always prioritized first)
    if (activeTab === 'all' || activeTab === 'phone') {
      for (const c of phonebookContacts) {
        const phone = cleanYemeniPhone(c.phone);
        const key = `p_${phone}_${c.name}`;
        if (phone && !map.has(key)) {
          map.set(key, { name: c.name || phone, phone, tag: 'سجل الهاتف', source: 'phone' });
        }
      }
    }

    // 2. App Directory (Agents & Customers)
    if (!unauthenticated && (activeTab === 'all' || activeTab === 'app')) {
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
    notifySuccess('تم جلب الاسم والرقم من جهات الاتصال ✅');
    setModalOpen(false);
  };

  const ensureContactsPermission = async (): Promise<boolean> => {
    try {
      const check = await Contacts.checkPermissions();
      if (check?.contacts === 'granted') return true;
      const req = await Contacts.requestPermissions();
      if (req?.contacts === 'granted') return true;
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

  const handleClick = async () => {
    // Tier 1: Native Android APK — Load FULL Official Phonebook via @capacitor-community/contacts
    if (isNative) {
      setSearch('');
      setActiveTab('all');
      setModalOpen(true);
      const list = await fetchFullDevicePhonebook(false);
      // If ROM blocked full list read, fall back immediately to native Android single contact picker
      if (list.length === 0) {
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
        return;
      }
    } catch {
      // Blocked in desktop browser/iframe — open searchable modal
    }

    // Tier 3: Unified Searchable Directory Modal (Desktop / Iframe)
    setSearch('');
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
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[85dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-white min-w-0">
                <Phone className="w-5 h-5 text-[#FDE68A] shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold truncate">سجل جهات الاتصال الرسمي</h3>
                  {phonebookContacts.length > 0 && (
                    <p className="text-[10.5px] font-bold text-[#FDE68A] tabular-nums">
                      سجل الهاتف: {phonebookContacts.length} جهة اتصال
                    </p>
                  )}
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
              {/* Direct Native Android Picker Shortcut */}
              {isNative && (
                <button
                  type="button"
                  onClick={handleOpenNativeAndroidPicker}
                  className="w-full min-h-[40px] rounded-xl gold-btn-3d text-[#0F172A] text-xs font-extrabold flex items-center justify-center gap-1.5 shrink-0"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>فتح منتقي جهات اتصال الهاتف الرسمي</span>
                </button>
              )}

              {/* Source Filter Tabs when both Phonebook & App Directory exist */}
              {!unauthenticated && phonebookContacts.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0">
                  {(
                    [
                      { id: 'all', label: 'الكل' },
                      { id: 'phone', label: `الهاتف (${phonebookContacts.length})` },
                      { id: 'app', label: 'التطبيق' },
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
                  placeholder="ابحث بالاسم أو رقم الهاتف..."
                  className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              {/* Contacts List */}
              {loadingPhonebook ? (
                <div className="py-10 flex flex-col items-center justify-center gap-2 text-[#1A365D] dark:text-[#FDE68A]">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-xs font-extrabold">جاري جلب سجل أسماء الهاتف الرسمي...</span>
                </div>
              ) : directoryContacts.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 p-5 text-center text-xs font-bold text-slate-700 dark:text-slate-300 leading-relaxed">
                  لا توجد جهات اتصال مطابقة حالياً.
                  <br />
                  عند استخدام تطبيق أندرويد (APK) يتم جلب كامل سجل أسماء الهاتف الرسمي تلقائياً بعد السماح بالصلاحية.
                </div>
              ) : (
                <div className="space-y-1.5 flex-1 overflow-y-auto taibah-scroll pl-0.5">
                  {directoryContacts.slice(0, 250).map((c, idx) => (
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
                  {directoryContacts.length > 250 && (
                    <p className="text-center text-[11px] font-bold text-slate-500 py-2">
                      يتم عرض أول 250 نتيجة — استخدم مربع البحث للوصول السريع لأي اسم من أصل{' '}
                      {directoryContacts.length}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
