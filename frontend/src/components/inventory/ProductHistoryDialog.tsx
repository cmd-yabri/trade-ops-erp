import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMovements } from "@/hooks/useHistory";
import { cn, formatDate, formatQty } from "@/lib/utils";

interface ProductHistoryDialogProps {
  product: { id: number; name: string; unit?: string } | null;
  onOpenChange: (open: boolean) => void;
}

/** Every quantity change of one product: what came in or went out, where, why, and what was left. */
export function ProductHistoryDialog({ product, onOpenChange }: ProductHistoryDialogProps) {
  const { data: rows = [], isLoading } = useMovements(product?.id ?? null);
  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>حركة المخزون - {product?.name}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6">جارٍ التحميل...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">لا توجد حركات مسجلة بعد.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm text-right">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">التاريخ</th><th className="px-3">الحركة</th><th className="px-3">المكان</th>
                  <th className="px-3">الكمية</th><th className="px-3">الرصيد بعدها</th><th className="px-3">المرجع / السبب</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDate(m.created_at)} {new Date(m.created_at).toTimeString().slice(0, 5)}
                    </td>
                    <td className="px-3">{m.kind_label}</td>
                    <td className="px-3">{m.place}</td>
                    <td className={cn("px-3 font-semibold", Number(m.delta) < 0 ? "text-destructive" : "text-emerald-700")} dir="ltr">
                      {Number(m.delta) > 0 ? "+" : ""}{formatQty(m.delta)}
                    </td>
                    <td className="px-3">{formatQty(m.balance_after)} {product?.unit || ""}</td>
                    <td className="px-3 text-muted-foreground">{[m.ref, m.note].filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
