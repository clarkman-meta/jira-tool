import axios from "axios";

const JIRA_BASE_URL = process.env.JIRA_BASE_URL ?? "https://metarl.atlassian.net";
const JIRA_EMAIL = process.env.JIRA_EMAIL ?? "";
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN ?? "";

const authHeader = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64")}`;

const jiraClient = axios.create({
  baseURL: JIRA_BASE_URL,
  headers: {
    Authorization: authHeader,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

// ─── ADF (Atlassian Document Format) → plain text ─────────────────────────────

function adfToText(node: unknown, depth = 0): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;

  if (n.type === "text" && typeof n.text === "string") {
    return n.text;
  }

  if (n.type === "mention" && n.attrs && typeof n.attrs === "object") {
    const attrs = n.attrs as Record<string, unknown>;
    return typeof attrs.text === "string" ? attrs.text : "";
  }

  if (Array.isArray(n.content)) {
    const parts = (n.content as unknown[]).map((c) => adfToText(c, depth + 1));
    const joined = parts.join("");
    if (depth > 0 && ["paragraph", "heading", "listItem", "bulletList", "orderedList"].includes(n.type as string)) {
      return joined + "\n";
    }
    return joined;
  }

  return "";
}

// ─── ADF: check if a node contains a mention of a specific accountId ──────────

function adfHasMention(node: unknown, accountId: string): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as Record<string, unknown>;
  if (n.type === "mention" && n.attrs && typeof n.attrs === "object") {
    const attrs = n.attrs as Record<string, unknown>;
    if (attrs.id === accountId) return true;
  }
  if (Array.isArray(n.content)) {
    return (n.content as unknown[]).some((c) => adfHasMention(c, accountId));
  }
  return false;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory: string; // "new" | "indeterminate" | "done"
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
  build: string | null;  // customfield_10433 — used as priority in KITE
  issueType: string | null;
  labels: string[];  // Jira labels array
  url: string;
  // Prefetched comment data from search/jql response (up to 20 comments per issue).
  // Used by enrichWithCommentInvolvement for zero-API-call involvement detection.
  prefetchedCommentAuthorIds: string[];  // accountId of each returned comment author
  prefetchedCommentMentionIds: string[]; // accountId of each @mention found in returned comments
  commentTotal: number;                  // total comment count reported by Jira (may exceed returned)
}

// ─── Map a raw Jira API issue to our JiraIssue type ───────────────────────────

function mapIssue(raw: unknown, baseUrl: string): JiraIssue {
  const issue = raw as Record<string, unknown>;
  const fields = issue.fields as Record<string, unknown>;

  // Status
  const statusObj = fields.status as Record<string, unknown> | null;
  const statusName = (statusObj?.name as string) ?? "Unknown";
  const statusCat = ((statusObj?.statusCategory as Record<string, unknown>)?.key as string) ?? "new";

  // Assignee
  const assigneeObj = fields.assignee as Record<string, unknown> | null;
  const assigneeId = (assigneeObj?.accountId as string) ?? null;
  const assigneeName = (assigneeObj?.displayName as string) ?? null;
  const assigneeAvatar = assigneeObj
    ? ((assigneeObj.avatarUrls as Record<string, string>)?.["24x24"] ?? null)
    : null;

  // Latest comment + prefetched comment data for involvement detection
  const commentObj = fields.comment as Record<string, unknown> | null;
  const comments = (commentObj?.comments as unknown[]) ?? [];
  const commentTotal = (commentObj?.total as number) ?? comments.length;
  let latestComment: string | null = null;
  let latestCommentAuthor: string | null = null;
  let latestCommentDate: string | null = null;
  const prefetchedCommentAuthorIds: string[] = [];
  const prefetchedCommentMentionIds: string[] = [];

  for (const raw of comments) {
    const c = raw as Record<string, unknown>;
    const author = c.author as Record<string, unknown> | null;
    const authorId = (author?.accountId as string) ?? null;
    if (authorId) prefetchedCommentAuthorIds.push(authorId);
    if (c.body) {
      const collectMentions = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        const n = node as Record<string, unknown>;
        if (n.type === "mention" && n.attrs && typeof n.attrs === "object") {
          const attrs = n.attrs as Record<string, unknown>;
          if (typeof attrs.id === "string") prefetchedCommentMentionIds.push(attrs.id);
        }
        if (Array.isArray(n.content)) (n.content as unknown[]).forEach(collectMentions);
      };
      collectMentions(c.body);
    }
  }

  if (comments.length > 0) {
    const last = comments[comments.length - 1] as Record<string, unknown>;
    const body = last.body as Record<string, unknown> | null;
    latestComment = body ? adfToText(body).trim().slice(0, 300) : null;
    const author = last.author as Record<string, unknown> | null;
    latestCommentAuthor = (author?.displayName as string) ?? null;
    latestCommentDate = (last.updated as string) ?? (last.created as string) ?? null;
  }

  // Priority
  const priorityObj = fields.priority as Record<string, unknown> | null;
  const priority = (priorityObj?.name as string) ?? null;

  // Issue type
  const issueTypeObj = fields.issuetype as Record<string, unknown> | null;
  const issueType = (issueTypeObj?.name as string) ?? null;

  // Build (customfield_10433) — used as priority substitute in KITE project
  const buildObj = fields.customfield_10433 as Record<string, unknown> | null;
  const build = (buildObj?.value as string) ?? null;

  // Labels
  const labels = Array.isArray(fields.labels) ? (fields.labels as string[]) : [];

  // Reporter
  const reporterObj = fields.reporter as Record<string, unknown> | null;
  const reporterId = (reporterObj?.accountId as string) ?? null;
  const reporterName = (reporterObj?.displayName as string) ?? null;
  const reporterAvatar = reporterObj
    ? ((reporterObj.avatarUrls as Record<string, string>)?.["24x24"] ?? null)
    : null;

  return {
    key: issue.key as string,
    summary: (fields.summary as string) ?? "",
    status: statusName,
    statusCategory: statusCat,
    assigneeId,
    assigneeName,
    assigneeAvatar,
    reporterId,
    reporterName,
    reporterAvatar,
    latestComment,
    latestCommentAuthor,
    latestCommentDate,
    updated: fields.updated as string,
    priority,
    build,
    issueType,
    labels,
    url: `${baseUrl}/browse/${issue.key}`,
    prefetchedCommentAuthorIds,
    prefetchedCommentMentionIds,
    commentTotal,
  };
}

