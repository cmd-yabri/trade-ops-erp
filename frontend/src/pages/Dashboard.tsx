import {
  DollarSign,
  TrendingUp,
  ShoppingCart,
  AlertTriangle,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { ProductSalesChart } from "@/components/dashboard/ProductSalesChart";
import { ProfitTrendsChart } from "@/components/dashboard/ProfitTrendsChart";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { useDashboard, useChartData } from "@/hooks/useInvoice";
import { useAuth } from "@/contexts/AuthContext";
import { useProducts } from "@/hooks/useInventory";
import { useSalesOrders } from "@/hooks/useSales";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: dashboardData, isLoading: dashboardLoading } = useDashboard();
  const { isAdmin } = useAuth();
  const { data: chartData, isLoading: chartLoading } = useChartData(isAdmin);
  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: salesOrders, isLoading: salesLoading } = useSalesOrders();

  const lowStockItems =
    products?.filter(
      (item) => (item.current_stock || 0) <= (item.reorder_threshold || 0),
    ) || [];

  const pendingOrders =
    salesOrders?.filter((order) => !order.is_finalized).length || 0;

  const formatCurrency = (amount: string | number | undefined) => {
    const num = typeof amount === "string" ? parseFloat(amount) : amount || 0;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Number(num || 0) % 1 ? 2 : 0,  // $20.50, never $20.5
    }).format(num);
  };

  // Transform chart data for components
  const profitTrendsData =
    chartData?.map((item) => ({
      period: item.date,
      profit: parseFloat(item.net_profit),
      revenue: parseFloat(item.total_revenue),
      costs:
        parseFloat(item.total_cogs) +
        parseFloat(item.total_freelance_costs) +
        parseFloat(item.total_operational_expenses),
    })) || [];

  // Top sellers by revenue (units kept too) over finalized sales orders.
  const soldByProduct = new Map<string, { sales: number; revenue: number }>();
  (salesOrders || [])
    .filter((order) => order.is_finalized)
    .forEach((order) =>
      order.items.forEach((item) => {
        // what the customer kept: returned units come off at the line's price
        const kept = Number(item.quantity) - Number(item.returned_quantity ?? 0);
        const row = soldByProduct.get(item.product_name) || { sales: 0, revenue: 0 };
        row.sales += kept;
        row.revenue += kept * (parseFloat(String(item.unit_price)) || 0);
        soldByProduct.set(item.product_name, row);
      }),
    );
  const productSalesData = Array.from(soldByProduct.entries())
    .map(([name, row]) => ({ name, ...row }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Create transactions from sales orders
  const transactions =
    // only finalized sales are income; drafts would overstate it
    salesOrders?.filter((order) => order.is_finalized).slice(0, 5).map((order) => ({
      id: String(order.id),
      type: "sale" as const,
      description: `SO-${order.id} - ${order.client_name}`,
      amount: parseFloat(order.grand_total),
      date: (order.finalized_at || order.date).split("T")[0],
    })) || [];

  const isLoading =
    dashboardLoading || chartLoading || productsLoading || salesLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
            لوحة التحكم
          </h1>
          <p className="text-muted-foreground mt-1">
            جارٍ تحميل نظرة عامة على نشاطك التجاري...
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  const totalRevenue = dashboardData?.total_revenue || "0";
  const netProfit = dashboardData?.net_profit || "0";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
          لوحة التحكم
        </h1>
        <p className="text-muted-foreground mt-1">
          نظرة عامة على نشاطك التجاري
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <StatCard
          title="إجمالي الإيرادات"
          value={formatCurrency(totalRevenue)}
          icon={<DollarSign className="w-5 h-5" />}
          variant="success"
        />
        {isAdmin && (
          <StatCard
            title="صافي الربح"
            value={formatCurrency(netProfit)}
            icon={<TrendingUp className="w-5 h-5" />}
            variant="success"
          />
        )}
        <StatCard
          title="الطلبات المعلقة"
          variant="warning"
          value={String(pendingOrders)}
          icon={<ShoppingCart className="w-5 h-5" />}
        />
        <StatCard
          title="تنبيهات انخفاض المخزون"
          value={lowStockItems.length}
          icon={<AlertTriangle className="w-5 h-5" />}
          variant={lowStockItems.length > 0 ? "warning" : "default"}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProductSalesChart data={productSalesData} />
        {isAdmin && <ProfitTrendsChart data={profitTrendsData} />}
      </div>

      {/* Recent Activity */}
      <RecentActivity transactions={transactions} />
    </div>
  );
}
