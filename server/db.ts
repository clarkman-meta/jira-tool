import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, jiraProjects, InsertJiraProject, users, watchedIssues, hiddenIssues } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Jira Projects ────────────────────────────────────────────────────────────

const DEFAULT_PROJECTS: InsertJiraProject[] = [
  { key: "DGTK", name: "Dragon",     codename: "diamond",  color: "#f59e0b", sortOrder: 0, titleFilter: "Diamond,DImond,Dimond", issueTypeFilter: "Bug,FA" },
  { key: "TPZ",  name: "SSG",        codename: "topaz",    color: "#10b981", sortOrder: 1 },
  { key: "KITE", name: "Hypernova2", codename: "kitefin",  color: "#6366f1", sortOrder: 2, titleFilter: "kitefin,Kitefin,KITEFIN" },
];

export async function seedDefaultProjects() {
  const db = await getDb();
  if (!db) return;
  for (const p of DEFAULT_PROJECTS) {
    await db.insert(jiraProjects)
      .values(p)
      .onDuplicateKeyUpdate({ set: { name: p.name, codename: p.codename, color: p.color, titleFilter: p.titleFilter ?? null, issueTypeFilter: p.issueTypeFilter ?? null } });
  }
}

export async function listJiraProjects() {
  const db = await getDb();
  if (!db) return DEFAULT_PROJECTS.map((p, i) => ({ ...p, id: i + 1, isActive: true, jiraBaseUrl: "https://metarl.atlassian.net", createdAt: new Date(), updatedAt: new Date() }));
  return db.select().from(jiraProjects).orderBy(jiraProjects.sortOrder);
}

export async function getJiraProjectByKey(key: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(jiraProjects).where(eq(jiraProjects.key, key)).limit(1);
  return result[0];
}

export async function insertJiraProject(data: InsertJiraProject) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(jiraProjects).values(data);
}

export async function updateJiraProject(id: number, data: Partial<InsertJiraProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(jiraProjects).set(data).where(eq(jiraProjects.id, id));
}

export async function deleteJiraProject(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(jiraProjects).where(eq(jiraProjects.id, id));
}

// ─── Watched Issues ───────────────────────────────────────────────────────────

export async function listWatchedIssues() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(watchedIssues).orderBy(watchedIssues.createdAt);
}

export async function addWatchedIssue(issueKey: string, projectKey: string, note?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(watchedIssues)
    .values({ issueKey: issueKey.toUpperCase(), projectKey: projectKey.toUpperCase(), note: note ?? null })
    .onDuplicateKeyUpdate({ set: { projectKey: projectKey.toUpperCase(), note: note ?? null } });
}

export async function removeWatchedIssue(issueKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(watchedIssues).where(eq(watchedIssues.issueKey, issueKey.toUpperCase()));
}

// ─── Hidden Issues ────────────────────────────────────────────────────────────

export async function listHiddenIssues() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(hiddenIssues).orderBy(hiddenIssues.createdAt);
}

export async function addHiddenIssue(issueKey: string, projectKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(hiddenIssues)
    .values({ issueKey: issueKey.toUpperCase(), projectKey: projectKey.toUpperCase() })
    .onDuplicateKeyUpdate({ set: { projectKey: projectKey.toUpperCase() } });
}

export async function removeHiddenIssue(issueKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(hiddenIssues).where(eq(hiddenIssues.issueKey, issueKey.toUpperCase()));
}