// ─── Strip hardcoded status/statusCategory exclusions from customJql ─────────
// When the user provides an explicit statusFilter, we must remove any conflicting
// hardcoded clauses from customJql so the user-controlled filter wins.

// Extract ORDER BY clause from JQL, returning [jqlWithoutOrderBy, orderByClause]
function extractOrderBy(jql: string): [string, string] {
  const match = jql.match(/(.*?)\s*(ORDER\s+BY\s+[\s\S]+)$/i);
  if (match) {
    return [match[1].trim(), match[2].trim()];
  }
  return [jql.trim(), ""];
}

function stripStatusClauses(jql: string): string {
  // Remove: statusCategory != Done  /  statusCategory != "Done"
  let result = jql.replace(/\bstatusCategory\s*!=\s*["']?Done["']?/gi, "");
  // Remove: status != Closed  /  status != "Closed"
  result = result.replace(/\bstatus\s*!=\s*["']?Closed["']?/gi, "");
  // Remove: status NOT IN (...)  — handles any values inside
  result = result.replace(/\bstatus\s+NOT\s+IN\s*\([^)]*\)/gi, "");
  // Remove: statusCategory NOT IN (...)
  result = result.replace(/\bstatusCategory\s+NOT\s+IN\s*\([^)]*\)/gi, "");
  // Clean up dangling AND/OR connectors left by removal
  result = result.replace(/\bAND\s+AND\b/gi, "AND");
  result = result.replace(/\bAND\s+ORDER\s+BY\b/gi, "ORDER BY");
  result = result.replace(/\bAND\s*$/i, "");
  result = result.replace(/^\s*AND\b/i, "");
  result = result.replace(/\bOR\s+OR\b/gi, "OR");
  return result.trim();
}

// ─── Normalise priority label → Jira priority name ────────────────────────────
// UI uses p0/p1/p2; Jira stores "Highest", "High", "Medium", "Low", "Lowest"
function normalisePriorityToJira(p: string): string[] {
  switch (p.toLowerCase()) {
    case "p0": return ["Highest", "Blocker"];
    case "p1": return ["High"];
    case "p2": return ["Medium"];
    case "p3": return ["Low"];
    case "p4": return ["Lowest"];
    default:   return [p]; // pass-through for raw Jira names
  }
}

// ─── Fetch ALL open issues for a project (cursor-based pagination) ────────────

export interface FetchOpenIssuesOptions {
  issueTypeFilter?: string | null;
  customJql?: string | null;
  statusFilter?: string[] | null;
  labelsFilter?: string[] | null;       // e.g. ["SW", "HW"]
  priorityFilter?: string[] | null;     // e.g. ["p0", "p1"] (UI notation)
  updatedWithinDays?: number | null;    // e.g. 30 → updated >= -30d
  stageKeyword?: string | null;         // e.g. "EVT" → summary ~ "EVT"
  myAccountId?: string | null;          // when set with involvementMode, adds JQL clause
  involvementMode?: "confirmed" | "unconfirmed" | null;
  // "confirmed"   → AND (assignee = me OR reporter = me OR watcher = me)
  // "unconfirmed" → AND NOT (assignee = me OR reporter = me OR watcher = me)
  // null/undefined → no involvement clause (fetch all)
  titleFilter?: string | null;          // comma-separated keywords → summary ~ "kw1" OR summary ~ "kw2"
}

export async function fetchOpenIssues(
  projectKey: string,
  _maxResults = 100,
  issueTypeFilter?: string | null,
  customJql?: string | null,
  statusFilter?: string[] | null,
  opts?: FetchOpenIssuesOptions,
): Promise<JiraIssue[]> {
  // Merge legacy positional params with opts for backward compat
  const effectiveOpts: FetchOpenIssuesOptions = {
    issueTypeFilter: issueTypeFilter ?? opts?.issueTypeFilter,
    customJql: customJql ?? opts?.customJql,
    statusFilter: statusFilter ?? opts?.statusFilter,
    labelsFilter: opts?.labelsFilter,
    priorityFilter: opts?.priorityFilter,
    updatedWithinDays: opts?.updatedWithinDays,
    stageKeyword: opts?.stageKeyword,
    myAccountId: opts?.myAccountId,
    involvementMode: opts?.involvementMode,
    titleFilter: opts?.titleFilter,
  };

  // ── Build JQL base (without ORDER BY) ──
  let jqlBase: string;
  let orderBy = "ORDER BY updated DESC"; // default

  if (effectiveOpts.customJql && effectiveOpts.customJql.trim()) {
    // Extract ORDER BY from customJql so we can re-attach it after all filters
    let [base, existingOrderBy] = extractOrderBy(effectiveOpts.customJql.trim());
    if (existingOrderBy) orderBy = existingOrderBy;

    if (effectiveOpts.statusFilter && effectiveOpts.statusFilter.length > 0) {
      // User-controlled status filter wins: strip hardcoded status exclusions from base
      base = stripStatusClauses(base);
      const statusList = effectiveOpts.statusFilter.map((s) => `"${s}"`).join(", ");
      base += ` AND status IN (${statusList})`;
    }
    jqlBase = base;
  } else {
    jqlBase = `project = ${projectKey}`;
    if (effectiveOpts.issueTypeFilter) {
      const types = effectiveOpts.issueTypeFilter.split(",").map((t) => t.trim()).filter(Boolean);
      if (types.length > 0) {
        const typeList = types.map((t) => `"${t}"`).join(", ");
        jqlBase += ` AND issuetype IN (${typeList})`;
      }
    }
    if (effectiveOpts.statusFilter && effectiveOpts.statusFilter.length > 0) {
      const statusList = effectiveOpts.statusFilter.map((s) => `"${s}"`).join(", ");
      jqlBase += ` AND status IN (${statusList})`;
    }
  }

  // ── Apply additional server-side filters (always appended before ORDER BY) ──

  // Labels filter
  if (effectiveOpts.labelsFilter && effectiveOpts.labelsFilter.length > 0) {
    const labelList = effectiveOpts.labelsFilter.map((l) => `"${l}"`).join(", ");
    jqlBase += ` AND labels IN (${labelList})`;
  }

  // Priority filter (UI notation → Jira names)
  if (effectiveOpts.priorityFilter && effectiveOpts.priorityFilter.length > 0) {
    const jiraNames = effectiveOpts.priorityFilter.flatMap(normalisePriorityToJira);
    const priorityList = Array.from(new Set(jiraNames)).map((p) => `"${p}"`).join(", ");
    jqlBase += ` AND priority IN (${priorityList})`;
  }

  // Updated-within-days filter
  // Jira JQL requires the relative date in quotes: updated >= "-30d"
  if (effectiveOpts.updatedWithinDays && effectiveOpts.updatedWithinDays > 0) {
    jqlBase += ` AND updated >= "-${effectiveOpts.updatedWithinDays}d"`;
  }

  // Stage / keyword filter (summary contains)
  if (effectiveOpts.stageKeyword && effectiveOpts.stageKeyword.trim()) {
    jqlBase += ` AND summary ~ "${effectiveOpts.stageKeyword.trim()}"`;
  }

  // Title filter: comma-separated keywords → summary ~ "kw1" OR summary ~ "kw2"
  // Only applied when no customJql is set (customJql projects already have their own summary filter)
  if (!effectiveOpts.customJql && effectiveOpts.titleFilter && effectiveOpts.titleFilter.trim()) {
    const kws = effectiveOpts.titleFilter.split(",").map((k) => k.trim()).filter(Boolean);
    if (kws.length > 0) {
      const clause = kws.map((k) => `summary ~ "${k}"`).join(" OR ");
      jqlBase += ` AND (${clause})`;
    }
  }

  // My Issues involvement filter (two-query strategy):
  // Query A (involvementMode="confirmed"):
  //   AND (assignee = accountId OR reporter = accountId OR watcher = accountId)
  //   → Jira server confirms involvement directly, 0 comment API calls needed.
  // Query B (involvementMode="unconfirmed"):
  //   AND NOT (assignee = accountId OR reporter = accountId)
  //   AND (watcher is EMPTY OR NOT watcher = accountId)
  //   → Issues where Clark is NOT assignee/reporter AND is NOT a watcher.
  //
  //   WHY THIS FORM FOR WATCHER:
  //   Jira Cloud treats `watcher` as a multi-value field. `NOT watcher = X` only matches issues
  //   that HAVE at least one watcher AND that watcher is not X. Issues with 0 watchers are
  //   silently excluded by `NOT watcher = X`. The correct form is:
  //     (watcher is EMPTY OR NOT watcher = X)
  //   which explicitly includes the 0-watcher case.
  //   Verified: base=100 issues, watcher is EMPTY=71 issues, NOT watcher=30 issues (71+30=101 overlap=1).
  //
  // NOTE: "comment author" cannot be queried via JQL in Jira Cloud (no ScriptRunner).
  //   comment ~ accountId searches body TEXT, not ADF node accountId — unreliable.
  //   Therefore comment authorship must be verified via comment API scan (routers.ts).
  if (effectiveOpts.myAccountId && effectiveOpts.involvementMode) {
    const id = effectiveOpts.myAccountId;
    if (effectiveOpts.involvementMode === "confirmed") {
      // Query A: confirmed involvement via assignee, reporter, or watcher
      jqlBase += ` AND (assignee = "${id}" OR reporter = "${id}" OR watcher = "${id}")`;
    } else if (effectiveOpts.involvementMode === "unconfirmed") {
      // Query B: not assignee/reporter AND not watcher (using EMPTY-safe form)
      jqlBase += ` AND NOT (assignee = "${id}" OR reporter = "${id}") AND (watcher is EMPTY OR NOT watcher = "${id}")`;
    }
  }

  // Re-attach ORDER BY at the very end
  const jql = `${jqlBase.trim()} ${orderBy}`;
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50; // safety cap: 50 × 100 = 5000 issues max
  const fields = ["summary", "status", "assignee", "reporter", "updated", "comment", "priority", "issuetype", "customfield_10433", "labels"];

  const allIssues: JiraIssue[] = [];
  let nextPageToken: string | undefined = undefined;
  let pageCount = 0;

  console.log(`[Jira] JQL for ${projectKey}:`, jql);  // DEBUG: remove after verification

  do {
    const body: Record<string, unknown> = { jql, maxResults: PAGE_SIZE, fields };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const response = await jiraClient.post("/rest/api/3/search/jql", body);
    const data = response.data as { issues: unknown[]; nextPageToken?: string; isLast?: boolean };

    const mapped = (data.issues ?? []).map((raw) => mapIssue(raw, JIRA_BASE_URL));
    allIssues.push(...mapped);

    // Continue only when isLast is explicitly false and a token exists
    nextPageToken = (data.isLast === false && data.nextPageToken) ? data.nextPageToken : undefined;
    pageCount++;
  } while (nextPageToken && pageCount < MAX_PAGES);

  console.log(`[Jira] ${projectKey}: fetched ${allIssues.length} issues (${pageCount} page(s)) with server-side filters`);  // DEBUG
  return allIssues;
}

// ─── Batch-check comments for a list of issue keys (API fallback for truncated issues) ────
// Fetches comments starting at `startAt` (to skip already-scanned prefetched comments).
// Returns a Set of issue keys where the user is a commenter OR was mentioned.
// Concurrency-limited (default 8) to avoid hammering the Jira API.
async function fetchCommentInvolvement(
  issueKeys: string[],
  accountId: string,
  startAt = 0,
  concurrency = 8,
): Promise<Set<string>> {
  const involved = new Set<string>();
  for (let i = 0; i < issueKeys.length; i += concurrency) {
    const batch = issueKeys.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (key) => {
        try {
          const resp = await jiraClient.get(`/rest/api/3/issue/${key}/comment`, {
            params: { maxResults: 100, startAt, orderBy: "-created" },
          });
          const data = resp.data as { comments: unknown[] };
          for (const raw of data.comments ?? []) {
            const c = raw as Record<string, unknown>;
            const author = c.author as Record<string, unknown> | null;
            if (author?.accountId === accountId) {
              involved.add(key);
              return;
            }
            if (c.body && adfHasMention(c.body, accountId)) {
              involved.add(key);
              return;
            }
          }
        } catch {
          // Ignore errors for individual issues (e.g. permission denied)
        }
      })
    );
  }
  return involved;
}

