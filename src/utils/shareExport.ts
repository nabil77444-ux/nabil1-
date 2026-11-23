import {
  DEFAULT_APP_SETTINGS,
  formatDateTimeAr,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type AppSettingsDoc,
} from '../types/taibah';
import { normalizeDigits } from '../lib/firebase';

export interface PrintableDocumentPayload {
  title: string;
  subtitle?: string;
  metaRows: Array<{ label: string; value: string }>;
  tableHeaders: string[];
  tableRows: string[][];
  summaryRows?: Array<{ label: string; value: string; highlight?: boolean }>;
  extraSectionTitle?: string;
  extraLines?: string[];
  fileName: string;
  sharePhone?: string;
  shareText?: string;
  pdfHeaderTitle?: string;
  pdfHeaderSubtitle?: string;
  pdfFooterText?: string;
}

export interface ExportShareResult {
  fileName: string;
  mimeType: string;
  blobUrl: string;
  sharedNatively: boolean;
  sharePhone?: string;
  shareText?: string;
}

interface ShareBrandTemplates {
  pdfHeaderTitle: string;
  pdfHeaderSubtitle: string;
  pdfFooterText: string;
  smsMessageTemplate: string;
  whatsappMessageTemplate: string;
  directSaleMessageTemplate: string;
}

let activeBrandTemplates: ShareBrandTemplates = {
  pdfHeaderTitle: DEFAULT_APP_SETTINGS.pdfHeaderTitle || 'كروت طيبة نت – TAIBAH NET',
  pdfHeaderSubtitle:
    DEFAULT_APP_SETTINGS.pdfHeaderSubtitle ||
    'شبكة طيبة نت اللاسلكية — الإدارة المالية ونظام الكروت المعتمد',
  pdfFooterText:
    DEFAULT_APP_SETTINGS.pdfFooterText ||
    `وثيقة معتمدة صادرة من منظومة كروت طيبة نت — ${SUPER_ADMIN_CONFIG.developerCredit}`,
  smsMessageTemplate:
    DEFAULT_APP_SETTINGS.smsMessageTemplate || DEFAULT_APP_SETTINGS.directSaleMessageTemplate,
  whatsappMessageTemplate:
    DEFAULT_APP_SETTINGS.whatsappMessageTemplate || DEFAULT_APP_SETTINGS.directSaleMessageTemplate,
  directSaleMessageTemplate: DEFAULT_APP_SETTINGS.directSaleMessageTemplate,
};

export function setGlobalShareTemplates(settings: Partial<AppSettingsDoc>): void {
  activeBrandTemplates = {
    pdfHeaderTitle:
      settings.pdfHeaderTitle?.trim() ||
      DEFAULT_APP_SETTINGS.pdfHeaderTitle ||
      'كروت طيبة نت – TAIBAH NET',
    pdfHeaderSubtitle:
      settings.pdfHeaderSubtitle?.trim() ||
      DEFAULT_APP_SETTINGS.pdfHeaderSubtitle ||
      'شبكة طيبة نت اللاسلكية — الإدارة المالية ونظام الكروت المعتمد',
    pdfFooterText:
      settings.pdfFooterText?.trim() ||
      DEFAULT_APP_SETTINGS.pdfFooterText ||
      `وثيقة معتمدة صادرة من منظومة كروت طيبة نت — ${SUPER_ADMIN_CONFIG.developerCredit}`,
    smsMessageTemplate:
      settings.smsMessageTemplate?.trim() ||
      settings.directSaleMessageTemplate?.trim() ||
      DEFAULT_APP_SETTINGS.smsMessageTemplate ||
      DEFAULT_APP_SETTINGS.directSaleMessageTemplate,
    whatsappMessageTemplate:
      settings.whatsappMessageTemplate?.trim() ||
      settings.directSaleMessageTemplate?.trim() ||
      DEFAULT_APP_SETTINGS.whatsappMessageTemplate ||
      DEFAULT_APP_SETTINGS.directSaleMessageTemplate,
    directSaleMessageTemplate:
      settings.directSaleMessageTemplate?.trim() || DEFAULT_APP_SETTINGS.directSaleMessageTemplate,
  };
}

