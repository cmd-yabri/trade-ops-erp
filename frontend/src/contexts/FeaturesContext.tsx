import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { moduleService } from "@/services/moduleService";
import { getSelectedBranch, setSelectedBranch } from "@/lib/apiClient";
import { Branch, Features } from "@/types/modules";

const NONE: Features = {
  branches: false,
  cars: false,
  money_boxes: false,
  accounts: false,
  partners: false,
  whatsapp: false,
  whatsapp_country_code: "963",
  whatsapp_group_jid: "",
  whatsapp_group_name: "",
  whatsapp_notify_sales: false,
};

interface FeaturesContextType {
  features: Features;
  isLoading: boolean;
  branches: Branch[];
  /** The branch chosen in the header, or null for "all branches". */
  branchId: number | null;
  setBranchId: (id: number | null) => void;
}

const FeaturesContext = createContext<FeaturesContextType | undefined>(undefined);

/** Must sit inside the QueryClientProvider and be rendered only while signed in. */
export const FeaturesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const featuresQuery = useQuery({
    queryKey: ["features"],
    queryFn: moduleService.getFeatures,
    staleTime: 60_000,
  });
  const features = featuresQuery.data ?? NONE;

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: moduleService.getBranches,
    enabled: features.branches,
    staleTime: 60_000,
  });
  const branches = useMemo(() => branchesQuery.data ?? [], [branchesQuery.data]);

  const [branchId, setBranchState] = useState<number | null>(getSelectedBranch());

  // Switching the branch refetches everything that is filtered by it.
  const setBranchId = (id: number | null) => {
    setSelectedBranch(id);
    setBranchState(id);
    queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] !== "features" && q.queryKey[0] !== "branches",
    });
  };

  // A branch filter must never outlive the feature or the branch it points to.
  useEffect(() => {
    if (!featuresQuery.data) return;
    const stale =
      branchId !== null &&
      (!features.branches || (branchesQuery.data && !branchesQuery.data.some((b) => b.id === branchId)));
    if (stale) {
      setSelectedBranch(null);
      setBranchState(null);
    }
  }, [featuresQuery.data, branchesQuery.data, branchId, features.branches]);

  return (
    <FeaturesContext.Provider
      value={{ features, isLoading: featuresQuery.isLoading, branches, branchId, setBranchId }}
    >
      {children}
    </FeaturesContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useFeatures = (): FeaturesContextType => {
  const context = useContext(FeaturesContext);
  if (!context) throw new Error("useFeatures must be used within a FeaturesProvider");
  return context;
};
