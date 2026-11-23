import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
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
  breakdownTitle?: string;
  breakdownItems?: Array<{ label: string; formula: string }>;
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

let cachedLogoDataUrl: string | null = null;

/**
 * Load the official Taibah Net logo once as a same-origin Base64 Data URL so html2canvas & jsPDF
 * NEVER suffer from CORS tainting or missing logo images in exports (Web & Android WebView).
 */
async function getOfficialLogoDataUrl(): Promise<string> {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  const candidates = [
    TAIBAH_ASSETS.logo,
    `${window.location.origin}${TAIBAH_ASSETS.logo}`,
    '/pwa-192x192.png',
  ];
  for (const src of candidates) {
    try {
      const res = await fetch(src);
      if (!res.ok) continue;
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
      if (dataUrl.startsWith('data:image/')) {
        cachedLogoDataUrl = dataUrl;
        return dataUrl;
      }
    } catch {
      // Try next candidate
    }
  }
  return '';
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
      <div style="background:#f8fafc;border:1.5px solid #cbd5e1;border-right:4px solid #D4AF37;border-radius:10px;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;box-sizing:border-box;">
        <span style="color:#475569;font-size:11.5px;font-weight:700;">${escapeHtml(m.label)}</span>
        <span style="color:#0f172a;font-size:13px;font-weight:800;">${escapeHtml(m.value)}</span>
      </div>`
    )
    .join('');

  const theadHtml = payload.tableHeaders
    .map(
      (h) =>
        `<th style="padding:10px 9px;background:#1A365D;color:#FDE68A;font-size:12px;font-weight:800;text-align:right;border:1px solid #D4AF37;">${escapeHtml(h)}</th>`
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
        s.highlight ? '#1A365D' : '#f8fafc'
      };border:${s.highlight ? '2px solid #D4AF37' : '1.5px solid #cbd5e1'};color:${
        s.highlight ? '#FDE68A' : '#0f172a'
      };box-sizing:border-box;">
        <span style="font-size:12.5px;font-weight:800;">${escapeHtml(s.label)}</span>
        <span style="font-size:15px;font-weight:900;">${escapeHtml(s.value)}</span>
      </div>`
    )
    .join('');

  const breakdownHtml =
    payload.breakdownItems && payload.breakdownItems.length > 0
      ? `
      <div style="margin-top:14px;background:#f8fafc;border:2px solid #1A365D;border-radius:14px;overflow:hidden;box-sizing:border-box;">
        <div style="background:#1A365D;color:#FDE68A;padding:8px 14px;font-size:12.5px;font-weight:800;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #D4AF37;">
          <span>${escapeHtml(payload.breakdownTitle || 'تفصيل الفئات المباعة (العدد × سعر الفئة = الإجمالي)')}</span>
          <span style="font-size:11px;color:#ffffff;">${payload.breakdownItems.length} فئة</span>
        </div>
        <div style="padding:10px 12px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
          ${payload.breakdownItems
            .map(
              (item) => `
            <div style="background:#ffffff;border:1.5px solid #cbd5e1;border-right:4px solid #D4AF37;border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:3px;box-sizing:border-box;">
              <span style="font-size:11.5px;font-weight:800;color:#1A365D;">${escapeHtml(item.label)}</span>
              <span style="font-size:13px;font-weight:900;color:#0f172a;direction:rtl;">${escapeHtml(item.formula)}</span>
            </div>`
            )
            .join('')}
        </div>
      </div>`
      : '';

  const extraHtml =
    payload.extraLines && payload.extraLines.length > 0
      ? `
      <div style="margin-top:16px;background:#fffbeb;border:2px solid #D4AF37;border-radius:14px;padding:12px 14px;box-sizing:border-box;">
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

  const logoElement = logoSrc
    ? `<div style="width:70px;height:70px;border-radius:50%;background:#061124;border:3px solid #D4AF37;padding:5px;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;box-sizing:border-box;">
         <img src="${logoSrc}" style="width:100%;height:100%;object-fit:contain;border-radius:50%;display:block;" />
       </div>`
    : `<div style="width:70px;height:70px;border-radius:50%;background:#061124;border:3px solid #D4AF37;color:#FDE68A;font-size:24px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0;">T</div>`;

  return `
    <div id="taibah-export-root" dir="rtl" style="width:794px;background:#ffffff;font-family:'Cairo',system-ui,sans-serif;color:#0f172a;border:3px solid #D4AF37;border-radius:18px;overflow:hidden;box-sizing:border-box;">
      <div style="background:#1A365D;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:4px solid #D4AF37;box-sizing:border-box;">
        <div style="display:flex;align-items:center;gap:14px;min-width:0;">
          ${logoElement}
          <div>
            <div style="font-size:21px;font-weight:900;color:#ffffff;line-height:1.25;">${escapeHtml(headerTitle)}</div>
            <div style="font-size:12px;font-weight:700;color:#FDE68A;margin-top:3px;">${escapeHtml(headerSubtitle)}</div>
            <div style="font-size:11px;font-weight:700;color:#cbd5e1;margin-top:2px;">الإدارة: ${SUPER_ADMIN_CONFIG.name} • هاتف: ${SUPER_ADMIN_CONFIG.phone}</div>
          </div>
        </div>
        <div style="text-align:left;background:#0F172A;border:1.5px solid #D4AF37;border-radius:12px;padding:9px 14px;flex-shrink:0;">
          <div style="font-size:15px;font-weight:900;color:#FDE68A;">${escapeHtml(payload.title)}</div>
          ${
            payload.subtitle
              ? `<div style="font-size:11px;font-weight:700;color:#e2e8f0;margin-top:2px;">${escapeHtml(payload.subtitle)}</div>`
              : ''
          }
          <div style="font-size:11px;font-weight:700;color:#ffffff;margin-top:4px;direction:ltr;">${escapeHtml(nowStr)}</div>
        </div>
      </div>

      <div style="padding:20px 24px;background:#ffffff;box-sizing:border-box;">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-bottom:16px;">
          ${metaHtml}
        </div>

        <div style="border-radius:12px;overflow:hidden;border:1.5px solid #1A365D;">
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr>${theadHtml}</tr></thead>
            <tbody>${tbodyHtml}</tbody>
          </table>
        </div>

        ${breakdownHtml}

        ${extraHtml}

        ${
          summaryHtml
            ? `<div style="margin-top:16px;display:grid;grid-template-columns:repeat(2,1fr);gap:9px;">${summaryHtml}</div>`
            : ''
        }
      </div>

      <div style="background:#0F172A;color:#FDE68A;padding:11px 24px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;font-weight:800;border-top:3px solid #D4AF37;box-sizing:border-box;">
        <span>${escapeHtml(footerText)}</span>
        <span style="color:#e2e8f0;">${SUPER_ADMIN_CONFIG.developerCredit}</span>
      </div>
    </div>
  `;
}

/**
 * Pure HTML5 Canvas 2D RTL Fallback Renderer — guarantees PDF & HD Image export NEVER fails
 * even on older Android 5.1 WebViews or restricted CSS engines.
 */
async function renderRoyalCanvasFallback2D(
  payload: PrintableDocumentPayload,
  logoSrc: string
): Promise<HTMLCanvasElement> {
  const width = 1200;
  const pad = 42;
  const headerH = 165;
  const metaRowsCount = Math.ceil(payload.metaRows.length / 2);
  const metaH = metaRowsCount * 58 + 20;
  const tableRowsCount = Math.max(1, payload.tableRows.length);
  const tableH = 54 + tableRowsCount * 46 + 24;
  const breakdownRowsCount = payload.breakdownItems?.length ? Math.ceil(payload.breakdownItems.length / 2) : 0;
  const breakdownH = breakdownRowsCount > 0 ? 54 + breakdownRowsCount * 62 + 20 : 0;
  const extraRowsCount = payload.extraLines?.length ? Math.ceil(payload.extraLines.length / 3) : 0;
  const extraH = extraRowsCount > 0 ? 58 + extraRowsCount * 46 + 24 : 0;
  const summaryRowsCount = payload.summaryRows?.length ? Math.ceil(payload.summaryRows.length / 2) : 0;
  const summaryH = summaryRowsCount > 0 ? summaryRowsCount * 62 + 20 : 0;
  const footerH = 64;

  const height = Math.min(7200, headerH + metaH + tableH + breakdownH + extraH + summaryH + footerH + 70);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  ctx.direction = 'rtl';

  // White card with gold frame
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, width - 6, height - 6);

  // Royal Navy Header
  ctx.fillStyle = '#1A365D';
  ctx.fillRect(6, 6, width - 12, headerH);
  ctx.fillStyle = '#D4AF37';
  ctx.fillRect(6, headerH, width - 12, 6);

  // Circular Logo Medallion on right
  const logoCx = width - pad - 54;
  const logoCy = 6 + headerH / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(logoCx, logoCy, 52, 0, Math.PI * 2);
  ctx.fillStyle = '#061124';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#D4AF37';
  ctx.stroke();
  ctx.clip();
  if (logoSrc) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = logoSrc;
      });
      ctx.drawImage(img, logoCx - 44, logoCy - 44, 88, 88);
    } catch {
      // keep clean circle
    }
  }
  ctx.restore();

  const headerTitle = payload.pdfHeaderTitle?.trim() || activeBrandTemplates.pdfHeaderTitle;
  const headerSubtitle = payload.pdfHeaderSubtitle?.trim() || activeBrandTemplates.pdfHeaderSubtitle;
  const footerText = payload.pdfFooterText?.trim() || activeBrandTemplates.pdfFooterText;

  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 30px Cairo, sans-serif';
  ctx.fillText(headerTitle, width - pad - 125, 68);
  ctx.fillStyle = '#FDE68A';
  ctx.font = '700 18px Cairo, sans-serif';
  ctx.fillText(headerSubtitle, width - pad - 125, 102);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '700 15px Cairo, sans-serif';
  ctx.fillText(`الإدارة: ${SUPER_ADMIN_CONFIG.name} • ${SUPER_ADMIN_CONFIG.phone}`, width - pad - 125, 134);

  // Document Title Badge on left
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(pad, 36, 330, 104);
  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 2;
  ctx.strokeRect(pad, 36, 330, 104);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FDE68A';
  ctx.font = '800 21px Cairo, sans-serif';
  ctx.fillText(payload.title.slice(0, 32), pad + 165, 74);
  if (payload.subtitle) {
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 15px Cairo, sans-serif';
    ctx.fillText(payload.subtitle.slice(0, 36), pad + 165, 102);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 14px Cairo, sans-serif';
  ctx.fillText(formatDateTimeAr(new Date()), pad + 165, 128);

  let y = headerH + 28;

  // Meta rows (2 cols)
  const colW = (width - pad * 2 - 18) / 2;
  payload.metaRows.forEach((m, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const rx = col === 0 ? width - pad - colW : pad;
    const ry = y + row * 58;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(rx, ry, colW, 46);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx, ry, colW, 46);
    ctx.fillStyle = '#D4AF37';
    ctx.fillRect(rx + colW - 5, ry, 5, 46);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#475569';
    ctx.font = '700 16px Cairo, sans-serif';
    ctx.fillText(m.label, rx + colW - 18, ry + 29);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 17px Cairo, sans-serif';
    ctx.fillText(m.value, rx + 14, ry + 29);
  });
  y += metaH;

  // Table
  const tableW = width - pad * 2;
  const cols = Math.max(1, payload.tableHeaders.length);
  const cellW = tableW / cols;

  ctx.fillStyle = '#1A365D';
  ctx.fillRect(pad, y, tableW, 48);
  ctx.font = '800 17px Cairo, sans-serif';
  ctx.fillStyle = '#FDE68A';
  payload.tableHeaders.forEach((h, i) => {
    const cx = width - pad - i * cellW - 14;
    ctx.textAlign = 'right';
    ctx.fillText(h.slice(0, 22), cx, y + 31);
  });
  y += 48;

  const rowsToDraw = payload.tableRows.length > 0 ? payload.tableRows : [['لا توجد سجلات']];
  rowsToDraw.forEach((row, rIdx) => {
    ctx.fillStyle = rIdx % 2 === 0 ? '#ffffff' : '#f1f5f9';
    ctx.fillRect(pad, y, tableW, 44);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, y, tableW, 44);
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 16px Cairo, sans-serif';
    row.forEach((cell, cIdx) => {
      const cx = width - pad - cIdx * cellW - 14;
      ctx.textAlign = 'right';
      ctx.fillText(String(cell ?? '').slice(0, 28), cx, y + 28);
    });
    y += 44;
  });
  y += 22;

  // Per-denomination breakdown box
  if (payload.breakdownItems && payload.breakdownItems.length > 0) {
    const bBoxH = 48 + breakdownRowsCount * 58 + 14;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(pad, y, tableW, bBoxH);
    ctx.strokeStyle = '#1A365D';
    ctx.lineWidth = 2;
    ctx.strokeRect(pad, y, tableW, bBoxH);
    ctx.fillStyle = '#1A365D';
    ctx.fillRect(pad, y, tableW, 42);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FDE68A';
    ctx.font = '800 17px Cairo, sans-serif';
    ctx.fillText(
      payload.breakdownTitle || 'تفصيل الفئات المباعة (العدد × سعر الفئة = الإجمالي)',
      width - pad - 16,
      y + 27
    );

    const bItemW = (tableW - 36) / 2;
    payload.breakdownItems.forEach((item, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const bx = col === 0 ? width - pad - 12 - bItemW : pad + 12;
      const by = y + 52 + row * 58;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bx, by, bItemW, 48);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, bItemW, 48);
      ctx.fillStyle = '#D4AF37';
      ctx.fillRect(bx + bItemW - 5, by, 5, 48);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#1A365D';
      ctx.font = '800 14px Cairo, sans-serif';
      ctx.fillText(item.label.slice(0, 34), bx + bItemW - 14, by + 19);
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 16px Cairo, sans-serif';
      ctx.fillText(item.formula.slice(0, 38), bx + bItemW - 14, by + 40);
    });
    y += bBoxH + 18;
  }

  // Extra lines (Voucher numbers)
  if (payload.extraLines && payload.extraLines.length > 0) {
    const boxH = 50 + extraRowsCount * 44;
    ctx.fillStyle = '#fffbeb';
    ctx.fillRect(pad, y, tableW, boxH);
    ctx.strokeStyle = '#D4AF37';
    ctx.lineWidth = 2;
    ctx.strokeRect(pad, y, tableW, boxH);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1A365D';
    ctx.font = '800 18px Cairo, sans-serif';
    ctx.fillText(
      `${payload.extraSectionTitle || 'أرقام الكروت'} (${payload.extraLines.length})`,
      width - pad - 18,
      y + 32
    );
    const chipW = (tableW - 44) / 3;
    payload.extraLines.forEach((line, idx) => {
      const c = idx % 3;
      const r = Math.floor(idx / 3);
      const cx = width - pad - 14 - (c + 1) * chipW - c * 8;
      const cy = y + 46 + r * 42;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx, cy, chipW, 34);
      ctx.strokeStyle = '#cbd5e1';
      ctx.strokeRect(cx, cy, chipW, 34);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0f172a';
      ctx.font = '800 17px monospace';
      ctx.fillText(line, cx + chipW / 2, cy + 23);
    });
    y += boxH + 20;
  }

  // Summary rows
  if (payload.summaryRows && payload.summaryRows.length > 0) {
    payload.summaryRows.forEach((s, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const rx = col === 0 ? width - pad - colW : pad;
      const ry = y + row * 60;
      ctx.fillStyle = s.highlight ? '#1A365D' : '#f8fafc';
      ctx.fillRect(rx, ry, colW, 50);
      ctx.strokeStyle = s.highlight ? '#D4AF37' : '#cbd5e1';
      ctx.lineWidth = s.highlight ? 2.5 : 1.5;
      ctx.strokeRect(rx, ry, colW, 50);
      ctx.textAlign = 'right';
      ctx.fillStyle = s.highlight ? '#FDE68A' : '#0f172a';
      ctx.font = '800 17px Cairo, sans-serif';
      ctx.fillText(s.label, rx + colW - 16, ry + 31);
      ctx.textAlign = 'left';
      ctx.font = '900 19px Cairo, sans-serif';
      ctx.fillText(s.value, rx + 16, ry + 31);
    });
  }

  // Footer
  const fy = height - footerH - 6;
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(6, fy, width - 12, footerH);
  ctx.fillStyle = '#D4AF37';
  ctx.fillRect(6, fy, width - 12, 4);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FDE68A';
  ctx.font = '800 16px Cairo, sans-serif';
  ctx.fillText(footerText, width - pad, fy + 38);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '700 15px Cairo, sans-serif';
  ctx.fillText(SUPER_ADMIN_CONFIG.developerCredit, pad, fy + 38);

  return canvas;
}

/**
 * Render Royal Document to crisp HD Canvas.
 * Strips Tailwind v4 `oklch()` / `color-mix()` stylesheets inside html2canvas `onclone`
 * so html2canvas NEVER crashes on unsupported CSS color functions, with pure Canvas 2D fallback.
 */
async function renderRoyalCanvas(payload: PrintableDocumentPayload): Promise<HTMLCanvasElement> {
  const logoSrc = await getOfficialLogoDataUrl();

  try {
    const { default: html2canvas } = await import('html2canvas');
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '0';
    container.style.zIndex = '-1';
    container.style.background = '#ffffff';
    container.innerHTML = buildRoyalDocumentHTML(payload, logoSrc);
    document.body.appendChild(container);

    try {
      if (document.fonts?.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 600)),
        ]);
      }
    } catch {
      // ignore font wait errors
    }

    const imgs = Array.from(container.querySelectorAll('img'));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            setTimeout(() => resolve(), 1500);
          })
      )
    );

    try {
      const target = container.firstElementChild as HTMLElement;
      const estimatedHeight = Math.max(target.scrollHeight || 900, 600);
      // Clamp scale so tall reports never exceed Android WebView GPU canvas texture limits
      const safeScale = Math.min(2.2, Math.max(1.25, 6400 / estimatedHeight));

      const canvas = await html2canvas(target, {
        scale: safeScale,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        onclone: (clonedDoc) => {
          // CRITICAL FIX: Remove Tailwind v4 stylesheets containing `oklch()` / `oklab()` /
          // `color-mix()` that crash html2canvas 1.4.1 color parser!
          clonedDoc.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
            const href = node.getAttribute('href') || '';
            if (href.includes('fonts.googleapis.com')) return;
            node.remove();
          });
          const resetStyle = clonedDoc.createElement('style');
          resetStyle.textContent = `
            * { box-sizing: border-box; }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
              color: #0f172a !important;
              font-family: 'Cairo', system-ui, -apple-system, sans-serif !important;
              direction: rtl !important;
            }
          `;
          clonedDoc.head.appendChild(resetStyle);
        },
      });
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        return canvas;
      }
    } finally {
      container.remove();
    }
  } catch (err) {
    console.warn('html2canvas fallback triggered:', err);
  }

  // Zero-Fail Pure Canvas 2D Fallback
  return renderRoyalCanvasFallback2D(payload, logoSrc);
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

function buildSafeAndroidCacheName(extension: 'png' | 'pdf'): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `TaibahNet_${stamp}_${rand}.${extension}`;
}

/**
 * Share or save a real File/Blob using Capacitor Filesystem + Share (Android APK)
 * -> Web Share API Level 2 -> Direct Download fallback.
 */
async function shareOrDownloadFile(
  blob: Blob,
  displayFileName: string,
  extension: 'png' | 'pdf',
  title: string,
  shareText?: string,
  sharePhone?: string
): Promise<ExportShareResult> {
  const blobUrl = URL.createObjectURL(blob);

  // 1. Native Android APK via official @capacitor/filesystem + @capacitor/share
  if (Capacitor.isNativePlatform()) {
    try {
      const base64Data = await blobToBase64(blob);
      const cacheFileName = buildSafeAndroidCacheName(extension);
      const saved = await Filesystem.writeFile({
        path: cacheFileName,
        data: base64Data,
        directory: Directory.Cache,
      });

      try {
        await Share.share({
          title,
          text: shareText || title,
          files: [saved.uri],
          dialogTitle: 'مشاركة أو حفظ عبر التطبيقات',
        });
        return {
          fileName: displayFileName,
          mimeType: blob.type,
          blobUrl,
          sharedNatively: true,
          sharePhone,
          shareText,
        };
      } catch (shareErr: unknown) {
        const msg = String((shareErr as { message?: string })?.message || '').toLowerCase();
        // If user cancelled the share sheet, treat as handled cleanly
        if (msg.includes('cancel') || msg.includes('abort')) {
          return {
            fileName: displayFileName,
            mimeType: blob.type,
            blobUrl,
            sharedNatively: true,
            sharePhone,
            shareText,
          };
        }
        // Retry with single `url` param for older Android Share implementations
        await Share.share({
          title,
          text: shareText || title,
          url: saved.uri,
          dialogTitle: 'مشاركة أو حفظ الملف',
        });
        return {
          fileName: displayFileName,
          mimeType: blob.type,
          blobUrl,
          sharedNatively: true,
          sharePhone,
          shareText,
        };
      }
    } catch (nativeErr) {
      console.warn('Native Capacitor Filesystem/Share fallback:', nativeErr);
      // Fall through cleanly to Web Share / preview download
    }
  }

  // 2. Web Share API Level 2 (Android Chrome / PWA / Safari)
  try {
    const file = new File([blob], displayFileName, { type: blob.type });
    if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title,
        text: shareText || title,
      });
      return {
        fileName: displayFileName,
        mimeType: blob.type,
        blobUrl,
        sharedNatively: true,
        sharePhone,
        shareText,
      };
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        fileName: displayFileName,
        mimeType: blob.type,
        blobUrl,
        sharedNatively: true,
        sharePhone,
        shareText,
      };
    }
  }

  // 3. Fallback: Automatic direct file download (works in Desktop & iframe preview)
  triggerDirectDownload(blobUrl, displayFileName);
  return {
    fileName: displayFileName,
    mimeType: blob.type,
    blobUrl,
    sharedNatively: false,
    sharePhone,
    shareText,
  };
}

/**
 * Generate and share/download a crisp HD PNG image with circular official logo & RTL Arabic.
 */
export async function exportAsHDImage(payload: PrintableDocumentPayload): Promise<ExportShareResult> {
  const canvas = await renderRoyalCanvas(payload);
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 1.0));
  if (!blob) {
    // Fallback via dataURL -> Blob for older WebViews where toBlob can return null
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    const res = await fetch(dataUrl);
    blob = await res.blob();
  }

  const safeName = `${payload.fileName.replace(/[^\w\u0600-\u06FF-]+/g, '_')}_HD.png`;
  return shareOrDownloadFile(blob, safeName, 'png', payload.title, payload.shareText, payload.sharePhone);
}

/**
 * Generate and share/download a crisp Arabic RTL multi-page A4 PDF with circular official logo.
 */
export async function exportAsArabicPDF(payload: PrintableDocumentPayload): Promise<ExportShareResult> {
  const [canvas, { jsPDF }] = await Promise.all([renderRoyalCanvas(payload), import('jspdf')]);
  const imgData = canvas.toDataURL('image/jpeg', 0.94);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const usableWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * usableWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  pdf.addImage(imgData, 'JPEG', margin, position, usableWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight + margin;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
  }

  const safeName = `${payload.fileName.replace(/[^\w\u0600-\u06FF-]+/g, '_')}.pdf`;
  const pdfBlob = pdf.output('blob');
  return shareOrDownloadFile(pdfBlob, safeName, 'pdf', payload.title, payload.shareText, payload.sharePhone);
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
