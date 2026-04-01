import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Pencil, Trash2, Layers, Check, X, GripVertical
} from "lucide-react";

const PRESET_COLORS = [
  "#f59e0b", "#10b981", "#6366f1", "#ec4899", "#14b8a6",
  "#f97316", "#8b5cf6", "#06b6d4", "#84cc16", "#ef4444",
];

interface ProjectFormData {
  key: string;
  name: string;
  codename: string;
  color: string;
  jiraBaseUrl: string;
  titleFilter: string;
  customJql: string;
}

const EMPTY_FORM: ProjectFormData = {
  key: "",
  name: "",
  codename: "",
  color: "#6366f1",
  jiraBaseUrl: "https://metarl.atlassian.net",
  titleFilter: "",
  customJql: "",
};

export default function AdminProjects() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: projects = [], isLoading } = trpc.projects.list.useQuery();

  const addMutation = trpc.projects.add.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      toast.success("Project added successfully");
      setShowAddForm(false);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(`Failed to add project: ${e.message}`),
  });

  const updateMutation = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      toast.success("Project updated");
      setEditingId(null);
    },
    onError: (e) => toast.error(`Failed to update: ${e.message}`),
  });

  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      toast.success("Project removed");
    },
    onError: (e) => toast.error(`Failed to delete: ${e.message}`),
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<ProjectFormData>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProjectFormData>>({});

  const handleAdd = () => {
    if (!form.key || !form.name) { toast.error("Key and Name are required"); return; }
    addMutation.mutate({
      key: form.key,
      name: form.name,
      codename: form.codename || undefined,
      color: form.color,
      jiraBaseUrl: form.jiraBaseUrl || undefined,
      titleFilter: form.titleFilter || undefined,
      customJql: form.customJql || undefined,
    });
  };

  const startEdit = (p: typeof projects[0]) => {
    setEditingId(p.id);
    setEditForm({
      name: p.name,
      codename: p.codename ?? "",
      color: p.color ?? "#6366f1",
      jiraBaseUrl: p.jiraBaseUrl ?? "",
      titleFilter: (p as { titleFilter?: string | null }).titleFilter ?? "",
      customJql: (p as { customJql?: string | null }).customJql ?? "",
    });
  };

  const handleUpdate = (id: number) => {
    updateMutation.mutate({ id, ...editForm });
  };

  const handleToggleActive = (p: typeof projects[0]) => {
    updateMutation.mutate({ id: p.id, isActive: !p.isActive });
  };

  const inputCls = "bg-input border-border text-foreground placeholder:text-muted-foreground text-sm h-9";
  const labelCls = "text-xs font-medium text-muted-foreground";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/60 px-6 py-4" style={{ background: "oklch(0.14 0.012 250)" }}>
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-semibold text-foreground">Manage Projects</h1>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Page Title */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground">Project Configuration</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Add, edit, or remove Jira projects from your dashboard. Changes take effect immediately.
          </p>
        </div>

        {/* Project List */}
        <div className="rounded-xl border border-border/60 overflow-hidden mb-6" style={{ background: "oklch(0.16 0.012 250)" }}>
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Active Projects</h3>
            <span className="text-xs text-muted-foreground">{projects.length} project{projects.length !== 1 ? "s" : ""}</span>
          </div>

          {isLoading ? (
            <div className="p-8 flex justify-center">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : projects.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No projects configured yet.</div>
          ) : (
            <div className="divide-y divide-border/40">
              {projects.map((project) => (
                <div key={project.id} className={`px-5 py-4 transition-colors ${!project.isActive ? "opacity-50" : ""}`}>
                  {editingId === project.id ? (
                    /* Edit Mode */
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className={labelCls}>Name</Label>
                          <Input className={inputCls} value={editForm.name ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className={labelCls}>Codename</Label>
                          <Input className={inputCls} value={editForm.codename ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, codename: e.target.value }))} placeholder="e.g. diamond" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className={labelCls}>Jira Base URL</Label>
                        <Input className={inputCls} value={editForm.jiraBaseUrl ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, jiraBaseUrl: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className={labelCls}>Custom JQL Override</Label>
                        <textarea
                          className="w-full bg-input border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-md px-3 py-2 min-h-[72px] resize-y"
                          value={(editForm as { customJql?: string }).customJql ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, customJql: e.target.value }))}
                          placeholder="e.g. project = DGTK AND parent = DGTK-234 AND statusCategory != Done ORDER BY updated DESC"
                        />
                        <p className="text-xs text-muted-foreground/60">If set, this JQL completely replaces the default query. Leave blank to use the default open-issues query.</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label className={labelCls}>Title Filter Keywords <span className="text-muted-foreground/50">(fallback, used only when no Custom JQL)</span></Label>
                        <Input
                          className={inputCls}
                          value={(editForm as { titleFilter?: string }).titleFilter ?? ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, titleFilter: e.target.value }))}
                          placeholder="e.g. Diamond,DImond (comma-separated)"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className={labelCls}>Accent Color</Label>
                        <div className="flex items-center gap-2 flex-wrap">
                          {PRESET_COLORS.map((c) => (
                            <button
                              key={c}
                              onClick={() => setEditForm((f) => ({ ...f, color: c }))}
                              className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                              style={{ background: c, borderColor: editForm.color === c ? "white" : "transparent" }}
                            />
                          ))}
                          <input type="color" value={editForm.color ?? "#6366f1"} onChange={(e) => setEditForm((f) => ({ ...f, color: e.target.value }))} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleUpdate(project.id)} disabled={updateMutation.isPending} className="gap-1.5 text-xs">
                          <Check className="w-3.5 h-3.5" /> Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="gap-1.5 text-xs">
                          <X className="w-3.5 h-3.5" /> Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* View Mode */
                    <div className="flex items-center gap-4">
                      <GripVertical className="w-4 h-4 text-muted-foreground/30 flex-shrink-0" />
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: project.color ?? "#6366f1" }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground">{project.name}</span>
                          {project.codename && (
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{project.codename}</span>
                          )}
                          {!project.isActive && (
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Inactive</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs font-mono text-muted-foreground">{project.key}</span>
                          {project.jiraBaseUrl && (
                            <span className="text-xs text-muted-foreground/60 truncate max-w-[200px]">{project.jiraBaseUrl}</span>
                          )}
                          {(project as { customJql?: string | null }).customJql ? (
                            <span className="text-xs text-blue-400/70 truncate max-w-[320px]" title={(project as { customJql?: string | null }).customJql ?? ""}>
                              JQL: {((project as { customJql?: string | null }).customJql ?? "").substring(0, 60)}…
                            </span>
                          ) : (project as { titleFilter?: string | null }).titleFilter ? (
                            <span className="text-xs text-amber-500/70 truncate max-w-[240px]" title="Title filter keywords">
                              filter: {(project as { titleFilter?: string | null }).titleFilter}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => handleToggleActive(project)} className="text-xs text-muted-foreground hover:text-foreground h-7 px-2">
                          {project.isActive ? "Disable" : "Enable"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(project)} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => { if (confirm(`Remove ${project.name} (${project.key})?`)) deleteMutation.mutate({ id: project.id }); }}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Project Form */}
        {showAddForm ? (
          <div className="rounded-xl border border-primary/30 overflow-hidden" style={{ background: "oklch(0.16 0.012 250)" }}>
            <div className="px-5 py-4 border-b border-border/60">
              <h3 className="text-sm font-semibold text-foreground">Add New Project</h3>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className={labelCls}>Project Key <span className="text-destructive">*</span></Label>
                  <Input className={inputCls} value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))} placeholder="e.g. DGTK" />
                  <p className="text-xs text-muted-foreground/60">The Jira project key (e.g. DGTK, KITE)</p>
                </div>
                <div className="space-y-1.5">
                  <Label className={labelCls}>Project Name <span className="text-destructive">*</span></Label>
                  <Input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Dragon" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className={labelCls}>Codename</Label>
                  <Input className={inputCls} value={form.codename} onChange={(e) => setForm((f) => ({ ...f, codename: e.target.value }))} placeholder="e.g. diamond" />
                </div>
                <div className="space-y-1.5">
                  <Label className={labelCls}>Jira Base URL</Label>
                  <Input className={inputCls} value={form.jiraBaseUrl} onChange={(e) => setForm((f) => ({ ...f, jiraBaseUrl: e.target.value }))} placeholder="https://your-org.atlassian.net" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>Accent Color</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                      className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                      style={{ background: c, borderColor: form.color === c ? "white" : "transparent" }}
                    />
                  ))}
                  <input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" />
                  <span className="text-xs text-muted-foreground ml-1">{form.color}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>Custom JQL Override</Label>
                <textarea
                  className="w-full bg-input border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-md px-3 py-2 min-h-[72px] resize-y"
                  value={form.customJql}
                  onChange={(e) => setForm((f) => ({ ...f, customJql: e.target.value }))}
                  placeholder="e.g. project = MYKEY AND parent = MYKEY-1 AND statusCategory != Done ORDER BY updated DESC"
                />
                <p className="text-xs text-muted-foreground/60">If set, this JQL completely replaces the default query. Leave blank to use the default open-issues query.</p>
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>Title Filter Keywords <span className="text-muted-foreground/50">(fallback)</span></Label>
                <Input
                  className={inputCls}
                  value={form.titleFilter}
                  onChange={(e) => setForm((f) => ({ ...f, titleFilter: e.target.value }))}
                  placeholder="e.g. Diamond,DImond (comma-separated, leave blank to show all)"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleAdd} disabled={addMutation.isPending} className="gap-1.5 text-sm">
                  <Plus className="w-4 h-4" />
                  {addMutation.isPending ? "Adding..." : "Add Project"}
                </Button>
                <Button variant="outline" onClick={() => { setShowAddForm(false); setForm(EMPTY_FORM); }} className="text-sm">
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button onClick={() => setShowAddForm(true)} className="gap-2 text-sm" variant="outline">
            <Plus className="w-4 h-4" />
            Add New Project
          </Button>
        )}
      </div>
    </div>
  );
}