export function getGlobalShareTemplates(): ShareBrandTemplates {
  return activeBrandTemplates;
}

export function applyMessageTemplate(
  template: string,
  vars: Record<string, string | number | undefined>
): string {
  let out = template || '';
  for (const [key, val] of Object.entries(vars)) {
    const replacement = val !== undefined && val !== null ? String(val) : '';
    out = out.split(`{${key}}`).join(replacement);
  }
  return out;
}

interface CapacitorWindow extends Window {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      Filesystem?: {
        writeFile: (opts: { path: string; data: string; directory: string }) => Promise<{ uri: string }>;
      };
      Share?: {
        share: (opts: { title?: string; text?: string; url?: string; files?: string[]; dialogTitle?: string }) => Promise<void>;
      };
    };
  };
}

let cachedLogoDataUrl: string | null = null;

/**
 * Load the official Taibah Net logo once as a Base64 Data URL so html2canvas & jsPDF
 * NEVER suffer from CORS tainting or missing logo images in exports.
 */
async function getOfficialLogoDataUrl(): Promise<string> {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  const src = `${window.location.origin}${TAIBAH_ASSETS.logo}`;
  try {
    const res = await fetch(src, { mode: 'cors' });
    if (!res.ok) return src;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : src);
      reader.onerror = () => resolve(src);
      reader.readAsDataURL(blob);
    });
    cachedLogoDataUrl = dataUrl;
    return dataUrl;
  } catch {
    return src;
  }
}

export function cleanYemeniPhone(raw: string): string {
  return normalizeDigits(raw || '')
    .replace(/[^\d]/g, '')
    .replace(/^00967|^967/, '');
}

/**
 * Open WhatsApp with prefilled Arabic message (safe anchor click — avoids window.open).
 */
