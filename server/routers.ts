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
import { fetchOpenIssues, fetchMyInvolvedIssues, enrichWithCommentInvolvement, fetchIssuesByKeys, fetchSingleIssue, validateJiraCredentials } from "./jira";

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
            },
          );

          // Apply titleFilter only when no customJql is set
          let issues = allIssues;
          if (!customJql && titleFilter) {
            const keywords = titleFilter
              .split(",")
              .map((k) => k.trim().toLowerCase())
              .filter(Boolean);
            if (keywords.length > 0) {
              issues = allIssues.filter((issue) => {
                const title = issue.summary.toLowerCase();
                return keywords.some((kw) => title.includes(kw));
              });
            }
          }

          // If myIssues mode is requested, filter to only issues where the user has involvement
          // (assignee OR reporter OR watcher OR commenter/mentioned)
          if (input.myIssues) {
            const myAccountId = process.env.JIRA_MY_ACCOUNT_ID ?? "";
            const jiraEmail = process.env.JIRA_EMAIL ?? "";
            const username = jiraEmail.includes("@") ? jiraEmail.split("@")[0] : jiraEmail;

            if (myAccountId) {
              // Step 1: Get all involved keys via JQL (assignee/reporter/watcher) + comment ~ accountId candidates.
              // fetchMyInvolvedIssues runs both JQL queries in parallel and merges the results.
              // The comment ~ accountId results are candidates that need precise verification.
              const involvedKeys = await fetchMyInvolvedIssues(myAccountId, username, input.projectKey);

              // Step 2: Build the full pool of issues to work with:
              // - allIssues: issues already fetched by fetchOpenIssues (statusFilter-limited window)
              // - missingIssues: issues in involvedKeys but NOT in allIssues (e.g. outside pagination window)
              const allIssueKeySet = new Set(issues.map((i) => i.key));
              const missingInvolvedKeys = Array.from(involvedKeys).filter((k) => !allIssueKeySet.has(k));
              let missingIssues: typeof issues = [];
              if (missingInvolvedKeys.length > 0) {
                missingIssues = await fetchIssuesByKeys(missingInvolvedKeys);
              }
              const allPool = [...issues, ...missingIssues];

              // Step 3: Precise comment/mention verification for ALL candidates in the pool.
              // This handles:
              // - Issues from comment ~ accountId JQL (full-text, may have false positives)
              // - Issues in allIssues that might have Clark as commenter/mentioned
              // enrichWithCommentInvolvement skips keys already confirmed as involved.
              const allPoolKeys = allPool.map((i) => i.key);
              await enrichWithCommentInvolvement(allPoolKeys, myAccountId, involvedKeys);

              // Step 4: Keep only issues that appear in the confirmed involved set
              let result = allPool.filter((issue) => involvedKeys.has(issue.key));

              // Step 5: Apply statusFilter to the final result
              if (effectiveStatusFilter) {
                const statusSet = new Set(effectiveStatusFilter);
                result = result.filter((i) => statusSet.has(i.status));
              }

              // Deduplicate by key
              const seen = new Set<string>();
              issues = result.filter((i) => {
                if (seen.has(i.key)) return false;
                seen.add(i.key);
                return true;
              });
            }
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
