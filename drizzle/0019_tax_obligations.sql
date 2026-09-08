CREATE TABLE `tax_obligation` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`tax_type` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`period_month` date NOT NULL,
	`description` varchar(191) NOT NULL,
	`due_on` date NOT NULL,
	`system_output_vat_amount` decimal(19,4) NOT NULL DEFAULT '0.0000',
	`system_input_vat_amount` decimal(19,4) NOT NULL DEFAULT '0.0000',
	`carried_vat_credit_amount` decimal(19,4) NOT NULL DEFAULT '0.0000',
	`manual_adjustment_amount` decimal(19,4) NOT NULL DEFAULT '0.0000',
	`payable_amount` decimal(19,4) NOT NULL,
	`closing_vat_credit_amount` decimal(19,4) NOT NULL DEFAULT '0.0000',
	`currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TRY',
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'planned',
	`paid_on` date,
	`note` varchar(2000),
	`void_reason` varchar(2000),
	`voided_at_utc` datetime(6),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `tax_obligation_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tax_obligation_client_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `uq_tax_obligation_type_period` UNIQUE(`tax_type`,`period_month`),
	CONSTRAINT `chk_tax_obligation_identity` CHECK(OCTET_LENGTH(`tax_obligation`.`id`) = 36
        AND BINARY `tax_obligation`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`tax_obligation`.`client_operation_key`) = 36
        AND BINARY `tax_obligation`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_tax_obligation_type_period` CHECK(BINARY `tax_obligation`.`tax_type` IN (
          BINARY 'vat', BINARY 'income_tax', BINARY 'provisional_tax'
        )
        AND DAYOFMONTH(`tax_obligation`.`period_month`) = 1),
	CONSTRAINT `chk_tax_obligation_text` CHECK(CHAR_LENGTH(`tax_obligation`.`description`) BETWEEN 1 AND 191
        AND `tax_obligation`.`description` = TRIM(`tax_obligation`.`description`)
        AND (`tax_obligation`.`note` IS NULL OR CHAR_LENGTH(`tax_obligation`.`note`) BETWEEN 1 AND 2000)),
	CONSTRAINT `chk_tax_obligation_amounts` CHECK(`tax_obligation`.`system_output_vat_amount` >= 0
        AND `tax_obligation`.`system_input_vat_amount` >= 0
        AND `tax_obligation`.`carried_vat_credit_amount` >= 0
        AND `tax_obligation`.`payable_amount` >= 0
        AND `tax_obligation`.`closing_vat_credit_amount` >= 0
        AND BINARY `tax_obligation`.`currency` = BINARY 'TRY'),
	CONSTRAINT `chk_tax_obligation_tax_shape` CHECK((
          BINARY `tax_obligation`.`tax_type` = BINARY 'vat'
          AND `tax_obligation`.`payable_amount` = GREATEST(
            `tax_obligation`.`system_output_vat_amount` - `tax_obligation`.`system_input_vat_amount`
              - `tax_obligation`.`carried_vat_credit_amount` + `tax_obligation`.`manual_adjustment_amount`,
            0
          )
          AND `tax_obligation`.`closing_vat_credit_amount` = GREATEST(
            0 - (
              `tax_obligation`.`system_output_vat_amount` - `tax_obligation`.`system_input_vat_amount`
                - `tax_obligation`.`carried_vat_credit_amount` + `tax_obligation`.`manual_adjustment_amount`
            ),
            0
          )
        ) OR (
          BINARY `tax_obligation`.`tax_type` IN (
            BINARY 'income_tax', BINARY 'provisional_tax'
          )
          AND `tax_obligation`.`system_output_vat_amount` = 0
          AND `tax_obligation`.`system_input_vat_amount` = 0
          AND `tax_obligation`.`carried_vat_credit_amount` = 0
          AND `tax_obligation`.`manual_adjustment_amount` = 0
          AND `tax_obligation`.`closing_vat_credit_amount` = 0
          AND `tax_obligation`.`payable_amount` > 0
        )),
	CONSTRAINT `chk_tax_obligation_state` CHECK((
          BINARY `tax_obligation`.`status` = BINARY 'planned'
          AND `tax_obligation`.`paid_on` IS NULL
          AND `tax_obligation`.`void_reason` IS NULL
          AND `tax_obligation`.`voided_at_utc` IS NULL
        ) OR (
          BINARY `tax_obligation`.`status` = BINARY 'paid'
          AND `tax_obligation`.`paid_on` IS NOT NULL
          AND `tax_obligation`.`void_reason` IS NULL
          AND `tax_obligation`.`voided_at_utc` IS NULL
        ) OR (
          BINARY `tax_obligation`.`status` = BINARY 'voided'
          AND `tax_obligation`.`paid_on` IS NULL
          AND `tax_obligation`.`void_reason` IS NOT NULL
          AND CHAR_LENGTH(TRIM(`tax_obligation`.`void_reason`)) BETWEEN 3 AND 2000
          AND `tax_obligation`.`voided_at_utc` IS NOT NULL
        )),
	CONSTRAINT `chk_tax_obligation_version` CHECK(`tax_obligation`.`version` >= 1),
	CONSTRAINT `chk_tax_obligation_timeline` CHECK(`tax_obligation`.`created_at_utc` <= `tax_obligation`.`updated_at_utc`
        AND (`tax_obligation`.`voided_at_utc` IS NULL OR (
          `tax_obligation`.`created_at_utc` <= `tax_obligation`.`voided_at_utc`
          AND `tax_obligation`.`voided_at_utc` <= `tax_obligation`.`updated_at_utc`
	        )))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE INDEX `idx_tax_obligation_status_due` ON `tax_obligation` (`status`,`due_on`,`id`);--> statement-breakpoint
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
        BINARY 'finance.taxes.read', BINARY 'finance.taxes.write',
        BINARY 'finance.reports.read', BINARY 'finance.reports.export',
        BINARY 'audit.read'
      ));
