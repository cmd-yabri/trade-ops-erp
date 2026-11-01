import { useState } from "react";
import { Loader2, Lock, Pencil, Plus, Trash2, Undo2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoneyEntry, emptyMoney, toMoneyPayload, usdValue } from "@/components/MoneyEntry";
import { useToast } from "@/hooks/use-toast";
import {
  useDeletePartner,
  useDeletePriorProfit,
  useDeleteWithdrawal,
  usePartner,
  usePartners,
  useProfitOpening,
  useSavePartner,
  useSavePriorProfit,
  useSaveProfitOpening,
  useSettle,
  useSettlements,
  useUndoSettlement,
  useWithdrawal,
} from "@/hooks/useModules";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useAuth } from "@/contexts/AuthContext";
import { moduleService } from "@/services/moduleService";
import { getErrorMessage } from "@/lib/errors";
import { cn, formatMoney, todayLocal } from "@/lib/utils";
import { Partner, ProfitOpeningInput, SettlementPreview } from "@/types/modules";
import { confirmMoneyAction } from "@/lib/confirmMoneyAction";

const emptyForm = { name: "", phone: "", share_percent: "", notes: "", is_active: true };
const emptyPrior = { period_start: "", period_end: "", amount: "", note: "" };
const yesterdayLocal = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function BalanceText({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <span className="text-muted-foreground">0</span>;
  return value > 0 ? (
    <span className="text-green-600 font-semibold">له {formatMoney(value)}</span>
  ) : (
    <span className="text-amber-600 font-semibold">عليه {formatMoney(-value)} (سحب مقدّم)</span>
  );
}

export default function Partners() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { features } = useFeatures();
  const enabled = features.partners && isAdmin;
  const { data: overview, isLoading } = usePartners(enabled);
  const { data: openingState, isLoading: openingLoading } = useProfitOpening(enabled);
  const { data: settlements = [] } = useSettlements(enabled);
  const savePartner = useSavePartner();
  const saveProfitOpening = useSaveProfitOpening();
  const deletePartner = useDeletePartner();
  const withdraw = useWithdrawal();
  const deleteWithdrawal = useDeleteWithdrawal();
  const settle = useSettle();
  const undo = useUndoSettlement();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [openingDate, setOpeningDate] = useState(yesterdayLocal());
  const [openingNote, setOpeningNote] = useState("");
  const [openingLines, setOpeningLines] = useState<
    { partner: number; partner_name: string; net_profit: string; withdrawn_amount: string }[]
  >([]);
  const [detailId, setDetailId] = useState<number | null>(null);
  const { data: detail } = usePartner(detailId);
  const [withdrawFor, setWithdrawFor] = useState<Partner | null>(null);
  const [money, setMoney] = useState(emptyMoney());
  const [wNote, setWNote] = useState("");
  const [wDate, setWDate] = useState(todayLocal());
  const [closeOpen, setCloseOpen] = useState(false);
  const [endDate, setEndDate] = useState(todayLocal());
  const [hasCompletedPeriodDays, setHasCompletedPeriodDays] = useState(true);
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const savePriorProfit = useSavePriorProfit();
  const deletePriorProfit = useDeletePriorProfit();
  const [priorEditId, setPriorEditId] = useState<number | null>(null);
  const [priorForm, setPriorForm] = useState(emptyPrior);

  if (!features.partners) {
    return <p className="text-muted-foreground">ميزة الشركاء غير مفعّلة. فعّلها من الإعدادات.</p>;
  }
  if (!isAdmin) {
    return <p className="text-muted-foreground">هذه الصفحة للمدير فقط.</p>;
  }

  const partners = overview?.partners ?? [];
  const totalPercent = Number(overview?.total_percent ?? 0);
  const percentOk = Math.abs(totalPercent - 100) < 0.01;
  const yesterday = yesterdayLocal;

  const openForm = (p: Partner | null) => {
    setEditing(p);
    setForm(p ? {
      name: p.name,
      phone: p.phone,
      share_percent: p.share_percent,
      notes: p.notes,
      is_active: p.is_active,
    } : emptyForm);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "خطأ", description: "اسم الشريك مطلوب.", variant: "destructive" });
      return;
    }
    if (!await confirmMoneyAction(
      `${editing ? "تحديث" : "إضافة"} الشريك ${form.name.trim()} بحصة ${form.share_percent || "0"}٪؟ ستؤثر الحصة على توزيعات الأرباح.`,
    )) return;
    try {
      await savePartner.mutateAsync({ id: editing?.id, data: form });
      toast({ title: editing ? "تم التحديث" : "تمت إضافة الشريك" });
      setFormOpen(false);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحفظ"), variant: "destructive" });
    }
  };

  const handleSavePrior = async () => {
    if (!detail) return;
    const amount = Number(priorForm.amount);
    if (!priorForm.period_end || !amount) {
      toast({ title: "خطأ", description: "أدخل نهاية الفترة ومبلغاً غير صفر.", variant: "destructive" });
      return;
    }
    const range = priorForm.period_start ? `${priorForm.period_start} ← ${priorForm.period_end}` : `حتى ${priorForm.period_end}`;
    if (!await confirmMoneyAction(
      `تسجيل ${amount < 0 ? "خسارة" : "ربح"} سابق بقيمة ${formatMoney(Math.abs(amount))} للشريك ${detail.name} (${range})؟ سيغيّر رصيده ولن يؤثر على الصندوق.`,
    )) return;
    try {
      await savePriorProfit.mutateAsync({
        id: priorEditId ?? undefined,
        data: {
          partner: detail.id,
          period_start: priorForm.period_start || null,
          period_end: priorForm.period_end,
          amount: priorForm.amount,
          note: priorForm.note,
        },
      });
      toast({ title: priorEditId ? "تم تعديل السطر" : "تمت إضافة الربح السابق" });
      setPriorEditId(null);
      setPriorForm(emptyPrior);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحفظ"), variant: "destructive" });
    }
  };

  const openProfitOpening = () => {
    const existing = openingState?.opening;
    const existingLines = new Map(existing?.lines.map((line) => [line.partner, line]) ?? []);
    setOpeningLines(partners.map((partner) => {
      const line = existingLines.get(partner.id);
      return {
        partner: partner.id,
        partner_name: partner.name,
        net_profit: String(line?.net_profit ?? 0),
        withdrawn_amount: String(line?.withdrawn_amount ?? 0),
      };
    }));
    setOpeningDate(existing?.as_of ?? yesterdayLocal());
    setOpeningNote(existing?.note ?? "");
    setOpeningOpen(true);
  };

  const handleSaveProfitOpening = async () => {
    const update = Boolean(openingState?.opening);
    const summary = openingLines.map((line) =>
      `${line.partner_name}: ربح ${formatMoney(Number(line.net_profit) || 0)}، سحب ${formatMoney(Number(line.withdrawn_amount) || 0)}`,
    ).join("\n");
    const prompt = `${update ? "تعديل" : "تسجيل"} أرباح الشركاء قبل استخدام البرنامج حتى ${openingDate}:\n${summary}\nلن يتغير الصندوق أو ربح الفترة الحالية.`;
    if (!await confirmMoneyAction(prompt)) return;
    const data: ProfitOpeningInput = {
      as_of: openingDate,
      note: openingNote,
      lines: openingLines.map(({ partner, net_profit, withdrawn_amount }) => ({
        partner,
        net_profit: net_profit || "0",
        withdrawn_amount: withdrawn_amount || "0",
      })),
    };
    try {
      await saveProfitOpening.mutateAsync({ data, update });
      toast({ title: update ? "تم تحديث رصيد البداية" : "تم تسجيل الأرباح السابقة" });
      setOpeningOpen(false);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل حفظ رصيد البداية"), variant: "destructive" });
    }
  };

  const handleDelete = async (p: Partner) => {
    if (!await confirmMoneyAction(`حذف الشريك «${p.name}»؟ قد يؤثر ذلك على توزيعات الأرباح وسجل أرصدته.`)) return;
    try {
      await deletePartner.mutateAsync(p.id);
      toast({ title: "تم الحذف" });
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحذف"), variant: "destructive" });
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawFor) return;
    const amount = money.currency === "USD"
      ? formatMoney(usdValue(money))
      : `${Number(money.amount).toLocaleString("en-US")} ل.س (≈ ${formatMoney(usdValue(money))})`;
    if (!await confirmMoneyAction(`تسجيل سحب ${amount} للشريك ${withdrawFor.name}${wNote.trim() ? `\nالبيان: ${wNote.trim()}` : ""}؟`)) return;
    try {
      await withdraw.mutateAsync({ partner: withdrawFor.id, note: wNote, date: wDate, ...toMoneyPayload(money) } as Parameters<typeof moduleService.addWithdrawal>[0]);
      toast({ title: "تم تسجيل السحب" });
      setWithdrawFor(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل التسجيل"), variant: "destructive" });
    }
  };

  const loadPreview = async (end: string) => {
    setPreview(null);
    setPreviewError("");
    const earliestEnd = overview?.period_start;
    if (!earliestEnd || earliestEnd > yesterday() || end < earliestEnd || end > yesterday()) return;
    try {
      setPreview(await moduleService.previewSettlement(end));
    } catch (error) {
      setPreviewError(getErrorMessage(error, "تعذر حساب التوزيع"));
    }
  };

  const openClose = () => {
    const latestEnd = yesterday();
    const hasCompletedDays = !!overview?.period_start && overview.period_start <= latestEnd;
    setHasCompletedPeriodDays(hasCompletedDays);
    setEndDate(hasCompletedDays ? latestEnd : "");
    setCloseNote("");
    setPreview(null);
    setPreviewError("");
    setCloseOpen(true);
    if (hasCompletedDays) loadPreview(latestEnd);
  };

  const handleClose = async () => {
    if (!hasCompletedPeriodDays || !preview) return;
    if (!await confirmMoneyAction(
      `إقفال الفترة حتى ${endDate} وتوزيع صافي ربح ${formatMoney(preview.net_profit)} على الشركاء؟`,
    )) return;
    try {
      await settle.mutateAsync({ end: endDate, note: closeNote });
      toast({ title: "تم إقفال الفترة", description: "وُزّعت الأرباح على الشركاء وبدأت فترة جديدة من الصفر." });
      setCloseOpen(false);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الإقفال"), variant: "destructive" });
    }
  };

  const handleUndo = async (id: number) => {
    if (!await confirmMoneyAction("التراجع عن آخر إقفال؟ ستعود أرباح تلك الفترة إلى «غير موزعة» وسيُعاد احتساب أرصدة الشركاء.")) return;
    try {
      await undo.mutateAsync(id);
      toast({ title: "تم التراجع" });
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل التراجع"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">الشركاء</h1>
          <p className="text-muted-foreground mt-1">حصص الأرباح، المسحوبات، والتوزيع آخر الشهر</p>
        </div>
        <div className="flex gap-2">
          {!openingLoading && openingState?.editable && !openingState.opening && (
            <Button variant="outline" onClick={openProfitOpening} disabled={partners.length === 0}>
              <Plus className="w-4 h-4 ml-2" /> أرباح قبل استخدام البرنامج
            </Button>
          )}
          {openingState?.opening && openingState.editable && (
            <Button variant="outline" onClick={openProfitOpening}>
              <Pencil className="w-4 h-4 ml-2" /> تعديل رصيد البداية
            </Button>
          )}
          <Button variant="outline" onClick={() => openForm(null)}>
            <Plus className="w-4 h-4 ml-2" /> إضافة شريك
          </Button>
          <Button variant="brand" onClick={openClose} disabled={partners.length === 0}>
            <Lock className="w-4 h-4 ml-2" /> إقفال الشهر وتوزيع الأرباح
          </Button>
        </div>
      </div>

      {openingState?.opening && (
        <div className="bg-muted/50 border border-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">رصيد الأرباح قبل استخدام البرنامج</p>
            <p className="text-sm text-muted-foreground">
              حتى {openingState.opening.as_of} · مجموع أرباح الشركاء السابقة {formatMoney(openingState.opening.net_profit)}
            </p>
          </div>
          {!openingState.editable && (
            <p className="text-xs text-muted-foreground">مقفل بعد توزيع أرباح فترة لاحقة.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-sm text-muted-foreground">الفترة الحالية تبدأ من</p>
          <p className="text-xl font-bold">{overview?.period_start ?? "—"}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-sm text-muted-foreground">صافي ربح الفترة (غير موزع)</p>
          <p className={cn("text-xl font-bold", (overview?.period_net_profit ?? 0) < 0 && "text-destructive")}>
            {formatMoney(overview?.period_net_profit ?? 0)}
          </p>
        </div>
        <div className={cn("border rounded-xl p-5", percentOk ? "bg-card border-border" : "bg-amber-50 border-amber-200")}>
          <p className="text-sm text-muted-foreground">مجموع النسب</p>
          <p className="text-xl font-bold">{totalPercent}%</p>
          {!percentOk && <p className="text-xs text-amber-700 mt-1">يجب أن يساوي 100% قبل الإقفال.</p>}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-sm font-medium">الشريك</th>
                <th className="px-4 py-3 text-sm font-medium">النسبة</th>
                <th className="px-4 py-3 text-sm font-medium">حصته من ربح الفترة</th>
                <th className="px-4 py-3 text-sm font-medium">إجمالي المسحوب</th>
                <th className="px-4 py-3 text-sm font-medium">الرصيد</th>
                <th className="px-4 py-3 text-sm font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">جارٍ التحميل...</td></tr>
              ) : partners.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">لا يوجد شركاء. أضف الشركاء ونسبهم.</td></tr>
              ) : (
                partners.map((p) => (
                  <tr key={p.id} className={cn("hover:bg-muted/30", !p.is_active && "opacity-60")}>
                    <td className="px-4 py-3 text-sm font-medium">
                      <button className="hover:underline" onClick={() => setDetailId(p.id)}>{p.name}</button>
                      {!p.is_active && <Badge variant="outline" className="mr-2">معطّل</Badge>}
                    </td>
                    <td className="px-4 py-3 text-sm">{Number(p.share_percent)}%</td>
                    <td className="px-4 py-3 text-sm">{formatMoney(p.undistributed)}</td>
                    <td className="px-4 py-3 text-sm">{formatMoney(p.withdrawn_total)}</td>
                    <td className="px-4 py-3 text-sm"><BalanceText value={p.balance} /></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => { setWithdrawFor(p); setMoney(emptyMoney()); setWNote(""); setWDate(todayLocal()); }}>
                          تسجيل سحب
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => openForm(p)}>
                          <Pencil className="w-4 h-4 ml-1" /> تعديل
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {settlements.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-foreground">سجل الإقفالات</h3>
          {settlements.map((s, index) => (
            <div key={s.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="font-medium">
                  {s.period_start} ← {s.period_end}{" "}
                  <span className="text-muted-foreground text-sm">صافي الربح: {formatMoney(s.net_profit)}</span>
                </p>
                {index === 0 && (
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => handleUndo(s.id)}>
                    <Undo2 className="w-4 h-4 ml-1" /> تراجع
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                {s.lines.map((l) => (
                  <span key={l.partner}>{l.partner_name} ({Number(l.share_percent)}%): {formatMoney(l.share_amount)}</span>
                ))}
              </div>
              {s.note && <p className="text-xs text-muted-foreground mt-1">{s.note}</p>}
            </div>
          ))}
        </div>
      )}

      {/* One-time historical profit and withdrawals, per partner; these are not cash-box transactions. */}
      <Dialog open={openingOpen} onOpenChange={setOpeningOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{openingState?.opening ? "تعديل رصيد البداية" : "إدخال الأرباح قبل استخدام البرنامج"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              أدخل لكل شريك صافي ربحه الخاص قبل استخدام البرنامج (الخسارة بإشارة سالبة)، وما سحبه منه.
              لا تُستخدم النسب هنا، ولا تؤثر هذه المبالغ على الصندوق أو ربح الفترة الحالية.
              لتسجيل الربح شهراً بشهر استعمل «أرباح الشريك قبل استخدام البرنامج» في تفاصيل الشريك.
            </p>
            <div className="space-y-2">
              <Label>الأرباح حتى تاريخ</Label>
              <Input type="date" max={yesterday()} value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
            </div>
            <div className="space-y-3">
              {openingLines.map((line, index) => (
                <div key={line.partner} className="space-y-2 border-t border-border pt-3">
                  <p className="text-sm font-medium">{line.partner_name}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">صافي ربحه قبل البرنامج ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={line.net_profit}
                        onChange={(e) => setOpeningLines((current) => current.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, net_profit: e.target.value } : row,
                        ))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">ما سحبه قبل البرنامج ($)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.withdrawn_amount}
                        onChange={(e) => setOpeningLines((current) => current.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, withdrawn_amount: e.target.value } : row,
                        ))}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label>ملاحظة (اختياري)</Label>
              <Input value={openingNote} onChange={(e) => setOpeningNote(e.target.value)} />
            </div>
            <Button
              variant="brand"
              className="w-full"
              onClick={handleSaveProfitOpening}
              disabled={saveProfitOpening.isPending || openingLines.length === 0}
            >
              {saveProfitOpening.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              حفظ رصيد البداية
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add / edit partner */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل الشريك" : "إضافة شريك"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>الاسم</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>نسبة الأرباح %</Label>
                <Input type="number" min="0" max="100" step="0.01" value={form.share_percent} onChange={(e) => setForm({ ...form, share_percent: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>الهاتف</Label>
                <Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="h-4 w-4" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              شريك فعّال (يدخل في توزيع الأرباح)
            </label>
            <Button variant="brand" className="w-full" onClick={handleSave} disabled={savePartner.isPending}>
              {savePartner.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              حفظ
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Withdrawal */}
      <Dialog open={withdrawFor !== null} onOpenChange={(v) => !v && setWithdrawFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>سحب للشريك {withdrawFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              السحب سلفة من حصة الشريك: لا يؤثر على ربح المحل، ويُخصم من رصيد الشريك عند الإقفال.
            </p>
            <MoneyEntry enabled={features.money_boxes} value={money} onChange={setMoney} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>التاريخ</Label>
                <Input type="date" value={wDate} onChange={(e) => setWDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>ملاحظة</Label>
                <Input value={wNote} onChange={(e) => setWNote(e.target.value)} />
              </div>
            </div>
            <Button variant="brand" className="w-full" onClick={handleWithdraw} disabled={withdraw.isPending || usdValue(money) <= 0}>
              {withdraw.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              تسجيل
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close the period: preview, then one explicit click */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>إقفال الفترة وتوزيع الأرباح</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>تاريخ نهاية الفترة (حتى أمس كحد أقصى)</Label>
              <Input
                type="date"
                min={overview?.period_start}
                max={yesterday()}
                value={endDate}
                disabled={!hasCompletedPeriodDays}
                onChange={(e) => { setEndDate(e.target.value); loadPreview(e.target.value); }}
              />
            </div>
            {!hasCompletedPeriodDays && (
              <p className="text-sm text-muted-foreground">
                لا توجد أيام مكتملة في الفترة الحالية بعد. يمكنك إقفالها غداً بعد انتهاء اليوم.
              </p>
            )}
            {previewError && <p className="text-sm text-destructive">{previewError}</p>}
            {preview && (
              <div className="space-y-3">
                <div className="bg-muted rounded-lg p-3 text-sm flex justify-between">
                  <span>الفترة: {preview.period_start} ← {preview.period_end}</span>
                  <span className={cn("font-bold", preview.net_profit < 0 && "text-destructive")}>
                    صافي الربح: {formatMoney(preview.net_profit)}
                  </span>
                </div>
                <table className="w-full text-sm text-right">
                  <thead className="text-muted-foreground">
                    <tr><th className="py-1">الشريك</th><th>النسبة</th><th>حصته</th><th>سحب خلال الفترة</th></tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((l) => (
                      <tr key={l.partner} className="border-t border-border">
                        <td className="py-2">{l.partner_name}</td>
                        <td>{Number(l.share_percent)}%</td>
                        <td className="font-medium">{formatMoney(l.share_amount)}</td>
                        <td>{formatMoney(l.withdrawn_in_period)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="space-y-2">
                  <Label>ملاحظة (اختياري)</Label>
                  <Input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">
                  بعد الإقفال تُسجَّل حصص الشركاء في أرصدتهم ويصبح ربح الفترة الجديدة صفراً. يمكن التراجع عن آخر إقفال.
                </p>
              </div>
            )}
            <Button
              variant="brand"
              className="w-full"
              onClick={handleClose}
              disabled={settle.isPending || !hasCompletedPeriodDays || !preview}
            >
              {settle.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              إقفال وتوزيع
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Partner profile */}
      <Dialog open={detailId !== null} onOpenChange={(v) => { if (!v) { setDetailId(null); setPriorEditId(null); setPriorForm(emptyPrior); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> {detail?.name ?? "..."}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-5 py-2">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted rounded-lg p-3"><p className="text-xs text-muted-foreground">النسبة</p><p className="font-bold">{Number(detail.share_percent)}%</p></div>
                <div className="bg-muted rounded-lg p-3"><p className="text-xs text-muted-foreground">ربح الفترة الحالية</p><p className="font-bold">{formatMoney(detail.undistributed)}</p></div>
                <div className="bg-muted rounded-lg p-3"><p className="text-xs text-muted-foreground">الرصيد</p><p className="font-bold"><BalanceText value={detail.balance} /></p></div>
              </div>
              {detail.opening && (
                <div className="bg-muted/50 border border-border rounded-lg p-4">
                  <h4 className="font-semibold mb-2">رصيد ما قبل استخدام البرنامج · حتى {detail.opening.as_of}</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <p>صافي ربحه قبل البرنامج: <strong>{formatMoney(detail.opening.net_profit)}</strong></p>
                    <p>ما سحبه قبل البرنامج: <strong>{formatMoney(detail.opening.withdrawn_amount)}</strong></p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">لا يؤثر هذا الرصيد على الصندوق.</p>
                </div>
              )}
              <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">أرباح الشريك قبل استخدام البرنامج</h4>
                  <span className="text-sm">المجموع: <strong><BalanceText value={detail.prior_profit_total} /></strong></span>
                </div>
                {detail.prior_profits.length > 0 && (
                  <table className="w-full text-sm text-right">
                    <tbody>
                      {detail.prior_profits.map((p) => (
                        <tr key={p.id} className="border-t border-border">
                          <td className="py-2">{p.period_start ? `${p.period_start} ← ${p.period_end}` : `حتى ${p.period_end}`}</td>
                          <td className={cn("font-medium", Number(p.amount) < 0 && "text-amber-600")}>{formatMoney(p.amount)}</td>
                          <td className="text-muted-foreground">{p.note}</td>
                          <td className="whitespace-nowrap">
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => {
                                setPriorEditId(p.id);
                                setPriorForm({ period_start: p.period_start ?? "", period_end: p.period_end, amount: p.amount, note: p.note });
                              }}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                              onClick={async () => {
                                if (!await confirmMoneyAction(`حذف ربح سابق بقيمة ${formatMoney(p.amount)} للشريك ${detail.name}؟`)) return;
                                try {
                                  await deletePriorProfit.mutateAsync(p.id);
                                } catch (error) {
                                  toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحذف"), variant: "destructive" });
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">من (اختياري)</Label>
                    <Input type="date" max={yesterday()} value={priorForm.period_start} onChange={(e) => setPriorForm({ ...priorForm, period_start: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">إلى</Label>
                    <Input type="date" max={yesterday()} value={priorForm.period_end} onChange={(e) => setPriorForm({ ...priorForm, period_end: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ربح الشريك في الفترة ($، سالب = خسارة)</Label>
                    <Input type="number" step="0.01" value={priorForm.amount} onChange={(e) => setPriorForm({ ...priorForm, amount: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ملاحظة</Label>
                    <Input value={priorForm.note} onChange={(e) => setPriorForm({ ...priorForm, note: e.target.value })} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="brand" className="flex-1" onClick={handleSavePrior} disabled={savePriorProfit.isPending}>
                    {savePriorProfit.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                    {priorEditId ? "حفظ التعديل" : "إضافة ربح سابق"}
                  </Button>
                  {priorEditId && (
                    <Button variant="outline" onClick={() => { setPriorEditId(null); setPriorForm(emptyPrior); }}>إلغاء</Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  أضف سطراً لكل شهر أو فترة. يُضاف إلى رصيد الشريك ولا يؤثر على الصندوق أو ربح الفترة الحالية.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2">المسحوبات المسجلة في البرنامج</h4>
                {detail.withdrawals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد مسحوبات.</p>
                ) : (
                  <table className="w-full text-sm text-right">
                    <tbody>
                      {detail.withdrawals.map((w) => (
                        <tr key={w.id} className="border-t border-border">
                          <td className="py-2">{w.date}</td>
                          <td>
                            {w.currency === "SYP" && w.paid_amount
                              ? `${formatMoney(w.paid_amount, "SYP")} (= ${formatMoney(w.amount)})`
                              : formatMoney(w.amount)}
                          </td>
                          <td className="text-muted-foreground">{w.note}</td>
                          <td>
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                              onClick={async () => {
                                if (!await confirmMoneyAction(`حذف سحب بقيمة ${formatMoney(w.amount)} للشريك ${detail?.name ?? ""}؟`)) return;
                                await deleteWithdrawal.mutateAsync(w.id);
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h4 className="font-semibold mb-2">سجل الأرباح الموزعة</h4>
                {detail.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لم يتم إقفال أي فترة بعد.</p>
                ) : (
                  <table className="w-full text-sm text-right">
                    <thead className="text-muted-foreground"><tr><th className="py-1">الفترة</th><th>صافي ربح المحل</th><th>حصته</th><th>سحب</th></tr></thead>
                    <tbody>
                      {detail.history.map((h) => (
                        <tr key={h.settlement} className="border-t border-border">
                          <td className="py-2">{h.period_start} ← {h.period_end}</td>
                          <td>{formatMoney(h.net_profit)}</td>
                          <td className="font-medium">{formatMoney(h.share_amount)} ({Number(h.share_percent)}%)</td>
                          <td>{formatMoney(h.withdrawn_in_period)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
