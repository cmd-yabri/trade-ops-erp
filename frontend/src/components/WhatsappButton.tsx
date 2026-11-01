import { useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useFeatures } from "@/contexts/FeaturesContext";
import { moduleService } from "@/services/moduleService";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/external";

interface WhatsappButtonProps {
  phone?: string | null;
  /** builds the suggested message when the button is pressed */
  message: () => string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}

/**
 * "Send via WhatsApp". Pressing it opens a popup with the suggested message and the phone number,
 * both editable; nothing is sent until you confirm. It sends from the linked WhatsApp number, and if
 * the link is down (or the number is wrong) it offers the click-to-chat fallback.
 * Hidden while the feature is off.
 */
export function WhatsappButton({ phone, message, label = "واتساب", className, iconOnly }: WhatsappButtonProps) {
  const { features } = useFeatures();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);

  if (!features.whatsapp) return null;

  const openPreview = () => {
    setText(message());
    setNumber(phone?.trim() ?? "");
    setOpen(true);
  };

  const fallbackLink = async () => {
    try {
      const { url } = await moduleService.whatsappChatUrl(number, text);
      openExternal(url);
    } catch (error) {
      toast({ title: "خطأ", description: getErrorMessage(error, "رقم الهاتف غير صالح"), variant: "destructive" });
    }
  };

  const send = async () => {
    if (!number.trim()) {
      toast({ title: "لا يوجد رقم هاتف", description: "اكتب رقم الهاتف أولاً.", variant: "destructive" });
      return;
    }
    if (!text.trim()) {
      toast({ title: "الرسالة فارغة", description: "اكتب نص الرسالة.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await moduleService.whatsappSend(number, text);
      toast({ title: "تم الإرسال عبر واتساب" });
      setOpen(false);
    } catch (error) {
      const data = (error as { response?: { data?: { fallback_url?: string; detail?: string } } }).response?.data;
      toast({
        title: "تعذر الإرسال المباشر",
        description: `${data?.detail ?? "واتساب غير مربوط."} يمكنك فتح واتساب وإرسال الرسالة يدوياً.`,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={iconOnly ? "icon" : "sm"}
        title="إرسال عبر واتساب"
        className={cn("text-green-600 hover:text-green-700", iconOnly && "h-8 w-8", className)}
        onClick={openPreview}
      >
        <MessageCircle className="w-4 h-4" />
        {!iconOnly && <span className="mr-1">{label}</span>}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-green-600" /> مراجعة الرسالة قبل الإرسال
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>رقم الهاتف</Label>
              <Input dir="ltr" placeholder="09XXXXXXXX" value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>نص الرسالة (يمكنك تعديله)</Label>
              <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} className="leading-7" />
              <p className="text-xs text-muted-foreground">يمكن استخدام *نص* لتمييز الكلمات بالخط العريض في واتساب.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="brand" className="flex-1" onClick={send} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Send className="w-4 h-4 ml-2" />}
                إرسال
              </Button>
              <Button variant="outline" onClick={fallbackLink} disabled={busy} title="يفتح واتساب والرسالة جاهزة لتضغط إرسال بنفسك">
                فتح في واتساب
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                إلغاء
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
