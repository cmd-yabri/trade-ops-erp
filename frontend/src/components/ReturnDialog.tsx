import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuantityInput } from "@/components/QuantityInput";
import { SimpleSelect } from "@/components/SimpleSelect";
import { lastRate } from "@/components/MoneyEntry";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useCars } from "@/hooks/useModules";
import { cn, formatMoney, formatQty, round2, todayLocal } from "@/lib/utils";
import { MoneyAction, ReturnRequest } from "@/types/history";
import { confirmMoneyAction } from "@/lib/confirmMoneyAction";

export interface ReturnLineOption {
  id: number;
  product_name: string;
  /** how much can still be returned */
  max: number;
  allowDecimal: boolean;
  /** money value of one unit (price after the order's discount share) */
  unitValue: number;
  /** where it goes back to / leaves from by default, "branch:ID" or "car:ID" */
  place: string;
}

interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "sale" | "purchase";
  title: string;
  lines: ReturnLineOption[];
  /** money paid on the order so far, and what it is worth now (before this return) */
  paid: number;
  worth: number;
  accountName?: string;
  pending: boolean;
  onSubmit: (data: ReturnRequest) => void;
}

/**
 * A customer bringing goods back (kind "sale") or goods sent back to the supplier ("purchase").
 * When the money paid is more than what the order is worth after the return, the user says
 * where the difference goes: handed back in cash, or kept as credit on the account.
 */
