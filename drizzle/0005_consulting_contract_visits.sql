CREATE TABLE `consulting_contract` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`customer_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
	`starts_on` date NOT NULL,
	`ends_on` date NOT NULL,
	`monthly_fee_amount` decimal(19,4) NOT NULL,
	`currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TRY',
	`vat_mode` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`vat_rate` decimal(5,2) NOT NULL,
	`payment_day` int unsigned NOT NULL,
	`internal_note` varchar(2000),
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `consulting_contract_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_consulting_contract_customer_start` UNIQUE(`customer_id`,`starts_on`),
	CONSTRAINT `chk_consulting_contract_identity` CHECK(OCTET_LENGTH(`consulting_contract`.`id`) = 36
        AND BINARY `consulting_contract`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`consulting_contract`.`customer_id`) = 36
        AND BINARY `consulting_contract`.`customer_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_consulting_contract_status` CHECK(BINARY `consulting_contract`.`status` IN (BINARY 'draft', BINARY 'active', BINARY 'closed')),
	CONSTRAINT `chk_consulting_contract_terms` CHECK(`consulting_contract`.`starts_on` <= `consulting_contract`.`ends_on`
        AND `consulting_contract`.`monthly_fee_amount` > 0
        AND BINARY `consulting_contract`.`currency` = BINARY 'TRY'
        AND BINARY `consulting_contract`.`vat_mode` IN (BINARY 'exempt', BINARY 'exclusive', BINARY 'inclusive')
        AND (
          (`consulting_contract`.`vat_mode` = 'exempt' AND `consulting_contract`.`vat_rate` = 0)
          OR (`consulting_contract`.`vat_mode` IN ('exclusive', 'inclusive') AND `consulting_contract`.`vat_rate` > 0 AND `consulting_contract`.`vat_rate` <= 100)
        )
        AND `consulting_contract`.`payment_day` BETWEEN 1 AND 31),
	CONSTRAINT `chk_consulting_contract_optional_fields` CHECK(`consulting_contract`.`internal_note` IS NULL OR CHAR_LENGTH(`consulting_contract`.`internal_note`) BETWEEN 1 AND 2000),
	CONSTRAINT `chk_consulting_contract_timeline` CHECK(`consulting_contract`.`created_at_utc` <= `consulting_contract`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `monthly_visit_commitment` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`contract_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`committed_on` date NOT NULL,
	`resolution_status` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'planned',
	`internal_planned_at_utc` datetime(6),
	`internal_duration_minutes` smallint unsigned,
	`delivered_on` date,
	`resolution_note` varchar(2000),
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `monthly_visit_commitment_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_monthly_visit_contract_day` UNIQUE(`contract_id`,`committed_on`),
	CONSTRAINT `chk_monthly_visit_identity` CHECK(OCTET_LENGTH(`monthly_visit_commitment`.`id`) = 36
        AND BINARY `monthly_visit_commitment`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`monthly_visit_commitment`.`contract_id`) = 36
        AND BINARY `monthly_visit_commitment`.`contract_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_monthly_visit_status` CHECK(BINARY `monthly_visit_commitment`.`resolution_status` IN (
        BINARY 'planned', BINARY 'completed', BINARY 'makeup_pending',
        BINARY 'cancelled_by_agreement'
      )),
	CONSTRAINT `chk_monthly_visit_internal_plan` CHECK((
        `monthly_visit_commitment`.`internal_planned_at_utc` IS NULL
        AND `monthly_visit_commitment`.`internal_duration_minutes` IS NULL
      ) OR (
        `monthly_visit_commitment`.`internal_planned_at_utc` IS NOT NULL
        AND `monthly_visit_commitment`.`internal_duration_minutes` IS NOT NULL
        AND `monthly_visit_commitment`.`internal_duration_minutes` BETWEEN 15 AND 720
      )),
	CONSTRAINT `chk_monthly_visit_resolution` CHECK((
        `monthly_visit_commitment`.`resolution_status` = 'completed'
        AND `monthly_visit_commitment`.`delivered_on` IS NOT NULL
        AND EXTRACT(YEAR_MONTH FROM `monthly_visit_commitment`.`delivered_on`) = EXTRACT(YEAR_MONTH FROM `monthly_visit_commitment`.`committed_on`)
      ) OR (
        `monthly_visit_commitment`.`resolution_status` <> 'completed'
        AND `monthly_visit_commitment`.`delivered_on` IS NULL
      )),
	CONSTRAINT `chk_monthly_visit_cancellation_note` CHECK(`monthly_visit_commitment`.`resolution_status` <> 'cancelled_by_agreement'
        OR (
          `monthly_visit_commitment`.`resolution_note` IS NOT NULL
          AND CHAR_LENGTH(`monthly_visit_commitment`.`resolution_note`) BETWEEN 1 AND 2000
        )),
	CONSTRAINT `chk_monthly_visit_optional_fields` CHECK(`monthly_visit_commitment`.`resolution_note` IS NULL OR CHAR_LENGTH(`monthly_visit_commitment`.`resolution_note`) BETWEEN 1 AND 2000),
	CONSTRAINT `chk_monthly_visit_timeline` CHECK(`monthly_visit_commitment`.`created_at_utc` <= `monthly_visit_commitment`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `consulting_contract` ADD CONSTRAINT `fk_consulting_contract_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `monthly_visit_commitment` ADD CONSTRAINT `fk_monthly_visit_contract` FOREIGN KEY (`contract_id`) REFERENCES `consulting_contract`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_consulting_contract_customer_status` ON `consulting_contract` (`customer_id`,`status`,`ends_on`);--> statement-breakpoint
CREATE INDEX `idx_monthly_visit_contract_month` ON `monthly_visit_commitment` (`contract_id`,`committed_on`,`resolution_status`);
