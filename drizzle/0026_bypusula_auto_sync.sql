ALTER TABLE `bypusula_analysis` ADD `sync_requested_at_utc` datetime(6);--> statement-breakpoint
ALTER TABLE `bypusula_analysis` ADD `sync_last_received_at_utc` datetime(6);--> statement-breakpoint
ALTER TABLE `bypusula_analysis` ADD `sync_approved_at_utc` datetime(6);--> statement-breakpoint
ALTER TABLE `bypusula_analysis` ADD `sync_approved_by_user_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `bypusula_analysis` ADD CONSTRAINT `chk_bypusula_sync_approval` CHECK ((`bypusula_analysis`.`sync_approved_at_utc` IS NULL AND `bypusula_analysis`.`sync_approved_by_user_account_id` IS NULL) OR (`bypusula_analysis`.`sync_approved_at_utc` IS NOT NULL AND `bypusula_analysis`.`sync_approved_by_user_account_id` IS NOT NULL AND `bypusula_analysis`.`sync_requested_at_utc` IS NOT NULL AND `bypusula_analysis`.`customer_id` IS NOT NULL AND `bypusula_analysis`.`project_id` IS NOT NULL));--> statement-breakpoint
ALTER TABLE `bypusula_analysis` ADD CONSTRAINT `fk_bypusula_sync_approver` FOREIGN KEY (`sync_approved_by_user_account_id`) REFERENCES `user_account`(`id`) ON DELETE restrict ON UPDATE restrict;
