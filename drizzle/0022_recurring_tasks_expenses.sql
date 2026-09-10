CREATE TABLE `recurring_expense` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`credit_card_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`source_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`category` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`description` varchar(191) NOT NULL,
	`vendor_name` varchar(191),
	`payment_method` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`net_amount` decimal(19,4) NOT NULL,
	`vat_amount` decimal(19,4) NOT NULL,
	`total_amount` decimal(19,4) NOT NULL,
	`currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TRY',
	`frequency` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`anchor_day` tinyint unsigned NOT NULL,
	`next_due_on` date NOT NULL,
	`ends_on` date,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
	`note` varchar(2000),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `recurring_expense_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_recurring_expense_client_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `chk_recurring_expense_identity` CHECK(OCTET_LENGTH(`recurring_expense`.`id`) = 36
        AND BINARY `recurring_expense`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`recurring_expense`.`client_operation_key`) = 36
        AND BINARY `recurring_expense`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (`recurring_expense`.`project_id` IS NULL OR (
          OCTET_LENGTH(`recurring_expense`.`project_id`) = 36
          AND BINARY `recurring_expense`.`project_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`recurring_expense`.`credit_card_id` IS NULL OR (
          OCTET_LENGTH(`recurring_expense`.`credit_card_id`) = 36
          AND BINARY `recurring_expense`.`credit_card_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`recurring_expense`.`source_account_id` IS NULL OR (
          OCTET_LENGTH(`recurring_expense`.`source_account_id`) = 36
          AND BINARY `recurring_expense`.`source_account_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))),
	CONSTRAINT `chk_recurring_expense_category` CHECK(CHAR_LENGTH(`recurring_expense`.`category`) BETWEEN 1 AND 32
        AND BINARY `recurring_expense`.`category` REGEXP '^[a-z][a-z0-9_]{0,31}$'),
	CONSTRAINT `chk_recurring_expense_text` CHECK(CHAR_LENGTH(`recurring_expense`.`description`) BETWEEN 1 AND 191
        AND `recurring_expense`.`description` = TRIM(`recurring_expense`.`description`)
        AND (`recurring_expense`.`vendor_name` IS NULL OR (
          CHAR_LENGTH(`recurring_expense`.`vendor_name`) BETWEEN 1 AND 191
          AND `recurring_expense`.`vendor_name` = TRIM(`recurring_expense`.`vendor_name`)
        ))
        AND (`recurring_expense`.`note` IS NULL OR CHAR_LENGTH(`recurring_expense`.`note`) BETWEEN 1 AND 2000)),
	CONSTRAINT `chk_recurring_expense_payment_shape` CHECK((
          BINARY `recurring_expense`.`payment_method` = BINARY 'credit_card'
          AND `recurring_expense`.`credit_card_id` IS NOT NULL
          AND `recurring_expense`.`source_account_id` IS NULL
        ) OR (
          BINARY `recurring_expense`.`payment_method` IN (BINARY 'cash', BINARY 'bank_transfer')
          AND `recurring_expense`.`credit_card_id` IS NULL
          AND `recurring_expense`.`source_account_id` IS NOT NULL
        ) OR (
          BINARY `recurring_expense`.`payment_method` = BINARY 'other'
          AND `recurring_expense`.`credit_card_id` IS NULL
          AND `recurring_expense`.`source_account_id` IS NULL
        )),
	CONSTRAINT `chk_recurring_expense_amounts` CHECK(`recurring_expense`.`net_amount` >= 0
        AND `recurring_expense`.`vat_amount` >= 0
        AND `recurring_expense`.`total_amount` > 0
        AND `recurring_expense`.`total_amount` = `recurring_expense`.`net_amount` + `recurring_expense`.`vat_amount`
        AND BINARY `recurring_expense`.`currency` = BINARY 'TRY'),
	CONSTRAINT `chk_recurring_expense_schedule` CHECK(BINARY `recurring_expense`.`frequency` IN (BINARY 'weekly', BINARY 'monthly')
        AND `recurring_expense`.`anchor_day` BETWEEN 1 AND 31
        AND (
          BINARY `recurring_expense`.`status` = BINARY 'paused'
          OR `recurring_expense`.`ends_on` IS NULL
          OR `recurring_expense`.`next_due_on` <= `recurring_expense`.`ends_on`
        )),
	CONSTRAINT `chk_recurring_expense_status` CHECK(BINARY `recurring_expense`.`status` IN (BINARY 'active', BINARY 'paused')),
	CONSTRAINT `chk_recurring_expense_version` CHECK(`recurring_expense`.`version` >= 1),
	CONSTRAINT `chk_recurring_expense_timeline` CHECK(`recurring_expense`.`created_at_utc` <= `recurring_expense`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `work_task` ADD `recurrence_frequency` varchar(16) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `work_task` ADD `recurrence_anchor_day` tinyint unsigned;--> statement-breakpoint
ALTER TABLE `work_task` ADD `recurrence_ends_on` date;--> statement-breakpoint
ALTER TABLE `work_task` ADD `recurrence_series_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `work_task` ADD `recurrence_generated_from_task_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `work_task` ADD CONSTRAINT `uq_work_task_recurrence_source` UNIQUE(`recurrence_generated_from_task_id`);--> statement-breakpoint
ALTER TABLE `recurring_expense` ADD CONSTRAINT `fk_recurring_expense_project` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `recurring_expense` ADD CONSTRAINT `fk_recurring_expense_credit_card` FOREIGN KEY (`credit_card_id`) REFERENCES `credit_card`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `recurring_expense` ADD CONSTRAINT `fk_recurring_expense_source_account` FOREIGN KEY (`source_account_id`) REFERENCES `finance_account`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `recurring_expense` ADD CONSTRAINT `fk_recurring_expense_category` FOREIGN KEY (`category`) REFERENCES `expense_category`(`code`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_recurring_expense_status_due` ON `recurring_expense` (`status`,`next_due_on`,`id`);--> statement-breakpoint
CREATE INDEX `idx_recurring_expense_project_due` ON `recurring_expense` (`project_id`,`next_due_on`,`id`);--> statement-breakpoint
ALTER TABLE `work_task` ADD CONSTRAINT `chk_work_task_recurrence` CHECK ((
          `work_task`.`recurrence_frequency` IS NULL
          AND `work_task`.`recurrence_anchor_day` IS NULL
          AND `work_task`.`recurrence_ends_on` IS NULL
          AND `work_task`.`recurrence_series_id` IS NULL
        ) OR (
          `work_task`.`recurrence_frequency` IS NOT NULL
          AND BINARY `work_task`.`recurrence_frequency` IN (
            BINARY 'daily', BINARY 'weekly', BINARY 'monthly'
          )
          AND `work_task`.`recurrence_anchor_day` IS NOT NULL
          AND `work_task`.`recurrence_anchor_day` BETWEEN 1 AND 31
          AND `work_task`.`due_on` IS NOT NULL
          AND `work_task`.`recurrence_series_id` IS NOT NULL
          AND OCTET_LENGTH(`work_task`.`recurrence_series_id`) = 36
          AND BINARY `work_task`.`recurrence_series_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND (
            `work_task`.`recurrence_ends_on` IS NULL
            OR `work_task`.`recurrence_ends_on` >= `work_task`.`due_on`
          )
        ));--> statement-breakpoint
ALTER TABLE `work_task` ADD CONSTRAINT `chk_work_task_recurrence_source` CHECK (`work_task`.`recurrence_generated_from_task_id` IS NULL OR (
        OCTET_LENGTH(`work_task`.`recurrence_generated_from_task_id`) = 36
        AND BINARY `work_task`.`recurrence_generated_from_task_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND BINARY `work_task`.`recurrence_generated_from_task_id` <> BINARY `work_task`.`id`
      ));--> statement-breakpoint
ALTER TABLE `work_task` ADD CONSTRAINT `fk_work_task_recurrence_source` FOREIGN KEY (`recurrence_generated_from_task_id`) REFERENCES `work_task`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_work_task_recurrence_series` ON `work_task` (`recurrence_series_id`,`due_on`);
