ALTER TABLE `expense` DROP CONSTRAINT `chk_expense_identity`;--> statement-breakpoint
ALTER TABLE `expense` ADD `source_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `expense` ADD `finance_transaction_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `expense` ADD CONSTRAINT `uq_expense_finance_transaction` UNIQUE(`finance_transaction_id`);--> statement-breakpoint
ALTER TABLE `expense` ADD CONSTRAINT `chk_expense_account_movement_shape` CHECK ((
          `expense`.`source_account_id` IS NULL
          AND `expense`.`finance_transaction_id` IS NULL
        ) OR (
          BINARY `expense`.`payment_method` IN (
            BINARY 'cash', BINARY 'bank_transfer'
          )
          AND `expense`.`source_account_id` IS NOT NULL
          AND `expense`.`finance_transaction_id` IS NOT NULL
        ));--> statement-breakpoint
ALTER TABLE `expense` ADD CONSTRAINT `chk_expense_identity` CHECK (OCTET_LENGTH(`expense`.`id`) = 36
        AND BINARY `expense`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`expense`.`client_operation_key`) = 36
        AND BINARY `expense`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (`expense`.`project_id` IS NULL OR (
          OCTET_LENGTH(`expense`.`project_id`) = 36
          AND BINARY `expense`.`project_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`expense`.`credit_card_id` IS NULL OR (
          OCTET_LENGTH(`expense`.`credit_card_id`) = 36
          AND BINARY `expense`.`credit_card_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`expense`.`source_account_id` IS NULL OR (
          OCTET_LENGTH(`expense`.`source_account_id`) = 36
          AND BINARY `expense`.`source_account_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`expense`.`finance_transaction_id` IS NULL OR (
          OCTET_LENGTH(`expense`.`finance_transaction_id`) = 36
          AND BINARY `expense`.`finance_transaction_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )));--> statement-breakpoint
ALTER TABLE `expense` ADD CONSTRAINT `fk_expense_source_account` FOREIGN KEY (`source_account_id`) REFERENCES `finance_account`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `expense` ADD CONSTRAINT `fk_expense_finance_transaction` FOREIGN KEY (`finance_transaction_id`) REFERENCES `finance_transaction`(`id`) ON DELETE restrict ON UPDATE restrict;
