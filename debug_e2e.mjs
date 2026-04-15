/**
 * End-to-end test: simulate the full My Issues pipeline for DGTK with Closed status
 * Expected: DGTK-3112 (commenter) and DGTK-3292 (assignee) should appear
 */
import 'dotenv/config';
import axios from 'axios';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const MY_ACCOUNT_ID = process.env.JIRA_MY_ACCOUNT_ID;

const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
const client = axios.create({
  baseURL: JIRA_BASE_URL,
  headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  timeout: 60000,
});

const PROJECT_KEY = 'DGTK';
const STATUS_FILTER = ['Closed'];

console.log('=== E2E Test: My Issues Pipeline ===');
console.log('Project:', PROJECT_KEY, '| Status:', STATUS_FILTER, '| AccountId:', MY_ACCOUNT_ID);
console.log();

// Step 1: fetchMyInvolvedIssues (assignee/reporter/watcher + comment candidates)
console.log('Step 1: fetchMyInvolvedIssues...');
const jqlDirect = `project = ${PROJECT_KEY} AND (assignee = "${MY_ACCOUNT_ID}" OR reporter = "${MY_ACCOUNT_ID}" OR watcher = "${MY_ACCOUNT_ID}")`;
const jqlComment = `project = ${PROJECT_KEY} AND comment ~ "${MY_ACCOUNT_ID}"`;

const [r1, r2] = await Promise.all([
  client.post('/rest/api/3/search/jql', { jql: jqlDirect, maxResults: 100, fields: ['summary'] }),
  client.post('/rest/api/3/search/jql', { jql: jqlComment, maxResults: 100, fields: ['summary'] }),
]);

const involvedKeys = new Set();
for (const i of r1.data.issues || []) involvedKeys.add(i.key);
const commentCandidates = new Set();
for (const i of r2.data.issues || []) commentCandidates.add(i.key);
for (const k of commentCandidates) involvedKeys.add(k);

console.log(`  Direct involved: ${r1.data.issues?.length} issues`);
console.log(`  Comment candidates: ${r2.data.issues?.length} issues`);
console.log(`  Total involvedKeys: ${involvedKeys.size}`);
console.log(`  DGTK-3112 in involvedKeys: ${involvedKeys.has('DGTK-3112')}`);
console.log(`  DGTK-3292 in involvedKeys: ${involvedKeys.has('DGTK-3292')}`);
console.log();

// Step 2: fetchOpenIssues with statusFilter=["Closed"]
console.log('Step 2: fetchOpenIssues with Closed status...');
const r3 = await client.post('/rest/api/3/search/jql', {
  jql: `project = ${PROJECT_KEY} AND status IN ("Closed") ORDER BY updated DESC`,
  maxResults: 100,
  fields: ['summary', 'status', 'labels']
});
const allIssues = r3.data.issues || [];
const allIssueKeySet = new Set(allIssues.map(i => i.key));
console.log(`  allIssues count: ${allIssues.length}`);
console.log(`  DGTK-3112 in allIssues: ${allIssueKeySet.has('DGTK-3112')}`);
console.log(`  DGTK-3292 in allIssues: ${allIssueKeySet.has('DGTK-3292')}`);
console.log();

// Step 3: Fetch missing involved issues
console.log('Step 3: Fetch missing involved issues...');
const missingKeys = Array.from(involvedKeys).filter(k => !allIssueKeySet.has(k));
console.log(`  Missing keys count: ${missingKeys.length}`);
let missingIssues = [];
if (missingKeys.length > 0) {
  const keyList = missingKeys.map(k => `"${k}"`).join(', ');
  const r4 = await client.post('/rest/api/3/search/jql', {
    jql: `issueKey IN (${keyList})`,
    maxResults: missingKeys.length,
    fields: ['summary', 'status', 'labels']
  });
  missingIssues = r4.data.issues || [];
  console.log(`  Fetched ${missingIssues.length} missing issues`);
  console.log(`  DGTK-3112 in missingIssues: ${missingIssues.some(i => i.key === 'DGTK-3112')}`);
  console.log(`  DGTK-3292 in missingIssues: ${missingIssues.some(i => i.key === 'DGTK-3292')}`);
}
console.log();

// Step 4: enrichWithCommentInvolvement - precise verification
console.log('Step 4: Precise comment verification...');
const allPool = [...allIssues, ...missingIssues];
const confirmedInvolved = new Set(involvedKeys); // start with JQL-confirmed keys

// For comment candidates (not yet confirmed by precise check), verify
const toVerify = Array.from(commentCandidates).filter(k => !r1.data.issues?.some(i => i.key === k));
console.log(`  Keys to verify via comment API: ${toVerify.length}`);

// Check DGTK-3112 specifically
if (involvedKeys.has('DGTK-3112')) {
  const r5 = await client.get('/rest/api/3/issue/DGTK-3112/comment', { params: { maxResults: 100 } });
  const comments = r5.data.comments || [];
  const clarkComment = comments.find(c => c.author?.accountId === MY_ACCOUNT_ID);
  console.log(`  DGTK-3112: Clark commented = ${!!clarkComment}`);
  if (!clarkComment) {
    // Remove from confirmed if no precise match
    confirmedInvolved.delete('DGTK-3112');
    console.log('  DGTK-3112: Removed (false positive from comment ~ JQL)');
  }
}
console.log();

// Step 5: Final result with statusFilter
console.log('Step 5: Final result with statusFilter=["Closed"]...');
const statusSet = new Set(STATUS_FILTER);
const finalResult = allPool
  .filter(i => confirmedInvolved.has(i.key))
  .filter(i => statusSet.has(i.fields.status?.name));

// Deduplicate
const seen = new Set();
const deduped = finalResult.filter(i => {
  if (seen.has(i.key)) return false;
  seen.add(i.key);
  return true;
});

console.log(`  Final result count: ${deduped.length}`);
console.log(`  DGTK-3112 in result: ${deduped.some(i => i.key === 'DGTK-3112')} ← expected: true`);
console.log(`  DGTK-3292 in result: ${deduped.some(i => i.key === 'DGTK-3292')} ← expected: true`);
console.log();
console.log('All issues:');
for (const i of deduped) {
  console.log(`  ${i.key}: ${i.fields.summary?.slice(0, 60)} | status=${i.fields.status?.name}`);
}
