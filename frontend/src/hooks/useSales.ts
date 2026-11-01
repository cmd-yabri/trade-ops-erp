import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { salesService } from "@/services/salesService";
import { SalesOrder, SalesOrderCreate } from "@/types/api";
import { PaymentsAction } from "@/components/RemovePaymentsDialog";

/**
 * After a change: the saved order replaces its old copy in the list at once (so the card, the
 * details window and the PDF never show the version from before), then everything it touches is
 * reloaded. The returned promise lets mutateAsync wait for that reload.
 */
const useRefresh = () => {
  const queryClient = useQueryClient();
  return (extra: string[] = [], saved?: SalesOrder) => {
    if (saved?.id) {
      queryClient.setQueryData<SalesOrder[]>(["salesOrders"], (old) =>
        old?.map((o) => (o.id === saved.id ? saved : o)),
      );
    }
    // orders move account balances and cash boxes too
    return Promise.all(
      ["salesOrders", "accounts", "boxes", ...extra].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
  };
};

export const useSalesOrders = () =>
  useQuery({
    queryKey: ["salesOrders"],
    queryFn: salesService.getSalesOrders,
  });

export const useCreateSalesOrder = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (order: SalesOrderCreate) => salesService.createSalesOrder(order),
    onSuccess: () => refresh(),
  });
};

export const useUpdateSalesOrder = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SalesOrderCreate> }) =>
      salesService.updateSalesOrder(id, data),
    onSuccess: (saved) => refresh(["products", "dashboard", "charts", "financialSummary"], saved),
  });
};

// Finalizing deducts stock and books the sale into the financial figures.
export const useFinalizeOrder = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: number) => salesService.finalizeOrder(id),
    onSuccess: (saved) => refresh(["products", "dashboard", "charts", "financialSummary"], saved),
  });
};

export const useDeleteSalesOrder = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, payments }: { id: number; payments?: PaymentsAction }) =>
      salesService.deleteSalesOrder(id, payments),
    onSuccess: () => refresh(["products", "dashboard", "charts", "financialSummary"]),
  });
};

export const useAddSalesPayment = () => {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({
      orderId,
      payment,
    }: {
      orderId: number;
      payment: { amount?: string; date?: string; currency?: string; paid_amount?: string; exchange_rate?: string };
    }) => salesService.addPayment(orderId, payment),
    onSuccess: (saved) => refresh(["financialSummary"], saved),
  });
};
