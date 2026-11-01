// In-app confirmation dialog (rendered by <ConfirmHost /> in App.tsx) instead of the browser's confirm().
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  destructive: boolean;
  resolve: (accepted: boolean) => void;
}

let show: ((request: ConfirmRequest) => void) | null = null;

export function registerConfirmHost(handler: ((request: ConfirmRequest) => void) | null) {
  show = handler;
}

function ask(title: string, message: string, confirmLabel: string, destructive: boolean): Promise<boolean> {
  if (!show) return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  const open = show;
  return new Promise((resolve) => open({ title, message, confirmLabel, destructive, resolve }));
}

export function confirmMoneyAction(action: string): Promise<boolean> {
  return ask("تأكيد العملية المالية", `${action}\n\nهل تريد المتابعة؟`, "تأكيد", false);
}

/** For deletes and other non-money confirmations. */
export function confirmAction(message: string): Promise<boolean> {
  return ask("تأكيد", message, "حذف", true);
}
