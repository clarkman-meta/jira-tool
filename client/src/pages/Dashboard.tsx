import { useState, useEffect, useCallback, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown,
  ExternalLink, Settings, Activity, AlertCircle, User,
  Clock, Tag, Layers, Zap
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

type SortField = "key" | "summary" | "status" | "assigneeName" | "updated" | "priority";
type SortDir = "asc" | "desc";

interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  latestComment: string | null;
  latestCommentAuthor: string | null;
  latestCommentDate: string | null;
  updated: string;
  priority: string | null;
  issueType: string | null;
  url: string;
}

// ─── Status helpers ─────────────────────────────────────────────────────────────

function getStatusStyle(statusCategory: string, statusName: string): { bg: string; text: string; dot: string } {
  const name = statusName.toLowerCase();
  if (statusCategory === "done") return { bg: "bg-emerald-500/15", text: "text-emerald-400", dot: "bg-emerald-400" };
  if (statusCategory === "indeterminate" || name.includes("progress") || name.includes("review") || name.includes("testing"))
    return { bg: "bg-blue-500/15", text: "text-blue-400", dot: "bg-blue-400" };
  if (name.includes("block") || name.includes("reject") || name.includes("fail"))
    return { bg: "bg-red-500/15", text: "text-red-400", dot: "bg-red-400" };
  if (name.includes("triage") || name.includes("todo") || name.includes("open") || name.includes("new") || name.includes("backlog"))
    return { bg: "bg-slate-500/15", text: "text-slate-400", dot: "bg-slate-400" };
  return { bg: "bg-purple-500/15", text: "text-purple-400", dot: "bg-purple-400" };
}

function getPriorityStyle(priority: string | null): { color: string; label: string } {
  switch (priority?.toLowerCase()) {
    case "highest": return { color: "text-red-400", label: "Highest" };
    case "high":    return { color: "text-orange-400", label: "High" };
    case "medium":  return { color: "text-yellow-400", label: "Medium" };
    case "low":     return { color: "text-blue-400", label: "Low" };
    case "lowest":  return { color: "text-slate-400", label: "Lowest" };
    default:        return { color: "text-slate-500", label: priority ?? "—" };
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: days > 365 ? "numeric" : undefined });
}

// ─── Sort Icon ──────────────────────────────────────────────────────────────────

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3.5 h-3.5 text-primary" />
    : <ChevronDown className="w-3.5 h-3.5 text-primary" />;
}

