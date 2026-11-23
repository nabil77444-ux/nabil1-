import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { TAIBAH_ASSETS } from '../types/taibah';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'حدث خطأ غير متوقع في التطبيق.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('Taibah Net ErrorBoundary:', error);
  }

  render() {
    if (this.state.hasError) {
      let friendly = 'حدث خلل مؤقت في الاتصال أو الصلاحيات.';
      if (this.state.message.includes('Missing or insufficient permissions')) {
        friendly = 'صلاحيات الوصول السحابية غير مكتملة لهذه العملية. يرجى إعادة المحاولة أو تحديث الصفحة.';
      } else if (this.state.message.includes('INTERNAL ASSERTION FAILED')) {
        friendly = 'حدث تحديث مؤقت في اتصال قاعدة البيانات السحابية. اضغط إعادة تحميل التطبيق لاستئناف العمل بسلاسة.';
      }
      return (
        <div
          dir="rtl"
          className="min-h-[100dvh] flex items-center justify-center bg-slate-100 dark:bg-[#0F172A] p-4 safe-top safe-bottom"
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 p-6 text-center shadow-2xl">
            <div className="w-16 h-16 rounded-full mx-auto p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg mb-4">
              <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
                <img
                  src={TAIBAH_ASSETS.logo}
                  alt="شعار شبكة طيبة نت"
                  referrerPolicy="no-referrer"
                  className="w-full h-full rounded-full object-contain"
                />
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">
              تنبيه تقني — شبكة طيبة نت
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
              {friendly}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 w-full min-h-[46px] royal-btn-3d text-white font-bold rounded-xl flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة تحميل التطبيق
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
