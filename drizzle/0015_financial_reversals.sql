ALTER TABLE `partnership_contribution_receipt` DROP CONSTRAINT `chk_partnership_contribution_receipt_identity`;--> statement-breakpoint
ALTER TABLE `receivable` DROP CONSTRAINT `chk_receivable_timeline`;--> statement-breakpoint
ALTER TABLE `receivable_collection` DROP CONSTRAINT `chk_receivable_collection_identity`;--> statement-breakpoint
ALTER TABLE `partnership_contribution_receipt` ADD `entry_type` varchar(16) DEFAULT 'receipt' NOT NULL;--> statement-breakpoint
ALTER TABLE `partnership_contribution_receipt` ADD `reversal_of_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `partnership_contribution_receipt` ADD `reversal_reason` varchar(2000);--> statement-breakpoint
ALTER TABLE `receivable` ADD `record_state` varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `receivable` ADD `void_reason` varchar(2000);--> statement-breakpoint
ALTER TABLE `receivable` ADD `voided_at_utc` datetime(6);--> statement-breakpoint
ALTER TABLE `receivable` ADD `version` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD `entry_type` varchar(16) DEFAULT 'collection' NOT NULL;--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD `reversal_of_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD `reversal_reason` varchar(2000);--> statement-breakpoint
ALTER TABLE `partnership_contribution_receipt` ADD CONSTRAINT `uq_partnership_contribution_receipt_reversal` UNIQUE(`reversal_of_id`);--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD CONSTRAINT `uq_receivable_collection_reversal` UNIQUE(`reversal_of_id`);--> statement-breakpoint
ALTER TABLE `partnership_contribution_receipt` ADD CONSTRAINT `chk_partnership_contribution_receipt_entry` CHECK ((
          BINARY `partnership_contribution_receipt`.`entry_type` = BINARY 'receipt'
          AND `partnership_contribution_receipt`.`reversal_of_id` IS NULL
          AND `partnership_contribution_receipt`.`reversal_reason` IS NULL
        ) OR (
          BINARY `partnership_contribution_receipt`.`entry_type` = BINARY 'reversal'
          AND `partnership_contribution_receipt`.`reversal_of_id` IS NOT NULL
          AND `partnership_contribution_receipt`.`reversal_reason` IS NOT NULL
          AND CHAR_LENGTH(`partnership_contribution_receipt`.`reversal_reason`) BETWEEN 1 AND 2000
          AND `partnership_contribution_receipt`.`reversal_reason` = TRIM(`partnership_contribution_receipt`.`reversal_reason`)
        ));--> statement-breakpoint
ALTER TABLE `partnership_contribution_receipt` ADD CONSTRAINT `chk_partnership_contribution_receipt_identity` CHECK (OCTET_LENGTH(`partnership_contribution_receipt`.`id`) = 36
        AND BINARY `partnership_contribution_receipt`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`partnership_contribution_receipt`.`client_operation_key`) = 36
        AND BINARY `partnership_contribution_receipt`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`partnership_contribution_receipt`.`contribution_id`) = 36
        AND BINARY `partnership_contribution_receipt`.`contribution_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (`partnership_contribution_receipt`.`reversal_of_id` IS NULL OR (
          OCTET_LENGTH(`partnership_contribution_receipt`.`reversal_of_id`) = 36
          AND BINARY `partnership_contribution_receipt`.`reversal_of_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )));--> statement-breakpoint
ALTER TABLE `receivable` ADD CONSTRAINT `chk_receivable_record_state` CHECK (BINARY `receivable`.`record_state` IN (BINARY 'active', BINARY 'voided'));--> statement-breakpoint
ALTER TABLE `receivable` ADD CONSTRAINT `chk_receivable_void_shape` CHECK ((
          BINARY `receivable`.`record_state` = BINARY 'active'
          AND `receivable`.`void_reason` IS NULL
          AND `receivable`.`voided_at_utc` IS NULL
        ) OR (
          BINARY `receivable`.`record_state` = BINARY 'voided'
          AND `receivable`.`void_reason` IS NOT NULL
          AND CHAR_LENGTH(`receivable`.`void_reason`) BETWEEN 1 AND 2000
          AND `receivable`.`void_reason` = TRIM(`receivable`.`void_reason`)
          AND `receivable`.`voided_at_utc` IS NOT NULL
        ));--> statement-breakpoint
ALTER TABLE `receivable` ADD CONSTRAINT `chk_receivable_version` CHECK (`receivable`.`version` >= 1);--> statement-breakpoint
ALTER TABLE `receivable` ADD CONSTRAINT `chk_receivable_timeline` CHECK (`receivable`.`created_at_utc` <= `receivable`.`updated_at_utc`
        AND (
          `receivable`.`voided_at_utc` IS NULL
          OR (
            `receivable`.`created_at_utc` <= `receivable`.`voided_at_utc`
            AND `receivable`.`voided_at_utc` <= `receivable`.`updated_at_utc`
          )
        ));--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD CONSTRAINT `chk_receivable_collection_entry` CHECK ((
          BINARY `receivable_collection`.`entry_type` = BINARY 'collection'
          AND `receivable_collection`.`reversal_of_id` IS NULL
          AND `receivable_collection`.`reversal_reason` IS NULL
        ) OR (
          BINARY `receivable_collection`.`entry_type` = BINARY 'reversal'
          AND `receivable_collection`.`reversal_of_id` IS NOT NULL
          AND `receivable_collection`.`reversal_reason` IS NOT NULL
          AND CHAR_LENGTH(`receivable_collection`.`reversal_reason`) BETWEEN 1 AND 2000
          AND `receivable_collection`.`reversal_reason` = TRIM(`receivable_collection`.`reversal_reason`)
        ));--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD CONSTRAINT `chk_receivable_collection_identity` CHECK (OCTET_LENGTH(`receivable_collection`.`id`) = 36
        AND BINARY `receivable_collection`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`receivable_collection`.`client_operation_key`) = 36
        AND BINARY `receivable_collection`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`receivable_collection`.`receivable_id`) = 36
        AND BINARY `receivable_collection`.`receivable_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (`receivable_collection`.`reversal_of_id` IS NULL OR (
          OCTET_LENGTH(`receivable_collection`.`reversal_of_id`) = 36
          AND BINARY `receivable_collection`.`reversal_of_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )));--> statement-breakpoint
ALTER TABLE `partnership_contribution_receipt` ADD CONSTRAINT `fk_partnership_contribution_receipt_reversal` FOREIGN KEY (`reversal_of_id`) REFERENCES `partnership_contribution_receipt`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD CONSTRAINT `fk_receivable_collection_reversal` FOREIGN KEY (`reversal_of_id`) REFERENCES `receivable_collection`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_receivable_state_due` ON `receivable` (`record_state`,`due_on`,`customer_id`);
