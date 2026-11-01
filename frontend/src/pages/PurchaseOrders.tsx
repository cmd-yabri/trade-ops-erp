import { useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  FileDown,
  Eye,
  Undo2,
  History,
  Loader2,
  CreditCard,
  Trash2,
  CheckCircle2,
  XCircle,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  usePurchaseOrders,
  useCreatePurchaseOrder,
  useAddPayment,
  useUpdatePurchaseOrder,
  useDeletePurchaseOrder,
  useCancelPurchaseOrder,
  useReceivePurchaseOrder,
  useSetTransport,
} from "@/hooks/usePurchases";
import { useProducts } from "@/hooks/useInventory";
import { Skeleton } from "@/components/ui/skeleton";
import { PurchaseOrder, ReceiveRequest, TransportPayee } from "@/types/api";
import { ReceiveDialog } from "@/components/purchase/ReceiveDialog";
import { ReturnDialog } from "@/components/ReturnDialog";
import { PurchaseDetails } from "@/components/purchase/PurchaseDetails";
import { EditLogDialog } from "@/components/EditLogDialog";
import { useDeletePurchaseReturn, usePurchaseReturn } from "@/hooks/useHistory";
import { ReturnRequest } from "@/types/history";
import { TransportDialog } from "@/components/purchase/TransportDialog";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/contexts/AuthContext";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/TablePagination";
import { QuantityInput } from "@/components/QuantityInput";
import { formatDate, formatMoney, formatQty } from "@/lib/utils";
import { PaymentBadge } from "@/components/PaymentBadge";
import { useCompany } from "@/hooks/useCompany";
import { companyHeaderHtml, escapeHtml, printBaseCss } from "@/lib/print";
import { todayLocal, round2 } from "@/lib/utils";
import { PaymentDialog } from "@/components/PaymentDialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { WhatsappButton } from "@/components/WhatsappButton";
import { PaymentsAction, RemovePaymentsDialog } from "@/components/RemovePaymentsDialog";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useAccounts } from "@/hooks/useModules";
import { purchaseOrderMessage } from "@/lib/messages";
import { MoneyInput } from "@/types/modules";
import { confirmMoneyAction } from "@/lib/confirmMoneyAction";
const safeString = (value: unknown) => (typeof value === "string" ? value : "");

const safeNumber = (value: unknown) =>
  typeof value === "number" ? value : Number(value) || 0;

