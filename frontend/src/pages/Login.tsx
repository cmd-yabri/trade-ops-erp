import { LogoMark } from "@/components/LogoMark";
import { useEffect, useState } from "react";
import { User, Lock, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { NuqtaLoginCredit } from "@/components/NuqtaBrand";
import { authService } from "@/services/authService";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoading } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const state = location.state;
    if (state && typeof state === "object" && "recoveredUsername" in state &&
        typeof state.recoveredUsername === "string") {
      setUsername(state.recoveredUsername);
    }
  }, [location.state]);

  // On a brand-new installation there is no account yet: go to first-run setup.
  useEffect(() => {
    authService
      .needsSetup()
      .then((needsSetup) => needsSetup && navigate("/signup", { replace: true }))
      .catch(() => undefined);
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !password) {
      toast({
        title: "خطأ",
        description: "يرجى إدخال اسم المستخدم وكلمة المرور.",
        variant: "destructive",
      });
      return;
    }

    try {
      await login({ username, password });
      toast({
        title: "مرحبًا بعودتك!",
        description: "لقد قمت بتسجيل الدخول بنجاح إلى TradeOps.",
      });
      navigate("/dashboard");
    } catch (err) {
      toast({
        title: "فشل تسجيل الدخول",
        description: (err as Error).message || "يرجى التحقق من بيانات اعتمادك.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Right Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 gradient-brand items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48cGF0aCBkPSJNMzYgMzRoLTJ2LTRoMnY0em0wLTZ2LTRoLTJ2NGgyek0zMCAzNGgtMnYtNGgydjR6bTAtNnYtNGgtMnY0aDJ6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />
        <div className="relative z-10 text-center text-primary-foreground max-w-md">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 rounded-2xl bg-primary-foreground/20 backdrop-blur-sm flex items-center justify-center">
              <LogoMark className="w-12 h-12 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-4">تريد أوبس</h1>
          <p className="text-lg text-primary-foreground/80">
            الحل الأمثل لإدارة أعمالك التجارية. تتبع المخزون،
            إدارة الطلبات، وتنمية أعمالك.
          </p>
        </div>
      </div>

      {/* Left Panel - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl gradient-brand flex items-center justify-center">
              <LogoMark className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">تريد أوبس</h1>
              <p className="text-xs text-muted-foreground">بوابة الإدارة</p>
            </div>
          </div>

          <div className="space-y-2 mb-8">
            <h2 className="text-2xl font-bold text-foreground">
              مرحبًا بعودتك
            </h2>
            <p className="text-muted-foreground">
              يرجى تسجيل الدخول إلى حسابك للمتابعة.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-foreground">
                اسم المستخدم
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  placeholder="أدخل اسم المستخدم الخاص بك"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10 h-11"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground">
                كلمة المرور
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="أدخل كلمة المرور الخاصة بك"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 h-11"
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="brand"
              className="w-full h-11"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  جارٍ تسجيل الدخول...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  تسجيل الدخول
                  <ArrowLeft className="w-4 h-4 rotate-180" />
                </span>
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            <Link
              to="/forgot-password"
              className="text-primary hover:underline font-medium"
            >
              نسيت كلمة المرور؟
            </Link>
          </p>
          <NuqtaLoginCredit />
        </div>
      </div>
    </div>
  );
}
