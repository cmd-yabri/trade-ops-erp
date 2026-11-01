import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}

export function StatCard({
  title,
  value,
  icon,
  variant = "default",
  className,
}: StatCardProps) {
  const variantStyles = {
    default: "bg-card border border-border",
    success:
      "bg-card border-r-4 border-r-primary border-t-0 border-l-0 border-b-0",
    warning:
      "bg-card border-r-4 border-r-warning border-t-0 border-l-0 border-b-0",
    danger:
      "bg-card border-r-4 border-r-destructive border-t-0 border-l-0 border-b-0",
  };

  const iconBgStyles = {
    default: "bg-accent text-blue-600",
    success: "bg-green-100 text-green-600",
    warning: "bg-yellow-100 text-yellow-600",
    danger: "bg-red-100 text-red-600",
  };

  return (
    <div
      className={cn(
        "rounded-xl p-6 stat-card-shadow hover:shadow-lg transition-shadow duration-300",
        variantStyles[variant],
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl lg:text-3xl font-bold text-foreground">
            {value}
          </p>
        </div>
        <div className={cn("p-3 rounded-xl", iconBgStyles[variant])}>
          {icon}
        </div>
      </div>
    </div>
  );
}
