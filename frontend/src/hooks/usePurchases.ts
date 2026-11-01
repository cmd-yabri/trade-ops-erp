import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { purchaseService } from "@/services/purchaseService";
import { PurchaseOrderCreate, POPaymentCreate, ReceiveRequest, TransportPayee } from "@/types/api";
import { MoneyInput } from "@/types/modules";
import { PaymentsAction } from "@/components/RemovePaymentsDialog";

const useRefreshAll = () => {
  const queryClient = useQueryClient();
  // Returned promise: mutateAsync waits until the lists are reloaded, so nothing shows the old version.
  return (extra: string[] = []) =>
    // orders move account balances and cash boxes too
    Promise.all(
      ["purchaseOrders", "accounts", "boxes", ...extra].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
};

export const usePurchaseOrders = () =>
  useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: purchaseService.getPurchaseOrders,
  });

export const useCreatePurchaseOrder = () => {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (order: PurchaseOrderCreate) =>
      purchaseService.createPurchaseOrder(order),
    onSuccess: () => refresh(),
  });
};

export const useUpdatePurchaseOrder = () => {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<PurchaseOrderCreate> }) =>
      purchaseService.updatePurchaseOrder(id, data),
    onSuccess: () => refresh(),
  });
};

export const useDeletePurchaseOrder = () => {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, payments }: { id: number; payments?: PaymentsAction }) =>
      purchaseService.deletePurchaseOrder(id, payments),
    onSuccess: () => refresh(),
  });
};

export const useCancelPurchaseOrder = () => {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, payments }: { id: number; payments?: PaymentsAction }) =>
      purchaseService.cancelPurchaseOrder(id, payments),
    onSuccess: () => refresh(),
  });
};

export const useAddPayment = () => {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ poId, payment }: { poId: number; payment: POPaymentCreate }) =>
      purchaseService.addPayment(poId, payment),
    onSuccess: () => refresh(["financialSummary"]),
  });
};

// Receiving adds stock and changes product costs.
export const useReceivePurchaseOrder = () => {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ poId, request }: { poId: number; request?: ReceiveRequest }) =>
      purchaseService.receivePurchaseOrder(poId, request),
    onSuccess: () =>
      refresh(["products", "salesOrders", "dashboard", "charts", "financialSummary"]),
  });
};

export const useSetTransport = () => {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ poId, data }: { poId: number; data: MoneyInput & { payee: TransportPayee; date?: string } }) =>
      purchaseService.setTransport(poId, data),
    onSuccess: () => refresh(["products", "financialSummary", "expenses"]),
  });
};
