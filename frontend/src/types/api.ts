// API Types matching Django TradeOps API schemas based on OpenAPI spec
import type { MoneyInput } from "./modules";

// Enums
// Free-text service name (legacy rows hold STEEL / ELECTRIC / INSTALL / MOVING)
export type JobTypeEnum = string;
export type StatusEnum = "PENDING" | "PARTIAL" | "RECEIVED" | "CANCELLED";
export type CategoryEnum =
  | "RENT"
  | "ELECTRICITY"
  | "WATER"
  | "UTILITIES"
  | "SALARY"
  | "MARKETING"
  | "OTHER_INCOME"
  | "FUEL"
  | "MAINTENANCE"
  | "STOCK"
  | "OTHER";
export type RoleEnum = "USER" | "ADMIN";
export interface CategoryDetails {
  id: number;
  name: string;
  is_custom: boolean;
}
// Product (Inventory)
export interface Product {
  id: number;
  name: string;
  category_details: CategoryDetails; // Add this line
  category: number | null;
  category_name: string;
  unit_cost: string;
  selling_price?: string;
  wholesale_price?: string | null;
  current_stock?: number;
  reorder_threshold?: number;
  allow_decimal?: boolean;
  unit?: string;
  stock_by_location?: { kind: "branch" | "car"; id: number; name: string; quantity: number }[];
}

export interface ProductCreate {
  name: string;
  category?: number | string | null;
  unit_cost: string;
  selling_price?: string;
  wholesale_price?: string | null;
  current_stock?: number;
  reorder_threshold?: number;
  allow_decimal?: boolean;
  unit?: string;
  /** branch that receives the starting stock / a manual stock correction */
  branch?: number | null;
  /** new product with stock: the cash box it was paid from (null = old goods, not paid now) */
  opening_payment?: MoneyInput | null;
}

// Purchase Order
export interface POItem {
  id: number;
  product: number;
  product_name: string;
  quantity: number;
  /** how much of the line has arrived */
  received_quantity: number;
  returned_quantity?: number;
  unit_cost: string;
  /** price after its share of discount and transport (what one unit really cost) */
  landed_unit_cost?: string | null;
  total_cost: string;
}

export type TransportPayee = "SUPPLIER" | "CARRIER";

export interface ReceiveRequest {
  items?: { item: number; quantity: number }[];
  branch?: number | null;
  car?: number | null;
}

export interface POItemCreate {
  product: number;
  quantity: number;
  unit_cost: string;
}

export interface POPayment {
  id: number;
  amount: string;
  payment_date: string;
}

export interface POPaymentCreate {
  amount?: string;
  payment_date?: string;
  currency?: "USD" | "SYP";
  paid_amount?: string;
  exchange_rate?: string;
}

export interface PurchaseOrder {
  id: number;
  account?: number | null;
  account_name?: string;
  branch?: number | null;
  branch_name?: string;
  supplier: string;
  supplier_phone?: string;
  status: StatusEnum;
  items: POItem[];
  payments: POPayment[];
  total_cost: number;
  discount?: string | number;
  /** transport / loading fee (USD); paid to the supplier (on his bill) or a carrier (from a box) */
  transport_cost?: string;
  transport_payee?: TransportPayee;
  received_at?: string | null;
  net_total?: number;
  paymentStatus: "unpaid" | "partial" | "paid";
  returns?: import("./history").ReturnView[];
  returned_total?: number;
  /** what we owe after returns */
  due_total?: number;
  paid_amount: number;
  remaining: number;
  payment_status: string;
  order_date: string;
  created_at: string;
}

export interface PurchaseOrderCreate {
  account?: number | null;
  branch?: number | null;
  supplier: string;
  supplier_phone?: string;
  order_date: string;
  status?: StatusEnum;
  items: POItemCreate[];
  discount?: string;
}

// Sales Order
export interface OrderItem {
  id: number;
  product: number;
  product_name: string;
  quantity: number;
  unit_price: string;
  total_price: string;
  returned_quantity?: number;
  /** where this line leaves from (empty = the order's car / branch) */
  branch?: number | null;
  branch_name?: string;
  car?: number | null;
  car_name?: string;
}

export interface OrderItemCreate {
  product: number;
  quantity: number;
  unit_price: string;
  branch?: number | null;
  car?: number | null;
}

