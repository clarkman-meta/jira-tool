import { describe, expect, it, vi, beforeEach } from "vitest";

// Use vi.hoisted so mocks are available before module imports
const { mockPost, mockGet } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({ post: mockPost, get: mockGet })),
  },
}));

import { fetchOpenIssues, validateJiraCredentials, enrichWithCommentInvolvement } from "./jira";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeIssue(fieldOverrides: Record<string, unknown> = {}) {
  return {
    key: "DGTK-1234",
    fields: {
      summary: "Test issue summary",
      status: {
        name: "In Progress",
        statusCategory: { key: "indeterminate" },
      },
      assignee: {
        accountId: "712020:f04ded31-3e91-47eb-bad9-d5e624e2b95f",
        displayName: "Clark Hsu",
        avatarUrls: { "24x24": "https://example.com/avatar.png" },
      },
      updated: "2026-03-31T10:00:00.000Z",
      priority: { name: "High" },
      issuetype: { name: "Bug" },
      comment: {
        comments: [
          {
            body: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Latest comment text" }],
                },
              ],
            },
            author: { displayName: "Alice" },
            updated: "2026-03-31T12:00:00.000Z",
          },
        ],
      },
      ...fieldOverrides,
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("fetchOpenIssues", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
  });

  it("returns mapped issues from Jira API", async () => {
    mockPost.mockResolvedValueOnce({
      data: { issues: [makeIssue()] },
    });

    const issues = await fetchOpenIssues("DGTK");

    expect(issues).toHaveLength(1);
    const issue = issues[0];
    expect(issue.key).toBe("DGTK-1234");
    expect(issue.summary).toBe("Test issue summary");
    expect(issue.status).toBe("In Progress");
    expect(issue.statusCategory).toBe("indeterminate");
    expect(issue.assigneeId).toBe("712020:f04ded31-3e91-47eb-bad9-d5e624e2b95f");
    expect(issue.assigneeName).toBe("Clark Hsu");
    expect(issue.latestComment).toBe("Latest comment text");
    expect(issue.latestCommentAuthor).toBe("Alice");
    expect(issue.priority).toBe("High");
    expect(issue.issueType).toBe("Bug");
    expect(issue.url).toContain("DGTK-1234");
  });

  it("returns empty array when no issues", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    const issues = await fetchOpenIssues("TPZ");
    expect(issues).toHaveLength(0);
  });

  it("handles issues with no assignee", async () => {
    mockPost.mockResolvedValueOnce({
      data: { issues: [makeIssue({ assignee: null })] },
    });
    const issues = await fetchOpenIssues("KITE");
    expect(issues[0].assigneeId).toBeNull();
    expect(issues[0].assigneeName).toBeNull();
  });

  it("handles issues with no comments", async () => {
    mockPost.mockResolvedValueOnce({
      data: { issues: [makeIssue({ comment: { comments: [] } })] },
    });
    const issues = await fetchOpenIssues("DGTK");
    expect(issues[0].latestComment).toBeNull();
    expect(issues[0].latestCommentAuthor).toBeNull();
  });

  it("uses correct JQL with project key and no status restriction by default", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    await fetchOpenIssues("DGTK");
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    // Status filtering is now done via statusFilter param (server-side JQL status IN)
    // Default call without statusFilter should NOT include statusCategory restriction
    expect(callArgs[1].jql).toContain("DGTK");
    expect(callArgs[1].jql).not.toContain("statusCategory");
  });

  it("uses status IN clause when statusFilter is provided", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    await fetchOpenIssues("DGTK", 100, null, null, ["Triage", "In Progress"]);
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].jql).toContain("status IN");
    expect(callArgs[1].jql).toContain("Triage");
    expect(callArgs[1].jql).toContain("In Progress");
  });

  it("uses fixed PAGE_SIZE of 100 for cursor-based pagination", async () => {
    // The new pagination implementation always uses PAGE_SIZE=100 per page
    // regardless of the _maxResults parameter (which is now unused)
    mockPost.mockResolvedValueOnce({ data: { issues: [], isLast: true } });
    await fetchOpenIssues("DGTK", 50);
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].maxResults).toBe(100);
  });

  it("fetches multiple pages when isLast is false", async () => {
    const issue1 = { ...makeIssue(), key: "DGTK-1" };
    const issue2 = { ...makeIssue(), key: "DGTK-2" };
    mockPost
      .mockResolvedValueOnce({ data: { issues: [issue1], nextPageToken: "token123", isLast: false } })
      .mockResolvedValueOnce({ data: { issues: [issue2], isLast: true } });
    const result = await fetchOpenIssues("DGTK");
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("DGTK-1");
    expect(result[1].key).toBe("DGTK-2");
    // Second call should include nextPageToken
    const secondCallArgs = mockPost.mock.calls[1] as [string, Record<string, unknown>];
    expect(secondCallArgs[1].nextPageToken).toBe("token123");
  });

  it("appends labels IN clause when labelsFilter is provided", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    await fetchOpenIssues("DGTK", 100, null, null, null, { labelsFilter: ["SW", "HW"] });
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].jql).toContain("labels IN");
    expect(callArgs[1].jql).toContain("\"SW\"");
    expect(callArgs[1].jql).toContain("\"HW\"");
  });

  it("appends priority IN clause with Jira names when priorityFilter is provided", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    await fetchOpenIssues("DGTK", 100, null, null, null, { priorityFilter: ["p0", "p1"] });
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].jql).toContain("priority IN");
    expect(callArgs[1].jql).toContain("Highest");
    expect(callArgs[1].jql).toContain("High");
  });

  it("appends updated >= clause when updatedWithinDays is provided", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    await fetchOpenIssues("DGTK", 100, null, null, null, { updatedWithinDays: 30 });
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].jql).toContain('updated >= "-30d"');
  });

  it("appends summary ~ clause when stageKeyword is provided", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    await fetchOpenIssues("DGTK", 100, null, null, null, { stageKeyword: "EVT" });
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].jql).toContain("summary ~ \"EVT\"");
  });

  it("strips hardcoded status exclusions from customJql when statusFilter is provided", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    const customJql = "project = DGTK AND statusCategory != Done AND issuetype = Bug ORDER BY updated DESC";
    await fetchOpenIssues("DGTK", 100, null, customJql, ["In Progress"]);
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    // Should NOT contain the original statusCategory != Done clause
    expect(callArgs[1].jql).not.toContain("statusCategory != Done");
    // Should contain the user-controlled status IN clause
    expect(callArgs[1].jql).toContain("status IN");
    expect(callArgs[1].jql).toContain("In Progress");
  });

  it("strips status NOT IN clause from customJql when statusFilter is provided", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    const customJql = "project = DGTK AND status NOT IN (Closed, Done) ORDER BY updated DESC";
    await fetchOpenIssues("DGTK", 100, null, customJql, ["Triage", "In Progress"]);
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].jql).not.toContain("NOT IN");
    expect(callArgs[1].jql).toContain("status IN");
    expect(callArgs[1].jql).toContain("Triage");
  });

  it("Query A: uses assignee/reporter/watcher OR clause for confirmed involvement", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    const accountId = "user-abc-123";
    await fetchOpenIssues("DGTK", 100, null, null, null, { myAccountId: accountId, involvementMode: "confirmed" });
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    const jql = callArgs[1].jql as string;
    // Must include all three: assignee, reporter, watcher
    expect(jql).toContain(`assignee = "${accountId}"`);
    expect(jql).toContain(`reporter = "${accountId}"`);
    expect(jql).toContain(`watcher = "${accountId}"`);
    // Must be an OR clause (not AND)
    expect(jql).toContain("OR");
    // Must NOT use NOT watcher (that's Query B's job)
    expect(jql).not.toContain("NOT watcher");
    expect(jql).not.toContain("watcher is EMPTY");
  });

  it("Query B: uses NOT (assignee OR reporter) AND (watcher is EMPTY OR NOT watcher) for unconfirmed", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    const accountId = "user-abc-123";
    await fetchOpenIssues("DGTK", 100, null, null, null, { myAccountId: accountId, involvementMode: "unconfirmed" });
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    const jql = callArgs[1].jql as string;
    // Must exclude assignee and reporter via NOT
    expect(jql).toContain(`NOT (assignee = "${accountId}" OR reporter = "${accountId}")`);
    // Must use EMPTY-safe watcher exclusion (not bare NOT watcher = X)
    expect(jql).toContain("watcher is EMPTY");
    expect(jql).toContain(`NOT watcher = "${accountId}"`);
    // Must NOT use bare `NOT watcher = X` without the EMPTY guard
    // (i.e., the EMPTY OR form must be present)
    expect(jql).toContain("(watcher is EMPTY OR NOT watcher");
  });

  it("Query B: does NOT use bare NOT watcher = X (would silently drop 0-watcher issues)", async () => {
    // Regression test: Jira Cloud multi-value field bug
    // `NOT watcher = X` excludes issues with 0 watchers (e.g. DGTK-3112)
    // Correct form: (watcher is EMPTY OR NOT watcher = X)
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    const accountId = "user-abc-123";
    await fetchOpenIssues("DGTK", 100, null, null, null, { myAccountId: accountId, involvementMode: "unconfirmed" });
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    const jql = callArgs[1].jql as string;
    // The watcher exclusion must always be wrapped in the EMPTY-safe OR form
    expect(jql).toContain("watcher is EMPTY");
    // Must not appear as a standalone AND NOT watcher clause without the EMPTY guard
    const bareNotWatcher = /AND NOT watcher = "[^"]+"(?!\))/;
    expect(jql).not.toMatch(bareNotWatcher);
  });

  it("appends summary ~ clause for single titleFilter keyword", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    await fetchOpenIssues("DGTK", 100, null, null, null, { titleFilter: "[P2]" });
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].jql).toContain('summary ~ "[P2]"');
  });

  it("appends OR-joined summary ~ clauses for multiple titleFilter keywords", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    await fetchOpenIssues("DGTK", 100, null, null, null, { titleFilter: "[P2], [P1]" });
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].jql).toContain('summary ~ "[P2]" OR summary ~ "[P1]"');
  });

  it("does NOT append titleFilter clause when customJql is set", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    const customJql = "project = DGTK AND parent = DGTK-234 ORDER BY updated DESC";
    await fetchOpenIssues("DGTK", 100, null, customJql, null, { titleFilter: "[P2]" });
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    // customJql projects manage their own summary filter; titleFilter should be ignored
    expect(callArgs[1].jql).not.toContain('summary ~ "[P2]"');
  });
});

