CREATE TABLE `cron_dispatch_gate` (
	`gate_key` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`state` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
	`last_permitted_at_utc` datetime(6) NOT NULL,
	`created_at_utc` datetime(6) NOT NULL,
	`updated_at_utc` datetime(6) NOT NULL,
	CONSTRAINT `cron_dispatch_gate_gate_key` PRIMARY KEY(`gate_key`),
	CONSTRAINT `chk_cron_dispatch_gate_key_format` CHECK(BINARY `cron_dispatch_gate`.`gate_key` REGEXP '^[!-~]+$'),
	CONSTRAINT `chk_cron_dispatch_gate_state` CHECK(BINARY `cron_dispatch_gate`.`state` = BINARY 'active'),
	CONSTRAINT `chk_cron_dispatch_gate_timeline` CHECK(`cron_dispatch_gate`.`created_at_utc` <= `cron_dispatch_gate`.`last_permitted_at_utc`
        AND `cron_dispatch_gate`.`last_permitted_at_utc` = `cron_dispatch_gate`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Durable cross-process cron dispatch frequency gate';
