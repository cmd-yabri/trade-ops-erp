import { Badge } from "@/components/ui/badge";

/** Paid / partial / unpaid, the same on sales and purchase orders. */
export function PaymentBadge({ status }: { status?: string | null }) {
  if (status === "paid") return <Badge className="bg-green-100 text-green-700 border-green-200">مدفوع</Badge>;
  if (status === "partial") return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">جزئي</Badge>;
  return <Badge className="bg-red-100 text-red-700 border-red-200">غير مدفوع</Badge>;
}