export default function PurchaseOrders() {
  const { data: orders, isLoading } = usePurchaseOrders();
  const { data: products } = useProducts();
  const createOrder = useCreatePurchaseOrder();
  const updateOrder = useUpdatePurchaseOrder();
  const deleteOrder = useDeletePurchaseOrder();
  const addPayment = useAddPayment();
  const cancelOrder = useCancelPurchaseOrder();
  const receiveOrder = useReceivePurchaseOrder();
  const setTransport = useSetTransport();
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [returning, setReturning] = useState<PurchaseOrder | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [logFor, setLogFor] = useState<number | null>(null);
  const purchaseReturn = usePurchaseReturn();
  const deleteReturn = useDeletePurchaseReturn();
  const [transporting, setTransporting] = useState<PurchaseOrder | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [originalTransport, setOriginalTransport] = useState("0|CARRIER");
  const [removing, setRemoving] = useState<{ order: PurchaseOrder; mode: "delete" | "cancel" } | null>(null);

  const [paymentDialog, setPaymentDialog] = useState<{
    open: boolean;
    poId: number | null;
    totalAmount?: number;
    paidAmount?: number;
  }>({
    open: false,
    poId: null,
  });


  const initialOrderState = {
    supplier: "",
    supplier_phone: "", // only for a one-off supplier; account suppliers use the account's phone
    order_date: todayLocal(),
    // id: kept on an edit of a received order so each line keeps what arrived of it
    items: [{ product: 0, quantity: 1, unit_cost: "" }] as { id?: number; product: number; quantity: number; unit_cost: string }[],
    discount: "0",
    transport_cost: "", // اجرة النقل والتحميل (optional, can be filled in later)
    transport_payee: "CARRIER" as TransportPayee,
    account: "" as string, // supplier account id ("" = a one-off supplier typed by name)
    branch: "" as string, // the branch that receives the goods
  };

  const [newOrder, setNewOrder] = useState(initialOrderState);

  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { data: company } = useCompany();
  const { features, branches, branchId } = useFeatures();
  const { data: accounts = [] } = useAccounts(features.accounts);
  const inventory = products || [];

  const formatCurrency = (amount: any) => {
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return (Number(num || 0) < 0 ? "‎" : "") + new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Number(num || 0) % 1 ? 2 : 0,  // $20.50, never $20.5
    }).format(num || 0);
  };

  const getOrderStatusBadge = (status: PurchaseOrder["status"]) => {
    if (status === "PARTIAL")
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200">مستلم جزئياً</Badge>;
    if (status === "RECEIVED")
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">مستلم</Badge>;
    if (status === "CANCELLED")
      return <Badge className="bg-gray-100 text-gray-600 border-gray-200">ملغى</Badge>;
    return <Badge className="bg-blue-100 text-blue-700 border-blue-200">قيد الانتظار</Badge>;
  };

  // --- Actions ---
  const handleEditOpen = (order: any) => {
    setEditingId(order.id);
    setOriginalTransport(`${Number(order.transport_cost) || 0}|${order.transport_payee ?? "CARRIER"}`);
    setNewOrder({
      supplier: order.supplier,
      supplier_phone: order.supplier_phone ?? "",
      order_date:
        order.order_date ||
        order.created_at?.split("T")[0] ||
        todayLocal(),
      items: order.items.map((i: any) => ({
        id: i.id,
        product: i.product,
        quantity: i.quantity,
        unit_cost: String(Number(i.unit_cost)),
      })),
      discount: String(order.discount || "0"),
      transport_cost: Number(order.transport_cost) > 0 ? String(order.transport_cost) : "",
      transport_payee: order.transport_payee ?? "CARRIER",
      account: order.account ? String(order.account) : "",
      branch: order.branch ? String(order.branch) : "",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    const items = newOrder.items.filter((i) => i.product > 0);
    if (!newOrder.supplier.trim()) {
      toast({ title: "خطأ", description: "أدخل اسم المورد.", variant: "destructive" });
      return;
    }
    if (items.length === 0) {
      toast({ title: "خطأ", description: "أضف منتجاً واحداً على الأقل.", variant: "destructive" });
      return;
    }
    if (items.some((i) => !(i.quantity > 0) || i.unit_cost === "" || !(parseFloat(String(i.unit_cost)) >= 0))) {
      toast({
        title: "خطأ",
        description: "تحقق من الكمية (1 فأكثر) وسعر الوحدة لكل منتج.",
        variant: "destructive",
      });
      return;
    }
    const itemTotal = items.reduce((sum, item) => sum + item.quantity * parseFloat(String(item.unit_cost)), 0);
    const purchaseTotal = Math.max(0, itemTotal - (parseFloat(newOrder.discount) || 0)
      + (parseFloat(newOrder.transport_cost) || 0));
    if (!await confirmMoneyAction(
      `${editingId ? "حفظ تعديلات" : "إنشاء"} أمر شراء للمورد ${newOrder.supplier.trim()} بإجمالي تقريبي ${formatMoney(purchaseTotal)}؟`,
    )) return;
    try {
      const transportChanged =
        !editingId ||
        `${parseFloat(newOrder.transport_cost) || 0}|${newOrder.transport_payee}` !== originalTransport;
      const payload = {
        supplier: newOrder.supplier.trim(),
        supplier_phone: newOrder.account ? "" : newOrder.supplier_phone.trim(),
        order_date: newOrder.order_date,
        items,
        discount: newOrder.discount || "0",
        // the fee goes along only when it changed (a carrier paid in SYP keeps its record otherwise)
        ...(transportChanged ? { transport_cost: newOrder.transport_cost || "0", transport_payee: newOrder.transport_payee } : {}),
        account: newOrder.account ? Number(newOrder.account) : null,
        branch: newOrder.branch ? Number(newOrder.branch) : branchId ?? undefined,
      };

      if (editingId) {
        await updateOrder.mutateAsync({ id: editingId, data: payload });
        toast({ title: "تم التحديث", description: "تم تحديث أمر الشراء بنجاح" });
      } else {
        await createOrder.mutateAsync(payload);
        toast({ title: "تم الإنشاء", description: "تم إنشاء أمر الشراء بنجاح" });
      }

      setIsDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({
        title: "خطأ",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const removeOrder = async (mode: "delete" | "cancel", id: number, payments?: PaymentsAction) => {
    try {
      if (mode === "delete") {
        await deleteOrder.mutateAsync({ id, payments });
        toast({ title: "تم الحذف", description: "تم حذف أمر الشراء بنجاح" });
      } else {
        await cancelOrder.mutateAsync({ id, payments });
        toast({ title: "تم الإلغاء", description: "تم إلغاء أمر الشراء." });
      }
      setRemoving(null);
    } catch (error) {
      toast({
        title: "خطأ",
        description: getErrorMessage(error, mode === "delete" ? "فشل حذف الطلب" : "فشل إلغاء الطلب"),
        variant: "destructive",
      });
    }
  };

  // A paid order asks where the money went (refund / supplier credit) instead of a plain confirm.
  const handleDelete = async (order: PurchaseOrder) => {
    if (safeNumber(order.paid_amount) > 0) return setRemoving({ order, mode: "delete" });
    if (await confirmMoneyAction(`حذف أمر الشراء PO-${order.id} بقيمة ${formatMoney(Number(order.net_total))}؟`)) removeOrder("delete", order.id);
  };

  const handlePaymentSubmit = async (money: MoneyInput, date: string) => {
    if (!paymentDialog.poId) return;
    try {
      await addPayment.mutateAsync({
        poId: paymentDialog.poId,
        payment: {
          ...money,
          payment_date: date,
        },
      });
      toast({
        title: "تم تسجيل الدفع",
        description: "تم تحديث حالة الدفع للطلب",
      });
      setPaymentDialog({ open: false, poId: null });
    } catch (error) {
      toast({
        title: "خطأ",
        description: getErrorMessage(error, "فشل تسجيل الدفع"),
        variant: "destructive",
      });
    }
  };

  const handleExportPDF = (order: any) => {
    if (typeof (window as any).pywebview !== "undefined") {
      // Use PyWebView API for printing - pass HTML content
      const htmlContent = generatePOPrintHTML(order);
      (window as any).pywebview.api.open_print_window(htmlContent);
    } else {
      // Fallback for browser version
      const printWindow = window.open("", "_blank");
      if (!printWindow) return;
      printWindow.document.write(generatePOPrintHTML(order));
      printWindow.document.close();
    }
  };

  const generatePOPrintHTML = (order: any) => {
    const itemsHtml = order.items
      .map(
        (item: any) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${
          escapeHtml(item.product_name) || "منتج"
        }</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${
          item.quantity
        }</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatCurrency(
          item.unit_cost,
        )}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatCurrency(
          item.quantity * item.unit_cost,
        )}</td>
      </tr>
    `,
      )
      .join("");

    const paymentsHtml =
      order.payments && order.payments.length > 0
        ? `
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;">
        <h4 style="margin: 0 0 10px 0; font-weight: bold;">سجل الدفعات:</h4>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="background-color: #f8f9fa; padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">التاريخ</th>
              <th style="background-color: #f8f9fa; padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">المبلغ</th>
            </tr>
          </thead>
          <tbody>
            ${order.payments
              .map(
                (p: any) => `
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${formatDate(p.payment_date || p.date)}</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatCurrency(p.amount)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `
        : "";

    return `
      <html dir="rtl">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>PO-${order.id}</title>
          <style>
            ${printBaseCss}
            body { font-family: 'Arial', 'Tahoma', sans-serif; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 2px solid #f97316; padding-bottom: 20px; }
            .store-info { text-align: center; }
            .store-name { font-size: 1.5em; font-weight: bold; color: #f97316; }
            .store-phone { color: #666; margin-top: 5px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background-color: #f8f9fa; padding: 10px; text-align: right; border-bottom: 2px solid #dee2e6; }
            td { text-align: right; }
            .totals { margin-top: 30px; text-align: right; }
            .print-buttons { 
              text-align: center; 
              margin-top: 40px; 
              padding-top: 20px; 
              border-top: 2px solid #ddd; 
            }
            button { 
              padding: 10px 20px; 
              margin: 5px; 
              border: none; 
              border-radius: 4px; 
              cursor: pointer; 
              font-size: 16px; 
            }
            .btn-print { 
              background-color: #f97316; 
              color: white; 
            }
            .btn-close { 
              background-color: #6b7280; 
              color: white; 
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div><h1>أمر شراء</h1><p>رقم الأمر: PO-${order.id}</p></div>
            <div class="store-info">
              ${companyHeaderHtml(company)}
              <p>${formatDate(order.order_date || order.created_at)}</p>
            </div>
          </div>
          <div style="margin-bottom: 20px;"><strong>المورد:</strong> ${escapeHtml(order.supplier)}${
            order.supplier_phone ? ` &nbsp; <strong>الهاتف:</strong> ${escapeHtml(order.supplier_phone)}` : ""
          }</div>
          <table>
            <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <div class="totals">
            <p><strong>الإجمالي الكلي: ${formatCurrency(
              order.total_cost,
            )}</strong></p>
            <p>الخصم: ${formatCurrency(order.discount || 0)}</p>
            <p><strong>الكلي بعد الخصم: ${formatCurrency(
              order.net_total || order.total_cost,
            )}</strong></p>
            <p>المبلغ المدفوع: ${formatCurrency(order.paid_amount)}</p>
            <p style="color: red;">المتبقي: ${formatCurrency(
              (order.net_total || order.total_cost) - (order.paid_amount || 0),
            )}</p>
            ${paymentsHtml}
          </div>
          <div class="print-buttons">
            <button class="btn-print" onclick="window.print()">طباعة / حفظ PDF</button>
            <button class="btn-close" onclick="window.pywebview ? window.pywebview.api.close() : window.close()">إغلاق</button>
          </div>
          <script>
            // Auto-print when window loads (for PyWebView)
            window.addEventListener('load', function() {
              setTimeout(function() {
                if (typeof window.print === 'function') {
                  window.print();
                }
              }, 500);
            });
          </script>
        </body>
      </html>
    `;
  };

  // Receiving adds the goods to stock and updates the average cost.
  const handleReceive = async (request: ReceiveRequest) => {
    if (!receiving) return;
    if (!await confirmMoneyAction(
      `استلام ${request.items?.length ? "الكميات المحددة" : "كل الكميات المتبقية"} من أمر الشراء PO-${receiving.id}، بقيمة الأمر ${formatMoney(Number(receiving.net_total))}؟`,
    )) return;
    try {
      const po = await receiveOrder.mutateAsync({ poId: receiving.id, request });
      toast({
        title: po.status === "RECEIVED" ? "تم الاستلام بالكامل" : "تم استلام جزء من الطلب",
        description: "أُضيفت الكميات إلى المخزون وأصبح سعر هذا الشراء هو تكلفة المنتج.",
      });
      setReceiving(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const handleReturn = async (data: ReturnRequest) => {
    if (!returning) return;
    try {
      await purchaseReturn.mutateAsync({ poId: returning.id, data });
      toast({ title: "تم تسجيل المرتجع إلى المورد" });
      setReturning(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const handleDeleteReturn = async (poId: number, returnId: number) => {
    if (!await confirmMoneyAction("إلغاء هذا المرتجع؟ ستُعكس آثاره على قيمة أمر الشراء ورصيد المورد.")) return;
    try {
      await deleteReturn.mutateAsync({ poId, returnId });
      toast({ title: "تم إلغاء المرتجع" });
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const handleTransport = async (data: MoneyInput & { payee: TransportPayee; date?: string }) => {
    if (!transporting) return;
    const amount = data.currency === "SYP" && data.paid_amount
      ? `${Number(data.paid_amount).toLocaleString("en-US")} ل.س`
      : formatMoney(Number(data.amount ?? 0));
    if (!await confirmMoneyAction(
      `تسجيل/تعديل أجرة النقل لأمر الشراء PO-${transporting.id} بقيمة ${amount}، والدافع ${data.payee === "CARRIER" ? "الناقل" : "المورد"}؟`,
    )) return;
    try {
      await setTransport.mutateAsync({ poId: transporting.id, data });
      toast({ title: "تم حفظ أجرة النقل", description: "تحدثت تكلفة المنتجات." });
      setTransporting(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const handleCancel = async (order: PurchaseOrder) => {
    if (safeNumber(order.paid_amount) > 0) return setRemoving({ order, mode: "cancel" });
    if (await confirmMoneyAction(`إلغاء أمر الشراء PO-${order.id} بقيمة ${formatMoney(Number(order.net_total))}؟`)) removeOrder("cancel", order.id);
  };

  const resetForm = () => {
    setEditingId(null);
    setNewOrder(initialOrderState);
  };

  const removeItem = (index: number) => {
    const updatedItems = [...newOrder.items];
    updatedItems.splice(index, 1);
    setNewOrder({ ...newOrder, items: updatedItems });
  };

  const filteredOrders = (orders || []).filter((o) =>
    (o?.supplier ?? "").toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const pager = usePagination(filteredOrders, 10, searchQuery);

  if (isLoading) return <Skeleton className="h-96 w-full mt-10" />;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
            أوامر الشراء
          </h1>
          <p className="text-muted-foreground mt-1">
            إدارة المشتريات والمدفوعات
          </p>
        </div>

        <Dialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button variant="brand" className="gap-2">
              <Plus className="w-4 h-4" /> إضافة أمر شراء
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId
                  ? `تعديل أمر PO-${editingId}`
                  : "إنشاء أمر شراء جديد"}
              </DialogTitle>
            </DialogHeader>
            {editingId && (orders || []).find((o) => o.id === editingId)?.status !== "PENDING" && (
              <p className="text-sm rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-3 mt-2">
                هذا أمر وصلت بضاعته: يمكن تعديل الأسعار والخصم والمورد وزيادة الكميات أو إضافة بنود. لا يمكن إنقاص كمية
                عمّا وصل (استخدم المرتجع). تتحدث تكلفة المنتجات ويُسجَّل التعديل باسمك.
              </p>
            )}
            {(features.accounts || features.branches) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 mt-4 rounded-lg border border-border">
                {features.accounts && (
                  <div className="space-y-2">
                    <Label>حساب المورد</Label>
                    <SimpleSelect
                      value={newOrder.account || "none"}
                      onChange={(v) => {
                        if (v === "none") {
                          setNewOrder({ ...newOrder, account: "" });
                          return;
                        }
                        const acc = accounts.find((a) => String(a.id) === v);
                        setNewOrder({ ...newOrder, account: v, supplier: acc?.name ?? newOrder.supplier });
                      }}
                      options={[
                        { value: "none", label: "مورد عابر (بدون حساب)" },
                        ...accounts
                          .filter((a) => a.is_supplier && a.is_active)
                          .map((a) => ({ value: String(a.id), label: a.name })),
                      ]}
                    />
                  </div>
                )}
                {features.branches && (
                  <div className="space-y-2">
                    <Label>الفرع المستلِم</Label>
                    <SimpleSelect
                      value={
                        newOrder.branch ||
                        (branchId ? String(branchId) : String(branches.find((b) => b.is_default)?.id ?? ""))
                      }
                      onChange={(v) => setNewOrder({ ...newOrder, branch: v })}
                      disabled={!!editingId}
                      options={branches.filter((b) => b.is_active).map((b) => ({ value: String(b.id), label: b.name }))}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="supplier">اسم المورد</Label>
                <Input
                  type="text"
                  id="supplier"
                  placeholder="أدخل اسم المورد هنا..."
                  value={newOrder.supplier}
                  onChange={(e) =>
                    setNewOrder({ ...newOrder, supplier: e.target.value })
                  }
                />
              </div>
              {!newOrder.account && (
                <div className="space-y-2">
                  <Label htmlFor="supplierPhone">هاتف المورد (اختياري)</Label>
                  <Input
                    type="tel"
                    id="supplierPhone"
                    dir="ltr"
                    className="text-right"
                    placeholder="09XXXXXXXX"
                    value={newOrder.supplier_phone}
                    onChange={(e) => setNewOrder({ ...newOrder, supplier_phone: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="orderDate">تاريخ الطلب</Label>
                <Input
                  id="orderDate"
                  type="date"
                  value={newOrder.order_date}
                  onChange={(e) =>
                    setNewOrder({ ...newOrder, order_date: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between border-b pb-2">
                <Label className="text-lg font-bold">عناصر الفاتورة</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setNewOrder({
                      ...newOrder,
                      items: [
                        ...newOrder.items,
                        { product: 0, quantity: 1, unit_cost: "" },
                      ],
                    })
                  }
                >
                  <Plus className="w-4 h-4 ml-1" /> إضافة عنصر
                </Button>
              </div>
              {newOrder.items.map((item, index) => (
                <div
                  key={index}
                  className="relative space-y-2 p-3 bg-muted/50 rounded-lg border group"
                >
                  {/* ADDED: Delete Item Button */}
                  {newOrder.items.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute -top-2 -left-2 h-7 w-7 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeItem(index)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        المنتج
                      </Label>
                      <Select
                        value={String(item.product)}
                        onValueChange={(v) => {
                          const items = [...newOrder.items];
                          items[index].product = parseInt(v);
                          // start from the last price paid; the user can still change it
                          const last = inventory.find((p) => p.id === parseInt(v))?.unit_cost;
                          if (items[index].unit_cost === "" && last !== undefined) {
                            items[index].unit_cost = String(Number(last));
                          }
                          setNewOrder({ ...newOrder, items });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="اختر المنتج" />
                        </SelectTrigger>
                        <SelectContent>
                          {inventory.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        الكمية
                      </Label>
                      <QuantityInput
                        allowDecimal={!!products?.find((p) => p.id === item.product)?.allow_decimal}
                        value={item.quantity}
                        onChange={(n) => {
                          const items = [...newOrder.items];
                          items[index].quantity = n;
                          setNewOrder({ ...newOrder, items });
                        }}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        سعر الوحدة
                      </Label>
                      <Input
                        value={item.unit_cost}
                        onChange={(e) => {
                          const items = [...newOrder.items];
                          items[index].unit_cost = e.target.value;
                          setNewOrder({ ...newOrder, items });
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground text-left">
                    المجموع: {formatCurrency(round2((Number(item.quantity) || 0) * (parseFloat(String(item.unit_cost)) || 0)))}
                  </p>
                </div>
              ))}

              {/* Discount Input */}
              <div className="space-y-2 p-3 bg-muted/50 rounded-lg border">
                <Label htmlFor="discount">الخصم</Label>
                <Input
                  id="discount"
                  type="number"
                  placeholder="أدخل قيمة الخصم"
                  value={newOrder.discount}
                  onChange={(e) =>
                    setNewOrder({ ...newOrder, discount: e.target.value })
                  }
                  step="0.01"
                  min="0"
                />
              </div>

              <div className="space-y-2 p-3 bg-muted/50 rounded-lg border">
                <Label>أجرة النقل والتحميل (اختياري، يمكن إضافتها لاحقاً)</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0"
                    value={newOrder.transport_cost}
                    onChange={(e) => setNewOrder({ ...newOrder, transport_cost: e.target.value })}
                  />
                  <SimpleSelect
                    value={newOrder.transport_payee}
                    onChange={(v) => setNewOrder({ ...newOrder, transport_payee: v as TransportPayee })}
                    options={[
                      { value: "CARRIER", label: "لناقل مستقل (تُدفع الآن من الصندوق)" },
                      { value: "SUPPLIER", label: "على فاتورة المورد" },
                    ]}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  تُوزَّع الأجرة على المنتجات حسب قيمتها وتدخل في تكلفتها.
                </p>
              </div>

              {(() => {
                const subtotal = round2(
                  newOrder.items.reduce(
                    (s, i) => s + (Number(i.quantity) || 0) * (parseFloat(String(i.unit_cost)) || 0),
                    0,
                  ),
                );
                const discount = parseFloat(String(newOrder.discount)) || 0;
                const transport = parseFloat(String(newOrder.transport_cost)) || 0;
                const onBill = newOrder.transport_payee === "SUPPLIER" ? transport : 0;
                return (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>المجموع:</span>
                      <span>{formatCurrency(subtotal)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between">
                        <span>الخصم:</span>
                        <span>-{formatCurrency(discount)}</span>
                      </div>
                    )}
                    {transport > 0 && (
                      <div className="flex justify-between">
                        <span>أجرة النقل{onBill ? " (على فاتورة المورد)" : " (لناقل مستقل)"}:</span>
                        <span>{formatCurrency(transport)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-base border-t pt-1">
                      <span>الإجمالي المستحق للمورد:</span>
                      <span className="text-primary">{formatCurrency(round2(subtotal - discount + onBill))}</span>
                    </div>
                    {transport > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>تكلفة البضاعة الفعلية:</span>
                        <span>{formatCurrency(round2(subtotal - discount + transport))}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              <Button
                variant="brand"
                className="w-full mt-4"
                onClick={handleSubmit}
                disabled={createOrder.isPending || updateOrder.isPending}
              >
                {(createOrder.isPending || updateOrder.isPending) && (
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                )}
                {editingId ? "حفظ التعديلات" : "إرسال طلب الشراء"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Table Section */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-sm font-medium">رقم الأمر</th>
                <th className="px-4 py-3 text-sm font-medium">المورد</th>
                <th className="px-4 py-3 text-sm font-medium">الإجمالي</th>
                <th className="px-4 py-3 text-sm font-medium">المدفوع</th>
                <th className="px-4 py-3 text-sm font-medium">المتبقي</th>
                <th className="px-4 py-3 text-sm font-medium">حالة الدفع</th>
                <th className="px-4 py-3 text-sm font-medium">التاريخ</th>
                <th className="px-4 py-3 text-sm font-medium">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pager.pageItems.map((order) => {
                  const remaining = round2(Number(order.remaining ?? 0));
                  const due = Number(order.due_total ?? order.net_total ?? order.total_cost);
                  return (
                    <tr key={order.id} className="hover:bg-muted/30">
                      <td className="px-4 py-4 text-sm font-medium">
                        <div className="flex flex-col gap-1 items-start">
                          <span>PO-{order.id}</span>
                          {getOrderStatusBadge(order.status)}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm">
                        {safeString(order.supplier) || "-"}
                        {order.supplier_phone && (
                          <div className="text-xs text-muted-foreground" dir="ltr">{order.supplier_phone}</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm font-bold">
                        {formatCurrency(due)}
                        {Number(order.returned_total) > 0 && (
                          <div className="text-xs font-normal text-amber-700">مرتجع -{formatCurrency(order.returned_total ?? 0)}</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-green-600">
                        {formatCurrency(order.paid_amount)}
                      </td>
                      <td className="px-4 py-4 text-sm text-destructive">
                        {formatCurrency(remaining)}
                      </td>
                      <td className="px-4 py-4">
                        <PaymentBadge status={order.payment_status} />
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        {formatDate(order.order_date || order.created_at)}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-start gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="التفاصيل"
                            className="h-8 w-8"
                            onClick={() => setViewingId(order.id)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {(order.status === "PENDING" || (isAdmin && (order.status === "RECEIVED" || order.status === "PARTIAL"))) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title={order.status === "PENDING" ? "تعديل" : "تعديل أمر مستلم (للمدير)"}
                              className="h-8 w-8 text-blue-500"
                              onClick={() => handleEditOpen(order)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          )}
                          {(order.status === "RECEIVED" || order.status === "PARTIAL") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="مرتجع إلى المورد"
                              className="h-8 w-8 text-amber-600"
                              onClick={() => setReturning(order)}
                            >
                              <Undo2 className="w-4 h-4" />
                            </Button>
                          )}
                          {isAdmin && (order.status === "PENDING" || order.status === "CANCELLED") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDelete(order)}
                              disabled={deleteOrder.isPending}
                            >
                              {deleteOrder.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-600"
                            disabled={order.status === "CANCELLED" || remaining <= 0}
                            onClick={() =>
                              setPaymentDialog({
                                open: true,
                                poId: order.id,
                                totalAmount: due,
                                paidAmount: order.paid_amount,
                              })
                            }
                          >
                            <CreditCard className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => handleExportPDF(order)}
                          >
                            <FileDown className="w-4 h-4" />
                          </Button>
                          <WhatsappButton
                            iconOnly
                            phone={accounts.find((a) => a.id === order.account)?.phone || order.supplier_phone}
                            message={() => purchaseOrderMessage(order, company?.name)}
                          />
                          {order.status !== "CANCELLED" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="أجرة النقل والتحميل"
                              className="h-8 w-8 text-sky-600"
                              onClick={() => setTransporting(order)}
                            >
                              <Truck className="w-4 h-4" />
                            </Button>
                          )}
                          {(order.status === "PENDING" || order.status === "PARTIAL") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="استلام البضاعة"
                              className="h-8 w-8 text-orange-500 hover:text-orange-600 hover:bg-orange-50"
                              onClick={() => setReceiving(order)}
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </Button>
                          )}
                          {order.status === "PENDING" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="إلغاء الطلب"
                                className="h-8 w-8 text-muted-foreground"
                                onClick={() => handleCancel(order)}
                                disabled={cancelOrder.isPending}
                              >
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
      <TablePagination pager={pager} />

      <PaymentDialog
        open={paymentDialog.open}
        onOpenChange={(v) => setPaymentDialog((prev) => ({ ...prev, open: v }))}
        title={`تسجيل دفعة للطلب PO-${paymentDialog.poId}`}
        total={Number(paymentDialog.totalAmount) || 0}
        paid={Number(paymentDialog.paidAmount) || 0}
        pending={addPayment.isPending}
        format={formatCurrency}
        moneyEnabled={features.money_boxes}
        onSubmit={handlePaymentSubmit}
      />

      {returning && (
        <ReturnDialog
          open
          onOpenChange={(v) => !v && setReturning(null)}
          kind="purchase"
          title={`مرتجع إلى المورد من PO-${returning.id}`}
          paid={Number(returning.paid_amount ?? 0)}
          worth={Number(returning.due_total ?? returning.net_total ?? 0)}
          accountName={returning.account ? returning.account_name : undefined}
          pending={purchaseReturn.isPending}
          onSubmit={handleReturn}
          lines={returning.items
            .map((i) => {
              const total = Number(returning.total_cost) || 0;
              const factor = total > 0 ? (total - Number(returning.discount || 0)) / total : 1;
              return {
                id: i.id,
                product_name: i.product_name,
                max: Number(i.received_quantity) - Number(i.returned_quantity ?? 0),
                allowDecimal: !!inventory.find((p) => p.id === i.product)?.allow_decimal,
                unitValue: Math.round(Number(i.unit_cost) * factor * 10000) / 10000,
                place: `branch:${returning.branch ?? ""}`,
              };
            })
            .filter((l) => l.max > 0)}
        />
      )}
      <PurchaseDetails
        order={(orders || []).find((o) => o.id === viewingId) ?? null}
        onClose={() => setViewingId(null)}
        format={formatCurrency}
        isAdmin={isAdmin}
        onDeleteReturn={handleDeleteReturn}
        onShowLog={(id) => setLogFor(id)}
      />
      <EditLogDialog docType="PO" docId={logFor} onOpenChange={(v) => !v && setLogFor(null)} />

      <ReceiveDialog
        order={receiving}
        onOpenChange={(v) => !v && setReceiving(null)}
        pending={receiveOrder.isPending}
        onSubmit={handleReceive}
      />
      <TransportDialog
        order={transporting}
        onOpenChange={(v) => !v && setTransporting(null)}
        pending={setTransport.isPending}
        onSubmit={handleTransport}
      />

      <RemovePaymentsDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`${removing?.mode === "cancel" ? "إلغاء" : "حذف"} أمر الشراء PO-${removing?.order.id ?? ""}`}
        paidText={formatCurrency(removing?.order.paid_amount ?? 0)}
        kind="purchase"
        accountName={removing?.order.account ? removing.order.account_name : undefined}
        confirmLabel={removing?.mode === "cancel" ? "إلغاء أمر الشراء" : "حذف أمر الشراء"}
        pending={deleteOrder.isPending || cancelOrder.isPending}
        onConfirm={(action) => removing && removeOrder(removing.mode, removing.order.id, action)}
      />
    </div>
  );
}
