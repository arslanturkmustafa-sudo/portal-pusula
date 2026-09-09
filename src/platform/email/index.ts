export {
  EMAIL_OUTBOX_EVENT_TYPE,
  EMAIL_OUTBOX_SCHEMA_VERSION,
  emailOutboxPayloadSchema,
  enqueueEmailDelivery,
  type EmailMessage,
  type EmailOutboxPayload,
} from "./outbox-email";
export {
  createResendEmailOutboxAdapter,
  EmailDeliveryError,
} from "./resend-adapter";
export { scheduleEmailOutboxDispatch } from "./immediate-dispatch";
