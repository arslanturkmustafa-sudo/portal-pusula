CREATE TABLE `work_task` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`customer_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`assignee_user_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`title` varchar(191) NOT NULL,
	`description` varchar(4000),
	`status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'backlog',
	`priority` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'normal',
	`due_on` date,
	`completed_at_utc` datetime(6),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `work_task_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_work_task_identity` CHECK(OCTET_LENGTH(`work_task`.`id`) = 36
        AND BINARY `work_task`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (`work_task`.`customer_id` IS NULL OR (
          OCTET_LENGTH(`work_task`.`customer_id`) = 36
          AND BINARY `work_task`.`customer_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`work_task`.`assignee_user_account_id` IS NULL OR (
          OCTET_LENGTH(`work_task`.`assignee_user_account_id`) = 36
          AND BINARY `work_task`.`assignee_user_account_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))),
	CONSTRAINT `chk_work_task_title` CHECK(CHAR_LENGTH(`work_task`.`title`) BETWEEN 1 AND 191
        AND `work_task`.`title` = TRIM(`work_task`.`title`)),
	CONSTRAINT `chk_work_task_description` CHECK(`work_task`.`description` IS NULL
        OR CHAR_LENGTH(`work_task`.`description`) BETWEEN 1 AND 4000),
	CONSTRAINT `chk_work_task_status` CHECK(BINARY `work_task`.`status` IN (
        BINARY 'backlog', BINARY 'todo', BINARY 'in_progress',
        BINARY 'blocked', BINARY 'done'
      )),
	CONSTRAINT `chk_work_task_priority` CHECK(BINARY `work_task`.`priority` IN (
        BINARY 'low', BINARY 'normal', BINARY 'high', BINARY 'urgent'
      )),
	CONSTRAINT `chk_work_task_completion` CHECK((
        `work_task`.`status` = 'done'
        AND `work_task`.`completed_at_utc` IS NOT NULL
      ) OR (
        `work_task`.`status` <> 'done'
        AND `work_task`.`completed_at_utc` IS NULL
      )),
	CONSTRAINT `chk_work_task_version` CHECK(`work_task`.`version` >= 1),
	CONSTRAINT `chk_work_task_timeline` CHECK(`work_task`.`created_at_utc` <= `work_task`.`updated_at_utc`
        AND (
          `work_task`.`completed_at_utc` IS NULL
          OR (
            `work_task`.`created_at_utc` <= `work_task`.`completed_at_utc`
            AND `work_task`.`completed_at_utc` <= `work_task`.`updated_at_utc`
          )
        ))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `work_task` ADD CONSTRAINT `fk_work_task_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `work_task` ADD CONSTRAINT `fk_work_task_assignee` FOREIGN KEY (`assignee_user_account_id`) REFERENCES `user_account`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_work_task_board` ON `work_task` (`status`,`due_on`,`updated_at_utc`);--> statement-breakpoint
CREATE INDEX `idx_work_task_customer_status` ON `work_task` (`customer_id`,`status`,`due_on`);--> statement-breakpoint
CREATE INDEX `idx_work_task_assignee_status` ON `work_task` (`assignee_user_account_id`,`status`,`due_on`);
