import { useState } from "react";
import {
  Plus,
  Search,
  FileText,
  Trash2,
  CheckCircle,
  Eye,
  Loader2,
  Pencil,
  CreditCard,
  Undo2,
  History,
} from "lucide-react";
import { ReturnDialog } from "@/components/ReturnDialog";
import { EditLogDialog } from "@/components/EditLogDialog";
import { useDeleteSalesReturn, useSalesReturn } from "@/hooks/useHistory";
import { ReturnRequest } from "@/types/history";
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
  useSalesOrders,
  useCreateSalesOrder,
  useFinalizeOrder,
  useUpdateSalesOrder,
  useDeleteSalesOrder,
  useAddSalesPayment,
} from "@/hooks/useSales";
import { useProducts } from "@/hooks/useInventory";
import { Skeleton } from "@/components/ui/skeleton";
import { SalesOrder, JobTypeEnum, SalesOrderCreate } from "@/types/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/contexts/AuthContext";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/TablePagination";
import { QuantityInput } from "@/components/QuantityInput";
import { formatDate, formatMoney, formatQty, todayLocal } from "@/lib/utils";
import { PaymentBadge } from "@/components/PaymentBadge";
import { SimpleSelect } from "@/components/SimpleSelect";
import { WhatsappButton } from "@/components/WhatsappButton";
import { PaymentsAction, RemovePaymentsDialog } from "@/components/RemovePaymentsDialog";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useAccounts, useCars } from "@/hooks/useModules";
import { salesOrderMessage } from "@/lib/messages";
import { MoneyInput } from "@/types/modules";
import { PaymentDialog } from "@/components/PaymentDialog";
import { useCompany } from "@/hooks/useCompany";
import { companyHeaderHtml, escapeHtml, printBaseCss } from "@/lib/print";
import { confirmMoneyAction } from "@/lib/confirmMoneyAction";

