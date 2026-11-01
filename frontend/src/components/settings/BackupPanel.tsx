import { confirmAction } from "@/lib/confirmMoneyAction";
import { useEffect, useRef, useState } from "react";
import { DatabaseBackup, FolderOpen, Loader2, RotateCcw, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import apiClient from "@/lib/apiClient";
import { getErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/utils";

interface BackupSettings {
  folder: string;
  copy_auto: boolean;
  default_folder: string;
  auto_folder: string;
  folder_ok: boolean;
}

interface BackupFile {
  source: "auto" | "manual" | "folder" | "folder_auto";
  name: string;
  folder: string;
  size: number;
  modified: string;
}

const SOURCE_LABEL: Record<BackupFile["source"], string> = {
  auto: "تلقائية",
  manual: "يدوية",
  folder: "في المجلد المختار",
  folder_auto: "تلقائية (المجلد المختار)",
};

/** Windows' folder picker inside the desktop app; null in a plain browser. */
const pickFolder = async (): Promise<string | null> => {
  const w = window as unknown as { pywebview?: { api?: { choose_folder?: () => Promise<string> } } };
  if (!w.pywebview?.api?.choose_folder) return null;
  return (await w.pywebview.api.choose_folder()) || "";
};

/** Where backups go (another disk / USB stick), backing up now, and restoring an older copy. */
export function BackupPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: settings } = useQuery({
    queryKey: ["backupSettings"],
    queryFn: async () => (await apiClient.get<BackupSettings>("/api/system/backup-settings/")).data,
  });
  const { data: files = [] } = useQuery({
    queryKey: ["backups"],
    queryFn: async () => (await apiClient.get<BackupFile[]>("/api/system/backups/")).data,
  });
  const [folder, setFolder] = useState("");
  useEffect(() => setFolder(settings?.folder ?? ""), [settings?.folder]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["backupSettings"] });
    queryClient.invalidateQueries({ queryKey: ["backups"] });
  };
  const fail = (error: unknown) => toast({ title: "خطأ", description: getErrorMessage(error), variant: "destructive" });

  const save = useMutation({
    mutationFn: async (data: Partial<BackupSettings>) =>
      (await apiClient.put<BackupSettings>("/api/system/backup-settings/", data)).data,
    onSuccess: () => {
      refresh();
      toast({ title: "تم حفظ إعدادات النسخ الاحتياطي" });
    },
    onError: fail,
  });
  const backupNow = useMutation({
    mutationFn: async () => (await apiClient.post<{ path: string }>("/api/system/backup/")).data,
    onSuccess: (res) => {
      refresh();
      toast({ title: "تم إنشاء النسخة الاحتياطية", description: res.path });
    },
    onError: fail,
  });
  const restore = useMutation({
    mutationFn: async (data: { source: string; name: string } | FormData) =>
      (
        await apiClient.post<{ restored: string; safety_copy: string }>(
          "/api/system/restore/",
          data,
          // an uploaded file must go as multipart (the client's default JSON would serialise it)
          data instanceof FormData ? { headers: { "Content-Type": "multipart/form-data" } } : undefined,
        )
      ).data,
    onSuccess: (res) => {
      toast({ title: "تمت الاستعادة", description: `حُفظت نسخة من البيانات السابقة في: ${res.safety_copy}` });
      // the data (and maybe the users) changed: start again from the login page
      setTimeout(() => {
        try {
          localStorage.clear();
        } catch {
          /* ignore */
        }
        window.location.href = "/login";
      }, 2500);
    },
    onError: fail,
  });

  const choose = async () => {
    const picked = await pickFolder();
    if (picked === null) {
      toast({ title: "اكتب مسار المجلد", description: "اختيار المجلد بالنافذة متاح داخل برنامج سطح المكتب." });
      return;
    }
    if (picked) {
      setFolder(picked);
      save.mutate({ folder: picked });
    }
  };

  const confirmRestore = (label: string) =>
    confirmAction(
      `استعادة «${label}»؟\nستُستبدل كل البيانات الحالية بهذه النسخة. تُحفظ نسخة من البيانات الحالية أولاً، ثم يعود البرنامج لصفحة الدخول.`,
    );

  const onUpload = async (file: File | undefined) => {
    if (!file || !await confirmRestore(file.name)) return;
    const form = new FormData();
    form.append("file", file);
    restore.mutate(form);
  };

  return (
    <section className="bg-card border border-border rounded-xl p-6 space-y-4">
      <h2 className="font-semibold flex items-center gap-2">
        <DatabaseBackup className="w-5 h-5 text-primary" /> النسخ الاحتياطي والاستعادة
      </h2>
      <p className="text-sm text-muted-foreground">
        تُؤخذ نسخة تلقائية يومياً عند فتح البرنامج. اختر مجلداً على قرص آخر أو فلاشة لتبقى نسخك سليمة إن تعطل قرص الجهاز.
      </p>

      <div className="space-y-2">
        <Label>مجلد النسخ الاحتياطي</Label>
        <div className="flex gap-2">
          <Input
            dir="ltr"
            placeholder={settings?.default_folder ?? ""}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
          <Button variant="outline" onClick={choose}>
            <FolderOpen className="w-4 h-4 ml-1" /> اختيار
          </Button>
          <Button variant="outline" disabled={save.isPending || folder === (settings?.folder ?? "")}
            onClick={() => save.mutate({ folder })}>
            حفظ
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {settings?.folder
            ? settings.folder_ok
              ? "تُحفظ النسخ اليدوية في هذا المجلد."
              : "⚠️ المجلد المختار غير متاح الآن (هل الفلاشة موصولة؟). تُحفظ النسخ مؤقتاً في المجلد الافتراضي."
            : `فارغ = المجلد الافتراضي: ${settings?.default_folder ?? ""}`}
        </p>
        {settings?.folder && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={settings.copy_auto}
              onChange={(e) => save.mutate({ copy_auto: e.target.checked })}
            />
            انسخ النسخة التلقائية اليومية إلى هذا المجلد أيضاً
          </label>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="brand" onClick={() => backupNow.mutate()} disabled={backupNow.isPending}>
          {backupNow.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
          إنشاء نسخة احتياطية الآن
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={restore.isPending}>
          <Upload className="w-4 h-4 ml-1" /> استعادة من ملف...
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".sqlite3,.db"
          className="hidden"
          onChange={(e) => {
            onUpload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <div className="space-y-2">
        <Label>النسخ الموجودة</Label>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد نسخ بعد.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-sm text-right">
              <tbody>
                {files.slice(0, 30).map((f) => (
                  <tr key={`${f.source}/${f.name}`} className="border-t border-border first:border-t-0">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDate(f.modified)} {new Date(f.modified).toTimeString().slice(0, 5)}
                    </td>
                    <td className="px-3 text-muted-foreground">{SOURCE_LABEL[f.source]}</td>
                    <td className="px-3 text-muted-foreground" dir="ltr">{(f.size / 1024 / 1024).toFixed(1)} MB</td>
                    <td className="px-3 text-left">
                      <Button variant="ghost" size="sm" disabled={restore.isPending}
                        onClick={() => confirmRestore(f.name) && restore.mutate({ source: f.source, name: f.name })}>
                        <RotateCcw className="w-4 h-4 ml-1" /> استعادة
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