describe("validateJiraCredentials", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("returns true when credentials are valid", async () => {
    mockGet.mockResolvedValueOnce({ data: { accountId: "abc" } });
    const result = await validateJiraCredentials();
    expect(result).toBe(true);
  });

  it("returns false when credentials are invalid", async () => {
    mockGet.mockRejectedValueOnce(new Error("401 Unauthorized"));
    const result = await validateJiraCredentials();
    expect(result).toBe(false);
  });
});

// ─── enrichWithCommentInvolvement tests ───────────────────────────────────────

// ─── Helpers for enrichWithCommentInvolvement tests ──────────────────────────

import type { JiraIssue } from "./jira";

function makeJiraIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: "DGTK-100",
    summary: "Test issue",
    status: "In Progress",
    statusCategory: "indeterminate",
    assigneeId: null,
    assigneeName: null,
    assigneeAvatar: null,
    reporterId: null,
    reporterName: null,
    reporterAvatar: null,
    latestComment: null,
    latestCommentAuthor: null,
    latestCommentDate: null,
    priority: "Medium",
    build: null,
    issueType: "Task",
    url: "https://example.atlassian.net/browse/DGTK-100",
    updated: new Date().toISOString(),
    labels: [],
    prefetchedCommentAuthorIds: [],
    prefetchedCommentMentionIds: [],
    commentTotal: 0,
    ...overrides,
  };
}

