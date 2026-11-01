import apiClient from "@/lib/apiClient";

export interface ManagedUser {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: "ADMIN" | "USER";
  is_active: boolean;
}

export interface ManagedUserInput {
  username?: string;
  first_name?: string;
  last_name?: string;
  password?: string;
  role?: "ADMIN" | "USER";
  is_active?: boolean;
}

export const adminService = {
  getUsers: async (): Promise<ManagedUser[]> =>
    (await apiClient.get<ManagedUser[]>("/api/user/users/")).data,

  createUser: async (data: ManagedUserInput): Promise<ManagedUser> =>
    (await apiClient.post<ManagedUser>("/api/user/users/", data)).data,

  updateUser: async (id: string, data: ManagedUserInput): Promise<ManagedUser> =>
    (await apiClient.put<ManagedUser>(`/api/user/users/${id}/`, data)).data,

  deleteUser: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/user/users/${id}/`);
  },

  createBackup: async (): Promise<{ path: string }> =>
    (await apiClient.post<{ path: string }>("/api/system/backup/")).data,

  getSystemInfo: async (): Promise<{
    version: string;
    data_dir: string;
    backup_dir: string;
  }> => (await apiClient.get("/api/system/info/")).data,
};