// ─── Enrich involvement set with commenter/mentioned issues ──────────────────
// Strategy (two-pass, minimal API calls):
//
// Pass 1 — scan prefetched comments (already in JiraIssue from search/jql, up to 20 per issue):
//   - Found involvement → add to involvedKeys immediately, done for this issue.
//   - Not found AND commentTotal > prefetchedCount → queue for API fallback.
//   - Not found AND commentTotal <= prefetchedCount → all comments in prefetch, confirmed not involved.
//
// Pass 2 — API fallback for truncated issues only (rare: >20 comments):
//   - Fetch comments starting at prefetchedCount (skip already-scanned ones).
//   - Same author/mention check.
//
// Result: zero extra API calls in the common case (<=20 comments per issue).
export async function enrichWithCommentInvolvement(
  candidates: JiraIssue[],
  accountId: string,
  involvedKeys: Set<string>,
): Promise<Set<string>> {
  // Pass 1: scan prefetched comments
  const needApiCheck: Array<{ key: string; startAt: number }> = [];

  for (const issue of candidates) {
    if (involvedKeys.has(issue.key)) continue;

    const prefetchedCount = issue.prefetchedCommentAuthorIds.length;
    const foundInPrefetch =
      issue.prefetchedCommentAuthorIds.includes(accountId) ||
      issue.prefetchedCommentMentionIds.includes(accountId);

    if (foundInPrefetch) {
      // Found in prefetch — no API call needed
      involvedKeys.add(issue.key);
    } else if (issue.commentTotal > prefetchedCount) {
      // Prefetch was truncated; older comments not yet scanned — queue for API
      needApiCheck.push({ key: issue.key, startAt: prefetchedCount });
    }
    // else: all comments were in prefetch and user not found — confirmed not involved
  }

  // Pass 2: API fallback for truncated issues
  if (needApiCheck.length > 0) {
    console.log(`[Jira] enrichWithCommentInvolvement: ${needApiCheck.length} issue(s) need API fallback (truncated comments)`);
    const byStartAt = new Map<number, string[]>();
    for (const { key, startAt } of needApiCheck) {
      if (!byStartAt.has(startAt)) byStartAt.set(startAt, []);
      byStartAt.get(startAt)!.push(key);
    }
    for (const [startAt, keys] of Array.from(byStartAt.entries())) {
      const commentInvolved = await fetchCommentInvolvement(keys, accountId, startAt);
      Array.from(commentInvolved).forEach((key) => involvedKeys.add(key));
    }
  }

  return involvedKeys;
}

// ─── Fetch a single issue by key ─────────────────────────────────────────────

export async function fetchSingleIssue(issueKey: string): Promise<JiraIssue> {
  const fields = ["summary", "status", "assignee", "reporter", "updated", "comment", "priority", "issuetype", "customfield_10433", "labels"];
  const response = await jiraClient.get(`/rest/api/3/issue/${issueKey}`, { params: { fields: fields.join(",") } });
  return mapIssue(response.data, JIRA_BASE_URL);
}

// ─── Validate credentials ──────────────────────────────────────────────────────

export async function validateJiraCredentials(): Promise<boolean> {
  try {
    await jiraClient.get("/rest/api/3/myself");
    return true;
  } catch {
    return false;
  }
}
