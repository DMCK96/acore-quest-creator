CREATE TABLE `connection_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`user` text NOT NULL,
	`database` text NOT NULL,
	`password_enc` blob NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`quest_id` integer NOT NULL,
	`is_new` integer NOT NULL,
	`aggregate` text NOT NULL,
	`snapshot` text,
	`fidelity` text,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`last_export_path` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_project_quest_uq` ON `drafts` (`project_id`,`quest_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`id_range_start` integer NOT NULL,
	`id_range_end` integer NOT NULL,
	`output_dir` text NOT NULL,
	`viewport` text DEFAULT '{"x":0,"y":0,"zoom":1}' NOT NULL
);
