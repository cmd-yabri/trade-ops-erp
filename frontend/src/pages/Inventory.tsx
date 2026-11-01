import { useState } from "react";
import {
  Search,
  Package,
  AlertTriangle,
  Plus,
  Loader2,
  Pencil,
  Trash2,
  ArrowLeftRight,
  History,
  PackageOpen,
} from "lucide-react";
import { ProductHistoryDialog } from "@/components/inventory/ProductHistoryDialog";
import { OpeningStockDialog } from "@/components/inventory/OpeningStockDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, formatMoney, formatUnitCost, round2 } from "@/lib/utils";
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
  useProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useCategories,
  useCreateCategory,
} from "@/hooks/useInventory";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/contexts/AuthContext";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/TablePagination";
import { QuantityInput } from "@/components/QuantityInput";
import { SimpleSelect } from "@/components/SimpleSelect";
import { TransferDialog } from "@/components/TransferDialog";
import { useFeatures } from "@/contexts/FeaturesContext";
import { formatQty } from "@/lib/utils";
import { MoneyEntry, MoneyState, emptyMoney, toMoneyPayload, usdValue } from "@/components/MoneyEntry";
import { confirmAction, confirmMoneyAction } from "@/lib/confirmMoneyAction";
import { useOpening } from "@/hooks/useHistory";
import { OpeningStockRow } from "@/types/history";

