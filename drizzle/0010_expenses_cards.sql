CREATE TABLE `credit_card` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`display_name` varchar(191) NOT NULL,
	`bank_name` varchar(191),
	`last_four` char(4) CHARACTER SET ascii COLLATE ascii_bin,
	`statement_closing_day` tinyint unsigned NOT NULL,
	`payment_due_day` tinyint unsigned NOT NULL,
	`credit_limit_amount` decimal(19,4),
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
	`note` varchar(2000),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `credit_card_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_credit_card_client_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `chk_credit_card_identity` CHECK(OCTET_LENGTH(`credit_card`.`id`) = 36
        AND BINARY `credit_card`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`credit_card`.`client_operation_key`) = 36
        AND BINARY `credit_card`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_credit_card_display_name` CHECK(CHAR_LENGTH(`credit_card`.`display_name`) BETWEEN 1 AND 191
        AND `credit_card`.`display_name` = TRIM(`credit_card`.`display_name`)),
	CONSTRAINT `chk_credit_card_optional_fields` CHECK((`credit_card`.`bank_name` IS NULL OR (
          CHAR_LENGTH(`credit_card`.`bank_name`) BETWEEN 1 AND 191
          AND `credit_card`.`bank_name` = TRIM(`credit_card`.`bank_name`)
        ))
        AND (`credit_card`.`last_four` IS NULL OR BINARY `credit_card`.`last_four` REGEXP '^[0-9]{4}$')
        AND (`credit_card`.`note` IS NULL OR CHAR_LENGTH(`credit_card`.`note`) BETWEEN 1 AND 2000)),
	CONSTRAINT `chk_credit_card_cycle` CHECK(`credit_card`.`statement_closing_day` BETWEEN 1 AND 31
        AND `credit_card`.`payment_due_day` BETWEEN 1 AND 31),
	CONSTRAINT `chk_credit_card_limit` CHECK(`credit_card`.`credit_limit_amount` IS NULL OR `credit_card`.`credit_limit_amount` > 0),
	CONSTRAINT `chk_credit_card_status` CHECK(BINARY `credit_card`.`status` IN (BINARY 'active', BINARY 'inactive')),
	CONSTRAINT `chk_credit_card_version` CHECK(`credit_card`.`version` >= 1),
	CONSTRAINT `chk_credit_card_timeline` CHECK(`credit_card`.`created_at_utc` <= `credit_card`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `credit_card_installment` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`expense_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`installment_number` smallint unsigned NOT NULL,
	`installment_count` smallint unsigned NOT NULL,
	`statement_month` date NOT NULL,
	`due_on` date NOT NULL,
	`amount` decimal(19,4) NOT NULL,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'planned',
	`paid_on` date,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `credit_card_installment_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_credit_card_installment_expense_no` UNIQUE(`expense_id`,`installment_number`),
	CONSTRAINT `chk_credit_card_installment_identity` CHECK(OCTET_LENGTH(`credit_card_installment`.`id`) = 36
        AND BINARY `credit_card_installment`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`credit_card_installment`.`expense_id`) = 36
        AND BINARY `credit_card_installment`.`expense_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_credit_card_installment_sequence` CHECK(`credit_card_installment`.`installment_number` BETWEEN 1 AND `credit_card_installment`.`installment_count`
        AND `credit_card_installment`.`installment_count` BETWEEN 1 AND 36),
	CONSTRAINT `chk_credit_card_installment_schedule` CHECK(DAYOFMONTH(`credit_card_installment`.`statement_month`) = 1
        AND `credit_card_installment`.`statement_month` <= `credit_card_installment`.`due_on`
        AND `credit_card_installment`.`amount` > 0),
	CONSTRAINT `chk_credit_card_installment_payment` CHECK((
          BINARY `credit_card_installment`.`status` = BINARY 'planned'
          AND `credit_card_installment`.`paid_on` IS NULL
        ) OR (
          BINARY `credit_card_installment`.`status` = BINARY 'paid'
          AND `credit_card_installment`.`paid_on` IS NOT NULL
        )),
	CONSTRAINT `chk_credit_card_installment_version` CHECK(`credit_card_installment`.`version` >= 1),
	CONSTRAINT `chk_credit_card_installment_timeline` CHECK(`credit_card_installment`.`created_at_utc` <= `credit_card_installment`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `expense` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`credit_card_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`incurred_on` date NOT NULL,
	`category` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`description` varchar(191) NOT NULL,
	`vendor_name` varchar(191),
	`document_type` varchar(16) CHARACTER SET ascii COLLATE ascii_bin,
	`document_number` varchar(64),
	`payment_method` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`net_amount` decimal(19,4) NOT NULL,
	`vat_amount` decimal(19,4) NOT NULL,
	`total_amount` decimal(19,4) NOT NULL,
	`currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TRY',
	`installment_count` smallint unsigned NOT NULL DEFAULT 1,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
	`void_reason` varchar(2000),
	`voided_at_utc` datetime(6),
	`note` varchar(2000),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `expense_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_expense_client_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `chk_expense_identity` CHECK(OCTET_LENGTH(`expense`.`id`) = 36
        AND BINARY `expense`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`expense`.`client_operation_key`) = 36
        AND BINARY `expense`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (`expense`.`project_id` IS NULL OR (
          OCTET_LENGTH(`expense`.`project_id`) = 36
          AND BINARY `expense`.`project_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`expense`.`credit_card_id` IS NULL OR (
          OCTET_LENGTH(`expense`.`credit_card_id`) = 36
          AND BINARY `expense`.`credit_card_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))),
	CONSTRAINT `chk_expense_category` CHECK(BINARY `expense`.`category` IN (
        BINARY 'rent', BINARY 'software_subscription',
        BINARY 'transportation', BINARY 'meals_hospitality',
        BINARY 'marketing', BINARY 'office', BINARY 'external_service',
        BINARY 'tax_fee', BINARY 'other'
      )),
	CONSTRAINT `chk_expense_description` CHECK(CHAR_LENGTH(`expense`.`description`) BETWEEN 1 AND 191
        AND `expense`.`description` = TRIM(`expense`.`description`)),
	CONSTRAINT `chk_expense_optional_text` CHECK((`expense`.`vendor_name` IS NULL OR (
          CHAR_LENGTH(`expense`.`vendor_name`) BETWEEN 1 AND 191
          AND `expense`.`vendor_name` = TRIM(`expense`.`vendor_name`)
        ))
        AND (`expense`.`document_number` IS NULL OR (
          CHAR_LENGTH(`expense`.`document_number`) BETWEEN 1 AND 64
          AND `expense`.`document_number` = TRIM(`expense`.`document_number`)
        ))
        AND (`expense`.`note` IS NULL OR CHAR_LENGTH(`expense`.`note`) BETWEEN 1 AND 2000)),
	CONSTRAINT `chk_expense_document` CHECK((`expense`.`document_type` IS NULL AND `expense`.`document_number` IS NULL)
        OR (`expense`.`document_type` IS NOT NULL AND BINARY `expense`.`document_type` IN (
          BINARY 'invoice', BINARY 'receipt', BINARY 'other'
        ))),
	CONSTRAINT `chk_expense_payment_shape` CHECK((
          BINARY `expense`.`payment_method` = BINARY 'credit_card'
          AND `expense`.`credit_card_id` IS NOT NULL
          AND `expense`.`installment_count` BETWEEN 1 AND 36
        ) OR (
          BINARY `expense`.`payment_method` IN (
            BINARY 'cash', BINARY 'bank_transfer', BINARY 'other'
          )
          AND `expense`.`credit_card_id` IS NULL
          AND `expense`.`installment_count` = 1
        )),
	CONSTRAINT `chk_expense_amounts` CHECK(`expense`.`net_amount` >= 0
        AND `expense`.`vat_amount` >= 0
        AND `expense`.`total_amount` > 0
        AND `expense`.`total_amount` = `expense`.`net_amount` + `expense`.`vat_amount`
        AND BINARY `expense`.`currency` = BINARY 'TRY'),
	CONSTRAINT `chk_expense_status` CHECK(BINARY `expense`.`status` IN (BINARY 'active', BINARY 'voided')),
	CONSTRAINT `chk_expense_void_shape` CHECK((
          BINARY `expense`.`status` = BINARY 'active'
          AND `expense`.`void_reason` IS NULL
          AND `expense`.`voided_at_utc` IS NULL
        ) OR (
          BINARY `expense`.`status` = BINARY 'voided'
          AND `expense`.`void_reason` IS NOT NULL
          AND CHAR_LENGTH(TRIM(`expense`.`void_reason`)) BETWEEN 1 AND 2000
          AND `expense`.`voided_at_utc` IS NOT NULL
        )),
	CONSTRAINT `chk_expense_version` CHECK(`expense`.`version` >= 1),
	CONSTRAINT `chk_expense_timeline` CHECK(`expense`.`created_at_utc` <= `expense`.`updated_at_utc`
        AND (
          `expense`.`voided_at_utc` IS NULL
          OR (
            `expense`.`created_at_utc` <= `expense`.`voided_at_utc`
            AND `expense`.`voided_at_utc` <= `expense`.`updated_at_utc`
          )
        ))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `credit_card_installment` ADD CONSTRAINT `fk_credit_card_installment_expense` FOREIGN KEY (`expense_id`) REFERENCES `expense`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `expense` ADD CONSTRAINT `fk_expense_project` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `expense` ADD CONSTRAINT `fk_expense_credit_card` FOREIGN KEY (`credit_card_id`) REFERENCES `credit_card`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_credit_card_status_name` ON `credit_card` (`status`,`display_name`);--> statement-breakpoint
CREATE INDEX `idx_credit_card_installment_due_status` ON `credit_card_installment` (`status`,`due_on`,`id`);--> statement-breakpoint
CREATE INDEX `idx_credit_card_installment_statement` ON `credit_card_installment` (`statement_month`,`status`,`due_on`);--> statement-breakpoint
CREATE INDEX `idx_expense_project_date` ON `expense` (`project_id`,`incurred_on`,`id`);--> statement-breakpoint
CREATE INDEX `idx_expense_card_date` ON `expense` (`credit_card_id`,`incurred_on`,`id`);--> statement-breakpoint
CREATE INDEX `idx_expense_status_date` ON `expense` (`status`,`incurred_on`,`id`);
