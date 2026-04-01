# Jira Issue Monitor - TODO

## Backend
- [x] Store Jira credentials (email + API token) as server-side secrets
- [x] Create project config table in DB (id, key, name, codename, color, jiraUrl, order)
- [x] Seed default projects: Dragon (DGTK), SSG (TPZ), Hypernova2 (KITE)
- [x] Build Jira API proxy tRPC route: fetch open issues with fields (key, summary, status, assignee, updated, comment)
- [x] Parse latest comment body from Jira ADF format to plain text
- [x] Build admin tRPC routes: list/add/edit/delete projects

## Frontend
- [x] Design system: dark elegant theme, color palette, typography (Inter font)
- [x] DashboardLayout with sidebar showing project list
- [x] Project issues page: sortable table with issue key, title, latest comment, status, assignee, updated
- [x] Highlight rows assigned to Clark Hsu (accountId: 712020:f04ded31-3e91-47eb-bad9-d5e624e2b95f)
- [x] Sort by: updated date, status, assignee, issue key
- [x] Auto-refresh toggle (every 5 min) + manual refresh button
- [x] Issue row click → open Jira issue in new tab
- [x] Admin page: list projects, add/edit/delete project entries
- [x] Responsive design

## Testing
- [x] Vitest: Jira API proxy route
- [x] Vitest: project CRUD routes (covered in jira.test.ts)

## New Columns (Round 2)
- [ ] Investigate Jira fields: priority (P0/P1/P2), reporter, fixVersions/customField for Build
- [ ] Update server/jira.ts to fetch reporter, fixVersions, and custom build fields
- [ ] Add Priority, Reporter, Build columns to the issue table in Dashboard.tsx
- [ ] Make new columns sortable
- [ ] Update vitest tests for new fields
- [x] Remove Build column from frontend table and backend jira.ts (not available in Dragon/SSG)
- [x] Add stage filter bar (SMT / FATP / All) that filters issues by keyword match in title and latest comment
- [x] For KITE project, show Build field (customfield_10433) in Priority column instead of standard priority
- [x] Set default sort to priority (asc) then updated (desc) as secondary
- [x] Exclude issues with status "Closed" from JQL query

## Watch List Feature
- [x] Add watched_issues and hidden_issues tables to DB schema
- [x] Add tRPC routes: list/add/remove watched issues, list/add/remove hidden issues
- [x] In issue table: pin watched issues to top with a star indicator, filter out hidden issues
- [x] Add Watch List management panel (sidebar or modal): input to add issue key, list to remove
- [x] Watched issues pinned to top of table (already in open issues list)

## Bug Fixes
- [x] Fix issue count discrepancy: implemented cursor-based pagination to fetch ALL pages (was only fetching first 100/200 issues)
- [x] Investigate why unrelated issues (e.g. Leo) appear in DGTK results — codename embedded in title only
- [x] Add titleFilter per-project keyword filter: server-side filtering by title keywords (comma-separated), configurable in Admin UI

## Round 4
- [x] Fetch real JQL filter from Diamond board (DGTK-234 board) and Hypernova2 dashboard (29923) and apply as titleFilter
- [x] Build Pinned Issues feature: add issue key → fetch from Jira → pin to top with special highlight + delete icon (PinnedIssuesMerger component, shows even if not in open list)
