import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoneyEntry, MoneyState, emptyMoney, toMoneyPayload, usdValue } from "@/components/MoneyEntry";
import { round2, todayLocal } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/types/modules";
import { confirmMoneyAction } from "@/lib/confirmMoneyAction";

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  total: number;
  paid: number;
  pending: boolean;
  format: (amount: number) => string;
  /** Money boxes feature: allow paying in SYP at a typed exchange rate */
  moneyEnabled?: boolean;
  onSubmit: (payment: MoneyInput, date: string) => void;
}

/**
 * The amount lives in this component's own state, so typing never re-renders
 * the (large) order table behind it. All money maths goes through round2 so
 * "pay the full remainder" can never produce 33.330000000000004.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  title,
  total,
  paid,
  pending,
  format,
  moneyEnabled = false,
  onSubmit,
}: PaymentDialogProps) {
  const [money, setMoney] = useState<MoneyState>(emptyMoney());
  const [date, setDate] = useState(todayLocal());
  const remaining = Math.max(round2(total - paid), 0);

  useEffect(() => {
    if (open) {
      setMoney(emptyMoney());
      setDate(todayLocal());
    }
  }, [open]);

  const usd = usdValue(money);
  // SYP rounds to a cent of USD; the server accepts up to one cent over for "pay everything".
  const tooMuch = usd > remaining + 0.01;
  const valid = usd > 0 && !tooMuch;

  const payAll = () => {
    if (money.currency === "USD") {
      setMoney({ ...money, amount: remaining.toFixed(2) });
    } else {
      const rate = parseFloat(money.rate);
      if (Number.isFinite(rate) && rate > 0) {
        // round UP to the cent so the full remainder is always covered
        setMoney({ ...money, amount: String(Math.ceil(remaining * rate * 100) / 100) });
      }
    }
  };
  const confirmPayment = async () => {
    const amount = money.currency === "USD"
      ? format(usd)
      : `${Number(money.amount).toLocaleString("en-US")} ل.س (≈ ${format(usd)})`;
    if (await confirmMoneyAction(`تسجيل دفعة بقيمة ${amount} بتاريخ ${date}؟`)) {
      onSubmit(toMoneyPayload(money), date);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="bg-muted p-3 rounded-lg text-sm space-y-1">
            <div className="flex justify-between">
              <span>الإجمالي:</span>
              <span>{format(total)}</span>
            </div>
            <div className="flex justify-between">
              <span>المدفوع سابقاً:</span>
              <span>{format(paid)}</span>
            </div>
            <div className="flex justify-between font-bold border-t pt-1">
              <span>المتبقي:</span>
              <span className="text-destructive">{format(remaining)}</span>
            </div>
          </div>
          <div className="space-y-2">
            <MoneyEntry label="مبلغ الدفعة" enabled={moneyEnabled} value={money} onChange={setMoney} />
            {tooMuch && (
              <p className="text-xs text-destructive">المبلغ أكبر من المتبقي ({format(remaining)}).</p>
            )}
            <Button type="button" variant="outline" size="sm" className="w-full text-xs" onClick={payAll}>
              دفع المبلغ المتبقي بالكامل
            </Button>
          </div>
          <div className="space-y-2">
            <Label>تاريخ الدفعة</Label>
            <Input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Button
            variant="brand"
            className="w-full"
            onClick={confirmPayment}
            disabled={pending || !valid}
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
            تأكيد الدفع
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
