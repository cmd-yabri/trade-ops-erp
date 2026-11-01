import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { QuantityInput } from "@/components/QuantityInput";
import { useToast } from "@/hooks/use-toast";
import { useProducts } from "@/hooks/useInventory";
import { useCars, useTransferStock } from "@/hooks/useModules";
import { useFeatures } from "@/contexts/FeaturesContext";
import { getErrorMessage } from "@/lib/errors";
import { formatQty } from "@/lib/utils";

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** pre-selected ends, as "branch:ID" or "car:ID" */
  defaultFrom?: string;
  defaultTo?: string;
  defaultProduct?: number;
}

interface Line {
  product: string;
  quantity: number;
}

/** Move several products between branches and cars in one go. Total stock does not change. */
export function TransferDialog({ open, onOpenChange, defaultFrom, defaultTo, defaultProduct }: TransferDialogProps) {
  const { toast } = useToast();
  const { features, branches } = useFeatures();
  const { data: products = [] } = useProducts();
  const { data: cars = [] } = useCars(features.cars);
  const transfer = useTransferStock();

  const places = useMemo(
    () => [
      ...branches.filter((b) => b.is_active).map((b) => ({ value: `branch:${b.id}`, label: `فرع: ${b.name}` })),
      ...(features.cars
        ? cars.filter((c) => c.is_active).map((c) => ({ value: `car:${c.id}`, label: `سيارة: ${c.name}` }))
        : []),
    ],
    [branches, cars, features.cars],
  );
  const mainBranch = branches.find((b) => b.is_default);

  const [lines, setLines] = useState<Line[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setLines([{ product: defaultProduct ? String(defaultProduct) : "", quantity: 0 }]);
    setFrom(defaultFrom ?? (mainBranch ? `branch:${mainBranch.id}` : ""));
    setTo(defaultTo ?? "");
    setNote("");
  }, [open, defaultFrom, defaultTo, defaultProduct, mainBranch]);

  const productOf = (id: string) => products.find((p) => String(p.id) === id);
  const qtyAt = (id: string, placeValue: string) =>
    productOf(id)?.stock_by_location?.find((l) => `${l.kind}:${l.id}` === placeValue)?.quantity ?? 0;

  const setLine = (index: number, patch: Partial<Line>) =>
    setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const filled = lines.filter((l) => l.product && l.quantity > 0);
  const short = filled.filter((l) => l.quantity > qtyAt(l.product, from));
  const duplicate = new Set(filled.map((l) => l.product)).size !== filled.length;
  // products that have something at the source come first
  const options = [...products]
    .sort((a, b) => Number(qtyAt(String(b.id), from) > 0) - Number(qtyAt(String(a.id), from) > 0))
    .map((p) => ({
      value: String(p.id),
      label: `${p.name} (في المصدر ${formatQty(qtyAt(String(p.id), from))} ${p.unit || ""})`,
    }));

  const ends = (value: string) => {
    const [kind, id] = value.split(":");
    return kind === "car" ? { car: Number(id) } : { branch: Number(id) };
  };

  const submit = async () => {
    if (!from || !to || filled.length === 0) {
      toast({ title: "خطأ", description: "اختر المصدر والوجهة وأضف منتجاً بكمية.", variant: "destructive" });
      return;
    }
    if (from === to) {
      toast({ title: "خطأ", description: "المصدر والوجهة متطابقان.", variant: "destructive" });
      return;
    }
    if (duplicate) {
      toast({ title: "خطأ", description: "منتج مكرر في القائمة. اجمع كميته في سطر واحد.", variant: "destructive" });
      return;
    }
    if (short.length) {
      toast({
        title: "الكمية غير متوفرة",
        description: short.map((l) => `${productOf(l.product)?.name}: المتوفر ${formatQty(qtyAt(l.product, from))}`).join("، "),
        variant: "destructive",
      });
      return;
    }
    const a = ends(from);
    const b = ends(to);
    try {
      await transfer.mutateAsync({
        lines: filled.map((l) => ({ product: Number(l.product), quantity: l.quantity })),
        from_branch: a.branch ?? null,
        from_car: a.car ?? null,
        to_branch: b.branch ?? null,
        to_car: b.car ?? null,
        note,
      });
      toast({ title: "تم النقل", description: `${filled.length} منتج` });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل نقل البضاعة"), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>نقل بضاعة</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>من</Label>
              <SimpleSelect value={from} onChange={setFrom} placeholder="المصدر" options={places} />
            </div>
            <div className="space-y-2">
              <Label>إلى</Label>
              <SimpleSelect
                value={to}
                onChange={setTo}
                placeholder="الوجهة"
                options={places.filter((p) => p.value !== from)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>المنتجات</Label>
              <Button variant="outline" size="sm" onClick={() => setLines([...lines, { product: "", quantity: 0 }])}>
                <Plus className="w-4 h-4 ml-1" /> منتج آخر
              </Button>
            </div>
            {lines.map((line, index) => {
              const p = productOf(line.product);
              const here = line.product ? qtyAt(line.product, from) : 0;
              const there = line.product && to ? qtyAt(line.product, to) : 0;
              const tooMuch = line.quantity > here;
              return (
                <div key={index} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="grid grid-cols-[1fr_7rem_auto] gap-2 items-center">
                    <SimpleSelect
                      value={line.product}
                      onChange={(v) => setLine(index, { product: v })}
                      placeholder="اختر المنتج"
                      options={options}
                    />
                    <QuantityInput
                      allowDecimal={!!p?.allow_decimal}
                      value={line.quantity}
                      onChange={(n) => setLine(index, { quantity: n })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      disabled={lines.length === 1}
                      onClick={() => setLines(lines.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  {p && from && (
                    <div className="flex flex-wrap items-center gap-x-4 text-xs">
                      {tooMuch ? (
                        <span className="text-destructive">المتوفر في المصدر {formatQty(here)} {p.unit || ""} فقط.</span>
                      ) : (
                        <span className="text-muted-foreground">
                          بعد النقل: المصدر {formatQty(here - line.quantity)}
                          {to && ` · الوجهة ${formatQty(there + line.quantity)}`} {p.unit || ""}
                        </span>
                      )}
                      {here > 0 && line.quantity !== here && (
                        <button type="button" className="text-primary underline" onClick={() => setLine(index, { quantity: here })}>
                          كل المتوفر ({formatQty(here)})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label>ملاحظة (اختياري)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button
            variant="brand"
            className="w-full"
            onClick={submit}
            disabled={transfer.isPending || short.length > 0 || filled.length === 0}
          >
            {transfer.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
            نقل {filled.length > 1 ? `${filled.length} منتجات` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
