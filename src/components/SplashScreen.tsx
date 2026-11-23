import React from 'react';
import { SUPER_ADMIN_CONFIG, TAIBAH_ASSETS } from '../types/taibah';

export const SplashScreen: React.FC = () => {
  return (
    <div
      dir="rtl"
      className="h-[100dvh] w-full flex flex-col items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1A365D] to-[#0F172A] text-white px-6 safe-top safe-bottom overflow-hidden select-none"
    >
      <div className="relative flex flex-col items-center">
        <div className="w-28 h-28 rounded-full p-1 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-[0_0_40px_rgba(212,175,55,0.45)]">
          <img
            src={TAIBAH_ASSETS.logo}
            alt="شعار كروت طيبة نت"
            referrerPolicy="no-referrer"
            className="w-full h-full rounded-full object-contain bg-white p-1"
          />
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-white">
          كروت طيبة نت
        </h1>
        <p className="mt-1 text-sm font-semibold text-[#FDE68A]">
          شبكة طيبة نت اللاسلكية — TAIBAH NET
        </p>

        <div className="mt-8 w-44 h-1.5 rounded-full bg-white/15 overflow-hidden">
          <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-[#D4AF37] via-[#FDE68A] to-[#D4AF37] animate-pulse" />
        </div>
        <p className="mt-3 text-xs text-slate-300">جاري الاتصال السحابي الآمن...</p>
      </div>

      <p className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] text-xs text-slate-300/80 font-medium">
        {SUPER_ADMIN_CONFIG.developerCredit}
      </p>
    </div>
  );
};
