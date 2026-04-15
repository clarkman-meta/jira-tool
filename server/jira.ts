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

  // Latest comment
  const commentObj = fields.comment as Record<string, unknown> | null;
  const comments = (commentObj?.comments as unknown[]) ?? [];
  let latestComment: string | null = null;
  let latestCommentAuthor: string | null = null;
  let latestCommentDate: string | null = null;

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
  };
}

// ─── Strip hardcoded status/statusCategory exclusions from customJql ─────────
// When the user provides an explicit statusFilter, we must remove any conflicting
// hardcoded clauses from customJql so the user-controlled filter wins.

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
  };

  let jql: string;
  if (effectiveOpts.customJql && effectiveOpts.customJql.trim()) {
    // Start with customJql, but override status clauses if statusFilter is provided
    let base = effectiveOpts.customJql.trim();
    if (effectiveOpts.statusFilter && effectiveOpts.statusFilter.length > 0) {
      // User-controlled status filter wins: strip hardcoded status exclusions
      base = stripStatusClauses(base);
      const statusList = effectiveOpts.statusFilter.map((s) => `"${s}"`).join(", ");
      base += ` AND status IN (${statusList})`;
    }
    jql = base;
  } else {
    jql = `project = ${projectKey}`;
    if (effectiveOpts.issueTypeFilter) {
      const types = effectiveOpts.issueTypeFilter.split(",").map((t) => t.trim()).filter(Boolean);
      if (types.length > 0) {
        const typeList = types.map((t) => `"${t}"`).join(", ");
        jql += ` AND issuetype IN (${typeList})`;
      }
    }
    if (effectiveOpts.statusFilter && effectiveOpts.statusFilter.length > 0) {
      const statusList = effectiveOpts.statusFilter.map((s) => `"${s}"`).join(", ");
      jql += ` AND status IN (${statusList})`;
    }
  }

  // ── Apply additional server-side filters (always appended, regardless of customJql) ──

  // Labels filter
  if (effectiveOpts.labelsFilter && effectiveOpts.labelsFilter.length > 0) {
    const labelList = effectiveOpts.labelsFilter.map((l) => `"${l}"`).join(", ");
    jql += ` AND labels IN (${labelList})`;
  }

  // Priority filter (UI notation → Jira names)
  if (effectiveOpts.priorityFilter && effectiveOpts.priorityFilter.length > 0) {
    const jiraNames = effectiveOpts.priorityFilter.flatMap(normalisePriorityToJira);
    const priorityList = Array.from(new Set(jiraNames)).map((p) => `"${p}"`).join(", ");
    jql += ` AND priority IN (${priorityList})`;
  }

  // Updated-within-days filter
  if (effectiveOpts.updatedWithinDays && effectiveOpts.updatedWithinDays > 0) {
    jql += ` AND updated >= -${effectiveOpts.updatedWithinDays}d`;
  }

  // Stage / keyword filter (summary contains)
  if (effectiveOpts.stageKeyword && effectiveOpts.stageKeyword.trim()) {
    jql += ` AND summary ~ "${effectiveOpts.stageKeyword.trim()}"`;
  }

  // Ensure ORDER BY is present
  if (!/ORDER BY/i.test(jql)) {
    jql += " ORDER BY updated DESC";
  }
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50; // safety cap: 50 × 100 = 5000 issues max
  const fields = ["summary", "status", "assignee", "reporter", "updated", "comment", "priority", "issuetype", "customfield_10433", "labels"];

  const allIssues: JiraIssue[] = [];
  let nextPageToken: string | undefined = undefined;
  let pageCount = 0;

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

  return allIssues;
}

