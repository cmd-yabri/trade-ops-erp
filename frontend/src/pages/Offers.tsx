import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRightCircle,
  Ban,
  Eye,
  FileDown,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { QuantityInput } from "@/components/QuantityInput";
import { TablePagination } from "@/components/TablePagination";
import { WhatsappButton } from "@/components/WhatsappButton";
import { usePagination } from "@/hooks/usePagination";
import { useToast } from "@/hooks/use-toast";
import { useProducts } from "@/hooks/useInventory";
import { useAccounts, useCars } from "@/hooks/useModules";
import { useCompany } from "@/hooks/useCompany";
import {
  useAcceptOffer,
  useDeleteOffer,
  useOffers,
  useRejectOffer,
  useReopenOffer,
  useSaveOffer,
} from "@/hooks/useOffers";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useAuth } from "@/contexts/AuthContext";
import { Offer, OfferInput, OfferJobType } from "@/services/offerService";
import { getErrorMessage } from "@/lib/errors";
import { offerMessage } from "@/lib/messages";
import { companyHeaderHtml, escapeHtml, printBaseCss } from "@/lib/print";
import { confirmAction, confirmMoneyAction } from "@/lib/confirmMoneyAction";
import { cn, formatMoney, formatQty, todayLocal } from "@/lib/utils";

import { serviceLabel, serviceSuggestions } from "@/lib/services";

type Filter = "all" | "PENDING" | "ACCEPTED" | "REJECTED";

const emptyForm = {
  client_name: "",
  client_phone: "",
  client_address: "",
  account: "",
  branch: "",
  car: "",
  discount: "0",
  valid_until: "",
  notes: "",
  items: [] as { product: number; quantity: number; unit_price: string }[],
  jobs: [] as { job_type: OfferJobType; contractor_name: string; cost_to_company: string; charge_to_client: string }[],
};

function StatusBadge({ offer }: { offer: Offer }) {
  if (offer.status === "ACCEPTED")
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">مقبول</Badge>;
  if (offer.status === "REJECTED") return <Badge className="bg-gray-100 text-gray-600 border-gray-200">مرفوض</Badge>;
  if (offer.is_expired) return <Badge className="bg-red-100 text-red-700 border-red-200">منتهي الصلاحية</Badge>;
  return <Badge className="bg-blue-100 text-blue-700 border-blue-200">قيد الانتظار</Badge>;
}

