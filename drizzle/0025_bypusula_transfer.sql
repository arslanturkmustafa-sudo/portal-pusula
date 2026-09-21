CREATE TABLE `bypusula_analysis` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`source_key` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`payload_digest` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`payload_json` longtext NOT NULL,
	`company_name` varchar(191) NOT NULL,
	`analysis_id` varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`customer_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`project_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`created_at_utc` datetime(6) NOT NULL,
	CONSTRAINT `bypusula_analysis_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bypusula_analysis_source` UNIQUE(`source_key`),
	CONSTRAINT `chk_bypusula_analysis_hash` CHECK(BINARY `bypusula_analysis`.`source_key` REGEXP '^[0-9a-f]{64}$' AND BINARY `bypusula_analysis`.`payload_digest` REGEXP '^[0-9a-f]{64}$'),
	CONSTRAINT `chk_bypusula_analysis_json` CHECK(JSON_VALID(`bypusula_analysis`.`payload_json`)),
	CONSTRAINT `chk_bypusula_analysis_mapping` CHECK((`bypusula_analysis`.`customer_id` IS NULL AND `bypusula_analysis`.`project_id` IS NULL) OR (`bypusula_analysis`.`customer_id` IS NOT NULL AND `bypusula_analysis`.`project_id` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE `bypusula_task_link` (
	`source_key` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`analysis_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`step_key` varchar(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`task_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at_utc` datetime(6) NOT NULL,
	CONSTRAINT `bypusula_task_link_source_key` PRIMARY KEY(`source_key`),
	CONSTRAINT `uq_bypusula_task_link_task` UNIQUE(`task_id`),
	CONSTRAINT `uq_bypusula_task_link_step` UNIQUE(`analysis_id`,`step_key`),
	CONSTRAINT `chk_bypusula_task_link_hash` CHECK(BINARY `bypusula_task_link`.`source_key` REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `bypusula_analysis` ADD CONSTRAINT `fk_bypusula_analysis_mapping` FOREIGN KEY (`customer_id`,`project_id`) REFERENCES `customer_project`(`customer_id`,`project_id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `bypusula_task_link` ADD CONSTRAINT `fk_bypusula_task_link_analysis` FOREIGN KEY (`analysis_id`) REFERENCES `bypusula_analysis`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `bypusula_task_link` ADD CONSTRAINT `fk_bypusula_task_link_task` FOREIGN KEY (`task_id`) REFERENCES `work_task`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_bypusula_task_link_analysis` ON `bypusula_task_link` (`analysis_id`);
