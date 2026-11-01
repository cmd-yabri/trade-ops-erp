import { toast } from "@/hooks/use-toast";
import axios, { AxiosError, AxiosInstance } from "axios";

// In the packaged app the UI is served by the same server as the API, so the
// base URL is empty (same origin, any port). Only the Vite dev server (8080)
// needs to point at the Django dev server.
const API_BASE_URL = import.meta.env.DEV ? (import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000") : "";

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

export interface StoredUser {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  role: "ADMIN" | "USER";
}

const storage = {
  get: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: the user simply has to log in again */
    }
  },
  remove: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const getToken = (): string | null => storage.get(TOKEN_KEY);
export const setToken = (token: string): void => storage.set(TOKEN_KEY, token);
export const removeToken = (): void => {
  storage.remove(TOKEN_KEY);
  storage.remove(USER_KEY);
};
export const isAuthenticated = (): boolean => !!getToken();

export const getStoredUser = (): StoredUser | null => {
  const raw = storage.get(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
};
export const setStoredUser = (user: StoredUser): void =>
  storage.set(USER_KEY, JSON.stringify(user));

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// The branch picked in the header (empty = all branches). Only set while the Branches feature is on.
const BRANCH_KEY = "sel_branch";
export const getSelectedBranch = (): number | null => {
  const raw = storage.get(BRANCH_KEY);
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
};
export const setSelectedBranch = (id: number | null): void => {
  if (id === null) storage.remove(BRANCH_KEY);
  else storage.set(BRANCH_KEY, String(id));
};

// Lists and reports that can be narrowed to one branch.
const BRANCH_READS = [
  "/api/orders/sales/",
  "/api/purchases/po/",
  "/api/invoice/",
  "/api/reports/",
  "/api/cashbox/",
  "/api/offers/",
];
// Creating one of these records inside a branch files it under that branch.
const BRANCH_CREATES = ["/api/orders/sales/", "/api/purchases/po/", "/api/invoice/expenses/", "/api/offers/"];

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const branch = getSelectedBranch();
  const url = config.url ?? "";
  const method = (config.method ?? "get").toLowerCase();
  if (branch !== null) {
    if (method === "get" && BRANCH_READS.some((p) => url.startsWith(p)) && !url.includes("branch=")) {
      config.params = { ...(config.params ?? {}), branch: config.params?.branch ?? branch };
    }
    if (
      method === "post" &&
      BRANCH_CREATES.includes(url) &&
      config.data &&
      typeof config.data === "object" &&
      !("branch" in config.data)
    ) {
      config.data = { ...config.data, branch };
    }
  }
  return config;
});

// An expired/invalid token sends the user back to the login screen. Failed
// logins (401 on the login call itself) must not trigger this.
apiClient.interceptors.response.use(
  (response) => {
    // The server lets money leave a cash box below zero but says so (the owner's choice: warn, not block).
    const warning = response.headers?.["x-box-warning"];
    if (warning) {
      toast({ title: "تنبيه الصندوق", description: decodeURIComponent(String(warning)), variant: "destructive" });
    }
    return response;
  },
  (error: AxiosError) => {
    const url = error.config?.url ?? "";
    const isAuthCall = url.includes("/api/auth/") || url.includes("/api/user/recovery");
    // Trial over and not activated: send the user to the License page (data is safe).
    const data = error.response?.data as { code?: string } | undefined;
    if (error.response?.status === 402 && data?.code === "license_required") {
      if (!window.location.pathname.startsWith("/license")) {
        window.location.assign("/license");
      }
      return Promise.reject(error);
    }
    if (error.response?.status === 401 && !isAuthCall && getToken()) {
      removeToken();
      window.location.assign("/login");
    }
    return Promise.reject(error);
  },
);

export default apiClient;