export default function Inventory() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  // Data Fetching & Mutations
  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: categoriesData, isLoading: categoriesLoading } =
    useCategories();
  const { data: openingRows = [], isLoading: openingsLoading } = useOpening(isAdmin);
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const createCategory = useCreateCategory();

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newItem, setNewItem] = useState({
    name: "",
    category: "" as any,
    unit_cost: "",
    selling_price: "",
    current_stock: 0,
    reorder_threshold: 10,
    allow_decimal: false,
    unit: "",
    wholesale_price: "",
    branch: "",
  });
  const { features, branches, branchId } = useFeatures();
  const [transferOpen, setTransferOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<{ id: number; name: string; unit?: string } | null>(null);
  const [openingOpen, setOpeningOpen] = useState(false);
  // the quantity when the edit form opened: changing it is a count correction that needs a reason
  const [originalStock, setOriginalStock] = useState<number | null>(null);
  const [stockReason, setStockReason] = useState("");
  const [openingForEdit, setOpeningForEdit] = useState<OpeningStockRow | null>(null);
  const [cashboxPromptOpen, setCashboxPromptOpen] = useState(false);
  const [cashboxMoney, setCashboxMoney] = useState<MoneyState>(emptyMoney());
  // new stock: paid from a cash box now ("box") or old goods not paid now ("none")
  const [stockPaid, setStockPaid] = useState<"box" | "none">("box");
  const [stockMoney, setStockMoney] = useState<MoneyState>(emptyMoney());
  const [moneyTouched, setMoneyTouched] = useState(false);
  const [newCategory, setNewCategory] = useState({
    name: "",
  });

  // Map categories data to a simple, language-agnostic shape
  const categories = (categoriesData || []).map((cat) => ({
    id: cat.id,
    value: cat.id.toString(),
    // Prefer unified `name` from API, fall back to any available field
    label: (cat as any).name || cat.name || "",
    is_custom: cat.is_custom,
  }));

  const inventory = products || [];

  // Filter Logic
  const filteredInventory = inventory.filter((item) => {
    const matchesSearch = item.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());

    // Filter by category ID instead of name text to avoid
    // any mismatch between Arabic/English names or formatting.
    const matchesCategory =
      categoryFilter === "all" ||
      (item.category_details?.id &&
        item.category_details.id.toString() === categoryFilter);

    return matchesSearch && matchesCategory;
  });

  const pager = usePagination(filteredInventory, 10, `${searchQuery}|${categoryFilter}`);

  // With a branch picked in the header the table shows that branch's own quantity.
  const shownStock = (item: (typeof inventory)[number]) => {
    if (features.branches && branchId) {
      return item.stock_by_location?.find((l) => l.kind === "branch" && l.id === branchId)?.quantity ?? 0;
    }
    return item.current_stock ?? 0;
  };

  const lowStockItems = inventory.filter(
    (item) => shownStock(item) <= (item.reorder_threshold || 0),
  );

  const totalValue = inventory.reduce((sum, item) => {
    const cost = parseFloat(item.unit_cost) || 0;
    const stock = shownStock(item);
    return sum + stock * cost;
  }, 0);

  const stockValue = (Number(newItem.current_stock) || 0) * (parseFloat(String(newItem.unit_cost)) || 0);
  const asksPayment = !editingId && isAdmin && (Number(newItem.current_stock) || 0) > 0;
  // the amount follows quantity x cost until it is typed by hand (or paid in SYP)
  const shownMoney: MoneyState =
    moneyTouched || stockMoney.currency !== "USD"
      ? stockMoney
      : { ...stockMoney, amount: stockValue > 0 ? String(Math.round(stockValue * 100) / 100) : "" };
  const proposedCashboxUsd = Math.max(
    0,
    round2(
      Number(openingForEdit?.paid?.amount ?? 0) +
      Math.max(
        0,
        Number(openingForEdit?.quantity ?? 0) +
          (Number(newItem.current_stock) - (originalStock ?? 0)),
      ) * (parseFloat(String(newItem.unit_cost)) || 0) -
      Number(openingForEdit?.value ?? 0),
    ),
  );

  // Handlers
  const resetForm = () => {
    setStockPaid("box");
    setStockMoney(emptyMoney());
    setMoneyTouched(false);
    setEditingId(null);
    setOriginalStock(null);
    setOpeningForEdit(null);
    setCashboxPromptOpen(false);
    setNewItem({
      name: "",
      category: "",
      unit_cost: "",
      selling_price: "",
      current_stock: 0,
      reorder_threshold: 10,
      allow_decimal: false,
      unit: "",
      wholesale_price: "",
      branch: "",
    });
  };

  const resetCategoryForm = () => {
    setNewCategory({
      name: "",
    });
  };

  const handleEditClick = (product: any) => {
    setOriginalStock(Number(product.current_stock));
    const paidOpenings = openingRows.filter((row) => row.product === product.id && row.paid);
    setOpeningForEdit(paidOpenings.length === 1 ? paidOpenings[0] : null);
    setStockReason("");
    setEditingId(product.id);
    setNewItem({
      name: product.name,
      category: product.category_details?.id?.toString() || "",
      unit_cost: String(Number(product.unit_cost)), // 80, not 80.0000
      selling_price: product.selling_price,
      current_stock: product.current_stock,
      reorder_threshold: product.reorder_threshold ?? 10,
      allow_decimal: !!product.allow_decimal,
      unit: product.unit || "",
      wholesale_price: product.wholesale_price ?? "",
      branch: "",
    });
    setIsProductDialogOpen(true);
  };

  const saveProduct = async (correctCashbox: boolean) => {
    const cost = parseFloat(String(newItem.unit_cost));
    const payload = {
      ...newItem,
      category: newItem.category ? String(newItem.category) : null,
      selling_price: newItem.selling_price === "" ? "0" : newItem.selling_price,
      stock_reason: stockReason.trim(),
      wholesale_price: newItem.wholesale_price === "" ? null : newItem.wholesale_price,
      branch: newItem.branch ? Number(newItem.branch) : branchId,
      opening_payment: asksPayment && stockPaid === "box" ? toMoneyPayload(shownMoney) : null,
      ...(correctCashbox && openingForEdit
        ? {
            opening_payment_correction: Number(newItem.current_stock) * cost <= 0
              ? { opening_id: openingForEdit.id, cancel: true }
              : {
                  opening_id: openingForEdit.id,
                  payment: toMoneyPayload(cashboxMoney),
                },
          }
        : {}),
    };
    try {
      if (editingId) {
        await updateProduct.mutateAsync({ id: editingId, data: payload });
        toast({
          title: "تم التحديث",
          description: correctCashbox
            ? "تم تعديل المنتج وتحديث حركة الصندوق المرتبطة به."
            : "تم تعديل المنتج دون تغيير حركة الصندوق.",
        });
      } else {
        await createProduct.mutateAsync(payload);
        toast({ title: "تمت إضافة المنتج", description: "تمت إضافة المنتج للمخزون" });
      }
      setCashboxPromptOpen(false);
      setIsProductDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({
        title: "خطأ",
        description: getErrorMessage(error, "فشل حفظ البيانات"),
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    const stockChanged = editingId !== null && Number(newItem.current_stock) !== Number(originalStock);
    if (stockChanged && !stockReason.trim()) {
      toast({ title: "خطأ", description: "اكتب سبب تعديل الكمية (جرد، تالف، ...).", variant: "destructive" });
      return;
    }
    const cost = parseFloat(String(newItem.unit_cost));
    if (isNaN(cost) || cost < 0) {
      toast({
        title: "خطأ",
        description: "أدخل تكلفة وحدة صحيحة (صفر أو أكثر).",
        variant: "destructive",
      });
      return;
    }
    if ((newItem.current_stock || 0) < 0 || (newItem.reorder_threshold || 0) < 0) {
      toast({
        title: "خطأ",
        description: "الكمية ومستوى إعادة الطلب لا يمكن أن يكونا سالبين.",
        variant: "destructive",
      });
      return;
    }
    if (asksPayment && stockPaid === "box" && usdValue(shownMoney) <= 0) {
      toast({ title: "خطأ", description: "أدخل المبلغ المدفوع من الصندوق، أو اختر «بضاعة قديمة».", variant: "destructive" });
      return;
    }
    const openingPaymentNeedsChoice = Boolean(
      editingId &&
      isAdmin &&
      openingForEdit?.paid &&
      Math.abs(proposedCashboxUsd - Number(openingForEdit.paid.amount)) >= 0.01,
    );
    if (openingPaymentNeedsChoice && openingForEdit?.paid) {
      const paid = openingForEdit.paid;
      const rate = Number(paid.exchange_rate) || 0;
      setCashboxMoney(
        paid.currency === "SYP"
          ? {
              currency: "SYP",
              amount: String(Math.round(proposedCashboxUsd * rate * 100) / 100),
              rate: String(rate),
            }
          : { currency: "USD", amount: proposedCashboxUsd.toFixed(2), rate: emptyMoney().rate },
      );
      setCashboxPromptOpen(true);
      return;
    }
    if ((Number(newItem.unit_cost) > 0 || Number(newItem.selling_price) > 0) &&
        !await confirmMoneyAction(
          `${editingId ? "حفظ التعديلات المالية" : "إضافة المنتج"} «${newItem.name.trim()}»؟ تكلفة الوحدة ${formatMoney(cost)} وسعر البيع ${formatMoney(Number(newItem.selling_price) || 0)}.${asksPayment
            ? stockPaid === "box"
              ? ` سيتم تسجيل دفع ${shownMoney.currency === "SYP" ? `${Number(shownMoney.amount).toLocaleString("en-US")} ل.س` : formatMoney(usdValue(shownMoney))} من الصندوق.`
              : " ستُسجّل الكمية كرَصيد افتتاحي بلا حركة نقدية."
            : " تعديل الكمية وحده لا يغيّر حركة الصندوق."}`,
        )) return;
    await saveProduct(false);
  };

  const handleAddCategory = async () => {
    if (!newCategory.name.trim()) {
      toast({
        title: "خطأ",
        description: "يرجى إدخال اسم الفئة",
        variant: "destructive",
      });
      return;
    }

    try {
      await createCategory.mutateAsync(newCategory);
      toast({
        title: "تمت إضافة الفئة",
        description: "تمت إضافة الفئة الجديدة بنجاح",
      });
      setIsCategoryDialogOpen(false);
      resetCategoryForm();
    } catch (error) {
      toast({
        title: "خطأ",
        description: getErrorMessage(error, "فشل إضافة الفئة"),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: number) => {
    if (await confirmAction("هل أنت متأكد من حذف هذا المنتج؟")) {
      try {
        await deleteProduct.mutateAsync(id);
        toast({ title: "تم الحذف", description: "تم حذف المنتج من المخزون" });
      } catch (error) {
        toast({
          title: "خطأ",
          description: getErrorMessage(error, "فشل حذف المنتج"),
          variant: "destructive",
        });
      }
    }
  };

  const formatCurrency = (amount: number | string) => {
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return (Number(num) < 0 ? "‎" : "") + new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Number(num || 0) % 1 ? 2 : 0,  // $20.50, never $20.5
    }).format(num);
  };

  const getCategoryBadge = (categoryName: string) => {
    const name = categoryName?.toLowerCase() || "";
    const styles = [
      "bg-chart-1/10 text-chart-1 border-chart-1/20",
      "bg-chart-2/10 text-chart-2 border-chart-2/20",
      "bg-chart-3/10 text-chart-3 border-chart-3/20",
      "bg-chart-4/10 text-chart-4 border-chart-4/20",
      "bg-purple-500/10 text-purple-600 border-purple-500/20",
      "bg-orange-500/10 text-orange-600 border-orange-500/20",
    ];
    // Same category name always gets the same colour.
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
    const style = styles[hash % styles.length];

    return (
      <Badge variant="outline" className={style}>
        {categoryName}
      </Badge>
    );
  };

  const isLoading = productsLoading || categoriesLoading || (isAdmin && openingsLoading);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
            الجرد العام
          </h1>
          <p className="text-muted-foreground mt-1">
            إدارة مخزون بضاعتك ومنتجاتك.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setOpeningOpen(true)}>
            <PackageOpen className="w-4 h-4" /> الرصيد الافتتاحي
          </Button>
          {(features.branches || features.cars) && (
            <Button variant="outline" className="gap-2" onClick={() => setTransferOpen(true)}>
              <ArrowLeftRight className="w-4 h-4" /> نقل بضاعة
            </Button>
          )}
          {/* Add Category Dialog */}
          <Dialog
            open={isCategoryDialogOpen}
            onOpenChange={(open) => {
              setIsCategoryDialogOpen(open);
              if (!open) resetCategoryForm();
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Plus className="w-4 h-4" /> إضافة فئة
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>إضافة فئة جديدة</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>اسم الفئة (عربي)</Label>
                  <Input
                    placeholder="مثال: معادات الإضاءة"
                    value={newCategory.name}
                    onChange={(e) =>
                      setNewCategory({
                        ...newCategory,
                        name: e.target.value,
                      })
                    }
                  />
                </div>
                <Button
                  variant="brand"
                  className="w-full"
                  onClick={handleAddCategory}
                  disabled={
                    createCategory.isPending || !newCategory.name.trim()
                  }
                >
                  {createCategory.isPending && (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  )}
                  إضافة الفئة
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Add Product Dialog */}
          <Dialog
            open={isProductDialogOpen}
            onOpenChange={(open) => {
              setIsProductDialogOpen(open);
              if (!open) resetForm();
            }}
          >
            <Button
              variant="brand"
              className="gap-2"
              onClick={() => {
                resetForm();
                setIsProductDialogOpen(true);
              }}
            >
              <Plus className="w-4 h-4" /> إضافة منتج
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {cashboxPromptOpen
                    ? "هل تريد تعديل حركة الصندوق؟"
                    : editingId
                      ? "تعديل المنتج"
                      : "إضافة منتج إلى المخزون"}
                </DialogTitle>
              </DialogHeader>
              {cashboxPromptOpen ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    تغيّرت كمية «{newItem.name.trim()}». هل تريد أيضاً تعديل دفعة الرصيد الافتتاحي
                    المسجلة للصندوق؟ المبلغ المقترح يعدّل الدفعة السابقة بفرق الكمية × تكلفة الرصيد الافتتاحي
                    ({formatMoney(proposedCashboxUsd)}). اختر «لا» للإبقاء على الدفعة الحالية.
                  </p>
                  <MoneyEntry
                    label="مبلغ الدفعة بعد التصحيح"
                    value={cashboxMoney}
                    enabled={features.money_boxes}
                    onChange={setCashboxMoney}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button
                      variant="outline"
                      onClick={() => saveProduct(false)}
                      disabled={updateProduct.isPending}
                    >
                      لا، احفظ المخزون فقط
                    </Button>
                    <Button
                      variant="brand"
                      onClick={() => {
                        if (proposedCashboxUsd > 0 && usdValue(cashboxMoney) <= 0) {
                          toast({
                            title: "خطأ",
                            description: "أدخل مبلغاً صحيحاً للدفعة أو اجعل المبلغ المقترح صفراً لإلغاء الدفع.",
                            variant: "destructive",
                          });
                          return;
                        }
                        void saveProduct(true);
                      }}
                      disabled={updateProduct.isPending}
                    >
                      {updateProduct.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                      نعم، حدّث الصندوق واحفظ
                    </Button>
                  </div>
                </div>
              ) : (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>اسم المنتج</Label>
                  <Input
                    placeholder="مثال: منتج 400 قطعة"
                    value={newItem.name}
                    onChange={(e) =>
                      setNewItem({ ...newItem, name: e.target.value })
                    }
                  />
                </div>

                {/* Category Select */}
                <div className="space-y-2">
                  <Label>الفئة</Label>
                  <Select
                    value={newItem.category}
                    onValueChange={(val) =>
                      setNewItem({ ...newItem, category: val })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الفئة" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{editingId ? "الكمية (تصحيح جرد)" : "الكمية الموجودة الآن (رصيد افتتاحي)"}</Label>
                    <QuantityInput
                      allowDecimal={newItem.allow_decimal}
                      value={newItem.current_stock}
                      onChange={(n) => setNewItem({ ...newItem, current_stock: n })}
                    />
                    {editingId && Number(newItem.current_stock) !== Number(originalStock) && (
                      <Input
                        placeholder="سبب التعديل (مطلوب): جرد، تالف، ..."
                        value={stockReason}
                        onChange={(e) => setStockReason(e.target.value)}
                      />
                    )}
                  </div>
                  {/* staff set a cost for new stock but never see it afterwards */}
                  <div className={cn("space-y-2", editingId && !isAdmin && "hidden")}>
                    <Label>تكلفة الوحدة ($)</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      value={newItem.unit_cost}
                      onChange={(e) =>
                        setNewItem({ ...newItem, unit_cost: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>سعر البيع ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newItem.selling_price}
                      onChange={(e) =>
                        setNewItem({
                          ...newItem,
                          selling_price: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>مستوى إعادة الطلب</Label>
                    <QuantityInput
                      allowDecimal={newItem.allow_decimal}
                      value={newItem.reorder_threshold}
                      onChange={(n) => setNewItem({ ...newItem, reorder_threshold: n })}
                    />
                  </div>
                </div>
                {(features.accounts || features.branches) && (
                  <div className="grid grid-cols-2 gap-4">
                    {features.accounts && (
                      <div className="space-y-2">
                        <Label>سعر الجملة ($) (اختياري)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={newItem.wholesale_price}
                          onChange={(e) => setNewItem({ ...newItem, wholesale_price: e.target.value })}
                        />
                      </div>
                    )}
                    {features.branches && (
                      <div className="space-y-2">
                        <Label>{editingId ? "الفرع المتأثر بتعديل الكمية" : "الفرع الذي يستلم الكمية"}</Label>
                        <SimpleSelect
                          value={newItem.branch || String(branchId ?? branches.find((b) => b.is_default)?.id ?? "")}
                          onChange={(v) => setNewItem({ ...newItem, branch: v })}
                          options={branches.filter((b) => b.is_active).map((b) => ({ value: String(b.id), label: b.name }))}
                        />
                      </div>
                    )}
                  </div>
                )}
                {asksPayment && (
                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <div className="space-y-2">
                      <Label>دفع ثمن هذه الكمية ({formatCurrency(stockValue)})</Label>
                      <SimpleSelect
                        value={stockPaid}
                        onChange={(v) => setStockPaid(v as "box" | "none")}
                        options={[
                          { value: "box", label: "دُفعت الآن من الصندوق" },
                          { value: "none", label: "بضاعة قديمة (بدون دفع الآن)" },
                        ]}
                      />
                    </div>
                    {stockPaid === "box" ? (
                      <MoneyEntry
                        label="المبلغ المدفوع"
                        value={shownMoney}
                        enabled={features.money_boxes}
                        onChange={(m) => {
                          setMoneyTouched(true);
                          setStockMoney(m);
                        }}
                      />
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {stockPaid === "box"
                        ? "يُسجَّل المبلغ في «المالية» كشراء بضاعة ويخرج من الصندوق (لا يُنقص الربح: يدخل كتكلفة عند البيع)."
                        : "تُسجَّل رصيداً افتتاحياً بلا دفع."}{" "}
                      المورد اختياري: يمكنك ربطها بمورد أو دفعها لاحقاً من «الرصيد الافتتاحي».
                    </p>
                  </div>
                )}
                <div className="rounded-lg border border-border p-3 space-y-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={newItem.allow_decimal}
                      onChange={(e) =>
                        setNewItem({ ...newItem, allow_decimal: e.target.checked })
                      }
                    />
                    يُباع بالكسور (مثل الكابل بالمتر: 3.5)
                  </label>
                  <div className="space-y-2">
                    <Label>وحدة القياس (اختياري)</Label>
                    <Input
                      placeholder="متر، كغ، قطعة..."
                      value={newItem.unit}
                      onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                    />
                  </div>
                </div>
                <Button
                  variant="brand"
                  className="w-full"
                  onClick={handleSave}
                  disabled={
                    !newItem.name ||
                    createProduct.isPending ||
                    updateProduct.isPending
                  }
                >
                  {(createProduct.isPending || updateProduct.isPending) && (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  )}
                  {editingId ? "حفظ التعديلات" : "أضف إلى المخزون"}
                </Button>
              </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent text-accent-foreground">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">إجمالي المنتجات</p>
              <p className="text-2xl font-bold">{inventory.length}</p>
            </div>
          </div>
        </div>
        <div className={cn("bg-card border border-border rounded-xl p-5 shadow-sm", !isAdmin && "hidden")}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">قيمة المخزون</p>
              <p className="text-2xl font-bold">{formatCurrency(totalValue)}</p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "p-2.5 rounded-xl",
                lowStockItems.length > 0
                  ? "bg-warning/10 text-warning"
                  : "bg-accent text-accent-foreground",
              )}
            >
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                تنبيهات المخزون المنخفض
              </p>
              <p className="text-2xl font-bold">{lowStockItems.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="ابحث في المخزون..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="الفئة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع الفئات</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  المنتج
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  الفئة
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                  الكمية
                </th>
                {isAdmin && (
                  <>
                    <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                      تكلفة الوحدة
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                      القيمة الإجمالية
                    </th>
                  </>
                )}
                <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                  الحالة
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                  الاجراءات
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredInventory.length === 0 ? (
                <tr>
                  <td
                    colSpan={isAdmin ? 7 : 5}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    لا توجد منتجات.
                  </td>
                </tr>
              ) : (
                pager.pageItems.map((item, index) => {
                  const isLowStock =
                    shownStock(item) <= (item.reorder_threshold || 0);
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-muted/30 transition-colors animate-fade-in"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <td className="px-4 py-4 text-sm font-medium">
                        {item.name}
                      </td>
                      <td className="px-4 py-4">
        {getCategoryBadge(                            item.category_details?.name ||
                            "غير محدد",
                        )}{" "}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span
                          className={cn(
                            "font-medium",
                            isLowStock ? "text-warning" : "text-foreground",
                          )}
                        >
                          {formatQty(shownStock(item))}
                        </span>
                        {item.unit && (
                          <span className="text-xs text-muted-foreground mr-1">{item.unit}</span>
                        )}
                        {(features.branches || features.cars) && (item.stock_by_location?.length ?? 0) > 0 && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {item.stock_by_location!
                              .map((l) => `${l.name}: ${formatQty(l.quantity)}`)
                              .join(" · ")}
                          </p>
                        )}
                      </td>
                      {isAdmin && (
                        <>
                          <td className="px-4 py-4 text-right text-sm text-muted-foreground">
                            {formatUnitCost(item.unit_cost)}
                          </td>
                          <td className="px-4 py-4 text-right text-sm font-medium">
                            {formatCurrency(shownStock(item) * (parseFloat(item.unit_cost) || 0))}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-4 text-center">
                        {isLowStock ? (
                          <Badge
                            variant="outline"
                            className="bg-warning/10 text-warning border-warning/20"
                          >
                            مخزون منخفض
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-accent text-accent-foreground"
                          >
                            متوفر
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="حركة المخزون"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => setHistoryFor({ id: item.id, name: item.name, unit: item.unit })}
                          >
                            <History className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-50"
                            onClick={() => handleEditClick(item)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => handleDelete(item.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      <TablePagination pager={pager} />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} />
      <ProductHistoryDialog product={historyFor} onOpenChange={(v) => !v && setHistoryFor(null)} />
      <OpeningStockDialog open={openingOpen} onOpenChange={setOpeningOpen} />
    </div>
  );
}
