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
} from "./db";
import { fetchOpenIssues, validateJiraCredentials } from "./jira";

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

  // ─── Jira Issues ────────────────────────────────────────────────────────────────────
  jira: router({
    issues: publicProcedure
      .input(
        z.object({
          projectKey: z.string().min(1).max(32),
          maxResults: z.number().int().min(1).max(500).optional().default(200),
        })
      )
      .query(async ({ input }) => {
        try {
          const issues = await fetchOpenIssues(input.projectKey, input.maxResults);
          return { issues, error: null };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(`[Jira] Failed to fetch issues for ${input.projectKey}:`, message);
          return { issues: [], error: message };
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
