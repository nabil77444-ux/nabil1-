import type { AppSettingsDoc, SaleDoc, SaleLineItem } from '../types/taibah';

export type BuyerTierRole = 'agent' | 'client' | 'consumer';

export interface DenominationLineBreakdown {
  key: string;
  packageId: string;
  denomination: number;
  packageLabel: string;
  buyerRole: BuyerTierRole;
  buyerRoleLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Exact required Arabic formula: "50 كرت × 100 = 5,000 ر.ي" */
  formulaText: string;
  /** Full labeled line: "فئة 100 ريال: 50 كرت × 100 = 5,000 ر.ي" */
  fullLineText: string;
}

export function formatNumEn(value: number): string {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

export function getBuyerRoleArabicLabel(
  buyerRole?: SaleDoc['buyerRole'],
  saleType?: SaleDoc['saleType']
): string {
  if (saleType === 'direct' || buyerRole === 'consumer') {
    return 'زبون (بيع مباشر)';
  }
  if (buyerRole === 'agent') {
    return 'وكيل';
  }
  return 'عميل';
}

export function getBuyerPriceTierLabel(
  buyerRole?: SaleDoc['buyerRole'],
  saleType?: SaleDoc['saleType'],
  discountRate?: number
): string {
  if (saleType === 'direct' || buyerRole === 'consumer') {
    return 'سعر الزبون (100%)';
  }
  if (buyerRole === 'agent') {
    return `سعر الوكيل (${discountRate || 70}%)`;
  }
  return `سعر العميل (${discountRate || 80}%)`;
}

/**
 * Resolve the authoritative unit price for a package denomination based on buyer account type:
 * - Agent (`agent`): Agent pricing rate (e.g. 70% or custom agent discountRate)
 * - Client (`client`): Client pricing rate (e.g. 80% or custom client discountRate)
 * - Consumer / Direct Sale (`consumer` / `direct`): 100% full face value
 */
export function resolveUnitPriceForBuyer(params: {
  facePrice: number;
  buyerRole?: SaleDoc['buyerRole'];
  saleType?: SaleDoc['saleType'];
  explicitUnitPrice?: number;
  discountRate?: number;
  appSettings?: Partial<AppSettingsDoc>;
}): number {
  const facePrice = Math.max(0, Number(params.facePrice) || 0);
  if (params.saleType === 'direct' || params.buyerRole === 'consumer') {
    return facePrice;
  }

  if (typeof params.explicitUnitPrice === 'number' && params.explicitUnitPrice > 0) {
    return Math.round(params.explicitUnitPrice);
  }

  const rate =
    typeof params.discountRate === 'number' && params.discountRate > 0
      ? params.discountRate
      : params.buyerRole === 'agent'
        ? params.appSettings?.agentDiscountPercent || 70
        : params.appSettings?.clientDiscountPercent || 80;

  return Math.round((facePrice * rate) / 100);
}

/**
 * Format a single denomination formula string:
 * Example: "50 كرت × 100 = 5,000 ر.ي"
 */
export function formatDenominationFormula(
  quantity: number,
  unitPrice: number,
  lineTotal?: number
): string {
  const qty = Math.max(0, Math.round(Number(quantity) || 0));
  const price = Math.max(0, Math.round(Number(unitPrice) || 0));
  const total = typeof lineTotal === 'number' ? Math.round(lineTotal) : qty * price;
  return `${formatNumEn(qty)} كرت × ${formatNumEn(price)} = ${formatNumEn(total)} ر.ي`;
}

/**
 * Build ordered per-denomination breakdown for a single SaleDoc.
 */
export function buildSingleSaleBreakdown(
  sale: SaleDoc,
  appSettings?: Partial<AppSettingsDoc>
): DenominationLineBreakdown[] {
  const items: SaleLineItem[] = sale.items || [];
  const effectiveRole: BuyerTierRole =
    sale.saleType === 'direct' || sale.buyerRole === 'consumer'
      ? 'consumer'
      : sale.buyerRole === 'agent'
        ? 'agent'
        : 'client';
  const roleLabel = getBuyerRoleArabicLabel(effectiveRole, sale.saleType);

  const grouped = new Map<string, DenominationLineBreakdown>();

  for (const item of items) {
    const denomination = Math.max(0, Number(item.price) || 0);
    const netQty = Math.max(0, (Number(item.quantity) || 0) - (Number(item.returned) || 0));
    const qty = netQty > 0 ? netQty : Math.max(0, Number(item.quantity) || 0);
    if (qty <= 0) continue;

    const unitPrice = resolveUnitPriceForBuyer({
      facePrice: denomination,
      buyerRole: effectiveRole,
      saleType: sale.saleType,
      explicitUnitPrice: item.unitPrice,
      discountRate: sale.discountRate,
      appSettings,
    });

    const key = `${denomination}_${unitPrice}_${effectiveRole}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += qty;
      existing.lineTotal = existing.quantity * existing.unitPrice;
      existing.formulaText = formatDenominationFormula(
        existing.quantity,
        existing.unitPrice,
        existing.lineTotal
      );
      existing.fullLineText = `فئة ${formatNumEn(existing.denomination)} ريال (${roleLabel}): ${existing.formulaText}`;
    } else {
      const lineTotal = qty * unitPrice;
      const formulaText = formatDenominationFormula(qty, unitPrice, lineTotal);
      grouped.set(key, {
        key,
        packageId: item.packageId,
        denomination,
        packageLabel: item.packageLabel || `فئة ${formatNumEn(denomination)} ريال`,
        buyerRole: effectiveRole,
        buyerRoleLabel: roleLabel,
        quantity: qty,
        unitPrice,
        lineTotal,
        formulaText,
        fullLineText: `فئة ${formatNumEn(denomination)} ريال (${roleLabel}): ${formulaText}`,
      });
    }
  }

  return Array.from(grouped.values()).sort((a, b) => a.denomination - b.denomination);
}

/**
 * Aggregate per-denomination breakdown across a list of SaleDocs (for Reports Center & Sales List),
 * preserving exact buyer-type pricing separation (Agent vs Client vs Direct Consumer).
 */
export function buildSalesListDenominationBreakdown(
  salesList: SaleDoc[],
  appSettings?: Partial<AppSettingsDoc>
): DenominationLineBreakdown[] {
  const map = new Map<string, DenominationLineBreakdown>();

  for (const sale of salesList) {
    const lines = buildSingleSaleBreakdown(sale, appSettings);
    for (const line of lines) {
      const existing = map.get(line.key);
      if (existing) {
        existing.quantity += line.quantity;
        existing.lineTotal = existing.quantity * existing.unitPrice;
        existing.formulaText = formatDenominationFormula(
          existing.quantity,
          existing.unitPrice,
          existing.lineTotal
        );
        existing.fullLineText = `فئة ${formatNumEn(existing.denomination)} ريال (${existing.buyerRoleLabel}): ${existing.formulaText}`;
      } else {
        map.set(line.key, { ...line });
      }
    }
  }

  const roleOrder: Record<BuyerTierRole, number> = { consumer: 0, client: 1, agent: 2 };
  return Array.from(map.values()).sort((a, b) => {
    if (a.denomination !== b.denomination) return a.denomination - b.denomination;
    return roleOrder[a.buyerRole] - roleOrder[b.buyerRole];
  });
}

/**
 * Convert denomination breakdown lines into ready-to-render printable rows for PDF & HD Image exports.
 */
export function toPrintableBreakdownItems(
  lines: DenominationLineBreakdown[]
): Array<{ label: string; formula: string }> {
  return lines.map((l) => ({
    label: `فئة ${formatNumEn(l.denomination)} ريال (${l.buyerRoleLabel})`,
    formula: l.formulaText,
  }));
}
