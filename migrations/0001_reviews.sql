CREATE TABLE IF NOT EXISTS `badge_assets` (
	`hash` text PRIMARY KEY NOT NULL,
	`media_type` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `badge_events` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`document` text NOT NULL,
	`created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `badge_events_review` ON `badge_events` (`review_id`,`created_at`);
CREATE TABLE IF NOT EXISTS `badge_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`document` text NOT NULL,
	`created_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `badge_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`generation` integer NOT NULL,
	`kind` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`available_at` integer NOT NULL,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text
);

CREATE INDEX IF NOT EXISTS `badge_jobs_due` ON `badge_jobs` (`state`,`available_at`,`lease_until`);
CREATE TABLE IF NOT EXISTS `badge_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`version` integer NOT NULL,
	`document` text NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `badge_reviews_thread` ON `badge_reviews` (`thread_id`);