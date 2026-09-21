import { char, foreignKey, json, mysqlTable } from "drizzle-orm/mysql-core";
import { userAccount } from "./user-account";

// A missing row preserves existing unrestricted accounts. A row with [] denies
// all projects. IDs are validated against project records before persistence.
export const userProjectAccess = mysqlTable("user_project_access", {
  userAccountId: char("user_account_id", { length: 36 }).primaryKey(),
  projectIds: json("project_ids").$type<string[]>().notNull(),
}, (table) => [
  foreignKey({ name: "fk_user_project_access_account", columns: [table.userAccountId], foreignColumns: [userAccount.id] })
    .onDelete("restrict").onUpdate("restrict"),
]);
