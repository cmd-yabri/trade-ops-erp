import { confirmAction } from "@/lib/confirmMoneyAction";
import { useEffect, useState } from "react";
import { Building2, Loader2, MessageCircle, Pencil, Plus, Puzzle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useDeleteBranch, useSaveBranch, useUpdateFeatures, useWhatsappStatus } from "@/hooks/useModules";
import { moduleService } from "@/services/moduleService";
import { getErrorMessage } from "@/lib/errors";
import { Branch, FeatureFlag, Features } from "@/types/modules";
import { WhatsappGroupPanel } from "@/components/settings/WhatsappGroupPanel";

const FEATURES: { key: FeatureFlag; title: string; text: string }[] = [
  { key: "branches", title: "الفروع", text: "فروع متعددة، لكل فرع مخزونه الخاص، وربط المشتريات والمبيعات والمصاريف بالفرع مع تقارير لكل فرع." },
  { key: "cars", title: "السيارات", text: "سيارات تحمل مخزوناً خاصاً بها: البيع من السيارة يخصم من مخزونها، مع صفحة لمصاريف كل سيارة." },
  { key: "money_boxes", title: "الصناديق (دولار وليرة)", text: "صندوقان منفصلان بالدولار والليرة السورية، دفع وقبض بأي عملة بسعر صرف يدخله المستخدم، وتحويل بين الصندوقين." },
  { key: "accounts", title: "حسابات الجملة", text: "حسابات لعملاء الجملة والموردين: كم دفع وكم بقي عليه، دائن ومدين، كشف حساب ودفعات مجمّعة." },
  { key: "partners", title: "الشركاء", text: "شركاء بنسب أرباح قابلة للتعديل، مسحوبات خلال الشهر، وزر لإقفال الشهر وتوزيع الأرباح." },
  { key: "whatsapp", title: "واتساب", text: "إرسال الفواتير وأوامر الشراء وكشوف الحساب عبر واتساب إلى أرقام العملاء والموردين." },
];