export interface FreelanceJob {
  id: number;
  job_type: JobTypeEnum;
  contractor_name: string;
  cost_to_company: string;
  charge_to_client: string;
  is_completed: boolean;
  profit_margin: string;
}

export interface FreelanceJobCreate {
  job_type: JobTypeEnum;
  contractor_name: string;
  cost_to_company: string;
  charge_to_client: string;
  is_completed?: boolean;
}

export interface SalesOrder {
  id: number;
  /** number of the price offer this order was created from */
  from_offer?: number | null;
  account?: number | null;
  account_name?: string;
  branch?: number | null;
  branch_name?: string;
  car?: number | null;
  car_name?: string;
  client_name: string;
  client_phone?: string;
  client_address?: string;
  date: string;
  is_finalized: boolean;
  finalized_at?: string | null;
  items: OrderItem[];
  freelance_jobs: FreelanceJob[];
  payments?: { id: number; amount: string; date: string }[];
  product_total: string;
  service_total: string;
  subtotal: string;
  discount: string;
  grand_total: string;
  total_paid?: string;
  remaining?: number;
  payment_status?: string;
  /** customer returns (credit notes) and what the order is worth after them */
  returns?: import("./history").ReturnView[];
  returned_total?: number;
  net_total?: number;
  // Admin only (the server leaves them out for staff)
  cost_total?: number;
  profit?: number;
}

export interface SalesOrderCreate {
  account?: number | null;
  branch?: number | null;
  car?: number | null;
  client_name: string;
  /** the invoice day, YYYY-MM-DD */
  sale_date?: string;
  client_phone?: string;
  client_address?: string;
  items: OrderItemCreate[];
  freelance_jobs?: FreelanceJobCreate[];
  discount?: string;
}

// Dashboard & Charts (based on DailyFinancialRecord schema)
export interface DailyFinancialRecord {
  date: string;
  total_revenue: string;
  total_cogs: string;
  total_freelance_costs: string;
  total_operational_expenses: string;
  net_profit: string;
}

export interface DashboardData {
  total_revenue?: string;
  total_cogs?: string;
  total_freelance_costs?: string;
  total_operational_expenses?: string;
  net_profit?: string;
  pending_orders?: number;
  low_stock_count?: number;
}

export interface FinancialSummary {
  period: string;
  total_revenue: string;
  total_cogs: string;
  total_freelance_costs: string;
  total_operational_expenses: string;
  total_stock_purchases?: string;
  /** money received from customers / paid to suppliers in the period */
  cash_received?: string;
  supplier_payments?: string;
  /** still open today, whatever the period */
  receivables?: string;
  payables?: string;
  net_profit: string;
  /** every money in / out of each cash box in the period (currency exchanges left out) */
  cash_flow?: Record<"USD" | "SYP", CashFlow>;
}

export interface CashFlow {
  in: number;
  out: number;
  in_parts: Partial<Record<"customers" | "other_income" | "other", number>>;
  out_parts: Partial<Record<"suppliers" | "goods" | "expenses" | "other", number>>;
}

// Expenses
export interface Expense {
  id: number;
  description: string;
  category: CategoryEnum;
  amount: string;
  date: string;
  receipt_image?: string | null;
  branch?: number | null;
  branch_name?: string;
  car?: number | null;
  car_name?: string;
  currency?: "USD" | "SYP";
  paid_amount?: string | null;
  exchange_rate?: string | null;
  type?: "INCOME" | "EXPENSE";
  /** transport of this purchase order / payment of this opening stock: changed there, not here */
  purchase_order?: number | null;
  opening_stock?: number | null;
}

/** One money movement of a cash box (amount > 0 = in, < 0 = out), for the Financials journal. */
export interface JournalRow {
  date: string;
  kind: string;
  description: string;
  amount: string;
  currency: "USD" | "SYP";
  ref: string;
  category?: string;
}

export interface ExpenseCreate {
  type: "INCOME" | "EXPENSE";
  description: string;
  category: CategoryEnum;
  /** USD amount; leave out when paying in SYP (send paid_amount + exchange_rate) */
  amount?: string;
  date: string;
  receipt_image?: string | null;
  branch?: number | null;
  car?: number | null;
  currency?: "USD" | "SYP";
  paid_amount?: string;
  exchange_rate?: string;
}

// Auth
export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthToken {
  access: string;
  refresh: string;
}

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  role: RoleEnum;
  is_active: boolean;
}

export interface UserSignup {
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  password: string;
  role?: RoleEnum;
}