export default function SalesOrders() {
  const { data: orders, isLoading } = useSalesOrders();
  const { data: products } = useProducts();
  const createOrder = useCreateSalesOrder();
  const updateOrder = useUpdateSalesOrder();
  const finalizeOrder = useFinalizeOrder();
  const deleteOrder = useDeleteSalesOrder();
  const addPayment = useAddSalesPayment();

  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [removing, setRemoving] = useState<SalesOrder | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [returning, setReturning] = useState<SalesOrder | null>(null);
  const [logFor, setLogFor] = useState<number | null>(null);
  const salesReturn = useSalesReturn();
  const deleteReturn = useDeleteSalesReturn();

  const [paymentDialog, setPaymentDialog] = useState<{
    open: boolean;
    orderId: number | null;
    grandTotal?: number;
    totalPaid?: number;
  }>({
    open: false,
    orderId: null,
  });


  const initialOrderState = {
    sale_date: todayLocal(), // the invoice's day (can be set back for a late entry)
    client_name: "",
    client_phone: "",
    client_address: "",
    // source: "" = the order's place, else "branch:ID" / "car:ID" for this line only
    items: [] as { product: number; quantity: number; unit_price: string; source: string }[],
    freelance_jobs: [] as {
      job_type: JobTypeEnum;
      contractor_name: string;
      cost_to_company: string;
      charge_to_client: string;
    }[],
    discount: "0",
    account: "" as string, // wholesale account id ("" = individual customer)
    branch: "" as string,
    car: "" as string, // sell from this car's stock ("" = the branch)
  };

  const [newOrder, setNewOrder] = useState(initialOrderState);
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { data: company } = useCompany();
  const { features, branches, branchId } = useFeatures();
  const { data: accounts = [] } = useAccounts(features.accounts);
  const { data: cars = [] } = useCars(features.cars);
  const selectedAccount = accounts.find((a) => String(a.id) === newOrder.account);
  // Where the goods come from decides which stock the picker shows.
  const stockOf = (inv: (typeof inventory)[number], source = "") => {
    const levels = inv.stock_by_location ?? [];
    if (source) {
      const [kind, id] = source.split(":");
      return levels.find((l) => l.kind === kind && String(l.id) === id)?.quantity ?? 0;
    }
    if (newOrder.car) return levels.find((l) => l.kind === "car" && String(l.id) === newOrder.car)?.quantity ?? 0;
    // the branch the order will be filed under: its own pick, else the header's, else the main branch
    const branch =
      newOrder.branch || (branchId ? String(branchId) : String(branches.find((b) => b.is_default)?.id ?? ""));
    if (features.branches && branch) return levels.find((l) => l.kind === "branch" && String(l.id) === branch)?.quantity ?? 0;
    return inv.current_stock ?? 0;
  };

  // "From" choices for one line: the order's own place, or any branch / car
  const sourceOptions = [
    { value: "order", label: "مكان الطلب" },
    ...(features.branches
      ? branches.filter((b) => b.is_active).map((b) => ({ value: `branch:${b.id}`, label: `فرع: ${b.name}` }))
      : []),
    ...(features.cars ? cars.filter((c) => c.is_active).map((c) => ({ value: `car:${c.id}`, label: `سيارة: ${c.name}` })) : []),
  ];

  const salesOrders = orders || [];
  // The details window always shows the latest copy of the order (after an edit, payment, return ...).
  const viewedOrder = selectedOrder ? (salesOrders.find((o) => o.id === selectedOrder.id) ?? selectedOrder) : null;
  const inventory = products || [];

  const filteredOrders = salesOrders.filter(
    (order) =>
      order.client_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(order.id).includes(searchQuery),
  );
  const pager = usePagination(filteredOrders, 9, searchQuery);

  const formatCurrency = (amount: string | number) => {
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return (Number(num) < 0 ? "‎" : "") + new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Number(num || 0) % 1 ? 2 : 0,  // $20.50, never $20.5
    }).format(num);
  };

  const getJobTypeArabic = (jobType: string): string => {
    const jobTypeMap: { [key: string]: string } = {
      STEEL: "عمل الحديد",
      ELECTRIC: "كهربائي",
      INSTALL: "تركيب",
      MOVING: "نقل و تحميل",
    };
    return jobTypeMap[jobType] || jobType;
  };

  const getStatusBadge = (isFinalized: boolean) => {
    if (isFinalized) {
      return (
        <Badge variant="outline" className="bg-accent text-accent-foreground">
          مكتمل
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="bg-warning/10 text-warning border-warning/20"
      >
        قيد المعالجة
      </Badge>
    );
  };

  const addItem = () => {
    setNewOrder({
      ...newOrder,
      items: [...newOrder.items, { product: 0, quantity: 1, unit_price: "0", source: "" }],
    });
  };

  const removeItem = (index: number) => {
    const updatedItems = newOrder.items.filter((_, i) => i !== index);
    setNewOrder({ ...newOrder, items: updatedItems });
  };

  const updateItem = (index: number, productId: number) => {
    const product = inventory.find((p) => p.id === productId);
    if (product) {
      const updatedItems = [...newOrder.items];
      updatedItems[index] = {
        ...updatedItems[index],
        product: product.id,
        // wholesale accounts get the wholesale price when the product has one
        unit_price:
          (selectedAccount && product.wholesale_price) || product.selling_price || product.unit_cost,
      };
      setNewOrder({ ...newOrder, items: updatedItems });
    }
  };

  const updateItemQuantity = (index: number, quantity: number) => {
    const updatedItems = [...newOrder.items];
    updatedItems[index] = { ...updatedItems[index], quantity };
    setNewOrder({ ...newOrder, items: updatedItems });
  };

  // Logic to handle "Create New" button vs "Edit"
  const handleOpenCreateDialog = () => {
    setSelectedOrder(null);
    setNewOrder({ ...initialOrderState, branch: branchId ? String(branchId) : "" });
    setIsDialogOpen(true);
  };

  const handleEditClick = (order: SalesOrder) => {
    setSelectedOrder(order);
    setNewOrder({
      sale_date: (order.finalized_at || order.date).slice(0, 10),
      client_name: order.client_name,
      client_phone: order.client_phone || "",
      client_address: order.client_address || "",
      items: order.items.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        unit_price: item.unit_price,
        source: item.car ? `car:${item.car}` : item.branch ? `branch:${item.branch}` : "",
      })),
      freelance_jobs: order.freelance_jobs.map((job) => ({
        job_type: job.job_type as JobTypeEnum,
        contractor_name: job.contractor_name,
        cost_to_company: job.cost_to_company,
        charge_to_client: job.charge_to_client,
      })),
      discount: String(order.discount ?? "0"),
      account: order.account ? String(order.account) : "",
      branch: order.branch ? String(order.branch) : "",
      car: order.car ? String(order.car) : "",
    });
    setIsDialogOpen(true);
  };

  const addFreelanceJob = () => {
    setNewOrder({
      ...newOrder,
      freelance_jobs: [
        ...newOrder.freelance_jobs,
        {
          job_type: "INSTALL" as JobTypeEnum,
          contractor_name: "",
          cost_to_company: "0",
          charge_to_client: "0",
        },
      ],
    });
  };

  const updateFreelanceJob = (index: number, field: string, value: string) => {
    const updatedJobs = [...newOrder.freelance_jobs];
    updatedJobs[index] = { ...updatedJobs[index], [field]: value };
    setNewOrder({ ...newOrder, freelance_jobs: updatedJobs });
  };

  const removeFreelanceJob = (index: number) => {
    const updatedJobs = newOrder.freelance_jobs.filter((_, i) => i !== index);
    setNewOrder({ ...newOrder, freelance_jobs: updatedJobs });
  };

  const calculateSubtotal = () => {
    return newOrder.items.reduce(
      (sum, item) => sum + item.quantity * parseFloat(item.unit_price || "0"),
      0,
    );
  };

  const calculateServiceTotal = () => {
    return newOrder.freelance_jobs.reduce(
      (sum, job) => sum + parseFloat(job.charge_to_client || "0"),
      0,
    );
  };

  const calculateTotal = () => {
    return calculateSubtotal() + calculateServiceTotal();
  };

  const calculateDiscount = () => {
    return parseFloat(newOrder.discount || "0");
  };

  const calculateGrandTotal = () => {
    return calculateTotal() - calculateDiscount();
  };

  // FIX: Unified Submit for both Create (POST) and Update (PUT)
  const handleSubmit = async () => {
    if (!newOrder.client_name.trim()) {
      toast({ title: "خطأ", description: "أدخل اسم العميل.", variant: "destructive" });
      return;
    }
    const validItems = newOrder.items.filter((i) => i.product > 0);
    if (validItems.length === 0 && newOrder.freelance_jobs.length === 0) {
      toast({ title: "خطأ", description: "أضف منتجاً أو خدمة واحدة على الأقل.", variant: "destructive" });
      return;
    }
    if (validItems.some((i) => !(i.quantity > 0))) {
      toast({ title: "خطأ", description: "الكمية يجب أن تكون أكبر من صفر.", variant: "destructive" });
      return;
    }
    if (calculateGrandTotal() < 0) {
      toast({ title: "خطأ", description: "الخصم أكبر من إجمالي الطلب.", variant: "destructive" });
      return;
    }
    if (!await confirmMoneyAction(
      `${selectedOrder ? "حفظ تعديلات" : "إنشاء"} طلب بيع للعميل ${newOrder.client_name.trim()} بإجمالي ${formatMoney(calculateGrandTotal())}؟`,
    )) return;
    try {
      const orderData: SalesOrderCreate = {
        client_name: newOrder.client_name,
        client_phone: newOrder.client_phone,
        client_address: newOrder.client_address,
        items: validItems.map((item) => {
          const [kind, id] = item.source ? item.source.split(":") : ["", ""];
          return {
            product: item.product,
            quantity: item.quantity,
            unit_price: item.unit_price,
            branch: kind === "branch" ? Number(id) : null,
            car: kind === "car" ? Number(id) : null,
          };
        }),
        freelance_jobs: newOrder.freelance_jobs.map((job) => ({
          job_type: job.job_type,
          contractor_name: job.contractor_name,
          cost_to_company: job.cost_to_company,
          charge_to_client: job.charge_to_client,
        })),
        discount: newOrder.discount,
        account: newOrder.account ? Number(newOrder.account) : null,
        branch: newOrder.branch ? Number(newOrder.branch) : undefined,
        car: newOrder.car ? Number(newOrder.car) : null,
        sale_date: newOrder.sale_date,
      };

      if (selectedOrder) {
        // Handle PUT (Update)
        await updateOrder.mutateAsync({
          id: selectedOrder.id,
          data: orderData,
        });
        toast({
          title: "تم تحديث الطلب",
          description: `تم تحديث بيانات الطلب SO-${selectedOrder.id} بنجاح.`,
        });
      } else {
        // Handle POST (Create)
        await createOrder.mutateAsync(orderData);
        toast({
          title: "تم إنشاء الطلب",
          description: `تم إنشاء طلب المبيعات للعميل ${newOrder.client_name}.`,
        });
      }

      setIsDialogOpen(false);
      setNewOrder(initialOrderState);
      setSelectedOrder(null);
    } catch (error: unknown) {
      toast({
        title: "خطأ",
        description: getErrorMessage(error, "فشل في حفظ الطلب."),
        variant: "destructive",
      });
    }
  };

  const handlePaymentSubmit = async (payment: MoneyInput, date: string) => {
    if (!paymentDialog.orderId) return;
    try {
      await addPayment.mutateAsync({
        orderId: paymentDialog.orderId,
        payment: { ...payment, date },
      });
      toast({
        title: "تم تسجيل الدفع",
        description: "تم تحديث حالة الدفع للطلب",
      });
      setPaymentDialog({ open: false, orderId: null });
    } catch (error: unknown) {
      toast({
        title: "خطأ",
        description: getErrorMessage(error, "فشل تسجيل الدفع"),
        variant: "destructive",
      });
    }
  };

  const handleFinalize = async (orderId: number) => {
    if (!await confirmMoneyAction(`إنهاء الطلب SO-${orderId} بإجمالي ${formatMoney(Number(orders?.find((order) => order.id === orderId)?.grand_total ?? 0))}؟ سيتم خصم الكميات من المخزون وتسجيل البيع، ولن يمكن تعديل بنوده بعد ذلك.`)) return;
    try {
      await finalizeOrder.mutateAsync(orderId);
      toast({ title: "تم إنهاء الطلب", description: "تم خصم المخزون وتسجيل البيع." });
    } catch (error: unknown) {
      toast({
        title: "تعذر إنهاء الطلب",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const handleReturn = async (data: ReturnRequest) => {
    if (!returning) return;
    try {
      const updated = await salesReturn.mutateAsync({ orderId: returning.id, data });
      toast({ title: "تم تسجيل المرتجع", description: `قيمة الطلب الآن ${formatCurrency(updated.net_total ?? 0)}` });
      setReturning(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const handleDeleteReturn = async (orderId: number, returnId: number) => {
    if (!await confirmMoneyAction("إلغاء هذا المرتجع؟ ستُعكس آثاره على قيمة البيع والصندوق أو رصيد العميل.")) return;
    try {
      const updated = await deleteReturn.mutateAsync({ orderId, returnId });
      setSelectedOrder(updated);
      toast({ title: "تم إلغاء المرتجع" });
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const handleViewDetails = (order: SalesOrder) => {
    setSelectedOrder(order);
    setIsDetailOpen(true);
  };

  // FIX: Full implementation for PDF export
  const handleExportPDF = (order: SalesOrder) => {
    if (typeof (window as any).pywebview !== "undefined") {
      // Use PyWebView API for printing - pass HTML content
      const htmlContent = generatePrintHTML(order);
      (window as any).pywebview.api.open_print_window(htmlContent);
    } else {
      // Fallback for browser version
      const printWindow = window.open("", "_blank");
      if (!printWindow) return;
      printWindow.document.write(generatePrintHTML(order));
      printWindow.document.close();
    }
  };

  const generatePrintHTML = (order: SalesOrder) => {
    const itemsHtml = order.items
      .map(
        (item) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${
          item.product_name
        }</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${
          item.quantity
        }</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatCurrency(
          item.unit_price,
        )}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatCurrency(
          item.total_price,
        )}</td>
      </tr>
    `,
      )
      .join("");

    const jobsHtml = order.freelance_jobs
      .map(
        (job) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${getJobTypeArabic(
          job.job_type,
        )} - ${escapeHtml(job.contractor_name)}</td>
        <td colspan="3" style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatCurrency(
          job.charge_to_client,
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
                (p) => `
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${formatDate(p.date)}</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatCurrency(p.amount)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
        <p style="margin: 10px 0 0 0;">المدفوع: <strong>${formatCurrency(order.total_paid ?? 0)}</strong>
          &nbsp;&nbsp; المتبقي: <strong>${formatCurrency(order.remaining ?? 0)}</strong></p>
      </div>
    `
        : "";

    return `
      <html dir="rtl">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Order SO-${order.id}</title>
          <style>
            ${printBaseCss}
            body { font-family: 'Arial', 'Tahoma', sans-serif; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; }
            .store-info { text-align: center; }
            .store-name { font-size: 1.5em; font-weight: bold; color: #3b82f6; }
            .store-phone { color: #666; margin-top: 5px; }
            .info-section { margin-bottom: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background-color: #f8f9fa; padding: 10px; text-align: right; border-bottom: 2px solid #dee2e6; }
            td { text-align: right; }
            .totals { margin-top: 30px; text-align: right; }
            .total-row { font-size: 1.2em; font-weight: bold; color: #3b82f6; }
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
              background-color: #3b82f6; 
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
            <div><h1>فاتورة مبيعات</h1><p>رقم الطلب: SO-${order.id}</p></div>
            <div class="store-info">
              ${companyHeaderHtml(company)}
              <p>${formatDate(order.finalized_at || order.date)}</p>
            </div>
          </div>
          <div class="info-section">
            <div><strong>العميل:</strong> ${escapeHtml(order.client_name)}</div>
            <div><strong>الجوال:</strong> ${escapeHtml(order.client_phone) || "N/A"}</div>
            <div style="grid-column: 1 / -1;"><strong>العنوان:</strong> ${escapeHtml(order.client_address) || "N/A"}</div>
          </div>
          <table>
            <thead>
              <tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr>
            </thead>
            <tbody>${itemsHtml}${jobsHtml}</tbody>
          </table>
          <div class="totals">
            <p>إجمالي المنتجات: ${formatCurrency(order.product_total)}</p>
            <p>إجمالي الخدمات: ${formatCurrency(order.service_total)}</p>
            <p>اجمالي: ${formatCurrency(
              parseFloat(order.product_total) + parseFloat(order.service_total),
            )}</p>
            <p>خصم: ${formatCurrency(order.discount)}</p>
            <p class="total-row">الكلي: ${formatCurrency(order.grand_total)}</p>
            ${Number(order.returned_total) > 0
              ? `<p>مرتجعات: -${formatCurrency(order.returned_total ?? 0)}</p>
                 <p class="total-row">الصافي بعد المرتجع: ${formatCurrency(order.net_total ?? 0)}</p>`
              : ""}
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
            أوامر البيع
          </h1>
          <p className="text-muted-foreground mt-1">
            جاري تحميل أوامر البيع...
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const removeOrder = async (id: number, payments?: PaymentsAction) => {
    try {
      await deleteOrder.mutateAsync({ id, payments });
      toast({ title: "تم الحذف", description: "تم حذف الطلب بنجاح" });
      setRemoving(null);
    } catch (error: unknown) {
      toast({
        title: "خطأ",
        description: getErrorMessage(error, "فشل حذف الطلب"),
        variant: "destructive",
      });
    }
  };

  // A paid order asks where the money went (refund / customer credit) instead of a plain confirm.
  const handleDelete = async (order: SalesOrder) => {
    if ((parseFloat(String(order.total_paid ?? 0)) || 0) > 0) return setRemoving(order);
    if (await confirmMoneyAction(`حذف طلب البيع SO-${order.id} بإجمالي ${formatMoney(Number(order.grand_total))}؟`)) removeOrder(order.id);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
            أوامر البيع
          </h1>
          <p className="text-muted-foreground mt-1">
            إدارة مشاريع العملاء والتركيبات
          </p>
        </div>
        <Dialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) {
              setSelectedOrder(null);
              setNewOrder(initialOrderState);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              variant="brand"
              className="gap-2"
              onClick={handleOpenCreateDialog}
            >
              <Plus className="w-4 h-4" />
              إنشاء مشروع
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedOrder
                  ? `تعديل أمر بيع - SO-${selectedOrder.id}`
                  : "إنشاء أمر بيع"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-6 py-4">
              {selectedOrder?.is_finalized && (
                <p className="text-sm rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-3">
                  هذا طلب منتهٍ: عند الحفظ تعود الكميات القديمة للمخزون وتخرج الجديدة، ويتعدل الحساب والأرباح، ويُسجَّل
                  التعديل باسمك في سجل التعديلات.
                </p>
              )}
              {/* Wholesale account / where the goods leave from (optional modules) */}
              {(features.accounts || features.branches || features.cars) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3 rounded-lg border border-border">
                  {features.accounts && (
                    <div className="space-y-2">
                      <Label>حساب الجملة</Label>
                      <SimpleSelect
                        value={newOrder.account || "none"}
                        onChange={(v) => {
                          if (v === "none") {
                            setNewOrder({ ...newOrder, account: "" });
                            return;
                          }
                          const acc = accounts.find((a) => String(a.id) === v);
                          setNewOrder({
                            ...newOrder,
                            account: v,
                            client_name: acc?.name ?? newOrder.client_name,
                            client_phone: acc?.phone || newOrder.client_phone,
                            client_address: acc?.address || newOrder.client_address,
                          });
                        }}
                        options={[
                          { value: "none", label: "عميل فردي (بدون حساب)" },
                          ...accounts
                            .filter((a) => a.is_customer && a.is_active)
                            .map((a) => ({ value: String(a.id), label: a.name })),
                        ]}
                      />
                    </div>
                  )}
                  {features.branches && (
                    <div className="space-y-2">
                      <Label>الفرع</Label>
                      <SimpleSelect
                        value={
                          newOrder.branch ||
                          (branchId ? String(branchId) : String(branches.find((b) => b.is_default)?.id ?? ""))
                        }
                        onChange={(v) => setNewOrder({ ...newOrder, branch: v })}
                        disabled={!!selectedOrder?.is_finalized && !isAdmin}
                        options={branches.filter((b) => b.is_active).map((b) => ({ value: String(b.id), label: b.name }))}
                      />
                    </div>
                  )}
                  {features.cars && (
                    <div className="space-y-2">
                      <Label>البيع من سيارة</Label>
                      <SimpleSelect
                        value={newOrder.car || "none"}
                        onChange={(v) => setNewOrder({ ...newOrder, car: v === "none" ? "" : v })}
                        disabled={!!selectedOrder?.is_finalized && !isAdmin}
                        options={[
                          { value: "none", label: "من المخزن (بدون سيارة)" },
                          ...cars.filter((c) => c.is_active).map((c) => ({ value: String(c.id), label: c.name })),
                        ]}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2 w-48">
                <Label>تاريخ البيع</Label>
                <Input
                  type="date"
                  value={newOrder.sale_date}
                  max={todayLocal()}
                  onChange={(e) => setNewOrder({ ...newOrder, sale_date: e.target.value })}
                />
              </div>

              {/* Client Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>اسم العميل</Label>
                  <Input
                    placeholder="أدخل اسم العميل هنا"
                    value={newOrder.client_name}
                    onChange={(e) =>
                      setNewOrder({ ...newOrder, client_name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>رقم الجوال</Label>
                  <Input
                    placeholder="أدخل رقم الجوال هنا"
                    value={newOrder.client_phone}
                    onChange={(e) =>
                      setNewOrder({ ...newOrder, client_phone: e.target.value })
                    }
                  />
                </div>
              </div>

              {/* Address */}
              <div className="space-y-2">
                <Label>العنوان</Label>
                <Input
                  placeholder="أدخل عنوان العميل هنا"
                  value={newOrder.client_address}
                  onChange={(e) =>
                    setNewOrder({ ...newOrder, client_address: e.target.value })
                  }
                />
              </div>

              {/* Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>عناصر الطلب</Label>
                  <Button variant="outline" size="sm" onClick={addItem}>
                    <Plus className="w-4 h-4 mr-1" /> إضافة عنصر
                  </Button>
                </div>
                {newOrder.items.length === 0 ? (
                  <div className="text-center py-8 bg-muted/50 rounded-lg text-muted-foreground">
                    لم تتم إضافة عناصر بعد. انقر على "إضافة عنصر" للبدء.
                  </div>
                ) : (
                  newOrder.items.map((item, index) => (
                    <div key={index} className="p-3 bg-muted rounded-lg space-y-1">
                    <div className="flex items-end gap-3">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">المنتج</Label>
                        <Select
                          value={item.product ? String(item.product) : ""}
                          onValueChange={(v) => updateItem(index, parseInt(v))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر من المخزون" />
                          </SelectTrigger>
                          <SelectContent>
                            {inventory.map((inv) => (
                              <SelectItem key={inv.id} value={String(inv.id)}>
                                {inv.name} ({formatQty(stockOf(inv, item.source))} {inv.unit || ""} متوفر)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {sourceOptions.length > 2 && (
                        <div className="w-36 space-y-1">
                          <Label className="text-xs">من</Label>
                          <SimpleSelect
                            value={item.source || "order"}
                            disabled={!!selectedOrder?.is_finalized && !isAdmin}
                            onChange={(v) => {
                              const updatedItems = [...newOrder.items];
                              updatedItems[index] = { ...updatedItems[index], source: v === "order" ? "" : v };
                              setNewOrder({ ...newOrder, items: updatedItems });
                            }}
                            options={sourceOptions}
                          />
                        </div>
                      )}
                      <div className="w-24 space-y-1">
                        <Label className="text-xs">الكمية</Label>
                        <QuantityInput
                          allowDecimal={!!inventory.find((p) => p.id === item.product)?.allow_decimal}
                          value={item.quantity}
                          onChange={(n) => updateItemQuantity(index, n)}
                        />
                      </div>
                      <div className="w-28 space-y-1">
                        <Label className="text-xs">سعر الوحدة</Label>
                        <Input
                          type="number"
                          value={item.unit_price}
                          onChange={(e) => {
                            const updatedItems = [...newOrder.items];
                            updatedItems[index] = {
                              ...updatedItems[index],
                              unit_price: e.target.value,
                            };
                            setNewOrder({ ...newOrder, items: updatedItems });
                          }}
                          className="bg-background"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => removeItem(index)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {(() => {
                      // selling at zero or below what it cost is allowed, but never by accident
                      const product = inventory.find((p) => p.id === item.product);
                      const price = parseFloat(String(item.unit_price)) || 0;
                      if (!product) return null;
                      if (price <= 0) return <p className="text-xs text-amber-700">⚠️ السعر صفر: سيُباع مجاناً.</p>;
                      if (isAdmin && price < Number(product.unit_cost))
                        return (
                          <p className="text-xs text-amber-700">
                            ⚠️ السعر أقل من التكلفة ({formatCurrency(product.unit_cost)}): خسارة في هذا البند.
                          </p>
                        );
                      return null;
                    })()}
                    </div>
                  ))
                )}
              </div>

              {/* Freelance Jobs */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>وظائف العمل الحر (العمالة والتركيب)</Label>
                  <Button variant="outline" size="sm" onClick={addFreelanceJob}>
                    <Plus className="w-4 h-4 mr-1" /> إضافة خدمة
                  </Button>
                </div>
                {newOrder.freelance_jobs.map((job, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-4 gap-3 p-3 bg-muted rounded-lg"
                  >
                    <div className="space-y-1">
                      <Label className="text-xs">نوع الوظيفة</Label>
                      <Select
                        value={job.job_type}
                        onValueChange={(v) =>
                          updateFreelanceJob(index, "job_type", v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="STEEL">عمل الحديد</SelectItem>
                          <SelectItem value="ELECTRIC">كهربائي</SelectItem>
                          <SelectItem value="INSTALL">تركيب</SelectItem>
                          <SelectItem value="MOVING">نقل و تحميل</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">المقاول</Label>
                      <Input
                        placeholder="اسم"
                        value={job.contractor_name}
                        onChange={(e) =>
                          updateFreelanceJob(
                            index,
                            "contractor_name",
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">التكلفة على الشركة</Label>
                      <Input
                        type="number"
                        value={job.cost_to_company}
                        onChange={(e) =>
                          updateFreelanceJob(
                            index,
                            "cost_to_company",
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">التكلفة على العميل</Label>
                        <Input
                          type="number"
                          value={job.charge_to_client}
                          onChange={(e) =>
                            updateFreelanceJob(
                              index,
                              "charge_to_client",
                              e.target.value,
                            )
                          }
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => removeFreelanceJob(index)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Discount */}
              <div className="space-y-2">
                <Label>الخصم</Label>
                <Input
                  type="number"
                  placeholder="0"
                  value={newOrder.discount}
                  onChange={(e) =>
                    setNewOrder({
                      ...newOrder,
                      discount: e.target.value || "0",
                    })
                  }
                />
              </div>

              {/* Summary */}
              <div className="p-4 bg-accent rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    إجمالي المنتجات:
                  </span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(calculateSubtotal())}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">إجمالي الخدمات:</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(calculateServiceTotal())}
                  </span>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-2 mt-2">
                  <span className="text-muted-foreground">اجمالي:</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(calculateTotal())}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">خصم:</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(calculateDiscount())}
                  </span>
                </div>
                <div className="flex justify-between text-lg border-t border-border pt-2 mt-2">
                  <span className="font-semibold text-foreground">الكلي:</span>
                  <span className="font-bold text-primary">
                    {formatCurrency(calculateGrandTotal())}
                  </span>
                </div>
              </div>

              <Button
                variant="brand"
                className="w-full"
                onClick={handleSubmit}
                disabled={
                  !newOrder.client_name ||
                  newOrder.items.length === 0 ||
                  createOrder.isPending ||
                  updateOrder.isPending
                }
              >
                {createOrder.isPending || updateOrder.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                {selectedOrder ? "حفظ التعديلات" : "إنشاء طلب مبيعات"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="ابحث في الطلبات..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      {/* Orders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredOrders.length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            لم يتم العثور على طلبات مبيعات. أنشئ طلبك الأول للبدء.
          </div>
        ) : (
          pager.pageItems.map((order, index) => (
            <div
              key={order.id}
              className="bg-card border border-border rounded-xl p-5 hover-lift animate-fade-in"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm text-muted-foreground">
                    SO-{order.id}
                    {order.from_offer ? <span className="mr-2 text-primary">(من عرض OF-{order.from_offer})</span> : null}
                  </p>
                  <h3 className="font-semibold text-foreground">
                    {order.client_name}
                  </h3>
                </div>
                {getStatusBadge(order.is_finalized)}
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                {formatDate(order.finalized_at || order.date)} · {order.client_phone || "لا يوجد هاتف"}
              </p>
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">العناصر:</span>
                  <span className="text-foreground">
                    {order.items.length} منتج
                    {order.freelance_jobs.length > 0 && ` + ${order.freelance_jobs.length} خدمة`}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">المدفوع:</span>
                  <span className="text-emerald-700">{formatCurrency(order.total_paid ?? 0)}</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-muted-foreground">المتبقي:</span>
                  <span className="flex items-center gap-2">
                    <PaymentBadge status={order.payment_status} />
                    <span className={Number(order.remaining) > 0 ? "font-semibold text-destructive" : "text-foreground"}>
                      {formatCurrency(order.remaining ?? 0)}
                    </span>
                  </span>
                </div>
                {isAdmin && order.profit !== undefined && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      الربح{order.is_finalized ? "" : " (تقديري)"}:
                    </span>
                    <span
                      className={
                        order.profit < 0
                          ? "font-semibold text-destructive"
                          : "font-semibold text-green-600"
                      }
                    >
                      {formatCurrency(order.profit)}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground">المجموع الكلي</p>
                  <p className="text-lg font-bold text-primary">
                    {formatCurrency(order.net_total ?? order.grand_total)}
                  </p>
                  {Number(order.returned_total) > 0 && (
                    <p className="text-xs text-amber-700">بعد مرتجع {formatCurrency(order.returned_total ?? 0)}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {(!order.is_finalized || isAdmin) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title={order.is_finalized ? "تعديل طلب منتهٍ (للمدير)" : "تعديل"}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => handleEditClick(order)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                  {order.is_finalized && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="مرتجع من العميل"
                      className="h-8 w-8 text-amber-600"
                      onClick={() => setReturning(order)}
                    >
                      <Undo2 className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleViewDetails(order)}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  {!order.is_finalized && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-primary hover:bg-primary/10"
                      onClick={() => handleFinalize(order.id)}
                      disabled={finalizeOrder.isPending}
                    >
                      {finalizeOrder.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                    </Button>
                  )}
                  {/* Payment Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-green-600"
                    onClick={() =>
                      setPaymentDialog({
                        open: true,
                        orderId: order.id,
                        grandTotal: Number(order.net_total ?? order.grand_total),
                        totalPaid: parseFloat(order.total_paid || "0"),
                      })
                    }
                  >
                    <CreditCard className="w-4 h-4" />
                  </Button>
                  <WhatsappButton
                    iconOnly
                    phone={order.client_phone}
                    message={() => salesOrderMessage(order, company?.name)}
                  />
                  {/* Export PDF Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-red-500"
                    onClick={() => handleExportPDF(order)}
                  >
                    <FileText className="w-4 h-4" />
                  </Button>
                  {/* Delete Button */}
                  {isAdmin && !order.is_finalized && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <TablePagination pager={pager} />
      {/* Order Details Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              تفاصيل الطلب - SO-{viewedOrder?.id}
              {viewedOrder?.from_offer ? <span className="text-sm text-primary mr-2">(من عرض OF-{viewedOrder.from_offer})</span> : null}
            </DialogTitle>
          </DialogHeader>
          {viewedOrder && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">العميل</Label>
                  <p className="font-medium">{viewedOrder.client_name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">الهاتف</Label>
                  <p className="font-medium">
                    {viewedOrder.client_phone || "N/A"}
                  </p>
                </div>
                {(viewedOrder.account_name || viewedOrder.branch_name || viewedOrder.car_name) && (
                  <div className="col-span-2 flex flex-wrap gap-2 text-sm">
                    {viewedOrder.account_name && <Badge variant="secondary">حساب: {viewedOrder.account_name}</Badge>}
                    {features.branches && viewedOrder.branch_name && <Badge variant="outline">فرع: {viewedOrder.branch_name}</Badge>}
                    {viewedOrder.car_name && <Badge variant="outline">سيارة: {viewedOrder.car_name}</Badge>}
                  </div>
                )}
                <div className="col-span-2">
                  <Label className="text-muted-foreground">العنوان</Label>
                  <p className="font-medium">
                    {viewedOrder.client_address || "N/A"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">التاريخ</Label>
                  <p className="font-medium">
                    {formatDate(viewedOrder.finalized_at || viewedOrder.date)}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">الحالة</Label>
                  <div className="mt-1">
                    {getStatusBadge(viewedOrder.is_finalized)}
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">العناصر</Label>
                <div className="mt-2 space-y-2">
                  {viewedOrder.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between p-2 bg-muted rounded"
                    >
                      <span>
                        {item.product_name} × {formatQty(item.quantity)}
                        {(item.car_name || item.branch_name) && (
                          <span className="text-xs text-muted-foreground mr-2">
                            (من {item.car_name ? `سيارة ${item.car_name}` : item.branch_name})
                          </span>
                        )}
                      </span>
                      <span className="font-medium">
                        {formatCurrency(item.total_price)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {viewedOrder.freelance_jobs.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">الوظائف الحرة</Label>
                  <div className="mt-2 space-y-2">
                    {viewedOrder.freelance_jobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex justify-between p-2 bg-muted rounded"
                      >
                        <span>
                          {getJobTypeArabic(job.job_type)} -{" "}
                          {job.contractor_name}
                        </span>
                        <span className="font-medium">
                          {formatCurrency(job.charge_to_client)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(viewedOrder.returns ?? []).length > 0 && (
                <div>
                  <Label className="text-muted-foreground">المرتجعات</Label>
                  <div className="mt-2 space-y-2">
                    {(viewedOrder.returns ?? []).map((r) => (
                      <div key={r.id} className="p-2 bg-amber-50 border border-amber-200 rounded text-sm space-y-1">
                        <div className="flex justify-between items-center">
                          <span>
                            {formatDate(r.date)} · {r.lines.map((l) => `${l.product_name} × ${formatQty(l.quantity)}`).join("، ")}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="font-medium">-{formatCurrency(r.value)}</span>
                            {isAdmin && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="إلغاء المرتجع"
                                onClick={() => handleDeleteReturn(viewedOrder.id, r.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </span>
                        </div>
                        {r.refund_amount > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {r.refund_to_credit ? "المبلغ الزائد بقي رصيداً في الحساب" : "أُعيد للعميل"}: {formatCurrency(r.refund_amount)}
                          </p>
                        )}
                        {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isAdmin && viewedOrder.is_finalized && (
                <Button variant="outline" size="sm" onClick={() => setLogFor(viewedOrder.id)}>
                  <History className="w-4 h-4 ml-1" /> سجل التعديلات
                </Button>
              )}

              {viewedOrder.payments && viewedOrder.payments.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">سجل الدفعات</Label>
                  <div className="mt-2 space-y-2">
                    {viewedOrder.payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex justify-between p-2 bg-muted rounded"
                      >
                        <span>
                          {formatDate(payment.date)}
                        </span>
                        <span className="font-medium">
                          {formatCurrency(payment.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-4 bg-accent rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span>إجمالي المنتجات:</span>
                  <span>{formatCurrency(viewedOrder.product_total)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>إجمالي الخدمات:</span>
                  <span>{formatCurrency(viewedOrder.service_total)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-2 mt-2">
                  <span>اجمالي:</span>
                  <span>
                    {formatCurrency(
                      parseFloat(viewedOrder.product_total) +
                        parseFloat(viewedOrder.service_total),
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>خصم:</span>
                  <span>{formatCurrency(viewedOrder.discount)}</span>
                </div>
                <div className="flex justify-between text-lg border-t border-border pt-2 font-bold">
                  <span>الكلي:</span>
                  <span className="text-primary">
                    {formatCurrency(viewedOrder.grand_total)}
                  </span>
                </div>
                {Number(viewedOrder.returned_total) > 0 && (
                  <div className="flex justify-between text-sm text-amber-700">
                    <span>المرتجعات:</span>
                    <span>-{formatCurrency(viewedOrder.returned_total ?? 0)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>المدفوع:</span>
                  <span className="text-emerald-700">{formatCurrency(viewedOrder.total_paid ?? 0)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold">
                  <span>المتبقي:</span>
                  <span className={Number(viewedOrder.remaining) > 0 ? "text-destructive" : ""}>
                    {formatCurrency(viewedOrder.remaining ?? 0)}
                  </span>
                </div>
                {isAdmin && viewedOrder.profit !== undefined && (
                  <div className="border-t border-dashed border-border pt-2 mt-2 space-y-1 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>التكلفة (للمدير فقط):</span>
                      <span>{formatCurrency(viewedOrder.cost_total ?? 0)}</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span>
                        الربح{viewedOrder.is_finalized ? "" : " (تقديري)"}:
                      </span>
                      <span
                        className={
                          viewedOrder.profit < 0
                            ? "text-destructive"
                            : "text-green-600"
                        }
                      >
                        {formatCurrency(viewedOrder.profit)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleExportPDF(viewedOrder)}
              >
                <FileText className="w-4 h-4 mr-2" />
                تصدير فاتورة PDF
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <PaymentDialog
        open={paymentDialog.open}
        onOpenChange={(v) => setPaymentDialog((prev) => ({ ...prev, open: v }))}
        title={`تسجيل دفعة للطلب SO-${paymentDialog.orderId}`}
        total={paymentDialog.grandTotal || 0}
        paid={paymentDialog.totalPaid || 0}
        pending={addPayment.isPending}
        format={formatCurrency}
        moneyEnabled={features.money_boxes}
        onSubmit={handlePaymentSubmit}
      />

      {returning && (
        <ReturnDialog
          open
          onOpenChange={(v) => !v && setReturning(null)}
          kind="sale"
          title={`مرتجع من الطلب SO-${returning.id}`}
          paid={Number(returning.total_paid ?? 0)}
          worth={Number(returning.net_total ?? returning.grand_total)}
          accountName={returning.account ? returning.account_name : undefined}
          pending={salesReturn.isPending}
          onSubmit={handleReturn}
          lines={returning.items
            .map((i) => {
              const factor = Number(returning.subtotal) > 0 ? Number(returning.grand_total) / Number(returning.subtotal) : 1;
              return {
                id: i.id,
                product_name: i.product_name,
                max: Number(i.quantity) - Number(i.returned_quantity ?? 0),
                allowDecimal: !!inventory.find((p) => p.id === i.product)?.allow_decimal,
                unitValue: Math.round(Number(i.unit_price) * factor * 10000) / 10000,
                place: i.car
                  ? `car:${i.car}`
                  : i.branch
                    ? `branch:${i.branch}`
                    : returning.car
                      ? `car:${returning.car}`
                      : `branch:${returning.branch ?? ""}`,
              };
            })
            .filter((l) => l.max > 0)}
        />
      )}
      <EditLogDialog docType="SO" docId={logFor} onOpenChange={(v) => !v && setLogFor(null)} />

      <RemovePaymentsDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`حذف الطلب SO-${removing?.id ?? ""}`}
        paidText={formatCurrency(removing?.total_paid ?? 0)}
        kind="sale"
        accountName={removing?.account ? removing.account_name : undefined}
        confirmLabel="حذف الطلب"
        pending={deleteOrder.isPending}
        onConfirm={(action) => removing && removeOrder(removing.id, action)}
      />
    </div>
  );
}
