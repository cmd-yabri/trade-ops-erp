import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoneyEntry, MoneyState, emptyMoney, toMoneyPayload, usdValue } from "@/components/MoneyEntry";
import { useFeatures } from "@/contexts/FeaturesContext";
import { cn, formatMoney, todayLocal } from "@/lib/utils";
import { PurchaseOrder, TransportPayee } from "@/types/api";
import { MoneyInput } from "@/types/modules";

interface TransportDialogProps {
  order: PurchaseOrder | null;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (data: MoneyInput & { payee: TransportPayee; date?: string }) => void;
}

/**
 * The transport / loading fee of an order, also after the goods arrived. It raises the goods'
 * cost either way; the payee decides where the money goes: the supplier's bill, or a carrier
 * paid now from a cash box.
 */
export function TransportDialog({ order, onOpenChange, pending, onSubmit }: TransportDialogProps) {
  const { features } = useFeatures();
  const [payee, setPayee] = useState<TransportPayee>("CARRIER");
  const [money, setMoney] = useState<MoneyState>(emptyMoney());
  const [date, setDate] = useState(todayLocal());

  useEffect(() => {
    if (!order) return;
    setPayee(order.transport_payee ?? "CARRIER");
    const current = Number(order.transport_cost) || 0;
    setMoney({ ...emptyMoney(), amount: current > 0 ? String(current) : "" });
    setDate(todayLocal());
  }, [order]);

  if (!order) return null;
  const current = Number(order.transport_cost) || 0;
  const amount = usdValue(money);
  const removing = current > 0 && (money.amount === "" || parseFloat(money.amount) === 0);

  const submit = () => {
    if (removing) return onSubmit({ payee, currency: "USD", amount: "0" });
    // the supplier's bill is always in USD
    const payload = payee === "SUPPLIER" ? { currency: "USD" as const, amount: amount.toFixed(2) } : toMoneyPayload(money);
    onSubmit({ payee, date, ...payload });
  };

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>أجرة النقل والتحميل - PO-{order.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {current > 0 && (
            <p className="text-sm text-muted-foreground">
              الأجرة الحالية: {formatMoney(current)} ({order.transport_payee === "SUPPLIER" ? "على فاتورة المورد" : "لناقل مستقل"})
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {([
              ["CARRIER", "لناقل مستقل", "تُدفع الآن من الصندوق"],
              ["SUPPLIER", "على فاتورة المورد", "تُضاف لما ندين به للمورد"],
            ] as const).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPayee(value)}
                className={cn(
                  "rounded-lg border p-3 text-right",
                  payee === value ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground mt-1">{hint}</p>
              </button>
            ))}
          </div>
          <MoneyEntry
            label="الأجرة"
            enabled={features.money_boxes && payee === "CARRIER"}
            value={money}
            onChange={setMoney}
          />
          {payee === "CARRIER" && (
            <div className="space-y-2">
              <Label>تاريخ الدفع</Label>
              <Input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            تُوزَّع الأجرة على منتجات الأمر حسب قيمتها وتدخل في تكلفتها. إن كان هذا آخر شراء للمنتج تتحدث تكلفته.
          </p>
          <Button variant="brand" className="w-full" disabled={pending || (!removing && amount <= 0)} onClick={submit}>
            {pending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
            {removing ? "إزالة الأجرة" : "حفظ"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
