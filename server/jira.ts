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
  timeout: 15000,
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
    // Add newlines between block-level nodes
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
  issueType: string | null;
  url: string;
}

// ─── Fetch open issues for a project ──────────────────────────────────────────

export async function fetchOpenIssues(projectKey: string, maxResults = 100): Promise<JiraIssue[]> {
  const jql = `project = ${projectKey} AND statusCategory != Done ORDER BY updated DESC`;

  const response = await jiraClient.post("/rest/api/3/search/jql", {
    jql,
    maxResults,
    fields: ["summary", "status", "assignee", "reporter", "updated", "comment", "priority", "issuetype"],
  });

  const issues = response.data.issues as unknown[];

  return issues.map((raw) => {
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
      issueType,
      url: `${JIRA_BASE_URL}/browse/${issue.key}`,
    };
  });
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
