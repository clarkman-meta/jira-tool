CREATE TABLE `jira_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`codename` varchar(128),
	`color` varchar(32) DEFAULT '#6366f1',
	`jiraBaseUrl` varchar(256) DEFAULT 'https://metarl.atlassian.net',
	`sortOrder` int DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `jira_projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `jira_projects_key_unique` UNIQUE(`key`)
);
