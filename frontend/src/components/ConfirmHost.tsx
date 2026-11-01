import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { ConfirmRequest, registerConfirmHost } from "@/lib/confirmMoneyAction";

export function ConfirmHost() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);

  useEffect(() => {
    registerConfirmHost((request) => setQueue((current) => [...current, request]));
    return () => registerConfirmHost(null);
  }, []);

  const current = queue[0];
  const answer = (accepted: boolean) => {
    // Radix also fires onOpenChange(false) after a button click: the first answer wins, removal is by identity.
    current?.resolve(accepted);
    setQueue((rest) => rest.filter((request) => request !== current));
  };

  return (
    <AlertDialog open={Boolean(current)} onOpenChange={(open) => { if (!open) answer(false); }}>
      <AlertDialogContent dir="rtl" className="text-right">
        <AlertDialogHeader className="sm:text-right">
          <AlertDialogTitle>{current?.title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{current?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-start sm:space-x-0">
          <AlertDialogAction
            className={cn(current?.destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            onClick={() => answer(true)}
          >
            {current?.confirmLabel}
          </AlertDialogAction>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
