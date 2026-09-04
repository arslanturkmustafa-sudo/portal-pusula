ALTER TABLE `consulting_contract` DROP CONSTRAINT `chk_consulting_contract_timeline`;--> statement-breakpoint
ALTER TABLE `customer` DROP CONSTRAINT `chk_customer_timeline`;--> statement-breakpoint
ALTER TABLE `project` DROP CONSTRAINT `chk_project_timeline`;--> statement-breakpoint
ALTER TABLE `user_permission` DROP CONSTRAINT `chk_user_permission_code`;--> statement-breakpoint
ALTER TABLE `work_task` DROP CONSTRAINT `chk_work_task_status`;--> statement-breakpoint
ALTER TABLE `work_task` DROP CONSTRAINT `chk_work_task_timeline`;--> statement-breakpoint
DROP INDEX `idx_consulting_contract_customer_status` ON `consulting_contract`;--> statement-breakpoint
DROP INDEX `idx_customer_status_name` ON `customer`;--> statement-breakpoint
DROP INDEX `idx_project_status_name` ON `project`;--> statement-breakpoint
DROP INDEX `idx_work_task_board` ON `work_task`;--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD `archive_reason` varchar(500);--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD `archived_at_utc` datetime(6);--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD `archived_by_user_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD `version` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `customer` ADD `archive_reason` varchar(500);--> statement-breakpoint
ALTER TABLE `customer` ADD `archived_at_utc` datetime(6);--> statement-breakpoint
ALTER TABLE `customer` ADD `archived_by_user_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `customer` ADD `version` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `project` ADD `archive_reason` varchar(500);--> statement-breakpoint
ALTER TABLE `project` ADD `archived_at_utc` datetime(6);--> statement-breakpoint
ALTER TABLE `project` ADD `archived_by_user_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `work_task` ADD `archive_reason` varchar(500);--> statement-breakpoint
ALTER TABLE `work_task` ADD `archived_at_utc` datetime(6);--> statement-breakpoint
ALTER TABLE `work_task` ADD `archived_by_user_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD CONSTRAINT `chk_consulting_contract_version` CHECK (`consulting_contract`.`version` >= 1);--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD CONSTRAINT `chk_consulting_contract_archive` CHECK ((
          `consulting_contract`.`archived_at_utc` IS NULL
          AND `consulting_contract`.`archived_by_user_account_id` IS NULL
          AND `consulting_contract`.`archive_reason` IS NULL
        ) OR (
          `consulting_contract`.`archived_at_utc` IS NOT NULL
          AND `consulting_contract`.`archived_by_user_account_id` IS NOT NULL
          AND `consulting_contract`.`archive_reason` IS NOT NULL
          AND CHAR_LENGTH(`consulting_contract`.`archive_reason`) BETWEEN 1 AND 500
          AND `consulting_contract`.`archive_reason` = TRIM(`consulting_contract`.`archive_reason`)
          AND BINARY `consulting_contract`.`status` = BINARY 'closed'
        ));--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD CONSTRAINT `chk_consulting_contract_timeline` CHECK (`consulting_contract`.`created_at_utc` <= `consulting_contract`.`updated_at_utc`
        AND (
          `consulting_contract`.`archived_at_utc` IS NULL
          OR (
            `consulting_contract`.`created_at_utc` <= `consulting_contract`.`archived_at_utc`
            AND `consulting_contract`.`archived_at_utc` <= `consulting_contract`.`updated_at_utc`
          )
        ));--> statement-breakpoint
ALTER TABLE `customer` ADD CONSTRAINT `chk_customer_version` CHECK (`customer`.`version` >= 1);--> statement-breakpoint
ALTER TABLE `customer` ADD CONSTRAINT `chk_customer_archive` CHECK ((
          `customer`.`archived_at_utc` IS NULL
          AND `customer`.`archived_by_user_account_id` IS NULL
          AND `customer`.`archive_reason` IS NULL
        ) OR (
          `customer`.`archived_at_utc` IS NOT NULL
          AND `customer`.`archived_by_user_account_id` IS NOT NULL
          AND `customer`.`archive_reason` IS NOT NULL
          AND CHAR_LENGTH(`customer`.`archive_reason`) BETWEEN 1 AND 500
          AND `customer`.`archive_reason` = TRIM(`customer`.`archive_reason`)
          AND BINARY `customer`.`status` = BINARY 'inactive'
        ));--> statement-breakpoint
ALTER TABLE `customer` ADD CONSTRAINT `chk_customer_timeline` CHECK (`customer`.`created_at_utc` <= `customer`.`updated_at_utc`
        AND (
          `customer`.`archived_at_utc` IS NULL
          OR (
            `customer`.`created_at_utc` <= `customer`.`archived_at_utc`
            AND `customer`.`archived_at_utc` <= `customer`.`updated_at_utc`
          )
        ));--> statement-breakpoint
ALTER TABLE `project` ADD CONSTRAINT `chk_project_archive` CHECK ((
          `project`.`archived_at_utc` IS NULL
          AND `project`.`archived_by_user_account_id` IS NULL
          AND `project`.`archive_reason` IS NULL
        ) OR (
          `project`.`archived_at_utc` IS NOT NULL
          AND `project`.`archived_by_user_account_id` IS NOT NULL
          AND `project`.`archive_reason` IS NOT NULL
          AND CHAR_LENGTH(`project`.`archive_reason`) BETWEEN 1 AND 500
          AND `project`.`archive_reason` = TRIM(`project`.`archive_reason`)
          AND BINARY `project`.`status` IN (BINARY 'completed', BINARY 'cancelled')
        ));--> statement-breakpoint
