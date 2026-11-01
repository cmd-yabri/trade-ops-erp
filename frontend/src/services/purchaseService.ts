import apiClient from "@/lib/apiClient";
import { PaymentsAction } from "@/components/RemovePaymentsDialog";
import { MoneyInput } from "@/types/modules";
import {
  PurchaseOrder,
  PurchaseOrderCreate,
  POPaymentCreate,
  ReceiveRequest,
  TransportPayee,
} from "@/types/api";

export const purchaseService = {
  getPurchaseOrders: async (): Promise<PurchaseOrder[]> => {
    const response = await apiClient.get<PurchaseOrder[]>("/api/purchases/po/");
    return response.data;
  },

  createPurchaseOrder: async (
    order: PurchaseOrderCreate,
  ): Promise<PurchaseOrder> => {
    const response = await apiClient.post<PurchaseOrder>(
      "/api/purchases/po/",
      order,
    );
    return response.data;
  },

  // Only pending orders can be edited.
  updatePurchaseOrder: async (
    id: number,
    data: Partial<PurchaseOrderCreate>,
  ): Promise<PurchaseOrder> => {
    const response = await apiClient.put<PurchaseOrder>(
      `/api/purchases/po/${id}/`,
      data,
    );
    return response.data;
  },

  /** payments: what happens to money already paid on the order ("refund" or "credit") */
  deletePurchaseOrder: async (id: number, payments?: PaymentsAction): Promise<void> => {
    await apiClient.delete(`/api/purchases/po/${id}/`, { params: payments ? { payments } : undefined });
  },

  cancelPurchaseOrder: async (id: number, payments?: PaymentsAction): Promise<PurchaseOrder> => {
    const response = await apiClient.post<PurchaseOrder>(
      `/api/purchases/po/${id}/cancel/`,
      payments ? { payments } : {},
    );
    return response.data;
  },

  addPayment: async (
    poId: number,
    payment: POPaymentCreate,
  ): Promise<PurchaseOrder> => {
    const response = await apiClient.post<PurchaseOrder>(
      `/api/purchases/po/${poId}/add-payment/`,
      payment,
    );
    return response.data;
  },

  // Marks the order received: adds the goods to stock and updates average cost.
  /** empty request = everything still due, into the order's branch */
  receivePurchaseOrder: async (poId: number, request: ReceiveRequest = {}): Promise<PurchaseOrder> => {
    const response = await apiClient.post<PurchaseOrder>(
      `/api/purchases/po/${poId}/receive/`,
      request,
    );
    return response.data;
  },

  /** set or fill in later the transport / loading fee and who is paid */
  setTransport: async (
    poId: number,
    data: MoneyInput & { payee: TransportPayee; date?: string },
  ): Promise<PurchaseOrder> => {
    const response = await apiClient.post<PurchaseOrder>(`/api/purchases/po/${poId}/transport/`, data);
    return response.data;
  },
};
