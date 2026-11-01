import { useMemo, useState } from "react";
import { BookUser, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { MoneyEntry, emptyMoney, toMoneyPayload, usdValue } from "@/components/MoneyEntry";
import { TablePagination } from "@/components/TablePagination";
import { WhatsappButton } from "@/components/WhatsappButton";
import { usePagination } from "@/hooks/usePagination";
import { useToast } from "@/hooks/use-toast";
import {
  useAccount,
  useAccountEntry,
  useAccountPayment,
  useAccounts,
  useDeleteAccount,
  useSaveAccount,
} from "@/hooks/useModules";
import { useCompany } from "@/hooks/useCompany";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useAuth } from "@/contexts/AuthContext";
import { getErrorMessage } from "@/lib/errors";
import { accountStatementMessage } from "@/lib/messages";
import { cn, formatDate, formatMoney, todayLocal } from "@/lib/utils";
import { Account } from "@/types/modules";
import { confirmMoneyAction } from "@/lib/confirmMoneyAction";

/** > 0 the account owes us (debtor), < 0 we owe the account (creditor). `short` drops the مدين/دائن word. */
function BalanceText({ value, className, short }: { value: number; className?: string; short?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className={cn("text-muted-foreground", className)}>مسدد</span>;
  return value > 0 ? (
    <span className={cn("text-amber-600 font-semibold", className)}>{short ? "" : "مدين: "}عليه {formatMoney(value)}</span>
  ) : (
    <span className={cn("text-blue-600 font-semibold", className)}>{short ? "" : "دائن: "}له {formatMoney(-value)}</span>
  );
}

const emptyForm = {
  name: "",
  phone: "",
  address: "",
  is_customer: true,
  is_supplier: false,
  notes: "",
  opening_balance: "",
  opening_side: "owes_us" as "owes_us" | "we_owe",
};

export default function Accounts() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { features, branchId } = useFeatures();
  const { data: company } = useCompany();
  const { data: accounts = [], isLoading } = useAccounts(features.accounts);
  const saveAccount = useSaveAccount();
  const deleteAccount = useDeleteAccount();
  const addPayment = useAccountPayment();
  const addEntry = useAccountEntry();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "debtor" | "creditor">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<number | null>(null);
  const { data: detail } = useAccount(detailId);
  const [payOpen, setPayOpen] = useState<"IN" | "OUT" | null>(null);
  const [money, setMoney] = useState(emptyMoney());
  const [payNote, setPayNote] = useState("");
  const [payDate, setPayDate] = useState(todayLocal());
  const [entryOpen, setEntryOpen] = useState(false);
  const [entry, setEntry] = useState({ kind: "DEBIT" as "DEBIT" | "CREDIT", amount: "", note: "" });

  const filtered = useMemo(
    () =>
      accounts.filter((a) => {
        if (search && !`${a.name} ${a.phone}`.toLowerCase().includes(search.toLowerCase())) return false;
        if (filter === "debtor") return a.balance > 0.005;
        if (filter === "creditor") return a.balance < -0.005;
        return true;
      }),
    [accounts, search, filter],
  );
  const pager = usePagination(filtered, 10, `${search}|${filter}`);
  const totalOwedToUs = accounts.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const totalWeOwe = accounts.filter((a) => a.balance < 0).reduce((s, a) => s - a.balance, 0);

  if (!features.accounts) {
    return <p className="text-muted-foreground">ميزة حسابات الجملة غير مفعّلة. فعّلها من الإعدادات.</p>;
  }

  const openForm = (account: Account | null) => {
    setEditing(account);
    setForm(
      account
        ? { ...emptyForm, name: account.name, phone: account.phone, address: account.address,
            is_customer: account.is_customer, is_supplier: account.is_supplier, notes: account.notes }
        : emptyForm,
    );
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "خطأ", description: "اسم الحساب مطلوب.", variant: "destructive" });
      return;
    }
    const { opening_balance, opening_side, ...rest } = form;
    const opening =
      !editing && opening_balance
        ? { opening_balance: (opening_side === "owes_us" ? 1 : -1) * parseFloat(opening_balance) + "" }
        : {};
    if (opening_balance && parseFloat(opening_balance) > 0 && !await confirmMoneyAction(
      `إنشاء الحساب ${form.name.trim()} برصيد افتتاحي ${formatMoney(parseFloat(opening_balance))} (${opening_side === "owes_us" ? "مستحق لنا" : "مستحق علينا"})؟`,
    )) return;
    try {
      await saveAccount.mutateAsync({ id: editing?.id, data: { ...rest, ...opening } });
      toast({ title: editing ? "تم التحديث" : "تمت إضافة الحساب" });
      setFormOpen(false);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحفظ"), variant: "destructive" });
    }
  };

  const handleDelete = async (account: Account) => {
    if (!await confirmMoneyAction(`حذف الحساب «${account.name}»؟ قد يؤثر ذلك على أرصدة المعاملات المرتبطة به.`)) return;
    try {
      await deleteAccount.mutateAsync(account.id);
      toast({ title: "تم الحذف" });
      setDetailId(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحذف"), variant: "destructive" });
    }
  };

  const handlePayment = async () => {
    if (!detailId || !payOpen) return;
    const amount = money.currency === "USD"
      ? formatMoney(usdValue(money))
      : `${Number(money.amount).toLocaleString("en-US")} ل.س (≈ ${formatMoney(usdValue(money))})`;
    if (!await confirmMoneyAction(
      `تسجيل دفعة ${payOpen === "IN" ? "واردة من" : "صادرة إلى"} ${detail?.name ?? "الحساب"} بقيمة ${amount}${payNote.trim() ? `\nالبيان: ${payNote.trim()}` : ""}؟`,
    )) return;
    try {
      await addPayment.mutateAsync({
        id: detailId,
        // the money lands in the box of the branch picked in the header
        data: { direction: payOpen, note: payNote, date: payDate, ...toMoneyPayload(money), ...(branchId ? { branch: branchId } : {}) },
      });
      toast({ title: "تم تسجيل الدفعة", description: "وُزّعت على أقدم الفواتير غير المسددة." });
      setPayOpen(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل تسجيل الدفعة"), variant: "destructive" });
    }
  };

  const handleEntry = async () => {
    if (!detailId) return;
    const detailAmount = Number(entry.amount);
    if (!await confirmMoneyAction(
      `تسجيل قيد ${entry.kind === "DEBIT" ? "مدين" : "دائن"} على ${detail?.name ?? "الحساب"} بقيمة ${formatMoney(detailAmount)}${entry.note.trim() ? `\nالبيان: ${entry.note.trim()}` : ""}؟`,
    )) return;
    try {
      await addEntry.mutateAsync({ id: detailId, data: entry });
      toast({ title: "تم تسجيل القيد" });
      setEntryOpen(false);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل التسجيل"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">حسابات الجملة</h1>
          <p className="text-muted-foreground mt-1">عملاء الجملة والموردون: ما دفعوا وما بقي عليهم</p>
        </div>
        <Button variant="brand" onClick={() => openForm(null)}>
          <Plus className="w-4 h-4 ml-2" /> حساب جديد
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-sm text-muted-foreground">مستحق لنا عند المدينين</p>
          <p className="text-2xl font-bold text-amber-600">{formatMoney(totalOwedToUs)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-sm text-muted-foreground">مستحق علينا للدائنين</p>
          <p className="text-2xl font-bold text-blue-600">{formatMoney(totalWeOwe)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pr-10" placeholder="بحث بالاسم أو الهاتف..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          {([["all", "الكل"], ["debtor", "المدينون"], ["creditor", "الدائنون"]] as const).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilter(v)}
              className={cn("px-4 py-2", filter === v ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-sm font-medium">الحساب</th>
                <th className="px-4 py-3 text-sm font-medium">النوع</th>
                <th className="px-4 py-3 text-sm font-medium">الهاتف</th>
                <th className="px-4 py-3 text-sm font-medium">بعناه</th>
                <th className="px-4 py-3 text-sm font-medium">قبضنا منه</th>
                <th className="px-4 py-3 text-sm font-medium">اشترينا منه</th>
                <th className="px-4 py-3 text-sm font-medium">دفعنا له</th>
                <th className="px-4 py-3 text-sm font-medium">الرصيد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">جارٍ التحميل...</td></tr>
              ) : pager.pageItems.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">لا توجد حسابات.</td></tr>
              ) : (
                pager.pageItems.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setDetailId(a.id)}>
                    <td className="px-4 py-3 text-sm font-medium">
                      {a.name} {!a.is_active && <Badge variant="outline" className="mr-2">معطّل</Badge>}
                    </td>
                    <td className="px-4 py-3 text-sm space-x-1 space-x-reverse">
                      {a.is_customer && <Badge variant="secondary">عميل جملة</Badge>}
                      {a.is_supplier && <Badge variant="outline">مورد</Badge>}
                    </td>
                    <td className="px-4 py-3 text-sm" dir="ltr">{a.phone || "—"}</td>
                    <td className="px-4 py-3 text-sm">{formatMoney(a.total_sales)}</td>
                    <td className="px-4 py-3 text-sm text-emerald-700">{formatMoney(a.total_received)}</td>
                    <td className="px-4 py-3 text-sm">{formatMoney(a.total_purchases)}</td>
                    <td className="px-4 py-3 text-sm text-emerald-700">{formatMoney(a.total_paid)}</td>
                    <td className="px-4 py-3 text-sm"><BalanceText value={a.balance} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <TablePagination pager={pager} />

      {/* Add / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل الحساب" : "حساب جديد"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>الاسم</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>الهاتف</Label>
                <Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>العنوان</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-6 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="h-4 w-4" checked={form.is_customer} onChange={(e) => setForm({ ...form, is_customer: e.target.checked })} />
                عميل جملة (نبيعه)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="h-4 w-4" checked={form.is_supplier} onChange={(e) => setForm({ ...form, is_supplier: e.target.checked })} />
                مورد (نشتري منه)
              </label>
            </div>
            {!editing && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>رصيد افتتاحي (اختياري)</Label>
                  <Input type="number" min="0" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>الرصيد</Label>
                  <SimpleSelect
                    value={form.opening_side}
                    onChange={(v) => setForm({ ...form, opening_side: v as "owes_us" | "we_owe" })}
                    options={[{ value: "owes_us", label: "عليه (مدين)" }, { value: "we_owe", label: "له (دائن)" }]}
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button variant="brand" className="w-full" onClick={handleSave} disabled={saveAccount.isPending}>
              {saveAccount.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              حفظ
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Statement */}
      <Dialog open={detailId !== null} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookUser className="w-5 h-5" /> {detail?.name ?? "..."}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 py-2">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-muted rounded-lg p-4">
                <div>
                  <p className="text-xs text-muted-foreground">الرصيد الحالي</p>
                  <BalanceText value={detail.balance} className="text-xl" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.is_customer && (
                    <Button size="sm" variant="brand" onClick={() => { setMoney(emptyMoney()); setPayNote(""); setPayDate(todayLocal()); setPayOpen("IN"); }}>
                      استلام دفعة
                    </Button>
                  )}
                  {detail.is_supplier && (
                    <Button size="sm" variant="outline" onClick={() => { setMoney(emptyMoney()); setPayNote(""); setPayDate(todayLocal()); setPayOpen("OUT"); }}>
                      دفع للمورد
                    </Button>
                  )}
                  {isAdmin && (
                    <Button size="sm" variant="outline" onClick={() => { setEntry({ kind: "DEBIT", amount: "", note: "" }); setEntryOpen(true); }}>
                      قيد يدوي
                    </Button>
                  )}
                  <WhatsappButton phone={detail.phone} label="كشف حساب" message={() => accountStatementMessage(detail, company?.name)} />
                  <Button size="sm" variant="outline" onClick={() => openForm(detail)}>تعديل</Button>
                  {isAdmin && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(detail)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                {detail.is_customer && (
                  <>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">بعناه</p>
                      <p className="font-semibold">{formatMoney(detail.total_sales)}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">قبضنا منه</p>
                      <p className="font-semibold text-emerald-700">{formatMoney(detail.total_received)}</p>
                    </div>
                  </>
                )}
                {detail.is_supplier && (
                  <>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">اشترينا منه</p>
                      <p className="font-semibold">{formatMoney(detail.total_purchases)}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">دفعنا له</p>
                      <p className="font-semibold text-emerald-700">{formatMoney(detail.total_paid)}</p>
                    </div>
                  </>
                )}
              </div>

              {detail.open_orders.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">فواتير غير مسددة</h3>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm text-right">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">الفاتورة</th><th className="px-3">التاريخ</th><th className="px-3">الحالة</th>
                          <th className="px-3">الإجمالي</th><th className="px-3">المدفوع</th><th className="px-3">المتبقي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.open_orders.map((o) => (
                          <tr key={o.ref} className="border-t border-border">
                            <td className="px-3 py-2 font-medium" dir="ltr">{o.ref}</td>
                            <td className="px-3 whitespace-nowrap">{formatDate(o.date)}</td>
                            <td className="px-3 text-muted-foreground">{o.kind === "sale" ? "بيع" : "شراء"} - {o.state}</td>
                            <td className="px-3">{formatMoney(o.total)}</td>
                            <td className="px-3 text-emerald-700">{formatMoney(o.paid)}</td>
                            <td className="px-3 font-semibold text-destructive">{formatMoney(o.remaining)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold mb-2">كشف الحساب</h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm text-right">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">التاريخ</th><th className="px-3">البيان</th>
                        <th className="px-3" title="يزيد ما عليه لنا / يقلل ما له عندنا">مدين</th>
                        <th className="px-3" title="يزيد ما له عندنا / يقلل ما عليه لنا">دائن</th>
                        <th className="px-3">الرصيد بعد الحركة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.statement.length === 0 ? (
                        <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">لا توجد حركات.</td></tr>
                      ) : (
                        detail.statement.map((l) => (
                          <tr key={l.ref} className="border-t border-border align-top">
                            <td className="px-3 py-2 whitespace-nowrap">{formatDate(l.date)}</td>
                            <td className="px-3 py-2">{l.description}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{l.debit > 0 ? formatMoney(l.debit) : ""}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{l.credit > 0 ? formatMoney(l.credit) : ""}</td>
                            <td className="px-3 py-2 whitespace-nowrap"><BalanceText value={l.balance} short /></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {detail.statement.length > 0 && (
                      <tfoot className="bg-muted/50 font-semibold">
                        <tr className="border-t border-border">
                          <td className="px-3 py-2" colSpan={2}>المجموع</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatMoney(detail.statement.reduce((s, l) => s + Number(l.debit), 0))}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatMoney(detail.statement.reduce((s, l) => s + Number(l.credit), 0))}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap"><BalanceText value={detail.balance} short /></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Lump-sum payment */}
      <Dialog open={payOpen !== null} onOpenChange={(v) => !v && setPayOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{payOpen === "IN" ? "استلام دفعة من" : "دفع إلى"} {detail?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              تُوزَّع الدفعة تلقائياً على أقدم الفواتير غير المسددة، وما زاد يبقى رصيداً في الحساب.
            </p>
            {detail && (
              <p className="text-sm">
                الرصيد الحالي: <BalanceText value={detail.balance} />
              </p>
            )}
            <MoneyEntry enabled={features.money_boxes} value={money} onChange={setMoney} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>التاريخ</Label>
                <Input type="date" value={payDate} max={todayLocal()} onChange={(e) => setPayDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>ملاحظة</Label>
                <Input value={payNote} onChange={(e) => setPayNote(e.target.value)} />
              </div>
            </div>
            <Button variant="brand" className="w-full" onClick={handlePayment} disabled={addPayment.isPending || usdValue(money) <= 0}>
              {addPayment.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              تأكيد
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual entry */}
      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>قيد يدوي</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <SimpleSelect
              value={entry.kind}
              onChange={(v) => setEntry({ ...entry, kind: v as "DEBIT" | "CREDIT" })}
              options={[{ value: "DEBIT", label: "مدين: يزيد ما عليه (يدين لنا)" }, { value: "CREDIT", label: "دائن: يقلل ما عليه (له عندنا)" }]}
            />
            <div className="space-y-2">
              <Label>المبلغ ($)</Label>
              <Input type="number" min="0" step="0.01" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>البيان</Label>
              <Input value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} />
            </div>
            <Button variant="brand" className="w-full" onClick={handleEntry} disabled={addEntry.isPending || !(parseFloat(entry.amount) > 0)}>
              {addEntry.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              تسجيل
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
