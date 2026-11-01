export interface CompanyProfile {
  name: string;
  phone: string;
  phone2: string;
  address: string;
}

export const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The business's own name/phones/address for the top of a printed document.
 *  Empty profile -> nothing is printed (never someone else's company). */
export const companyHeaderHtml = (company?: CompanyProfile | null): string => {
  if (!company) return "";
  const lines = [
    company.name && `<div class="store-name">${escapeHtml(company.name)}</div>`,
    company.phone && `<div class="store-phone">${escapeHtml(company.phone)}</div>`,
    company.phone2 && `<div class="store-phone">${escapeHtml(company.phone2)}</div>`,
    company.address && `<div class="store-phone">${escapeHtml(company.address)}</div>`,
  ].filter(Boolean);
  return lines.join("\n              ");
};

export const printBaseCss = `
  :root { color-scheme: light; }
  html, body { background: #ffffff !important; color: #222222 !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { margin: 0; padding: 24px 32px; }
  tr, .totals, .info-section { break-inside: avoid; page-break-inside: avoid; }
  @page { size: A4; margin: 15mm; }
  @media print {
    body { padding: 0; }
    .print-buttons { display: none !important; }
  }
`;
