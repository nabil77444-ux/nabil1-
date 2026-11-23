import React, { useMemo, useState } from 'react';
import { Contact, Phone, Search, User, X } from 'lucide-react';
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

interface NativeContactEntry {
  name?: { display?: string; given?: string; family?: string };
  phones?: Array<{ number?: string }>;
}

interface CapacitorContactsWindow extends Window {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      Contacts?: {
        requestPermissions?: () => Promise<{ contacts?: string }>;
        pickContact?: (opts?: { projection?: Record<string, boolean> }) => Promise<{
          contact?: NativeContactEntry;
        }>;
        getContacts?: (opts?: { projection?: Record<string, boolean> }) => Promise<{
          contacts?: NativeContactEntry[];
        }>;
      };
    };
  };
}

/**
 * Direct Real Phone Contacts Picker:
 * 1. Native Android APK via @capacitor-community/contacts (requestPermissions -> pickContact / getContacts)
 * 2. Mobile Web/PWA via navigator.contacts.select
 * 3. Searchable In-App Directory fallback (only when browser/iframe lacks native Phonebook API — NO .vcf button)
 */
export const ContactPickerButton: React.FC<ContactPickerButtonProps> = ({
  onSelect,
  className,
  title = 'جلب من جهات اتصال الهاتف',
  unauthenticated = false,
}) => {
  const { customers, managedUsers } = useFirebase();
  const { notifySuccess, notifyInfo } = useFeedback();

  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [phonebookContacts, setPhonebookContacts] = useState<PickedContact[]>([]);

  const directoryContacts = useMemo(() => {
    const map = new Map<string, PickedContact & { tag: string }>();

    // Real device contacts fetched via Capacitor getContacts (if pickContact wasn't used)
    for (const c of phonebookContacts) {
      const phone = cleanYemeniPhone(c.phone);
      const key = phone || c.name;
      if (key && !map.has(key)) {
        map.set(key, { name: c.name || phone, phone, tag: 'دليل الهاتف' });
      }
    }

    if (!unauthenticated) {
      for (const u of managedUsers) {
        if (u.role === 'super_admin') continue;
        const phone = cleanYemeniPhone(u.phone);
        const key = phone || u.uid;
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
        const key = phone || c.id;
        if (!map.has(key)) {
          map.set(key, {
            name: c.name,
            phone,
            tag: c.category || 'دفتر العملاء',
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
  }, [customers, managedUsers, phonebookContacts, search, unauthenticated]);

  const handleFinishPick = (picked: PickedContact) => {
    const cleanPhone = cleanYemeniPhone(picked.phone);
    onSelect({ name: picked.name.trim(), phone: cleanPhone });
    notifySuccess('تم جلب الاسم والرقم من جهات الاتصال ✅');
    setModalOpen(false);
  };

  const handleClick = async () => {
    const capWin = window as CapacitorContactsWindow;
    const nativeContacts = capWin.Capacitor?.Plugins?.Contacts;

    // Tier 1: Native Android APK — Direct Real Phonebook Access
    if (capWin.Capacitor?.isNativePlatform?.() && nativeContacts) {
      try {
        if (typeof nativeContacts.requestPermissions === 'function') {
          const perm = await nativeContacts.requestPermissions();
          if (perm?.contacts === 'denied') {
            notifyInfo('يرجى السماح بصلاحية جهات الاتصال من إعدادات الهاتف للوصول المباشر لدليل الهاتف');
          }
        }

        if (typeof nativeContacts.pickContact === 'function') {
          const res = await nativeContacts.pickContact({
            projection: { name: true, phones: true },
          });
          const entry = res?.contact;
          const displayName = (
            entry?.name?.display ||
            [entry?.name?.given, entry?.name?.family].filter(Boolean).join(' ') ||
            ''
          ).trim();
          const rawNumber = entry?.phones?.find((p) => p.number)?.number || '';
          const phone = cleanYemeniPhone(rawNumber);
          if (displayName || phone) {
            handleFinishPick({ name: displayName || phone, phone });
            return;
          }
          // If user dismissed native contact picker, stop without opening extra modal
          return;
        }
      } catch {
        // If native pickContact failed on a specific ROM, try direct getContacts list
        if (typeof nativeContacts.getContacts === 'function') {
          try {
            const listRes = await nativeContacts.getContacts({
              projection: { name: true, phones: true },
            });
            const extracted: PickedContact[] = [];
            for (const entry of listRes?.contacts || []) {
              const name = (
                entry.name?.display ||
                [entry.name?.given, entry.name?.family].filter(Boolean).join(' ') ||
                ''
              ).trim();
              const phone = cleanYemeniPhone(entry.phones?.find((p) => p.number)?.number || '');
              if (phone || name) {
                extracted.push({ name: name || phone, phone });
              }
            }
            if (extracted.length > 0) {
              setPhonebookContacts(extracted);
              setSearch('');
              setModalOpen(true);
              return;
            }
          } catch {
            // Fall through cleanly
          }
        }
      }
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
        return; // User closed native contact sheet
      }
    } catch {
      // Blocked in desktop browser/iframe — open searchable in-app directory
    }

    // Tier 3: Searchable In-App Directory (Customers & Agents)
    setSearch('');
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
          'min-h-[42px] min-w-[42px] rounded-xl bg-[#1A365D] hover:bg-[#142a4a] text-[#FDE68A] border border-[#D4AF37]/70 flex items-center justify-center shrink-0 active:scale-95 transition-transform'
        }
      >
        <Contact className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      {modalOpen && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 overflow-y-auto"
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[85dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <Phone className="w-5 h-5 text-[#FDE68A]" />
                <h3 className="text-sm font-extrabold">دليل جهات الاتصال</h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 space-y-3 flex-1 overflow-y-auto">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث بالاسم أو رقم الهاتف..."
                  className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              {directoryContacts.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-5 text-center text-xs font-bold text-slate-500 dark:text-slate-400 leading-relaxed">
                  لا توجد جهات اتصال مطابقة حالياً.
                  <br />
                  عند استخدام تطبيق أندرويد (APK) أو متصفح الهاتف يتم فتح دليل جهات اتصال الهاتف مباشرة بضغطة واحدة.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {directoryContacts.map((c, idx) => (
                    <button
                      key={`${c.phone}_${idx}`}
                      type="button"
                      onClick={() => handleFinishPick({ name: c.name, phone: c.phone })}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 hover:border-[#D4AF37] bg-slate-50 dark:bg-slate-800/80 p-2.5 flex items-center justify-between gap-2 text-right transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-8 h-8 rounded-full bg-[#1A365D] text-[#FDE68A] flex items-center justify-center shrink-0">
                          <User className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                            {c.name}
                          </div>
                          <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                            {c.phone || 'بدون رقم'}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-[#1A365D] dark:text-[#FDE68A] shrink-0">
                        {c.tag}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
