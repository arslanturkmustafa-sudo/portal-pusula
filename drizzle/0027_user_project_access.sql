CREATE TABLE `user_project_access` (
	`user_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`project_ids` json NOT NULL,
	CONSTRAINT `user_project_access_user_account_id` PRIMARY KEY(`user_account_id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `user_project_access` ADD CONSTRAINT `fk_user_project_access_account` FOREIGN KEY (`user_account_id`) REFERENCES `user_account`(`id`) ON DELETE restrict ON UPDATE restrict;
