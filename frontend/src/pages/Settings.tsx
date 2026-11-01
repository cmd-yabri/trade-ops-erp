import { confirmAction } from "@/lib/confirmMoneyAction";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Building2, KeyRound, Pencil, Plus, Trash2, UserCog } from "lucide-react";
import { BackupPanel } from "@/components/settings/BackupPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { adminService, ManagedUser } from "@/services/adminService";
import { authService } from "@/services/authService";
import { getErrorMessage } from "@/lib/errors";
import { useCompany, useUpdateCompany } from "@/hooks/useCompany";
import { useLicense } from "@/hooks/useLicense";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import apiClient from "@/lib/apiClient";
import { FeaturesPanel } from "@/components/settings/FeaturesPanel";
import { NuqtaBanner } from "@/components/NuqtaBrand";

const emptyForm = {
  username: "",
  first_name: "",
  last_name: "",
  password: "",
  role: "USER" as "ADMIN" | "USER",
  is_active: true,
};

export default function Settings() {
  const { user, isAdmin } = useAuth();
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await apiClient.get<{ version: string }>("/api/health/")).data,
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: adminService.getUsers,
    enabled: isAdmin,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [passwords, setPasswords] = useState({ old: "", next: "", confirm: "" });

  // Business details printed on invoices and purchase orders.
  const { data: license } = useLicense();
  const { data: company } = useCompany();
  const updateCompany = useUpdateCompany();
  const [companyForm, setCompanyForm] = useState({ name: "", phone: "", phone2: "", address: "" });
  useEffect(() => {
    if (company) setCompanyForm(company);
  }, [company]);

  const fail = (err: unknown) =>
    toast({ title: "خطأ", description: getErrorMessage(err), variant: "destructive" });

  const saveUser = useMutation({
    mutationFn: () => {
      const payload = { ...form, password: form.password || undefined };
      if (editing) {
        const { username: _u, ...rest } = payload;
        return adminService.updateUser(editing.id, rest);
      }
      return adminService.createUser(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDialogOpen(false);
      toast({ title: "تم الحفظ", description: "تم حفظ بيانات المستخدم." });
    },
    onError: fail,
  });

  const removeUser = useMutation({
    mutationFn: (id: string) => adminService.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "تم الحذف", description: "تم حذف المستخدم." });
    },
    onError: fail,
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (u: ManagedUser) => {
    setEditing(u);
    setForm({
      username: u.username,
      first_name: u.first_name,
      last_name: u.last_name,
      password: "",
      role: u.role,
      is_active: u.is_active,
    });
    setDialogOpen(true);
  };

  const handleChangePassword = async () => {
    if (passwords.next !== passwords.confirm) {
      toast({ title: "خطأ", description: "كلمات المرور غير متطابقة.", variant: "destructive" });
      return;
    }
    try {
      await authService.changePassword(passwords.old, passwords.next);
      setPasswords({ old: "", next: "", confirm: "" });
      toast({ title: "تم", description: "تم تغيير كلمة المرور." });
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground">الإعدادات</h1>
        <p className="text-muted-foreground mt-1">
          الحساب الحالي: {user?.first_name} ({user?.username}) —{" "}
          {isAdmin ? "مدير" : "موظف"}
        </p>
        {health?.version && (
          <p className="text-xs text-muted-foreground mt-1" dir="ltr">
            TradeOps v{health.version}
          </p>
        )}
      </div>

      <section className="bg-card border border-border rounded-xl p-6 space-y-2">
        <h2 className="font-semibold flex items-center gap-2">
          <BadgeCheck className="w-5 h-5 text-primary" /> الترخيص
        </h2>
        <p className="text-sm text-muted-foreground">
          {license?.status === "active"
            ? `مفعّل${license.customer ? ` باسم ${license.customer}` : ""}${license.expires ? ` حتى ${license.expires}` : " (ترخيص دائم)"}`
            : license?.status === "trial"
              ? `نسخة تجريبية - متبقي ${license.days_left} يوماً`
              : "غير مفعّل"}
        </p>
        <Link to="/license" className="text-sm text-primary hover:underline">
          {license?.status === "active" ? "تفاصيل الترخيص" : "تفعيل البرنامج"}
        </Link>
      </section>

      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" /> بيانات الشركة (تظهر على الفواتير)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>اسم الشركة / المتجر</Label>
            <Input value={companyForm.name} disabled={!isAdmin}
              onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>العنوان</Label>
            <Input value={companyForm.address} disabled={!isAdmin}
              onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>هاتف 1</Label>
            <Input value={companyForm.phone} disabled={!isAdmin}
              onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>هاتف 2</Label>
            <Input value={companyForm.phone2} disabled={!isAdmin}
              onChange={(e) => setCompanyForm({ ...companyForm, phone2: e.target.value })} />
          </div>
        </div>
        {isAdmin ? (
          <Button
            variant="brand"
            disabled={updateCompany.isPending}
            onClick={() =>
              updateCompany.mutate(companyForm, {
                onSuccess: () => toast({ title: "تم الحفظ", description: "تم حفظ بيانات الشركة." }),
                onError: fail,
              })
            }
          >
            حفظ بيانات الشركة
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">يمكن للمدير فقط تعديل هذه البيانات.</p>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" /> تغيير كلمة المرور
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>كلمة المرور الحالية</Label>
            <Input type="password" value={passwords.old} autoComplete="current-password"
              onChange={(e) => setPasswords({ ...passwords, old: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>كلمة المرور الجديدة</Label>
            <Input type="password" value={passwords.next} autoComplete="new-password"
              onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>تأكيد كلمة المرور</Label>
            <Input type="password" value={passwords.confirm} autoComplete="new-password"
              onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} />
          </div>
        </div>
        <Button variant="brand" onClick={handleChangePassword}
          disabled={!passwords.old || !passwords.next}>
          حفظ كلمة المرور
        </Button>
      </section>

      {isAdmin && (
        <>
          <section className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <UserCog className="w-5 h-5 text-primary" /> المستخدمون
              </h2>
              <Button variant="brand" size="sm" className="gap-1" onClick={openCreate}>
                <Plus className="w-4 h-4" /> مستخدم جديد
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              المدير يرى كل شيء ويستطيع الحذف وإدارة المستخدمين. الموظف يضيف ويعدّل فقط.
              يمكنك هنا إعادة تعيين كلمة مرور أي مستخدم.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2">المستخدم</th>
                    <th className="px-3 py-2">الاسم</th>
                    <th className="px-3 py-2">الدور</th>
                    <th className="px-3 py-2">الحالة</th>
                    <th className="px-3 py-2">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(users || []).map((u) => (
                    <tr key={u.id}>
                      <td className="px-3 py-2 font-medium">{u.username}</td>
                      <td className="px-3 py-2">{u.first_name} {u.last_name}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{u.role === "ADMIN" ? "مدير" : "موظف"}</Badge>
                      </td>
                      <td className="px-3 py-2">{u.is_active ? "نشط" : "معطّل"}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500"
                            onClick={() => openEdit(u)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                            disabled={u.id === user?.id}
                            onClick={async () => {
                              if (await confirmAction(`حذف المستخدم ${u.username}؟`)) removeUser.mutate(u.id);
                            }}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <FeaturesPanel />

          <BackupPanel />
        </>
      )}

      <NuqtaBanner />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `تعديل ${editing.username}` : "مستخدم جديد"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>الاسم الأول</Label>
                <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>الكنية</Label>
                <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>اسم المستخدم</Label>
              <Input value={form.username} disabled={!!editing}
                onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{editing ? "كلمة مرور جديدة (اتركها فارغة لعدم التغيير)" : "كلمة المرور"}</Label>
              <Input type="password" value={form.password} autoComplete="new-password"
                onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>الدور</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as "ADMIN" | "USER" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER">موظف</SelectItem>
                    <SelectItem value="ADMIN">مدير</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>الحالة</Label>
                <Select value={form.is_active ? "1" : "0"} onValueChange={(v) => setForm({ ...form, is_active: v === "1" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">نشط</SelectItem>
                    <SelectItem value="0">معطّل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button variant="brand" className="w-full" onClick={() => saveUser.mutate()}
              disabled={saveUser.isPending || !form.username || (!editing && !form.password)}>
              حفظ
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
