import React, { useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ContactPayload } from '@capacitor-community/contacts';
import { Contact, Phone, Search, User, X } from 'lucide-react';
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
  /** Kept for prop backwards-compatibility */
  unauthenticated?: boolean;
}

function formatTechnicalError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err.trim();
  try {
    const serialized = JSON.stringify(err);
    if (serialized && serialized !== '{}') return serialized;
  } catch {
    // Fallback to String(err)
  }
  return String(err || 'خطأ غير معروف في قراءة جهات الاتصال');
}

function extractNameFromPayload(entry?: ContactPayload): string {
  if (!entry?.name) return '';
  return (
    entry.name.display ||
    [entry.name.given, entry.name.middle, entry.name.family].filter(Boolean).join(' ') ||
    ''
  ).trim();
}

function mapNativeContactsList(rawContacts: ContactPayload[]): PickedContact[] {
  const mapped: PickedContact[] = [];
  const seen = new Set<string>();

  for (const entry of rawContacts) {
    const displayName = extractNameFromPayload(entry);
    const cleanedPhones = (entry.phones || [])
      .map((p) => cleanYemeniPhone(p?.number || ''))
      .filter((num) => num.length > 0);

    if (!displayName && cleanedPhones.length === 0) continue;

    if (cleanedPhones.length === 0) {
      const key = `${displayName.toLowerCase()}_`;
      if (!seen.has(key)) {
        seen.add(key);
        mapped.push({ name: displayName, phone: '' });
      }
    } else {
      for (const phone of cleanedPhones) {
        const key = `${displayName.toLowerCase()}_${phone}`;
        if (!seen.has(key)) {
          seen.add(key);
          mapped.push({ name: displayName || phone, phone });
        }
      }
    }
  }

  mapped.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return mapped;
}

/**
 * Official Phonebook Contact Picker (`@capacitor-community/contacts`):
 * - Strictly opens the device's official phonebook ONLY — NEVER opens any internal "registered client/agent" modal!
 * - Native Android:
 *   1. Checks `perm.contacts === 'granted'` and requests permission via `Contacts.requestPermissions()` if needed.
 *   2. Primary: Opens official system picker via `Contacts.pickContact({ projection: { name: true, phones: true } })`.
 *   3. Instant Automatic Fallback: If `pickContact` fails on any Android OEM, immediately loads real phonebook
 *      contacts via `Contacts.getContacts({ projection: { name: true, phones: true } })` into a fast searchable list.
 *   4. If both native methods fail, reports the exact technical error (`err.message || JSON.stringify(err)`).
 * - Mobile Web / PWA: Uses `navigator.contacts.select(['name', 'tel'], { multiple: false })` when supported.
 */
