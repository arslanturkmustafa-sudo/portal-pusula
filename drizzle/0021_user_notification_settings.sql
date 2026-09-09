CREATE TABLE `user_notification_setting` (
	`user_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`recipient_email` varchar(254) NOT NULL,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `user_notification_setting_user_account_id` PRIMARY KEY(`user_account_id`),
	CONSTRAINT `chk_user_notification_setting_account_id` CHECK(OCTET_LENGTH(`user_notification_setting`.`user_account_id`) = 36
        AND BINARY `user_notification_setting`.`user_account_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_user_notification_setting_email` CHECK(CHAR_LENGTH(`user_notification_setting`.`recipient_email`) BETWEEN 3 AND 254
        AND `user_notification_setting`.`recipient_email` = TRIM(`user_notification_setting`.`recipient_email`)
        AND BINARY `user_notification_setting`.`recipient_email` = BINARY LOWER(`user_notification_setting`.`recipient_email`)),
	CONSTRAINT `chk_user_notification_setting_timeline` CHECK(`user_notification_setting`.`created_at_utc` <= `user_notification_setting`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `user_notification_setting` ADD CONSTRAINT `fk_user_notification_setting_account` FOREIGN KEY (`user_account_id`) REFERENCES `user_account`(`id`) ON DELETE restrict ON UPDATE restrict;
