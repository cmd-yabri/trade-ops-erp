import { Toaster } from "@/components/ui/toaster";
import { ConfirmHost } from "@/components/ConfirmHost";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { MainLayout } from "@/components/layout/MainLayout";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Dashboard from "@/pages/Dashboard";
import PurchaseOrders from "@/pages/PurchaseOrders";
import SalesOrders from "@/pages/SalesOrders";
import Financials from "@/pages/Financials";
import Inventory from "@/pages/Inventory";
import Settings from "@/pages/Settings";
import ForgotPassword from "@/pages/ForgotPassword";
import License from "@/pages/License";
import Cars from "@/pages/Cars";
import Offers from "@/pages/Offers";
import CashBoxes from "@/pages/CashBoxes";
import Accounts from "@/pages/Accounts";
import Partners from "@/pages/Partners";
import { FeaturesProvider } from "@/contexts/FeaturesContext";
import NotFound from "./pages/NotFound";

// The API is on this same PC, so a missing internet connection must never pause a request: with
// React Query's default ("online") every save waits forever once Windows reports no network.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});

const AppRoutes = () => {
  const { isAuthenticated, logout } = useAuth();

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/license" element={<License />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <FeaturesProvider>
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="/dashboard"
        element={
          <MainLayout onLogout={logout}>
            <Dashboard />
          </MainLayout>
        }
      />
      <Route
        path="/purchase-orders"
        element={
          <MainLayout onLogout={logout}>
            <PurchaseOrders />
          </MainLayout>
        }
      />
      <Route
        path="/sales-orders"
        element={
          <MainLayout onLogout={logout}>
            <SalesOrders />
          </MainLayout>
        }
      />
      <Route
        path="/offers"
        element={
          <MainLayout onLogout={logout}>
            <Offers />
          </MainLayout>
        }
      />
      <Route
        path="/financials"
        element={
          <MainLayout onLogout={logout}>
            <Financials />
          </MainLayout>
        }
      />
      <Route
        path="/inventory"
        element={
          <MainLayout onLogout={logout}>
            <Inventory />
          </MainLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <MainLayout onLogout={logout}>
            <Settings />
          </MainLayout>
        }
      />
      <Route
        path="/cars"
        element={
          <MainLayout onLogout={logout}>
            <Cars />
          </MainLayout>
        }
      />
      <Route
        path="/cashboxes"
        element={
          <MainLayout onLogout={logout}>
            <CashBoxes />
          </MainLayout>
        }
      />
      <Route
        path="/accounts"
        element={
          <MainLayout onLogout={logout}>
            <Accounts />
          </MainLayout>
        }
      />
      <Route
        path="/partners"
        element={
          <MainLayout onLogout={logout}>
            <Partners />
          </MainLayout>
        }
      />
      <Route path="/license" element={<License />} />
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />
      <Route path="/signup" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </FeaturesProvider>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <ConfirmHost />
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
