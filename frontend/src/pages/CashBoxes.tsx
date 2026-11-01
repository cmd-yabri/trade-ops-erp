import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, Loader2, Pencil, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useBoxEntry, useBoxStatement, useBoxes, useEditBoxMovement, useExchange, useExchanges } from "@/hooks/useModules";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useAuth } from "@/contexts/AuthContext";
import { getErrorMessage } from "@/lib/errors";
import { cn, formatDate, formatMoney, round2 } from "@/lib/utils";
import { lastRate } from "@/components/MoneyEntry";
import { BoxMovement, Currency } from "@/types/modules";
import { confirmMoneyAction } from "@/lib/confirmMoneyAction";

const FLAG: Record<Currency, string> = { USD: "$", SYP: "ل.س" };

export default function CashBoxes() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { features } = useFeatures();
  const enabled = features.money_boxes && isAdmin;
  const { data: boxes = [] } = useBoxes(enabled);
  const { data: swaps = [] } = useExchanges(enabled);
  const addEntry = useBoxEntry();
  const editMovement = useEditBoxMovement();
  const exchange = useExchange();

  const [view, setView] = useState<Currency>("USD");
  const { data: statement = [] } = useBoxStatement(view, enabled);

  const [entry, setEntry] = useState<{ currency: Currency; kind: "DEPOSIT" | "WITHDRAWAL" } | null>(null);
  const [entryAmount, setEntryAmount] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [editingMovement, setEditingMovement] = useState<BoxMovement | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editRate, setEditRate] = useState("");

  const [swapOpen, setSwapOpen] = useState(false);
  const [swapFrom, setSwapFrom] = useState<Currency>("SYP");
  const [swapAmount, setSwapAmount] = useState("");
  const [swapRate, setSwapRate] = useState("");

  if (!features.money_boxes) {
    return <p className="text-muted-foreground">ميزة الصناديق غير مفعّلة. فعّلها من الإعدادات.</p>;
  }
  if (!isAdmin) {
    return <p className="text-muted-foreground">هذه الصفحة للمدير فقط.</p>;
  }

  const balanceOf = (c: Currency) => boxes.find((b) => b.currency === c)?.balance ?? 0;
  const swapTo: Currency = swapFrom === "SYP" ? "USD" : "SYP";
  const amountNum = parseFloat(swapAmount);
  const rateNum = parseFloat(swapRate);
  const swapResult =
    Number.isFinite(amountNum) && Number.isFinite(rateNum) && amountNum > 0 && rateNum > 0
      ? round2(swapFrom === "SYP" ? amountNum / rateNum : amountNum * rateNum)
      : 0;

  const openSwap = (from: Currency) => {
    setSwapFrom(from);
    setSwapAmount("");
    setSwapRate(lastRate());
    setSwapOpen(true);
  };

  const handleSwap = async () => {
    if (!await confirmMoneyAction(
      `تحويل ${formatMoney(amountNum, swapFrom)} من صندوق ${swapFrom === "USD" ? "الدولار" : "الليرة"} إلى ${formatMoney(swapResult, swapTo)} بسعر ${swapRate} ل.س لكل دولار؟`,
    )) return;
    try {
      const res = await exchange.mutateAsync({ from_currency: swapFrom, from_amount: swapAmount, rate: swapRate });
      try {
        localStorage.setItem("last_syp_rate", swapRate);
      } catch {
        /* ignore */
      }
      toast({ title: "تم التحويل", description: `تمت إضافة ${formatMoney(res.to_amount, res.to_currency)} إلى صندوق ${res.to_currency === "USD" ? "الدولار" : "الليرة"}` });
      setSwapOpen(false);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل التحويل"), variant: "destructive" });
    }
  };

  const handleEntry = async () => {
    if (!entry) return;
    if (!await confirmMoneyAction(
      `${entry.kind === "DEPOSIT" ? "إيداع" : "سحب"} ${formatMoney(parseFloat(entryAmount), entry.currency)}${entryNote.trim() ? `\nالبيان: ${entryNote.trim()}` : ""}`,
    )) return;
    try {
      await addEntry.mutateAsync({ currency: entry.currency, kind: entry.kind, amount: entryAmount, note: entryNote });
      toast({ title: entry.kind === "DEPOSIT" ? "تم الإيداع" : "تم السحب" });
      setEntry(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشلت العملية"), variant: "destructive" });
    }
  };

  const openMovementEdit = (movement: BoxMovement) => {
    setEditingMovement(movement);
    setEditAmount(Number(movement.edit_amount ?? Math.abs(movement.amount)).toFixed(2));
    setEditDate(movement.date);
    setEditNote(movement.edit_note || "");
    setEditRate(movement.edit_rate ? String(movement.edit_rate) : lastRate());
  };

  const handleMovementEdit = async () => {
    if (!editingMovement) return;
    const amount = Number(editAmount);
    const rate = Number(editRate);
    if (!Number.isFinite(amount) || amount <= 0 || (view === "SYP" && (!Number.isFinite(rate) || rate <= 0))) return;
    const before = formatMoney(Math.abs(editingMovement.amount), view);
    const after = formatMoney(amount, view);
    if (!await confirmMoneyAction(
      `تعديل حركة الصندوق؟\nمن ${before} إلى ${after}\nالتاريخ: ${formatDate(editDate)}`,
    )) return;
    try {
      await editMovement.mutateAsync({
        ref: editingMovement.ref,
        currency: view,
        amount: editAmount,
        date: editDate,
        note: editNote,
        rate: view === "SYP" ? editRate : undefined,
      });
      toast({ title: "تم تعديل حركة الصندوق" });
      setEditingMovement(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل تعديل الحركة"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">الصناديق</h1>
          <p className="text-muted-foreground mt-1">صندوق الدولار وصندوق الليرة السورية منفصلان</p>
        </div>
        <Button variant="brand" onClick={() => openSwap("SYP")}>
          <ArrowLeftRight className="w-4 h-4 ml-2" /> تحويل بين الصندوقين
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {(["USD", "SYP"] as Currency[]).map((c) => {
          const box = boxes.find((b) => b.currency === c);
          return (
            <div
              key={c}
              className={cn(
                "rounded-xl p-6 border cursor-pointer transition-colors",
                view === c ? "border-primary bg-accent/40" : "border-border bg-card",
              )}
              onClick={() => setView(c)}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 rounded-xl bg-accent text-accent-foreground">
                  <Wallet className="w-5 h-5" />
                </div>
                <p className="font-semibold">{box?.name ?? (c === "USD" ? "صندوق الدولار" : "صندوق الليرة السورية")}</p>
              </div>
              <p className={cn("text-3xl font-bold", (box?.balance ?? 0) < 0 && "text-destructive")}>
                {formatMoney(box?.balance ?? 0, c)}
              </p>
              <div className="mt-3 grid grid-cols-2 text-sm text-muted-foreground">
                <span>الوارد: {formatMoney(box?.total_in ?? 0, c)}</span>
                <span>الصادر: {formatMoney(box?.total_out ?? 0, c)}</span>
              </div>
              <div className="flex flex-wrap gap-2 mt-4" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="outline" onClick={() => { setEntry({ currency: c, kind: "DEPOSIT" }); setEntryAmount(""); setEntryNote(""); }}>
                  <ArrowDownCircle className="w-4 h-4 ml-1" /> إيداع
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setEntry({ currency: c, kind: "WITHDRAWAL" }); setEntryAmount(""); setEntryNote(""); }}>
                  <ArrowUpCircle className="w-4 h-4 ml-1" /> سحب
                </Button>
                <Button size="sm" variant="outline" onClick={() => openSwap(c)}>
                  <ArrowLeftRight className="w-4 h-4 ml-1" /> تحويل إلى {c === "USD" ? "الليرة" : "الدولار"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {(balanceOf("USD") < 0 || balanceOf("SYP") < 0) && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          رصيد أحد الصناديق سالب: أضف إيداعاً بالرصيد الافتتاحي لتصبح الأرقام مطابقة للواقع.
        </p>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border font-semibold">
          كشف حساب {view === "USD" ? "صندوق الدولار" : "صندوق الليرة"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 font-medium">التاريخ</th>
                <th className="px-4 py-2 font-medium">البيان</th>
                <th className="px-4 py-2 font-medium">وارد</th>
                <th className="px-4 py-2 font-medium">صادر</th>
                <th className="px-4 py-2 font-medium">الرصيد</th>
                <th className="px-4 py-2 font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {statement.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">لا توجد حركات.</td></tr>
              ) : (
                statement.slice(0, 100).map((m) => (
                  <tr key={m.ref + m.kind}>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(m.date)}</td>
                    <td className="px-4 py-2">{m.description}</td>
                    <td className="px-4 py-2 text-green-600">{m.amount > 0 ? formatMoney(m.amount, view) : ""}</td>
                    <td className="px-4 py-2 text-destructive">{m.amount < 0 ? formatMoney(-m.amount, view) : ""}</td>
                    <td className="px-4 py-2 font-medium">{formatMoney(m.balance, view)}</td>
                    <td className="px-4 py-2">
                      {m.editable && (
                        <Button variant="ghost" size="sm" onClick={() => openMovementEdit(m)} aria-label="تعديل الحركة">
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {swaps.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold mb-3">آخر التحويلات بين الصناديق</h3>
          <ul className="text-sm space-y-1 text-muted-foreground">
            {swaps.slice(0, 5).map((s) => (
              <li key={s.id}>
                {formatDate(s.date)}: {formatMoney(s.from_amount, s.from_currency)} ← {formatMoney(s.to_amount, s.to_currency)} (سعر {Number(s.rate).toLocaleString("en-US")})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Deposit / withdraw */}
      <Dialog open={entry !== null} onOpenChange={(v) => !v && setEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {entry?.kind === "DEPOSIT" ? "إيداع في" : "سحب من"} {entry?.currency === "USD" ? "صندوق الدولار" : "صندوق الليرة"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>المبلغ ({entry ? FLAG[entry.currency] : ""})</Label>
              <Input type="number" min="0" step="0.01" value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>البيان (مثال: رصيد افتتاحي)</Label>
              <Input value={entryNote} onChange={(e) => setEntryNote(e.target.value)} />
            </div>
            <Button variant="brand" className="w-full" onClick={handleEntry} disabled={addEntry.isPending || !(parseFloat(entryAmount) > 0)}>
              {addEntry.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              تأكيد
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editingMovement !== null} onOpenChange={(open) => !open && setEditingMovement(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل حركة الصندوق</DialogTitle>
            <DialogDescription>سيُحدّث هذا التعديل السجل المالي المرتبط بالحركة ورصيد الصندوق.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">{editingMovement?.description}</p>
            <div className="space-y-2">
              <Label>المبلغ ({FLAG[view]})</Label>
              <Input type="number" min="0.01" step="0.01" value={editAmount}
                onChange={(event) => setEditAmount(event.target.value)} />
            </div>
            {view === "SYP" && (
              <div className="space-y-2">
                <Label>سعر الصرف (ل.س لكل 1$)</Label>
                <Input type="number" min="0.0001" step="0.01" value={editRate}
                  onChange={(event) => setEditRate(event.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label>التاريخ</Label>
              <Input type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} />
            </div>
            {editingMovement && !["sale_payment", "supplier_payment"].includes(editingMovement.kind) && (
              <div className="space-y-2">
                <Label>البيان</Label>
                <Input value={editNote} onChange={(event) => setEditNote(event.target.value)} maxLength={300} />
              </div>
            )}
            <Button variant="brand" className="w-full" onClick={handleMovementEdit}
              disabled={editMovement.isPending || !(Number(editAmount) > 0) || !editDate ||
                (view === "SYP" && !(Number(editRate) > 0))}>
              {editMovement.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              حفظ التعديل
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Exchange popup: amount + typed rate, the switch happens automatically */}
      <Dialog open={swapOpen} onOpenChange={setSwapOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تحويل بين الصندوقين</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
              {(["SYP", "USD"] as Currency[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSwapFrom(c)}
                  className={cn("px-4 py-1.5", swapFrom === c ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}
                >
                  من {c === "SYP" ? "الليرة إلى الدولار" : "الدولار إلى الليرة"}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              الرصيد المتاح: {formatMoney(balanceOf(swapFrom), swapFrom)}
            </p>
            <div className="space-y-2">
              <Label>المبلغ بـ {swapFrom === "SYP" ? "الليرة السورية" : "الدولار"}</Label>
              <Input type="number" min="0" step="0.01" value={swapAmount} onChange={(e) => setSwapAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>سعر الصرف (ليرة لكل 1 دولار)</Label>
              <Input type="number" min="0" step="0.01" placeholder="مثال: 15000" value={swapRate} onChange={(e) => setSwapRate(e.target.value)} />
            </div>
            <div className="bg-muted rounded-lg p-3 text-sm flex justify-between">
              <span>سيُضاف إلى صندوق {swapTo === "USD" ? "الدولار" : "الليرة"}:</span>
              <span className="font-bold">{swapResult > 0 ? formatMoney(swapResult, swapTo) : "—"}</span>
            </div>
            <Button
              variant="brand"
              className="w-full"
              onClick={handleSwap}
              disabled={exchange.isPending || swapResult <= 0 || amountNum > balanceOf(swapFrom)}
            >
              {exchange.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              تحويل
            </Button>
            {amountNum > balanceOf(swapFrom) && (
              <p className="text-xs text-destructive">المبلغ أكبر من رصيد الصندوق.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