function BranchesManager() {
  const { toast } = useToast();
  const { branches } = useFeatures();
  const save = useSaveBranch();
  const remove = useDeleteBranch();
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [form, setForm] = useState({ name: "", address: "", phone: "", is_active: true });

  const open = (b: Branch | "new") => {
    setEditing(b);
    setForm(b === "new" ? { name: "", address: "", phone: "", is_active: true } : { name: b.name, address: b.address, phone: b.phone, is_active: b.is_active });
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "خطأ", description: "اسم الفرع مطلوب.", variant: "destructive" });
      return;
    }
    try {
      await save.mutateAsync({ id: editing && editing !== "new" ? editing.id : undefined, data: form });
      toast({ title: "تم الحفظ" });
      setEditing(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحفظ"), variant: "destructive" });
    }
  };

  const handleDelete = async (b: Branch) => {
    if (!await confirmAction(`حذف الفرع «${b.name}»؟`)) return;
    try {
      await remove.mutateAsync(b.id);
      toast({ title: "تم الحذف" });
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحذف"), variant: "destructive" });
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> إدارة الفروع</h3>
        <Button size="sm" variant="outline" onClick={() => open("new")}><Plus className="w-4 h-4 ml-1" /> فرع جديد</Button>
      </div>
      <ul className="divide-y divide-border text-sm">
        {branches.map((b) => (
          <li key={b.id} className="flex items-center justify-between py-2">
            <span>
              {b.name} {b.is_default && <Badge variant="secondary" className="mr-2">الرئيسي</Badge>}
              {!b.is_active && <Badge variant="outline" className="mr-2">معطّل</Badge>}
              {b.phone && <span className="text-muted-foreground mr-2" dir="ltr">{b.phone}</span>}
            </span>
            <span className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => open(b)}><Pencil className="w-4 h-4" /></Button>
              {!b.is_default && (
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(b)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing === "new" ? "فرع جديد" : "تعديل الفرع"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>العنوان</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="space-y-2"><Label>الهاتف</Label><Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="h-4 w-4" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              فرع فعّال
            </label>
            <Button variant="brand" className="w-full" onClick={handleSave} disabled={save.isPending}>
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              حفظ
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const STATE_TEXT: Record<string, string> = {
  open: "مربوط ✔",
  connecting: "جارٍ الاتصال...",
  close: "غير مربوط",
  unlinked: "غير مربوط - بانتظار المسح",
  offline: "الخدمة لا تستجيب",
  unavailable: "غير متاحة على هذا الجهاز",
};

function WhatsappPanel() {
  const { toast } = useToast();
  const { features } = useFeatures();
  const update = useUpdateFeatures();
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState(features.whatsapp_country_code);
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const { data: status, refetch } = useWhatsappStatus(true, linking);

  const state = status?.state ?? "offline";
  useEffect(() => {
    if (linking && state === "open") setLinking(false); // linked: stop polling
  }, [linking, state]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast({ title: ok });
      await refetch();
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشلت العملية"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium flex items-center gap-2"><MessageCircle className="w-4 h-4 text-green-600" /> ربط واتساب</h3>
        <Badge variant={state === "open" ? "secondary" : "outline"}>{STATE_TEXT[state] ?? state}</Badge>
      </div>
      {status?.detail && state !== "open" && <p className="text-sm text-muted-foreground">{status.detail}</p>}

      {state === "unavailable" ? (
        <p className="text-sm text-muted-foreground">
          خدمة الإرسال المباشر غير موجودة في هذا الجهاز، لكن أزرار واتساب تبقى تعمل: تفتح محادثة جاهزة النص وتضغط أنت «إرسال».
        </p>
      ) : state === "open" ? (
        <Button variant="outline" disabled={busy} onClick={() => run(moduleService.whatsappDisconnect, "تم فصل الربط")}>
          فصل الرقم
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">رقم واتساب الخاص بالمحل (لرمز الاقتران)</Label>
              <Input dir="ltr" placeholder="09XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <Button
              variant="brand"
              disabled={busy || !phone.trim()}
              onClick={() => { setLinking(true); run(() => moduleService.whatsappConnect(phone.trim())); }}
            >
              رمز اقتران
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => { setLinking(true); run(() => moduleService.whatsappConnect()); }}
            >
              رمز QR
            </Button>
          </div>
          {status?.pairingCode && (
            <div className="bg-muted rounded-lg p-4 text-center space-y-1">
              <p className="text-xs text-muted-foreground">
                واتساب ← الأجهزة المرتبطة ← ربط برقم الهاتف، ثم اكتب:
              </p>
              <p className="text-3xl font-bold tracking-widest" dir="ltr">{status.pairingCode}</p>
            </div>
          )}
          {status?.qr && (
            <div className="bg-white rounded-lg p-3 w-fit mx-auto">
              <img src={status.qr} alt="QR" className="w-56 h-56" />
              <p className="text-xs text-center text-muted-foreground mt-1">امسحه من واتساب ← الأجهزة المرتبطة</p>
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 pt-2 border-t border-border">
        <div className="space-y-1 w-40">
          <Label className="text-xs">رمز الدولة للأرقام المحلية</Label>
          <Input dir="ltr" value={country} onChange={(e) => setCountry(e.target.value.replace(/\D/g, ""))} />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={update.isPending || country === features.whatsapp_country_code || !country}
          onClick={() => run(() => update.mutateAsync({ whatsapp_country_code: country }), "تم الحفظ")}
        >
          حفظ
        </Button>
        <p className="text-xs text-muted-foreground pb-2">سوريا 963 — يحوّل 0980… إلى 963980…</p>
      </div>
    </div>
  );
}

export function FeaturesPanel() {
  const { toast } = useToast();
  const { features } = useFeatures();
  const update = useUpdateFeatures();

  const toggle = async (key: FeatureFlag, value: boolean) => {
    try {
      await update.mutateAsync({ [key]: value });
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحفظ"), variant: "destructive" });
    }
  };

  return (
    <section className="bg-card border border-border rounded-xl p-6 space-y-4">
      <h2 className="font-semibold flex items-center gap-2">
        <Puzzle className="w-5 h-5 text-primary" /> الميزات الاختيارية
      </h2>
      <p className="text-sm text-muted-foreground">
        فعّل فقط ما يحتاجه هذا المحل. كل ميزة مستقلة عن الأخرى، وإيقافها لا يحذف أي بيانات.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {FEATURES.map((f) => (
          <div key={f.key} className="flex items-start justify-between gap-4 border border-border rounded-lg p-4">
            <div>
              <p className="font-medium">{f.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{f.text}</p>
            </div>
            <Switch checked={features[f.key]} disabled={update.isPending} onCheckedChange={(v) => toggle(f.key, v)} />
          </div>
        ))}
      </div>
      {features.branches && <BranchesManager />}
      {features.whatsapp && (
        <>
          <WhatsappPanel />
          <WhatsappGroupPanel />
        </>
      )}
    </section>
  );
}
