import { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatDate, todayLocal } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/contexts/AuthContext";
import { usePagination } from "@/hooks/usePagination";
import { TablePagination } from "@/components/TablePagination";
import { MoneyEntry, MoneyState, emptyMoney, toMoneyPayload, usdValue } from "@/components/MoneyEntry";
import { useFeatures } from "@/contexts/FeaturesContext";
import { formatMoney } from "@/lib/utils";
import {
  useChartData,
  useFinancialSummary,
  usePeriodFinancialSummary,
  useExpenses,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  useJournal,
} from "@/hooks/useInvoice";
import { JournalRow } from "@/types/api";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { confirmMoneyAction } from "@/lib/confirmMoneyAction";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

type TimePeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export default function Financials() {
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("weekly");
  // the money journal: everything, only money in, or only money out
  const [filterType, setFilterType] = useState<"all" | "in" | "out">("all");
  const { isAdmin: canSeeProfit } = useAuth();
  const { data: chartData, isLoading: chartLoading } = useChartData(canSeeProfit);
  const { data: summary, isLoading: summaryLoading } =
    usePeriodFinancialSummary(selectedPeriod);
  const { data: expenses } = useExpenses();
  const expensePager = usePagination(expenses || [], 10);
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { data: journal = [] } = useJournal(isAdmin);

  // Expense dialog state
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const { features } = useFeatures();
  const [money, setMoney] = useState<MoneyState>(emptyMoney());
  const [newExpense, setNewExpense] = useState({
    type: "EXPENSE" as "EXPENSE" | "INCOME",
    description: "",
    category: "" as any,
    date: todayLocal(),
  });

  const expenseCategories = [
    { value: "RENT", label: "الإيجار" },
    { value: "ELECTRICITY", label: "الكهرباء" },
    { value: "WATER", label: "المياه" },
    { value: "UTILITIES", label: "الخدمات" },
    { value: "SALARY", label: "الرواتب" },
    { value: "MARKETING", label: "التسويق" },
    { value: "OTHER", label: "آخر" },
  ];
  const incomeCategories = [{ value: "OTHER_INCOME", label: "إيرادات أخرى" }];
  const isIncome = newExpense.type === "INCOME";

  const periods: { value: TimePeriod; label: string }[] = [
    { value: "daily", label: "اليوم" },
    { value: "weekly", label: "هذا الأسبوع" },
    { value: "monthly", label: "هذا الشهر" },
    { value: "quarterly", label: "هذا الربع" },
    { value: "yearly", label: "هذه السنة" },
  ];

  const formatCurrency = (amount: string | number) => {
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return (Number(num) < 0 ? "‎" : "") + new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Number(num || 0) % 1 ? 2 : 0,  // $20.50, never $20.5
    }).format(num);
  };

  const resetExpenseForm = () => {
    setEditingExpenseId(null);
    setNewExpense({
      type: "EXPENSE",
      description: "",
      category: "",
      date: todayLocal(),
    });
    setMoney(emptyMoney());
  };

  const handleExpenseSubmit = async () => {
    try {
      if (
        !newExpense.description ||
        !newExpense.category ||
        !money.amount
      ) {
        toast({
          title: "خطأ",
          description: "يرجى ملء جميع الحقول",
          variant: "destructive",
        });
        return;
      }

      if (!(usdValue(money) > 0)) {
        toast({
          title: "خطأ",
          description: "أدخل مبلغاً أكبر من صفر.",
          variant: "destructive",
        });
        return;
      }
      const amount = money.currency === "USD"
        ? formatMoney(usdValue(money))
        : `${Number(money.amount).toLocaleString("en-US")} ل.س (≈ ${formatMoney(usdValue(money))})`;
      if (!await confirmMoneyAction(
        `${editingExpenseId ? "تعديل" : "تسجيل"} ${isIncome ? "إيراد" : "مصروف"} بقيمة ${amount} (${newExpense.description.trim()})؟`,
      )) return;

      if (editingExpenseId) {
        await updateExpense.mutateAsync({
          id: editingExpenseId,
          expense: {
            description: newExpense.description,
            category: newExpense.category,
            ...toMoneyPayload(money),
            date: newExpense.date,
            type: newExpense.type,
          } as any,
        });
        toast({
          title: "تم التحديث",
          description: isIncome ? "تم تحديث الإيراد بنجاح" : "تم تحديث المصروف بنجاح",
        });
      } else {
        await createExpense.mutateAsync({
          description: newExpense.description,
          category: newExpense.category,
          ...toMoneyPayload(money),
          date: newExpense.date,
          type: newExpense.type,
        } as any);

        toast({
          title: "تم الإضافة",
          description: isIncome ? "تمت إضافة الإيراد بنجاح" : "تمت إضافة المصروف بنجاح",
        });
      }
      setIsExpenseDialogOpen(false);
      resetExpenseForm();
    } catch (error) {
      toast({
        title: "خطأ",
        description: getErrorMessage(error, "فشل حفظ المصروف"),
        variant: "destructive",
      });
    }
  };

  const handleEditExpense = (expense: any) => {
    setEditingExpenseId(expense.id);
    setNewExpense({
      type: expense.type === "INCOME" ? "INCOME" : "EXPENSE",
      description: expense.description,
      category: expense.category,
      date: expense.date,
    });
    setMoney(
      expense.currency === "SYP" && expense.paid_amount
        ? { currency: "SYP", amount: String(expense.paid_amount), rate: String(expense.exchange_rate ?? "") }
        : { currency: "USD", amount: String(expense.amount), rate: emptyMoney().rate },
    );
    setIsExpenseDialogOpen(true);
  };

  const handleDeleteExpense = async (id: number) => {
    const expense = expenses?.find((item) => item.id === id);
    if (await confirmMoneyAction(
      `حذف ${expense?.type === "INCOME" ? "الإيراد" : "المصروف"} «${expense?.description ?? ""}» بقيمة ${formatMoney(Number(expense?.amount ?? 0))}؟`,
    )) {
      try {
        await deleteExpense.mutateAsync(id);
        toast({
          title: "تم الحذف",
          description: "تم الحذف بنجاح",
        });
      } catch (error) {
        toast({
          title: "خطأ",
          description: getErrorMessage(error, "فشل حذف المصروف"),
          variant: "destructive",
        });
      }
    }
  };

  const JOURNAL_KINDS: Record<string, string> = {
    sale_payment: "دفعة عميل",
    supplier_payment: "دفعة مورد",
    income: "إيراد",
    expense: "مصروف",
    deposit: "إيداع",
    withdrawal: "سحب",
    exchange_in: "تحويل عملة",
    exchange_out: "تحويل عملة",
    sale_refund: "مرتجع عميل",
    supplier_refund: "استرداد من مورد",
    partner_withdrawal: "سحب شريك",
    account_in: "دفعة حساب",
    account_out: "دفعة حساب",
  };
  const journalKindLabel = (r: JournalRow) =>
    r.category && (r.kind === "expense" || r.kind === "income")
      ? getCategoryLabel(r.category)
      : JOURNAL_KINDS[r.kind] || r.kind;

  const getCategoryLabel = (category: string) => {
    if (category === "STOCK") return "شراء بضاعة";
    if (category === "FREIGHT") return "أجرة نقل مشتريات";
    return (
      [...expenseCategories, ...incomeCategories].find((c) => c.value === category)?.label || category
    );
  };

  const income = parseFloat(summary?.total_revenue || "0");
  const cogs = parseFloat(summary?.total_cogs || "0");
  const freelanceCosts = parseFloat(summary?.total_freelance_costs || "0");
  const opExpenses = parseFloat(summary?.total_operational_expenses || "0");
  const netProfit = parseFloat(summary?.net_profit || "0");
  const flowUsd = summary?.cash_flow?.USD;
  const flowSyp = summary?.cash_flow?.SYP;
  const IN_PARTS = [
    ["customers", "من العملاء"],
    ["other_income", "إيرادات أخرى"],
    ["other", "إيداع واسترداد"],
  ] as const;
  const OUT_PARTS = [
    ["suppliers", "للموردين"],
    ["goods", "شراء بضاعة ونقلها"],
    ["expenses", "مصاريف (إيجار، رواتب...)"],
    ["other", "سحب ومرتجعات"],
  ] as const;

  const transformedChartData =
    chartData?.map((item) => ({
      period: item.date,
      income: parseFloat(item.total_revenue),
      outcome:
        parseFloat(item.total_cogs) +
        parseFloat(item.total_freelance_costs) +
        parseFloat(item.total_operational_expenses),
      profit: parseFloat(item.net_profit),
    })) || [];

  const journalRows = journal.filter((r) =>
    filterType === "all" ? true : filterType === "in" ? Number(r.amount) > 0 : Number(r.amount) < 0,
  );
  const latestRows = journalRows.slice(0, 5);

  const isLoading = chartLoading || summaryLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
          البيانات المالية
        </h1>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
          البيانات المالية
        </h1>
        <p className="text-muted-foreground mt-1">تتبع الدخل والإنفاق والربح</p>
      </div>

      <div className="flex flex-wrap gap-2 p-1.5 bg-muted rounded-xl w-fit">
        {periods.map((period) => (
          <Button
            key={period.value}
            variant={selectedPeriod === period.value ? "default" : "ghost"}
            size="sm"
            onClick={() => setSelectedPeriod(period.value)}
            className={cn(
              "h-9 px-4",
              selectedPeriod === period.value && "shadow-sm",
            )}
          >
            {period.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-accent text-accent-foreground">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">إجمالي الدخل</p>
              <p className="text-xs text-muted-foreground">كل مال دخل الصندوق في هذه الفترة</p>
            </div>
          </div>
          <p className="text-3xl font-bold text-primary">
            {formatCurrency(flowUsd?.in ?? 0)}
          </p>
          {!!flowSyp?.in && <p className="text-sm font-semibold text-primary mt-1">+ {formatMoney(flowSyp.in, "SYP")}</p>}
          <div className="mt-3 space-y-1 text-sm">
            {IN_PARTS.filter(([key]) => flowUsd?.in_parts[key]).map(([key, label]) => (
              <div key={key} className="flex justify-between">
                <span className="text-muted-foreground">{label}:</span>
                <span>{formatCurrency(flowUsd?.in_parts[key] ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* cost of goods and profit: the owner's eyes only */}
        <div className={cn("bg-card border border-border rounded-xl p-6", !isAdmin && "hidden")}>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-destructive/10 text-destructive">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">إجمالي المصاريف</p>
              <p className="text-xs text-muted-foreground">كل مال خرج من الصندوق في هذه الفترة</p>
            </div>
          </div>
          <p className="text-3xl font-bold text-destructive">
            {formatCurrency(flowUsd?.out ?? 0)}
          </p>
          {!!flowSyp?.out && <p className="text-sm font-semibold text-destructive mt-1">+ {formatMoney(flowSyp.out, "SYP")}</p>}
          <div className="mt-3 space-y-1 text-sm">
            {OUT_PARTS.filter(([key]) => flowUsd?.out_parts[key]).map(([key, label]) => (
              <div key={key} className="flex justify-between">
                <span className="text-muted-foreground">{label}:</span>
                <span>{formatCurrency(flowUsd?.out_parts[key] ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={cn("bg-gradient-to-br from-primary to-blue-700 rounded-xl p-6 text-primary-foreground", !isAdmin && "hidden")}>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-primary-foreground/20">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm text-primary-foreground/80">صافي الربح</p>
            </div>
          </div>
          <p className="text-4xl font-bold">
            {netProfit < 0 ? "-" : "+"}
            {formatCurrency(Math.abs(netProfit))}
          </p>
          <p className="text-xs text-primary-foreground/80 mt-2">
            المبيعات {formatCurrency(income)} − تكلفة البضاعة المباعة {formatCurrency(cogs)}
            {freelanceCosts > 0 && ` − العمل الحر ${formatCurrency(freelanceCosts)}`} − المصاريف {formatCurrency(opExpenses)}
          </p>
          {income > 0 && (
            <p className="text-sm text-primary-foreground/80 mt-4">
              هامش الربح:{" "}
              <span className="font-semibold">
                {Math.min((netProfit / income) * 100, 100).toFixed(1)}%
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Money that actually moved in the period, and what is still open today */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "قبضنا من العملاء", hint: "في هذه الفترة", value: summary?.cash_received, tone: "text-emerald-600" },
          { label: "دفعنا للموردين", hint: "في هذه الفترة", value: summary?.supplier_payments, tone: "text-red-600" },
          { label: "ديون لنا عند العملاء", hint: "المتبقي على طلبات البيع حتى اليوم", value: summary?.receivables, tone: "text-amber-600" },
          { label: "ديون علينا للموردين", hint: "المتبقي على أوامر الشراء حتى اليوم", value: summary?.payables, tone: "text-blue-600" },
        ].map((card) => (
          <div key={card.label} className="bg-card border border-border rounded-xl p-5">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className={cn("text-2xl font-bold mt-1", card.tone)}>{formatCurrency(card.value ?? "0")}</p>
            <p className="text-xs text-muted-foreground mt-1">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-6", !isAdmin && "hidden")}>
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-foreground mb-6">
            الإيرادات مقابل المصروفات
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={transformedChartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  vertical={false}
                />
                <XAxis
                  dataKey="period"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(v)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [formatCurrency(value)]}
                />
                <Bar
                  dataKey="income"
                  name="Income"
                  fill="hsl(160, 84%, 39%)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="outcome"
                  name="Expenses"
                  fill="hsl(0, 72%, 51%)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-foreground mb-6">
            صافي الربح مع مرور الوقت
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={transformedChartData}>
                <defs>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="hsl(160, 84%, 39%)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="hsl(160, 84%, 39%)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  vertical={false}
                />
                <XAxis
                  dataKey="period"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(v)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [
                    formatCurrency(value),
                    "Profit",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="profit"
                  stroke="hsl(160, 84%, 39%)"
                  strokeWidth={2}
                  fill="url(#profitGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">آخر الحركات المالية</h3>
              <p className="text-xs text-muted-foreground mt-1">آخر 5 حركات دخلت الصندوق أو خرجت منه.</p>
            </div>
            <div className="flex gap-2">
              {([
                ["all", "الكل"],
                ["in", "الدخل"],
                ["out", "المصروف"],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={filterType === value ? "default" : "ghost"}
                  onClick={() => setFilterType(value)}
                  className={cn("h-9 px-3", filterType === value && "shadow-sm")}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">التاريخ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">الوصف</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">النوع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">المبلغ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {latestRows.map((r) => {
                  const incoming = Number(r.amount) > 0;
                  return (
                    <tr key={`${r.currency}-${r.ref}-${r.kind}`} className="hover:bg-muted/30">
                      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-4 py-3 text-sm">{r.description}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap",
                            incoming ? "bg-accent text-accent-foreground" : "bg-destructive/10 text-destructive",
                          )}
                        >
                          {incoming ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
                          {journalKindLabel(r)}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-sm font-semibold text-right whitespace-nowrap",
                          incoming ? "text-primary" : "text-destructive",
                        )}
                        dir="ltr"
                      >
                        {incoming ? "+" : "-"}
                        {formatMoney(Math.abs(Number(r.amount)), r.currency)}
                      </td>
                    </tr>
                  );
                })}
                {journalRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      لا توجد حركات مالية بعد
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-foreground">
            المصروفات والإيرادات الإضافية
          </h3>
          <Dialog
            open={isExpenseDialogOpen}
            onOpenChange={(open) => {
              setIsExpenseDialogOpen(open);
              if (!open) resetExpenseForm();
            }}
          >
            <DialogTrigger asChild>
              <Button variant="brand" size="sm" className="gap-2">
                <Plus className="w-4 h-4" /> إضافة مصروف أو إيراد
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingExpenseId
                    ? isIncome ? "تعديل الإيراد" : "تعديل المصروف"
                    : isIncome ? "إضافة إيراد جديد" : "إضافة مصروف جديد"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ["EXPENSE", "مصروف (يخرج من الصندوق)"],
                    ["INCOME", "إيراد (يدخل الصندوق)"],
                  ] as const).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      variant={newExpense.type === value ? "default" : "outline"}
                      onClick={() =>
                        setNewExpense({
                          ...newExpense,
                          type: value,
                          category: value === "INCOME" ? "OTHER_INCOME" : "",
                        })
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label>الوصف</Label>
                  <Input
                    placeholder={isIncome ? "مثال: بيع خردة" : "مثال: فاتورة الكهرباء"}
                    value={newExpense.description}
                    onChange={(e) =>
                      setNewExpense({
                        ...newExpense,
                        description: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label>الفئة</Label>
                  <Select
                    value={newExpense.category}
                    onValueChange={(value) =>
                      setNewExpense({ ...newExpense, category: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الفئة" />
                    </SelectTrigger>
                    <SelectContent>
                      {(isIncome ? incomeCategories : expenseCategories)
                        .map((cat) => (
                          <SelectItem
                            key={cat.value}
                            value={cat.value.toString()}
                          >
                            {cat.label || "بدون اسم"}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <MoneyEntry
                  enabled={features.money_boxes}
                  value={money}
                  onChange={setMoney}
                />

                <div className="space-y-2">
                  <Label>التاريخ</Label>
                  <Input
                    type="date"
                    value={newExpense.date}
                    onChange={(e) =>
                      setNewExpense({ ...newExpense, date: e.target.value })
                    }
                  />
                </div>

                <Button
                  onClick={handleExpenseSubmit}
                  disabled={createExpense.isPending}
                  className="w-full"
                >
                  {createExpense.isPending ? "جاري الحفظ..." : isIncome ? "حفظ الإيراد" : "حفظ المصروف"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-3">
          {expenses && expenses.length > 0 ? (
            expensePager.pageItems
              .map((expense) => (
                <div
                  key={expense.id}
                  className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/30"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">
                        {getCategoryLabel(expense.category)}
                      </Badge>
                      <div>
                        <p className="font-medium text-foreground">
                          {expense.description}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(expense.date)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <p
                      className={cn(
                        "text-lg font-semibold text-left",
                        expense.type === "INCOME" ? "text-primary" : "text-destructive",
                      )}
                    >
                      {expense.type === "INCOME" ? "+" : ""}
                      {formatCurrency(expense.amount)}
                      {expense.currency === "SYP" && expense.paid_amount && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {formatMoney(expense.paid_amount, "SYP")}
                        </span>
                      )}
                    </p>
                    <div className={cn("flex gap-2", (expense.purchase_order || expense.opening_stock) && "hidden")}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditExpense(expense)}
                        className="h-8 w-8 p-0"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteExpense(expense.id)}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
          ) : (
            <p className="text-center text-muted-foreground py-8">
              لا توجد مصروفات أو إيرادات مضافة حالياً
            </p>
          )}
        </div>
        <TablePagination pager={expensePager} />
      </div>
    </div>
  );
}
