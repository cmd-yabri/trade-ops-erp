import apiClient from "@/lib/apiClient";
import {
  DashboardData,
  DailyFinancialRecord,
  Expense,
  ExpenseCreate,
  FinancialSummary,
  JournalRow,
} from "@/types/api";

export const invoiceService = {
  // Get dashboard summary data
  getDashboardData: async (): Promise<DashboardData> => {
    const response = await apiClient.get<DashboardData>(
      "/api/invoice/dashboard/",
    );
    return response.data;
  },

  // Get chart data (profit over time)
  getChartData: async (): Promise<DailyFinancialRecord[]> => {
    const response = await apiClient.get<DailyFinancialRecord[]>(
      "/api/invoice/charts/",
    );
    return response.data;
  },

  // Get financial summary
  getFinancialSummary: async (): Promise<FinancialSummary> => {
    const response = await apiClient.get<FinancialSummary>(
      "/api/invoice/financial_summary/",
    );
    return response.data;
  },

  // Get period-based financial summary
  getPeriodFinancialSummary: async (
    period: string,
  ): Promise<FinancialSummary> => {
    const response = await apiClient.get<FinancialSummary>(
      `/api/reports/financials/?period=${period}`,
    );
    return response.data;
  },

  // Get expenses and other income (manual entries)
  getExpenses: async (): Promise<Expense[]> => {
    const response = await apiClient.get<Expense[]>("/api/invoice/expenses/");
    return response.data;
  },

  // Every money movement of the cash boxes, newest first
  getJournal: async (): Promise<JournalRow[]> =>
    (await apiClient.get<JournalRow[]>("/api/invoice/journal/")).data,

  // Create expense
  createExpense: async (expense: ExpenseCreate): Promise<Expense> => {
    const response = await apiClient.post<Expense>(
      "/api/invoice/expenses/",
      expense,
    );
    return response.data;
  },

  // Update expense
  updateExpense: async (
    id: number,
    expense: Partial<ExpenseCreate>,
  ): Promise<Expense> => {
    const response = await apiClient.put<Expense>(
      `/api/invoice/expenses/${id}/`,
      expense,
    );
    return response.data;
  },

  // Delete expense
  deleteExpense: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/invoice/expenses/${id}/`);
  },
};

export const reportsService = {
  // Get dashboard summary
  getDashboardSummary: async (): Promise<DashboardData> => {
    const response = await apiClient.get<DashboardData>(
      "/api/reports/dashboard/summary/",
    );
    return response.data;
  },

  // Get financials
  getFinancials: async (): Promise<FinancialSummary> => {
    const response = await apiClient.get<FinancialSummary>(
      "/api/reports/financials/",
    );
    return response.data;
  },

  // Get weekly financials
  getWeeklyFinancials: async (): Promise<FinancialSummary[]> => {
    const response = await apiClient.get<FinancialSummary[]>(
      "/api/reports/financials/weekly/",
    );
    return response.data;
  },

  // Get monthly financials
  getMonthlyFinancials: async (): Promise<FinancialSummary[]> => {
    const response = await apiClient.get<FinancialSummary[]>(
      "/api/reports/financials/monthly/",
    );
    return response.data;
  },

  // Get quarterly financials
  getQuarterlyFinancials: async (): Promise<FinancialSummary[]> => {
    const response = await apiClient.get<FinancialSummary[]>(
      "/api/reports/financials/quarterly/",
    );
    return response.data;
  },

  // Get yearly financials
  getYearlyFinancials: async (): Promise<FinancialSummary[]> => {
    const response = await apiClient.get<FinancialSummary[]>(
      "/api/reports/financials/yearly/",
    );
    return response.data;
  },
};
