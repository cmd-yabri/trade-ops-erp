import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuantityInput } from "@/components/QuantityInput";
import { SimpleSelect } from "@/components/SimpleSelect";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useCars } from "@/hooks/useModules";
import { useProducts } from "@/hooks/useInventory";
import { formatQty } from "@/lib/utils";
import { PurchaseOrder, ReceiveRequest } from "@/types/api";

interface ReceiveDialogProps {
  order: PurchaseOrder | null;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (request: ReceiveRequest) => void;
}

/** Receive what arrived: all or part of each line, into a branch or straight into a car. */
export function ReceiveDialog({ order, onOpenChange, pending, onSubmit }: ReceiveDialogProps) {
  const { features, branches } = useFeatures();
  const { data: cars = [] } = useCars(features.cars);
  const { data: products = [] } = useProducts();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [place, setPlace] = useState("");

  useEffect(() => {
    if (!order) return;
    setQuantities(
      Object.fromEntries(order.items.map((i) => [i.id, Math.max(Number(i.quantity) - Number(i.received_quantity || 0), 0)])),
    );
    setPlace(order.branch ? `branch:${order.branch}` : "");
  }, [order]);

  const places = useMemo(
    () => [
      ...branches.filter((b) => b.is_active).map((b) => ({ value: `branch:${b.id}`, label: `فرع: ${b.name}` })),
      ...(features.cars ? cars.filter((c) => c.is_active).map((c) => ({ value: `car:${c.id}`, label: `سيارة: ${c.name}` })) : []),
    ],
    [branches, cars, features.cars],
  );

  if (!order) return null;
  const lines = order.items.filter((i) => Number(i.quantity) - Number(i.received_quantity || 0) > 0);
  const total = Object.values(quantities).reduce((s, q) => s + (Number(q) || 0), 0);

  const submit = () => {
    const [kind, id] = place.split(":");
    onSubmit({
      items: lines.map((i) => ({ item: i.id, quantity: Number(quantities[i.id]) || 0 })).filter((l) => l.quantity > 0),
      ...(kind === "car" ? { car: Number(id) } : kind === "branch" ? { branch: Number(id) } : {}),
    });
  };

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>استلام بضاعة أمر الشراء PO-{order.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            أدخل الكمية التي وصلت فعلاً. ما يبقى يمكن استلامه لاحقاً.
          </p>
          <div className="space-y-2">
            {lines.map((i) => {
              const due = Number(i.quantity) - Number(i.received_quantity || 0);
              return (
                <div key={i.id} className="grid grid-cols-[1fr_8rem] gap-3 items-center rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{i.product_name}</p>
                    <p className="text-xs text-muted-foreground">
                      المطلوب {formatQty(i.quantity)} · وصل سابقاً {formatQty(i.received_quantity || 0)} · المتبقي {formatQty(due)}
                    </p>
                  </div>
                  <QuantityInput
                    allowDecimal={!!products.find((p) => p.id === i.product)?.allow_decimal}
                    value={quantities[i.id] ?? 0}
                    onChange={(n) => setQuantities({ ...quantities, [i.id]: Math.min(n, due) })}
                  />
                </div>
              );
            })}
          </div>
          {places.length > 1 && (
            <div className="space-y-2">
              <Label>أين وصلت البضاعة؟</Label>
              <SimpleSelect value={place} onChange={setPlace} options={places} />
            </div>
          )}
          <Button variant="brand" className="w-full" disabled={pending || total <= 0} onClick={submit}>
            {pending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
            تأكيد الاستلام
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