describe("enrichWithCommentInvolvement", () => {
  const MY_ACCOUNT_ID = "712020:f04ded31-3e91-47eb-bad9-d5e624e2b95f";

  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  // ── Pass 1: prefetch hits (no API call) ──────────────────────────────────

  it("adds issue key from prefetchedCommentAuthorIds without API call", async () => {
    const issue = makeJiraIssue({
      key: "DGTK-100",
      prefetchedCommentAuthorIds: [MY_ACCOUNT_ID, "other-user"],
      commentTotal: 2,
    });
    const involvedKeys = new Set<string>();
    await enrichWithCommentInvolvement([issue], MY_ACCOUNT_ID, involvedKeys);
    expect(involvedKeys.has("DGTK-100")).toBe(true);
    expect(mockGet).not.toHaveBeenCalled(); // no API call needed
  });

  it("adds issue key from prefetchedCommentMentionIds without API call", async () => {
    const issue = makeJiraIssue({
      key: "DGTK-200",
      prefetchedCommentAuthorIds: ["other-user"],
      prefetchedCommentMentionIds: [MY_ACCOUNT_ID],
      commentTotal: 1,
    });
    const involvedKeys = new Set<string>();
    await enrichWithCommentInvolvement([issue], MY_ACCOUNT_ID, involvedKeys);
    expect(involvedKeys.has("DGTK-200")).toBe(true);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("does not add issue key when user not in prefetch and comments not truncated", async () => {
    // commentTotal === prefetchedCount: all comments already scanned, user not found
    const issue = makeJiraIssue({
      key: "DGTK-300",
      prefetchedCommentAuthorIds: ["other-user"],
      commentTotal: 1, // total == returned, no truncation
    });
    const involvedKeys = new Set<string>();
    await enrichWithCommentInvolvement([issue], MY_ACCOUNT_ID, involvedKeys);
    expect(involvedKeys.has("DGTK-300")).toBe(false);
    expect(mockGet).not.toHaveBeenCalled(); // confirmed not involved, no API
  });

  it("skips issues already in involvedKeys without API call", async () => {
    const issue = makeJiraIssue({ key: "DGTK-400", commentTotal: 5 });
    const involvedKeys = new Set<string>(["DGTK-400"]);
    await enrichWithCommentInvolvement([issue], MY_ACCOUNT_ID, involvedKeys);
    expect(mockGet).not.toHaveBeenCalled();
    expect(involvedKeys.has("DGTK-400")).toBe(true);
  });

  // ── Pass 2: API fallback for truncated issues (commentTotal > prefetchedCount) ──

  it("calls API with startAt=prefetchedCount when comments are truncated and user not in prefetch", async () => {
    // Simulate: 24 total comments, 20 prefetched, user not in first 20
    // API returns comments 21-24 where user IS the author
    mockGet.mockResolvedValueOnce({
      data: {
        comments: [
          { author: { accountId: MY_ACCOUNT_ID }, body: { type: "doc", version: 1, content: [] } },
        ],
      },
    });
    const issue = makeJiraIssue({
      key: "DGTK-500",
      prefetchedCommentAuthorIds: Array(20).fill("other-user"),
      commentTotal: 24, // truncated: 24 total, 20 prefetched
    });
    const involvedKeys = new Set<string>();
    await enrichWithCommentInvolvement([issue], MY_ACCOUNT_ID, involvedKeys);
    expect(involvedKeys.has("DGTK-500")).toBe(true);
    // API must be called with startAt=20 (skip already-scanned prefetch)
    expect(mockGet).toHaveBeenCalledOnce();
    const callParams = mockGet.mock.calls[0][1] as { params: Record<string, unknown> };
    expect(callParams.params.startAt).toBe(20);
  });

  it("does not add issue key when truncated API check also finds no involvement", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        comments: [
          { author: { accountId: "other-user" }, body: { type: "doc", version: 1, content: [] } },
        ],
      },
    });
    const issue = makeJiraIssue({
      key: "DGTK-600",
      prefetchedCommentAuthorIds: Array(20).fill("other-user"),
      commentTotal: 21,
    });
    const involvedKeys = new Set<string>();
    await enrichWithCommentInvolvement([issue], MY_ACCOUNT_ID, involvedKeys);
    expect(involvedKeys.has("DGTK-600")).toBe(false);
    expect(mockGet).toHaveBeenCalledOnce();
  });

  it("handles API errors gracefully (does not throw)", async () => {
    mockGet.mockRejectedValueOnce(new Error("403 Forbidden"));
    const issue = makeJiraIssue({
      key: "DGTK-700",
      prefetchedCommentAuthorIds: Array(20).fill("other-user"),
      commentTotal: 25, // truncated, triggers API call
    });
    const involvedKeys = new Set<string>();
    await expect(
      enrichWithCommentInvolvement([issue], MY_ACCOUNT_ID, involvedKeys)
    ).resolves.not.toThrow();
    expect(involvedKeys.has("DGTK-700")).toBe(false);
  });
});
