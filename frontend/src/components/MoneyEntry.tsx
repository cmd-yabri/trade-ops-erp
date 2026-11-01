import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, round2 } from "@/lib/utils";
import { Currency, MoneyInput } from "@/types/modules";

export interface MoneyState {
  currency: Currency;
  /** typed in `currency` */
  amount: string;
  /** SYP per 1 USD (only used for SYP) */
  rate: string;
}

const RATE_KEY = "last_syp_rate";

export const lastRate = (): string => {
  try {
    return localStorage.getItem(RATE_KEY) || "";
  } catch {
    return "";
  }
};
const rememberRate = (rate: string) => {
  try {
    if (rate) localStorage.setItem(RATE_KEY, rate);
  } catch {
    /* ignore */
  }
};

export const emptyMoney = (): MoneyState => ({ currency: "USD", amount: "", rate: lastRate() });

/** USD value of what was typed (0 when incomplete). */
export const usdValue = (m: MoneyState): number => {
  const amount = parseFloat(m.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (m.currency === "USD") return round2(amount);
  const rate = parseFloat(m.rate);
  return Number.isFinite(rate) && rate > 0 ? round2(amount / rate) : 0;
};

/** Fields the API expects for a payment / expense / withdrawal. */
export const toMoneyPayload = (m: MoneyState): MoneyInput => {
  if (m.currency === "SYP") {
    rememberRate(m.rate);
    return { currency: "SYP", paid_amount: m.amount, exchange_rate: m.rate };
  }
  return { currency: "USD", amount: round2(parseFloat(m.amount)).toFixed(2) };
};

interface MoneyEntryProps {
  value: MoneyState;
  onChange: (value: MoneyState) => void;
  /** show the USD / SYP switch (Money boxes feature) */
  enabled: boolean;
  label?: string;
  className?: string;
}

/** Amount field with an optional USD / SYP switch and exchange rate (SYP per 1 USD). */
export function MoneyEntry({ value, onChange, enabled, label = "المبلغ", className }: MoneyEntryProps) {
  const [touchedRate, setTouchedRate] = useState(false);
  const usd = usdValue(value);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {enabled && (
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
            {(["USD", "SYP"] as Currency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ ...value, currency: c })}
                className={cn(
                  "px-3 py-1",
                  value.currency === c ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
                )}
              >
                {c === "USD" ? "دولار $" : "ليرة ل.س"}
              </button>
            ))}
          </div>
        )}
      </div>
      <Input
        type="number"
        min="0"
        step="0.01"
        placeholder={value.currency === "USD" ? "0.00" : "المبلغ بالليرة"}
        value={value.amount}
        onChange={(e) => onChange({ ...value, amount: e.target.value })}
      />
      {enabled && value.currency === "SYP" && (
        <div className="grid grid-cols-2 gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">سعر الصرف (ل.س لكل 1$)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="مثال: 15000"
              value={value.rate}
              onChange={(e) => {
                setTouchedRate(true);
                onChange({ ...value, rate: e.target.value });
              }}
            />
          </div>
          <p className={cn("text-sm pb-2", usd > 0 ? "text-foreground" : "text-muted-foreground")}>
            {usd > 0 ? `= ${usd.toLocaleString("en-US", { style: "currency", currency: "USD" })}` : touchedRate ? "أدخل المبلغ والسعر" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
