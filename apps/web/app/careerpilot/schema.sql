CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`hash` text NOT NULL,
	`name` text NOT NULL,
	`last_seen` integer NOT NULL,
	`created` integer NOT NULL
);

CREATE UNIQUE INDEX `devices_hash_unique` ON `devices` (`hash`);
CREATE INDEX `devices_owner` ON `devices` (`owner`);
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`updated` integer NOT NULL
);

CREATE INDEX `records_owner_kind` ON `records` (`owner`,`kind`);
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`application_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`lease` text,
	`device_id` text,
	`updated` integer NOT NULL,
	`created` integer NOT NULL
);

CREATE INDEX `tasks_owner_status` ON `tasks` (`owner`,`status`);
CREATE UNIQUE INDEX `tasks_active_application` ON `tasks` (`owner`,`application_id`) WHERE "tasks"."status" IN ('queued','running');