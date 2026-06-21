export function classifyLedgerFinding(row: any): string {
  const text = `${String(row?.section_heading || '')}\n${String(row?.text_excerpt || '')}`.toLowerCase();
  if (/\blease\b|\bright-of-use\b|\bdebt\b|\bcovenant\b|\bliquidity\b|\bcapital resources\b|\bworking capital\b|\bcommitments?\b/.test(text)) {
    return 'balance_sheet';
  }
  if (/\blegal\b|\blitigation\b|\bregulatory\b|\binvestigation\b|\bcompliance\b|\bcontingenc/i.test(text)) {
    return 'legal_regulatory';
  }
  if (/\bcustomer concentration\b|\bmajor customer\b|\bsupplier concentration\b|\bdependence\b/.test(text)) {
    return 'concentration';
  }
  if (/\bstock-based compensation\b|\bshare-based compensation\b|\bdilution\b|\brevenue recognition\b|\bdeferred revenue\b|\bcontract asset\b|\bnon-recurring\b|\bone-time\b|\brestructuring\b|\bimpairment\b|\baccounting\b|\btax\b|\baccrual/i.test(text)) {
    return 'accounting';
  }
  return 'management_language';
}

export function formatLedgerEvidenceLine(row: any): string {
  const heading = String(row?.section_heading || 'Unknown section').trim();
  const form = String(row?.form || '').trim();
  const filingDate = String(row?.filing_date || '').trim();
  const excerpt = String(row?.text_excerpt || '').replace(/\s+/g, ' ').trim();
  const shortExcerpt = excerpt.length > 220 ? `${excerpt.slice(0, 217).trim()}...` : excerpt;
  const meta = [heading, form, filingDate].filter(Boolean).join(' | ');
  return shortExcerpt ? `${meta}: ${shortExcerpt}` : meta;
}

export function isLedgerGenericRiskBoilerplate(row: any): boolean {
  const text = `${String(row?.section_heading || '')}\n${String(row?.text_excerpt || '')}`
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return [
    /you should carefully consider the following risk factors/,
    /as well as the other information set forth in this annual report/,
    /management's discussion and analysis of financial condition and results of operations/,
    /the risks and uncertainties described below are not the only ones/,
    /additional risks and uncertainties not presently known to us/,
    /could materially adversely affect our business/,
  ].some((pattern) => pattern.test(text));
}

export function inferLedgerSoftPedaledMeaning(row: any): string {
  const text = `${String(row?.section_heading || '')}\n${String(row?.text_excerpt || '')}`
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (isLedgerGenericRiskBoilerplate(row)) {
    return "I'm not seeing a specific buried issue in this excerpt. This reads like standard risk-factor boilerplate, not actionable signal by itself.";
  }
  if (/reimbursement|coverage|payer|medicare|medicaid/.test(text)) {
    return 'I think management may be framing reimbursement or payer pressure carefully here. If that pressure is real, margins or volume can weaken before the headline story makes it obvious.';
  }
  if (/competition|competitive|pricing pressure|price pressure/.test(text)) {
    return 'I think management may be softening competitive or pricing pressure. That matters because the business can still sound healthy while the economics quietly get worse.';
  }
  if (/supply chain|supplier|inventory|manufactur|component shortage/.test(text)) {
    return 'I think management may be hinting at supply-chain or production friction. If that is building, revenue quality and margin stability can deteriorate faster than the headline numbers suggest.';
  }
  if (/litigation|legal|investigation|regulatory|compliance/.test(text)) {
    return 'I think management may be carefully framing legal or regulatory exposure. These issues matter because they can stay buried in narrative language before they become an obvious financial hit.';
  }
  if (/cyber|security|privacy|data breach/.test(text)) {
    return 'I think management may be signaling cyber or privacy exposure. Those risks are easy to understate in polished language and can become expensive very quickly.';
  }
  if (/restructuring|impairment|goodwill|integration|acquisition/.test(text)) {
    return 'I think management may be softening an integration, restructuring, or asset-quality issue. That matters because it can point to a business that is less clean than the headline narrative implies.';
  }
  if (/demand|volume|utilization|slowdown|macroeconomic|consumer/.test(text)) {
    return 'I think management may be carefully framing a demand or volume issue. If demand is wobbling, the company will usually describe it gently before admitting the slowdown outright.';
  }
  if (/may|could|subject to|uncertaint|adverse|materially/.test(text)) {
    return "I think management is signaling some real uncertainty here, but I can't tell from this excerpt alone what the exact buried problem is. The wording is cautious enough to keep me alert, but not specific enough to act on by itself.";
  }
  return "I think management is framing this carefully, but I can't pin down the exact issue from this excerpt alone. I would want a more specific note passage before treating it as actionable intelligence.";
}

