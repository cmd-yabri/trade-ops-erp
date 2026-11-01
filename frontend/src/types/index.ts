export interface PurchaseOrder {
  id: string;
  supplier: string;
  totalAmount: number;
  paymentStatus: "unpaid" | "partial" | "paid";
  orderStatus: "pending" | "received";
  paidAmount: number;
  items: PurchaseOrderItem[];
  payments: Payment[];
  createdAt: string;
}

export interface PurchaseOrderItem {
  id: string;
  product: string;
  quantity: number;
  unitPrice: number;
}

export interface Payment {
  id: string;
  date: string;
  amount: number;
  method: "cash" | "bank_transfer" | "cheque" | "credit_card";
}

export interface SalesOrder {
  id: string;
  clientName: string;
  projectName: string;
  items: SalesOrderItem[];
  steelworkFees: number;
  electricianFees: number;
  totalAmount: number;
  status: "draft" | "confirmed" | "in_progress" | "completed";
  createdAt: string;
}

export interface SalesOrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: "panels" | "batteries" | "inverters" | "accessories";
  quantity: number;
  unitPrice: number;
  reorderLevel: number;
}

export interface Transaction {
  id: string;
  type: "purchase" | "sale";
  description: string;
  amount: number;
  date: string;
}

export interface FinancialSummary {
  income: number;
  outcome: number;
  netProfit: number;
  period: string;
}
