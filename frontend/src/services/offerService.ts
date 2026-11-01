import apiClient from "@/lib/apiClient";
import { SalesOrder } from "@/types/api";

export type OfferStatus = "PENDING" | "ACCEPTED" | "REJECTED";
export type OfferJobType = "STEEL" | "ELECTRIC" | "INSTALL" | "MOVING";

export interface OfferItem {
  id: number;
  product: number;
  product_name: string;
  quantity: number;
  unit_price: string;
  total_price: number;
}

export interface OfferJob {
  id: number;
  job_type: OfferJobType;
  contractor_name: string;
  cost_to_company: string;
  charge_to_client: string;
}

export interface Offer {
  id: number;
  client_name: string;
  client_phone: string;
  client_address: string;
  account: number | null;
  account_name: string;
  branch: number | null;
  branch_name: string;
  car: number | null;
  car_name: string;
  discount: string;
  valid_until: string | null;
  notes: string;
  status: OfferStatus;
  is_expired: boolean;
  created_at: string;
  decided_at: string | null;
  sales_order: number | null;
  items: OfferItem[];
  jobs: OfferJob[];
  product_total: number;
  service_total: number;
  grand_total: number;
  /** admin only */
  cost_total?: number;
  profit?: number;
}

export interface OfferInput {
  client_name: string;
  client_phone?: string;
  client_address?: string;
  account?: number | null;
  branch?: number | null;
  car?: number | null;
  discount?: string;
  valid_until?: string | null;
  notes?: string;
  items: { product: number; quantity: number; unit_price: string }[];
  jobs: { job_type: OfferJobType; contractor_name: string; cost_to_company: string; charge_to_client: string }[];
}

export const offerService = {
  list: async () => (await apiClient.get<Offer[]>("/api/offers/")).data,
  create: async (data: OfferInput) => (await apiClient.post<Offer>("/api/offers/", data)).data,
  update: async (id: number, data: Partial<OfferInput>) => (await apiClient.put<Offer>(`/api/offers/${id}/`, data)).data,
  remove: async (id: number) => {
    await apiClient.delete(`/api/offers/${id}/`);
  },
  accept: async (id: number) =>
    (await apiClient.post<{ offer: Offer; sales_order: SalesOrder }>(`/api/offers/${id}/accept/`)).data,
  reject: async (id: number) => (await apiClient.post<Offer>(`/api/offers/${id}/reject/`)).data,
  reopen: async (id: number) => (await apiClient.post<Offer>(`/api/offers/${id}/reopen/`)).data,
};
