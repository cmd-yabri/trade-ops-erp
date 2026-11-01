/** Open a link in the user's browser (desktop app: only wa.me chat links are allowed by the shell) or a new tab (dev). */
export const openExternal = (url: string) => {
  const w = window as unknown as { pywebview?: { api?: { open_url?: (u: string) => void } } };
  if (w.pywebview?.api?.open_url) w.pywebview.api.open_url(url);
  else window.open(url, "_blank", "noopener");
};
