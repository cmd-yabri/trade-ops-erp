import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { moduleService } from "@/services/moduleService";
import { Currency } from "@/types/modules";

/** A mutation that refetches the listed query groups once it succeeds. */
function useAction<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, invalidate: string[]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidate.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    },
  });
}

// ----- features, branches
export const useUpdateFeatures = () => useAction(moduleService.updateFeatures, ["features", "branches"]);
export const useBranchesAll = () => useQuery({ queryKey: ["branches"], queryFn: moduleService.getBranches });
export const useSaveBranch = () =>
  useAction(
    ({ id, data }: { id?: number; data: Parameters<typeof moduleService.createBranch>[0] }) =>
      id ? moduleService.updateBranch(id, data) : moduleService.createBranch(data),
    ["branches"],
  );
export const useDeleteBranch = () => useAction(moduleService.deleteBranch, ["branches"]);

// ----- cars and transfers
export const useCars = (enabled = true) =>
  useQuery({ queryKey: ["cars"], queryFn: moduleService.getCars, enabled });
export const useCar = (id: number | null) =>
  useQuery({ queryKey: ["cars", id], queryFn: () => moduleService.getCar(id as number), enabled: !!id });
export const useSaveCar = () =>
  useAction(
    ({ id, data }: { id?: number; data: Parameters<typeof moduleService.createCar>[0] }) =>
      id ? moduleService.updateCar(id, data) : moduleService.createCar(data),
    ["cars"],
  );
export const useDeleteCar = () => useAction(moduleService.deleteCar, ["cars"]);
export const useTransfers = () => useQuery({ queryKey: ["transfers"], queryFn: moduleService.getTransfers });
export const useTransferStock = () =>
  useAction(moduleService.transferStock, ["products", "cars", "transfers", "dashboard"]);

// ----- money boxes
export const useBoxes = (enabled = true) =>
  useQuery({ queryKey: ["boxes"], queryFn: () => moduleService.getBoxes(), enabled });
export const useBoxStatement = (currency: Currency, enabled = true) =>
  useQuery({
    queryKey: ["boxes", "statement", currency],
    queryFn: () => moduleService.getStatement(currency),
    enabled,
  });
export const useExchanges = (enabled = true) =>
  useQuery({ queryKey: ["boxes", "exchanges"], queryFn: moduleService.getExchanges, enabled });
export const useBoxEntry = () => useAction(moduleService.addBoxEntry, ["boxes"]);
export const useEditBoxMovement = () =>
  useAction(moduleService.editBoxMovement, [
    "boxes", "financialSummary", "journal", "accounts", "partners", "salesOrders",
    "purchaseOrders", "expenses", "opening", "products",
  ]);
export const useExchange = () => useAction(moduleService.exchange, ["boxes"]);

// ----- wholesale accounts
export const useAccounts = (enabled = true) =>
  useQuery({ queryKey: ["accounts"], queryFn: moduleService.getAccounts, enabled });
export const useAccount = (id: number | null) =>
  useQuery({ queryKey: ["accounts", id], queryFn: () => moduleService.getAccount(id as number), enabled: !!id });
export const useSaveAccount = () =>
  useAction(
    ({ id, data }: { id?: number; data: Parameters<typeof moduleService.createAccount>[0] }) =>
      id ? moduleService.updateAccount(id, data) : moduleService.createAccount(data),
    ["accounts"],
  );
export const useDeleteAccount = () => useAction(moduleService.deleteAccount, ["accounts"]);
export const useAccountPayment = () =>
  useAction(
    ({ id, data }: { id: number; data: Parameters<typeof moduleService.addAccountPayment>[1] }) =>
      moduleService.addAccountPayment(id, data),
    ["accounts", "salesOrders", "purchaseOrders", "boxes", "financialSummary"],
  );
export const useAccountEntry = () =>
  useAction(
    ({ id, data }: { id: number; data: Parameters<typeof moduleService.addAccountEntry>[1] }) =>
      moduleService.addAccountEntry(id, data),
    ["accounts"],
  );

// ----- partners
export const usePartners = (enabled = true) =>
  useQuery({ queryKey: ["partners"], queryFn: moduleService.getPartners, enabled });
export const useProfitOpening = (enabled = true) =>
  useQuery({ queryKey: ["partners", "opening"], queryFn: moduleService.getProfitOpening, enabled });
export const usePartner = (id: number | null) =>
  useQuery({ queryKey: ["partners", id], queryFn: () => moduleService.getPartner(id as number), enabled: !!id });
export const useSettlements = (enabled = true) =>
  useQuery({ queryKey: ["partners", "settlements"], queryFn: moduleService.getSettlements, enabled });
export const useSavePartner = () =>
  useAction(
    ({ id, data }: { id?: number; data: Parameters<typeof moduleService.createPartner>[0] }) =>
      id ? moduleService.updatePartner(id, data) : moduleService.createPartner(data),
    ["partners"],
  );
export const useSaveProfitOpening = () =>
  useAction(
    ({ data, update }: { data: Parameters<typeof moduleService.createProfitOpening>[0]; update: boolean }) =>
      update ? moduleService.updateProfitOpening(data) : moduleService.createProfitOpening(data),
    ["partners"],
  );
export const useSavePriorProfit = () =>
  useAction(
    ({ id, data }: { id?: number; data: Parameters<typeof moduleService.addPriorProfit>[0] }) =>
      id ? moduleService.updatePriorProfit(id, data) : moduleService.addPriorProfit(data),
    ["partners"],
  );
export const useDeletePriorProfit = () => useAction(moduleService.deletePriorProfit, ["partners"]);
export const useDeletePartner =() => useAction(moduleService.deletePartner, ["partners"]);
export const useWithdrawal = () => useAction(moduleService.addWithdrawal, ["partners", "boxes"]);
export const useDeleteWithdrawal = () => useAction(moduleService.deleteWithdrawal, ["partners", "boxes"]);
export const useSettle = () => useAction(moduleService.settle, ["partners"]);
export const useUndoSettlement = () => useAction(moduleService.undoSettlement, ["partners"]);

// ----- WhatsApp
export const useWhatsappStatus = (enabled: boolean, poll = false) =>
  useQuery({
    queryKey: ["whatsapp", "status"],
    queryFn: moduleService.whatsappStatus,
    enabled,
    refetchInterval: poll ? 3000 : false,
  });
