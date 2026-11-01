import { useState } from "react";
import { Loader2, RefreshCw, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/SimpleSelect";
import { useFeatures } from "@/contexts/FeaturesContext";
import { useUpdateFeatures } from "@/hooks/useModules";
import { useToast } from "@/hooks/use-toast";
import apiClient from "@/lib/apiClient";
import { getErrorMessage } from "@/lib/errors";

interface Group {
  id: string;
  subject: string;
  size: number;
}

/**
 * A WhatsApp group (the owner's / partners') for reports: a note for every finalized sale and,
 * on request, today's summary. The linked phone must be a member of the group.
 */
export function WhatsappGroupPanel() {
  const { toast } = useToast();
  const { features } = useFeatures();
  const update = useUpdateFeatures();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState("");

  const fail = (error: unknown) => toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });

  const load = async () => {
    setLoading(true);
    try {
      const list = (await apiClient.get<Group[]>("/api/whatsapp/groups/")).data;
      setGroups(list);
      if (list.length === 0) toast({ title: "لا توجد مجموعات", description: "الرقم المربوط ليس عضواً في أي مجموعة." });
    } catch (error) {
      fail(error);
    } finally {
      setLoading(false);
    }
  };

  const choose = async (id: string) => {
    const group = groups.find((g) => g.id === id);
    try {
      await update.mutateAsync({ whatsapp_group_jid: id, whatsapp_group_name: group?.subject ?? "" });
      toast({ title: "تم اختيار المجموعة", description: group?.subject });
    } catch (error) {
      fail(error);
    }
  };

  const sendSummary = async () => {
    setSending(true);
    try {
      const res = (await apiClient.post<{ text: string }>("/api/whatsapp/send-group/", { summary: true })).data;
      setPreview(res.text);
      toast({ title: "أُرسل ملخص اليوم إلى المجموعة" });
    } catch (error) {
      fail(error);
    } finally {
      setSending(false);
    }
  };

  const showPreview = async () => {
    try {
      setPreview((await apiClient.get<{ text: string }>("/api/whatsapp/summary/")).data.text);
    } catch (error) {
      fail(error);
    }
  };

  const options = [
    ...(features.whatsapp_group_jid && !groups.some((g) => g.id === features.whatsapp_group_jid)
      ? [{ value: features.whatsapp_group_jid, label: features.whatsapp_group_name || features.whatsapp_group_jid }]
      : []),
    ...groups.map((g) => ({ value: g.id, label: `${g.subject} (${g.size} عضو)` })),
  ];

  return (
    <div className="space-y-3 pt-3 border-t border-border">
      <h3 className="font-medium flex items-center gap-2"><Users className="w-4 h-4 text-green-600" /> مجموعة التقارير</h3>
      <p className="text-xs text-muted-foreground">
        اختر مجموعة واتساب (مثل مجموعة الشركاء) لتصلها التقارير. يجب أن يكون رقم المحل المربوط عضواً فيها.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1 min-w-[16rem] flex-1">
          <Label className="text-xs">المجموعة</Label>
          <SimpleSelect
            value={features.whatsapp_group_jid || ""}
            onChange={choose}
            placeholder={options.length ? "اختر مجموعة" : "حمّل المجموعات أولاً"}
            options={options}
          />
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RefreshCw className="w-4 h-4 ml-1" />}
          تحميل المجموعات
        </Button>
      </div>
      {features.whatsapp_group_jid && (
        <>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={features.whatsapp_notify_sales}
              onChange={(e) => update.mutate({ whatsapp_notify_sales: e.target.checked })}
            />
            أرسل إلى المجموعة كل عملية بيع عند إنهائها
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="brand" onClick={sendSummary} disabled={sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Send className="w-4 h-4 ml-1" />}
              إرسال ملخص اليوم الآن
            </Button>
            <Button size="sm" variant="ghost" onClick={showPreview}>معاينة الملخص</Button>
          </div>
        </>
      )}
      {preview && (
        <pre className="text-xs whitespace-pre-wrap bg-muted rounded-lg p-3 font-sans" dir="rtl">{preview}</pre>
      )}
    </div>
  );
}
