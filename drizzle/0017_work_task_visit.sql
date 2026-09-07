CREATE TABLE `work_task_visit` (
	`task_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`visit_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at_utc` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `pk_work_task_visit` PRIMARY KEY(`task_id`),
	CONSTRAINT `chk_work_task_visit_identity` CHECK(OCTET_LENGTH(`work_task_visit`.`task_id`) = 36
        AND BINARY `work_task_visit`.`task_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`work_task_visit`.`visit_id`) = 36
        AND BINARY `work_task_visit`.`visit_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT `chk_work_task_visit_timeline` CHECK(`work_task_visit`.`created_at_utc` <= `work_task_visit`.`updated_at_utc`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
ALTER TABLE `work_task_visit` ADD CONSTRAINT `fk_work_task_visit_task` FOREIGN KEY (`task_id`) REFERENCES `work_task`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `work_task_visit` ADD CONSTRAINT `fk_work_task_visit_visit` FOREIGN KEY (`visit_id`) REFERENCES `monthly_visit_commitment`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `idx_work_task_visit_visit_task` ON `work_task_visit` (`visit_id`,`task_id`);
