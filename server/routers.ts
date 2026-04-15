import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  deleteJiraProject,
  insertJiraProject,
  listJiraProjects,
  seedDefaultProjects,
  updateJiraProject,
  listWatchedIssues,
  addWatchedIssue,
  removeWatchedIssue,
  listHiddenIssues,
  addHiddenIssue,
  removeHiddenIssue,
} from "./db";
import { fetchOpenIssues, enrichWithCommentInvolvement, fetchSingleIssue, validateJiraCredentials } from "./jira";

// Seed default projects on startup
seedDefaultProjects().catch((e) => console.warn("[DB] Seed failed:", e));

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Jira Projects Config ────────────────────────────────────────────────────────────
  projects: router({
    list: publicProcedure.query(async () => {
      return listJiraProjects();
    }),

    add: protectedProcedure
      .input(
        z.object({
          key: z.string().min(1).max(32),
          name: z.string().min(1).max(128),
          codename: z.string().max(128).optional(),
          color: z.string().max(32).optional(),
          jiraBaseUrl: z.string().optional(),
          sortOrder: z.number().int().optional(),
          titleFilter: z.string().max(512).optional(),
          customJql: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        await insertJiraProject({
          key: input.key.toUpperCase(),
          name: input.name,
          codename: input.codename,
          color: input.color ?? "#6366f1",
          jiraBaseUrl: input.jiraBaseUrl ?? "https://metarl.atlassian.net",
          sortOrder: input.sortOrder ?? 99,
          titleFilter: input.titleFilter ?? null,
          customJql: input.customJql ?? null,
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int(),
          name: z.string().min(1).max(128).optional(),
          codename: z.string().max(128).optional(),
          color: z.string().max(32).optional(),
          jiraBaseUrl: z.string().optional(),
          sortOrder: z.number().int().optional(),
          isActive: z.boolean().optional(),
          titleFilter: z.string().max(512).nullable().optional(),
          customJql: z.string().nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateJiraProject(id, data);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteJiraProject(input.id);
        return { success: true };
      }),
  }),

  // ─── Watch List ─────────────────────────────────────────────────────────────────────
  watchlist: router({
    list: publicProcedure.query(async () => {
      return listWatchedIssues();
    }),

    add: publicProcedure
      .input(z.object({
        issueKey: z.string().min(1).max(32),
        projectKey: z.string().min(1).max(32),
        note: z.string().max(256).optional(),
      }))
      .mutation(async ({ input }) => {
        await addWatchedIssue(input.issueKey, input.projectKey, input.note);
        return { success: true };
      }),

    remove: publicProcedure
      .input(z.object({ issueKey: z.string().min(1).max(32) }))
      .mutation(async ({ input }) => {
        await removeWatchedIssue(input.issueKey);
        return { success: true };
      }),
  }),

  // ─── Hidden Issues ───────────────────────────────────────────────────────────────────
  hidden: router({
    list: publicProcedure.query(async () => {
      return listHiddenIssues();
    }),

    add: publicProcedure
      .input(z.object({
        issueKey: z.string().min(1).max(32),
        projectKey: z.string().min(1).max(32),
      }))
      .mutation(async ({ input }) => {
        await addHiddenIssue(input.issueKey, input.projectKey);
        return { success: true };
      }),

    remove: publicProcedure
      .input(z.object({ issueKey: z.string().min(1).max(32) }))
      .mutation(async ({ input }) => {
        await removeHiddenIssue(input.issueKey);
        return { success: true };
      }),
  }),

  // ─── Jira Issues ────────────────────────────────────────────────────────────────────
  jira: router({
    issues: publicProcedure
      .input(
        z.object({
          projectKey: z.string().min(1).max(32),
          maxResults: z.number().int().min(1).max(500).optional().default(200),
          myIssues: z.boolean().optional().default(false),
          statusFilter: z.array(z.string()).optional().default(["Triage", "In Progress"]),
          labelsFilter: z.array(z.string()).optional().default([]),
          priorityFilter: z.array(z.string()).optional().default([]),
          updatedWithinDays: z.number().int().min(0).optional().default(30),
          stageKeyword: z.string().optional().default(""),
        })
      )
      .query(async ({ input }) => {
        try {
          // Fetch project config to get filters
          const projects = await listJiraProjects();
          const project = projects.find((p) => p.key === input.projectKey);
          const titleFilter = project?.titleFilter ?? null;
          const issueTypeFilter = (project as { issueTypeFilter?: string | null } | undefined)?.issueTypeFilter ?? null;
          const customJql = (project as { customJql?: string | null } | undefined)?.customJql ?? null;

          // Always pass statusFilter to server — it controls what's fetched regardless of mode.
          // When user changes statusFilter (e.g. adds Closed), tRPC re-fetches automatically.
          const effectiveStatusFilter = input.statusFilter.length > 0 ? input.statusFilter : null;
          const myAccountId = input.myIssues ? (process.env.JIRA_MY_ACCOUNT_ID ?? "") : "";
          const allIssues = await fetchOpenIssues(
            input.projectKey,
            input.maxResults,
            issueTypeFilter,
            customJql,
            effectiveStatusFilter,
            {
              labelsFilter: input.labelsFilter.length > 0 ? input.labelsFilter : null,
              priorityFilter: input.priorityFilter.length > 0 ? input.priorityFilter : null,
              updatedWithinDays: input.updatedWithinDays > 0 ? input.updatedWithinDays : null,
              stageKeyword: input.stageKeyword.trim() || null,
              // My Issues: inject involvement JQL so Jira filters assignee/reporter/comment at source
              myAccountId: myAccountId || null,
              // titleFilter: injected as summary ~ JQL clause (server-side, only for non-customJql projects)
              titleFilter: titleFilter || null,
            },
          );

          // All filtering is now server-side; no post-fetch filtering needed
          let issues = allIssues;

          // My Issues: Jira has already filtered by (assignee OR reporter OR comment ~) via JQL.
          // All fetched issues are involvement candidates. Now do precise comment verification:
          // - assignee/reporter are confirmed (no false positives) — skip comment scan
          // - comment ~ is full-text (may have false positives) — verify via comment API
          if (input.myIssues && myAccountId) {
            const involvedKeys = new Set<string>();
            const needCommentScan: string[] = [];

            // Single pass: bucket issues by whether they need comment verification
            for (const issue of issues) {
              if (
                issue.assigneeId === myAccountId ||
                issue.reporterId === myAccountId
              ) {
                involvedKeys.add(issue.key); // confirmed via assignee/reporter — no API call needed
              } else {
                needCommentScan.push(issue.key); // came via comment ~ JQL — needs precise verification
              }
            }

            // Precise comment scan only for the comment ~ candidates
            if (needCommentScan.length > 0) {
              await enrichWithCommentInvolvement(needCommentScan, myAccountId, involvedKeys);
            }

            // Keep only confirmed involved issues
            issues = issues.filter((issue) => involvedKeys.has(issue.key));
          }

          return { issues, error: null };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(`[Jira] Failed to fetch issues for ${input.projectKey}:`, message);
          return { issues: [], error: message };
        }
      }),

    // Fetch a single issue by key (for pinned issues feature)
    issue: publicProcedure
      .input(z.object({ issueKey: z.string().min(1).max(32) }))
      .query(async ({ input }) => {
        try {
          const issue = await fetchSingleIssue(input.issueKey);
          return { issue, error: null };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          return { issue: null, error: message };
        }
      }),

    validateCredentials: publicProcedure.query(async () => {
      const valid = await validateJiraCredentials();
      return { valid };
    }),

    myAccountId: publicProcedure.query(() => {
      return { accountId: process.env.JIRA_MY_ACCOUNT_ID ?? "" };
    }),
  }),
});

export type AppRouter = typeof appRouter;
