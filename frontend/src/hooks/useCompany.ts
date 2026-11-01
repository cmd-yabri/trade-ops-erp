import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/apiClient";
import { CompanyProfile } from "@/lib/print";

export const useCompany = () =>
  useQuery({
    queryKey: ["company"],
    queryFn: async () =>
      (await apiClient.get<CompanyProfile>("/api/system/company/")).data,
  });

export const useUpdateCompany = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<CompanyProfile>) =>
      (await apiClient.put<CompanyProfile>("/api/system/company/", data)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company"] }),
  });
};
