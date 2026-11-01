import { LogoMark } from "@/components/LogoMark";
import { useEffect, useState } from "react";
import { User, Lock, ArrowLeft, Mail, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { authService } from "@/services/authService";
import { useAuth } from "@/contexts/AuthContext";
import { getErrorMessage } from "@/lib/errors";

export default function Signup() {
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { login } = useAuth();

  // Account creation is only for the very first (owner) account. Later users
  // are added by an admin from Settings.
  useEffect(() => {
    authService
      .needsSetup()
      .then((needsSetup) => !needsSetup && navigate("/login", { replace: true }))
      .catch(() => undefined);
  }, [navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.first_name ||
      !formData.username ||
      !formData.password
    ) {
      toast({
        title: "خطأ",
        description: "يرجى ملء جميع الحقول المطلوبة.",
        variant: "destructive",
      });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast({
        title: "خطأ",
        description: "كلمات المرور غير متطابقة.",
        variant: "destructive",
      });
      return;
    }

    if (formData.password.length < 6) {
      toast({
        title: "خطأ",
        description: "كلمة المرور يجب أن تكون على الأقل 6 أحرف.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      await authService.signup({
        first_name: formData.first_name,
        last_name: formData.last_name,
        username: formData.username,
        email: formData.email,
        password: formData.password,
      });
      await login({ username: formData.username, password: formData.password });
      toast({
        title: "تم إنشاء الحساب!",
        description: "أهلاً بك في تريد أوبس. أنت الآن مدير النظام.",
      });
      navigate("/dashboard");
    } catch (err) {
      toast({
        title: "فشل التسجيل",
        description: getErrorMessage(err, "فشلت عملية التسجيل. يرجى المحاولة مرة أخرى."),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
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

      {/* Left Panel - Signup Form */}
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
              إعداد حساب المدير
            </h2>
            <p className="text-muted-foreground">
              هذا أول تشغيل للبرنامج. أنشئ حساب المدير (المالك) للبدء. احتفظ بكلمة المرور في مكان آمن.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first_name" className="text-foreground">
                  الاسم الأول
                </Label>
                <Input
                  id="first_name"
                  name="first_name"
                  type="text"
                  placeholder="محمد"
                  value={formData.first_name}
                  onChange={handleChange}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name" className="text-foreground">
                  الكنية
                </Label>
                <Input
                  id="last_name"
                  name="last_name"
                  type="text"
                  placeholder="سكيف"
                  value={formData.last_name}
                  onChange={handleChange}
                  className="h-11"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username" className="text-foreground">
                اسم المستخدم
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="mohammed_dev"
                  value={formData.username}
                  onChange={handleChange}
                  className="pl-10 h-11"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground">
                البريد الإلكتروني (اختياري)
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="mohammed@example.com"
                  value={formData.email}
                  onChange={handleChange}
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
                  name="password"
                  type="password"
                  placeholder="ستة أحرف على الأقل"
                  value={formData.password}
                  onChange={handleChange}
                  className="pl-10 h-11"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-foreground">
                تأكيد كلمة المرور
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="أكد كلمة مرورك"
                  value={formData.confirmPassword}
                  onChange={handleChange}
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
                  إنشاء حساب...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  إنشاء حساب
                </span>
              )}
            </Button>
          </form>

        </div>
      </div>
    </div>
  );
}