// ─── Skeleton Row ───────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-border/40">
      {[80, 200, 120, 100, 100, 80].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded animate-pulse bg-muted" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Issue Table ────────────────────────────────────────────────────────────────

function IssueTable({
  issues, loading, error, myAccountId, projectColor
}: {
  issues: JiraIssue[];
  loading: boolean;
  error: string | null;
  myAccountId: string;
  projectColor: string;
}) {
  const [sortField, setSortField] = useState<SortField>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const sorted = useMemo(() => {
    return [...issues].sort((a, b) => {
      let av: string, bv: string;
      if (sortField === "updated") {
        av = a.updated; bv = b.updated;
      } else if (sortField === "key") {
        // Sort by numeric part of key
        const numA = parseInt(a.key.replace(/\D/g, "")) || 0;
        const numB = parseInt(b.key.replace(/\D/g, "")) || 0;
        return sortDir === "asc" ? numA - numB : numB - numA;
      } else {
        av = (a[sortField] ?? "") as string;
        bv = (b[sortField] ?? "") as string;
      }
      const cmp = av.localeCompare(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [issues, sortField, sortDir]);

  const thCls = "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap";
  const tdCls = "px-4 py-3 text-sm";

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertCircle className="w-10 h-10 text-destructive opacity-60" />
        <p className="text-muted-foreground text-sm">Failed to load issues: {error}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border/60" style={{ borderBottomColor: `${projectColor}30` }}>
            <th className={thCls}>
              <button className="sort-header flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => handleSort("key")}>
                Issue <SortIcon field="key" sortField={sortField} sortDir={sortDir} />
              </button>
            </th>
            <th className={thCls}>
              <button className="sort-header flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => handleSort("summary")}>
                Title <SortIcon field="summary" sortField={sortField} sortDir={sortDir} />
              </button>
            </th>
            <th className={`${thCls} min-w-[200px]`}>Latest Update</th>
            <th className={thCls}>
              <button className="sort-header flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => handleSort("status")}>
                Status <SortIcon field="status" sortField={sortField} sortDir={sortDir} />
              </button>
            </th>
            <th className={thCls}>
              <button className="sort-header flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => handleSort("assigneeName")}>
                Assignee <SortIcon field="assigneeName" sortField={sortField} sortDir={sortDir} />
              </button>
            </th>
            <th className={thCls}>
              <button className="sort-header flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors" onClick={() => handleSort("updated")}>
                Updated <SortIcon field="updated" sortField={sortField} sortDir={sortDir} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading && !issues.length && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
          {!loading && sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="text-center py-16 text-muted-foreground text-sm">
                <div className="flex flex-col items-center gap-2">
                  <Activity className="w-8 h-8 opacity-30" />
                  <span>No open issues found</span>
                </div>
              </td>
            </tr>
          )}
          {sorted.map((issue) => {
            const isMe = issue.assigneeId === myAccountId;
            const statusStyle = getStatusStyle(issue.statusCategory, issue.status);
            const priorityStyle = getPriorityStyle(issue.priority);

            return (
              <tr
                key={issue.key}
                className={`border-b border-border/30 transition-colors group cursor-pointer ${
                  isMe
                    ? "bg-amber-500/8 hover:bg-amber-500/12 border-l-2"
                    : "hover:bg-muted/40"
                }`}
                style={isMe ? { borderLeftColor: "oklch(0.72 0.18 60)" } : undefined}
                onClick={() => window.open(issue.url, "_blank")}
              >
                {/* Issue Key */}
                <td className={`${tdCls} font-mono`}>
                  <div className="flex items-center gap-2">
                    {isMe && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent>Assigned to you</TooltipContent>
                      </Tooltip>
                    )}
                    <span
                      className="text-xs font-semibold hover:underline"
                      style={{ color: projectColor }}
                    >
                      {issue.key}
                    </span>
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity flex-shrink-0" />
                  </div>
                </td>

                {/* Title */}
                <td className={`${tdCls} max-w-xs`}>
                  <div className="flex items-start gap-2">
                    <div>
                      <p className={`font-medium text-sm leading-snug line-clamp-2 ${isMe ? "text-amber-100" : "text-foreground"}`}>
                        {issue.summary}
                      </p>
                      {issue.issueType && (
                        <span className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Tag className="w-2.5 h-2.5" />{issue.issueType}
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                {/* Latest Comment */}
                <td className={`${tdCls} max-w-sm`}>
                  {issue.latestComment ? (
                    <div>
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {issue.latestComment}
                      </p>
                      {issue.latestCommentAuthor && (
                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                          — {issue.latestCommentAuthor}
                          {issue.latestCommentDate && (
                            <span className="ml-1">· {formatDate(issue.latestCommentDate)}</span>
                          )}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground/40 italic">No comments</span>
                  )}
                </td>

                {/* Status */}
                <td className={tdCls}>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                    {issue.status}
                  </span>
                </td>

                {/* Assignee */}
                <td className={tdCls}>
                  {issue.assigneeName ? (
                    <div className="flex items-center gap-2">
                      {issue.assigneeAvatar ? (
                        <img src={issue.assigneeAvatar} alt="" className="w-5 h-5 rounded-full flex-shrink-0" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <User className="w-3 h-3 text-muted-foreground" />
                        </div>
                      )}
                      <span className={`text-xs truncate max-w-[120px] ${isMe ? "text-amber-300 font-semibold" : "text-foreground"}`}>
                        {isMe ? "You" : issue.assigneeName}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">Unassigned</span>
                  )}
                </td>

                {/* Updated */}
                <td className={tdCls}>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    <span>{formatDate(issue.updated)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Dashboard Page ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, params] = useRoute("/project/:key");
  const [, navigate] = useLocation();

  const { data: projectsData, isLoading: projectsLoading } = trpc.projects.list.useQuery();
  const { data: myAccountData } = trpc.jira.myAccountId.useQuery();
  const myAccountId = myAccountData?.accountId ?? "";

  const projects = useMemo(
    () => (projectsData ?? []).filter((p) => p.isActive),
    [projectsData]
  );

  const activeKey = params?.key ?? projects[0]?.key ?? "DGTK";
  const activeProject = projects.find((p) => p.key === activeKey) ?? projects[0];

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const {
    data: issueData,
    isLoading: issuesLoading,
    refetch,
    isFetching,
  } = trpc.jira.issues.useQuery(
    { projectKey: activeKey },
    { enabled: !!activeKey, staleTime: 60_000 }
  );

  const handleRefresh = useCallback(async () => {
    await refetch();
    setLastRefresh(new Date());
    toast.success("Issues refreshed");
  }, [refetch]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(handleRefresh, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, handleRefresh]);

  const issues = issueData?.issues ?? [];
  const issueError = issueData?.error ?? null;
  const myIssueCount = issues.filter((i) => i.assigneeId === myAccountId).length;

  return (
    <div className="min-h-screen bg-background flex">
      {/* ── Sidebar ── */}
      <aside className="w-64 flex-shrink-0 border-r border-border/60 flex flex-col"
        style={{ background: "oklch(0.14 0.012 250)" }}>
        {/* Logo */}
        <div className="px-5 py-5 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Layers className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground tracking-tight">Jira Monitor</h1>
              <p className="text-xs text-muted-foreground">Issue Dashboard</p>
            </div>
          </div>
        </div>

        {/* Projects Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="px-2 mb-2 text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest">Projects</p>
          {projectsLoading && (
            <div className="space-y-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-lg animate-pulse bg-muted" />
              ))}
            </div>
          )}
          {projects.map((project) => {
            const isActive = project.key === activeKey;
            return (
              <button
                key={project.key}
                onClick={() => navigate(`/project/${project.key}`)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                style={isActive ? { background: `${project.color}18`, borderLeft: `3px solid ${project.color}` } : undefined}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: project.color ?? "#6366f1" }}
                />
                <span className="flex-1 text-left truncate">{project.name}</span>
                <span className="text-xs font-mono opacity-50">{project.key}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-border/60 space-y-1">
          <button
            onClick={() => navigate("/admin")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Manage Projects
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 border-b border-border/60 px-6 py-4"
          style={{ background: "oklch(0.13 0.01 250)" }}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {activeProject && (
                <>
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: activeProject.color ?? "#6366f1" }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-foreground truncate">{activeProject.name}</h2>
                      {activeProject.codename && (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          {activeProject.codename}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs font-mono text-muted-foreground">{activeProject.key}</span>
                      {!issuesLoading && (
                        <>
                          <span className="text-xs text-muted-foreground">
                            {issues.length} open issue{issues.length !== 1 ? "s" : ""}
                          </span>
                          {myIssueCount > 0 && (
                            <span className="text-xs font-medium text-amber-400">
                              {myIssueCount} assigned to you
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {lastRefresh && (
                <span className="text-xs text-muted-foreground hidden sm:block">
                  Updated {formatDate(lastRefresh.toISOString())}
                </span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAutoRefresh((v) => !v)}
                    className={`gap-1.5 text-xs ${autoRefresh ? "border-primary/50 text-primary bg-primary/10" : ""}`}
                  >
                    <Zap className={`w-3.5 h-3.5 ${autoRefresh ? "text-primary" : ""}`} />
                    <span className="hidden sm:inline">Auto</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{autoRefresh ? "Auto-refresh ON (5 min)" : "Enable auto-refresh"}</TooltipContent>
              </Tooltip>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isFetching}
                className="gap-1.5 text-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>
        </header>

        {/* Issue Table */}
        <div className="flex-1 overflow-auto">
          <IssueTable
            issues={issues}
            loading={issuesLoading}
            error={issueError}
            myAccountId={myAccountId}
            projectColor={activeProject?.color ?? "#6366f1"}
          />
        </div>

        {/* Footer */}
        <footer className="flex-shrink-0 border-t border-border/40 px-6 py-2.5 flex items-center justify-between">
          <p className="text-xs text-muted-foreground/60">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400/80" />
              Highlighted rows are assigned to you
            </span>
          </p>
          <p className="text-xs text-muted-foreground/40">Click any row to open in Jira</p>
        </footer>
      </main>
    </div>
  );
}
