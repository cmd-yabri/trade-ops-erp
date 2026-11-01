import { AxiosError } from "axios";

const FIELD_LABELS: Record<string, string> = {
  name: "الاسم",
  username: "اسم المستخدم",
  password: "كلمة المرور",
  first_name: "الاسم الأول",
  last_name: "اسم العائلة",
  email: "البريد الإلكتروني",
  category: "الفئة",
  unit_cost: "تكلفة الوحدة",
  selling_price: "سعر البيع",
  unit_price: "سعر الوحدة",
  current_stock: "الكمية",
  reorder_threshold: "مستوى إعادة الطلب",
  quantity: "الكمية",
  amount: "المبلغ",
  discount: "الخصم",
  supplier: "المورد",
  client_name: "اسم العميل",
  description: "الوصف",
  date: "التاريخ",
  items: "العناصر",
  payment_date: "تاريخ الدفع",
};

function flatten(data: unknown, prefix = ""): string[] {
  if (data == null) return [];
  if (typeof data === "string") return [prefix ? `${prefix}: ${data}` : data];
  if (Array.isArray(data)) return data.flatMap((d) => flatten(d, prefix));
  if (typeof data === "object") {
    return Object.entries(data as Record<string, unknown>).flatMap(([key, value]) => {
      if (key === "detail" || key === "error" || key === "non_field_errors") {
        return flatten(value, prefix);
      }
      return flatten(value, FIELD_LABELS[key] ?? prefix);
    });
  }
  return [String(data)];
}

/** Turns any thrown value into a message the user can read (Arabic from the server). */
export function getErrorMessage(error: unknown, fallback = "حدث خطأ غير متوقع."): string {
  const axiosError = error as AxiosError<unknown>;
  if (axiosError?.isAxiosError) {
    if (!axiosError.response) return "تعذر الاتصال بالخادم المحلي. أعد تشغيل البرنامج.";
    const data = axiosError.response.data;
    // The server's own HTML error pages are never shown to the user.
    if (typeof data === "string" && data.trim().startsWith("<")) return fallback;
    const messages = flatten(data);
    if (messages.length) return messages.join(" • ");
    if (axiosError.response.status === 403) return "ليست لديك صلاحية لتنفيذ هذه العملية.";
    return fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
