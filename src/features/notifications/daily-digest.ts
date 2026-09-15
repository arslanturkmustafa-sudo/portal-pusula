import "server-only";

import type { Pool } from "mysql2/promise";

import { listActiveOwnerEmailRecipients } from "@/features/account/repository";
import { readTodayOverview } from "@/features/today";
import { emailNotificationsEnabled } from "@/platform/config/email-env";
import { enqueueEmailDelivery } from "@/platform/email/outbox-email";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";

import { createDailyDigestEmail } from "./email-templates";

const DAILY_DIGEST_START_HOUR = 8;

export type IstanbulDigestWindow = Readonly<{
  businessDate: string;
  due: boolean;
  hour: number;
}>;

export type DailyDigestEnqueueResult = Readonly<{
  businessDate: string;
  deliveryCount: number;
  status: "before_window" | "disabled" | "empty" | "enqueued" | "no_recipients";
}>;

function requiredPart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined || value === "") {
    throw new Error("Istanbul digest clock is invalid.");
  }
  return value;
}

export function istanbulDigestWindow(now: Date): IstanbulDigestWindow {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Istanbul digest clock is invalid.");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(now);
  const hour = Number(requiredPart(parts, "hour"));
  if (!Number.isSafeInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Istanbul digest clock is invalid.");
  }

  return {
    businessDate: `${requiredPart(parts, "year")}-${requiredPart(parts, "month")}-${requiredPart(parts, "day")}`,
    due: hour >= DAILY_DIGEST_START_HOUR,
    hour,
  };
}

export async function enqueueDailyDigestEmailsIfDue(
  pool: Pool,
  now: Date = new Date(),
): Promise<DailyDigestEnqueueResult> {
  const window = istanbulDigestWindow(now);
  if (!window.due) {
    return {
      businessDate: window.businessDate,
      deliveryCount: 0,
      status: "before_window",
    };
  }
  if (!emailNotificationsEnabled()) {
    return {
      businessDate: window.businessDate,
      deliveryCount: 0,
      status: "disabled",
    };
  }

  return withUtcTransaction(pool, async (connection) => {
    const recipients = await listActiveOwnerEmailRecipients(connection);
    const hasFinanceRecipient = recipients.some(
      (recipient) => recipient.canReadFinanceReports,
    );
    const { financeItems, tasks, visits } = await readTodayOverview(
      connection,
      window.businessDate,
      {
        canReadFinance: hasFinanceRecipient,
        canReadTasks: true,
        canReadVisits: true,
      },
    );
    const sharedFinanceItems = financeItems ?? [];
    if (
      visits.length === 0 &&
      tasks.length === 0 &&
      sharedFinanceItems.length === 0
    ) {
      return {
        businessDate: window.businessDate,
        deliveryCount: 0,
        status: "empty" as const,
      };
    }

    if (recipients.length === 0) {
      return {
        businessDate: window.businessDate,
        deliveryCount: 0,
        status: "no_recipients" as const,
      };
    }

    const availableAtUtc = toUtcDateTime6(now);
    let deliveryCount = 0;
    for (const recipient of recipients) {
      const recipientFinanceItems = recipient.canReadFinanceReports
        ? sharedFinanceItems
        : undefined;
      if (
        visits.length === 0 &&
        tasks.length === 0 &&
        recipientFinanceItems === undefined
      ) {
        continue;
      }
      await enqueueEmailDelivery(connection, {
        availableAtUtc,
        idempotencyKey: `daily-digest:${window.businessDate}:${recipient.id}`,
        message: createDailyDigestEmail({
          businessDate: window.businessDate,
          financeItems: recipientFinanceItems,
          recipientName: recipient.displayName,
          tasks,
          visits,
        }),
        recipientAccountId: recipient.id,
      });
      deliveryCount += 1;
    }

    return {
      businessDate: window.businessDate,
      deliveryCount,
      status: deliveryCount > 0 ? ("enqueued" as const) : ("empty" as const),
    };
  });
}
