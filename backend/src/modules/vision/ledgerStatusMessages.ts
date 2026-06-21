export function isLedgerNoDataStatus(data: any): boolean {
  return data?.status === 'no_company_data' || data?.status === 'not_in_database';
}
