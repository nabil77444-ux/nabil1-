import React, { useMemo, useRef, useState } from 'react';
import { Contact, Search, Upload, User, X } from 'lucide-react';
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

interface CapacitorContactsWindow extends Window {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      Contacts?: {
        pickContact?: (opts?: { projection?: Record<string, boolean> }) => Promise<{
          contact?: {
            name?: { display?: string };
            phones?: Array<{ number?: string }>;
          };
        }>;
      };
    };
  };
}

/**
 * Parse a .vcf (vCard) file exported from Android/iOS contacts into { name, phone } entries.
 */
function parseVCardContacts(vcfText: string): PickedContact[] {
  const results: PickedContact[] = [];
  const cards = vcfText.split(/BEGIN:VCARD/i).slice(1);
  for (const card of cards) {
    const fnMatch = card.match(/FN[^:]*:([^\r\n]+)/i);
    const telMatch = card.match(/TEL[^:]*:([^\r\n]+)/i);
    const name = (fnMatch?.[1] || '').trim();
    const phone = cleanYemeniPhone(telMatch?.[1] || '');
    if (name || phone) {
      results.push({ name: name || phone, phone });
    }
  }
  return results;
}

/**
 * Universal Contact Picker (Update 13):
 * 1. Native Android APK Capacitor Contacts plugin
 * 2. Web Contact Picker API (navigator.contacts.select)
 * 3. In-app Smart Contact Modal (searchable app customers/agents + .vcf phone contact file import)
 */
export const ContactPickerButton: React.FC<ContactPickerButtonProps> = ({
  onSelect,
  className,
  title = 'جلب من جهات الاتصال',
  unauthenticated = false,
}) => {
  const { customers, managedUsers } = useFirebase();
  const { notifySuccess, notifyInfo } = useFeedback();

  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [vcfContacts, setVcfContacts] = useState<PickedContact[]>([]);
  const vcfInputRef = useRef<HTMLInputElement | null>(null);

  const directoryContacts = useMemo(() => {
    const map = new Map<string, PickedContact & { tag: string }>();

    for (const c of vcfContacts) {
      const key = `${c.phone || c.name}`;
      if (!map.has(key)) map.set(key, { ...c, tag: 'ملف جهات اتصال' });
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
  }, [customers, managedUsers, vcfContacts, search, unauthenticated]);

  const handleFinishPick = (picked: PickedContact) => {
    const cleanPhone = cleanYemeniPhone(picked.phone);
    onSelect({ name: picked.name.trim(), phone: cleanPhone });
    notifySuccess('تم جلب الاسم والرقم بنجاح ✅');
    setModalOpen(false);
  };

  const handleClick = async () => {
    // Tier 1: Native Android APK via Capacitor Contacts plugin
    const capWin = window as CapacitorContactsWindow;
    if (capWin.Capacitor?.isNativePlatform?.() && capWin.Capacitor.Plugins?.Contacts?.pickContact) {
      try {
        const res = await capWin.Capacitor.Plugins.Contacts.pickContact({
          projection: { name: true, phones: true },
        });
        const name = (res.contact?.name?.display || '').trim();
        const phone = cleanYemeniPhone(res.contact?.phones?.[0]?.number || '');
        if (name || phone) {
          handleFinishPick({ name, phone });
          return;
        }
      } catch {
        // Fallback cleanly to next tier
      }
    }

    // Tier 2: Web Contact Picker API (Android Chrome / PWA)
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
            handleFinishPick({ name, phone });
            return;
          }
        }
        return; // User dismissed native sheet
      }
    } catch {
      // Blocked in iframe/desktop — fall through to smart in-app picker modal
    }

    // Tier 3: Smart In-App Contact Directory + .vcf Phone File Picker
    setSearch('');
    setModalOpen(true);
  };

  const handleVcfFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseVCardContacts(text);
      if (parsed.length === 0) {
        notifyInfo('لم يُعثر على أرقام داخل ملف جهات الاتصال');
      } else if (parsed.length === 1) {
        handleFinishPick(parsed[0]);
      } else {
        setVcfContacts(parsed);
        notifySuccess(`تم استيراد ${parsed.length} جهة اتصال من الملف — اختر اسماً`);
      }
    } finally {
      if (vcfInputRef.current) vcfInputRef.current.value = '';
    }
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
                <Contact className="w-5 h-5 text-[#FDE68A]" />
                <h3 className="text-sm font-extrabold">اختيار من جهات الاتصال</h3>
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
              {/* Search existing directory */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث بالاسم أو الرقم..."
                  className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                />
              </div>

              {/* .vcf vCard phone contacts import fallback */}
              <input
                ref={vcfInputRef}
                type="file"
                accept=".vcf,text/vcard"
                onChange={handleVcfFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => vcfInputRef.current?.click()}
                className="w-full min-h-[40px] rounded-xl border border-dashed border-[#D4AF37] bg-amber-50/70 dark:bg-amber-950/25 text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-1.5"
              >
                <Upload className="w-4 h-4" />
                <span>استيراد جهة اتصال من ملف الهاتف (.vcf)</span>
              </button>

              {directoryContacts.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-5 text-center text-xs font-bold text-slate-500 dark:text-slate-400 leading-relaxed">
                  لا توجد جهات اتصال محفوظة في القائمة حالياً.
                  <br />
                  يمكنك استيراد ملف <strong>.vcf</strong> من الهاتف أو فتح التطبيق على الهاتف/APK للوصول المباشر لدليل الهاتف.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
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