ALTER TABLE `project` ADD CONSTRAINT `chk_project_timeline` CHECK (`project`.`created_at_utc` <= `project`.`updated_at_utc`
        AND (
          `project`.`closed_at_utc` IS NULL
          OR (
            `project`.`created_at_utc` <= `project`.`closed_at_utc`
            AND `project`.`closed_at_utc` <= `project`.`updated_at_utc`
          )
        )
        AND (
          `project`.`archived_at_utc` IS NULL
          OR (
            `project`.`created_at_utc` <= `project`.`archived_at_utc`
            AND `project`.`archived_at_utc` <= `project`.`updated_at_utc`
          )
        ));--> statement-breakpoint
ALTER TABLE `user_permission` ADD CONSTRAINT `chk_user_permission_code` CHECK (BINARY `user_permission`.`permission_code` IN (
        BINARY 'accounts.manage',
        BINARY 'customers.read', BINARY 'customers.write', BINARY 'customers.lifecycle',
        BINARY 'customers.contact.read',
        BINARY 'contracts.read', BINARY 'contracts.write', BINARY 'contracts.lifecycle',
        BINARY 'contracts.billing.read', BINARY 'contracts.billing.write',
        BINARY 'visits.read', BINARY 'visits.write', BINARY 'daily-plan.read',
        BINARY 'projects.read', BINARY 'projects.write', BINARY 'projects.lifecycle',
        BINARY 'tasks.read', BINARY 'tasks.write', BINARY 'tasks.lifecycle', BINARY 'tasks.assign',
        BINARY 'tasks.reports.export',
        BINARY 'finance.receivables.read', BINARY 'finance.receivables.write',
        BINARY 'finance.receivables.reverse',
        BINARY 'finance.expenses.read', BINARY 'finance.expenses.write',
        BINARY 'finance.expenses.reverse',
        BINARY 'finance.cards.read', BINARY 'finance.cards.write',
        BINARY 'finance.partnership.read', BINARY 'finance.partnership.write',
        BINARY 'finance.partnership.reverse',
        BINARY 'finance.reports.read', BINARY 'finance.reports.export',
        BINARY 'audit.read'
      ));--> statement-breakpoint
ALTER TABLE `work_task` ADD CONSTRAINT `chk_work_task_archive` CHECK ((
          `work_task`.`archived_at_utc` IS NULL
          AND `work_task`.`archived_by_user_account_id` IS NULL
          AND `work_task`.`archive_reason` IS NULL
        ) OR (
          `work_task`.`archived_at_utc` IS NOT NULL
          AND `work_task`.`archived_by_user_account_id` IS NOT NULL
          AND `work_task`.`archive_reason` IS NOT NULL
          AND CHAR_LENGTH(`work_task`.`archive_reason`) BETWEEN 1 AND 500
          AND `work_task`.`archive_reason` = TRIM(`work_task`.`archive_reason`)
          AND BINARY `work_task`.`status` IN (BINARY 'done', BINARY 'cancelled')
        ));--> statement-breakpoint
ALTER TABLE `work_task` ADD CONSTRAINT `chk_work_task_status` CHECK (BINARY `work_task`.`status` IN (
        BINARY 'backlog', BINARY 'todo', BINARY 'in_progress',
        BINARY 'blocked', BINARY 'done', BINARY 'cancelled'
      ));--> statement-breakpoint
ALTER TABLE `work_task` ADD CONSTRAINT `chk_work_task_timeline` CHECK (`work_task`.`created_at_utc` <= `work_task`.`updated_at_utc`
        AND (
          `work_task`.`completed_at_utc` IS NULL
          OR (
            `work_task`.`created_at_utc` <= `work_task`.`completed_at_utc`
            AND `work_task`.`completed_at_utc` <= `work_task`.`updated_at_utc`
          )
        )
        AND (
          `work_task`.`archived_at_utc` IS NULL
          OR (
            `work_task`.`created_at_utc` <= `work_task`.`archived_at_utc`
            AND `work_task`.`archived_at_utc` <= `work_task`.`updated_at_utc`
          )
        ));--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD CONSTRAINT `fk_consulting_contract_archived_by` FOREIGN KEY (`archived_by_user_account_id`) REFERENCES `user_account`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `customer` ADD CONSTRAINT `fk_customer_archived_by` FOREIGN KEY (`archived_by_user_account_id`) REFERENCES `user_account`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `project` ADD CONSTRAINT `fk_project_archived_by` FOREIGN KEY (`archived_by_user_account_id`) REFERENCES `user_account`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `work_task` ADD CONSTRAINT `fk_work_task_archived_by` FOREIGN KEY (`archived_by_user_account_id`) REFERENCES `user_account`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_consulting_contract_customer_status` ON `consulting_contract` (`customer_id`,`archived_at_utc`,`status`,`ends_on`);--> statement-breakpoint
CREATE INDEX `idx_customer_status_name` ON `customer` (`archived_at_utc`,`status`,`display_name`);--> statement-breakpoint
CREATE INDEX `idx_project_status_name` ON `project` (`archived_at_utc`,`status`,`display_name`);--> statement-breakpoint
CREATE INDEX `idx_work_task_board` ON `work_task` (`archived_at_utc`,`status`,`due_on`,`updated_at_utc`);
