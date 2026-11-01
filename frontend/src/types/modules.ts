// Types for the optional modules (branches, cars, money boxes, accounts, partners, WhatsApp).

export type Currency = "USD" | "SYP";

/** The optional modules that are switched on / off. */
export type FeatureFlag = "branches" | "cars" | "money_boxes" | "accounts" | "partners" | "whatsapp";

export interface Features {
  branches: boolean;
  cars: boolean;
  money_boxes: boolean;
  accounts: boolean;
  partners: boolean;
  whatsapp: boolean;
  whatsapp_country_code: string;
  /** the WhatsApp group that gets reports (…@g.us) and its name */
  whatsapp_group_jid: string;
  whatsapp_group_name: string;
  whatsapp_notify_sales: boolean;
}

export interface Branch {
  id: number;
  name: string;
  address: string;
  phone: string;
  is_default: boolean;
  is_active: boolean;
}

export interface Car {
  id: number;
  name: string;
  plate: string;
  driver_name: string;
  phone: string;
  notes: string;
  is_active: boolean;
}

export interface CarDetail extends Car {
  stock: { product: number; product_name: string; unit: string; quantity: number; value: number }[];
  /** null for staff (built from cost prices) */
  stock_value: number | null;
  expenses: { id: number; category: string; description: string; amount: string; date: string }[];
  expenses_total: number;
  sales_count: number;
  sales_total: number;
}

export interface StockTransferInput {
  /** several products moved together (all or nothing) */
  lines?: { product: number; quantity: number }[];
  product?: number;
  quantity?: number;
  from_branch?: number | null;
  from_car?: number | null;
  to_branch?: number | null;
  to_car?: number | null;
  note?: string;
}

export interface StockTransferRow {
  id: number;
  product_name: string;
  quantity: number;
  from: string;
  to: string;
  note: string;
  created_at: string;
}

/** A payment / expense / withdrawal may be made in SYP at a typed rate (SYP per 1 USD). */
export interface MoneyInput {
  amount?: string; // USD value (when currency is USD)
  currency?: Currency;
  paid_amount?: string; // cash handed over in `currency`
  exchange_rate?: string;
}

export interface BoxSummary {
  currency: Currency;
  name: string;
  balance: number;
  total_in: number;
  total_out: number;
}

export interface BoxMovement {
  date: string;
  kind: string;
  description: string;
  amount: number;
  balance: number;
  ref: string;
  editable: boolean;
  edit_amount: number | null;
  edit_note: string;
  edit_rate: number | null;
}

export interface ExchangeRow {
  id: number;
  from_currency: Currency;
  to_currency: Currency;
  from_amount: number;
  to_amount: number;
  rate: number;
  note: string;
  date: string;
}

export interface Account {
  id: number;
  name: string;
  phone: string;
  address: string;
  is_customer: boolean;
  is_supplier: boolean;
  notes: string;
  is_active: boolean;
  total_sales: number;
  total_purchases: number;
  /** money they paid us (order payments + lump sums) */
  total_received: number;
  /** money we paid them */
  total_paid: number;
  /** > 0: the account owes us (debtor). < 0: we owe the account (creditor). */
  balance: number;
}

export interface LedgerLine {
  date: string;
  kind: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  ref: string;
}

export interface OpenOrder {
  ref: string;
  kind: "sale" | "purchase";
  date: string;
  total: number;
  paid: number;
  remaining: number;
  state: string;
}

export interface AccountDetail extends Account {
  /** oldest first */
  statement: LedgerLine[];
  /** invoices of the account that still have money open, oldest first */
  open_orders: OpenOrder[];
}

export interface Partner {
  id: number;
  name: string;
  phone: string;
  share_percent: string;
  notes: string;
  is_active: boolean;
  balance: number;
  undistributed: number;
  withdrawn_total: number;
  prior_profit_total: number;
}

/** A partner's own profit (or loss, negative) for a period before TradeOps. */
export interface PriorProfit {
  id: number;
  partner: number;
  period_start: string | null;
  period_end: string;
  amount: string;
  note: string;
}

export type PriorProfitInput = Omit<PriorProfit, "id">;

export interface PartnersOverview {
  partners: Partner[];
  period_start: string;
  total_percent: number;
  period_net_profit: number;
  opening_configured: boolean;
}

export interface PartnerProfitOpening {
  as_of: string;
  net_profit: number;
  note: string;
  lines: {
    partner: number;
    partner_name: string;
    /** the partner's OWN profit before TradeOps (negative = loss) */
    net_profit: number;
    withdrawn_amount: number;
  }[];
}

export interface ProfitOpeningState {
  opening: PartnerProfitOpening | null;
  editable: boolean;
}

export interface ProfitOpeningInput {
  as_of: string;
  note?: string;
  lines: { partner: number; net_profit: string; withdrawn_amount: string }[];
}

export interface PartnerDetail extends Partner {
  opening: {
    as_of: string;
    net_profit: number;
    withdrawn_amount: number;
  } | null;
  prior_profits: PriorProfit[];
  withdrawals: {
    id: number;
    amount: string;
    currency: Currency;
    paid_amount: string | null;
    date: string;
    note: string;
  }[];
  history: {
    settlement: number;
    period_start: string;
    period_end: string;
    net_profit: number;
    share_percent: string;
    share_amount: number;
    withdrawn_in_period: number;
  }[];
}

export interface SettlementPreview {
  period_start: string;
  period_end: string;
  net_profit: number;
  total_percent: number;
  lines: {
    partner: number;
    partner_name: string;
    share_percent: string;
    share_amount: number;
    withdrawn_in_period: number;
  }[];
}

export interface Settlement {
  id: number;
  period_start: string;
  period_end: string;
  net_profit: number;
  note: string;
  lines: SettlementPreview["lines"];
}

export interface WhatsappStatus {
  state: "open" | "connecting" | "close" | "unlinked" | "offline" | "unavailable" | string;
  detail: string;
  qr: string;
  pairingCode: string;
}
