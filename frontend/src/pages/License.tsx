import { LogoMark } from "@/components/LogoMark";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Copy, KeyRound, TimerReset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useActivateLicense, useLicense } from "@/hooks/useLicense";
import { getErrorMessage } from "@/lib/errors";
import { isAuthenticated } from "@/lib/apiClient";

export default function License() {
  const { data: license, isLoading } = useLicense();
  const activate = useActivateLicense();
  const { toast } = useToast();
  const [token, setToken] = useState("");

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(license?.request_code ?? "");
      toast({ title: "تم النسخ", description: "أرسل رمز الجهاز إلى الدعم الفني." });
    } catch {
      toast({ title: "تعذر النسخ", description: "حدد الرمز يدوياً وانسخه.", variant: "destructive" });
    }
  };

  const handleActivate = async () => {
    try {
      const result = await activate.mutateAsync(token);
      setToken("");
      toast({
        title: "تم التفعيل",
        description: result.customer ? `الترخيص مسجل باسم: ${result.customer}` : "تم تفعيل البرنامج.",
      });
    } catch (error) {
      toast({ title: "تعذر التفعيل", description: getErrorMessage(error), variant: "destructive" });
    }
  };

  const statusLine = () => {
    if (!license) return "";
    if (license.status === "active")
      return license.expires ? `مفعّل حتى ${license.expires}` : "مفعّل (ترخيص دائم)";
    if (license.status === "trial") return `نسخة تجريبية - متبقي ${license.days_left} يوماً`;
    return "انتهت الفترة التجريبية - يرجى التفعيل (بياناتك محفوظة ولن تُحذف)";
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background" dir="rtl">
      <div className="w-full max-w-xl bg-card border border-border rounded-2xl p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl gradient-brand flex items-center justify-center">
            <LogoMark className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">ترخيص تريد أوبس</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              {license?.status === "active" ? (
                <BadgeCheck className="w-4 h-4 text-primary" />
              ) : (
                <TimerReset className="w-4 h-4" />
              )}
              {isLoading ? "..." : statusLine()}
            </p>
          </div>
        </div>

        {license?.status !== "active" && (
          <>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal pr-5">
              <li>أرسل «رمز الجهاز» أدناه إلى الدعم الفني.</li>
              <li>ستستلم «مفتاح التفعيل». الصقه في الحقل واضغط تفعيل.</li>
              <li>المفتاح يعمل على هذا الجهاز فقط، ولا يحتاج إنترنت.</li>
            </ol>
            <div className="space-y-2">
              <Label>رمز الجهاز</Label>
              <div className="flex gap-2">
                <Input readOnly dir="ltr" value={license?.request_code ?? ""} className="font-mono" />
                <Button type="button" variant="outline" onClick={copyCode} disabled={!license}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="license-token">مفتاح التفعيل</Label>
              <Textarea
                id="license-token"
                dir="ltr"
                rows={4}
                className="font-mono text-xs"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="الصق مفتاح التفعيل هنا"
              />
              {license?.license_error && (
                <p className="text-sm text-destructive">{license.license_error}</p>
              )}
            </div>
            <Button variant="brand" className="w-full" onClick={handleActivate} disabled={!token.trim() || activate.isPending}>
              <KeyRound className="w-4 h-4 ml-2" />
              {activate.isPending ? "جارٍ التحقق..." : "تفعيل"}
            </Button>
          </>
        )}

        {license?.status === "active" && license.customer && (
          <p className="text-sm">
            مسجل باسم: <span className="font-semibold">{license.customer}</span>
          </p>
        )}

        <p className="text-center text-sm">
          <Link to={isAuthenticated() ? "/dashboard" : "/login"} className="text-primary hover:underline">
            {isAuthenticated() ? "العودة إلى البرنامج" : "العودة لتسجيل الدخول"}
          </Link>
        </p>
      </div>
    </div>
  );
}