export const ContactPickerButton: React.FC<ContactPickerButtonProps> = ({
  onSelect,
  className,
  title = 'فتح سجل أسماء الهاتف الرسمي',
}) => {
  const { notifySuccess, notifyWarning, notifyError, notifyInfo } = useFeedback();

  // Real Native Phonebook Search Modal (opens ONLY as fallback when pickContact fails and getContacts succeeds)
  const [nativeListOpen, setNativeListOpen] = useState(false);
  const [nativePhoneContacts, setNativePhoneContacts] = useState<PickedContact[]>([]);
  const [nativeSearch, setNativeSearch] = useState('');

  const isNative = (() => {
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  })();

  const filteredNativeContacts = useMemo(() => {
    const q = nativeSearch.trim().toLowerCase();
    const qDigits = cleanYemeniPhone(nativeSearch);
    const matches = nativePhoneContacts.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (qDigits.length > 0 && c.phone.includes(qDigits))
      );
    });
    return matches.slice(0, 250);
  }, [nativePhoneContacts, nativeSearch]);

  const pickFromNativeAndroidPhonebook = async (): Promise<void> => {
    if (!isNative) return;

    let Contacts: (typeof import('@capacitor-community/contacts'))['Contacts'];
    try {
      const mod = await import('@capacitor-community/contacts');
      Contacts = mod.Contacts;
    } catch (loadErr) {
      notifyError('تعذر تحميل إضافة جهات الاتصال', formatTechnicalError(loadErr));
      return;
    }

    // Step 1: Check `perm.contacts === 'granted'` and request permission if not granted
    try {
      let perm = await Contacts.checkPermissions();
      if (perm.contacts !== 'granted') {
        perm = await Contacts.requestPermissions();
      }
      if (perm.contacts !== 'granted') {
        notifyWarning(
          'صلاحية جهات الاتصال مطلوبة',
          `يرجى السماح بصلاحية جهات الاتصال من إعدادات الهاتف (الحالة: ${perm.contacts || 'denied'})`
        );
        return;
      }
    } catch (permErr) {
      notifyError('تعذر فحص صلاحية جهات الاتصال', formatTechnicalError(permErr));
      return;
    }

    // Step 2 (Primary): Official Android Contacts Picker
    let pickError: unknown = null;
    try {
      const res = await Contacts.pickContact({
        projection: {
          name: true,
          phones: true,
        },
      });

      const entry = res?.contact;
      if (entry) {
        const displayName = extractNameFromPayload(entry);
        const rawFirstPhone =
          entry.phones?.find((p) => p?.number && p.number.trim().length > 0)?.number || '';
        const cleanedPhone = cleanYemeniPhone(rawFirstPhone);

        if (displayName || cleanedPhone) {
          onSelect({
            name: displayName || cleanedPhone,
            phone: cleanedPhone,
          });
          notifySuccess(`تم جلب ${displayName || cleanedPhone} من سجل الهاتف ✅`);
          return;
        }
      }
    } catch (err) {
      const msg = formatTechnicalError(err);
      if (/cancel|abort|dismiss|back/i.test(msg)) {
        return;
      }
      pickError = err;
    }

    // Step 3 (Automatic Instant Fallback): Load real device phonebook via `Contacts.getContacts`
    try {
      const result = await Contacts.getContacts({
        projection: {
          name: true,
          phones: true,
        },
      });
      const contactsList = mapNativeContactsList(result?.contacts || []);
      setNativePhoneContacts(contactsList);
      setNativeSearch('');
      setNativeListOpen(true);
    } catch (getErr) {
      const realErrorMsg = formatTechnicalError(getErr || pickError);
      notifyError('تعذر قراءة سجل الهاتف الرسمي', realErrorMsg);
    }
  };

  const handleClick = async () => {
    // 1. Native Android APK — Official Phonebook (pickContact -> getContacts fallback)
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
            notifySuccess('تم جلب الاسم والرقم من سجل الهاتف بنجاح ✅');
            return;
          }
        }
        return;
      }
    } catch (webErr) {
      const msg = formatTechnicalError(webErr);
      if (/cancel|abort/i.test(msg)) return;
    }

    // 3. Unsupported desktop browser — NEVER open internal app directory modal
    notifyInfo(
      'سجل أسماء الهاتف الرسمي',
      'فتح سجل أسماء الهاتف مباشرة يعمل تلقائياً داخل تطبيق أندرويد (APK) ومتصفحات الجوال الداعمة.'
    );
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
          'min-h-[42px] min-w-[42px] rounded-xl bg-[#1A365D] hover:bg-[#142a4a] text-[#FDE68A] border-2 border-[#D4AF37] flex items-center justify-center shrink-0 active:scale-95 transition-transform shadow-sm'
        }
      >
        <Contact className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      {/* Native Android Fallback Real Phonebook Search Modal (`Contacts.getContacts`) */}
      {isNative && nativeListOpen && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/65 p-3 safe-top safe-bottom overflow-y-auto"
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] shadow-2xl overflow-hidden my-auto max-h-[86dvh] flex flex-col">
            <div className="royal-header-3d px-4 py-3 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-white min-w-0">
                <Phone className="w-5 h-5 text-[#FDE68A] shrink-0" />
                <h3 className="text-sm font-extrabold truncate">
                  سجل أسماء الهاتف ({nativePhoneContacts.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setNativeListOpen(false)}
                aria-label="إغلاق"
                className="w-8 h-8 rounded-full bg-white/15 border border-white/25 text-white flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 space-y-2.5 flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="relative shrink-0">
                <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={nativeSearch}
                  onChange={(e) => setNativeSearch(e.target.value)}
                  placeholder="ابحث بالاسم أو رقم الهاتف..."
                  className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              <div className="space-y-1.5 flex-1 overflow-y-auto taibah-scroll">
                {filteredNativeContacts.length === 0 ? (
                  <p className="text-center text-xs font-bold text-slate-500 py-6">
                    {nativePhoneContacts.length === 0
                      ? 'لا توجد أسماء محفوظة في سجل الهاتف.'
                      : 'لا توجد نتائج مطابقة للبحث.'}
                  </p>
                ) : (
                  filteredNativeContacts.map((c, idx) => (
                    <button
                      key={`${c.phone}_${c.name}_${idx}`}
                      type="button"
                      onClick={() => {
                        onSelect({ name: c.name, phone: c.phone });
                        setNativeListOpen(false);
                        notifySuccess(`تم جلب ${c.name || c.phone} من سجل الهاتف ✅`);
                      }}
                      className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-600 hover:border-[#D4AF37] bg-slate-50 dark:bg-slate-800 p-2.5 flex items-center justify-between gap-2 text-right active:scale-[0.99] transition-transform"
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
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
