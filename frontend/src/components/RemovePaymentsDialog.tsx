import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** What happens to money already paid on an order that is deleted / cancelled. */
export type PaymentsAction = "refund" | "credit";

interface RemovePaymentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** money paid on the order so far (already formatted) */
  paidText: string;
  /** "sale": the customer paid us; "purchase": we paid the supplier */
  kind: "sale" | "purchase";
  /** credit is only possible when the order belongs to an account */
  accountName?: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (action: PaymentsAction) => void;
}

/**
 * Deleting or cancelling a paid order must say where the money went, so it never
 * vanishes from the books: either it is handed back, or it stays on the account
 * as credit that settles the account's next orders.
 */
export function RemovePaymentsDialog({
  open, onOpenChange, title, paidText, kind, accountName, confirmLabel, pending, onConfirm,
}: RemovePaymentsDialogProps) {
  const [action, setAction] = useState<PaymentsAction>("refund");
  useEffect(() => {
    if (open) setAction(accountName ? "credit" : "refund");
  }, [open, accountName]);

  const options: { value: PaymentsAction; label: string; hint: string; disabled?: boolean }[] = [
    {
      value: "refund",
      label: kind === "sale" ? "أعدنا المبلغ للعميل" : "استرددنا المبلغ من المورد",
      hint: kind === "sale" ? "يخرج المبلغ من الصندوق." : "يعود المبلغ إلى الصندوق.",
    },
    {
      value: "credit",
      label: kind === "sale" ? "يبقى رصيداً للعميل عندنا" : "يبقى رصيداً لنا عند المورد",
      hint: accountName
        ? `يُحفظ في حساب «${accountName}» ويُخصم تلقائياً من فواتيره القادمة.`
        : "غير متاح: الطلب غير مرتبط بحساب جملة.",
      disabled: !accountName,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {kind === "sale" ? "دفع العميل على هذا الطلب" : "دفعنا على أمر الشراء هذا"}{" "}
            <span className="font-semibold text-foreground">{paidText}</span>. ماذا حدث لهذا المبلغ؟
          </p>
          {accountName && (
            <p className="text-xs text-muted-foreground">
              ما وُزّع على الطلب من دفعة مجمّعة للحساب يعود إلى رصيد الحساب في كل الأحوال.
            </p>
          )}
          <div className="space-y-2">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => setAction(o.value)}
                className={cn(
                  "w-full text-right rounded-lg border p-3 transition-colors",
                  action === o.value ? "border-primary bg-primary/5" : "border-border",
                  o.disabled && "opacity-50 cursor-not-allowed",
                )}
              >
                <p className="text-sm font-medium">{o.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{o.hint}</p>
              </button>
            ))}
          </div>
          <Button variant="destructive" className="w-full" disabled={pending} onClick={() => onConfirm(action)}>
            {pending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
