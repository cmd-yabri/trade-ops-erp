import { useState } from "react";
import { Link2, Loader2, Pencil, Unlink, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAccounts } from "@/hooks/useModules";
import { useCancelOpeningPay, useCorrectOpeningPayment, useLinkOpening, useOpening, usePayOpening, useUnlinkOpening } from "@/hooks/useHistory";
import { MoneyEntry, MoneyState, emptyMoney, toMoneyPayload, usdValue } from "@/components/MoneyEntry";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { formatDate, formatMoney, formatQty } from "@/lib/utils";
import { OpeningStockRow } from "@/types/history";
import { confirmMoneyAction } from "@/lib/confirmMoneyAction";

interface OpeningStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Stock entered with new products, without a supplier: paid from a cash box or old goods not paid.
 * Linking one to a supplier turns it into a received purchase order (a box payment moves with it).
 */
export function OpeningStockDialog({ open, onOpenChange }: OpeningStockDialogProps) {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { features } = useFeatures();
  const { data: rows = [], isLoading } = useOpening(open);
  const { data: accounts = [] } = useAccounts(features.accounts);
  const link = useLinkOpening();
  const unlink = useUnlinkOpening();
  const pay = usePayOpening();
  const correctPay = useCorrectOpeningPayment();
  const cancelPay = useCancelOpeningPay();
  const [paying, setPaying] = useState<OpeningStockRow | null>(null);
  const [money, setMoney] = useState<MoneyState>(emptyMoney());
  const [linking, setLinking] = useState<OpeningStockRow | null>(null);
  const [account, setAccount] = useState("");
  const [supplier, setSupplier] = useState("");
  const [phone, setPhone] = useState("");

  const suppliers = accounts.filter((a) => a.is_supplier && a.is_active);

  const startLink = (row: OpeningStockRow) => {
    setPaying(null);
    setLinking(row);
    setAccount("");
    setSupplier("");
    setPhone("");
  };

  const submit = async () => {
    if (!linking) return;
    if (!await confirmMoneyAction(
      linking.paid
        ? `ربط ${linking.product_name} بقيمة ${formatMoney(linking.value)} بالمورد؟ سينتقل الدفع المسجل إلى أمر الشراء.`
        : `ربط ${linking.product_name} بقيمة ${formatMoney(linking.value)} بالمورد؟ سيُسجّل المبلغ ديناً على المورد.`,
    )) return;
    try {
      const res = await link.mutateAsync({
        id: linking.id,
        data: account ? { account: Number(account) } : { supplier: supplier.trim(), supplier_phone: phone.trim() },
      });
      toast({ title: "تم الربط بالمورد", description: linking.paid ? `أُنشئ أمر الشراء PO-${res.purchase_order} وانتقل الدفع إلى المورد.` : `أُنشئ أمر الشراء PO-${res.purchase_order} وأصبح دَيناً للمورد.` });
      setLinking(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const startPay = (row: OpeningStockRow) => {
    setLinking(null);
    setPaying(row);
    setMoney(row.paid
      ? row.paid.currency === "SYP"
        ? { currency: "SYP", amount: String(row.paid.paid_amount ?? row.paid.cash_amount), rate: String(row.paid.exchange_rate ?? "") }
        : { currency: "USD", amount: String(Number(row.paid.amount)), rate: emptyMoney().rate }
      : { ...emptyMoney(), amount: String(Number(row.value)) });
  };

  const submitPay = async () => {
    if (!paying) return;
    const amount = money.currency === "USD"
      ? formatMoney(Number(money.amount))
      : `${Number(money.amount).toLocaleString("en-US")} ل.س (≈ ${formatMoney(usdValue(money))})`;
    if (!await confirmMoneyAction(
      paying.paid
        ? `تعديل الدفعة المسجلة لـ ${paying.product_name} إلى ${amount}؟ سيتغير رصيد الصندوق، دون تغيير كمية المخزون.`
        : `تسجيل دفع ${amount} مقابل الرصيد الافتتاحي لـ ${paying.product_name}؟`,
    )) return;
    try {
      if (paying.paid) {
        await correctPay.mutateAsync({ id: paying.id, data: toMoneyPayload(money) });
        toast({ title: "تم تعديل الدفعة", description: "تم تحديث حركة الصندوق مع بقاء كمية المخزون كما هي." });
      } else {
        await pay.mutateAsync({ id: paying.id, data: toMoneyPayload(money) });
        toast({ title: "تم تسجيل الدفع", description: "خرج المبلغ من الصندوق وظهر في المالية كشراء بضاعة." });
      }
      setPaying(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const undoPay = async (row: OpeningStockRow) => {
    if (!await confirmMoneyAction(`إلغاء دفع ${row.product_name}؟ سيعود المبلغ المسجل إلى الصندوق.`)) return;
    try {
      await cancelPay.mutateAsync(row.id);
      toast({ title: "تم إلغاء الدفع" });
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const paidLabel = (row: OpeningStockRow) =>
    row.paid
      ? row.paid.currency === "SYP"
        ? `${Number(row.paid.cash_amount).toLocaleString("en-US")} ل.س`
        : formatMoney(row.paid.amount)
      : "";

  const undo = async (row: OpeningStockRow) => {
    if (!await confirmMoneyAction(`إلغاء ربط الرصيد الافتتاحي بالمورد ${row.supplier}؟ سيُحذف أمر الشراء PO-${row.purchase_order}.`)) return;
    try {
      await unlink.mutateAsync(row.id);
      toast({ title: "تم إلغاء الربط" });
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>الرصيد الافتتاحي</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          الكميات التي أُدخلت مع المنتجات الجديدة بلا مورد: مدفوعة من الصندوق أو بضاعة قديمة بلا دفع. اربطها بمورد
          متى عرفته لتظهر في حسابه (ينتقل الدفع معها).
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6">جارٍ التحميل...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">لا يوجد رصيد افتتاحي.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm text-right">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">المنتج</th><th className="px-3">الكمية</th><th className="px-3">القيمة</th>
                  <th className="px-3">التاريخ</th><th className="px-3">الدفع</th><th className="px-3">المورد</th>
                  <th className="px-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">{r.product_name}</td>
                    <td className="px-3">{formatQty(r.quantity)}</td>
                    <td className="px-3">{formatMoney(r.value)}</td>
                    <td className="px-3 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="px-3 whitespace-nowrap">
                      {r.purchase_order ? (
                        <span className="inline-flex items-center gap-1">
                          من أمر الشراء
                          {r.paid && (
                            <>
                              <span>({paidLabel(r)})</span>
                              {isAdmin && (
                                <button type="button" title="تعديل الدفعة" className="text-primary" onClick={() => startPay(r)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}
                        </span>
                      ) : r.paid ? (
                        <span className="inline-flex items-center gap-1">
                          {paidLabel(r)}
                          {isAdmin && (
                            <>
                              <button type="button" title="تعديل الدفعة" className="text-primary" onClick={() => startPay(r)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" title="إلغاء الدفع" className="text-destructive" onClick={() => undoPay(r)}>
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </span>
                      ) : isAdmin ? (
                        <Button variant="ghost" size="sm" onClick={() => startPay(r)}>
                          <Wallet className="w-4 h-4 ml-1" /> دفع من الصندوق
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">غير مدفوع</span>
                      )}
                    </td>
                    <td className="px-3">
                      {r.purchase_order ? `${r.supplier} (PO-${r.purchase_order})` : <span className="text-muted-foreground">بدون مورد</span>}
                    </td>
                    <td className="px-3">
                      {r.purchase_order ? (
                        isAdmin && (
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => undo(r)}>
                            <Unlink className="w-4 h-4 ml-1" /> إلغاء الربط
                          </Button>
                        )
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => startLink(r)}>
                          <Link2 className="w-4 h-4 ml-1" /> ربط بمورد
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {paying && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <p className="text-sm font-medium">
              دفع ثمن {paying.product_name} × {formatQty(paying.quantity)} ({formatMoney(paying.value)}) من الصندوق
            </p>
            <MoneyEntry label="المبلغ المدفوع" value={money} onChange={setMoney} enabled={features.money_boxes} />
            <div className="flex gap-2">
              <Button variant="brand" disabled={pay.isPending || correctPay.isPending || usdValue(money) <= 0} onClick={submitPay}>
                {(pay.isPending || correctPay.isPending) && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                {paying.paid ? "حفظ تصحيح الدفعة" : "تسجيل الدفع"}
              </Button>
              <Button variant="ghost" onClick={() => setPaying(null)}>إلغاء</Button>
            </div>
          </div>
        )}

        {linking && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <p className="text-sm font-medium">
              ربط {linking.product_name} × {formatQty(linking.quantity)} ({formatMoney(linking.value)}) بمورد
            </p>
            {features.accounts && suppliers.length > 0 && (
              <div className="space-y-2">
                <Label>حساب المورد</Label>
                <SimpleSelect
                  value={account || "none"}
                  onChange={(v) => setAccount(v === "none" ? "" : v)}
                  options={[{ value: "none", label: "مورد بدون حساب (اكتب اسمه)" },
                    ...suppliers.map((a) => ({ value: String(a.id), label: a.name }))]}
                />
              </div>
            )}
            {!account && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>اسم المورد</Label>
                  <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>الهاتف (اختياري)</Label>
                  <Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="brand" disabled={link.isPending || (!account && !supplier.trim())} onClick={submit}>
                {link.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                ربط
              </Button>
              <Button variant="ghost" onClick={() => setLinking(null)}>إلغاء</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
