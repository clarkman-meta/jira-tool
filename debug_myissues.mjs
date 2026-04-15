import 'dotenv/config';
import axios from 'axios';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'https://metarl.atlassian.net';
const JIRA_EMAIL = process.env.JIRA_EMAIL || '';
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || '';
const MY_ACCOUNT_ID = process.env.JIRA_MY_ACCOUNT_ID || '';

const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
const client = axios.create({
  baseURL: JIRA_BASE_URL,
  headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  timeout: 30000,
});

console.log('MY_ACCOUNT_ID:', MY_ACCOUNT_ID);
console.log('JIRA_EMAIL:', JIRA_EMAIL);
console.log();

// Step 1: Check issue details
console.log('=== Step 1: Issue details ===');
for (const key of ['DGTK-3112', 'DGTK-3292']) {
  const r = await client.get(`/rest/api/3/issue/${key}`, {
    params: { fields: 'summary,status,assignee,reporter,labels,updated' }
  });
  const f = r.data.fields;
  console.log(`${key}: status="${f.status?.name}", assignee=${f.assignee?.accountId || 'none'}, reporter=${f.reporter?.accountId || 'none'}, labels=${JSON.stringify(f.labels)}, updated=${f.updated?.slice(0,10)}`);
}
console.log();

// Step 2: Check Dragon project's customJql from DB
console.log('=== Step 2: Check Dragon project DB config ===');
try {
  const { drizzle } = await import('drizzle-orm/mysql2');
  const mysql = await import('mysql2/promise');
  const { projects } = await import('./drizzle/schema.js');
  const conn = await mysql.default.createConnection(process.env.DATABASE_URL);
  const db = drizzle(conn);
  const rows = await db.select().from(projects);
  for (const row of rows) {
    console.log(`Project: key=${row.projectKey}, customJql="${row.customJql || 'null'}", issueTypeFilter="${row.issueTypeFilter || 'null'}", titleFilter="${row.titleFilter || 'null'}"`);
  }
  await conn.end();
} catch (e) {
  console.log('DB query failed:', e.message);
}
console.log();

// Step 3: Test fetchOpenIssues with statusFilter=["Closed"] for DGTK
console.log('=== Step 3: fetchOpenIssues - DGTK with status=Closed ===');
const jql3 = 'project = DGTK AND status IN ("Closed") ORDER BY updated DESC';
console.log('JQL:', jql3);
const r3 = await client.post('/rest/api/3/search/jql', {
  jql: jql3, maxResults: 50, fields: ['summary', 'status', 'labels', 'updated']
});
const issues3 = r3.data.issues || [];
console.log(`Found ${issues3.length} Closed issues in DGTK`);
const keys3 = issues3.map(i => i.key);
for (const i of issues3.slice(0, 10)) {
  console.log(`  ${i.key}: ${i.fields.summary?.slice(0, 60)} | labels=${JSON.stringify(i.fields.labels)} | updated=${i.fields.updated?.slice(0,10)}`);
}
console.log(`DGTK-3112 in results: ${keys3.includes('DGTK-3112')}`);
console.log(`DGTK-3292 in results: ${keys3.includes('DGTK-3292')}`);
console.log();

// Step 4: Test fetchMyInvolvedIssues JQL with statusFilter=["Closed"]
console.log('=== Step 4: fetchMyInvolvedIssues JQL with status=Closed ===');
const jql4 = `project = DGTK AND (assignee = "${MY_ACCOUNT_ID}" OR reporter = "${MY_ACCOUNT_ID}" OR watcher = "${MY_ACCOUNT_ID}") AND status IN ("Closed")`;
console.log('JQL:', jql4);
const r4 = await client.post('/rest/api/3/search/jql', {
  jql: jql4, maxResults: 50, fields: ['summary']
});
const issues4 = r4.data.issues || [];
console.log(`Found ${issues4.length} involved Closed issues`);
for (const i of issues4) {
  console.log(`  ${i.key}: ${i.fields.summary?.slice(0, 60)}`);
}
const keys4 = issues4.map(i => i.key);
console.log(`DGTK-3292 in involvedKeys: ${keys4.includes('DGTK-3292')}`);
console.log();

// Step 5: Check comments on DGTK-3112
console.log('=== Step 5: DGTK-3112 comments - looking for Clark ===');
const r5 = await client.get('/rest/api/3/issue/DGTK-3112/comment', {
  params: { maxResults: 100, orderBy: '-created' }
});
const comments5 = r5.data.comments || [];
console.log(`Total comments: ${comments5.length}`);
let clarkFound = false;
for (const c of comments5) {
  const author = c.author || {};
  if (author.accountId === MY_ACCOUNT_ID) {
    console.log(`  Clark commented (id=${author.accountId}): ${JSON.stringify(c.body)?.slice(0, 100)}`);
    clarkFound = true;
  }
}
if (!clarkFound) {
  console.log('  Clark has NO comments with accountId:', MY_ACCOUNT_ID);
  console.log('  First 5 comment authors:');
  for (const c of comments5.slice(0, 5)) {
    const author = c.author || {};
    console.log(`    accountId=${author.accountId}, name=${author.displayName}`);
  }
}
console.log();

// Step 6: Check if DGTK-3292 has Clark as watcher
console.log('=== Step 6: DGTK-3292 watchers ===');
try {
  const r6 = await client.get('/rest/api/3/issue/DGTK-3292/watchers');
  const watchers = r6.data.watchers || [];
  console.log(`Total watchers: ${watchers.length}`);
  for (const w of watchers) {
    console.log(`  watcher: accountId=${w.accountId}, name=${w.displayName}`);
  }
  const clarkWatching = watchers.some(w => w.accountId === MY_ACCOUNT_ID);
  console.log(`Clark is watcher: ${clarkWatching}`);
} catch (e) {
  console.log('Watchers API error:', e.message);
}
console.log();

// Step 7: Check what the customJql for Dragon looks like - maybe it has status filter baked in
console.log('=== Step 7: Test with customJql (if Dragon has one) ===');
// If Dragon has a customJql, fetchOpenIssues uses it AS-IS, ignoring statusFilter
// Let's check what happens if customJql is set
console.log('If Dragon has customJql, the statusFilter param is IGNORED by fetchOpenIssues!');
console.log('See jira.ts line ~176: if (customJql && customJql.trim()) { jql = customJql.trim(); }');
console.log('This means statusFilter is completely bypassed when customJql is set!');
