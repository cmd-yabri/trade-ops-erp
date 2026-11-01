import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoiceService, reportsService } from "@/services/invoiceService";
import { ExpenseCreate } from "@/types/api";

export const useDashboard = () => {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: invoiceService.getDashboardData,
  });
};

export const useReportsDashboard = () => {
  return useQuery({
    queryKey: ["reportsDashboard"],
    queryFn: reportsService.getDashboardSummary,
  });
};

/** Daily profit figures: admin only (staff get no request at all). */
export const useChartData = (enabled = true) => {
  return useQuery({
    queryKey: ["charts"],
    queryFn: invoiceService.getChartData,
    enabled,
  });
};

export const useFinancialSummary = () => {
  return useQuery({
    queryKey: ["financialSummary"],
    queryFn: invoiceService.getFinancialSummary,
  });
};

export const usePeriodFinancialSummary = (period: string) => {
  return useQuery({
    queryKey: ["financialSummary", period],
    queryFn: () => invoiceService.getPeriodFinancialSummary(period),
    enabled: !!period,
  });
};

export const useExpenses = () => {
  return useQuery({
    queryKey: ["expenses"],
    queryFn: invoiceService.getExpenses,
  });
};

// Every money movement (admin). Its key starts with "boxes": whatever refreshes the boxes refreshes it.
export const useJournal = (enabled = true) =>
  useQuery({ queryKey: ["boxes", "journal"], queryFn: invoiceService.getJournal, enabled });

export const useCreateExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expense: ExpenseCreate) =>
      invoiceService.createExpense(expense),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["boxes"] }); // the boxes and the journal
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["charts"] });
      // Invalidate ALL financial summary queries regardless of period
      queryClient.invalidateQueries({
        queryKey: ["financialSummary"],
        exact: false,
      });
    },
  });
};

export const useUpdateExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      expense,
    }: {
      id: number;
      expense: Partial<ExpenseCreate>;
    }) => invoiceService.updateExpense(id, expense),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["boxes"] }); // the boxes and the journal
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["charts"] });
      // Invalidate ALL financial summary queries regardless of period
      queryClient.invalidateQueries({
        queryKey: ["financialSummary"],
        exact: false,
      });
    },
  });
};

export const useDeleteExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => invoiceService.deleteExpense(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["boxes"] }); // the boxes and the journal
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["charts"] });
      // Invalidate ALL financial summary queries regardless of period
      queryClient.invalidateQueries({
        queryKey: ["financialSummary"],
        exact: false,
      });
    },
  });
};

// Reports hooks
export const useWeeklyFinancials = () => {
  return useQuery({
    queryKey: ["financials", "weekly"],
    queryFn: reportsService.getWeeklyFinancials,
  });
};

export const useMonthlyFinancials = () => {
  return useQuery({
    queryKey: ["financials", "monthly"],
    queryFn: reportsService.getMonthlyFinancials,
  });
};

export const useQuarterlyFinancials = () => {
  return useQuery({
    queryKey: ["financials", "quarterly"],
    queryFn: reportsService.getQuarterlyFinancials,
  });
};

export const useYearlyFinancials = () => {
  return useQuery({
    queryKey: ["financials", "yearly"],
    queryFn: reportsService.getYearlyFinancials,
  });
};
