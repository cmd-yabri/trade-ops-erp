// WhatsApp message texts (Arabic). Plain text only: WhatsApp renders *bold*.
import { PurchaseOrder, SalesOrder } from "@/types/api";
import { Account, AccountDetail } from "@/types/modules";
import type { Offer } from "@/services/offerService";
import { formatMoney, formatQty } from "@/lib/utils";

const head = (company?: string) => (company ? `*${company}*\n` : "");

export function salesOrderMessage(order: SalesOrder, company?: string): string {
  const lines = order.items.map(
    (i) => `• ${i.product_name} × ${formatQty(i.quantity)} = ${formatMoney(i.total_price)}`,
  );
  const jobs = order.freelance_jobs.map((j) => `• خدمة: ${j.contractor_name || j.job_type} = ${formatMoney(j.charge_to_client)}`);
  const paid = Number(order.total_paid || 0);
  const remaining = Math.max(Number(order.grand_total) - paid, 0);
  return [
    `${head(company)}مرحباً ${order.client_name}،`,
    `فاتورة رقم SO-${order.id}`,
    ...lines,
    ...jobs,
    Number(order.discount) > 0 ? `الخصم: ${formatMoney(order.discount)}` : "",
    `*الإجمالي: ${formatMoney(order.grand_total)}*`,
    paid > 0 ? `المدفوع: ${formatMoney(paid)}` : "",
    remaining > 0 ? `المتبقي: ${formatMoney(remaining)}` : "شكراً لك، الفاتورة مسددة بالكامل.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function purchaseOrderMessage(order: PurchaseOrder, company?: string): string {
  const lines = order.items.map(
    (i) => `• ${i.product_name} × ${formatQty(i.quantity)} × ${formatMoney(i.unit_cost)}`,
  );
  const total = order.net_total ?? order.total_cost;
  return [
    `${head(company)}السيد ${order.supplier}،`,
    `أمر شراء رقم PO-${order.id}`,
    ...lines,
    `*الإجمالي: ${formatMoney(total)}*`,
    Number(order.paid_amount) > 0 ? `المدفوع: ${formatMoney(order.paid_amount)}` : "",
    Number(order.remaining) > 0 ? `المتبقي: ${formatMoney(order.remaining)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function accountStatementMessage(account: Account | AccountDetail, company?: string): string {
  const b = account.balance;
  const state =
    b > 0 ? `الرصيد المستحق عليكم: ${formatMoney(b)}` : b < 0 ? `الرصيد المستحق لكم: ${formatMoney(-b)}` : "الحساب مسدد بالكامل.";
  const open = "open_orders" in account ? account.open_orders : [];
  const lines = open.map(
    (o) => `• ${o.ref}: الإجمالي ${formatMoney(o.total)}، المدفوع ${formatMoney(o.paid)}، المتبقي ${formatMoney(o.remaining)}`,
  );
  return [
    `${head(company)}كشف حساب ${account.name}`,
    ...(lines.length ? ["فواتير غير مسددة:", ...lines] : []),
    `*${state}*`,
  ].join("\n");
}

export function offerMessage(offer: Offer, company?: string): string {
  const lines = offer.items.map(
    (i) => `• ${i.product_name} × ${formatQty(i.quantity)} = ${formatMoney(i.total_price)}`,
  );
  const jobs = offer.jobs.map((j) => `• خدمة: ${j.contractor_name || j.job_type} = ${formatMoney(j.charge_to_client)}`);
  return [
    `${head(company)}مرحباً ${offer.client_name}،`,
    `عرض سعر رقم OF-${offer.id}`,
    ...lines,
    ...jobs,
    Number(offer.discount) > 0 ? `الخصم: ${formatMoney(offer.discount)}` : "",
    `*الإجمالي: ${formatMoney(offer.grand_total)}*`,
    offer.valid_until ? `ساري حتى: ${offer.valid_until}` : "",
    offer.notes ? offer.notes : "",
  ]
    .filter(Boolean)
    .join("\n");
}
