CREATE TABLE `expense_category` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`code` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`display_name` varchar(191) NOT NULL,
	`is_system` tinyint unsigned NOT NULL DEFAULT 0,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `expense_category_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_expense_category_client_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `uq_expense_category_code` UNIQUE(`code`),
	CONSTRAINT `uq_expense_category_display_name` UNIQUE(`display_name`),
	CONSTRAINT `chk_expense_category_identity` CHECK(OCTET_LENGTH(`expense_category`.`id`) = 36
        AND BINARY `expense_category`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`expense_category`.`client_operation_key`) = 36
        AND BINARY `expense_category`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_expense_category_code` CHECK(CHAR_LENGTH(`expense_category`.`code`) BETWEEN 1 AND 32
        AND BINARY `expense_category`.`code` REGEXP '^[a-z][a-z0-9_]{0,31}$'),
	CONSTRAINT `chk_expense_category_display_name` CHECK(CHAR_LENGTH(`expense_category`.`display_name`) BETWEEN 1 AND 191
        AND `expense_category`.`display_name` = TRIM(`expense_category`.`display_name`)),
	CONSTRAINT `chk_expense_category_flags` CHECK(`expense_category`.`is_system` IN (0, 1)
        AND BINARY `expense_category`.`status` IN (BINARY 'active', BINARY 'inactive')),
	CONSTRAINT `chk_expense_category_version` CHECK(`expense_category`.`version` >= 1),
	CONSTRAINT `chk_expense_category_timeline` CHECK(`expense_category`.`created_at_utc` <= `expense_category`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `expense` DROP CONSTRAINT `chk_expense_category`;--> statement-breakpoint
ALTER TABLE `monthly_visit_commitment` DROP CONSTRAINT `chk_monthly_visit_optional_fields`;--> statement-breakpoint
ALTER TABLE `monthly_visit_commitment` ADD `location_label` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
CREATE INDEX `idx_expense_category_status_name` ON `expense_category` (`status`,`display_name`);--> statement-breakpoint
ALTER TABLE `expense` ADD CONSTRAINT `chk_expense_category` CHECK (CHAR_LENGTH(`expense`.`category`) BETWEEN 1 AND 32
        AND BINARY `expense`.`category` REGEXP '^[a-z][a-z0-9_]{0,31}$');--> statement-breakpoint
ALTER TABLE `monthly_visit_commitment` ADD CONSTRAINT `chk_monthly_visit_optional_fields` CHECK ((`monthly_visit_commitment`.`location_label` IS NULL OR (
          CHAR_LENGTH(`monthly_visit_commitment`.`location_label`) BETWEEN 1 AND 191
          AND `monthly_visit_commitment`.`location_label` = TRIM(`monthly_visit_commitment`.`location_label`)
        ))
        AND (`monthly_visit_commitment`.`resolution_note` IS NULL OR CHAR_LENGTH(`monthly_visit_commitment`.`resolution_note`) BETWEEN 1 AND 2000));--> statement-breakpoint
INSERT INTO `expense_category`
  (`id`, `code`, `client_operation_key`, `display_name`, `is_system`)
VALUES
  ('81000000-0000-4000-8000-000000000001', 'rent', '82000000-0000-4000-8000-000000000001', 'Kira', 1),
  ('81000000-0000-4000-8000-000000000002', 'software_subscription', '82000000-0000-4000-8000-000000000002', 'Yazılım / abonelik', 1),
  ('81000000-0000-4000-8000-000000000003', 'transportation', '82000000-0000-4000-8000-000000000003', 'Ulaşım', 1),
  ('81000000-0000-4000-8000-000000000004', 'meals_hospitality', '82000000-0000-4000-8000-000000000004', 'Yemek / ağırlama', 1),
  ('81000000-0000-4000-8000-000000000005', 'marketing', '82000000-0000-4000-8000-000000000005', 'Pazarlama', 1),
  ('81000000-0000-4000-8000-000000000006', 'office', '82000000-0000-4000-8000-000000000006', 'Ofis', 1),
  ('81000000-0000-4000-8000-000000000007', 'external_service', '82000000-0000-4000-8000-000000000007', 'Dış hizmet', 1),
  ('81000000-0000-4000-8000-000000000008', 'tax_fee', '82000000-0000-4000-8000-000000000008', 'Vergi / harç', 1),
  ('81000000-0000-4000-8000-000000000009', 'other', '82000000-0000-4000-8000-000000000009', 'Diğer', 1);--> statement-breakpoint
ALTER TABLE `expense` ADD CONSTRAINT `fk_expense_category` FOREIGN KEY (`category`) REFERENCES `expense_category`(`code`) ON DELETE restrict ON UPDATE restrict;
