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

describe("enrichWithCommentInvolvement", () => {
  const MY_ACCOUNT_ID = "712020:f04ded31-3e91-47eb-bad9-d5e624e2b95f";

  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("adds issue key when user is the comment author", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        comments: [
          {
            author: { accountId: MY_ACCOUNT_ID },
            body: { type: "doc", version: 1, content: [] },
          },
        ],
      },
    });
    const involvedKeys = new Set<string>();
    await enrichWithCommentInvolvement(["DGTK-100"], MY_ACCOUNT_ID, involvedKeys);
    expect(involvedKeys.has("DGTK-100")).toBe(true);
  });

  it("adds issue key when user is mentioned in ADF body", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        comments: [
          {
            author: { accountId: "other-user" },
            body: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Hey " },
                    {
                      type: "mention",
                      attrs: { id: MY_ACCOUNT_ID, text: "@Clark" },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    });
    const involvedKeys = new Set<string>();
    await enrichWithCommentInvolvement(["DGTK-200"], MY_ACCOUNT_ID, involvedKeys);
    expect(involvedKeys.has("DGTK-200")).toBe(true);
  });

  it("does not add issue key when user is not involved in comments", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        comments: [
          {
            author: { accountId: "other-user" },
            body: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: "No mention here" }] }],
            },
          },
        ],
      },
    });
    const involvedKeys = new Set<string>();
    await enrichWithCommentInvolvement(["DGTK-300"], MY_ACCOUNT_ID, involvedKeys);
    expect(involvedKeys.has("DGTK-300")).toBe(false);
  });

  it("skips issues already in involvedKeys without calling API", async () => {
    const involvedKeys = new Set<string>(["DGTK-400"]);
    await enrichWithCommentInvolvement(["DGTK-400"], MY_ACCOUNT_ID, involvedKeys);
    expect(mockGet).not.toHaveBeenCalled();
    expect(involvedKeys.has("DGTK-400")).toBe(true);
  });

  it("handles API errors gracefully (does not throw)", async () => {
    mockGet.mockRejectedValueOnce(new Error("403 Forbidden"));
    const involvedKeys = new Set<string>();
    await expect(
      enrichWithCommentInvolvement(["DGTK-500"], MY_ACCOUNT_ID, involvedKeys)
    ).resolves.not.toThrow();
    expect(involvedKeys.has("DGTK-500")).toBe(false);
  });
});
