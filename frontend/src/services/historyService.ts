import apiClient from "@/lib/apiClient";
import { PurchaseOrder, SalesOrder } from "@/types/api";
import { EditLogRow, OpeningStockRow, ReturnRequest, StockMovement } from "@/types/history";
import { MoneyInput } from "@/types/modules";

export const historyService = {
  getMovements: async (productId: number): Promise<StockMovement[]> =>
    (await apiClient.get<StockMovement[]>(`/api/inventory/products/${productId}/movements/`)).data,

  getOpening: async (): Promise<OpeningStockRow[]> =>
    (await apiClient.get<OpeningStockRow[]>("/api/inventory/opening/")).data,

  /** link opening stock to a supplier account, or a supplier typed by name */
  linkOpening: async (
    id: number,
    data: { account?: number | null; supplier?: string; supplier_phone?: string },
  ): Promise<OpeningStockRow> => (await apiClient.post<OpeningStockRow>(`/api/inventory/opening/${id}/link/`, data)).data,

  /** opening stock without a supplier was paid from a cash box */
  payOpening: async (id: number, data: MoneyInput): Promise<OpeningStockRow> =>
    (await apiClient.post<OpeningStockRow>(`/api/inventory/opening/${id}/pay/`, data)).data,

  correctOpeningPayment: async (id: number, data: MoneyInput): Promise<OpeningStockRow> =>
    (await apiClient.put<OpeningStockRow>(`/api/inventory/opening/${id}/pay/`, data)).data,

  cancelOpeningPay: async (id: number): Promise<OpeningStockRow> =>
    (await apiClient.delete<OpeningStockRow>(`/api/inventory/opening/${id}/pay/`)).data,

  unlinkOpening: async (id: number): Promise<OpeningStockRow> =>
    (await apiClient.delete<OpeningStockRow>(`/api/inventory/opening/${id}/link/`)).data,

  addSalesReturn: async (orderId: number, data: ReturnRequest): Promise<SalesOrder> =>
    (await apiClient.post<SalesOrder>(`/api/orders/sales/${orderId}/returns/`, data)).data,

  deleteSalesReturn: async (orderId: number, returnId: number): Promise<SalesOrder> =>
    (await apiClient.delete<SalesOrder>(`/api/orders/sales/${orderId}/returns/${returnId}/`)).data,

  addPurchaseReturn: async (poId: number, data: ReturnRequest): Promise<PurchaseOrder> =>
    (await apiClient.post<PurchaseOrder>(`/api/purchases/po/${poId}/returns/`, data)).data,

  deletePurchaseReturn: async (poId: number, returnId: number): Promise<PurchaseOrder> =>
    (await apiClient.delete<PurchaseOrder>(`/api/purchases/po/${poId}/returns/${returnId}/`)).data,

  getEditLog: async (docType: "SO" | "PO", id: number): Promise<EditLogRow[]> =>
    (await apiClient.get<EditLogRow[]>("/api/audit/", { params: { type: docType, id } })).data,
};
