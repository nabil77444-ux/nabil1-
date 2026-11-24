import React from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { TAIBAH_ASSETS } from '../types/taibah';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional route/screen key — changing it automatically resets an inline boundary */
  resetKey?: string;
  /** When provided, renders a contained sub-screen error card with a "العودة للرئيسية" button without logging out */
  onReturnHome?: () => void;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, State> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'حدث خطأ غير متوقع في هذه الشاشة.',
    };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: '' });
    }
  }

  componentDidCatch(error: Error) {
    console.error('Taibah Net ErrorBoundary:', error);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      const msg = this.state.message || '';
      let friendly = 'حدث خلل مؤقت أثناء عرض هذه الشاشة، وتم حفظ جلستك بأمان دون تسجيل خروج.';
      if (msg.includes('Missing or insufficient permissions')) {
        friendly = 'صلاحيات الوصول السحابية غير مكتملة لهذه العملية. يمكنك المحاولة مجدداً أو العودة للرئيسية.';
      } else if (msg.includes('INTERNAL ASSERTION FAILED')) {
        friendly = 'حدث تحديث مؤقت في اتصال قاعدة البيانات السحابية. اضغط إعادة المحاولة لاستئناف العمل بسلاسة.';
      }

      const isSubScreen = typeof this.props.onReturnHome === 'function';

      return (
        <div
          dir="rtl"
          className={
            isSubScreen
              ? 'w-full py-10 flex items-center justify-center px-3'
              : 'min-h-[100dvh] flex items-center justify-center bg-slate-100 dark:bg-[#0F172A] p-4 safe-top safe-bottom'
          }
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-6 text-center shadow-2xl">
            <div className="w-14 h-14 rounded-full mx-auto p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg mb-3">
              <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-1">
                <img
                  src={TAIBAH_ASSETS.logo}
                  alt="شعار شبكة طيبة نت"
                  referrerPolicy="no-referrer"
                  className="w-full h-full rounded-full object-contain"
                />
              </div>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-2.5 border border-red-300 dark:border-red-800">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h1 className="text-base font-extrabold text-slate-900 dark:text-white">
              تنبيه تقني — شبكة طيبة نت
            </h1>
            <p className="text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
              {friendly}
            </p>

            {isSubScreen ? (
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    this.setState({ hasError: false, message: '' });
                    this.props.onReturnHome?.();
                  }}
                  className="min-h-[44px] royal-btn-3d border-2 border-[#D4AF37] text-white text-xs font-extrabold rounded-xl flex items-center justify-center gap-1.5 shadow"
                >
                  <Home className="w-4 h-4 text-[#FDE68A]" />
                  <span>العودة للرئيسية</span>
                </button>
                <button
                  type="button"
                  onClick={this.handleRetry}
                  className="min-h-[44px] rounded-xl bg-amber-50 dark:bg-slate-800 border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>إعادة المحاولة</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-5 w-full min-h-[46px] royal-btn-3d border-2 border-[#D4AF37] text-white font-bold rounded-xl flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                إعادة تحميل التطبيق
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
