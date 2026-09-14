CREATE TABLE `credit_card_installment_payment` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_operation_key` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`installment_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`finance_transaction_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`amount` decimal(19,4) NOT NULL,
	`paid_on` date NOT NULL,
	`entry_type` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'payment',
	`reversal_of_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`reversal_reason` varchar(2000),
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `credit_card_installment_payment_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_credit_card_installment_payment_operation` UNIQUE(`client_operation_key`),
	CONSTRAINT `uq_credit_card_installment_payment_transaction` UNIQUE(`finance_transaction_id`),
	CONSTRAINT `uq_credit_card_installment_payment_reversal` UNIQUE(`reversal_of_id`),
	CONSTRAINT `chk_credit_card_installment_payment_identity` CHECK(OCTET_LENGTH(`credit_card_installment_payment`.`id`) = 36
        AND BINARY `credit_card_installment_payment`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`credit_card_installment_payment`.`client_operation_key`) = 36
        AND BINARY `credit_card_installment_payment`.`client_operation_key` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`credit_card_installment_payment`.`installment_id`) = 36
        AND BINARY `credit_card_installment_payment`.`installment_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (`credit_card_installment_payment`.`finance_transaction_id` IS NULL OR (
          OCTET_LENGTH(`credit_card_installment_payment`.`finance_transaction_id`) = 36
          AND BINARY `credit_card_installment_payment`.`finance_transaction_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))
        AND (`credit_card_installment_payment`.`reversal_of_id` IS NULL OR (
          OCTET_LENGTH(`credit_card_installment_payment`.`reversal_of_id`) = 36
          AND BINARY `credit_card_installment_payment`.`reversal_of_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ))),
	CONSTRAINT `chk_credit_card_installment_payment_amount` CHECK(`credit_card_installment_payment`.`amount` > 0),
	CONSTRAINT `chk_credit_card_installment_payment_entry` CHECK((
          BINARY `credit_card_installment_payment`.`entry_type` = BINARY 'payment'
          AND `credit_card_installment_payment`.`reversal_of_id` IS NULL
          AND `credit_card_installment_payment`.`reversal_reason` IS NULL
        ) OR (
          BINARY `credit_card_installment_payment`.`entry_type` = BINARY 'reversal'
          AND `credit_card_installment_payment`.`reversal_of_id` IS NOT NULL
          AND `credit_card_installment_payment`.`reversal_reason` IS NOT NULL
          AND CHAR_LENGTH(`credit_card_installment_payment`.`reversal_reason`) BETWEEN 1 AND 2000
          AND `credit_card_installment_payment`.`reversal_reason` = TRIM(`credit_card_installment_payment`.`reversal_reason`)
        ))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `credit_card_installment_payment` ADD CONSTRAINT `fk_credit_card_installment_payment_installment` FOREIGN KEY (`installment_id`) REFERENCES `credit_card_installment`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `credit_card_installment_payment` ADD CONSTRAINT `fk_credit_card_installment_payment_transaction` FOREIGN KEY (`finance_transaction_id`) REFERENCES `finance_transaction`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `credit_card_installment_payment` ADD CONSTRAINT `fk_credit_card_installment_payment_reversal` FOREIGN KEY (`reversal_of_id`) REFERENCES `credit_card_installment_payment`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_credit_card_installment_payment_installment_date` ON `credit_card_installment_payment` (`installment_id`,`paid_on`,`created_at_utc`);--> statement-breakpoint
INSERT INTO `credit_card_installment_payment` (`id`, `client_operation_key`, `installment_id`, `finance_transaction_id`, `amount`, `paid_on`, `entry_type`, `created_at_utc`) SELECT UUID(), UUID(), `id`, `finance_transaction_id`, `amount`, `paid_on`, 'payment', `updated_at_utc` FROM `credit_card_installment` WHERE BINARY `status` = BINARY 'paid';
