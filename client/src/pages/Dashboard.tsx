import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown,
  ExternalLink, Settings, Activity, AlertCircle, User,
  Clock, Tag, Layers, Zap, Search, X,
  Star, EyeOff, Eye, Trash2, Plus, BookMarked
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

type SortField = "key" | "summary" | "status" | "assigneeName" | "reporterName" | "updated" | "priority";
type SortConfig = { field: SortField; dir: SortDir };
type SortDir = "asc" | "desc";

// Stage filter presets — user can also type a custom keyword
const STAGE_PRESETS = ["All", "SMT", "FATP", "EVT", "DVT", "PVT", "NPI"] as const;
type StagePreset = (typeof STAGE_PRESETS)[number];

interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  reporterId: string | null;
  reporterName: string | null;
  reporterAvatar: string | null;
  latestComment: string | null;
  latestCommentAuthor: string | null;
  latestCommentDate: string | null;
  updated: string;
  priority: string | null;
  build: string | null;
  issueType: string | null;
  labels: string[];
  url: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getStatusStyle(statusCategory: string, statusName: string) {
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

function getPriorityStyle(priority: string | null) {
  const p = priority?.toLowerCase() ?? "";
  if (p === "p0" || p === "highest" || p === "blocker") return { bg: "bg-red-500/20", text: "text-red-300", ring: "ring-red-500/40" };
  if (p === "p1" || p === "high")   return { bg: "bg-orange-500/20", text: "text-orange-300", ring: "ring-orange-500/40" };
  if (p === "p2" || p === "medium") return { bg: "bg-yellow-500/20", text: "text-yellow-300", ring: "ring-yellow-500/40" };
  if (p === "p3" || p === "low")    return { bg: "bg-blue-500/20", text: "text-blue-300", ring: "ring-blue-500/40" };
  if (p === "p4" || p === "lowest") return { bg: "bg-slate-500/20", text: "text-slate-400", ring: "ring-slate-500/40" };
  return { bg: "bg-muted/60", text: "text-muted-foreground", ring: "ring-border" };
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

/** Case-insensitive keyword match against title + latest comment */
function issueMatchesKeyword(issue: JiraIssue, keyword: string): boolean {
  if (!keyword) return true;
  const kw = keyword.toLowerCase();
  const haystack = [
    issue.summary,
    issue.latestComment ?? "",
    issue.issueType ?? "",
  ].join(" ").toLowerCase();
  return haystack.includes(kw);
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3.5 h-3.5 text-primary" />
    : <ChevronDown className="w-3.5 h-3.5 text-primary" />;
}

function SortTh({ field, label, sortField, sortDir, onSort, className = "" }: {
  field: SortField; label: string; sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void; className?: string;
}) {
  return (
    <th className={`px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap ${className}`}>
      <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => onSort(field)}>
        {label} <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
      </button>
    </th>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border/40">
      {[70, 200, 60, 160, 100, 100, 100, 80].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded animate-pulse bg-muted" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

function AvatarCell({ avatar, name, isMe }: { avatar: string | null; name: string | null; isMe?: boolean }) {
  if (!name) return <span className="text-xs text-muted-foreground/40">—</span>;
  return (
    <div className="flex items-center gap-2">
      {avatar ? (
        <img src={avatar} alt="" className="w-5 h-5 rounded-full flex-shrink-0" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
          <User className="w-3 h-3 text-muted-foreground" />
        </div>
      )}
      <span className={`text-xs truncate max-w-[110px] ${isMe ? "text-amber-300 font-semibold" : "text-foreground"}`}>
        {isMe ? "You" : name}
      </span>
    </div>
  );
}

// ─── Stage Filter Bar ───────────────────────────────────────────────────────────

function StageFilterBar({
  activePreset, customKeyword, onPreset, onCustom, matchCount, totalCount
}: {
  activePreset: StagePreset;
  customKeyword: string;
  onPreset: (p: StagePreset) => void;
  onCustom: (v: string) => void;
  matchCount: number;
  totalCount: number;
}) {
  const [inputValue, setInputValue] = useState(customKeyword);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onCustom(inputValue.trim());
    if (e.key === "Escape") { setInputValue(""); onCustom(""); }
  };

  const handleClear = () => { setInputValue(""); onCustom(""); onPreset("All"); };

  const isFiltered = activePreset !== "All" || customKeyword !== "";

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 flex-wrap"
      style={{ background: "oklch(0.145 0.011 250)" }}>
      {/* Preset chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {STAGE_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => { onPreset(p); setInputValue(""); onCustom(""); }}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              activePreset === p && customKeyword === ""
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-border/60" />

      {/* Custom keyword search */}
      <div className="relative flex items-center">
        <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => onCustom(inputValue.trim())}
          placeholder="Filter by keyword…"
          className="pl-8 pr-7 py-1 text-xs rounded-md bg-muted/60 border border-border/60 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 w-44 transition-all"
        />
        {inputValue && (
          <button onClick={handleClear} className="absolute right-2 text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Match count */}
      {isFiltered && (
        <span className="text-xs text-muted-foreground ml-1">
          <span className="font-semibold text-foreground">{matchCount}</span> of {totalCount} issues
        </span>
      )}

      {/* Clear all */}
      {isFiltered && (
        <button onClick={handleClear} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-auto">
          Clear filter
        </button>
      )}
    </div>
  );
}

// ─── Issue Table ────────────────────────────────────────────────────────────────

function IssueTable({
  issues, loading, error, myAccountId, projectColor, projectKey, watchedKeys,
  activeProjectKey, onHideIssue, onPinIssue, myIssuesOnly, onToggleMyIssues,
  hiddenIssues, onUnhideIssue, statusFilter, onStatusFilterChange, allStatuses,
  labelsFilter, onLabelsFilterChange,
  priorityFilter, onPriorityFilterChange,
  daysFilter, onDaysFilterChange,
  stagePreset, onStagePresetChange,
  stageKeyword, onStageKeywordChange,
}: {
  issues: JiraIssue[];
  loading: boolean;
  error: string | null;
  myAccountId: string;
  projectColor: string;
  projectKey: string;
  watchedKeys: Set<string>;
  activeProjectKey: string;
  onHideIssue: (key: string) => void;
  onPinIssue: (key: string) => void;
  myIssuesOnly: boolean;
  onToggleMyIssues: () => void;
  hiddenIssues: { issueKey: string }[];
  onUnhideIssue: (key: string) => void;
  statusFilter: Set<string>;
  onStatusFilterChange: (s: Set<string>) => void;
  allStatuses: string[];
  labelsFilter: Set<string>;
  onLabelsFilterChange: (s: Set<string>) => void;
  priorityFilter: Set<string>;
  onPriorityFilterChange: (s: Set<string>) => void;
  daysFilter: number;
  onDaysFilterChange: (d: number) => void;
  stagePreset: StagePreset;
  onStagePresetChange: (p: StagePreset) => void;
  stageKeyword: string;
  onStageKeywordChange: (v: string) => void;
}) {
  // Default: priority asc first, updated desc as secondary
  const [sorts, setSorts] = useState<SortConfig[]>([
    { field: "priority", dir: "asc" },
    { field: "updated", dir: "desc" },
  ]);
  const sortField = sorts[0]?.field ?? "priority";
  const sortDir = sorts[0]?.dir ?? "asc";
  const [customKeyword, setCustomKeyword] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [daysInput, setDaysInput] = useState(String(daysFilter));
  const [statusOpen, setStatusOpen] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const labelsDropdownRef = useRef<HTMLDivElement>(null);

  // Click-outside handler: close any open dropdown when user clicks outside it
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (statusOpen && statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
      if (labelsOpen && labelsDropdownRef.current && !labelsDropdownRef.current.contains(e.target as Node)) {
        setLabelsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [statusOpen, labelsOpen]);

  const togglePriority = (p: string) => {
    const next = new Set(priorityFilter);
    if (next.has(p)) next.delete(p); else next.add(p);
    onPriorityFilterChange(next);
  };

  const toggleStatus = (s: string) => {
    const next = new Set(statusFilter);
    if (next.has(s)) next.delete(s); else next.add(s);
    onStatusFilterChange(next);
  };

  const toggleLabel = (l: string) => {
    const next = new Set(labelsFilter);
    if (next.has(l)) next.delete(l); else next.add(l);
    onLabelsFilterChange(next);
  };

  const handleSort = (field: SortField) => {
    setSorts(prev => {
      const existing = prev.find(s => s.field === field);
      if (existing) {
        const newDir: SortDir = existing.dir === "asc" ? "desc" : "asc";
        return [{ field, dir: newDir }, ...prev.filter(s => s.field !== field)];
      }
      return [{ field, dir: "desc" }, { field: "updated", dir: "desc" }];
    });
  };

  // For KITE, use build field as the effective priority
  const isKite = projectKey === "KITE";
  const getEffectivePriority = (issue: JiraIssue) =>
    isKite ? (issue.build ?? issue.priority) : issue.priority;

  // Effective filter keyword: stage preset or custom keyword (client-side only)
  // All other filters (labels, priority, time, stage) are handled server-side via JQL
  const effectiveKeyword = customKeyword;

  // Collect all unique labels from fetched issues (for dropdown display)
  const allLabels = useMemo(() => {
    const seen = new Set<string>();
    issues.forEach((i) => i.labels.forEach((l) => seen.add(l)));
    return Array.from(seen).sort();
  }, [issues]);

  // filtered: only keyword search remains client-side
  const filtered = useMemo(() =>
    issues.filter((i) => issueMatchesKeyword(i, effectiveKeyword)),
    [issues, effectiveKeyword]
  );

  const sorted = useMemo(() => {
    const priorityOrder: Record<string, number> = {
      p0: 0, highest: 0, blocker: 0,
      p1: 1, high: 1,
      p2: 2, medium: 2,
      p3: 3, low: 3,
      p4: 4, lowest: 4,
    };
    const compareOne = (a: JiraIssue, b: JiraIssue, s: SortConfig): number => {
      if (s.field === "key") {
        const na = parseInt(a.key.replace(/\D/g, "")) || 0;
        const nb = parseInt(b.key.replace(/\D/g, "")) || 0;
        return s.dir === "asc" ? na - nb : nb - na;
      }
      if (s.field === "priority") {
        const av = priorityOrder[(getEffectivePriority(a) ?? "").toLowerCase()] ?? 99;
        const bv = priorityOrder[(getEffectivePriority(b) ?? "").toLowerCase()] ?? 99;
        return s.dir === "asc" ? av - bv : bv - av;
      }
      const av = (a[s.field as keyof JiraIssue] ?? "") as string;
      const bv = (b[s.field as keyof JiraIssue] ?? "") as string;
      const cmp = av.localeCompare(bv);
      return s.dir === "asc" ? cmp : -cmp;
    };
    return [...filtered].sort((a, b) => {
      for (const s of sorts) {
        const cmp = compareOne(a, b, s);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sorts, isKite]);

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
    <div className="flex flex-col h-full">
      {/* Filter Bar — Row 1: stage chips + keyword + My Issues + Pin */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 flex-wrap"
        style={{ background: "oklch(0.145 0.011 250)" }}>
        <StageFilterBar
          activePreset={stagePreset}
          customKeyword={customKeyword}
          onPreset={(p) => { onStagePresetChange(p); onStageKeywordChange(""); setCustomKeyword(""); }}
          onCustom={(v) => { setCustomKeyword(v); if (v) { onStagePresetChange("All"); onStageKeywordChange(v); } else { onStageKeywordChange(""); } }}
          matchCount={sorted.length}
          totalCount={issues.length}
        />
        {/* My Issues Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleMyIssues}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all flex-shrink-0 ${
                myIssuesOnly
                  ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <User className="w-3 h-3" />
              <span className="hidden sm:inline">My Issues</span>
              {myIssuesOnly && (
                <span className="ml-0.5 bg-amber-500/30 text-amber-200 rounded-full px-1.5 text-[10px] font-bold">
                  {sorted.length}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{myIssuesOnly ? "Showing issues where you are involved (assignee / reporter / watcher / commenter) — click to show all" : "Show only issues where you have any involvement"}</TooltipContent>
        </Tooltip>
      </div>

      {/* Filter Bar — Row 2: time filter */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30 flex-wrap"
        style={{ background: "oklch(0.138 0.010 250)" }}>
        <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground flex-shrink-0">Updated in last</span>
        {/* Quick preset chips */}
        {[7, 14, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => { onDaysFilterChange(d); setDaysInput(String(d)); }}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-all flex-shrink-0 ${
              daysFilter === d && daysFilter > 0
                ? "bg-primary/80 text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {d}d
          </button>
        ))}
        {/* Free-input days */}
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="1"
            max="9999"
            value={daysInput}
            onChange={(e) => setDaysInput(e.target.value)}
            onBlur={() => {
              const n = parseInt(daysInput);
              if (!isNaN(n) && n > 0) onDaysFilterChange(n);
              else { setDaysInput(String(daysFilter)); }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = parseInt(daysInput);
                if (!isNaN(n) && n > 0) onDaysFilterChange(n);
              }
            }}
            className="w-16 px-2 py-0.5 text-xs rounded bg-muted/60 border border-border/60 text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <span className="text-xs text-muted-foreground">days</span>
        </div>
        {/* All time */}
        <button
          onClick={() => { onDaysFilterChange(0); setDaysInput("0"); }}
          className={`px-2 py-0.5 rounded text-xs font-medium transition-all flex-shrink-0 ${
            daysFilter === 0
              ? "bg-primary/80 text-primary-foreground"
              : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          All time
        </button>
        {/* Divider */}
        <div className="w-px h-4 bg-border/60 flex-shrink-0" />

        {/* Priority filter chips */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {([
            { label: "P0", key: "p0", active: "bg-red-500/25 text-red-300 ring-1 ring-red-500/50", inactive: "bg-muted/50 text-muted-foreground hover:bg-red-500/15 hover:text-red-300" },
            { label: "P1", key: "p1", active: "bg-orange-500/25 text-orange-300 ring-1 ring-orange-500/50", inactive: "bg-muted/50 text-muted-foreground hover:bg-orange-500/15 hover:text-orange-300" },
            { label: "P2", key: "p2", active: "bg-yellow-500/25 text-yellow-300 ring-1 ring-yellow-500/50", inactive: "bg-muted/50 text-muted-foreground hover:bg-yellow-500/15 hover:text-yellow-300" },
          ] as const).map(({ label, key, active, inactive }) => (
            <button
              key={key}
              onClick={() => togglePriority(key)}
              className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${
                priorityFilter.has(key) ? active : inactive
              }`}
            >
              {label}
            </button>
          ))}
          {priorityFilter.size > 0 && (
            <button
              onClick={() => onPriorityFilterChange(new Set())}
              className="px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Clear priority filter"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Status filter dropdown */}
        <div className="relative flex-shrink-0" ref={statusDropdownRef}>
          <button
            onClick={() => setStatusOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              statusOpen
                ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40"
                : statusFilter.size > 0
                ? "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Layers className="w-3 h-3" />
            <span className="hidden sm:inline">Status</span>
            {statusFilter.size > 0 && (
              <span className="ml-0.5 bg-violet-500/30 text-violet-200 rounded-full px-1.5 text-[10px] font-bold">
                {statusFilter.size}
              </span>
            )}
          </button>

          {statusOpen && (
            <div
              className="absolute left-0 top-full mt-1.5 z-50 w-52 rounded-lg border border-border/60 shadow-xl overflow-hidden"
              style={{ background: "oklch(0.16 0.012 250)" }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
                <span className="text-xs font-semibold text-foreground">Filter by Status</span>
                <div className="flex items-center gap-1">
                  {statusFilter.size > 0 && (
                    <button
                      onClick={() => onStatusFilterChange(new Set())}
                      className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted/50"
                    >
                      Clear
                    </button>
                  )}
                  <button onClick={() => setStatusOpen(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {allStatuses.map((s) => {
                    // Fixed statusCategory mapping for the 6 known statuses
                    const statusCategoryMap: Record<string, string> = {
                      "Backlog": "new",
                      "Triage": "new",
                      "To Do": "new",
                      "Blocked": "indeterminate",
                      "In Progress": "indeterminate",
                      "Closed": "done",
                    };
                    const style = getStatusStyle(statusCategoryMap[s] ?? "new", s);
                    const checked = statusFilter.has(s);
                    return (
                      <label
                        key={s}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStatus(s)}
                          className="w-3.5 h-3.5 rounded accent-violet-500 cursor-pointer"
                        />
                        <span className={`flex items-center gap-1.5 text-xs font-medium ${style.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} />
                          {s}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground/60">
                          {issues.filter((i) => i.status === s).length}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Labels filter dropdown */}
        <div className="relative flex-shrink-0" ref={labelsDropdownRef}>
          <button
            onClick={() => setLabelsOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              labelsOpen
                ? "bg-teal-500/20 text-teal-300 ring-1 ring-teal-500/40"
                : labelsFilter.size > 0
                ? "bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/30"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Tag className="w-3 h-3" />
            <span className="hidden sm:inline">Labels</span>
            {labelsFilter.size > 0 && (
              <span className="ml-0.5 bg-teal-500/30 text-teal-200 rounded-full px-1.5 text-[10px] font-bold">
                {labelsFilter.size}
              </span>
            )}
          </button>

          {labelsOpen && (
            <div
              className="absolute left-0 top-full mt-1.5 z-50 w-52 rounded-lg border border-border/60 shadow-xl overflow-hidden"
              style={{ background: "oklch(0.16 0.012 250)" }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
                <span className="text-xs font-semibold text-foreground">Filter by Label</span>
                <div className="flex items-center gap-1">
                  {labelsFilter.size > 0 && (
                    <button
                      onClick={() => onLabelsFilterChange(new Set())}
                      className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted/50"
                    >
                      Clear
                    </button>
                  )}
                  <button onClick={() => setLabelsOpen(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {allLabels.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 text-center py-4">No labels available</p>
                ) : (
                  allLabels.map((l) => {
                    const checked = labelsFilter.has(l);
                    const count = issues.filter((i) => i.labels.includes(l)).length;
                    return (
                      <label
                        key={l}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLabel(l)}
                          className="w-3.5 h-3.5 rounded accent-teal-500 cursor-pointer"
                        />
                        <span className="text-xs font-medium text-teal-300/90 flex items-center gap-1">
                          <Tag className="w-2.5 h-2.5 opacity-60" />{l}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground/60">{count}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Issue count summary */}
        <span className="text-xs text-muted-foreground ml-2">
          <span className="font-semibold text-foreground">{sorted.length}</span> issue{sorted.length !== 1 ? "s" : ""}
          {daysFilter > 0 && <span className="ml-1 opacity-60">(updated ≤ {daysFilter}d ago)</span>}
        </span>
        {/* Hidden Issues popover + Pin Issue */}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {/* Hidden Issues button */}
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setHiddenOpen((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    hiddenOpen
                      ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/40"
                      : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <EyeOff className="w-3 h-3" />
                  <span className="hidden sm:inline">Hidden</span>
                  {hiddenIssues.length > 0 && (
                    <span className={`ml-0.5 rounded-full px-1.5 text-[10px] font-bold ${
                      hiddenOpen ? "bg-red-500/30 text-red-200" : "bg-muted text-muted-foreground"
                    }`}>
                      {hiddenIssues.length}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>View and restore hidden issues</TooltipContent>
            </Tooltip>

            {/* Hidden issues dropdown panel */}
            {hiddenOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-lg border border-border/60 shadow-xl overflow-hidden"
                style={{ background: "oklch(0.16 0.012 250)" }}
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
                  <span className="text-xs font-semibold text-foreground">Hidden Issues</span>
                  <button onClick={() => setHiddenOpen(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {hiddenIssues.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60 text-center py-6 px-3">
                      No hidden issues for this project
                    </p>
                  ) : (
                    <ul className="py-1">
                      {hiddenIssues.map((h) => (
                        <li key={h.issueKey} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
                          <span className="text-xs font-mono font-semibold text-red-300/80">{h.issueKey}</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => { onUnhideIssue(h.issueKey); }}
                                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Restore</span>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Restore this issue to the table</TooltipContent>
                          </Tooltip>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
          {pinOpen ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="text"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { onPinIssue(pinInput.trim().toUpperCase()); setPinInput(""); setPinOpen(false); }
                  if (e.key === "Escape") { setPinInput(""); setPinOpen(false); }
                }}
                placeholder="e.g. DGTK-123"
                className="px-2.5 py-1 text-xs rounded-md bg-background border border-border/60 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-sky-500/50 w-36"
              />
              <button
                onClick={() => { onPinIssue(pinInput.trim().toUpperCase()); setPinInput(""); setPinOpen(false); }}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 transition-colors flex items-center gap-1"
              >
                <Star className="w-3 h-3" /> Pin
              </button>
              <button onClick={() => { setPinInput(""); setPinOpen(false); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setPinOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Star className="w-3 h-3" />
                  <span className="hidden sm:inline">Pin Issue</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Pin a specific issue to the top</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="w-full border-collapse min-w-[1050px]">
          <thead className="sticky top-0 z-10" style={{ background: "oklch(0.145 0.011 250)" }}>
            <tr className="border-b border-border/60" style={{ borderBottomColor: `${projectColor}30` }}>
              <SortTh field="key" label="Issue" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh field="summary" label="Title" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="min-w-[220px]" />
              <SortTh field="priority" label="Priority" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap min-w-[200px]">Latest Update</th>
              <SortTh field="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh field="assigneeName" label="Assignee" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh field="reporterName" label="Reporter" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh field="updated" label="Updated" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <th className="px-3 py-3 w-8" />
            </tr>
          </thead>
          <tbody>
            {loading && !issues.length && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
            {!loading && sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-16 text-muted-foreground text-sm">
                  <div className="flex flex-col items-center gap-2">
                    <Activity className="w-8 h-8 opacity-30" />
                    <span>
                      {effectiveKeyword
                        ? `No issues match "${effectiveKeyword}"`
                        : "No open issues found"}
                    </span>
                  </div>
                </td>
              </tr>
            )}
            {sorted.map((issue) => {
              const isMe = issue.assigneeId === myAccountId;
              const isWatched = watchedKeys.has(issue.key);
              const statusStyle = getStatusStyle(issue.statusCategory, issue.status);
              const effectivePriority = getEffectivePriority(issue);
              const priorityStyle = getPriorityStyle(effectivePriority);

              return (
                <tr
                  key={issue.key}
                  className={`border-b border-border/30 transition-colors group cursor-pointer ${
                    isWatched
                      ? "bg-sky-500/8 hover:bg-sky-500/12 border-l-2"
                      : isMe
                      ? "bg-amber-500/8 hover:bg-amber-500/12 border-l-2"
                      : "hover:bg-muted/40"
                  }`}
                  style={isWatched ? { borderLeftColor: "oklch(0.65 0.18 230)" } : isMe ? { borderLeftColor: "oklch(0.72 0.18 60)" } : undefined}
                  onClick={() => window.open(issue.url, "_blank")}
                >
                  {/* Issue Key */}
                  <td className={`${tdCls} font-mono`}>
                    <div className="flex items-center gap-2">
                      {isWatched && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Star className="w-3 h-3 text-sky-400 fill-sky-400 flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent>Watched issue</TooltipContent>
                        </Tooltip>
                      )}
                      {!isWatched && isMe && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent>Assigned to you</TooltipContent>
                        </Tooltip>
                      )}
                      <span className="text-xs font-semibold hover:underline" style={{ color: projectColor }}>
                        {issue.key}
                      </span>
                      <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity flex-shrink-0" />
                    </div>
                  </td>

                  {/* Title */}
                  <td className={`${tdCls} max-w-xs`}>
                    <p className={`font-medium text-sm leading-snug line-clamp-2 ${isMe ? "text-amber-100" : "text-foreground"}`}>
                      {issue.summary}
                    </p>
                    {issue.issueType && (
                      <span className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Tag className="w-2.5 h-2.5" />{issue.issueType}
                      </span>
                    )}
                  </td>

                  {/* Priority (Build for KITE) */}
                  <td className={tdCls}>
                    {effectivePriority ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ring-1 ${priorityStyle.bg} ${priorityStyle.text} ${priorityStyle.ring}`}>
                        {effectivePriority}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
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
                    <AvatarCell avatar={issue.assigneeAvatar} name={issue.assigneeName} isMe={isMe} />
                  </td>

                  {/* Reporter */}
                  <td className={tdCls}>
                    <AvatarCell avatar={issue.reporterAvatar} name={issue.reporterName} />
                  </td>

                  {/* Updated */}
                  <td className={tdCls}>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3 flex-shrink-0" />
                      <span>{formatDate(issue.updated)}</span>
                    </div>
                  </td>

                  {/* Hide (×) */}
                  <td className="px-2 py-3 w-8">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => { e.stopPropagation(); onHideIssue(issue.key); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 p-0.5 rounded"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Hide this issue</TooltipContent>
                    </Tooltip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── PinnedIssuesMerger: fetches all pinned issues and reports them up ───────────
// This component exists to legally call hooks per watched key without violating rules-of-hooks.

function SinglePinnedFetcher({ issueKey, onFetched }: { issueKey: string; onFetched: (issue: JiraIssue | null) => void }) {
  const { data } = trpc.jira.issue.useQuery({ issueKey }, { staleTime: 60_000 });
  useEffect(() => {
    onFetched(data?.issue ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.issue?.key, data?.issue?.updated]);
  return null;
}

function PinnedIssuesMerger({ watchedKeys, onUpdate }: { watchedKeys: string[]; onUpdate: (issues: JiraIssue[]) => void }) {
  const [map, setMap] = useState<Record<string, JiraIssue>>({});
  const handleFetched = useCallback((key: string, issue: JiraIssue | null) => {
    setMap((prev) => {
      if (!issue) {
        if (key in prev) { const next = { ...prev }; delete next[key]; return next; }
        return prev;
      }
      if (prev[key]?.updated === issue.updated) return prev;
      return { ...prev, [key]: issue };
    });
  }, []);
  useEffect(() => {
    onUpdate(watchedKeys.map((k) => map[k]).filter((i): i is JiraIssue => !!i));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, watchedKeys.join(",")]);
  return (
    <>
      {watchedKeys.map((key) => (
        <SinglePinnedFetcher key={key} issueKey={key} onFetched={(i) => handleFetched(key, i)} />
      ))}
    </>
  );
}

// ─── PinnedIssueRow: fetches a single issue live from Jira ─────────────────────

function PinnedIssueRow({ issueKey, onRemove }: { issueKey: string; onRemove: () => void }) {
  const { data, isLoading, isError } = trpc.jira.issue.useQuery({ issueKey }, { staleTime: 60_000 });
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-sky-500/10 border border-sky-500/20">
      <div className="flex items-center gap-2 min-w-0">
        <Star className="w-3 h-3 text-sky-400 fill-sky-400 flex-shrink-0" />
        <div className="min-w-0">
          <span className="text-xs font-mono text-sky-300 font-semibold">{issueKey}</span>
          {isLoading && <span className="ml-1.5 text-[10px] text-muted-foreground/50 animate-pulse">loading…</span>}
          {isError && <span className="ml-1.5 text-[10px] text-red-400">not found</span>}
          {data?.issue && (
            <p className="text-[10px] text-muted-foreground/70 truncate max-w-[130px] mt-0.5 leading-tight">
              {data.issue.summary}
            </p>
          )}
        </div>
      </div>
      <button onClick={onRemove} className="text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0">
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Watch List Panel ──────────────────────────────────────────────────────────

function WatchListPanel({ activeProjectKey }: { activeProjectKey: string }) {
  const utils = trpc.useUtils();
  const [watchInput, setWatchInput] = useState("");
  const [hideInput, setHideInput] = useState("");
  const [tab, setTab] = useState<"watch" | "hide">("watch");

  const { data: watchedData } = trpc.watchlist.list.useQuery();
  const { data: hiddenData } = trpc.hidden.list.useQuery();

  const addWatch = trpc.watchlist.add.useMutation({
    onSuccess: () => { utils.watchlist.list.invalidate(); toast.success("Issue pinned to watch list"); setWatchInput(""); },
    onError: (e) => toast.error(e.message),
  });
  const removeWatch = trpc.watchlist.remove.useMutation({
    onSuccess: () => { utils.watchlist.list.invalidate(); utils.jira.issue.invalidate(); toast.success("Removed from watch list"); },
  });
  const addHide = trpc.hidden.add.useMutation({
    onSuccess: () => { utils.hidden.list.invalidate(); toast.success("Issue hidden"); setHideInput(""); },
    onError: (e) => toast.error(e.message),
  });
  const removeHide = trpc.hidden.remove.useMutation({
    onSuccess: () => { utils.hidden.list.invalidate(); toast.success("Issue unhidden"); },
  });

  const handleAddWatch = () => {
    const key = watchInput.trim().toUpperCase();
    if (!key) return;
    const inferredProject = key.includes("-") ? key.split("-")[0] : activeProjectKey;
    addWatch.mutate({ issueKey: key, projectKey: inferredProject });
  };

  const handleAddHide = () => {
    const key = hideInput.trim().toUpperCase();
    if (!key) return;
    const inferredProject = key.includes("-") ? key.split("-")[0] : activeProjectKey;
    addHide.mutate({ issueKey: key, projectKey: inferredProject });
  };

  const watched = watchedData ?? [];
  const hidden = hiddenData ?? [];

  return (
    <div className="border-t border-border/60 flex flex-col" style={{ background: "oklch(0.13 0.01 250)" }}>
      {/* Tab header */}
      <div className="flex items-center px-3 pt-3 pb-0 gap-1">
        <button
          onClick={() => setTab("watch")}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-t text-xs font-medium transition-colors ${
            tab === "watch" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Star className="w-3 h-3" />
          Pinned
          {watched.length > 0 && <span className="ml-0.5 bg-sky-500/20 text-sky-400 rounded-full px-1.5 py-0 text-[10px] font-bold">{watched.length}</span>}
        </button>
        <button
          onClick={() => setTab("hide")}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-t text-xs font-medium transition-colors ${
            tab === "hide" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <EyeOff className="w-3 h-3" />
          Hidden
          {hidden.length > 0 && <span className="ml-0.5 bg-red-500/20 text-red-400 rounded-full px-1.5 py-0 text-[10px] font-bold">{hidden.length}</span>}
        </button>
      </div>

      <div className="px-3 pb-3 bg-muted/30 rounded-b">
        {/* Input row */}
        <div className="flex gap-1.5 mt-2 mb-2">
          <input
            type="text"
            value={tab === "watch" ? watchInput : hideInput}
            onChange={(e) => tab === "watch" ? setWatchInput(e.target.value) : setHideInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") tab === "watch" ? handleAddWatch() : handleAddHide(); }}
            placeholder={tab === "watch" ? "Pin issue, e.g. DGTK-123" : "Hide issue, e.g. DGTK-456"}
            className="flex-1 px-2.5 py-1.5 text-xs rounded bg-background border border-border/60 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button
            onClick={tab === "watch" ? handleAddWatch : handleAddHide}
            disabled={tab === "watch" ? addWatch.isPending : addHide.isPending}
            className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
              tab === "watch"
                ? "bg-sky-500/20 text-sky-400 hover:bg-sky-500/30"
                : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
            }`}
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>

        {/* List */}
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {tab === "watch" && watched.length === 0 && (
            <p className="text-xs text-muted-foreground/50 text-center py-2">No pinned issues</p>
          )}
          {tab === "hide" && hidden.length === 0 && (
            <p className="text-xs text-muted-foreground/50 text-center py-2">No hidden issues</p>
          )}
          {tab === "watch" && watched.map((w) => (
            <PinnedIssueRow
              key={w.issueKey}
              issueKey={w.issueKey}
              onRemove={() => removeWatch.mutate({ issueKey: w.issueKey })}
            />
          ))}
          {tab === "hide" && hidden.map((h) => (
            <div key={h.issueKey} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-red-500/8 border border-red-500/20">
              <span className="text-xs font-mono text-red-300 font-semibold">{h.issueKey}</span>
              <button
                onClick={() => removeHide.mutate({ issueKey: h.issueKey })}
                className="text-muted-foreground hover:text-emerald-400 transition-colors"
                title="Unhide"
              >
                <Eye className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>
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

  // Auto-refresh interval in minutes (0 = disabled). Persisted in localStorage.
  const [refreshInterval, setRefreshInterval] = useState<number>(() => {
    const saved = localStorage.getItem("jira-monitor-refresh-interval");
    return saved !== null ? Math.max(0, parseInt(saved, 10) || 0) : 3;
  });
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState<number>(0); // seconds until next refresh
  // Snapshot of previous issues for change detection
  const prevIssuesRef = useRef<JiraIssue[]>([]);
  const [myIssuesOnly, setMyIssuesOnly] = useState(true);

  // All filter state lives at Dashboard level and is passed to the server-side query
  const ALL_STATUSES = ["Backlog", "Triage", "To Do", "Blocked", "In Progress", "Closed"] as const;
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(["Triage", "In Progress"]));
  const statusFilterArray = useMemo(() => Array.from(statusFilter), [statusFilter]);

  // Labels filter: default = "SW"
  const [labelsFilter, setLabelsFilter] = useState<Set<string>>(new Set(["SW"]));
  const labelsFilterArray = useMemo(() => Array.from(labelsFilter), [labelsFilter]);

  // Priority filter: empty = All
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(new Set());
  const priorityFilterArray = useMemo(() => Array.from(priorityFilter), [priorityFilter]);

  // Updated-within-days filter: 30 = last 30 days, 0 = all time
  const [daysFilter, setDaysFilter] = useState<number>(30);

  // Stage preset (for JQL summary~ filter) and custom keyword (client-side only)
  const [stagePreset, setStagePreset] = useState<StagePreset>("All");
  const [stageKeyword, setStageKeyword] = useState("");

  const {
    data: issueData,
    isLoading: issuesLoading,
    refetch,
    isFetching,
  } = trpc.jira.issues.useQuery(
    {
      projectKey: activeKey,
      myIssues: myIssuesOnly,
      statusFilter: statusFilterArray,
      labelsFilter: labelsFilterArray,
      priorityFilter: priorityFilterArray,
      updatedWithinDays: daysFilter,
      stageKeyword: stageKeyword,
    },
    { enabled: !!activeKey, staleTime: 60_000 }
  );

  // Request browser notification permission
  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  }, []);

  // Detect changes between previous and new issues, fire browser notifications
  const detectAndNotify = useCallback((newIssues: JiraIssue[]) => {
    const prev = prevIssuesRef.current;
    if (prev.length === 0) {
      prevIssuesRef.current = newIssues;
      return;
    }
    const prevMap = new Map<string, JiraIssue>(prev.map((i) => [i.key, i]));
    const changes: string[] = [];

    for (const issue of newIssues) {
      const old = prevMap.get(issue.key);
      if (!old) {
        changes.push(`${issue.key}: New issue added — ${issue.summary.slice(0, 60)}`);
        continue;
      }
      if (old.status !== issue.status) {
        changes.push(`${issue.key}: Status changed ${old.status} → ${issue.status}`);
      }
      if (old.latestCommentDate !== issue.latestCommentDate && issue.latestCommentDate) {
        const author = issue.latestCommentAuthor ?? "Someone";
        changes.push(`${issue.key}: New comment by ${author}`);
      }
      if (old.assigneeId !== issue.assigneeId) {
        const name = issue.assigneeName ?? "Unassigned";
        changes.push(`${issue.key}: Assignee changed to ${name}`);
      }
    }

    prevIssuesRef.current = newIssues;

    if (changes.length === 0) return;

    // Show toast for all changes
    changes.forEach((msg) => toast.info(msg, { duration: 6000 }));

    // Show browser notification only when tab is not focused
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      const title = `Jira Monitor: ${changes.length} update${changes.length > 1 ? "s" : ""}`;
      const body = changes.slice(0, 3).join("\n") + (changes.length > 3 ? `\n...and ${changes.length - 3} more` : "");
      new Notification(title, { body, icon: "/favicon.ico" });
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    const result = await refetch();
    setLastRefresh(new Date());
    if (result.data?.issues) {
      detectAndNotify(result.data.issues);
    }
  }, [refetch, detectAndNotify]);

  // Auto-refresh timer
  useEffect(() => {
    if (refreshInterval <= 0) {
      setCountdown(0);
      return;
    }
    const totalSeconds = refreshInterval * 60;
    setCountdown(totalSeconds);
    const tick = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          handleRefresh();
          return totalSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [refreshInterval, handleRefresh]);

  // Persist refreshInterval to localStorage
  useEffect(() => {
    localStorage.setItem("jira-monitor-refresh-interval", String(refreshInterval));
  }, [refreshInterval]);

  // Request notification permission when auto-refresh is enabled
  useEffect(() => {
    if (refreshInterval > 0) requestNotificationPermission();
  }, [refreshInterval, requestNotificationPermission]);

  const { data: watchedData } = trpc.watchlist.list.useQuery();
  const { data: hiddenData } = trpc.hidden.list.useQuery();
  const watchedKeys = useMemo(() => new Set((watchedData ?? []).map((w) => w.issueKey)), [watchedData]);
  const hiddenKeys = useMemo(() => new Set((hiddenData ?? []).map((h) => h.issueKey)), [hiddenData]);

  const rawIssues = issueData?.issues ?? [];
  const issueError = issueData?.error ?? null;

  // pinnedIssues state is populated by PinnedIssuesMerger child component
  const [pinnedIssues, setPinnedIssues] = useState<JiraIssue[]>([]);

  // Merge pinned issues into the list: pinned first (even if not in open list), then rest minus hidden
  const issues = useMemo(() => {
    const rawKeysInList = new Set(rawIssues.map((i) => i.key));
    const extraPinned = pinnedIssues.filter((i) => !rawKeysInList.has(i.key) && !hiddenKeys.has(i.key));
    const visible = rawIssues.filter((i) => !hiddenKeys.has(i.key));
    const watchedInList = visible.filter((i) => watchedKeys.has(i.key));
    const rest = visible.filter((i) => !watchedKeys.has(i.key));
    return [...extraPinned, ...watchedInList, ...rest];
  }, [rawIssues, pinnedIssues, watchedKeys, hiddenKeys]);

  const myIssueCount = issues.filter((i) => i.assigneeId === myAccountId).length;

  const utils = trpc.useUtils();
  const addHide = trpc.hidden.add.useMutation({
    onSuccess: () => { utils.hidden.list.invalidate(); toast.success("Issue hidden"); },
    onError: (e) => toast.error(e.message),
  });
  const removeHide = trpc.hidden.remove.useMutation({
    onSuccess: () => { utils.hidden.list.invalidate(); toast.success("Issue restored"); },
    onError: (e) => toast.error(e.message),
  });
  const addWatch = trpc.watchlist.add.useMutation({
    onSuccess: () => { utils.watchlist.list.invalidate(); toast.success("Issue pinned"); },
    onError: (e) => toast.error(e.message),
  });

  const handleHideIssue = useCallback((key: string) => {
    if (!key) return;
    const projectKey = key.includes("-") ? key.split("-")[0] : activeKey;
    addHide.mutate({ issueKey: key, projectKey });
  }, [addHide, activeKey]);

  const handleUnhideIssue = useCallback((key: string) => {
    removeHide.mutate({ issueKey: key });
  }, [removeHide]);

  // Hidden issues scoped to the active project
  const projectHiddenIssues = useMemo(
    () => (hiddenData ?? []).filter((h) => h.projectKey === activeKey),
    [hiddenData, activeKey]
  );

  const handlePinIssue = useCallback((key: string) => {
    if (!key) return;
    const projectKey = key.includes("-") ? key.split("-")[0] : activeKey;
    addWatch.mutate({ issueKey: key, projectKey });
  }, [addWatch, activeKey]);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Invisible component that fetches pinned issues and merges them into the table */}
      <PinnedIssuesMerger
        watchedKeys={Array.from(watchedKeys)}
        onUpdate={setPinnedIssues}
      />
      {/* ── Sidebar ── */}
      <aside className="w-64 flex-shrink-0 border-r border-border/60 flex flex-col"
        style={{ background: "oklch(0.14 0.012 250)" }}>
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
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: project.color ?? "#6366f1" }} />
                <span className="flex-1 text-left truncate">{project.name}</span>
                <span className="text-xs font-mono opacity-50">{project.key}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-border/60">
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
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: activeProject.color ?? "#6366f1" }} />
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
              {/* Auto-refresh interval control */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                    refreshInterval > 0 ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}>
                    <Zap className="w-3 h-3 flex-shrink-0" />
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={refreshInterval}
                      onChange={(e) => setRefreshInterval(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-7 bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="hidden sm:inline">min</span>
                    {refreshInterval > 0 && countdown > 0 && (
                      <span className="text-[10px] opacity-70 hidden sm:inline">
                        ({Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")})
                      </span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {refreshInterval > 0
                    ? `Auto-refresh every ${refreshInterval} min — next in ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")}`
                    : "Set minutes for auto-refresh (0 = disabled)"}
                </TooltipContent>
              </Tooltip>
              <Button
                variant="outline" size="sm"
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

        {/* Issue Table (includes filter bar internally) */}
        <div className="flex-1 overflow-hidden flex flex-col">
           <IssueTable
             issues={issues}
             loading={issuesLoading}
             error={issueError}
             myAccountId={myAccountId}
             projectColor={activeProject?.color ?? "#6366f1"}
             projectKey={activeKey}
             watchedKeys={watchedKeys}
             activeProjectKey={activeKey}
             onHideIssue={handleHideIssue}
             onPinIssue={handlePinIssue}
             myIssuesOnly={myIssuesOnly}
             onToggleMyIssues={() => setMyIssuesOnly((v) => !v)}
             hiddenIssues={projectHiddenIssues}
             onUnhideIssue={handleUnhideIssue}
             statusFilter={statusFilter}
             onStatusFilterChange={setStatusFilter}
             allStatuses={ALL_STATUSES as unknown as string[]}
             labelsFilter={labelsFilter}
             onLabelsFilterChange={setLabelsFilter}
             priorityFilter={priorityFilter}
             onPriorityFilterChange={setPriorityFilter}
             daysFilter={daysFilter}
             onDaysFilterChange={setDaysFilter}
             stagePreset={stagePreset}
             onStagePresetChange={setStagePreset}
             stageKeyword={stageKeyword}
             onStageKeywordChange={setStageKeyword}
           />
        </div>

        {/* Footer */}
        <footer className="flex-shrink-0 border-t border-border/40 px-6 py-2.5 flex items-center justify-between">
          <p className="text-xs text-muted-foreground/60 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400/80" />
            Highlighted rows are assigned to you
          </p>
          <p className="text-xs text-muted-foreground/40">Click any row to open in Jira</p>
        </footer>
      </main>
    </div>
  );
}
