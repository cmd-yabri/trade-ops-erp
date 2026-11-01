/** Stock history, opening stock, returns and edit logs. */

export interface StockMovement {
  id: number;
  kind: string;
  kind_label: string;
  delta: number;
  balance_after: number;
  place: string;
  ref: string;
  note: string;
  created_at: string;
}

export interface OpeningStockRow {
  id: number;
  product: number;
  product_name: string;
  quantity: number;
  unit_cost: string;
  value: string;
  date: string;
  branch_name: string;
  /** the purchase order it was linked to (null = no supplier yet) */
  purchase_order: number | null;
  supplier: string;
  /** paid from a cash box while it has no supplier (null = not paid) */
  paid: {
    amount: string;
    currency: "USD" | "SYP";
    cash_amount: string;
    paid_amount: string | null;
    exchange_rate: string | null;
    date: string;
  } | null;
}

export interface ReturnLineView {
  product_name: string;
  quantity: number;
  value: number;
}

export interface ReturnView {
  id: number;
  date: string;
  note: string;
  value: number;
  refund_amount: number;
  refund_to_credit: boolean;
  currency: string;
  paid_amount: string | null;
  lines: ReturnLineView[];
}

export type MoneyAction = "refund" | "credit";

export interface ReturnRequest {
  lines: { item: number; quantity: number; branch?: number | null; car?: number | null }[];
  date?: string;
  note?: string;
  money_action?: MoneyAction | null;
  currency?: "USD" | "SYP";
  exchange_rate?: string;
}

export interface EditLogRow {
  id: number;
  doc_type: "SO" | "PO";
  doc_id: number;
  summary: string;
  user: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  created_at: string;
}
