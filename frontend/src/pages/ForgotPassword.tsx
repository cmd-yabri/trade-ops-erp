import { LogoMark } from "@/components/LogoMark";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { authService } from "@/services/authService";
import { getErrorMessage } from "@/lib/errors";

export default function ForgotPassword() {
  const [requestCode, setRequestCode] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    authService
      .getRecoveryRequestCode()
      .then(setRequestCode)
      .catch((err) =>
        toast({ title: "خطأ", description: getErrorMessage(err), variant: "destructive" }),
      );
  }, [toast]);

  const copyRequestCode = async () => {
    try {
      await navigator.clipboard.writeText(requestCode);
      toast({ title: "تم النسخ", description: "أرسل هذا الرمز إلى الدعم الفني." });
    } catch {
      toast({ title: "تعذر النسخ", description: "حدد الرمز يدوياً وانسخه.", variant: "destructive" });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !newPassword) {
      toast({ title: "خطأ", description: "يرجى ملء جميع الحقول.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirm) {
      toast({ title: "خطأ", description: "كلمات المرور غير متطابقة.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const result = await authService.resetPasswordWithCode(username.trim(), code, newPassword);
      toast({
        title: "تم",
        description: result.username
          ? `اسم المستخدم هو ${result.username}. تم تعيين كلمة المرور الجديدة. سجّل الدخول الآن.`
          : "تمت إعادة تعيين كلمة المرور. سجّل الدخول الآن.",
      });
      navigate("/login", {
        state: { recoveredUsername: result.username ?? username.trim() },
      });
    } catch (err) {
      toast({ title: "فشلت العملية", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl gradient-brand flex items-center justify-center">
            <LogoMark className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">استعادة كلمة المرور</h1>
            <p className="text-xs text-muted-foreground">
              تعمل بدون إنترنت عبر رمز يصدره الدعم الفني
            </p>
          </div>
        </div>

        <ol className="text-sm text-muted-foreground space-y-1 list-decimal pr-5">
          <li>أرسل «رمز الطلب» أدناه إلى الدعم الفني. إذا نسيت اسم المستخدم، اطلب استعادة حساب المدير.</li>
          <li>الصق «رمز الاستعادة» الذي يصدره الدعم. الرمز يعمل مرة واحدة فقط وعلى هذا الجهاز.</li>
          <li>اختر كلمة مرور جديدة. عند استعادة حساب المدير سيظهر اسم المستخدم بعد نجاح العملية.</li>
        </ol>

        <div className="space-y-2">
          <Label>رمز الطلب</Label>
          <div className="flex gap-2">
            <Input readOnly dir="ltr" value={requestCode} className="font-mono text-xs" />
            <Button type="button" variant="outline" onClick={copyRequestCode} disabled={!requestCode}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rec-user">اسم المستخدم (اتركه فارغاً لاستعادة حساب المدير)</Label>
            <Input id="rec-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rec-code">رمز الاستعادة</Label>
            <Textarea
              id="rec-code"
              dir="ltr"
              rows={3}
              className="font-mono text-xs"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="الصق الرمز الذي استلمته"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rec-pass">كلمة المرور الجديدة</Label>
              <Input id="rec-pass" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec-confirm">تأكيد كلمة المرور</Label>
              <Input id="rec-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          <Button type="submit" variant="brand" className="w-full" disabled={isLoading}>
            <KeyRound className="w-4 h-4 ml-2" />
            {isLoading ? "جارٍ التحقق..." : "إعادة تعيين كلمة المرور"}
          </Button>
        </form>

        <p className="text-center text-sm">
          <Link to="/login" className="text-primary hover:underline">
            العودة لتسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}
