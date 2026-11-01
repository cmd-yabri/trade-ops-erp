import apiClient from "@/lib/apiClient";
import { Product, ProductCreate } from "@/types/api";

export interface Category {
  id: number;
  name: string; // backward compatibility
  is_custom: boolean;
}

export interface CategoryCreate {
  name: string;
}

export const inventoryService = {
  // ===== CATEGORY ENDPOINTS =====
  // Get all categories
  getCategories: async (): Promise<Category[]> => {
    const response = await apiClient.get<Category[]>(
      "/api/inventory/categories/",
    );
    return response.data;
  },

  // Create custom category (admin only)
  createCategory: async (category: CategoryCreate): Promise<Category> => {
    const response = await apiClient.post<Category>(
      "/api/inventory/categories/",
      category,
    );
    return response.data;
  },

  // ===== PRODUCT ENDPOINTS =====
  // Get all products
  getProducts: async (): Promise<Product[]> => {
    const response = await apiClient.get<Product[]>("/api/inventory/products/");
    return response.data;
  },

  // Get single product
  getProduct: async (id: number): Promise<Product> => {
    const response = await apiClient.get<Product>(
      `/api/inventory/products/${id}/`,
    );
    return response.data;
  },

  // Create product
  createProduct: async (product: ProductCreate): Promise<Product> => {
    const response = await apiClient.post<Product>(
      "/api/inventory/products/",
      product,
    );
    return response.data;
  },

  // Update product
  updateProduct: async (
    id: number,
    product: Partial<ProductCreate>,
  ): Promise<Product> => {
    const response = await apiClient.put<Product>(
      `/api/inventory/products/${id}/`,
      product,
    );
    return response.data;
  },

  // Delete product
  deleteProduct: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/inventory/products/${id}/`);
  },
};
