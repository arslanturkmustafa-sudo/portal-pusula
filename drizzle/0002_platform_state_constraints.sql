ALTER TABLE `audit_event` ADD CONSTRAINT `chk_audit_event_actor_type` CHECK (`audit_event`.`actor_type` IN ('system', 'user'));--> statement-breakpoint
ALTER TABLE `audit_event` ADD CONSTRAINT `chk_audit_event_identity_format` CHECK (OCTET_LENGTH(`audit_event`.`id`) = 36
        AND BINARY `audit_event`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (
          `audit_event`.`actor_id` IS NULL
          OR (
            OCTET_LENGTH(`audit_event`.`actor_id`) = 36
            AND BINARY `audit_event`.`actor_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        )
        AND BINARY `audit_event`.`action` REGEXP '^[!-~]+$'
        AND BINARY `audit_event`.`entity_type` REGEXP '^[!-~]+$'
        AND OCTET_LENGTH(`audit_event`.`entity_id`) = 36
        AND BINARY `audit_event`.`entity_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND BINARY `audit_event`.`correlation_id` REGEXP '^[!-~]+$');--> statement-breakpoint
ALTER TABLE `job_run` ADD CONSTRAINT `chk_job_run_outcome_state` CHECK ((
        `job_run`.`outcome` = 'running'
        AND `job_run`.`completed_at_utc` IS NULL
      ) OR (
        `job_run`.`outcome` IN ('succeeded', 'retry', 'dead_letter', 'lease_expired')
        AND `job_run`.`completed_at_utc` IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE `job_run` ADD CONSTRAINT `chk_job_run_identity_format` CHECK (OCTET_LENGTH(`job_run`.`id`) = 36
        AND BINARY `job_run`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`job_run`.`job_id`) = 36
        AND BINARY `job_run`.`job_id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND OCTET_LENGTH(`job_run`.`lease_token`) = 36
        AND BINARY `job_run`.`lease_token` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND BINARY `job_run`.`lease_owner` REGEXP '^[!-~]+$'
        AND BINARY `job_run`.`correlation_id` REGEXP '^[!-~]+$'
        AND (
          `job_run`.`error_code` IS NULL
          OR BINARY `job_run`.`error_code` REGEXP '^[!-~]+$'
        ));--> statement-breakpoint
ALTER TABLE `outbox_event` ADD CONSTRAINT `chk_outbox_event_attempt_bounds` CHECK (`outbox_event`.`max_attempts` >= 1 AND `outbox_event`.`attempt_count` <= `outbox_event`.`max_attempts`);--> statement-breakpoint
ALTER TABLE `outbox_event` ADD CONSTRAINT `chk_outbox_event_status` CHECK (`outbox_event`.`status` IN ('pending', 'retry', 'leased', 'delivered', 'dead_letter'));--> statement-breakpoint
ALTER TABLE `outbox_event` ADD CONSTRAINT `chk_outbox_event_lease_shape` CHECK ((
        `outbox_event`.`status` = 'leased'
        AND `outbox_event`.`lease_owner` IS NOT NULL
        AND `outbox_event`.`lease_token` IS NOT NULL
        AND `outbox_event`.`lease_expires_at_utc` IS NOT NULL
      ) OR (
        `outbox_event`.`status` <> 'leased'
        AND `outbox_event`.`lease_owner` IS NULL
        AND `outbox_event`.`lease_token` IS NULL
        AND `outbox_event`.`lease_expires_at_utc` IS NULL
      ));--> statement-breakpoint
ALTER TABLE `outbox_event` ADD CONSTRAINT `chk_outbox_event_identity_format` CHECK (OCTET_LENGTH(`outbox_event`.`id`) = 36
        AND BINARY `outbox_event`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND BINARY `outbox_event`.`event_type` REGEXP '^[!-~]+$'
        AND BINARY `outbox_event`.`idempotency_key` REGEXP '^[!-~]+$'
        AND (
          `outbox_event`.`lease_owner` IS NULL
          OR BINARY `outbox_event`.`lease_owner` REGEXP '^[!-~]+$'
        )
        AND (
          `outbox_event`.`lease_token` IS NULL
          OR (
            OCTET_LENGTH(`outbox_event`.`lease_token`) = 36
            AND BINARY `outbox_event`.`lease_token` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        )
        AND (
          `outbox_event`.`last_error_code` IS NULL
          OR BINARY `outbox_event`.`last_error_code` REGEXP '^[!-~]+$'
        ));--> statement-breakpoint
ALTER TABLE `scheduled_job` ADD CONSTRAINT `chk_scheduled_job_attempt_bounds` CHECK (`scheduled_job`.`max_attempts` >= 1 AND `scheduled_job`.`attempt_count` <= `scheduled_job`.`max_attempts`);--> statement-breakpoint
ALTER TABLE `scheduled_job` ADD CONSTRAINT `chk_scheduled_job_status` CHECK (`scheduled_job`.`status` IN ('pending', 'retry', 'leased', 'succeeded', 'dead_letter'));--> statement-breakpoint
ALTER TABLE `scheduled_job` ADD CONSTRAINT `chk_scheduled_job_lease_shape` CHECK ((
        `scheduled_job`.`status` = 'leased'
        AND `scheduled_job`.`lease_owner` IS NOT NULL
        AND `scheduled_job`.`lease_token` IS NOT NULL
        AND `scheduled_job`.`lease_expires_at_utc` IS NOT NULL
      ) OR (
        `scheduled_job`.`status` <> 'leased'
        AND `scheduled_job`.`lease_owner` IS NULL
        AND `scheduled_job`.`lease_token` IS NULL
        AND `scheduled_job`.`lease_expires_at_utc` IS NULL
      ));--> statement-breakpoint
ALTER TABLE `scheduled_job` ADD CONSTRAINT `chk_scheduled_job_identity_format` CHECK (OCTET_LENGTH(`scheduled_job`.`id`) = 36
        AND BINARY `scheduled_job`.`id` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND BINARY `scheduled_job`.`job_type` REGEXP '^[!-~]+$'
        AND BINARY `scheduled_job`.`idempotency_key` REGEXP '^[!-~]+$'
        AND (
          `scheduled_job`.`lease_owner` IS NULL
          OR BINARY `scheduled_job`.`lease_owner` REGEXP '^[!-~]+$'
        )
        AND (
          `scheduled_job`.`lease_token` IS NULL
          OR (
            OCTET_LENGTH(`scheduled_job`.`lease_token`) = 36
            AND BINARY `scheduled_job`.`lease_token` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        )
        AND (
          `scheduled_job`.`last_error_code` IS NULL
          OR BINARY `scheduled_job`.`last_error_code` REGEXP '^[!-~]+$'
        ));