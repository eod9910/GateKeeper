export function getLedgerCorporateAction(data: any): any | null {
  return data?.special_situations?.corporate_action || null;
}

export function getLedgerHardFlags(data: any): any[] {
  return Array.isArray(data?.special_situations?.hard_flags) ? data.special_situations.hard_flags : [];
}
