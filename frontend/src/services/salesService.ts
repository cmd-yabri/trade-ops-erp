import apiClient from "@/lib/apiClient";
import { PaymentsAction } from "@/components/RemovePaymentsDialog";
import { SalesOrder, SalesOrderCreate } from "@/types/api";

export const salesService = {
  getSalesOrders: async (): Promise<SalesOrder[]> => {
    const response = await apiClient.get<SalesOrder[]>("/api/orders/sales/");
    return response.data;
  },

  createSalesOrder: async (order: SalesOrderCreate): Promise<SalesOrder> => {
    const response = await apiClient.post<SalesOrder>(
      "/api/orders/sales/",
      order,
    );
    return response.data;
  },

  // Deducts stock (fails if there is not enough) and books the sale.
  finalizeOrder: async (id: number): Promise<SalesOrder> => {
    const response = await apiClient.post<SalesOrder>(
      `/api/orders/sales/${id}/finalize/`,
    );
    return response.data;
  },

  updateSalesOrder: async (
    id: number,
    order: Partial<SalesOrderCreate>,
  ): Promise<SalesOrder> => {
    const response = await apiClient.put<SalesOrder>(
      `/api/orders/sales/${id}/`,
      order,
    );
    return response.data;
  },

  /** payments: what happens to money already paid on the order ("refund" or "credit") */
  deleteSalesOrder: async (id: number, payments?: PaymentsAction): Promise<void> => {
    await apiClient.delete(`/api/orders/sales/${id}/`, { params: payments ? { payments } : undefined });
  },

  addPayment: async (
    orderId: number,
    payment: { amount?: string; date?: string; currency?: string; paid_amount?: string; exchange_rate?: string },
  ): Promise<SalesOrder> => {
    const response = await apiClient.post<SalesOrder>(
      `/api/orders/sales/${orderId}/payments/`,
      payment,
    );
    return response.data;
  },
};
