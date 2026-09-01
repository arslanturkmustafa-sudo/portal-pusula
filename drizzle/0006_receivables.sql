CREATE TABLE `receivable` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`customer_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`contract_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`source_type` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`period_month` date,
	`due_on` date NOT NULL,
	`description` varchar(191) NOT NULL,
	`net_amount` decimal(19,4) NOT NULL,
	`vat_amount` decimal(19,4) NOT NULL,
	`total_amount` decimal(19,4) NOT NULL,
	`currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TRY',
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `receivable_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_receivable_contract_month` UNIQUE(`contract_id`,`source_type`,`period_month`),
	CONSTRAINT `uq_receivable_opening_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `chk_receivable_identity` CHECK(OCTET_LENGTH(`receivable`.`id`) = 36
        AND BINARY `receivable`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`receivable`.`customer_id`) = 36
        AND BINARY `receivable`.`customer_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (`receivable`.`client_operation_key` IS NULL OR (
          OCTET_LENGTH(`receivable`.`client_operation_key`) = 36
          AND BINARY `receivable`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`receivable`.`contract_id` IS NULL OR (
          OCTET_LENGTH(`receivable`.`contract_id`) = 36
          AND BINARY `receivable`.`contract_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))),
	CONSTRAINT `chk_receivable_source` CHECK((
          BINARY `receivable`.`source_type` = BINARY 'contract_month'
          AND `receivable`.`contract_id` IS NOT NULL
          AND `receivable`.`client_operation_key` IS NULL
          AND `receivable`.`period_month` IS NOT NULL
          AND DAYOFMONTH(`receivable`.`period_month`) = 1
        ) OR (
          BINARY `receivable`.`source_type` = BINARY 'opening_balance'
          AND `receivable`.`client_operation_key` IS NOT NULL
          AND `receivable`.`contract_id` IS NULL
          AND `receivable`.`period_month` IS NULL
        )),
	CONSTRAINT `chk_receivable_amounts` CHECK(`receivable`.`net_amount` >= 0
        AND `receivable`.`vat_amount` >= 0
        AND `receivable`.`total_amount` > 0
        AND `receivable`.`total_amount` = `receivable`.`net_amount` + `receivable`.`vat_amount`
        AND BINARY `receivable`.`currency` = BINARY 'TRY'),
	CONSTRAINT `chk_receivable_description` CHECK(CHAR_LENGTH(`receivable`.`description`) BETWEEN 1 AND 191
        AND `receivable`.`description` = TRIM(`receivable`.`description`)),
	CONSTRAINT `chk_receivable_timeline` CHECK(`receivable`.`created_at_utc` <= `receivable`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `receivable_collection` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`receivable_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`amount` decimal(19,4) NOT NULL,
	`collected_on` date NOT NULL,
	`note` varchar(2000),
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `receivable_collection_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_receivable_collection_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `chk_receivable_collection_identity` CHECK(OCTET_LENGTH(`receivable_collection`.`id`) = 36
        AND BINARY `receivable_collection`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`receivable_collection`.`client_operation_key`) = 36
        AND BINARY `receivable_collection`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`receivable_collection`.`receivable_id`) = 36
        AND BINARY `receivable_collection`.`receivable_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_receivable_collection_amount` CHECK(`receivable_collection`.`amount` > 0),
	CONSTRAINT `chk_receivable_collection_optional_fields` CHECK(`receivable_collection`.`note` IS NULL OR CHAR_LENGTH(`receivable_collection`.`note`) BETWEEN 1 AND 2000)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `receivable` ADD CONSTRAINT `fk_receivable_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `receivable` ADD CONSTRAINT `fk_receivable_contract` FOREIGN KEY (`contract_id`) REFERENCES `consulting_contract`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD CONSTRAINT `fk_receivable_collection_receivable` FOREIGN KEY (`receivable_id`) REFERENCES `receivable`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_receivable_due_on` ON `receivable` (`due_on`,`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_receivable_customer_created` ON `receivable` (`customer_id`,`created_at_utc`);--> statement-breakpoint
CREATE INDEX `idx_receivable_collection_receivable_date` ON `receivable_collection` (`receivable_id`,`collected_on`,`created_at_utc`);
