import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'super_admin' | 'agent' | 'client';
export type UserStatus = 'pending' | 'active' | 'rejected' | 'suspended';

export type AppRoute =
  | 'home'
  | 'direct_sale'
  | 'electronic_cards'
  | 'invoices'
  | 'customers'
  | 'packages'
  | 'topup_requests'
  | 'agents_management'
  | 'reports'
  | 'sales_list'
  | 'notifications'
  | 'settings'
  | 'audit_logs'
  | 'backup';

export const SUPER_ADMIN_CONFIG = {
  name: 'نبيل العرشي',
  phone: '772466998',
  email: 'nabil77444@gmail.com',
  runtimeOwnerEmail: 'nabil7766998@gmail.com',
  role: 'super_admin' as UserRole,
  developerCredit: 'طيبة نت 772466998',
} as const;

export const TAIBAH_ASSETS = {
  logo: '/assets/aistudio/4_0fab49bc.jpg',
  slideMikrotik: '/src/assets/images/slider_mikrotik_hero_1795259828209.jpg',
  slideCards: '/src/assets/images/slider_cards_network_1795259829014.jpg',
  slideNetwork: '/src/assets/images/slider_agents_hub_1795259829125.jpg',
} as const;

export interface UserProfile {
  uid: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  parentAgentId: string;
  discountRate: number;
  balance: number;
  fcmTokens?: string[];
  rejectionReason?: string;
  linkedSourceId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface RegistrationRequest {
  id: string;
  applicantUid: string;
  name: string;
  phone: string;
  email: string;
  requestedRole: 'agent' | 'client';
  parentAgentId: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  reviewedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PasswordResetRequest {
  id: string;
  requesterUid?: string;
  identifier: string;
  name?: string;
  phone?: string;
  status: 'pending' | 'approved' | 'rejected';
  resolvedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PackageDoc {
  id: string;
  code: string;
  price: number;
  dataLabel: string;
  hoursLabel: string;
  validityLabel: string;
  colorTheme: string;
  availableCount: number;
  soldCount: number;
  uploadedCount: number;
  injectedCount: number;
  sortOrder: number;
  updatedAt?: Timestamp;
}

export interface CardDoc {
  id: string;
  packageId: string;
  cardNumber: string;
  status: 'available' | 'assigned_to_agent' | 'sold' | 'returned' | 'recalled' | 'injected';
  ownerId: string;
  soldTo?: string;
  soldToName?: string;
  soldToPhone?: string;
  saleType?: 'direct' | 'electronic_wholesale' | 'paper_invoice' | '';
  saleId?: string;
  batchId?: string;
  recalledFrom?: string;
  previousOwnerId?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AgentPackageCardSummary {
  packageId: string;
  price: number;
  dataLabel: string;
  receivedCount: number;
  soldCount: number;
  remainingCount: number;
  recalledCount: number;
}

export interface AgentSoldCardRecord {
  cardNumber: string;
  packageId: string;
  packagePrice: number;
  packageLabel: string;
  buyerName: string;
  buyerPhone: string;
  soldAtMs: number;
  saleType: 'direct' | 'electronic_wholesale' | 'paper_invoice';
  saleId: string;
  invoiceNumber: string;
  unitPrice: number;
}

export interface AgentRemainingCardRecord {
  id: string;
  cardNumber: string;
  packageId: string;
  packagePrice: number;
  packageLabel: string;
  ownerId: string;
  status: CardDoc['status'];
}

export interface AgentCardInventoryReport {
  targetUid: string;
  targetName: string;
  targetPhone: string;
  targetRole: UserRole;
  discountRate: number;
  totalReceived: number;
  totalSold: number;
  totalRemaining: number;
  totalRecalled: number;
  byPackage: AgentPackageCardSummary[];
  soldCards: AgentSoldCardRecord[];
  remainingCards: AgentRemainingCardRecord[];
  loadedAtMs: number;
  fromCache: boolean;
}

export interface RecallCardsInput {
  targetUser: UserProfile;
  mode: 'all' | 'by_package_qty' | 'specific_cards';
  packageId?: string;
  quantity?: number;
  selectedCardIds?: string[];
  reason?: string;
}

export interface RecallCardsResult {
  ok: boolean;
  error?: string;
  recalledCount: number;
  creditAmount: number;
  discountRateApplied: number;
  previousBalance: number;
  newBalance: number;
  recalledNumbers: string[];
  byPackage: Array<{ packageId: string; price: number; count: number; creditValue: number }>;
  notificationMessage: string;
}

export interface SaleLineItem {
  packageId: string;
  packageLabel: string;
  price: number;
  unitPrice: number;
  quantity: number;
  delivered: number;
  returned: number;
  cardNumbers: string[];
}

export interface SaleDoc {
  id: string;
  invoiceNumber?: string;
  sellerId: string;
  buyerId?: string;
  buyerName: string;
  buyerPhone?: string;
  buyerRole?: 'consumer' | 'client' | 'agent';
  saleType: 'direct' | 'electronic_wholesale' | 'paper_invoice';
  paymentMethod: 'cash' | 'credit' | 'partial';
  discountRate?: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  expectedProfit?: number;
  realizedProfit?: number;
  totalCards: number;
  deliveredCards: number;
  returnedCards?: number;
  items?: SaleLineItem[];
  cardNumbers?: string[];
  status: 'completed' | 'partial' | 'returned' | 'cancelled';
  notes?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CustomerAccount {
  id: string;
  ownerId: string;
  name: string;
  phone?: string;
  category?: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
  notes?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface LedgerEntry {
  id: string;
  ownerId: string;
  customerId: string;
  entryType: 'debit' | 'credit' | 'adjustment';
  amount: number;
  description: string;
  createdAt?: Timestamp;
}

export interface TopupLineItem {
  packageId: string;
  packageLabel: string;
  price: number;
  unitPrice: number;
  quantity: number;
}

export interface TopupRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  requesterPhone?: string;
  requesterRole: 'agent' | 'client';
  discountRate?: number;
  targetId: string;
  targetName?: string;
  items?: TopupLineItem[];
  totalCards: number;
  totalAmount: number;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  notes?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface NotificationDoc {
  id: string;
  recipientId: string;
  senderId?: string;
  title: string;
  body: string;
  category:
    | 'registration'
    | 'topup'
    | 'sale'
    | 'invoice'
    | 'password_reset'
    | 'inventory'
    | 'account'
    | 'system';
  targetRoute: AppRoute;
  isRead: boolean;
  createdAt?: Timestamp;
}

export interface AuditLogDoc {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  details: string;
  createdAt?: Timestamp;
}

export interface HeroSlideConfig {
  id: string;
  image: string;
  title: string;
  subtitle: string;
}

export const DEFAULT_HERO_SLIDES: HeroSlideConfig[] = [
  {
    id: 'slide_1',
    image: TAIBAH_ASSETS.slideMikrotik,
    title: 'شبكة طيبة نت اللاسلكية',
    subtitle: 'تغطية فائقة السرعة • استقرار دائم 24/7',
  },
  {
    id: 'slide_2',
    image: TAIBAH_ASSETS.slideCards,
    title: 'كروت طيبة نت الأصلية',
    subtitle: '8 باقات حصرية متوفرة لدى جميع الوكلاء ونقاط البيع',
  },
  {
    id: 'slide_3',
    image: TAIBAH_ASSETS.slideNetwork,
    title: 'منظومة وكلاء ومبيعات فورية',
    subtitle: 'تغذية لحظية للوكلاء والعملاء ومزامنة سحابية آمنة',
  },
];

export interface AppSettingsDoc {
  newsTicker: string;
  newsTickerEnabled?: boolean;
  newsTickerSpeed?: number;
  sliderEnabled?: boolean;
  sliderSpeed?: number;
  sliderSlides?: HeroSlideConfig[];
  lowStockThreshold: number;
  agentDiscountPercent: number;
  clientDiscountPercent: number;
  directSaleMessageTemplate: string;
  smsMessageTemplate?: string;
  whatsappMessageTemplate?: string;
  pdfHeaderTitle?: string;
  pdfHeaderSubtitle?: string;
  pdfFooterText?: string;
  appDescription?: string;
  apkDownloadUrl?: string;
  updatedAt?: Timestamp;
}

export const DEFAULT_DIRECT_SALE_TEMPLATE =
  '*شبكة طيبة نت اللاسلكية*\n-------------------------\nالباقة: {package}\nالسعر: {price}\nرمز الدخول: {card}\nالرصيد: {balance}\n-------------------------\nنتمنى لكم تصفحاً ممتعاً!';

const LEGACY_DIRECT_SALE_DEFAULTS = new Set<string>([
  'شبكة طيبة نت اللاسلكية (TAIBAH NET)\nالباقة: {package}\nرقم الكرت: {card}\nنتمنى لكم تصفحاً سريعاً وممتعاً.\nطيبة نت 772466998',
  'كروت طيبة نت (TAIBAH NET)\nالباقة: {package}\nالكرت: {card}\nطيبة نت 772466998',
  '👑 *شبكة طيبة نت اللاسلكية (TAIBAH NET)*\n📦 الباقة: *{package}*\n🎫 رقم الكرت: `{card}`\n✨ نتمنى لكم تصفحاً سريعاً وممتعاً.\n📞 طيبة نت 772466998',
]);

export function resolveDirectSaleTemplate(template?: string): string {
  const trimmed = (template || '').trim();
  if (!trimmed || LEGACY_DIRECT_SALE_DEFAULTS.has(trimmed)) {
    return DEFAULT_DIRECT_SALE_TEMPLATE;
  }
  return trimmed;
}

export function formatPackageBalanceFull(dataLabel: string): string {
  const clean = (dataLabel || '').trim();
  if (!clean) return '';
  if (/ميجابايت|جيجابايت/.test(clean)) return clean;
  if (/ميجا/.test(clean)) return clean.replace(/ميجا/g, 'ميجابايت');
  if (/جيجا/.test(clean)) return clean.replace(/جيجا/g, 'جيجابايت');
  return clean;
}

export const DEFAULT_APP_SETTINGS: Omit<AppSettingsDoc, 'updatedAt'> = {
  newsTicker:
    'أهلاً بكم في تطبيق كروت طيبة نت — شبكة طيبة نت اللاسلكية (TAIBAH NET) • بيع فوري وآمن للوكلاء والعملاء والمستهلكين مع مزامنة سحابية لحظية',
  newsTickerEnabled: true,
  newsTickerSpeed: 22,
  sliderEnabled: true,
  sliderSpeed: 5,
  sliderSlides: DEFAULT_HERO_SLIDES,
  lowStockThreshold: 20,
  agentDiscountPercent: 70,
  clientDiscountPercent: 80,
  directSaleMessageTemplate: DEFAULT_DIRECT_SALE_TEMPLATE,
  smsMessageTemplate: DEFAULT_DIRECT_SALE_TEMPLATE,
  whatsappMessageTemplate: DEFAULT_DIRECT_SALE_TEMPLATE,
  pdfHeaderTitle: 'كروت طيبة نت – TAIBAH NET',
  pdfHeaderSubtitle: 'شبكة طيبة نت اللاسلكية — الإدارة المالية ونظام الكروت المعتمد',
  pdfFooterText: 'وثيقة معتمدة صادرة من منظومة كروت طيبة نت — طيبة نت 772466998',
  appDescription:
    'تطبيق كروت طيبة نت الرسمي لإدارة وبيع كروت شبكة طيبة نت اللاسلكية (الميكروويف والواي فاي) — بيع مباشر للمستهلك، جملة للوكلاء ونقاط البيع، فواتير محاسبية وتقارير فورية.',
  apkDownloadUrl: '',
};

/**
 * The 8 Exclusive Taibah Net Packages — strictly initialized at ZERO stock/sales.
 * Exact color mapping per Update 4:
 * 100 green, 200 blue, 250 orange, 500 purple, 1000 emerald, 2000 olive, 2500 teal, 3000 royal gold.
 */
export const EXCLUSIVE_PACKAGES: Omit<PackageDoc, 'updatedAt'>[] = [
  {
    id: 'pkg_100',
    code: 'PKG-100',
    price: 100,
    dataLabel: '400 ميجا',
    hoursLabel: '5 ساعات',
    validityLabel: '5 أيام',
    colorTheme: 'green',
    availableCount: 0,
    soldCount: 0,
    uploadedCount: 0,
    injectedCount: 0,
    sortOrder: 1,
  },
  {
    id: 'pkg_200',
    code: 'PKG-200',
    price: 200,
    dataLabel: '800 ميجا',
    hoursLabel: '12 ساعة',
    validityLabel: '10 أيام',
    colorTheme: 'blue',
    availableCount: 0,
    soldCount: 0,
    uploadedCount: 0,
    injectedCount: 0,
    sortOrder: 2,
  },
  {
    id: 'pkg_250',
    code: 'PKG-250',
    price: 250,
    dataLabel: '1 جيجا',
    hoursLabel: '30 ساعة',
    validityLabel: '15 يوماً',
    colorTheme: 'orange',
    availableCount: 0,
    soldCount: 0,
    uploadedCount: 0,
    injectedCount: 0,
    sortOrder: 3,
  },
  {
    id: 'pkg_500',
    code: 'PKG-500',
    price: 500,
    dataLabel: '2 جيجا',
    hoursLabel: '60 ساعة',
    validityLabel: '20 يوماً',
    colorTheme: 'purple',
    availableCount: 0,
    soldCount: 0,
    uploadedCount: 0,
    injectedCount: 0,
    sortOrder: 4,
  },
  {
    id: 'pkg_1000',
    code: 'PKG-1000',
    price: 1000,
    dataLabel: '4.5 جيجا',
    hoursLabel: '200 ساعة',
    validityLabel: '30 يوماً',
    colorTheme: 'emerald',
    availableCount: 0,
    soldCount: 0,
    uploadedCount: 0,
    injectedCount: 0,
    sortOrder: 5,
  },
  {
    id: 'pkg_2000',
    code: 'PKG-2000',
    price: 2000,
    dataLabel: '9 جيجا',
    hoursLabel: 'مفتوح',
    validityLabel: '30 يوماً',
    colorTheme: 'olive',
    availableCount: 0,
    soldCount: 0,
    uploadedCount: 0,
    injectedCount: 0,
    sortOrder: 6,
  },
  {
    id: 'pkg_2500',
    code: 'PKG-2500',
    price: 2500,
    dataLabel: '14 جيجا',
    hoursLabel: 'مفتوح',
    validityLabel: '30 يوماً',
    colorTheme: 'teal',
    availableCount: 0,
    soldCount: 0,
    uploadedCount: 0,
    injectedCount: 0,
    sortOrder: 7,
  },
  {
    id: 'pkg_3000',
    code: 'PKG-3000',
    price: 3000,
    dataLabel: '16 جيجا',
    hoursLabel: 'مفتوح',
    validityLabel: '30 يوماً',
    colorTheme: 'gold',
    availableCount: 0,
    soldCount: 0,
    uploadedCount: 0,
    injectedCount: 0,
    sortOrder: 8,
  },
];

export interface PackageThemeStyle {
  border: string;
  cardBg: string;
  headerBg: string;
  capsuleBg: string;
  giftColor: string;
  badgeBg: string;
  textAccent: string;
  btnBg: string;
}

export function getPackageThemeStyle(price: number): PackageThemeStyle {
  switch (price) {
    case 100: // أخضر زمردي
      return {
        border: 'border-emerald-500 dark:border-emerald-500',
        cardBg: 'bg-emerald-50/75 dark:bg-emerald-950/30',
        headerBg: 'from-emerald-600 to-green-800',
        capsuleBg: 'bg-gradient-to-b from-emerald-500 to-emerald-800 shadow-emerald-600/35',
        giftColor: 'text-emerald-600 dark:text-emerald-400',
        badgeBg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
        textAccent: 'text-emerald-700 dark:text-emerald-400',
        btnBg: 'bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white',
      };
    case 200: // أزرق ملكي
      return {
        border: 'border-blue-500 dark:border-blue-500',
        cardBg: 'bg-blue-50/75 dark:bg-blue-950/30',
        headerBg: 'from-blue-500 to-blue-800',
        capsuleBg: 'bg-gradient-to-b from-blue-500 to-blue-800 shadow-blue-600/35',
        giftColor: 'text-blue-600 dark:text-blue-400',
        badgeBg: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
        textAccent: 'text-blue-700 dark:text-blue-400',
        btnBg: 'bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white',
      };
    case 250: // برتقالي ذهبي
      return {
        border: 'border-amber-500 dark:border-amber-500',
        cardBg: 'bg-amber-50/80 dark:bg-amber-950/25',
        headerBg: 'from-orange-500 to-amber-700',
        capsuleBg: 'bg-gradient-to-b from-orange-500 to-orange-700 shadow-orange-600/35',
        giftColor: 'text-orange-500 dark:text-orange-400',
        badgeBg: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
        textAccent: 'text-orange-700 dark:text-orange-400',
        btnBg: 'bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white',
      };
    case 500: // بنفسجي
      return {
        border: 'border-purple-500 dark:border-purple-500',
        cardBg: 'bg-purple-50/75 dark:bg-purple-950/30',
        headerBg: 'from-purple-600 to-purple-900',
        capsuleBg: 'bg-gradient-to-b from-purple-500 to-purple-800 shadow-purple-600/35',
        giftColor: 'text-purple-600 dark:text-purple-400',
        badgeBg: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300',
        textAccent: 'text-purple-700 dark:text-purple-400',
        btnBg: 'bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white',
      };
    case 1000: // أخضر بترولي غامق
      return {
        border: 'border-teal-600 dark:border-teal-500',
        cardBg: 'bg-teal-50/75 dark:bg-teal-950/30',
        headerBg: 'from-teal-700 to-emerald-950',
        capsuleBg: 'bg-gradient-to-b from-teal-600 to-teal-900 shadow-teal-700/35',
        giftColor: 'text-teal-600 dark:text-teal-400',
        badgeBg: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300',
        textAccent: 'text-teal-700 dark:text-teal-400',
        btnBg: 'bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white',
      };
    case 2000: // أخضر زيتوني
      return {
        border: 'border-lime-700 dark:border-lime-600',
        cardBg: 'bg-lime-50/80 dark:bg-lime-950/30',
        headerBg: 'from-[#4D7C0F] to-[#365314]',
        capsuleBg: 'bg-gradient-to-b from-[#4D7C0F] to-[#2F4F14] shadow-lime-800/35',
        giftColor: 'text-[#4D7C0F] dark:text-lime-400',
        badgeBg: 'bg-lime-100 text-lime-900 dark:bg-lime-900/50 dark:text-lime-300',
        textAccent: 'text-lime-800 dark:text-lime-400',
        btnBg: 'bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white',
      };
    case 2500: // وردي / عنابي
      return {
        border: 'border-rose-600 dark:border-rose-500',
        cardBg: 'bg-rose-50/80 dark:bg-rose-950/30',
        headerBg: 'from-rose-600 to-[#881337]',
        capsuleBg: 'bg-gradient-to-b from-rose-500 to-[#881337] shadow-rose-700/35',
        giftColor: 'text-rose-600 dark:text-rose-400',
        badgeBg: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
        textAccent: 'text-rose-700 dark:text-rose-400',
        btnBg: 'bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white',
      };
    default: // 3000 كحلي بإطار ذهبي
      return {
        border: 'border-[#D4AF37] dark:border-[#D4AF37]',
        cardBg: 'bg-slate-100/90 dark:bg-[#0F172A]/85',
        headerBg: 'from-[#1A365D] via-[#0F172A] to-[#1E3A8A]',
        capsuleBg: 'bg-gradient-to-b from-[#1A365D] to-[#0F172A] border border-[#D4AF37] shadow-[#1A365D]/40',
        giftColor: 'text-[#D4AF37]',
        badgeBg: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-300',
        textAccent: 'text-[#1A365D] dark:text-[#FDE68A]',
        btnBg: 'bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white',
      };
  }
}

export function getRoleArabicLabel(role: UserRole): string {
  switch (role) {
    case 'super_admin':
      return 'المدير العام';
    case 'agent':
      return 'وكيل معتمد';
    case 'client':
      return 'عميل / نقطة بيع';
  }
}

export function formatYER(value: number, hideNumbers = false): string {
  if (hideNumbers) return '•••••';
  return `${new Intl.NumberFormat('ar-YE').format(Math.round(value))} ر.ي`;
}

export function formatCount(value: number, hideNumbers = false): string {
  if (hideNumbers) return '••';
  return new Intl.NumberFormat('ar-YE').format(value);
}

function resolveDateObject(ts?: Timestamp | Date | number): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts;
  if (typeof ts === 'number') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts.toDate === 'function') {
    const d = ts.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatDateDDMMYYYY(ts?: Timestamp | Date | number): string {
  const date = resolveDateObject(ts) ?? new Date();
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatDateTimeAr(ts?: Timestamp | Date | number): string {
  const date = resolveDateObject(ts);
  if (!date) return 'الآن';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hours24 = date.getHours();
  const period = hours24 >= 12 ? 'م' : 'ص';
  const hours12 = String(hours24 % 12 || 12).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} - ${hours12}:${minutes} ${period}`;
}
