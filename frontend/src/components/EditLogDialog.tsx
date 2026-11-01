import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEditLog } from "@/hooks/useHistory";
import { formatDate } from "@/lib/utils";

interface EditLogDialogProps {
  docType: "SO" | "PO";
  docId: number | null;
  onOpenChange: (open: boolean) => void;
}

type Line = { product?: string; quantity?: string; price?: string; received?: string; from?: string };

const lineText = (l: Line) =>
  `${l.product} × ${l.quantity}${l.price ? ` @ ${l.price}` : ""}${l.from ? ` (من ${l.from})` : ""}`;

/** Who changed a finalized sale / received purchase order, when, and what it was before and after. */
export function EditLogDialog({ docType, docId, onOpenChange }: EditLogDialogProps) {
  const { data: rows = [], isLoading } = useEditLog(docType, docId);
  return (
    <Dialog open={docId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>سجل تعديلات {docType}-{docId}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد تعديلات على هذا المستند.</p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="font-medium">{r.summary}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(r.created_at)} {new Date(r.created_at).toTimeString().slice(0, 5)} · {r.user || "—"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {(["before", "after"] as const).map((side) => {
                    const snap = r[side] as { total?: string; discount?: string; date?: string; items?: Line[] };
                    return (
                      <div key={side} className={side === "before" ? "text-muted-foreground" : ""}>
                        <p className="font-semibold mb-1">{side === "before" ? "قبل" : "بعد"}</p>
                        <p>التاريخ: {snap.date ? formatDate(snap.date) : "—"} · الخصم: {snap.discount ?? "0"}</p>
                        {(snap.items ?? []).map((l, i) => (
                          <p key={i}>{lineText(l)}</p>
                        ))}
                        <p className="font-semibold">الإجمالي: {snap.total}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
