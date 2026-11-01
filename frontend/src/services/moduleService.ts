import apiClient from "@/lib/apiClient";
import {
  Account,
  AccountDetail,
  BoxMovement,
  BoxSummary,
  Branch,
  Car,
  CarDetail,
  Currency,
  ExchangeRow,
  Features,
  MoneyInput,
  Partner,
  PartnerDetail,
  PriorProfit,
  PriorProfitInput,
  ProfitOpeningInput,
  ProfitOpeningState,
  PartnersOverview,
  Settlement,
  SettlementPreview,
  StockTransferInput,
  StockTransferRow,
  WhatsappStatus,
} from "@/types/modules";

const get = async <T>(url: string, params?: Record<string, unknown>) =>
  (await apiClient.get<T>(url, { params })).data;
const post = async <T>(url: string, body?: unknown) =>
  (await apiClient.post<T>(url, body)).data;
const put = async <T>(url: string, body?: unknown) =>
  (await apiClient.put<T>(url, body)).data;
const del = async (url: string) => {
  await apiClient.delete(url);
};

export const moduleService = {
  // ----- feature switches
  getFeatures: () => get<Features>("/api/system/features/"),
  updateFeatures: (data: Partial<Features>) => put<Features>("/api/system/features/", data),

  // ----- branches, cars, transfers
  getBranches: () => get<Branch[]>("/api/locations/branches/"),
  createBranch: (data: Partial<Branch>) => post<Branch>("/api/locations/branches/", data),
  updateBranch: (id: number, data: Partial<Branch>) => put<Branch>(`/api/locations/branches/${id}/`, data),
  deleteBranch: (id: number) => del(`/api/locations/branches/${id}/`),

  getCars: () => get<Car[]>("/api/locations/cars/"),
  getCar: (id: number) => get<CarDetail>(`/api/locations/cars/${id}/`),
  createCar: (data: Partial<Car>) => post<Car>("/api/locations/cars/", data),
  updateCar: (id: number, data: Partial<Car>) => put<Car>(`/api/locations/cars/${id}/`, data),
  deleteCar: (id: number) => del(`/api/locations/cars/${id}/`),

  getTransfers: () => get<StockTransferRow[]>("/api/locations/transfers/"),
  transferStock: (data: StockTransferInput) => post<void>("/api/locations/transfers/", data),

  // ----- money boxes
  getBoxes: (branch?: number | null) => get<BoxSummary[]>("/api/cashbox/boxes/", { branch }),
  getStatement: (currency: Currency, branch?: number | null) =>
    get<BoxMovement[]>("/api/cashbox/statement/", { currency, branch }),
  addBoxEntry: (data: {
    currency: Currency;
    kind: "DEPOSIT" | "WITHDRAWAL";
    amount: string;
    note?: string;
  }) => post<void>("/api/cashbox/entries/", data),
  editBoxMovement: (data: {
    ref: string;
    currency: Currency;
    amount: string;
    date: string;
    note?: string;
    rate?: string;
  }) => put<void>("/api/cashbox/movements/", data),
  getExchanges: () => get<ExchangeRow[]>("/api/cashbox/exchanges/"),
  exchange: (data: { from_currency: Currency; from_amount: string; rate: string; note?: string }) =>
    post<{ to_currency: Currency; to_amount: number }>("/api/cashbox/exchanges/", data),

  // ----- wholesale accounts
  getAccounts: () => get<Account[]>("/api/accounts/"),
  getAccount: (id: number) => get<AccountDetail>(`/api/accounts/${id}/`),
  createAccount: (data: Partial<Account> & { opening_balance?: string }) =>
    post<Account>("/api/accounts/", data),
  updateAccount: (id: number, data: Partial<Account>) => put<Account>(`/api/accounts/${id}/`, data),
  deleteAccount: (id: number) => del(`/api/accounts/${id}/`),
  addAccountPayment: (id: number, data: MoneyInput & { direction: "IN" | "OUT"; note?: string; date?: string; branch?: number }) =>
    post<AccountDetail>(`/api/accounts/${id}/payments/`, data),
  addAccountEntry: (id: number, data: { kind: "DEBIT" | "CREDIT"; amount: string; note?: string }) =>
    post<AccountDetail>(`/api/accounts/${id}/entries/`, data),

  // ----- partners
  getPartners: () => get<PartnersOverview>("/api/partners/"),
  getProfitOpening: () => get<ProfitOpeningState>("/api/partners/opening/"),
  createProfitOpening: (data: ProfitOpeningInput) => post<ProfitOpeningState>("/api/partners/opening/", data),
  updateProfitOpening: (data: ProfitOpeningInput) => put<ProfitOpeningState>("/api/partners/opening/", data),
  addPriorProfit: (data: PriorProfitInput) => post<PriorProfit>("/api/partners/prior-profits/", data),
  updatePriorProfit: (id: number, data: PriorProfitInput) =>
    put<PriorProfit>(`/api/partners/prior-profits/${id}/`, data),
  deletePriorProfit: (id: number) => del(`/api/partners/prior-profits/${id}/`),
  getPartner: (id: number) => get<PartnerDetail>(`/api/partners/${id}/`),
  createPartner: (data: Partial<Partner>) => post<Partner>("/api/partners/", data),
  updatePartner: (id: number, data: Partial<Partner>) => put<Partner>(`/api/partners/${id}/`, data),
  deletePartner: (id: number) => del(`/api/partners/${id}/`),
  addWithdrawal: (data: MoneyInput & { partner: number; note?: string }) =>
    post<unknown>("/api/partners/withdrawals/", data),
  deleteWithdrawal: (id: number) => del(`/api/partners/withdrawals/${id}/`),
  previewSettlement: (end?: string) => get<SettlementPreview>("/api/partners/settlement/preview/", { end }),
  settle: (data: { end?: string; note?: string }) => post<{ id: number }>("/api/partners/settlements/", data),
  getSettlements: () => get<Settlement[]>("/api/partners/settlements/"),
  undoSettlement: (id: number) => del(`/api/partners/settlements/${id}/`),

  // ----- WhatsApp
  whatsappStatus: () => get<WhatsappStatus>("/api/whatsapp/status/"),
  whatsappConnect: (phone?: string) => post<WhatsappStatus>("/api/whatsapp/connect/", { phone }),
  whatsappDisconnect: () => post<unknown>("/api/whatsapp/disconnect/"),
  whatsappSend: (phone: string, text: string) =>
    post<{ id: string }>("/api/whatsapp/send/", { phone, text }),
  whatsappChatUrl: (phone: string, text: string) =>
    post<{ url: string }>("/api/whatsapp/chat-url/", { phone, text }),
};
