import { useState } from "react";
import { Truck, Plus, Pencil, Trash2, ArrowLeftRight, Fuel, Loader2, Phone, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/SimpleSelect";
import { TransferDialog } from "@/components/TransferDialog";
import { MoneyEntry, emptyMoney, toMoneyPayload, usdValue } from "@/components/MoneyEntry";
import { useToast } from "@/hooks/use-toast";
import { useCar, useCars, useDeleteCar, useSaveCar } from "@/hooks/useModules";
import { useCreateExpense } from "@/hooks/useInvoice";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useAuth } from "@/contexts/AuthContext";
import { getErrorMessage } from "@/lib/errors";
import { formatMoney, formatQty, todayLocal } from "@/lib/utils";
import { Car } from "@/types/modules";
import { CategoryEnum } from "@/types/api";
import { confirmAction, confirmMoneyAction } from "@/lib/confirmMoneyAction";

const CAR_EXPENSES: { value: CategoryEnum; label: string }[] = [
  { value: "FUEL", label: "وقود" },
  { value: "MAINTENANCE", label: "صيانة" },
  { value: "SALARY", label: "راتب السائق" },
  { value: "OTHER", label: "أخرى" },
];
const categoryLabel = (c: string) => CAR_EXPENSES.find((e) => e.value === c)?.label ?? c;

const emptyCar = { name: "", plate: "", driver_name: "", phone: "", notes: "" };

