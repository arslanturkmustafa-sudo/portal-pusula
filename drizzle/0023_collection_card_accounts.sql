ALTER TABLE `credit_card_installment` ADD `finance_transaction_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD `finance_transaction_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `credit_card_installment` ADD CONSTRAINT `uq_credit_card_installment_finance_transaction` UNIQUE(`finance_transaction_id`);--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD CONSTRAINT `uq_receivable_collection_finance_transaction` UNIQUE(`finance_transaction_id`);--> statement-breakpoint
ALTER TABLE `credit_card_installment` ADD CONSTRAINT `chk_credit_card_installment_finance_transaction` CHECK (`credit_card_installment`.`finance_transaction_id` IS NULL OR (
        OCTET_LENGTH(`credit_card_installment`.`finance_transaction_id`) = 36
        AND BINARY `credit_card_installment`.`finance_transaction_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND BINARY `credit_card_installment`.`status` = BINARY 'paid'
      ));--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD CONSTRAINT `chk_receivable_collection_finance_transaction_identity` CHECK (`receivable_collection`.`finance_transaction_id` IS NULL OR (
        OCTET_LENGTH(`receivable_collection`.`finance_transaction_id`) = 36
        AND BINARY `receivable_collection`.`finance_transaction_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ));--> statement-breakpoint
ALTER TABLE `credit_card_installment` ADD CONSTRAINT `fk_credit_card_installment_finance_transaction` FOREIGN KEY (`finance_transaction_id`) REFERENCES `finance_transaction`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `receivable_collection` ADD CONSTRAINT `fk_receivable_collection_finance_transaction` FOREIGN KEY (`finance_transaction_id`) REFERENCES `finance_transaction`(`id`) ON DELETE restrict ON UPDATE restrict;
