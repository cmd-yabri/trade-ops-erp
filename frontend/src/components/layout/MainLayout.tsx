import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useLicense } from '@/hooks/useLicense';

interface MainLayoutProps {
  children: ReactNode;
  onLogout: () => void;
}

export function MainLayout({ children, onLogout }: MainLayoutProps) {
  const { data: license } = useLicense();
  const showTrialBanner = license?.status === 'trial';

  return (
    <div className="min-h-screen bg-background">
      <Sidebar onLogout={onLogout} />
      <main className="mr-16 lg:mr-64 transition-all duration-300 min-h-screen">
        {showTrialBanner && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-sm px-6 py-2 flex items-center justify-between">
            <span>نسخة تجريبية - متبقي {license?.days_left} يوماً</span>
            <Link to="/license" className="font-medium underline">تفعيل البرنامج</Link>
          </div>
        )}
        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
