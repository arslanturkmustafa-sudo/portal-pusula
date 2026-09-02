CREATE TABLE `user_account` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`email` varchar(254) NOT NULL,
	`password_hash` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`credential_version` int unsigned NOT NULL DEFAULT 1,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
	`password_changed_at_utc` datetime(6) NOT NULL,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `user_account_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_user_account_email` UNIQUE(`email`),
	CONSTRAINT `chk_user_account_id_format` CHECK(OCTET_LENGTH(`user_account`.`id`) = 36
        AND BINARY `user_account`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_user_account_email` CHECK(CHAR_LENGTH(`user_account`.`email`) BETWEEN 3 AND 254
        AND `user_account`.`email` = TRIM(`user_account`.`email`)
        AND BINARY `user_account`.`email` = BINARY LOWER(`user_account`.`email`)),
	CONSTRAINT `chk_user_account_password_hash` CHECK(BINARY `user_account`.`password_hash` REGEXP '^(scrypt:32768:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{86}|scrypt\\$32768\\$8\\$1\\$[A-Za-z0-9_-]{22}\\$[A-Za-z0-9_-]{86})$'),
	CONSTRAINT `chk_user_account_state` CHECK(`user_account`.`credential_version` >= 1
        AND BINARY `user_account`.`status` IN (BINARY 'active', BINARY 'disabled')),
	CONSTRAINT `chk_user_account_timeline` CHECK(`user_account`.`created_at_utc` <= `user_account`.`password_changed_at_utc`
        AND `user_account`.`password_changed_at_utc` <= `user_account`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
