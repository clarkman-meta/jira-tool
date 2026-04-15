const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.JIRA_BASE_URL;
const EMAIL = process.env.JIRA_EMAIL;
const TOKEN = process.env.JIRA_API_TOKEN;
const MY_ID = process.env.JIRA_MY_ACCOUNT_ID;
const auth = { username: EMAIL, password: TOKEN };

async function paginateJql(jql, fields) {
  const PAGE_SIZE = 100;
  const allKeys = [];
  let nextPageToken = undefined;
  let pageCount = 0;
  do {
    const body = { jql, maxResults: PAGE_SIZE, fields: fields || ['key'] };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const res = await axios.post(BASE_URL + '/rest/api/3/search/jql', body, { auth });
    const data = res.data;
    allKeys.push(...(data.issues || []).map(i => i.key));
    nextPageToken = (data.isLast === false && data.nextPageToken) ? data.nextPageToken : undefined;
    pageCount++;
  } while (nextPageToken && pageCount < 50);
  return allKeys;
}

async function run() {
  console.log('MY_ID:', MY_ID);

  // 1. Simulate exact fetchOpenIssues for DGTK Closed
  console.log('\n=== fetchOpenIssues: DGTK Closed (full pagination) ===');
  const closedKeys = await paginateJql('project = DGTK AND status IN ("Closed") ORDER BY updated DESC');
  console.log('Total Closed fetched:', closedKeys.length);
  console.log('Has DGTK-3292:', closedKeys.includes('DGTK-3292'));
  console.log('Has DGTK-3112:', closedKeys.includes('DGTK-3112'));

  // 2. Involvement: assignee OR reporter OR watcher (no comment)
  console.log('\n=== Involvement (no comment): assignee OR reporter OR watcher ===');
  const invJql = 'project = DGTK AND (assignee = "' + MY_ID + '" OR reporter = "' + MY_ID + '" OR watcher = "' + MY_ID + '")';
  const invKeys = await paginateJql(invJql);
  console.log('Involvement count:', invKeys.length);
  console.log('Has DGTK-3292:', invKeys.includes('DGTK-3292'));
  console.log('Has DGTK-3112:', invKeys.includes('DGTK-3112'));

  // 3. Test comment ~ "Clark Hsu" on DGTK-3112
  console.log('\n=== comment ~ "Clark Hsu" on DGTK-3112 ===');
  const r1 = await axios.post(BASE_URL + '/rest/api/3/search/jql',
    { jql: 'issue = DGTK-3112 AND comment ~ "Clark Hsu"', fields: ['key'], maxResults: 1 }, { auth });
  console.log('Match:', r1.data.issues?.length > 0 ? 'YES' : 'NO');

  // 4. Try fetching issues where I commented via comment API
  console.log('\n=== Comment API: search comments by my accountId ===');
  try {
    // Jira Cloud comment search endpoint
    const r2 = await axios.get(BASE_URL + '/rest/api/3/comment/search', {
      params: { accountId: MY_ID, maxResults: 10 },
      auth
    });
    console.log('Comment search works:', r2.data);
  } catch(e) {
    console.log('Comment search API error:', e.response?.status, e.response?.data?.message || e.message);
  }

  // 5. Try activity stream / user activity
  console.log('\n=== Try comment ~ with mention format ===');
  // In Jira ADF, mentions are stored differently - try searching for accountId in comment text
  const r3 = await axios.post(BASE_URL + '/rest/api/3/search/jql',
    { jql: 'issue = DGTK-3112 AND comment ~ "' + MY_ID + '"', fields: ['key'], maxResults: 1 }, { auth });
  console.log('comment ~ accountId match:', r3.data.issues?.length > 0 ? 'YES' : 'NO');

  // 6. Check if issueFunction in commented works
  console.log('\n=== issueFunction in commented ===');
  try {
    const r4 = await axios.post(BASE_URL + '/rest/api/3/search/jql',
      { jql: 'project = DGTK AND issueFunction in commented("by ' + MY_ID + '")', fields: ['key'], maxResults: 5 }, { auth });
    console.log('issueFunction commented:', r4.data.issues?.length, 'issues');
  } catch(e) {
    console.log('issueFunction error:', e.response?.data?.errorMessages?.[0] || e.message);
  }
}

run().catch(e => {
  if (e.response) console.error('API Error:', JSON.stringify(e.response.data));
  else console.error(e.message);
});
