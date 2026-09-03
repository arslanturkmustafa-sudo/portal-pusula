CREATE TABLE `project` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`display_name` varchar(191) NOT NULL,
	`short_code` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`project_type` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'planned',
	`objective` varchar(4000),
	`starts_on` date,
	`target_ends_on` date,
	`budget_amount` decimal(19,4),
	`currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TRY',
	`internal_note` varchar(2000),
	`closed_at_utc` datetime(6),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `project_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_project_short_code` UNIQUE(`short_code`),
	CONSTRAINT `chk_project_identity` CHECK(OCTET_LENGTH(`project`.`id`) = 36
        AND BINARY `project`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_project_display_name` CHECK(CHAR_LENGTH(`project`.`display_name`) BETWEEN 1 AND 191
        AND `project`.`display_name` = TRIM(`project`.`display_name`)),
	CONSTRAINT `chk_project_short_code` CHECK(BINARY `project`.`short_code` REGEXP '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
	CONSTRAINT `chk_project_type` CHECK(BINARY `project`.`project_type` IN (
        BINARY 'consulting', BINARY 'product', BINARY 'partnership',
        BINARY 'internal'
      )),
	CONSTRAINT `chk_project_status` CHECK(BINARY `project`.`status` IN (
        BINARY 'planned', BINARY 'active', BINARY 'on_hold',
        BINARY 'completed', BINARY 'cancelled'
      )),
	CONSTRAINT `chk_project_optional_text` CHECK((`project`.`objective` IS NULL OR CHAR_LENGTH(`project`.`objective`) BETWEEN 1 AND 4000)
        AND (`project`.`internal_note` IS NULL OR CHAR_LENGTH(`project`.`internal_note`) BETWEEN 1 AND 2000)),
	CONSTRAINT `chk_project_period` CHECK(`project`.`starts_on` IS NULL
        OR `project`.`target_ends_on` IS NULL
        OR `project`.`starts_on` <= `project`.`target_ends_on`),
	CONSTRAINT `chk_project_budget` CHECK((`project`.`budget_amount` IS NULL OR `project`.`budget_amount` >= 0)
        AND BINARY `project`.`currency` = BINARY 'TRY'),
	CONSTRAINT `chk_project_closure` CHECK((
          BINARY `project`.`status` IN (BINARY 'completed', BINARY 'cancelled')
          AND `project`.`closed_at_utc` IS NOT NULL
        ) OR (
          BINARY `project`.`status` NOT IN (BINARY 'completed', BINARY 'cancelled')
          AND `project`.`closed_at_utc` IS NULL
        )),
	CONSTRAINT `chk_project_version` CHECK(`project`.`version` >= 1),
	CONSTRAINT `chk_project_timeline` CHECK(`project`.`created_at_utc` <= `project`.`updated_at_utc`
        AND (
          `project`.`closed_at_utc` IS NULL
          OR (
            `project`.`created_at_utc` <= `project`.`closed_at_utc`
            AND `project`.`closed_at_utc` <= `project`.`updated_at_utc`
          )
        ))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `work_task_project` (
	`task_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `pk_work_task_project` PRIMARY KEY(`task_id`),
	CONSTRAINT `chk_work_task_project_identity` CHECK(OCTET_LENGTH(`work_task_project`.`task_id`) = 36
        AND BINARY `work_task_project`.`task_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`work_task_project`.`project_id`) = 36
        AND BINARY `work_task_project`.`project_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_work_task_project_timeline` CHECK(`work_task_project`.`created_at_utc` <= `work_task_project`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `work_task_project` ADD CONSTRAINT `fk_work_task_project_task` FOREIGN KEY (`task_id`) REFERENCES `work_task`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `work_task_project` ADD CONSTRAINT `fk_work_task_project_project` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_project_status_name` ON `project` (`status`,`display_name`);--> statement-breakpoint
CREATE INDEX `idx_project_type_status` ON `project` (`project_type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_work_task_project_project_task` ON `work_task_project` (`project_id`,`task_id`);
