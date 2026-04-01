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
    url: `${baseUrl}/browse/${issue.key}`,
  };
}

// ─── Fetch ALL open issues for a project (cursor-based pagination) ────────────

export async function fetchOpenIssues(
  projectKey: string,
  _maxResults = 100,
  issueTypeFilter?: string | null,
  customJql?: string | null,
): Promise<JiraIssue[]> {
  let jql: string;
  if (customJql && customJql.trim()) {
    // Use the fully custom JQL as-is
    jql = customJql.trim();
  } else {
    jql = `project = ${projectKey} AND statusCategory != Done AND status != Closed`;
    if (issueTypeFilter) {
      const types = issueTypeFilter.split(",").map((t) => t.trim()).filter(Boolean);
      if (types.length > 0) {
        const typeList = types.map((t) => `"${t}"`).join(", ");
        jql += ` AND issuetype IN (${typeList})`;
      }
    }
    jql += " ORDER BY updated DESC";
  }
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50; // safety cap: 50 × 100 = 5000 issues max
  const fields = ["summary", "status", "assignee", "reporter", "updated", "comment", "priority", "issuetype", "customfield_10433"];

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

// ─── Fetch a single issue by key ─────────────────────────────────────────────

export async function fetchSingleIssue(issueKey: string): Promise<JiraIssue> {
  const fields = ["summary", "status", "assignee", "reporter", "updated", "comment", "priority", "issuetype", "customfield_10433"];
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
