import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/apiClient";

export interface LicenseStatus {
  status: "trial" | "active" | "expired";
  request_code: string;
  customer: string;
  expires: string | null;
  days_left: number | null;
  license_error?: string;
}

export const useLicense = () =>
  useQuery({
    queryKey: ["license"],
    queryFn: async () => (await apiClient.get<LicenseStatus>("/api/license/")).data,
    staleTime: 60_000,
  });

export const useActivateLicense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) =>
      (await apiClient.post<LicenseStatus>("/api/license/activate/", { token })).data,
    onSuccess: (data) => queryClient.setQueryData(["license"], data),
  });
};