/// ─── Batch-check comments for a list of issue keys ───────────────────────────
// Returns a Set of issue keys where the user is a commenter OR was mentioned.
// Concurrency-limited to avoid hammering the Jira API.
async function fetchCommentInvolvement(
  issueKeys: string[],
  accountId: string,
  concurrency = 8,
): Promise<Set<string>> {
  const involved = new Set<string>();
  // Process in batches of `concurrency`
  for (let i = 0; i < issueKeys.length; i += concurrency) {
    const batch = issueKeys.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (key) => {
        try {
          // Fetch all comments for this issue (maxResults=100 is usually enough)
          const resp = await jiraClient.get(`/rest/api/3/issue/${key}/comment`, {
            params: { maxResults: 100, orderBy: "-created" },
          });
          const data = resp.data as { comments: unknown[] };
          for (const raw of data.comments ?? []) {
            const c = raw as Record<string, unknown>;
            // Check if user is the comment author
            const author = c.author as Record<string, unknown> | null;
            if (author?.accountId === accountId) {
              involved.add(key);
              return; // no need to check further comments for this issue
            }
            // Check if user is mentioned in the ADF body
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

// ─── Fetch issues where the user has ANY involvement ─────────────────────────
// Uses: assignee OR reporter OR watcher (via JQL) PLUS commenter/mentioned
// (via batch comment fetching for precise accountId matching).
export async function fetchMyInvolvedIssues(
  accountId: string,
  _username: string,
  projectKey?: string,
  statusFilter?: string[],
): Promise<Set<string>> {
  const projectClause = projectKey ? `project = ${projectKey} AND ` : "";
  const statusClause = (statusFilter && statusFilter.length > 0)
    ? ` AND status IN (${statusFilter.map((s) => `"${s}"`).join(", ")})`
    : "";

  // Two JQL queries run in parallel:
  // 1. assignee / reporter / watcher (precise)
  // 2. comment ~ accountId (full-text, used as candidate set for later precise verification)
  const jqlDirect = `${projectClause}(assignee = "${accountId}" OR reporter = "${accountId}" OR watcher = "${accountId}")${statusClause}`;
  const jqlComment = `${projectClause}comment ~ "${accountId}"${statusClause}`;

  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const involvedKeys = new Set<string>();
  // commentCandidates: issues found via comment ~ (need precise verification later)
  const commentCandidates = new Set<string>();

  async function fetchAllKeys(jql: string, targetSet: Set<string>): Promise<void> {
    let nextPageToken: string | undefined = undefined;
    let pageCount = 0;
    do {
      const body: Record<string, unknown> = { jql, maxResults: PAGE_SIZE, fields: ["summary"] };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const response = await jiraClient.post("/rest/api/3/search/jql", body);
      const data = response.data as { issues: { key: string }[]; nextPageToken?: string; isLast?: boolean };
      for (const issue of data.issues ?? []) targetSet.add(issue.key);
      nextPageToken = (data.isLast === false && data.nextPageToken) ? data.nextPageToken : undefined;
      pageCount++;
    } while (nextPageToken && pageCount < MAX_PAGES);
  }

  // Run both queries in parallel
  await Promise.all([
    fetchAllKeys(jqlDirect, involvedKeys),
    fetchAllKeys(jqlComment, commentCandidates),
  ]);

  // Add comment candidates to involvedKeys so routers.ts can fetch + verify them
  // (enrichWithCommentInvolvement will do precise accountId verification)
  Array.from(commentCandidates).forEach((key) => involvedKeys.add(key));

  return involvedKeys;
}

// ─── Enrich involvement set with commenter/mentioned issues ──────────────────
// Given a list of candidate issue keys (from fetchOpenIssues), check each one
// for comments authored by or mentioning the user. Merges results into the
// existing involvedKeys set in-place and returns it.
export async function enrichWithCommentInvolvement(
  candidateKeys: string[],
  accountId: string,
  involvedKeys: Set<string>,
): Promise<Set<string>> {
  // Only check issues not already in the involved set
  const toCheck = candidateKeys.filter((k) => !involvedKeys.has(k));
  if (toCheck.length === 0) return involvedKeys;
  const commentInvolved = await fetchCommentInvolvement(toCheck, accountId);
  Array.from(commentInvolved).forEach((key) => involvedKeys.add(key));
  return involvedKeys;
}

// ─── Fetch multiple issues by keys (for My Issues: fetch involved keys not in allIssues) ──────────

export async function fetchIssuesByKeys(issueKeys: string[]): Promise<JiraIssue[]> {
  if (issueKeys.length === 0) return [];
  const fields = ["summary", "status", "assignee", "reporter", "updated", "comment", "priority", "issuetype", "customfield_10433", "labels"];
  // Use JQL with issue key list — more efficient than N individual requests
  const keyList = issueKeys.map((k) => `"${k}"`).join(", ");
  const jql = `issueKey IN (${keyList})`;
  const response = await jiraClient.post("/rest/api/3/search/jql", {
    jql,
    maxResults: issueKeys.length,
    fields,
  });
  const data = response.data as { issues: unknown[] };
  return (data.issues ?? []).map((raw) => mapIssue(raw, JIRA_BASE_URL));
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
