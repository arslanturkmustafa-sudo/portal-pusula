import { z } from "zod";

import {
  PERMISSION_CODES,
  isPermissionCode,
  type PermissionCode,
} from "@/platform/auth/permissions";

function assignablePermission(value: unknown): value is PermissionCode {
  return isPermissionCode(value) && value !== "accounts.manage";
}

const permissionSchema = z.custom<PermissionCode>(assignablePermission, {
  message: "Atanabilir bir modül yetkisi seçin.",
});

function validatePermissionDependencies(
  permissions: readonly PermissionCode[],
  context: z.RefinementCtx,
): void {
  const selected = new Set(permissions);
  const dependencies: readonly (readonly [PermissionCode, PermissionCode])[] = [
    ["customers.write", "customers.read"],
    ["customers.write", "customers.contact.read"],
    ["customers.write", "projects.read"],
    ["customers.lifecycle", "customers.read"],
    ["customers.lifecycle", "customers.write"],
    ["contracts.read", "customers.read"],
    ["contracts.write", "contracts.read"],
    ["contracts.write", "projects.read"],
    ["contracts.lifecycle", "contracts.read"],
    ["contracts.lifecycle", "contracts.write"],
    ["contracts.billing.read", "contracts.read"],
    ["contracts.billing.write", "contracts.billing.read"],
    ["contracts.billing.write", "contracts.write"],
    ["visits.read", "contracts.read"],
    ["visits.write", "visits.read"],
    ["projects.write", "projects.read"],
    ["projects.lifecycle", "projects.read"],
    ["projects.lifecycle", "projects.write"],
    ["tasks.write", "tasks.read"],
    ["tasks.write", "customers.read"],
    ["tasks.write", "projects.read"],
    ["tasks.assign", "tasks.read"],
    ["tasks.assign", "tasks.write"],
    ["tasks.lifecycle", "tasks.read"],
    ["tasks.lifecycle", "tasks.write"],
    ["tasks.reports.export", "tasks.read"],
    ["tasks.reports.export", "customers.read"],
    ["finance.receivables.write", "finance.receivables.read"],
    ["finance.receivables.reverse", "finance.receivables.read"],
    ["finance.receivables.reverse", "finance.receivables.write"],
    ["finance.expenses.write", "finance.expenses.read"],
    ["finance.expenses.reverse", "finance.expenses.read"],
    ["finance.expenses.reverse", "finance.expenses.write"],
    ["finance.cards.write", "finance.cards.read"],
    ["finance.accounts.write", "finance.accounts.read"],
    ["finance.partnership.write", "finance.partnership.read"],
    ["finance.partnership.reverse", "finance.partnership.read"],
    ["finance.partnership.reverse", "finance.partnership.write"],
    ["finance.reports.export", "finance.reports.read"],
  ];
  for (const [permission, required] of dependencies) {
    if (selected.has(permission) && !selected.has(required)) {
      context.addIssue({
        code: "custom",
        message: `${permission} için ${required} de gereklidir.`,
        path: ["permissions"],
      });
    }
  }
}

const permissionsSchema = z
  .array(permissionSchema)
  .max(PERMISSION_CODES.length - 1)
  .superRefine((permissions, context) => {
    if (new Set(permissions).size !== permissions.length) {
      context.addIssue({
        code: "custom",
        message: "Yetki listesi tekrar içeremez.",
      });
    }
  });

export const createManagedUserInputSchema = z
  .object({
    confirmation: z.string().min(12).max(256),
    displayName: z.string().trim().min(2).max(191),
    email: z.email().max(254).trim().toLowerCase(),
    password: z.string().min(12).max(256),
    permissions: permissionsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.password !== value.confirmation) {
      context.addIssue({
        code: "custom",
        message: "Parola tekrarı eşleşmiyor.",
        path: ["confirmation"],
      });
    }
    validatePermissionDependencies(value.permissions, context);
  });

export const updateManagedUserInputSchema = z
  .object({
    permissions: permissionsSchema,
    status: z.enum(["active", "disabled"]),
  })
  .strict()
  .superRefine((value, context) =>
    validatePermissionDependencies(value.permissions, context),
  );

export type CreateManagedUserInput = z.infer<typeof createManagedUserInputSchema>;
export type UpdateManagedUserInput = z.infer<typeof updateManagedUserInputSchema>;
