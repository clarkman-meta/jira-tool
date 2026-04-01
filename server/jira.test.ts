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

import { fetchOpenIssues, validateJiraCredentials } from "./jira";

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

  it("uses correct JQL with statusCategory != Done", async () => {
    mockPost.mockResolvedValueOnce({ data: { issues: [] } });
    await fetchOpenIssues("DGTK");
    const callArgs = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[1].jql).toContain("statusCategory != Done");
    expect(callArgs[1].jql).toContain("DGTK");
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
