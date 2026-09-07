CREATE TABLE `login_attempt_throttle` (
	`bucket_key` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`bucket_type` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`failure_count` int unsigned NOT NULL,
	`window_started_at_utc` datetime(6) NOT NULL,
	`blocked_until_utc` datetime(6),
	`updated_at_utc` datetime(6) NOT NULL,
	CONSTRAINT `login_attempt_throttle_bucket_key` PRIMARY KEY(`bucket_key`),
	CONSTRAINT `chk_login_attempt_throttle_key` CHECK(OCTET_LENGTH(`login_attempt_throttle`.`bucket_key`) = 64
        AND BINARY `login_attempt_throttle`.`bucket_key` REGEXP '^[0-9a-f]{64}$'),
	CONSTRAINT `chk_login_attempt_throttle_state` CHECK(BINARY `login_attempt_throttle`.`bucket_type` IN (BINARY 'account', BINARY 'global', BINARY 'network')
        AND `login_attempt_throttle`.`failure_count` BETWEEN 1 AND 1000
        AND `login_attempt_throttle`.`window_started_at_utc` <= `login_attempt_throttle`.`updated_at_utc`
		AND (`login_attempt_throttle`.`blocked_until_utc` IS NULL OR `login_attempt_throttle`.`blocked_until_utc` >= `login_attempt_throttle`.`updated_at_utc`))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE INDEX `idx_login_attempt_throttle_updated` ON `login_attempt_throttle` (`updated_at_utc`);--> statement-breakpoint
CREATE INDEX `idx_login_attempt_throttle_blocked` ON `login_attempt_throttle` (`blocked_until_utc`);
