import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Round to cents; avoids float noise such as 0.1 + 0.2 = 0.30000000000000004. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Today's date as YYYY-MM-DD in the user's own timezone. */
export function todayLocal(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * One date format everywhere: 21/10/2026 (day/month/year, Latin digits, Gregorian).
 * "2026-10-21" is read as a local date, so it never shifts a day with the timezone.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  let d: Date;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split("-").map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(value);
  }
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

/** Whole numbers print as 10, fractions as 3.5 (never 3.500). */
export function formatQty(value: number | string | undefined | null): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "0";
}

/** Money for display: $1,234.50 or 1,500,000 ل.س */
export function formatMoney(amount: number | string | null | undefined, currency: "USD" | "SYP" = "USD"): string {
  const n = Number(amount ?? 0) || 0;
  // A left-to-right mark keeps the minus sign in front of the number inside Arabic (RTL) text.
  const lrm = n < 0 ? "‎" : "";
  // SYP keeps its cents when there are any (1,500,000.50), and stays clean when there are none.
  if (currency === "SYP") {
    const digits = Math.abs(n % 1) >= 0.005 ? 2 : 0;
    return `${lrm}${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ل.س`;
  }
  return lrm + n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** A unit cost: cents as usual ($105.00), up to 4 decimals for small costs ($0.3333 per metre). */
export function formatUnitCost(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0) || 0;
  const decimals = Math.abs(n * 100 - Math.round(n * 100)) > 1e-6 ? 4 : 2;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: decimals });
}
