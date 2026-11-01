import { Transaction } from "@/types";
import { cn, formatDate } from "@/lib/utils";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";

interface RecentActivityProps {
  transactions: Transaction[];
}

export function RecentActivity({ transactions }: RecentActivityProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: amount % 1 ? 2 : 0,
    }).format(Math.abs(amount));
  };

  return (
    <div className="bg-card rounded-xl border border-border p-6 stat-card-shadow">
      <h3 className="text-lg font-semibold text-foreground mb-4">
        النشاط الأخير
      </h3>
      <div className="space-y-3">
        {transactions.slice(0, 5).map((transaction, index) => (
          <div
            key={transaction.id}
            className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors animate-fade-in"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div
              className={cn(
                "p-2 rounded-lg",
                transaction.type === "sale"
                  ? "bg-accent text-accent-foreground"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {transaction.type === "sale" ? (
                <ArrowUpRight className="w-4 h-4" />
              ) : (
                <ArrowDownLeft className="w-4 h-4" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {transaction.description}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(transaction.date)}
              </p>
            </div>
            <div
              className={cn(
                "text-sm font-semibold",
                transaction.amount > 0 ? "text-primary" : "text-destructive",
              )}
            >
              {transaction.amount > 0 ? "+" : "-"}
              {formatCurrency(transaction.amount)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
