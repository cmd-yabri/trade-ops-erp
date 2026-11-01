import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  inventoryService,
  Category,
  CategoryCreate,
} from "@/services/inventoryService";
import { ProductCreate } from "@/types/api";

// ===== CATEGORY HOOKS =====
export const useCategories = () => {
  return useQuery({
    queryKey: ["categories"],
    queryFn: inventoryService.getCategories,
  });
};

export const useCreateCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (category: CategoryCreate) =>
      inventoryService.createCategory(category),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
};

// ===== PRODUCT HOOKS =====
export const useProducts = () => {
  return useQuery({
    queryKey: ["products"],
    queryFn: inventoryService.getProducts,
  });
};

export const useProduct = (id: number) => {
  return useQuery({
    queryKey: ["products", id],
    queryFn: () => inventoryService.getProduct(id),
    enabled: !!id,
  });
};

export const useCreateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (product: ProductCreate) =>
      inventoryService.createProduct(product),
    onSuccess: () => {
      // stock paid from a box moves the box and the expenses too
      ["products", "dashboard", "opening", "boxes", "expenses", "journal", "financialSummary"].forEach((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }));
    },
  });
};

export const useUpdateProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      inventoryService.updateProduct(id, data),
    onSuccess: () => {
      ["products", "dashboard", "opening", "boxes", "expenses", "journal", "financialSummary"]
        .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    },
  });
};

export const useDeleteProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => inventoryService.deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
};
