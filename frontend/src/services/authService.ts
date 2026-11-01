import apiClient, {
  removeToken,
  setStoredUser,
  setToken,
  StoredUser,
} from "@/lib/apiClient";
import { LoginCredentials } from "@/types/api";

export interface LoginResponse {
  access: string;
  refresh: string;
  user: StoredUser;
}

export interface UserSignup {
  first_name: string;
  last_name: string;
  username: string;
  email?: string;
  password: string;
}

export const authService = {
  login: async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>(
      "/api/auth/token/",
      credentials,
    );
    setToken(response.data.access);
    setStoredUser(response.data.user);
    return response.data;
  },

  logout: (): void => removeToken(),

  // True until the very first (owner) account has been created.
  needsSetup: async (): Promise<boolean> => {
    const response = await apiClient.get<{ needs_setup: boolean }>(
      "/api/user/setup-status/",
    );
    return response.data.needs_setup;
  },

  // First-run only: creates the owner account.
  signup: async (userData: UserSignup): Promise<void> => {
    await apiClient.post("/api/user/signup/", userData);
  },

  changePassword: async (oldPassword: string, newPassword: string) => {
    await apiClient.post("/api/user/change-password/", {
      old_password: oldPassword,
      new_password: newPassword,
    });
  },

  // Offline password recovery (see backend/user/recovery.py)
  getRecoveryRequestCode: async (): Promise<string> => {
    const response = await apiClient.get<{ request_code: string }>(
      "/api/user/recovery/challenge/",
    );
    return response.data.request_code;
  },

  resetPasswordWithCode: async (
    username: string,
    code: string,
    newPassword: string,
  ): Promise<{ username?: string }> => {
    const response = await apiClient.post<{ username?: string }>("/api/user/recovery/reset/", {
      username,
      code,
      new_password: newPassword,
    });
    return response.data;
  },
};