export default function Cars() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { features } = useFeatures();
  const { data: cars = [], isLoading } = useCars(features.cars);
  const saveCar = useSaveCar();
  const deleteCar = useDeleteCar();
  const createExpense = useCreateExpense();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Car | null>(null);
  const [form, setForm] = useState(emptyCar);
  const [detailId, setDetailId] = useState<number | null>(null);
  const { data: detail } = useCar(detailId);
  const [transferTo, setTransferTo] = useState<string | undefined>();
  const [transferOpen, setTransferOpen] = useState(false);
  const [expenseCar, setExpenseCar] = useState<Car | null>(null);
  const [expense, setExpense] = useState({ category: "FUEL" as CategoryEnum, description: "", date: todayLocal() });
  const [money, setMoney] = useState(emptyMoney());

  if (!features.cars) {
    return <p className="text-muted-foreground">ميزة السيارات غير مفعّلة. فعّلها من الإعدادات.</p>;
  }

  const openForm = (car: Car | null) => {
    setEditing(car);
    setForm(car ? { name: car.name, plate: car.plate, driver_name: car.driver_name, phone: car.phone, notes: car.notes } : emptyCar);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "خطأ", description: "اسم السيارة مطلوب.", variant: "destructive" });
      return;
    }
    try {
      await saveCar.mutateAsync({ id: editing?.id, data: form });
      toast({ title: editing ? "تم التحديث" : "تمت إضافة السيارة" });
      setFormOpen(false);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحفظ"), variant: "destructive" });
    }
  };

  const handleDelete = async (car: Car) => {
    if (!await confirmAction(`حذف السيارة «${car.name}»؟`)) return;
    try {
      await deleteCar.mutateAsync(car.id);
      toast({ title: "تم الحذف" });
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل الحذف"), variant: "destructive" });
    }
  };

  const handleExpense = async () => {
    if (!expenseCar) return;
    if (!expense.description.trim() || usdValue(money) <= 0) {
      toast({ title: "خطأ", description: "أدخل الوصف والمبلغ.", variant: "destructive" });
      return;
    }
    const amount = money.currency === "USD"
      ? formatMoney(usdValue(money))
      : `${Number(money.amount).toLocaleString("en-US")} ل.س (≈ ${formatMoney(usdValue(money))})`;
    if (!await confirmMoneyAction(`تسجيل مصروف ${categoryLabel(expense.category)} للسيارة ${expenseCar.name} بقيمة ${amount}؟`)) return;
    try {
      await createExpense.mutateAsync({
        type: "EXPENSE",
        category: expense.category,
        description: expense.description,
        date: expense.date,
        car: expenseCar.id,
        ...toMoneyPayload(money),
      });
      toast({ title: "تم تسجيل المصروف" });
      setExpenseCar(null);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "فشل التسجيل"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">السيارات</h1>
          <p className="text-muted-foreground mt-1">مخزون كل سيارة ومصاريفها ومبيعاتها</p>
        </div>
        <Button variant="brand" onClick={() => openForm(null)}>
          <Plus className="w-4 h-4 ml-2" /> إضافة سيارة
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">جارٍ التحميل...</p>
      ) : cars.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
          لا توجد سيارات بعد. أضف سيارتك الأولى.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cars.map((car) => (
            <div key={car.id} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-accent text-accent-foreground">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{car.name}</h3>
                    <p className="text-xs text-muted-foreground">{car.plate || "بدون لوحة"}</p>
                  </div>
                </div>
                {!car.is_active && <Badge variant="outline">غير فعّالة</Badge>}
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p className="flex items-center gap-2"><User className="w-4 h-4" /> {car.driver_name || "—"}</p>
                <p className="flex items-center gap-2"><Phone className="w-4 h-4" /> <span dir="ltr">{car.phone || "—"}</span></p>
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <Button size="sm" variant="outline" onClick={() => setDetailId(car.id)}>التفاصيل</Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTransferTo(`car:${car.id}`);
                    setTransferOpen(true);
                  }}
                >
                  <ArrowLeftRight className="w-4 h-4 ml-1" /> تحميل بضاعة
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setExpenseCar(car);
                    setExpense({ category: "FUEL", description: "", date: todayLocal() });
                    setMoney(emptyMoney());
                  }}
                >
                  <Fuel className="w-4 h-4 ml-1" /> مصروف
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openForm(car)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                {isAdmin && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(car)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل السيارة" : "إضافة سيارة"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>اسم السيارة</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>رقم اللوحة</Label>
                <Input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>اسم السائق</Label>
                <Input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>هاتف السائق</Label>
              <Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button variant="brand" className="w-full" onClick={handleSave} disabled={saveCar.isPending}>
              {saveCar.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              حفظ
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Details */}
      <Dialog open={detailId !== null} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail ? `${detail.name} ${detail.plate ? `(${detail.plate})` : ""}` : "..."}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-6 py-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {detail.stock_value !== null && (
                  <div className="bg-muted rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">قيمة البضاعة على السيارة</p>
                    <p className="font-bold">{formatMoney(detail.stock_value)}</p>
                  </div>
                )}
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">مصاريف السيارة</p>
                  <p className="font-bold text-destructive">{formatMoney(detail.expenses_total)}</p>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">عدد المبيعات</p>
                  <p className="font-bold">{detail.sales_count}</p>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">إجمالي المبيعات</p>
                  <p className="font-bold text-primary">{formatMoney(detail.sales_total)}</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">البضاعة على السيارة</h4>
                {detail.stock.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد بضاعة. استخدم «تحميل بضاعة» لنقلها من المخزن.</p>
                ) : (
                  <table className="w-full text-sm text-right">
                    <thead className="text-muted-foreground">
                      <tr><th className="py-1">المنتج</th><th>الكمية</th>{detail.stock_value !== null && <th>القيمة</th>}</tr>
                    </thead>
                    <tbody>
                      {detail.stock.map((row) => (
                        <tr key={row.product} className="border-t border-border">
                          <td className="py-2">{row.product_name}</td>
                          <td>{formatQty(row.quantity)} {row.unit}</td>
                          {detail.stock_value !== null && <td>{formatMoney(row.value)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <h4 className="font-semibold mb-2">المصاريف</h4>
                {detail.expenses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد مصاريف مسجلة.</p>
                ) : (
                  <table className="w-full text-sm text-right">
                    <thead className="text-muted-foreground">
                      <tr><th className="py-1">التاريخ</th><th>النوع</th><th>الوصف</th><th>المبلغ</th></tr>
                    </thead>
                    <tbody>
                      {detail.expenses.map((e) => (
                        <tr key={e.id} className="border-t border-border">
                          <td className="py-2">{e.date}</td>
                          <td>{categoryLabel(e.category)}</td>
                          <td>{e.description}</td>
                          <td>{formatMoney(e.amount)}</td>
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

      {/* Car expense */}
      <Dialog open={expenseCar !== null} onOpenChange={(v) => !v && setExpenseCar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>مصروف سيارة {expenseCar?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>النوع</Label>
              <SimpleSelect
                value={expense.category}
                onChange={(v) => setExpense({ ...expense, category: v as CategoryEnum })}
                options={CAR_EXPENSES}
              />
            </div>
            <div className="space-y-2">
              <Label>الوصف</Label>
              <Input value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} />
            </div>
            <MoneyEntry enabled={features.money_boxes} value={money} onChange={setMoney} />
            <div className="space-y-2">
              <Label>التاريخ</Label>
              <Input type="date" value={expense.date} onChange={(e) => setExpense({ ...expense, date: e.target.value })} />
            </div>
            <Button variant="brand" className="w-full" onClick={handleExpense} disabled={createExpense.isPending}>
              {createExpense.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              تسجيل
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} defaultTo={transferTo} />
    </div>
  );
}