export function openWhatsAppShare(phone: string | undefined, message: string): void {
  const digits = cleanYemeniPhone(phone || '');
  const encoded = encodeURIComponent(message);
  const url =
    digits.length >= 7
      ? `https://wa.me/967${digits}?text=${encoded}`
      : `https://api.whatsapp.com/send?text=${encoded}`;

  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Open native SMS composer with prefilled message (works 100% offline).
 */
export function openSmsShare(phone: string | undefined, message: string): void {
  const digits = cleanYemeniPhone(phone || '');
  const encoded = encodeURIComponent(message);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const separator = isIOS ? '&' : '?';
  const href = digits ? `sms:${digits}${separator}body=${encoded}` : `sms:${separator}body=${encoded}`;

  const a = document.createElement('a');
  a.href = href;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRoyalDocumentHTML(payload: PrintableDocumentPayload, logoSrc: string): string {
  const nowStr = formatDateTimeAr(new Date());
  const headerTitle = payload.pdfHeaderTitle?.trim() || activeBrandTemplates.pdfHeaderTitle;
  const headerSubtitle = payload.pdfHeaderSubtitle?.trim() || activeBrandTemplates.pdfHeaderSubtitle;
  const footerText = payload.pdfFooterText?.trim() || activeBrandTemplates.pdfFooterText;

  const metaHtml = payload.metaRows
    .map(
      (m) => `
      <div style="background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);border:1.5px solid #cbd5e1;border-right:4px solid #D4AF37;border-radius:10px;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span style="color:#475569;font-size:11.5px;font-weight:700;">${escapeHtml(m.label)}</span>
        <span style="color:#0f172a;font-size:13px;font-weight:800;">${escapeHtml(m.value)}</span>
      </div>`
    )
    .join('');

  const theadHtml = payload.tableHeaders
    .map(
      (h) =>
        `<th style="padding:10px 9px;background:linear-gradient(180deg,#1A365D 0%,#0F172A 100%);color:#FDE68A;font-size:12px;font-weight:800;text-align:right;border:1px solid #D4AF37;">${escapeHtml(h)}</th>`
    )
    .join('');

  const tbodyHtml =
    payload.tableRows.length === 0
      ? `<tr><td colspan="${payload.tableHeaders.length}" style="padding:20px;text-align:center;color:#64748b;font-weight:700;">لا توجد سجلات</td></tr>`
      : payload.tableRows
          .map(
            (row, idx) => `
        <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f1f5f9'};">
          ${row
            .map(
              (cell) =>
                `<td style="padding:8px 9px;font-size:12px;font-weight:700;color:#0f172a;border:1px solid #cbd5e1;text-align:right;line-height:1.45;">${escapeHtml(cell)}</td>`
            )
            .join('')}
        </tr>`
          )
          .join('');

  const summaryHtml = (payload.summaryRows || [])
    .map(
      (s) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:12px;background:${
        s.highlight
          ? 'linear-gradient(135deg,#0F172A 0%,#1A365D 100%)'
          : 'linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)'
      };border:${s.highlight ? '2px solid #D4AF37' : '1.5px solid #cbd5e1'};color:${
        s.highlight ? '#FDE68A' : '#0f172a'
      };box-shadow:${s.highlight ? '0 4px 10px rgba(15,23,42,0.18)' : 'none'};">
        <span style="font-size:12.5px;font-weight:800;">${escapeHtml(s.label)}</span>
        <span style="font-size:15px;font-weight:900;">${escapeHtml(s.value)}</span>
      </div>`
    )
    .join('');

  const extraHtml =
    payload.extraLines && payload.extraLines.length > 0
      ? `
      <div style="margin-top:16px;background:#fffbeb;border:2px solid #D4AF37;border-radius:14px;padding:12px 14px;">
        <div style="font-size:13px;font-weight:800;color:#1A365D;margin-bottom:9px;display:flex;justify-content:space-between;align-items:center;">
          <span>${escapeHtml(payload.extraSectionTitle || 'أرقام الكروت')}</span>
          <span style="font-size:11px;background:#1A365D;color:#FDE68A;padding:2px 10px;border-radius:999px;">العدد: ${payload.extraLines.length}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;">
          ${payload.extraLines
            .map(
              (line) =>
                `<div style="background:#ffffff;border:1.5px solid #cbd5e1;border-radius:9px;padding:7px 8px;text-align:center;font-family:monospace;font-size:13.5px;font-weight:800;color:#0f172a;direction:ltr;letter-spacing:0.6px;">${escapeHtml(
                  line
                )}</div>`
            )
            .join('')}
        </div>
      </div>`
      : '';

  return `
    <div dir="rtl" style="width:794px;background:#ffffff;font-family:'Cairo',system-ui,sans-serif;color:#0f172a;border:3px solid #D4AF37;border-radius:18px;overflow:hidden;box-sizing:border-box;">
      <div style="background:linear-gradient(135deg,#0F172A 0%,#1A365D 55%,#1E3A8A 100%);padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:4px solid #D4AF37;">
        <div style="display:flex;align-items:center;gap:14px;min-width:0;">
          <div style="width:68px;height:68px;border-radius:50%;background:#ffffff;border:3px solid #D4AF37;padding:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 12px rgba(0,0,0,0.28);">
            <img src="${logoSrc}" crossorigin="anonymous" style="width:100%;height:100%;object-fit:contain;border-radius:50%;" />
          </div>
          <div>
            <div style="font-size:21px;font-weight:900;color:#ffffff;line-height:1.2;">${escapeHtml(headerTitle)}</div>
            <div style="font-size:12px;font-weight:700;color:#FDE68A;margin-top:3px;">${escapeHtml(headerSubtitle)}</div>
            <div style="font-size:11px;font-weight:700;color:#cbd5e1;margin-top:2px;">الإدارة: ${SUPER_ADMIN_CONFIG.name} • هاتف: ${SUPER_ADMIN_CONFIG.phone}</div>
          </div>
        </div>
        <div style="text-align:left;background:rgba(255,255,255,0.08);border:1.5px solid rgba(212,175,55,0.65);border-radius:12px;padding:9px 14px;flex-shrink:0;">
          <div style="font-size:15px;font-weight:900;color:#FDE68A;">${escapeHtml(payload.title)}</div>
          ${
            payload.subtitle
              ? `<div style="font-size:11px;font-weight:700;color:#e2e8f0;margin-top:2px;">${escapeHtml(payload.subtitle)}</div>`
              : ''
          }
          <div style="font-size:11px;font-weight:700;color:#ffffff;margin-top:4px;direction:ltr;">${escapeHtml(nowStr)}</div>
        </div>
      </div>

      <div style="padding:20px 24px;background:#ffffff;">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-bottom:16px;">
          ${metaHtml}
        </div>

        <div style="border-radius:12px;overflow:hidden;border:1.5px solid #1A365D;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr>${theadHtml}</tr></thead>
            <tbody>${tbodyHtml}</tbody>
          </table>
        </div>

        ${extraHtml}

        ${
          summaryHtml
            ? `<div style="margin-top:16px;display:grid;grid-template-columns:repeat(2,1fr);gap:9px;">${summaryHtml}</div>`
            : ''
        }
      </div>

      <div style="background:linear-gradient(90deg,#0F172A 0%,#1A365D 100%);color:#FDE68A;padding:11px 24px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;font-weight:800;border-top:3px solid #D4AF37;">
        <span>${escapeHtml(footerText)}</span>
        <span style="color:#e2e8f0;">${SUPER_ADMIN_CONFIG.developerCredit}</span>
      </div>
    </div>
  `;
}

async function renderRoyalCanvas(payload: PrintableDocumentPayload): Promise<HTMLCanvasElement> {
  const [{ default: html2canvas }, logoSrc] = await Promise.all([
    import('html2canvas'),
    getOfficialLogoDataUrl(),
  ]);

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.zIndex = '-1';
  container.innerHTML = buildRoyalDocumentHTML(payload, logoSrc);
  document.body.appendChild(container);

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  } catch {
    // ignore
  }

  const imgs = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );

  try {
    const target = container.firstElementChild as HTMLElement;
    const canvas = await html2canvas(target, {
      scale: 2.5,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
    });
    return canvas;
  } finally {
    container.remove();
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const commaIdx = reader.result.indexOf(',');
        resolve(commaIdx >= 0 ? reader.result.slice(commaIdx + 1) : reader.result);
      } else {
        reject(new Error('Base64 conversion failed'));
      }
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

function triggerDirectDownload(blobUrl: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Share a real File/Blob using Capacitor Native Share (APK) -> Web Share API -> Direct Download fallback.
 */
async function shareOrDownloadFile(
  blob: Blob,
  fileName: string,
  title: string,
  shareText?: string,
  sharePhone?: string
): Promise<ExportShareResult> {
  const blobUrl = URL.createObjectURL(blob);
  const capWin = window as CapacitorWindow;

  // 1. Native Android APK via Capacitor Filesystem + Share plugins
  if (capWin.Capacitor?.isNativePlatform?.() && capWin.Capacitor.Plugins?.Filesystem && capWin.Capacitor.Plugins?.Share) {
    try {
      const base64Data = await blobToBase64(blob);
      const saved = await capWin.Capacitor.Plugins.Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: 'CACHE',
      });
      await capWin.Capacitor.Plugins.Share.share({
        title,
        text: shareText || title,
        url: saved.uri,
        files: [saved.uri],
        dialogTitle: 'مشاركة عبر واتساب أو التطبيقات',
      });
      return { fileName, mimeType: blob.type, blobUrl, sharedNatively: true, sharePhone, shareText };
    } catch {
      // Fall through to Web Share / download
    }
  }

  // 2. Web Share API Level 2 (Android Chrome / PWA / Safari)
  try {
    const file = new File([blob], fileName, { type: blob.type });
    if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title,
        text: shareText || title,
      });
      return { fileName, mimeType: blob.type, blobUrl, sharedNatively: true, sharePhone, shareText };
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { fileName, mimeType: blob.type, blobUrl, sharedNatively: true, sharePhone, shareText };
    }
  }

  // 3. Fallback: Automatic direct file download (works in Desktop & iframe preview)
  triggerDirectDownload(blobUrl, fileName);
  return { fileName, mimeType: blob.type, blobUrl, sharedNatively: false, sharePhone, shareText };
}

/**
 * Generate and share/download a crisp HD PNG image with official uncropped logo & RTL Arabic.
 */
export async function exportAsHDImage(payload: PrintableDocumentPayload): Promise<ExportShareResult> {
  const canvas = await renderRoyalCanvas(payload);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 1.0));
  if (!blob) throw new Error('Image generation failed');

  const safeName = `${payload.fileName.replace(/[^\w\u0600-\u06FF-]+/g, '_')}_HD.png`;
  return shareOrDownloadFile(blob, safeName, payload.title, payload.shareText, payload.sharePhone);
}

/**
 * Generate and share/download a crisp Arabic RTL multi-page A4 PDF with official uncropped logo.
 */
export async function exportAsArabicPDF(payload: PrintableDocumentPayload): Promise<ExportShareResult> {
  const [canvas, { jsPDF }] = await Promise.all([renderRoyalCanvas(payload), import('jspdf')]);
  const imgData = canvas.toDataURL('image/png', 1.0);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const usableWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * usableWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  pdf.addImage(imgData, 'PNG', margin, position, usableWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + margin;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
  }

  const safeName = `${payload.fileName.replace(/[^\w\u0600-\u06FF-]+/g, '_')}.pdf`;
  const pdfBlob = pdf.output('blob');
  return shareOrDownloadFile(pdfBlob, safeName, payload.title, payload.shareText, payload.sharePhone);
}

/**
 * Print cleanly via hidden iframe (avoids popup blockers & window.open).
 */
export async function printRoyalDocument(payload: PrintableDocumentPayload): Promise<void> {
  const logoSrc = await getOfficialLogoDataUrl();
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>${escapeHtml(
      payload.title
    )}</title><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800;900&display=swap" rel="stylesheet" /><style>body{margin:0;padding:12px;display:flex;justify-content:center;font-family:'Cairo',sans-serif;}@media print{body{padding:0;}}</style></head><body>${buildRoyalDocumentHTML(
      payload,
      logoSrc
    )}</body></html>`
  );
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1200);
  }, 450);
}

/**
 * Export structured data to Excel (.xlsx) with RTL sheet direction via dynamic import.
 */
export async function exportAsExcel(
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
  fileName: string
): Promise<void> {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet['!views'] = [{ rightToLeft: true }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 30));
  const safeName = `${fileName.replace(/[^\w\u0600-\u06FF-]+/g, '_')}.xlsx`;
  XLSX.writeFile(workbook, safeName);
}

/**
 * Build shareable application text (clean, official).
 */
export function buildAppShareText(description?: string): string {
  const lines = [
    '📶 تطبيق كروت طيبة نت — شبكة طيبة نت اللاسلكية (TAIBAH NET)',
    description?.trim() ||
      'النظام المتكامل لإدارة وبيع كروت الإنترنت اللاسلكي للوكلاء ونقاط البيع والمستهلكين.',
    `🌐 رابط التطبيق: ${window.location.origin}`,
    `📞 ${SUPER_ADMIN_CONFIG.developerCredit}`,
  ];
  return lines.join('\n');
}