export default function Offers() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { features, branches, branchId } = useFeatures();
  const { data: company } = useCompany();
  const { data: offers = [], isLoading } = useOffers();
  const { data: products = [] } = useProducts();
  const { data: accounts = [] } = useAccounts(features.accounts);
  const { data: cars = [] } = useCars(features.cars);
  const saveOffer = useSaveOffer();
  const deleteOffer = useDeleteOffer();
  const acceptOffer = useAcceptOffer();
  const rejectOffer = useRejectOffer();
  const reopenOffer = useReopenOffer();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [detail, setDetail] = useState<Offer | null>(null);
  // the details window always shows the latest copy of the offer
  const shownDetail = detail ? (offers.find((o) => o.id === detail.id) ?? detail) : null;

  // Stock where the resulting sales order will take the goods from (same rule as the sales order form).
  const stockOf = (p: (typeof products)[number]) => {
    const levels = p.stock_by_location ?? [];
    if (form.car) return levels.find((l) => l.kind === "car" && String(l.id) === form.car)?.quantity ?? 0;
    const branch = form.branch || (branchId ? String(branchId) : String(branches.find((b) => b.is_default)?.id ?? ""));
    if (features.branches && branch) return levels.find((l) => l.kind === "branch" && String(l.id) === branch)?.quantity ?? 0;
    return p.current_stock ?? 0;
  };
  const [acceptTarget, setAcceptTarget] = useState<Offer | null>(null);

  const filtered = useMemo(
    () =>
      offers.filter((o) => {
        if (filter !== "all" && o.status !== filter) return false;
        const q = search.trim().toLowerCase();
        return !q || o.client_name.toLowerCase().includes(q) || String(o.id).includes(q);
      }),
    [offers, filter, search],
  );
  const pager = usePagination(filtered, 9, `${search}|${filter}`);
  const counts = useMemo(
    () => ({
      PENDING: offers.filter((o) => o.status === "PENDING").length,
      ACCEPTED: offers.filter((o) => o.status === "ACCEPTED").length,
      REJECTED: offers.filter((o) => o.status === "REJECTED").length,
    }),
    [offers],
  );

  const selectedAccount = accounts.find((a) => String(a.id) === form.account);
  const subtotal = form.items.reduce((s, i) => s + i.quantity * (parseFloat(i.unit_price) || 0), 0);
  const services = form.jobs.reduce((s, j) => s + (parseFloat(j.charge_to_client) || 0), 0);
  const total = subtotal + services - (parseFloat(form.discount) || 0);

  const openForm = (offer: Offer | null) => {
    setEditing(offer);
    setForm(
      offer
        ? {
            client_name: offer.client_name,
            client_phone: offer.client_phone,
            client_address: offer.client_address,
            account: offer.account ? String(offer.account) : "",
            branch: offer.branch ? String(offer.branch) : "",
            car: offer.car ? String(offer.car) : "",
            discount: String(offer.discount ?? "0"),
            valid_until: offer.valid_until ?? "",
            notes: offer.notes ?? "",
            items: offer.items.map((i) => ({ product: i.product, quantity: i.quantity, unit_price: i.unit_price })),
            jobs: offer.jobs.map((j) => ({
              job_type: j.job_type,
              contractor_name: j.contractor_name,
              cost_to_company: j.cost_to_company,
              charge_to_client: j.charge_to_client,
            })),
          }
        : { ...emptyForm, branch: branchId ? String(branchId) : "" },
    );
    setFormOpen(true);
  };

  const pickProduct = (index: number, productId: number) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const items = [...form.items];
    items[index] = {
      ...items[index],
      product: p.id,
      unit_price: (selectedAccount && p.wholesale_price) || p.selling_price || p.unit_cost,
    };
    setForm({ ...form, items });
  };

  const handleSave = async () => {
    const items = form.items.filter((i) => i.product > 0);
    if (!form.client_name.trim()) {
      toast({ title: "خطأ", description: "أدخل اسم العميل.", variant: "destructive" });
      return;
    }
    if (items.length === 0 && form.jobs.length === 0) {
      toast({ title: "خطأ", description: "أضف منتجاً أو خدمة واحدة على الأقل.", variant: "destructive" });
      return;
    }
    if (form.jobs.some((j) => !j.job_type.trim())) {
      toast({ title: "خطأ", description: "اكتب اسم كل خدمة أو احذف السطر الفارغ.", variant: "destructive" });
      return;
    }
    if (items.some((i) => !(i.quantity > 0))) {
      toast({ title: "خطأ", description: "الكمية يجب أن تكون أكبر من صفر.", variant: "destructive" });
      return;
    }
    if (total < 0) {
      toast({ title: "خطأ", description: "الخصم أكبر من إجمالي العرض.", variant: "destructive" });
      return;
    }
    if (!await confirmMoneyAction(
      `${editing ? "حفظ تعديلات" : "إنشاء"} عرض للعميل ${form.client_name.trim()} بإجمالي ${formatMoney(total)}؟ لن يتغير المخزون أو الصندوق حتى يُقبل العرض ويُنهى أمر البيع.`,
    )) return;
    const payload: OfferInput = {
      client_name: form.client_name,
      client_phone: form.client_phone,
      client_address: form.client_address,
      account: form.account ? Number(form.account) : null,
      branch: form.branch ? Number(form.branch) : undefined,
      car: form.car ? Number(form.car) : null,
      discount: form.discount || "0",
      valid_until: form.valid_until || null,
      notes: form.notes,
      items,
      jobs: form.jobs,
    };
    try {
      await saveOffer.mutateAsync({ id: editing?.id, data: payload });
      toast({ title: editing ? "تم تحديث العرض" : "تم إنشاء العرض", description: "لم يتأثر المخزون." });
      setFormOpen(false);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل حفظ العرض"), variant: "destructive" });
    }
  };

  const handleAccept = async () => {
    if (!acceptTarget) return;
    try {
      const { sales_order } = await acceptOffer.mutateAsync(acceptTarget.id);
      toast({
        title: "تم قبول العرض",
        description: `أُنشئ أمر البيع SO-${sales_order.id} (قيد المعالجة). أنهِه من صفحة أوامر البيع عند التسليم.`,
      });
      setAcceptTarget(null);
      setDetail(null);
      navigate("/sales-orders");
    } catch (error) {
      toast({ title: "تعذر قبول العرض", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const run = async (fn: () => Promise<unknown>, ok: string, fail: string) => {
    try {
      await fn();
      toast({ title: ok });
      setDetail(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, fail), variant: "destructive" });
    }
  };

  const handleDelete = async (offer: Offer) => {
    if (!await confirmAction(`حذف العرض OF-${offer.id}؟`)) return;
    run(() => deleteOffer.mutateAsync(offer.id), "تم حذف العرض", "فشل الحذف");
  };

  const printOffer = (offer: Offer) => {
    const rows = offer.items
      .map(
        (i) => `<tr><td>${escapeHtml(i.product_name)}</td><td>${escapeHtml(formatQty(i.quantity))}</td>
          <td>${formatMoney(i.unit_price)}</td><td>${formatMoney(i.total_price)}</td></tr>`,
      )
      .join("");
    const jobRows = offer.jobs
      .map(
        (j) => `<tr><td colspan="3">${serviceLabel(j.job_type)}${
          j.contractor_name ? " - " + escapeHtml(j.contractor_name) : ""
        }</td><td>${formatMoney(j.charge_to_client)}</td></tr>`,
      )
      .join("");
    const html = `
      <html dir="rtl"><head><meta charset="UTF-8"><title>OF-${offer.id}</title>
      <style>
        ${printBaseCss}
        body { font-family: 'Arial', 'Tahoma', sans-serif; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
        .store-name { font-size: 1.5em; font-weight: bold; color: #2563eb; }
        .store-phone { color: #666; margin-top: 4px; }
        .store-info { text-align: center; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th { background: #f1f5f9; padding: 10px; text-align: right; border-bottom: 2px solid #dee2e6; }
        td { padding: 8px; border-bottom: 1px solid #ddd; text-align: right; }
        .totals { margin-top: 20px; }
        .total-row { font-size: 1.25em; font-weight: bold; color: #2563eb; }
        .note { margin-top: 24px; padding: 10px 14px; background: #f8fafc; border-radius: 6px; }
        .print-buttons { text-align: center; margin-top: 32px; padding-top: 16px; border-top: 2px solid #ddd; }
        button { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
        .btn-print { background: #2563eb; color: #fff; } .btn-close { background: #6b7280; color: #fff; }
      </style></head><body>
        <div class="header">
          <div><h1>عرض سعر</h1><p>رقم العرض: OF-${offer.id}</p>
            ${offer.valid_until ? `<p>ساري حتى: ${offer.valid_until}</p>` : ""}</div>
          <div class="store-info">${companyHeaderHtml(company)}<p>${offer.created_at.slice(0, 10)}</p></div>
        </div>
        <p><b>العميل:</b> ${escapeHtml(offer.client_name)}
          ${offer.client_phone ? " &nbsp; <b>الهاتف:</b> " + escapeHtml(offer.client_phone) : ""}
          ${offer.client_address ? "<br><b>العنوان:</b> " + escapeHtml(offer.client_address) : ""}</p>
        <table><thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
          <tbody>${rows}${jobRows}</tbody></table>
        <div class="totals">
          <p>إجمالي المنتجات: ${formatMoney(offer.product_total)}</p>
          <p>إجمالي الخدمات: ${formatMoney(offer.service_total)}</p>
          ${Number(offer.discount) > 0 ? `<p>خصم: ${formatMoney(offer.discount)}</p>` : ""}
          <p class="total-row">الإجمالي: ${formatMoney(offer.grand_total)}</p>
        </div>
        ${offer.notes ? `<div class="note">${escapeHtml(offer.notes)}</div>` : ""}
        <div class="print-buttons">
          <button class="btn-print" onclick="window.print()">طباعة / حفظ PDF</button>
          <button class="btn-close" onclick="window.pywebview ? window.pywebview.api.close() : window.close()">إغلاق</button>
        </div>
      </body></html>`;
    const w = window as unknown as { pywebview?: { api?: { open_print_window?: (h: string) => void } } };
    if (w.pywebview?.api?.open_print_window) {
      w.pywebview.api.open_print_window(html);
    } else {
      const win = window.open("", "_blank");
      if (!win) return;
      win.document.write(html);
      win.document.close();
    }
  };

  const mutating = acceptOffer.isPending || rejectOffer.isPending || reopenOffer.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">عروض الأسعار</h1>
          <p className="text-muted-foreground mt-1">
            أرسل عرضاً للعميل دون أي أثر على المخزون أو المالية. عند موافقته يتحول إلى أمر بيع جديد بضغطة واحدة.
          </p>
        </div>
        <Button variant="brand" onClick={() => openForm(null)}>
          <Plus className="w-4 h-4 ml-2" /> عرض جديد
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pr-10" placeholder="ابحث باسم العميل أو رقم العرض..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          {(
            [
              ["all", `الكل (${offers.length})`],
              ["PENDING", `قيد الانتظار (${counts.PENDING})`],
              ["ACCEPTED", `مقبولة (${counts.ACCEPTED})`],
              ["REJECTED", `مرفوضة (${counts.REJECTED})`],
            ] as [Filter, string][]
          ).map(([v, l]) => (
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

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : pager.pageItems.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
          {offers.length === 0 ? "لا توجد عروض بعد. أنشئ عرضك الأول." : "لا توجد عروض مطابقة."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {pager.pageItems.map((offer) => (
            <div key={offer.id} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">OF-{offer.id}</p>
                  <h3 className="font-semibold text-foreground">{offer.client_name}</h3>
                  <p className="text-xs text-muted-foreground" dir="ltr">{offer.client_phone || ""}</p>
                </div>
                <StatusBadge offer={offer} />
              </div>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">العناصر:</span><span>{offer.items.length} منتج</span></div>
                {offer.valid_until && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ساري حتى:</span>
                    <span className={offer.is_expired ? "text-destructive" : ""}>{offer.valid_until}</span>
                  </div>
                )}
                {isAdmin && offer.profit !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الربح المتوقع:</span>
                    <span className={offer.profit < 0 ? "text-destructive font-semibold" : "text-green-600 font-semibold"}>
                      {formatMoney(offer.profit)}
                    </span>
                  </div>
                )}
                {offer.sales_order && (
                  <button className="text-primary underline text-xs" onClick={() => navigate("/sales-orders")}>
                    تحوّل إلى أمر البيع SO-{offer.sales_order}
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between flex-wrap gap-2 pt-3 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground">الإجمالي</p>
                  <p className="text-lg font-bold text-primary">{formatMoney(offer.grand_total)}</p>
                </div>
                <div className="flex items-center gap-0.5 flex-wrap">
                  {offer.status === "PENDING" && (
                    <>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="تعديل" onClick={() => openForm(offer)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-green-600"
                        title="قبول العرض وتحويله إلى أمر بيع"
                        disabled={offer.is_expired}
                        onClick={() => setAcceptTarget(offer)}
                      >
                        <ArrowRightCircle className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground"
                        title="رفض العرض"
                        onClick={() => run(() => rejectOffer.mutateAsync(offer.id), "تم رفض العرض", "فشل الرفض")}
                        disabled={mutating}
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                  {offer.status === "REJECTED" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="إعادة فتح العرض"
                      onClick={() => run(() => reopenOffer.mutateAsync(offer.id), "أُعيد فتح العرض", "فشلت العملية")}
                      disabled={mutating}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="تفاصيل" onClick={() => setDetail(offer)}>
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" title="طباعة / PDF" onClick={() => printOffer(offer)}>
                    <FileDown className="w-4 h-4" />
                  </Button>
                  <WhatsappButton iconOnly phone={offer.client_phone} message={() => offerMessage(offer, company?.name)} />
                  {isAdmin && offer.status !== "ACCEPTED" && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="حذف" onClick={() => handleDelete(offer)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <TablePagination pager={pager} />

      {/* Create / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `تعديل العرض OF-${editing.id}` : "عرض سعر جديد"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="rounded-lg bg-blue-50 text-blue-800 text-sm px-3 py-2">
              العرض لا يخصم من المخزون ولا يدخل في المالية. تتحقق الكميات المتوفرة فقط عند إنهاء أمر البيع الناتج عنه.
            </div>

            {(features.accounts || features.branches || features.cars) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3 rounded-lg border border-border">
                {features.accounts && (
                  <div className="space-y-2">
                    <Label>حساب الجملة</Label>
                    <SimpleSelect
                      value={form.account || "none"}
                      onChange={(v) => {
                        if (v === "none") return setForm({ ...form, account: "" });
                        const acc = accounts.find((a) => String(a.id) === v);
                        setForm({
                          ...form,
                          account: v,
                          client_name: acc?.name ?? form.client_name,
                          client_phone: acc?.phone || form.client_phone,
                          client_address: acc?.address || form.client_address,
                        });
                      }}
                      options={[
                        { value: "none", label: "عميل فردي (بدون حساب)" },
                        ...accounts.filter((a) => a.is_customer && a.is_active).map((a) => ({ value: String(a.id), label: a.name })),
                      ]}
                    />
                  </div>
                )}
                {features.branches && (
                  <div className="space-y-2">
                    <Label>الفرع</Label>
                    <SimpleSelect
                      value={form.branch || (branchId ? String(branchId) : String(branches.find((b) => b.is_default)?.id ?? ""))}
                      onChange={(v) => setForm({ ...form, branch: v })}
                      options={branches.filter((b) => b.is_active).map((b) => ({ value: String(b.id), label: b.name }))}
                    />
                  </div>
                )}
                {features.cars && (
                  <div className="space-y-2">
                    <Label>البيع من سيارة</Label>
                    <SimpleSelect
                      value={form.car || "none"}
                      onChange={(v) => setForm({ ...form, car: v === "none" ? "" : v })}
                      options={[
                        { value: "none", label: "من المخزن (بدون سيارة)" },
                        ...cars.filter((c) => c.is_active).map((c) => ({ value: String(c.id), label: c.name })),
                      ]}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>اسم العميل</Label>
                <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>رقم الجوال</Label>
                <Input dir="ltr" value={form.client_phone} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>العنوان</Label>
                <Input value={form.client_address} onChange={(e) => setForm({ ...form, client_address: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>ساري حتى (اختياري)</Label>
                <Input type="date" min={todayLocal()} value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>المنتجات</Label>
                <Button variant="outline" size="sm" onClick={() => setForm({ ...form, items: [...form.items, { product: 0, quantity: 1, unit_price: "0" }] })}>
                  <Plus className="w-4 h-4 ml-1" /> إضافة منتج
                </Button>
              </div>
              {form.items.length === 0 ? (
                <div className="text-center py-6 bg-muted/50 rounded-lg text-muted-foreground text-sm">لم تتم إضافة منتجات بعد.</div>
              ) : (
                form.items.map((item, index) => {
                  const p = products.find((x) => x.id === item.product);
                  return (
                    <div key={index} className="flex items-end gap-3 p-3 bg-muted rounded-lg">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">المنتج</Label>
                        <SimpleSelect
                          value={item.product ? String(item.product) : ""}
                          onChange={(v) => pickProduct(index, parseInt(v))}
                          placeholder="اختر من المخزون"
                          options={products.map((x) => ({
                            value: String(x.id),
                            label: `${x.name} (${formatQty(stockOf(x))} ${x.unit || ""} متوفر)`,
                          }))}
                        />
                      </div>
                      <div className="w-24 space-y-1">
                        <Label className="text-xs">الكمية</Label>
                        <QuantityInput
                          allowDecimal={!!p?.allow_decimal}
                          value={item.quantity}
                          onChange={(n) => {
                            const items = [...form.items];
                            items[index] = { ...items[index], quantity: n };
                            setForm({ ...form, items });
                          }}
                        />
                      </div>
                      <div className="w-28 space-y-1">
                        <Label className="text-xs">سعر الوحدة</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.unit_price}
                          onChange={(e) => {
                            const items = [...form.items];
                            items[index] = { ...items[index], unit_price: e.target.value };
                            setForm({ ...form, items });
                          }}
                        />
                      </div>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>الخدمات والرسوم الإضافية (توصيل، تركيب، صيانة، ضمان...)</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setForm({ ...form, jobs: [...form.jobs, { job_type: "", contractor_name: "", cost_to_company: "0", charge_to_client: "0" }] })}
                >
                  <Plus className="w-4 h-4 ml-1" /> إضافة خدمة
                </Button>
              </div>
              <datalist id="service-names">
                {serviceSuggestions(offers.flatMap((o) => o.jobs.map((j) => j.job_type))).map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              {form.jobs.map((job, index) => (
                <div key={index} className="grid grid-cols-[1.6fr_1fr_90px_90px_auto] gap-2 items-end p-3 bg-muted rounded-lg">
                  <div className="space-y-1">
                    <Label className="text-xs">الخدمة</Label>
                    <Input
                      list="service-names"
                      placeholder="اكتب أو اختر"
                      value={serviceLabel(job.job_type)}
                      onChange={(e) => {
                        const jobs = [...form.jobs];
                        jobs[index] = { ...jobs[index], job_type: e.target.value };
                        setForm({ ...form, jobs });
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">مقدّم الخدمة (اختياري)</Label>
                    <Input
                      value={job.contractor_name}
                      onChange={(e) => {
                        const jobs = [...form.jobs];
                        jobs[index] = { ...jobs[index], contractor_name: e.target.value };
                        setForm({ ...form, jobs });
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">التكلفة علينا</Label>
                    <Input
                      type="number"
                      value={job.cost_to_company}
                      onChange={(e) => {
                        const jobs = [...form.jobs];
                        jobs[index] = { ...jobs[index], cost_to_company: e.target.value };
                        setForm({ ...form, jobs });
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">السعر للعميل</Label>
                    <Input
                      type="number"
                      value={job.charge_to_client}
                      onChange={(e) => {
                        const jobs = [...form.jobs];
                        jobs[index] = { ...jobs[index], charge_to_client: e.target.value };
                        setForm({ ...form, jobs });
                      }}
                    />
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setForm({ ...form, jobs: form.jobs.filter((_, i) => i !== index) })}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الخصم ($)</Label>
                <Input type="number" min="0" step="0.01" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>ملاحظات تظهر في العرض</Label>
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>

            <div className="p-4 bg-accent rounded-lg space-y-1 text-sm">
              <div className="flex justify-between"><span>إجمالي المنتجات:</span><span>{formatMoney(subtotal)}</span></div>
              <div className="flex justify-between"><span>إجمالي الخدمات:</span><span>{formatMoney(services)}</span></div>
              <div className="flex justify-between text-lg font-bold border-t border-border pt-2 mt-1">
                <span>الإجمالي:</span>
                <span className={total < 0 ? "text-destructive" : "text-primary"}>{formatMoney(total)}</span>
              </div>
            </div>
            <Button variant="brand" className="w-full" onClick={handleSave} disabled={saveOffer.isPending}>
              {saveOffer.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              {editing ? "حفظ التعديلات" : "إنشاء العرض"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Details */}
      <Dialog open={shownDetail !== null} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              عرض OF-{shownDetail?.id} {shownDetail && <StatusBadge offer={detail} />}
            </DialogTitle>
          </DialogHeader>
          {shownDetail && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">العميل: </span>{shownDetail.client_name}</div>
                <div><span className="text-muted-foreground">الهاتف: </span><span dir="ltr">{shownDetail.client_phone || "—"}</span></div>
                {shownDetail.account_name && <div><span className="text-muted-foreground">الحساب: </span>{shownDetail.account_name}</div>}
                {shownDetail.valid_until && <div><span className="text-muted-foreground">ساري حتى: </span>{shownDetail.valid_until}</div>}
              </div>
              <div className="space-y-2">
                {shownDetail.items.map((i) => (
                  <div key={i.id} className="flex justify-between p-2 bg-muted rounded text-sm">
                    <span>{i.product_name} × {formatQty(i.quantity)}</span>
                    <span className="font-medium">{formatMoney(i.total_price)}</span>
                  </div>
                ))}
                {shownDetail.jobs.map((j) => (
                  <div key={j.id} className="flex justify-between p-2 bg-muted rounded text-sm">
                    <span>{serviceLabel(j.job_type)}{j.contractor_name ? ` - ${j.contractor_name}` : ""}</span>
                    <span className="font-medium">{formatMoney(j.charge_to_client)}</span>
                  </div>
                ))}
              </div>
              {shownDetail.notes && <p className="text-sm bg-muted/60 rounded p-2">{shownDetail.notes}</p>}
              <div className="p-4 bg-accent rounded-lg space-y-1 text-sm">
                {Number(shownDetail.discount) > 0 && <div className="flex justify-between"><span>الخصم:</span><span>{formatMoney(shownDetail.discount)}</span></div>}
                <div className="flex justify-between text-lg font-bold"><span>الإجمالي:</span><span className="text-primary">{formatMoney(shownDetail.grand_total)}</span></div>
                {isAdmin && shownDetail.profit !== undefined && (
                  <div className="flex justify-between border-t border-dashed border-border pt-2 mt-1">
                    <span className="text-muted-foreground">التكلفة {"→"} الربح (للمدير):</span>
                    <span>{formatMoney(shownDetail.cost_total ?? 0)} {"→"} <b className={shownDetail.profit < 0 ? "text-destructive" : "text-green-600"}>{formatMoney(shownDetail.profit)}</b></span>
                  </div>
                )}
              </div>
              {shownDetail.status === "PENDING" && (
                <Button variant="brand" className="w-full" disabled={shownDetail.is_expired} onClick={() => setAcceptTarget(shownDetail)}>
                  <ArrowRightCircle className="w-4 h-4 ml-2" /> قبول العرض وتحويله إلى أمر بيع
                </Button>
              )}
              {shownDetail.is_expired && (
                <p className="text-xs text-destructive flex items-center gap-1"><Ban className="w-3 h-3" /> انتهت صلاحية العرض: عدّل تاريخ الصلاحية لتتمكن من قبوله.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Accept confirmation */}
      <Dialog open={acceptTarget !== null} onOpenChange={(v) => !v && !acceptOffer.isPending && setAcceptTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>قبول العرض OF-{acceptTarget?.id}</DialogTitle>
          </DialogHeader>
          {acceptTarget && (
            <div className="space-y-4 py-2 text-sm">
              <p>
                سيُنشأ <b>أمر بيع جديد</b> للعميل <b>{acceptTarget.client_name}</b> بالمنتجات والخدمات والخصم نفسها
                (الإجمالي {formatMoney(acceptTarget.grand_total)}).
              </p>
              <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
                <li>لن يتغير المخزون الآن؛ يُخصم عند إنهاء أمر البيع.</li>
                <li>يصبح العرض «مقبولاً» ولا يمكن تعديله بعد ذلك.</li>
              </ul>
              <div className="flex gap-2">
                <Button variant="brand" className="flex-1" onClick={handleAccept} disabled={acceptOffer.isPending}>
                  {acceptOffer.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                  نعم، أنشئ أمر البيع
                </Button>
                <Button variant="outline" onClick={() => setAcceptTarget(null)} disabled={acceptOffer.isPending}>إلغاء</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
