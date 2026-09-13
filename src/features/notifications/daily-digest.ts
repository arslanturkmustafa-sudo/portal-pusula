import "server-only";

import type { Pool } from "mysql2/promise";

import { listActiveOwnerEmailRecipients } from "@/features/account/repository";
import {
  listDailyAgendaItems,
  listDailyPlanTasks,
  type DailyAgendaItem,
  type DailyPlanTask,
} from "@/features/daily-plan";
import {
  listOpenFinanceDigestItems,
  type FinanceDigestItem,
} from "@/features/finance/finance-digest-repository";
import { emailNotificationsEnabled } from "@/platform/config/email-env";
import { enqueueEmailDelivery } from "@/platform/email/outbox-email";
import { withUtcTransaction } from "@/platform/jobs/mysql-transaction";
import { toUtcDateTime6 } from "@/platform/jobs/time";

import { createDailyDigestEmail } from "./email-templates";

const DAILY_DIGEST_START_HOUR = 9;

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

function digestVisits(
  visits: readonly DailyAgendaItem[],
): readonly DailyAgendaItem[] {
  return visits.filter(
    (visit) =>
      visit.resolutionStatus === "planned" ||
      visit.resolutionStatus === "makeup_pending",
  );
}

function digestTasks(tasks: readonly DailyPlanTask[]): readonly DailyPlanTask[] {
  return tasks.filter((task) => task.status !== "done");
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
    const [allVisits, allTasks, recipients] = await Promise.all([
      listDailyAgendaItems(
        connection,
        window.businessDate,
        window.businessDate,
      ),
      listDailyPlanTasks(
        connection,
        window.businessDate,
        window.businessDate,
      ),
      listActiveOwnerEmailRecipients(connection),
    ]);
    const visits = digestVisits(allVisits);
    const tasks = digestTasks(allTasks);
    const hasFinanceRecipient = recipients.some(
      (recipient) => recipient.canReadFinanceReports,
    );
    const financeItems: readonly FinanceDigestItem[] = hasFinanceRecipient
      ? await listOpenFinanceDigestItems(connection, window.businessDate)
      : [];
    if (visits.length === 0 && tasks.length === 0 && financeItems.length === 0) {
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
        ? financeItems
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
