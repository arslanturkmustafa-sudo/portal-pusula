CREATE TABLE `customer_project` (
	`customer_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `pk_customer_project` PRIMARY KEY(`customer_id`,`project_id`),
	CONSTRAINT `chk_customer_project_identity` CHECK(OCTET_LENGTH(`customer_project`.`customer_id`) = 36
        AND BINARY `customer_project`.`customer_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`customer_project`.`project_id`) = 36
        AND BINARY `customer_project`.`project_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_customer_project_status` CHECK(BINARY `customer_project`.`status` IN (BINARY 'active', BINARY 'inactive')),
	CONSTRAINT `chk_customer_project_version` CHECK(`customer_project`.`version` >= 1),
	CONSTRAINT `chk_customer_project_timeline` CHECK(`customer_project`.`created_at_utc` <= `customer_project`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `partnership_commission` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`transaction_type` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`description` varchar(191) NOT NULL,
	`closed_on` date NOT NULL,
	`commission_basis_amount` decimal(19,4) NOT NULL,
	`contribution_mode` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`share_rate` decimal(5,4) NOT NULL,
	`share_amount` decimal(19,4) NOT NULL,
	`status` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'expected',
	`agency_collected_on` date,
	`paid_on` date,
	`note` varchar(2000),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `partnership_commission_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_partnership_commission_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `chk_partnership_commission_identity` CHECK(OCTET_LENGTH(`partnership_commission`.`id`) = 36
        AND BINARY `partnership_commission`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`partnership_commission`.`client_operation_key`) = 36
        AND BINARY `partnership_commission`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`partnership_commission`.`project_id`) = 36
        AND BINARY `partnership_commission`.`project_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_partnership_commission_kind` CHECK(BINARY `partnership_commission`.`transaction_type` IN (BINARY 'sale', BINARY 'rental')
        AND BINARY `partnership_commission`.`contribution_mode` IN (
          BINARY 'partner_only', BINARY 'user_one_side', BINARY 'user_both'
        )),
	CONSTRAINT `chk_partnership_commission_text` CHECK(CHAR_LENGTH(`partnership_commission`.`description`) BETWEEN 1 AND 191
        AND `partnership_commission`.`description` = TRIM(`partnership_commission`.`description`)
        AND (`partnership_commission`.`note` IS NULL OR CHAR_LENGTH(`partnership_commission`.`note`) BETWEEN 1 AND 2000)),
	CONSTRAINT `chk_partnership_commission_amount` CHECK(`partnership_commission`.`commission_basis_amount` > 0
        AND `partnership_commission`.`share_rate` IN (0.1000, 0.2500, 0.5000)
        AND `partnership_commission`.`share_amount` = ROUND(`partnership_commission`.`commission_basis_amount` * `partnership_commission`.`share_rate`, 4)),
	CONSTRAINT `chk_partnership_commission_rate` CHECK((
          BINARY `partnership_commission`.`contribution_mode` = BINARY 'partner_only'
          AND `partnership_commission`.`share_rate` = 0.1000
        ) OR (
          BINARY `partnership_commission`.`contribution_mode` = BINARY 'user_one_side'
          AND `partnership_commission`.`share_rate` = 0.2500
        ) OR (
          BINARY `partnership_commission`.`contribution_mode` = BINARY 'user_both'
          AND `partnership_commission`.`share_rate` = 0.5000
        )),
	CONSTRAINT `chk_partnership_commission_status` CHECK(BINARY `partnership_commission`.`status` IN (
        BINARY 'expected', BINARY 'agency_collected', BINARY 'paid',
        BINARY 'cancelled'
      )),
	CONSTRAINT `chk_partnership_commission_payment` CHECK((
          BINARY `partnership_commission`.`status` IN (BINARY 'expected', BINARY 'cancelled')
          AND `partnership_commission`.`agency_collected_on` IS NULL
          AND `partnership_commission`.`paid_on` IS NULL
        ) OR (
          BINARY `partnership_commission`.`status` = BINARY 'agency_collected'
          AND `partnership_commission`.`agency_collected_on` IS NOT NULL
          AND `partnership_commission`.`closed_on` <= `partnership_commission`.`agency_collected_on`
          AND `partnership_commission`.`paid_on` IS NULL
        ) OR (
          BINARY `partnership_commission`.`status` = BINARY 'paid'
          AND `partnership_commission`.`agency_collected_on` IS NOT NULL
          AND `partnership_commission`.`paid_on` IS NOT NULL
          AND `partnership_commission`.`closed_on` <= `partnership_commission`.`agency_collected_on`
          AND `partnership_commission`.`agency_collected_on` <= `partnership_commission`.`paid_on`
        )),
	CONSTRAINT `chk_partnership_commission_version` CHECK(`partnership_commission`.`version` >= 1),
	CONSTRAINT `chk_partnership_commission_timeline` CHECK(`partnership_commission`.`created_at_utc` <= `partnership_commission`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `partnership_contribution` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`contribution_month` date NOT NULL,
	`description` varchar(191) NOT NULL,
	`expected_amount` decimal(19,4) NOT NULL,
	`due_on` date NOT NULL,
	`received_amount` decimal(19,4) NOT NULL DEFAULT '0.0000',
	`received_on` date,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'expected',
	`note` varchar(2000),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `partnership_contribution_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_partnership_contribution_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `uq_partnership_contribution_month` UNIQUE(`project_id`,`contribution_month`),
	CONSTRAINT `chk_partnership_contribution_identity` CHECK(OCTET_LENGTH(`partnership_contribution`.`id`) = 36
        AND BINARY `partnership_contribution`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`partnership_contribution`.`client_operation_key`) = 36
        AND BINARY `partnership_contribution`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`partnership_contribution`.`project_id`) = 36
        AND BINARY `partnership_contribution`.`project_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_partnership_contribution_text` CHECK(CHAR_LENGTH(`partnership_contribution`.`description`) BETWEEN 1 AND 191
        AND `partnership_contribution`.`description` = TRIM(`partnership_contribution`.`description`)
        AND (`partnership_contribution`.`note` IS NULL OR CHAR_LENGTH(`partnership_contribution`.`note`) BETWEEN 1 AND 2000)),
	CONSTRAINT `chk_partnership_contribution_period` CHECK(DAYOFMONTH(`partnership_contribution`.`contribution_month`) = 1
        AND `partnership_contribution`.`contribution_month` <= `partnership_contribution`.`due_on`),
	CONSTRAINT `chk_partnership_contribution_amount` CHECK(`partnership_contribution`.`expected_amount` > 0
        AND `partnership_contribution`.`received_amount` >= 0
        AND `partnership_contribution`.`received_amount` <= `partnership_contribution`.`expected_amount`),
	CONSTRAINT `chk_partnership_contribution_status` CHECK((
          BINARY `partnership_contribution`.`status` = BINARY 'expected'
          AND `partnership_contribution`.`received_amount` = 0
          AND `partnership_contribution`.`received_on` IS NULL
        ) OR (
          BINARY `partnership_contribution`.`status` = BINARY 'partial'
          AND `partnership_contribution`.`received_amount` > 0
          AND `partnership_contribution`.`received_amount` < `partnership_contribution`.`expected_amount`
          AND `partnership_contribution`.`received_on` IS NOT NULL
        ) OR (
          BINARY `partnership_contribution`.`status` = BINARY 'received'
          AND `partnership_contribution`.`received_amount` = `partnership_contribution`.`expected_amount`
          AND `partnership_contribution`.`received_on` IS NOT NULL
        ) OR (
          BINARY `partnership_contribution`.`status` = BINARY 'cancelled'
          AND `partnership_contribution`.`received_amount` = 0
          AND `partnership_contribution`.`received_on` IS NULL
        )),
	CONSTRAINT `chk_partnership_contribution_version` CHECK(`partnership_contribution`.`version` >= 1),
	CONSTRAINT `chk_partnership_contribution_timeline` CHECK(`partnership_contribution`.`created_at_utc` <= `partnership_contribution`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `partnership_contribution_receipt` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`contribution_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`amount` decimal(19,4) NOT NULL,
	`received_on` date NOT NULL,
	`note` varchar(2000),
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `partnership_contribution_receipt_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_partnership_contribution_receipt_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `chk_partnership_contribution_receipt_identity` CHECK(OCTET_LENGTH(`partnership_contribution_receipt`.`id`) = 36
        AND BINARY `partnership_contribution_receipt`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`partnership_contribution_receipt`.`client_operation_key`) = 36
        AND BINARY `partnership_contribution_receipt`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`partnership_contribution_receipt`.`contribution_id`) = 36
        AND BINARY `partnership_contribution_receipt`.`contribution_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_partnership_contribution_receipt_amount` CHECK(`partnership_contribution_receipt`.`amount` > 0),
	CONSTRAINT `chk_partnership_contribution_receipt_note` CHECK(`partnership_contribution_receipt`.`note` IS NULL OR CHAR_LENGTH(`partnership_contribution_receipt`.`note`) BETWEEN 1 AND 2000)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `customer_project` ADD CONSTRAINT `fk_customer_project_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `customer_project` ADD CONSTRAINT `fk_customer_project_project` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `partnership_commission` ADD CONSTRAINT `fk_partnership_commission_project` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `partnership_contribution` ADD CONSTRAINT `fk_partnership_contribution_project` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `partnership_contribution_receipt` ADD CONSTRAINT `fk_partnership_contribution_receipt_contribution` FOREIGN KEY (`contribution_id`) REFERENCES `partnership_contribution`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_customer_project_project_status_customer` ON `customer_project` (`project_id`,`status`,`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_partnership_commission_project_status_date` ON `partnership_commission` (`project_id`,`status`,`closed_on`,`id`);--> statement-breakpoint
CREATE INDEX `idx_partnership_contribution_project_status_due` ON `partnership_contribution` (`project_id`,`status`,`due_on`,`id`);--> statement-breakpoint
CREATE INDEX `idx_partnership_contribution_receipt_parent_date` ON `partnership_contribution_receipt` (`contribution_id`,`received_on`,`id`);--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD `project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `receivable` ADD `project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
INSERT INTO `customer_project` (`customer_id`, `project_id`, `status`, `version`, `created_at_utc`, `updated_at_utc`) SELECT `seed`.`customer_id`, `seed`.`project_id`, 'active', 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6) FROM (SELECT `customer`.`id` AS `customer_id`, `project`.`id` AS `project_id` FROM `customer` CROSS JOIN `project` WHERE BINARY `project`.`short_code` = BINARY 'MUHENDIS_KAFASI' UNION DISTINCT SELECT `work_task`.`customer_id` AS `customer_id`, `work_task_project`.`project_id` AS `project_id` FROM `work_task` JOIN `work_task_project` ON `work_task_project`.`task_id` = `work_task`.`id` WHERE `work_task`.`customer_id` IS NOT NULL) AS `seed`;--> statement-breakpoint
UPDATE `consulting_contract` JOIN `project` ON BINARY `project`.`short_code` = BINARY 'MUHENDIS_KAFASI' SET `consulting_contract`.`project_id` = `project`.`id` WHERE `consulting_contract`.`project_id` IS NULL;--> statement-breakpoint
UPDATE `receivable` LEFT JOIN `consulting_contract` ON `consulting_contract`.`id` = `receivable`.`contract_id` JOIN `project` ON BINARY `project`.`short_code` = BINARY 'MUHENDIS_KAFASI' SET `receivable`.`project_id` = COALESCE(`consulting_contract`.`project_id`, `project`.`id`) WHERE `receivable`.`project_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_consulting_contract_customer_project_start` ON `consulting_contract` (`customer_id`,`project_id`,`starts_on`);--> statement-breakpoint
CREATE INDEX `idx_consulting_contract_customer_project_status` ON `consulting_contract` (`customer_id`,`project_id`,`status`,`ends_on`);--> statement-breakpoint
CREATE INDEX `idx_receivable_customer_project` ON `receivable` (`customer_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_receivable_project_due` ON `receivable` (`project_id`,`due_on`,`customer_id`);--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD CONSTRAINT `fk_consulting_contract_customer_project` FOREIGN KEY (`customer_id`,`project_id`) REFERENCES `customer_project`(`customer_id`,`project_id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `receivable` ADD CONSTRAINT `fk_receivable_customer_project` FOREIGN KEY (`customer_id`,`project_id`) REFERENCES `customer_project`(`customer_id`,`project_id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
DROP INDEX `uq_consulting_contract_customer_start` ON `consulting_contract`;
