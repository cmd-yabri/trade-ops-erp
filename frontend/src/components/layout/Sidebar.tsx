import { LogoMark } from "@/components/LogoMark";
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  FileText, 
  DollarSign, 
  Package,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Truck,
  Wallet,
  BookUser,
  Users,
  Building2,
  ClipboardList
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useFeatures } from '@/contexts/FeaturesContext';
import type { Features } from '@/types/modules';
import { NuqtaSidebarCredit } from '@/components/NuqtaBrand';

interface NavItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** shown only while this optional module is switched on */
  feature?: keyof Features;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { path: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { path: '/purchase-orders', label: 'أوامر الشراء', icon: ShoppingCart },
  { path: '/offers', label: 'عروض الأسعار', icon: ClipboardList },
  { path: '/sales-orders', label: 'أوامر البيع', icon: FileText },
  { path: '/financials', label: 'المالية', icon: DollarSign },
  { path: '/inventory', label: 'المخزون', icon: Package },
  { path: '/cashboxes', label: 'الصناديق', icon: Wallet, feature: 'money_boxes', adminOnly: true },
  { path: '/accounts', label: 'حسابات الجملة', icon: BookUser, feature: 'accounts' },
  { path: '/partners', label: 'الشركاء', icon: Users, feature: 'partners', adminOnly: true },
  { path: '/cars', label: 'السيارات', icon: Truck, feature: 'cars' },
  { path: '/settings', label: 'الإعدادات', icon: SettingsIcon },
];

interface SidebarProps {
  onLogout: () => void;
}

export function Sidebar({ onLogout }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { isAdmin } = useAuth();
  const { features, branches, branchId, setBranchId } = useFeatures();
  const visibleItems = navItems.filter(
    (item) => (!item.feature || features[item.feature]) && (!item.adminOnly || isAdmin),
  );

  return (
    <aside 
      className={cn(
        "fixed right-0 top-0 h-screen bg-sidebar text-sidebar-foreground transition-all duration-300 z-50 flex flex-col",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-700 shadow-lg">
          <LogoMark className="w-6 h-6 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="animate-fade-in">
            <h1 className="font-semibold text-sidebar-primary-foreground">تريد أوبس</h1>
            <p className="text-xs text-sidebar-foreground/60">نظام الإدارة</p>
          </div>
        )}
      </div>

      {/* Branch picker: filters lists and reports, and files new records under that branch */}
      {features.branches && branches.length > 0 && (
        <div className="px-3 pt-3">
          {collapsed ? (
            <div className="flex justify-center text-sidebar-foreground/70" title="الفرع">
              <Building2 className="w-5 h-5" />
            </div>
          ) : (
            <label className="block">
              <span className="text-xs text-sidebar-foreground/60 flex items-center gap-1 mb-1">
                <Building2 className="w-3.5 h-3.5" /> الفرع
              </span>
              <select
                value={branchId ?? ''}
                onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-md bg-sidebar-accent text-sidebar-accent-foreground text-sm px-2 py-1.5 border border-sidebar-border"
              >
                <option value="">كل الفروع</option>
                {branches.filter((b) => b.is_active).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon 
                className={cn(
                  "w-5 h-5 transition-colors flex-shrink-0",
                  isActive ? "text-sidebar-primary" : "text-sidebar-foreground group-hover:text-sidebar-primary"
                )} 
              />
              {!collapsed && (
                <span className="font-medium text-sm">{item.label}</span>
              )}
              {isActive && !collapsed && (
                <div className="mr-auto w-1.5 h-1.5 rounded-full bg-sidebar-primary animate-pulse" />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="p-3 border-t border-sidebar-border space-y-2">
        <NuqtaSidebarCredit collapsed={collapsed} />
        <Button
          variant="ghost"
          onClick={onLogout}
          className={cn(
            "w-full justify-start text-sidebar-foreground hover:text-destructive hover:bg-destructive/10",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="w-5 h-5" />
          {!collapsed && <span className="me-3">تسجيل الخروج</span>}
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full justify-center text-sidebar-foreground/60 hover:text-sidebar-foreground"
        >
          {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </Button>
      </div>
    </aside>
  );
}
