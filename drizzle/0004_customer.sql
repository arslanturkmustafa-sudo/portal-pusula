CREATE TABLE `customer` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`display_name` varchar(191) NOT NULL,
	`short_code` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
	`contact_note` varchar(2000),
	`email` varchar(254),
	`phone` varchar(32),
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `customer_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_customer_short_code` UNIQUE(`short_code`),
	CONSTRAINT `chk_customer_id_format` CHECK(OCTET_LENGTH(`customer`.`id`) = 36
        AND BINARY `customer`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_customer_display_name` CHECK(CHAR_LENGTH(`customer`.`display_name`) BETWEEN 1 AND 191
        AND `customer`.`display_name` = TRIM(`customer`.`display_name`)),
	CONSTRAINT `chk_customer_short_code` CHECK(BINARY `customer`.`short_code` REGEXP '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
	CONSTRAINT `chk_customer_status` CHECK(BINARY `customer`.`status` IN (BINARY 'active', BINARY 'inactive')),
	CONSTRAINT `chk_customer_optional_fields` CHECK((`customer`.`contact_note` IS NULL OR CHAR_LENGTH(`customer`.`contact_note`) BETWEEN 1 AND 2000)
        AND (`customer`.`email` IS NULL OR CHAR_LENGTH(`customer`.`email`) BETWEEN 3 AND 254)
        AND (`customer`.`phone` IS NULL OR CHAR_LENGTH(`customer`.`phone`) BETWEEN 3 AND 32)),
	CONSTRAINT `chk_customer_timeline` CHECK(`customer`.`created_at_utc` <= `customer`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE INDEX `idx_customer_status_name` ON `customer` (`status`,`display_name`);