export function inferLedgerFindingSignificance(category: string, row: any): string | null {
  const excerpt = String(row?.text_excerpt || '').replace(/\s+/g, ' ').trim();
  const text = `${String(row?.section_heading || '')}\n${excerpt}`.toLowerCase();
  const cashDecreaseMatch = excerpt.match(/decreased by \$?([\d,.]+)\s*million/i);

  if (cashDecreaseMatch) {
    return `Cash declined by about $${cashDecreaseMatch[1]}M. That matters only if the decline reflects weaker flexibility rather than intentional uses like buybacks, debt paydown, or acquisitions.`;
  }

  if (category === 'balance_sheet') {
    if (/working capital/.test(text) && /cash and cash equivalents/.test(text)) {
      return 'This is mainly a liquidity-flexibility clue. I care less about the raw cash balance than whether the company still has comfortable room after the cash movement.';
    }
    if (/debt|covenant|credit facility|notes payable/.test(text)) {
      return 'Debt and covenant language matters because financial flexibility can deteriorate before the headline income statement looks weak.';
    }
    if (/lease|right-of-use|commitments?/.test(text)) {
      return 'Lease and commitment language matters because economic obligations are often heavier than the simple debt number suggests.';
    }
    return 'This is balance-sheet context. I use it to judge hidden obligations and true liquidity strength.';
  }

  if (category === 'accounting') {
    if (/stock-based compensation|share-based compensation/.test(text)) {
      return 'Stock-based compensation matters because it can make cash flow look cleaner than true owner economics while still diluting shareholders over time.';
    }
    if (/restructuring|impairment|one-time|non-recurring/.test(text)) {
      return 'So-called one-time charges matter because they can flatter normalized earnings if similar adjustments keep recurring.';
    }
    if (/revenue recognition|deferred revenue|contract asset|contract liability/.test(text)) {
      return 'Revenue-recognition language matters because it can change how clean or recurring the reported revenue really is.';
    }
    return 'This is accounting-quality context. I use it to decide whether reported earnings are cleaner than the underlying economics.';
  }

  if (category === 'legal_regulatory') {
    return 'Legal and regulatory language matters because contingent liabilities often show up here before they become obvious in the statements.';
  }

  if (category === 'concentration') {
    return 'Concentration matters because dependence on a customer, supplier, or channel can make the business look more diversified than it really is.';
  }

  return inferLedgerSoftPedaledMeaning(row);
}

export function buildLedgerCategorySection(title: string, category: string, rows: any[], emptyText?: string): string[] {
  const lines = [`${title}:`];
  if (!rows.length) {
    lines.push(`- ${emptyText || 'nothing specifically surfaced in this run'}`);
    return lines;
  }

  rows.slice(0, 3).forEach((row) => {
    lines.push(`- ${formatLedgerEvidenceLine(row)}`);
    const significance = inferLedgerFindingSignificance(category, row);
    if (significance) {
      lines.push(`  Significance: ${significance}`);
    }
  });

  return lines;
}
