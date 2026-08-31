CREATE TABLE `audit_event` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`actor_type` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`actor_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`action` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`entity_type` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`entity_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`before_summary` json,
	`after_summary` json,
	`correlation_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`occurred_at_utc` datetime(6) NOT NULL,
	CONSTRAINT `audit_event_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Append-only platform audit events; application-enforced';
--> statement-breakpoint
CREATE TABLE `job_run` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`job_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`attempt_no` smallint unsigned NOT NULL,
	`lease_token` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`lease_owner` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`started_at_utc` datetime(6) NOT NULL,
	`completed_at_utc` datetime(6),
	`outcome` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'running',
	`correlation_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`error_code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	CONSTRAINT `job_run_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_job_run_job_attempt` UNIQUE(`job_id`,`attempt_no`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable platform job attempt history';
--> statement-breakpoint
CREATE TABLE `outbox_event` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`event_type` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`schema_version` int unsigned NOT NULL,
	`payload` json NOT NULL,
	`idempotency_key` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`available_at_utc` datetime(6) NOT NULL,
	`status` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
	`attempt_count` smallint unsigned NOT NULL DEFAULT 0,
	`max_attempts` smallint unsigned NOT NULL,
	`lease_owner` varchar(128) CHARACTER SET ascii COLLATE ascii_bin,
	`lease_token` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`lease_expires_at_utc` datetime(6),
	`delivered_at_utc` datetime(6),
	`last_error_code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `outbox_event_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_outbox_event_idempotency` UNIQUE(`idempotency_key`),
	CONSTRAINT `uq_outbox_event_lease_token` UNIQUE(`lease_token`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Durable platform outbox events for idempotent adapters';
--> statement-breakpoint
CREATE TABLE `scheduled_job` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`job_type` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`payload_schema_version` int unsigned NOT NULL,
	`payload` json NOT NULL,
	`scheduled_at_utc` datetime(6) NOT NULL,
	`available_at_utc` datetime(6) NOT NULL,
	`status` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
	`attempt_count` smallint unsigned NOT NULL DEFAULT 0,
	`max_attempts` smallint unsigned NOT NULL,
	`lease_owner` varchar(128) CHARACTER SET ascii COLLATE ascii_bin,
	`lease_token` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`lease_expires_at_utc` datetime(6),
	`idempotency_key` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`last_error_code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `scheduled_job_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_scheduled_job_type_idempotency` UNIQUE(`job_type`,`idempotency_key`),
	CONSTRAINT `uq_scheduled_job_lease_token` UNIQUE(`lease_token`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Leased platform jobs with database idempotency fencing';
--> statement-breakpoint
ALTER TABLE `job_run` ADD CONSTRAINT `fk_job_run_scheduled_job` FOREIGN KEY (`job_id`) REFERENCES `scheduled_job`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_audit_event_entity_occurred` ON `audit_event` (`entity_type`,`entity_id`,`occurred_at_utc`);--> statement-breakpoint
CREATE INDEX `idx_audit_event_correlation_occurred` ON `audit_event` (`correlation_id`,`occurred_at_utc`);--> statement-breakpoint
CREATE INDEX `idx_job_run_job_started` ON `job_run` (`job_id`,`started_at_utc`);--> statement-breakpoint
CREATE INDEX `idx_job_run_correlation_started` ON `job_run` (`correlation_id`,`started_at_utc`);--> statement-breakpoint
CREATE INDEX `idx_outbox_event_claim_ready` ON `outbox_event` (`status`,`available_at_utc`,`id`);--> statement-breakpoint
CREATE INDEX `idx_outbox_event_claim_expired` ON `outbox_event` (`status`,`lease_expires_at_utc`,`id`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_job_claim_ready` ON `scheduled_job` (`status`,`available_at_utc`,`id`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_job_claim_expired` ON `scheduled_job` (`status`,`lease_expires_at_utc`,`id`);
