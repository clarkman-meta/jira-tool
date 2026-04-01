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
