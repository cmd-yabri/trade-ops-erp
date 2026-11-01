import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { historyService } from "@/services/historyService";
import { ReturnRequest } from "@/types/history";
import { MoneyInput } from "@/types/modules";

// Returns and links move stock, money and balances: refresh everything that shows them.
const TOUCHED = [
  "products", "salesOrders", "purchaseOrders", "accounts", "boxes", "financialSummary", "dashboard", "charts",
  "opening", "movements", "expenses", "journal",
];

const useRefreshTouched = () => {
  const queryClient = useQueryClient();
  return () => TOUCHED.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
};

export const useMovements = (productId: number | null) =>
  useQuery({
    queryKey: ["movements", productId],
    queryFn: () => historyService.getMovements(productId as number),
    enabled: !!productId,
  });

export const useOpening = (enabled = true) =>
  useQuery({ queryKey: ["opening"], queryFn: historyService.getOpening, enabled });

export const useLinkOpening = () => {
  const refresh = useRefreshTouched();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { account?: number | null; supplier?: string; supplier_phone?: string } }) =>
      historyService.linkOpening(id, data),
    onSuccess: refresh,
  });
};

export const usePayOpening = () => {
  const refresh = useRefreshTouched();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: MoneyInput }) => historyService.payOpening(id, data),
    onSuccess: refresh,
  });
};

export const useCorrectOpeningPayment = () => {
  const refresh = useRefreshTouched();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: MoneyInput }) =>
      historyService.correctOpeningPayment(id, data),
    onSuccess: refresh,
  });
};

export const useCancelOpeningPay = () => {
  const refresh = useRefreshTouched();
  return useMutation({ mutationFn: (id: number) => historyService.cancelOpeningPay(id), onSuccess: refresh });
};

export const useUnlinkOpening = () => {
  const refresh = useRefreshTouched();
  return useMutation({ mutationFn: (id: number) => historyService.unlinkOpening(id), onSuccess: refresh });
};

export const useSalesReturn = () => {
  const refresh = useRefreshTouched();
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: number; data: ReturnRequest }) => historyService.addSalesReturn(orderId, data),
    onSuccess: refresh,
  });
};

export const useDeleteSalesReturn = () => {
  const refresh = useRefreshTouched();
  return useMutation({
    mutationFn: ({ orderId, returnId }: { orderId: number; returnId: number }) =>
      historyService.deleteSalesReturn(orderId, returnId),
    onSuccess: refresh,
  });
};

export const usePurchaseReturn = () => {
  const refresh = useRefreshTouched();
  return useMutation({
    mutationFn: ({ poId, data }: { poId: number; data: ReturnRequest }) => historyService.addPurchaseReturn(poId, data),
    onSuccess: refresh,
  });
};

export const useDeletePurchaseReturn = () => {
  const refresh = useRefreshTouched();
  return useMutation({
    mutationFn: ({ poId, returnId }: { poId: number; returnId: number }) =>
      historyService.deletePurchaseReturn(poId, returnId),
    onSuccess: refresh,
  });
};

export const useEditLog = (docType: "SO" | "PO", id: number | null, enabled = true) =>
  useQuery({
    queryKey: ["editLog", docType, id],
    queryFn: () => historyService.getEditLog(docType, id as number),
    enabled: enabled && !!id,
  });
