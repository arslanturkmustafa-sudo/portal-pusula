CREATE TABLE `_platform_migration_verification` (
  `probe_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Surrogate identifier for disposable platform verification only',
  `idempotency_key` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Synthetic opaque key used only to verify exact database-level idempotency enforcement',
  `decimal_round_trip_value` DECIMAL(19,4) NOT NULL COMMENT 'Synthetic non-financial value used only to verify exact decimal round trips',
  `observed_at_utc` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC instant used only to verify timestamp normalization',
  PRIMARY KEY (`probe_id`),
  UNIQUE KEY `uq_platform_migration_verification_idempotency` (`idempotency_key`)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Platform verification only; not customer or finance data';
