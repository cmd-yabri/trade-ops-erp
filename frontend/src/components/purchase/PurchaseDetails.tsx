import { History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatQty, formatUnitCost } from "@/lib/utils";
import { PurchaseOrder } from "@/types/api";

interface PurchaseDetailsProps {
  order: PurchaseOrder | null;
  onClose: () => void;
  format: (amount: number | string) => string;
  isAdmin: boolean;
  onDeleteReturn: (poId: number, returnId: number) => void;
  onShowLog: (poId: number) => void;
}

/** One purchase order: each line with what arrived / went back and its real unit cost, returns, payments. */
export function PurchaseDetails({ order, onClose, format, isAdmin, onDeleteReturn, onShowLog }: PurchaseDetailsProps) {
  if (!order) return null;
  const transport = Number(order.transport_cost) || 0;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>أمر الشراء PO-{order.id} - {order.supplier}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          <p className="text-muted-foreground">
            التاريخ {formatDate(order.order_date)}
            {order.branch_name && ` · يستلم في ${order.branch_name}`}
            {order.received_at && ` · آخر استلام ${formatDate(order.received_at)}`}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-right">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">المنتج</th><th className="px-3">الكمية</th><th className="px-3">وصل</th>
                  <th className="px-3">أُرجع</th><th className="px-3">سعر الفاتورة</th>
                  <th className="px-3" title="بعد حصة الخصم وأجرة النقل">التكلفة الفعلية</th><th className="px-3">المجموع</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="px-3 py-2">{i.product_name}</td>
                    <td className="px-3">{formatQty(i.quantity)}</td>
                    <td className="px-3">{formatQty(i.received_quantity)}</td>
                    <td className="px-3">{Number(i.returned_quantity) > 0 ? formatQty(i.returned_quantity ?? 0) : "—"}</td>
                    <td className="px-3">{formatUnitCost(i.unit_cost)}</td>
                    <td className="px-3">{i.landed_unit_cost ? formatUnitCost(i.landed_unit_cost) : "—"}</td>
                    <td className="px-3">{format(i.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg bg-muted p-3 space-y-1">
            <div className="flex justify-between"><span>المجموع:</span><span>{format(order.total_cost)}</span></div>
            {Number(order.discount) > 0 && (
              <div className="flex justify-between"><span>الخصم:</span><span>-{format(order.discount ?? 0)}</span></div>
            )}
            {transport > 0 && (
              <div className="flex justify-between">
                <span>أجرة النقل ({order.transport_payee === "SUPPLIER" ? "على فاتورة المورد" : "لناقل مستقل"}):</span>
                <span>{format(transport)}</span>
              </div>
            )}
            {Number(order.returned_total) > 0 && (
              <div className="flex justify-between text-amber-700"><span>المرتجعات:</span><span>-{format(order.returned_total ?? 0)}</span></div>
            )}
            <div className="flex justify-between font-semibold border-t pt-1">
              <span>المستحق للمورد:</span><span>{format(order.due_total ?? order.net_total ?? 0)}</span>
            </div>
            <div className="flex justify-between"><span>المدفوع:</span><span className="text-emerald-700">{format(order.paid_amount)}</span></div>
            <div className="flex justify-between font-semibold"><span>المتبقي:</span><span className="text-destructive">{format(order.remaining)}</span></div>
          </div>

          {(order.returns ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="font-semibold">المرتجعات إلى المورد</p>
              {(order.returns ?? []).map((r) => (
                <div key={r.id} className="flex justify-between items-center rounded border border-amber-200 bg-amber-50 p-2">
                  <span>
                    {formatDate(r.date)} · {r.lines.map((l) => `${l.product_name} × ${formatQty(l.quantity)}`).join("، ")}
                    {r.refund_amount > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {" "}({r.refund_to_credit ? "بقي رصيداً لنا عنده" : "استرددناه"} {format(r.refund_amount)})
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">-{format(r.value)}</span>
                    {isAdmin && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="إلغاء المرتجع"
                        onClick={() => onDeleteReturn(order.id, r.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {order.payments.length > 0 && (
            <div className="space-y-1">
              <p className="font-semibold">الدفعات</p>
              {order.payments.map((p) => (
                <div key={p.id} className="flex justify-between rounded bg-muted p-2">
                  <span>{formatDate(p.payment_date)}</span>
                  <span>{format(p.amount)}</span>
                </div>
              ))}
            </div>
          )}

          {isAdmin && order.status !== "PENDING" && (
            <Button variant="outline" size="sm" onClick={() => onShowLog(order.id)}>
              <History className="w-4 h-4 ml-1" /> سجل التعديلات
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
