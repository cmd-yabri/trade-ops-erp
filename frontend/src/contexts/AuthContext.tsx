import React, { createContext, useContext, useState, ReactNode } from "react";
import { authService } from "@/services/authService";
import {
  getStoredUser,
  isAuthenticated as hasToken,
  StoredUser,
} from "@/lib/apiClient";
import { LoginCredentials } from "@/types/api";
import { getErrorMessage } from "@/lib/errors";

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: StoredUser | null;
  isAdmin: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  // The token lives in localStorage, so a reload keeps the user signed in.
  const [user, setUser] = useState<StoredUser | null>(
    hasToken() ? getStoredUser() : null,
  );
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(hasToken());
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const login = async (credentials: LoginCredentials) => {
    setIsLoading(true);
    try {
      const result = await authService.login(credentials);
      setUser(result.user);
      setIsAuthenticated(true);
    } catch (err) {
      throw new Error(
        getErrorMessage(err, "فشل تسجيل الدخول. يرجى التحقق من بيانات الاعتماد."),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    authService.logout();
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        user,
        isAdmin: user?.role === "ADMIN",
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
