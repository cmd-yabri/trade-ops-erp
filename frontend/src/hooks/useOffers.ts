import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OfferInput, offerService } from "@/services/offerService";

export const useOffers = () => useQuery({ queryKey: ["offers"], queryFn: offerService.list });

function useOfferAction<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, alsoInvalidate: string[] = []) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // the returned promise makes mutateAsync wait for the reload (no stale offer on screen)
    onSuccess: () =>
      Promise.all(["offers", ...alsoInvalidate].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
  });
}

export const useSaveOffer = () =>
  useOfferAction(({ id, data }: { id?: number; data: OfferInput }) =>
    id ? offerService.update(id, data) : offerService.create(data),
  );
export const useDeleteOffer = () => useOfferAction(offerService.remove);
// Accepting creates a new sales order, so the sales list must refresh too (inventory is unchanged).
export const useAcceptOffer = () => useOfferAction(offerService.accept, ["salesOrders", "dashboard"]);
export const useRejectOffer = () => useOfferAction(offerService.reject);
export const useReopenOffer = () => useOfferAction(offerService.reopen);
