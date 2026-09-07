ALTER TABLE `user_account` DROP CONSTRAINT `chk_user_account_state`;--> statement-breakpoint
ALTER TABLE `user_account`
  ADD `display_name` varchar(191) NOT NULL DEFAULT 'Portal Yöneticisi' AFTER `email`,
  ADD `role` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owner' AFTER `credential_version`;--> statement-breakpoint
ALTER TABLE `user_account`
  MODIFY `display_name` varchar(191) NOT NULL,
  MODIFY `role` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'member';--> statement-breakpoint
CREATE TABLE `user_permission` (
	`user_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`permission_code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `user_permission_user_account_id_permission_code_pk` PRIMARY KEY(`user_account_id`,`permission_code`),
	CONSTRAINT `fk_user_permission_account` FOREIGN KEY (`user_account_id`) REFERENCES `user_account`(`id`) ON DELETE restrict ON UPDATE restrict,
	CONSTRAINT `chk_user_permission_code` CHECK(BINARY `user_permission`.`permission_code` IN (
        BINARY 'accounts.manage',
        BINARY 'customers.read', BINARY 'customers.write', BINARY 'customers.contact.read',
        BINARY 'contracts.read', BINARY 'contracts.write',
        BINARY 'contracts.billing.read', BINARY 'contracts.billing.write',
        BINARY 'visits.read', BINARY 'visits.write', BINARY 'daily-plan.read',
        BINARY 'projects.read', BINARY 'projects.write',
        BINARY 'tasks.read', BINARY 'tasks.write', BINARY 'tasks.assign',
        BINARY 'tasks.reports.export',
        BINARY 'finance.receivables.read', BINARY 'finance.receivables.write',
        BINARY 'finance.expenses.read', BINARY 'finance.expenses.write',
        BINARY 'finance.cards.read', BINARY 'finance.cards.write',
        BINARY 'finance.partnership.read', BINARY 'finance.partnership.write',
        BINARY 'finance.reports.read', BINARY 'finance.reports.export'
      ))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `user_account` ADD CONSTRAINT `chk_user_account_display_name` CHECK (CHAR_LENGTH(`user_account`.`display_name`) BETWEEN 1 AND 191
        AND `user_account`.`display_name` = TRIM(`user_account`.`display_name`));--> statement-breakpoint
ALTER TABLE `user_account` ADD CONSTRAINT `chk_user_account_state` CHECK (`user_account`.`credential_version` >= 1
        AND BINARY `user_account`.`role` IN (BINARY 'owner', BINARY 'member')
        AND BINARY `user_account`.`status` IN (BINARY 'active', BINARY 'disabled'));--> statement-breakpoint
CREATE INDEX `idx_user_account_role_status` ON `user_account` (`role`,`status`);
