CREATE TABLE `finance_account` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`account_type` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`display_name` varchar(191) NOT NULL,
	`bank_name` varchar(191),
	`currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TRY',
	`opening_balance_amount` decimal(19,4) NOT NULL,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `finance_account_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_finance_account_client_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `chk_finance_account_identity` CHECK(OCTET_LENGTH(`finance_account`.`id`) = 36
        AND BINARY `finance_account`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`finance_account`.`client_operation_key`) = 36
        AND BINARY `finance_account`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_finance_account_type` CHECK(BINARY `finance_account`.`account_type` IN (BINARY 'cash', BINARY 'bank')),
	CONSTRAINT `chk_finance_account_display_name` CHECK(CHAR_LENGTH(`finance_account`.`display_name`) BETWEEN 1 AND 191
        AND `finance_account`.`display_name` = TRIM(`finance_account`.`display_name`)),
	CONSTRAINT `chk_finance_account_bank_shape` CHECK((
          BINARY `finance_account`.`account_type` = BINARY 'cash'
          AND `finance_account`.`bank_name` IS NULL
        ) OR (
          BINARY `finance_account`.`account_type` = BINARY 'bank'
          AND (
            `finance_account`.`bank_name` IS NULL
            OR (
              CHAR_LENGTH(`finance_account`.`bank_name`) BETWEEN 1 AND 191
              AND `finance_account`.`bank_name` = TRIM(`finance_account`.`bank_name`)
            )
          )
        )),
	CONSTRAINT `chk_finance_account_currency` CHECK(BINARY `finance_account`.`currency` = BINARY 'TRY'),
	CONSTRAINT `chk_finance_account_status` CHECK(BINARY `finance_account`.`status` IN (BINARY 'active', BINARY 'inactive')),
	CONSTRAINT `chk_finance_account_version` CHECK(`finance_account`.`version` >= 1),
	CONSTRAINT `chk_finance_account_timeline` CHECK(`finance_account`.`created_at_utc` <= `finance_account`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `finance_ledger_entry` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`transaction_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`entry_side` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`amount` decimal(19,4) NOT NULL,
	`currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TRY',
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `finance_ledger_entry_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_finance_ledger_transaction_side` UNIQUE(`transaction_id`,`entry_side`),
	CONSTRAINT `uq_finance_ledger_transaction_account` UNIQUE(`transaction_id`,`account_id`),
	CONSTRAINT `chk_finance_ledger_entry_identity` CHECK(OCTET_LENGTH(`finance_ledger_entry`.`id`) = 36
        AND BINARY `finance_ledger_entry`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`finance_ledger_entry`.`transaction_id`) = 36
        AND BINARY `finance_ledger_entry`.`transaction_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`finance_ledger_entry`.`account_id`) = 36
        AND BINARY `finance_ledger_entry`.`account_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_finance_ledger_entry_side` CHECK(BINARY `finance_ledger_entry`.`entry_side` IN (BINARY 'inflow', BINARY 'outflow')),
	CONSTRAINT `chk_finance_ledger_entry_amount` CHECK(`finance_ledger_entry`.`amount` > 0 AND BINARY `finance_ledger_entry`.`currency` = BINARY 'TRY')
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `finance_transaction` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`transaction_type` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`occurred_on` date NOT NULL,
	`description` varchar(191) NOT NULL,
	`amount` decimal(19,4) NOT NULL,
	`currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TRY',
	`source_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`target_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`reversal_of_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`reversal_reason` varchar(2000),
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `finance_transaction_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_finance_transaction_client_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `uq_finance_transaction_reversal` UNIQUE(`reversal_of_id`),
	CONSTRAINT `chk_finance_transaction_identity` CHECK(OCTET_LENGTH(`finance_transaction`.`id`) = 36
        AND BINARY `finance_transaction`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`finance_transaction`.`client_operation_key`) = 36
        AND BINARY `finance_transaction`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (`finance_transaction`.`source_account_id` IS NULL OR (
          OCTET_LENGTH(`finance_transaction`.`source_account_id`) = 36
          AND BINARY `finance_transaction`.`source_account_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`finance_transaction`.`target_account_id` IS NULL OR (
          OCTET_LENGTH(`finance_transaction`.`target_account_id`) = 36
          AND BINARY `finance_transaction`.`target_account_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`finance_transaction`.`reversal_of_id` IS NULL OR (
          OCTET_LENGTH(`finance_transaction`.`reversal_of_id`) = 36
          AND BINARY `finance_transaction`.`reversal_of_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))),
	CONSTRAINT `chk_finance_transaction_shape` CHECK((
          BINARY `finance_transaction`.`transaction_type` = BINARY 'income'
          AND `finance_transaction`.`source_account_id` IS NULL
          AND `finance_transaction`.`target_account_id` IS NOT NULL
        ) OR (
          BINARY `finance_transaction`.`transaction_type` = BINARY 'expense'
          AND `finance_transaction`.`source_account_id` IS NOT NULL
          AND `finance_transaction`.`target_account_id` IS NULL
        ) OR (
          BINARY `finance_transaction`.`transaction_type` = BINARY 'transfer'
          AND `finance_transaction`.`source_account_id` IS NOT NULL
          AND `finance_transaction`.`target_account_id` IS NOT NULL
          AND BINARY `finance_transaction`.`source_account_id` <> BINARY `finance_transaction`.`target_account_id`
        )),
	CONSTRAINT `chk_finance_transaction_description` CHECK(CHAR_LENGTH(`finance_transaction`.`description`) BETWEEN 1 AND 191
        AND `finance_transaction`.`description` = TRIM(`finance_transaction`.`description`)),
	CONSTRAINT `chk_finance_transaction_amount` CHECK(`finance_transaction`.`amount` > 0 AND BINARY `finance_transaction`.`currency` = BINARY 'TRY'),
	CONSTRAINT `chk_finance_transaction_reversal` CHECK((
          `finance_transaction`.`reversal_of_id` IS NULL
          AND `finance_transaction`.`reversal_reason` IS NULL
        ) OR (
          `finance_transaction`.`reversal_of_id` IS NOT NULL
          AND BINARY `finance_transaction`.`reversal_of_id` <> BINARY `finance_transaction`.`id`
          AND `finance_transaction`.`reversal_reason` IS NOT NULL
          AND CHAR_LENGTH(`finance_transaction`.`reversal_reason`) BETWEEN 1 AND 2000
          AND `finance_transaction`.`reversal_reason` = TRIM(`finance_transaction`.`reversal_reason`)
        ))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `finance_ledger_entry` ADD CONSTRAINT `fk_finance_ledger_entry_transaction` FOREIGN KEY (`transaction_id`) REFERENCES `finance_transaction`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `finance_ledger_entry` ADD CONSTRAINT `fk_finance_ledger_entry_account` FOREIGN KEY (`account_id`) REFERENCES `finance_account`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `finance_transaction` ADD CONSTRAINT `fk_finance_transaction_source_account` FOREIGN KEY (`source_account_id`) REFERENCES `finance_account`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `finance_transaction` ADD CONSTRAINT `fk_finance_transaction_target_account` FOREIGN KEY (`target_account_id`) REFERENCES `finance_account`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `finance_transaction` ADD CONSTRAINT `fk_finance_transaction_reversal` FOREIGN KEY (`reversal_of_id`) REFERENCES `finance_transaction`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_finance_account_status_type_name` ON `finance_account` (`status`,`account_type`,`display_name`);--> statement-breakpoint
CREATE INDEX `idx_finance_ledger_account_created` ON `finance_ledger_entry` (`account_id`,`created_at_utc`,`id`);--> statement-breakpoint
CREATE INDEX `idx_finance_transaction_occurred` ON `finance_transaction` (`occurred_on`,`created_at_utc`,`id`);--> statement-breakpoint
CREATE INDEX `idx_finance_transaction_source_occurred` ON `finance_transaction` (`source_account_id`,`occurred_on`);--> statement-breakpoint
CREATE INDEX `idx_finance_transaction_target_occurred` ON `finance_transaction` (`target_account_id`,`occurred_on`);--> statement-breakpoint
ALTER TABLE `user_permission` DROP CONSTRAINT `chk_user_permission_code`;--> statement-breakpoint
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
        BINARY 'finance.accounts.read', BINARY 'finance.accounts.write',
        BINARY 'finance.partnership.read', BINARY 'finance.partnership.write',
        BINARY 'finance.partnership.reverse',
        BINARY 'finance.reports.read', BINARY 'finance.reports.export',
        BINARY 'audit.read'
      ));