export function ReturnDialog({
  open, onOpenChange, kind, title, lines, paid, worth, accountName, pending, onSubmit,
}: ReturnDialogProps) {
  const { features, branches } = useFeatures();
  const { data: cars = [] } = useCars(features.cars);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [places, setPlaces] = useState<Record<number, string>>({});
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [action, setAction] = useState<MoneyAction>("refund");
  const [currency, setCurrency] = useState<"USD" | "SYP">("USD");
  const [rate, setRate] = useState(lastRate());

  useEffect(() => {
    if (!open) return;
    setQty({});
    setPlaces(Object.fromEntries(lines.map((l) => [l.id, l.place])));
    setDate(todayLocal());
    setNote("");
    setAction(accountName ? "credit" : "refund");
    setCurrency("USD");
  }, [open, lines, accountName]);

  const placeOptions = useMemo(
    () => [
      ...branches.filter((b) => b.is_active).map((b) => ({ value: `branch:${b.id}`, label: `فرع: ${b.name}` })),
      ...(features.cars ? cars.filter((c) => c.is_active).map((c) => ({ value: `car:${c.id}`, label: `سيارة: ${c.name}` })) : []),
    ],
    [branches, cars, features.cars],
  );

  const value = round2(lines.reduce((s, l) => s + (qty[l.id] || 0) * l.unitValue, 0));
  const excess = Math.max(round2(paid - (worth - value)), 0);
  const chosen = lines.filter((l) => (qty[l.id] || 0) > 0);

  const submit = async () => {
    if (chosen.length === 0) return;
    const refund = excess > 0 && action === "refund"
      ? currency === "SYP"
        ? `${Math.round(excess * Number(rate)).toLocaleString("en-US")} ل.س (≈ ${formatMoney(excess)})`
        : formatMoney(excess)
      : `${formatMoney(excess)} رصيد دائن`;
    if (!await confirmMoneyAction(
      `${sale ? "تسجيل مرتجع من العميل" : "تسجيل مرتجع إلى المورد"} بقيمة ${formatMoney(value)}؟${excess > 0 ? `\nالمبلغ الزائد: ${refund}.` : ""}`,
    )) return;
    onSubmit({
      lines: chosen.map((l) => {
        const [k, id] = (places[l.id] || "").split(":");
        return {
          item: l.id,
          quantity: qty[l.id],
          branch: k === "branch" ? Number(id) : null,
          car: k === "car" ? Number(id) : null,
        };
      }),
      date,
      note,
      ...(excess > 0 ? { money_action: action, currency, ...(currency === "SYP" ? { exchange_rate: rate } : {}) } : {}),
    });
  };

  const sale = kind === "sale";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {sale
              ? "أدخل الكمية التي أعادها العميل ومكان إرجاعها. تعود البضاعة للمخزون وينقص الإيراد والربح بقيمتها."
              : "أدخل الكمية المعادة للمورد والمكان الذي تخرج منه. ينقص ما ندين به للمورد بقيمتها."}
          </p>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="grid grid-cols-[1fr_7rem] gap-3 items-center">
                  <div>
                    <p className="text-sm font-medium">{l.product_name}</p>
                    <p className="text-xs text-muted-foreground">
                      يمكن إرجاع {formatQty(l.max)} · قيمة الوحدة {formatMoney(l.unitValue)}
                    </p>
                  </div>
                  <QuantityInput
                    allowDecimal={l.allowDecimal}
                    value={qty[l.id] ?? 0}
                    onChange={(n) => setQty({ ...qty, [l.id]: Math.min(n, l.max) })}
                  />
                </div>
                {placeOptions.length > 1 && (qty[l.id] || 0) > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground whitespace-nowrap">{sale ? "تعود إلى" : "تخرج من"}</span>
                    <SimpleSelect
                      value={places[l.id] || ""}
                      onChange={(v) => setPlaces({ ...places, [l.id]: v })}
                      options={placeOptions}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>التاريخ</Label>
              <Input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>ملاحظة</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span>قيمة المرتجع:</span>
              <span className="font-semibold">{formatMoney(value)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>قيمة الطلب بعد المرتجع:</span>
              <span>{formatMoney(round2(worth - value))}</span>
            </div>
            {excess > 0 && (
              <div className="flex justify-between font-semibold text-amber-700">
                <span>{sale ? "دفع العميل زيادة:" : "دفعنا للمورد زيادة:"}</span>
                <span>{formatMoney(excess)}</span>
              </div>
            )}
          </div>
          {excess > 0 && (
            <div className="space-y-2">
              <Label>ماذا نفعل بالمبلغ الزائد؟</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["refund", sale ? "نعيده للعميل نقداً" : "نسترده من المورد نقداً", sale ? "يخرج من الصندوق" : "يدخل الصندوق", false],
                  ["credit", sale ? "يبقى رصيداً للعميل" : "يبقى رصيداً لنا عند المورد",
                    accountName ? `في حساب «${accountName}»` : "غير متاح: الطلب بلا حساب", !accountName],
                ] as const).map(([v, label, hint, disabled]) => (
                  <button
                    key={v}
                    type="button"
                    disabled={disabled}
                    onClick={() => setAction(v)}
                    className={cn("rounded-lg border p-3 text-right", action === v ? "border-primary bg-primary/5" : "border-border",
                      disabled && "opacity-50 cursor-not-allowed")}
                  >
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{hint}</p>
                  </button>
                ))}
              </div>
              {action === "refund" && features.money_boxes && (
                <div className="grid grid-cols-2 gap-3">
                  <SimpleSelect
                    value={currency}
                    onChange={(v) => setCurrency(v as "USD" | "SYP")}
                    options={[{ value: "USD", label: "بالدولار" }, { value: "SYP", label: "بالليرة السورية" }]}
                  />
                  {currency === "SYP" && (
                    <Input type="number" placeholder="سعر الصرف (ليرة للدولار)" value={rate} onChange={(e) => setRate(e.target.value)} />
                  )}
                </div>
              )}
              {action === "refund" && currency === "SYP" && Number(rate) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {formatMoney(Math.round(excess * Number(rate) * 100) / 100, "SYP")}
                </p>
              )}
            </div>
          )}
          <Button variant="brand" className="w-full" disabled={pending || chosen.length === 0} onClick={submit}>
            {pending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
            تسجيل المرتجع
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
