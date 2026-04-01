CREATE TABLE `hidden_issues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`issueKey` varchar(32) NOT NULL,
	`projectKey` varchar(32) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hidden_issues_id` PRIMARY KEY(`id`),
	CONSTRAINT `hidden_issues_issueKey_unique` UNIQUE(`issueKey`)
);
--> statement-breakpoint
CREATE TABLE `watched_issues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`issueKey` varchar(32) NOT NULL,
	`projectKey` varchar(32) NOT NULL,
	`note` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `watched_issues_id` PRIMARY KEY(`id`),
	CONSTRAINT `watched_issues_issueKey_unique` UNIQUE(`issueKey`)
);
