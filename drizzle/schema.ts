import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Jira projects configuration table
export const jiraProjects = mysqlTable("jira_projects", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  codename: varchar("codename", { length: 128 }),
  color: varchar("color", { length: 32 }).default("#6366f1"),
  jiraBaseUrl: varchar("jiraBaseUrl", { length: 256 }).default("https://metarl.atlassian.net"),
  sortOrder: int("sortOrder").default(0),
  isActive: boolean("isActive").default(true).notNull(),
  /** Comma-separated keywords; if set, only issues whose title contains at least one keyword are shown */
  titleFilter: varchar("titleFilter", { length: 512 }),
  /** Comma-separated Jira issue types to include in JQL, e.g. "Bug,FA". If null, all types are fetched. */
  issueTypeFilter: varchar("issueTypeFilter", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type JiraProject = typeof jiraProjects.$inferSelect;
export type InsertJiraProject = typeof jiraProjects.$inferInsert;

// Issues the user explicitly wants to monitor (pinned to top of table)
export const watchedIssues = mysqlTable("watched_issues", {
  id: int("id").autoincrement().primaryKey(),
  issueKey: varchar("issueKey", { length: 32 }).notNull().unique(),
  projectKey: varchar("projectKey", { length: 32 }).notNull(),
  note: varchar("note", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WatchedIssue = typeof watchedIssues.$inferSelect;
export type InsertWatchedIssue = typeof watchedIssues.$inferInsert;

// Issues the user wants to hide from the table
export const hiddenIssues = mysqlTable("hidden_issues", {
  id: int("id").autoincrement().primaryKey(),
  issueKey: varchar("issueKey", { length: 32 }).notNull().unique(),
  projectKey: varchar("projectKey", { length: 32 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type HiddenIssue = typeof hiddenIssues.$inferSelect;
export type InsertHiddenIssue = typeof hiddenIssues.$inferInsert;