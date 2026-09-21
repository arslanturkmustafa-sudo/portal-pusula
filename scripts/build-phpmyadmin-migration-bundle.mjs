import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertExpectedMigrationsUnchanged,
  DRIZZLE_MIGRATIONS_TABLE,
  MIGRATION_LOCK_DIGEST_HEX_LENGTH,
  MIGRATION_LOCK_PREFIX,
  MIGRATION_LOCK_TIMEOUT_SECONDS,
  readExpectedMigrations,
} from "./migration-integrity.mjs";
import {
  MYSQL_SESSION_CHARACTER_SET,
  MYSQL_SESSION_COLLATION,
  MYSQL_SESSION_SQL_MODE,
  MYSQL_SESSION_STORAGE_ENGINE,
  MYSQL_SESSION_TIME_ZONE,
} from "./mysql-session-policy.mjs";

const FORMAT_VERSION = 2;
const MINIMUM_MARIADB_MAJOR = 10;
const MINIMUM_MARIADB_MINOR = 6;
const JOURNAL_TABLE = DRIZZLE_MIGRATIONS_TABLE;
const GUARD_FAILURE_QUERY = "PORTAL_PUSULA_BUNDLE_GUARD_FAILURE";
const SAFE_NOOP_QUERY = "SELECT 1 WHERE 0";
const migrationBreakpoint = /--> statement-breakpoint\s*/gu;
const safeIdentifier = /^[A-Za-z0-9_]{1,64}$/u;
const CUSTOMER_PROJECTS_PARTNERSHIP_MIGRATION_TAG =
  "0011_customer_projects_partnership";
const USER_PERMISSIONS_MIGRATION_TAG = "0012_user_permissions";
const RECORD_LIFECYCLE_MIGRATION_TAG = "0014_record_lifecycle";
const FINANCIAL_REVERSALS_MIGRATION_TAG = "0015_financial_reversals";
const FINANCE_ACCOUNTS_LEDGER_MIGRATION_TAG =
  "0016_finance_accounts_ledger";
const PLANNING_EXPENSE_CATEGORIES_MIGRATION_TAG =
  "0018_planning_expense_categories";
const TAX_OBLIGATIONS_MIGRATION_TAG = "0019_tax_obligations";
const EXPENSE_ACCOUNT_LEDGER_MIGRATION_TAG =
  "0020_expense_account_ledger";
const RECURRING_TASKS_EXPENSES_MIGRATION_TAG =
  "0022_recurring_tasks_expenses";
const COLLECTION_CARD_ACCOUNTS_MIGRATION_TAG =
  "0023_collection_card_accounts";
const PARTIAL_CARD_PAYMENTS_MIGRATION_TAG =
  "0024_partial_card_payments";
const BYPUSULA_TRANSFER_MIGRATION_TAG = "0025_bypusula_transfer";
const BYPUSULA_AUTO_SYNC_MIGRATION_TAG = "0026_bypusula_auto_sync";

// The integration migrations accept only the reviewed additive DDL. In
// particular, the customer/project pair must keep its composite RESTRICT FK.
const BYPUSULA_TRANSFER_STATEMENT_HASHES = new Set([
  "3c277b4aff53fe908479c2a2842b55efe5a9715234de64718532e7646f02b61c",
  "bc214158c8286d846d4265a9a9f255ca1f7af8e530460c19cad1672239d28eff",
  "2b8885bc2b090412c69034ca3a1b550dc7dc186224cf8efd2e1b5e6def3212aa",
  "291797ff85778ceeb785abe05ab130160dccb68b575ee247fc3e0a5b6de3c367",
  "cacef4faa707eb9f47fad1c121094fbac64000fa765072ae652e11b1f9e6ab4d",
  "756845b95486770e398480e5bf454198bfb27be249bcb55796e013b208081c90",
]);
const BYPUSULA_AUTO_SYNC_STATEMENT_HASHES = new Set([
  "63d20085b72a58aebf210054b48f8fbd4d8f9f4d6f8f1eafd6c92d92cb6ae2a6",
  "5e1075aa9c753a7c497928ce72e266e98763538e5dd8cdfd7e8ae9890df4bcec",
  "ca1ef389a9745549fd83a27aa7cea449e46d1d58509adf18106c6304b12279d9",
  "f1455d562cf3162b716196cb79bcfb921383bbec33a1520aac8f4d1237e628a1",
  "72d13cea1203e480a3663364ef4a12c13fb58cf6e67b1ef4a28749a75a3d7267",
  "62e556f535e37c170c7f6f9bee0f822f3def13b31dc9d2b7aca40b23e397ea93",
]);

// 0020 alters an existing financial table, so keep every accepted statement
// byte-independent but semantically exact after whitespace normalization.
const EXPENSE_ACCOUNT_LEDGER_STATEMENT_HASHES = new Set([
  "3567f70345227c78dc1b17f00dc571c1d54c8292112d2ec30eeca1f991ead9eb",
  "9937d0b9d5bbcf8f0cfee9a8f64ef9e00c48f0867d0dd51859a6f2bccb791f71",
  "0ad779ce7620d7eaebd269a8e8e22602c74574aa94c3cbd4193ada5638d22c96",
  "db60bac77ea3aeda8f8b745f6750867959cdca061342bf562ef243d256fb5706",
  "1800680c540562f4f95fff7b59e80da5a7fef0f33f481816d8dacc5efd415c3e",
  "038e132fa99c272b8522ef096c19b66aa53b8d20214991c3f9ef0ba92fda0fe2",
  "6048483fa6e2b3e168726262a1857f60e813326e9c7a5c93662e37629197d7fb",
  "a17b7171308d190ef67e81f9efb11f85082c7430f88d9e441152bad7d50de848",
]);

// 0022 adds recurrence to an existing task table and introduces the matching
// expense schedule table. Lock every accepted DDL shape so the phpMyAdmin
// builders cannot silently accept a broadened constraint, FK, or index.
const RECURRING_TASKS_EXPENSES_STATEMENT_HASHES = new Set([
  "a30463d900a913094697583baab3c16a106bbc34560ed7421e7c5e803067c6f0",
  "190d7961626e5128b9bc65f918e1a00ca7a4de26de77c69bf84e24daad1f5f88",
  "3fa45cd0be3e691804fb1ebdee6a360aa7653e569ec75250b9a16df857fdce3a",
  "a757ba1714f36c4fb3cd1df7e5090c35650a3a043066f9a883a47905e61de276",
  "bb664d687bd9f81710f4c4400ac60a19e2039c3a1d9a69dbb1b083cda72012d3",
  "735ac2f3ee242359b58bee1f346c55d98923d8d5f1667afedf0d694e63b62bf4",
  "68ab4af6d5c3f617c30fe2762e5ac3d91d404339f4464a4274390b5e3538c449",
  "10d5bb511f1e08c4be570a3fb4b47347f725b26c0a5c754b1ff853ef852cba01",
  "2bae211e3d6d57d6bc1c58f75ca39bd4750c6dcec9e49349928bbeaf763e54c8",
  "ff4f3f6a9410affe52484f07e51b7a9e3dc465e7a74178c31209447a4ebb250c",
  "5f85244cc867f3aeec0afa37df119754b507a4c9aed0ab6055ea45e02671a6bf",
  "4666e34331a48bf600510b594db5bbd6d4fa0cde88255f0a3080d82e0e23de32",
  "faef0c09dcfa6e8c60d35c4fbe4011cbd45e1931a1eef4c4948f2374ad64101b",
  "4fd446cb7888a85411047f0e39e726d777d72e7c31d701d57b26646493a12829",
  "6d0eb245960126eb24f9780dffd5b29f7c48463b1f770248f656f46306b91cc3",
  "3bbe91f4f1433ab303a4ad37d1958c390d9c38701641dde088ff7ed194d5cfa0",
  "5a538e7be29a38250f7382e3cae4b9b46cdb9c11bfdcf61f0d9d61dc9e2afc72",
]);

// 0023 links collections and card-installment payments to immutable ledger
// movements. Accept only the exact additive DDL emitted for this release.
const COLLECTION_CARD_ACCOUNTS_STATEMENT_HASHES = new Set([
  "a30df770b131a0f92a2cd4ab388ddef8ffbc893972f6867b334e705f70d21e25",
  "bf0f646f5cfed8defb5b381d4ee17eecc7c3b7d90635be974e0862b0d1a1603b",
  "114057796b5f1df56eb334ee7dd0b5265b323036a015f252efa3dfef64a73617",
  "e741794c6595b95bd78c220b7953b3c5ecacb4e8ed416fb57d90c8e8ad53d138",
  "c5189168a3bb1ca570f89767d3f1f3ff562227e336f301f6d34deaabcd3f47bd",
  "b5c526eec8b4fa3a1575b027fa3f8ce7e8c85f914db6865c448d932eb212d74e",
  "671072d3c8677b4223568d6ee337863d7293d92348b4aa47bd4a04c14a22762e",
  "21d9bc1304b5f9a244e584bef6489bde1488de361db90966fd4066dbde4a96c9",
]);

// 0024 introduces an immutable payment/reversal child ledger and migrates
// already-settled installment rows without changing their legacy columns.
const PARTIAL_CARD_PAYMENTS_STATEMENT_HASHES = new Set([
  "2b5bed8192ad51d0583fa0a491fed179fe66e641dd5421e2df61e581706d408d",
  "b5db64695fec7bea4dc931e7cb5881cb3394b5839f5518274e56bd443106f260",
  "4f2c5d4bfd7bfa44d8f55ef239b49824de6f708009894fc00c12ee3a6d2c7f5e",
  "297c5e34a9c0b07d1a3b18bba9ff9ccac37a512f6bd1596a9a3af3465262f4bf",
  "b62ba9b219ff9129a165849c33025ef2ccb0ccf26528c3d3e280b40fdaeb9f05",
  "5b73625b7be19fb57c93c2d77f32180ee3ee49234e5c695a371cc231b8b4e1c9",
]);

const PARTIAL_CARD_PAYMENTS_BACKFILL_SQL = "INSERT INTO `credit_card_installment_payment` (`id`, `client_operation_key`, `installment_id`, `finance_transaction_id`, `amount`, `paid_on`, `entry_type`, `created_at_utc`) SELECT UUID(), UUID(), `id`, `finance_transaction_id`, `amount`, `paid_on`, 'payment', `updated_at_utc` FROM `credit_card_installment` WHERE BINARY `status` = BINARY 'paid'";

const EXPENSE_CATEGORY_SEED_ROWS = Object.freeze([
  ["81000000-0000-4000-8000-000000000001", "rent", "82000000-0000-4000-8000-000000000001", "Kira"],
  ["81000000-0000-4000-8000-000000000002", "software_subscription", "82000000-0000-4000-8000-000000000002", "Yazılım / abonelik"],
  ["81000000-0000-4000-8000-000000000003", "transportation", "82000000-0000-4000-8000-000000000003", "Ulaşım"],
  ["81000000-0000-4000-8000-000000000004", "meals_hospitality", "82000000-0000-4000-8000-000000000004", "Yemek / ağırlama"],
  ["81000000-0000-4000-8000-000000000005", "marketing", "82000000-0000-4000-8000-000000000005", "Pazarlama"],
  ["81000000-0000-4000-8000-000000000006", "office", "82000000-0000-4000-8000-000000000006", "Ofis"],
  ["81000000-0000-4000-8000-000000000007", "external_service", "82000000-0000-4000-8000-000000000007", "Dış hizmet"],
  ["81000000-0000-4000-8000-000000000008", "tax_fee", "82000000-0000-4000-8000-000000000008", "Vergi / harç"],
  ["81000000-0000-4000-8000-000000000009", "other", "82000000-0000-4000-8000-000000000009", "Diğer"],
]);

const EXPENSE_CATEGORY_SEED_SQL = `INSERT INTO \`expense_category\` (\`id\`, \`code\`, \`client_operation_key\`, \`display_name\`, \`is_system\`) VALUES ${EXPENSE_CATEGORY_SEED_ROWS.map(
  ([id, code, operationKey, displayName]) =>
    `('${id}', '${code}', '${operationKey}', '${displayName}', 1)`,
).join(", ")}`;

const managedForwardColumns = new Map([
  ...[
    ["bypusula_analysis", "sync_requested_at_utc", "datetime(6)"],
    ["bypusula_analysis", "sync_last_received_at_utc", "datetime(6)"],
    ["bypusula_analysis", "sync_approved_at_utc", "datetime(6)"],
    ["bypusula_analysis", "sync_approved_by_user_account_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
  ].map(([tableName, columnName, definition]) => [
    `${BYPUSULA_AUTO_SYNC_MIGRATION_TAG}:${tableName}:${columnName}`,
    { columnName, definition, tableName },
  ]),
  ...[
    ["consulting_contract", "archive_reason", "varchar(500)"],
    ["consulting_contract", "archived_at_utc", "datetime(6)"],
    ["consulting_contract", "archived_by_user_account_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
    ["consulting_contract", "version", "int unsigned DEFAULT 1 NOT NULL"],
    ["customer", "archive_reason", "varchar(500)"],
    ["customer", "archived_at_utc", "datetime(6)"],
    ["customer", "archived_by_user_account_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
    ["customer", "version", "int unsigned DEFAULT 1 NOT NULL"],
    ["project", "archive_reason", "varchar(500)"],
    ["project", "archived_at_utc", "datetime(6)"],
    ["project", "archived_by_user_account_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
    ["work_task", "archive_reason", "varchar(500)"],
    ["work_task", "archived_at_utc", "datetime(6)"],
    ["work_task", "archived_by_user_account_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
  ].map(([tableName, columnName, definition]) => [
    `${RECORD_LIFECYCLE_MIGRATION_TAG}:${tableName}:${columnName}`,
    { columnName, definition, tableName },
  ]),
  ...[
    ["partnership_contribution_receipt", "entry_type", "varchar(16) DEFAULT 'receipt' NOT NULL"],
    ["partnership_contribution_receipt", "reversal_of_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
    ["partnership_contribution_receipt", "reversal_reason", "varchar(2000)"],
    ["receivable", "record_state", "varchar(16) DEFAULT 'active' NOT NULL"],
    ["receivable", "void_reason", "varchar(2000)"],
    ["receivable", "voided_at_utc", "datetime(6)"],
    ["receivable", "version", "int unsigned DEFAULT 1 NOT NULL"],
    ["receivable_collection", "entry_type", "varchar(16) DEFAULT 'collection' NOT NULL"],
    ["receivable_collection", "reversal_of_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
    ["receivable_collection", "reversal_reason", "varchar(2000)"],
  ].map(([tableName, columnName, definition]) => [
    `${FINANCIAL_REVERSALS_MIGRATION_TAG}:${tableName}:${columnName}`,
    { columnName, definition, tableName },
  ]),
  ...[
    [
      "monthly_visit_commitment",
      "location_label",
      "varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    ],
  ].map(([tableName, columnName, definition]) => [
    `${PLANNING_EXPENSE_CATEGORIES_MIGRATION_TAG}:${tableName}:${columnName}`,
    { columnName, definition, tableName },
  ]),
  ...[
    ["expense", "source_account_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
    ["expense", "finance_transaction_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
  ].map(([tableName, columnName, definition]) => [
    `${EXPENSE_ACCOUNT_LEDGER_MIGRATION_TAG}:${tableName}:${columnName}`,
    { columnName, definition, tableName },
  ]),
  ...[
    ["work_task", "recurrence_frequency", "varchar(16) CHARACTER SET ascii COLLATE ascii_bin"],
    ["work_task", "recurrence_anchor_day", "tinyint unsigned"],
    ["work_task", "recurrence_ends_on", "date"],
    ["work_task", "recurrence_series_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
    ["work_task", "recurrence_generated_from_task_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
  ].map(([tableName, columnName, definition]) => [
    `${RECURRING_TASKS_EXPENSES_MIGRATION_TAG}:${tableName}:${columnName}`,
    { columnName, definition, tableName },
  ]),
  ...[
    ["credit_card_installment", "finance_transaction_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
    ["receivable_collection", "finance_transaction_id", "char(36) CHARACTER SET ascii COLLATE ascii_bin"],
  ].map(([tableName, columnName, definition]) => [
    `${COLLECTION_CARD_ACCOUNTS_MIGRATION_TAG}:${tableName}:${columnName}`,
    { columnName, definition, tableName },
  ]),
]);

const managedDroppedChecks = new Set([
  `${RECORD_LIFECYCLE_MIGRATION_TAG}:consulting_contract:chk_consulting_contract_timeline`,
  `${RECORD_LIFECYCLE_MIGRATION_TAG}:customer:chk_customer_timeline`,
  `${RECORD_LIFECYCLE_MIGRATION_TAG}:project:chk_project_timeline`,
  `${RECORD_LIFECYCLE_MIGRATION_TAG}:user_permission:chk_user_permission_code`,
  `${RECORD_LIFECYCLE_MIGRATION_TAG}:work_task:chk_work_task_status`,
  `${RECORD_LIFECYCLE_MIGRATION_TAG}:work_task:chk_work_task_timeline`,
  `${FINANCIAL_REVERSALS_MIGRATION_TAG}:partnership_contribution_receipt:chk_partnership_contribution_receipt_identity`,
  `${FINANCIAL_REVERSALS_MIGRATION_TAG}:receivable:chk_receivable_timeline`,
  `${FINANCIAL_REVERSALS_MIGRATION_TAG}:receivable_collection:chk_receivable_collection_identity`,
  `${FINANCE_ACCOUNTS_LEDGER_MIGRATION_TAG}:user_permission:chk_user_permission_code`,
  `${PLANNING_EXPENSE_CATEGORIES_MIGRATION_TAG}:expense:chk_expense_category`,
  `${PLANNING_EXPENSE_CATEGORIES_MIGRATION_TAG}:monthly_visit_commitment:chk_monthly_visit_optional_fields`,
  `${TAX_OBLIGATIONS_MIGRATION_TAG}:user_permission:chk_user_permission_code`,
  `${EXPENSE_ACCOUNT_LEDGER_MIGRATION_TAG}:expense:chk_expense_identity`,
]);

const managedDroppedIndexes = new Map([
  [
    `${RECORD_LIFECYCLE_MIGRATION_TAG}:consulting_contract:idx_consulting_contract_customer_status`,
    ["customer_id", "status", "ends_on"],
  ],
  [
    `${RECORD_LIFECYCLE_MIGRATION_TAG}:customer:idx_customer_status_name`,
    ["status", "display_name"],
  ],
  [
    `${RECORD_LIFECYCLE_MIGRATION_TAG}:project:idx_project_status_name`,
    ["status", "display_name"],
  ],
  [
    `${RECORD_LIFECYCLE_MIGRATION_TAG}:work_task:idx_work_task_board`,
    ["status", "due_on", "updated_at_utc"],
  ],
]);

const managedUniqueConstraints = new Set([
  `${FINANCIAL_REVERSALS_MIGRATION_TAG}:partnership_contribution_receipt:uq_partnership_contribution_receipt_reversal:reversal_of_id`,
  `${FINANCIAL_REVERSALS_MIGRATION_TAG}:receivable_collection:uq_receivable_collection_reversal:reversal_of_id`,
  `${EXPENSE_ACCOUNT_LEDGER_MIGRATION_TAG}:expense:uq_expense_finance_transaction:finance_transaction_id`,
  `${RECURRING_TASKS_EXPENSES_MIGRATION_TAG}:work_task:uq_work_task_recurrence_source:recurrence_generated_from_task_id`,
  `${COLLECTION_CARD_ACCOUNTS_MIGRATION_TAG}:credit_card_installment:uq_credit_card_installment_finance_transaction:finance_transaction_id`,
  `${COLLECTION_CARD_ACCOUNTS_MIGRATION_TAG}:receivable_collection:uq_receivable_collection_finance_transaction:finance_transaction_id`,
]);
const CUSTOMER_PROJECT_BACKFILL_SQL = `INSERT INTO \`customer_project\` (\`customer_id\`, \`project_id\`, \`status\`, \`version\`, \`created_at_utc\`, \`updated_at_utc\`) SELECT \`seed\`.\`customer_id\`, \`seed\`.\`project_id\`, 'active', 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6) FROM (SELECT \`customer\`.\`id\` AS \`customer_id\`, \`project\`.\`id\` AS \`project_id\` FROM \`customer\` CROSS JOIN \`project\` WHERE BINARY \`project\`.\`short_code\` = BINARY 'MUHENDIS_KAFASI' UNION DISTINCT SELECT \`work_task\`.\`customer_id\` AS \`customer_id\`, \`work_task_project\`.\`project_id\` AS \`project_id\` FROM \`work_task\` JOIN \`work_task_project\` ON \`work_task_project\`.\`task_id\` = \`work_task\`.\`id\` WHERE \`work_task\`.\`customer_id\` IS NOT NULL) AS \`seed\``;
const CONSULTING_CONTRACT_BACKFILL_SQL = `UPDATE \`consulting_contract\` JOIN \`project\` ON BINARY \`project\`.\`short_code\` = BINARY 'MUHENDIS_KAFASI' SET \`consulting_contract\`.\`project_id\` = \`project\`.\`id\` WHERE \`consulting_contract\`.\`project_id\` IS NULL`;
const RECEIVABLE_BACKFILL_SQL = `UPDATE \`receivable\` LEFT JOIN \`consulting_contract\` ON \`consulting_contract\`.\`id\` = \`receivable\`.\`contract_id\` JOIN \`project\` ON BINARY \`project\`.\`short_code\` = BINARY 'MUHENDIS_KAFASI' SET \`receivable\`.\`project_id\` = COALESCE(\`consulting_contract\`.\`project_id\`, \`project\`.\`id\`) WHERE \`receivable\`.\`project_id\` IS NULL`;

const defaultProjectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class PhpMyAdminBundleError extends Error {
  constructor(message = "phpMyAdmin migration bundle generation failed.") {
    super(message);
    this.name = "PhpMyAdminBundleError";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertExactManagedMigrationStatement(statement, migrationTag) {
  let acceptedHashes = null;
  if (migrationTag === EXPENSE_ACCOUNT_LEDGER_MIGRATION_TAG) {
    acceptedHashes = EXPENSE_ACCOUNT_LEDGER_STATEMENT_HASHES;
  } else if (migrationTag === RECURRING_TASKS_EXPENSES_MIGRATION_TAG) {
    acceptedHashes = RECURRING_TASKS_EXPENSES_STATEMENT_HASHES;
  } else if (migrationTag === COLLECTION_CARD_ACCOUNTS_MIGRATION_TAG) {
    acceptedHashes = COLLECTION_CARD_ACCOUNTS_STATEMENT_HASHES;
  } else if (migrationTag === PARTIAL_CARD_PAYMENTS_MIGRATION_TAG) {
    acceptedHashes = PARTIAL_CARD_PAYMENTS_STATEMENT_HASHES;
  } else if (migrationTag === BYPUSULA_TRANSFER_MIGRATION_TAG) {
    acceptedHashes = BYPUSULA_TRANSFER_STATEMENT_HASHES;
  } else if (migrationTag === BYPUSULA_AUTO_SYNC_MIGRATION_TAG) {
    acceptedHashes = BYPUSULA_AUTO_SYNC_STATEMENT_HASHES;
  }
  if (acceptedHashes === null) return;

  const normalized = statement.replaceAll(/\s+/gu, " ").trim();
  if (!acceptedHashes.has(sha256(normalized))) {
    throw new PhpMyAdminBundleError();
  }
}

function sqlHex(value) {
  return `0x${Buffer.from(value, "utf8").toString("hex")}`;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function quotedIdentifier(identifier) {
  if (!safeIdentifier.test(identifier)) {
    throw new PhpMyAdminBundleError();
  }
  return `\`${identifier}\``;
}

function sqlStringList(values) {
  return values.map(sqlString).join(", ");
}

function mysqlSessionPolicyPredicate() {
  return [
    `@@SESSION.character_set_client = ${sqlString(MYSQL_SESSION_CHARACTER_SET)}`,
    `@@SESSION.character_set_connection = ${sqlString(MYSQL_SESSION_CHARACTER_SET)}`,
    `@@SESSION.character_set_results = ${sqlString(MYSQL_SESSION_CHARACTER_SET)}`,
    `@@SESSION.collation_connection = ${sqlString(MYSQL_SESSION_COLLATION)}`,
    `@@SESSION.time_zone = ${sqlString(MYSQL_SESSION_TIME_ZONE)}`,
    "@@SESSION.autocommit = 1",
    "@@SESSION.check_constraint_checks = 1",
    "@@SESSION.foreign_key_checks = 1",
    "@@SESSION.unique_checks = 1",
    `@@SESSION.default_storage_engine = ${sqlString(MYSQL_SESSION_STORAGE_ENGINE)}`,
    `BINARY @@SESSION.sql_mode = BINARY ${sqlString(MYSQL_SESSION_SQL_MODE)}`,
  ].join(" AND ");
}

function validateTargetDatabaseSha256(targetDatabaseSha256) {
  if (
    typeof targetDatabaseSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(targetDatabaseSha256)
  ) {
    throw new PhpMyAdminBundleError(
      "PHPMYADMIN_TARGET_DB_SHA256 is missing or invalid.",
    );
  }
}

function validateServerVersionSha256(serverVersionSha256) {
  if (
    typeof serverVersionSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(serverVersionSha256)
  ) {
    throw new PhpMyAdminBundleError(
      "PHPMYADMIN_SERVER_VERSION_SHA256 is missing or invalid.",
    );
  }
}

function splitMigrationSql(sql) {
  const segments = sql.split(migrationBreakpoint);
  if (segments.some((segment) => segment.trim().length === 0)) {
    throw new PhpMyAdminBundleError();
  }
  const statements = segments.map((statement) =>
    statement.trim().replace(/;\s*$/u, "").trim(),
  );

  if (statements.length === 0) {
    throw new PhpMyAdminBundleError();
  }

  return statements;
}

function matchingClosingParenthesis(statement, openingIndex) {
  let depth = 0;
  let quote = null;

  for (let index = openingIndex; index < statement.length; index += 1) {
    const character = statement[index];
    if (quote !== null) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }
      if (character === quote) {
        if (statement[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return -1;
    }
  }

  return -1;
}

function parseCreateTable(statement) {
  const match = /^CREATE\s+TABLE\s+`([^`]+)`\s*\(/iu.exec(statement);
  if (!match) return null;

  const openingIndex = match[0].lastIndexOf("(");
  const closingIndex = matchingClosingParenthesis(statement, openingIndex);
  if (closingIndex < 0) throw new PhpMyAdminBundleError();
  const suffix = statement.slice(closingIndex + 1);
  if (
    !/^\s*ENGINE\s*=\s*InnoDB\s+DEFAULT\s+CHARACTER\s+SET\s*=\s*utf8mb4\s+COLLATE\s*=\s*utf8mb4_unicode_ci(?:\s+COMMENT\s*=\s*'(?:[^'\\]|\\.|'')*')?\s*$/iu.test(
      suffix,
    )
  ) {
    throw new PhpMyAdminBundleError();
  }

  const tableName = match[1];
  quotedIdentifier(tableName);
  const columnNames = [...statement.matchAll(/^\s*`([^`]+)`\s+/gmu)].map(
    (column) => column[1],
  );
  if (columnNames.length === 0 || new Set(columnNames).size !== columnNames.length) {
    throw new PhpMyAdminBundleError();
  }
  for (const columnName of columnNames) quotedIdentifier(columnName);
  const jsonColumnNames = [
    ...statement.matchAll(/^\s*`([^`]+)`\s+json(?:\s|,)/gimu),
  ].map((column) => column[1]);

  const constraintNames = [
    ...statement.matchAll(/CONSTRAINT\s+`([^`]+)`\s+(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)/giu),
  ].map((constraint) => ({
    name: constraint[2].toUpperCase().startsWith("PRIMARY")
      ? "PRIMARY"
      : constraint[1],
    type: constraint[2].toUpperCase().replaceAll(/\s+/gu, " "),
  }));
  if (/^\s*PRIMARY\s+KEY\s*\(/imu.test(statement)) {
    constraintNames.push({ name: "PRIMARY", type: "PRIMARY KEY" });
  }
  for (const uniqueKey of statement.matchAll(
    /^\s*UNIQUE\s+KEY\s+`([^`]+)`\s*\(/gimu,
  )) {
    constraintNames.push({ name: uniqueKey[1], type: "UNIQUE" });
  }
  const uniqueConstraintKeys = new Set(
    constraintNames.map((constraint) => `${constraint.type}:${constraint.name}`),
  );
  if (uniqueConstraintKeys.size !== constraintNames.length) {
    throw new PhpMyAdminBundleError();
  }
  for (const constraint of constraintNames) quotedIdentifier(constraint.name);

  return {
    columnNames,
    constraintNames,
    jsonColumnNames,
    tableName,
    type: "create-table",
  };
}

function parseAlterConstraint(statement) {
  const match = /^ALTER\s+TABLE\s+`([^`]+)`\s+ADD\s+CONSTRAINT\s+`([^`]+)`\s+(FOREIGN\s+KEY|CHECK)\b/iu.exec(
    statement,
  );
  if (!match) return null;
  quotedIdentifier(match[1]);
  quotedIdentifier(match[2]);

  if (/\bFOREIGN\s+KEY\b/iu.test(match[3])) {
    const foreignKey = /^ALTER\s+TABLE\s+`[^`]+`\s+ADD\s+CONSTRAINT\s+`[^`]+`\s+FOREIGN\s+KEY\s*\(`([^`]+)`\)\s+REFERENCES\s+`([^`]+)`\s*\(`([^`]+)`\)\s+ON\s+DELETE\s+(RESTRICT)\s+ON\s+UPDATE\s+(RESTRICT)\s*$/iu.exec(
      statement,
    );
    if (!foreignKey) throw new PhpMyAdminBundleError();
    for (const identifier of foreignKey.slice(1, 4)) quotedIdentifier(identifier);
    return {
      columnName: foreignKey[1],
      constraintName: match[2],
      referencedColumnName: foreignKey[3],
      referencedTableName: foreignKey[2],
      tableName: match[1],
      type: "foreign-key",
    };
  }

  const checkRemainder = statement.slice(match[0].length).trimStart();
  if (checkRemainder[0] !== "(") throw new PhpMyAdminBundleError();
  const closingIndex = matchingClosingParenthesis(checkRemainder, 0);
  if (
    closingIndex < 0 ||
    checkRemainder.slice(closingIndex + 1).trim().length !== 0
  ) {
    throw new PhpMyAdminBundleError();
  }

  return {
    constraintName: match[2],
    tableName: match[1],
    type: "check",
  };
}

function parseCreateIndex(statement) {
  const match = /^CREATE\s+INDEX\s+`([^`]+)`\s+ON\s+`([^`]+)`\s*\(([^)]+)\)$/iu.exec(
    statement.trim(),
  );
  if (!match) return null;
  quotedIdentifier(match[1]);
  quotedIdentifier(match[2]);
  const columnNames = [...match[3].matchAll(/`([^`]+)`/gu)].map(
    (column) => column[1],
  );
  const indexColumns = match[3].split(",").map((column) => column.trim());
  if (
    columnNames.length === 0 ||
    indexColumns.length !== columnNames.length ||
    indexColumns.some((column) => !/^`[A-Za-z0-9_]{1,64}`$/u.test(column))
  ) {
    throw new PhpMyAdminBundleError();
  }
  for (const columnName of columnNames) quotedIdentifier(columnName);
  return {
    columnNames,
    indexName: match[1],
    tableName: match[2],
    type: "create-index",
  };
}

function parseCustomerProjectsPartnershipStatement(statement) {
  const normalized = statement.replaceAll(/\s+/gu, " ").trim();
  if (normalized === CUSTOMER_PROJECT_BACKFILL_SQL) {
    return { tableName: "customer_project", type: "data-backfill" };
  }
  if (normalized === CONSULTING_CONTRACT_BACKFILL_SQL) {
    return { tableName: "consulting_contract", type: "data-backfill" };
  }
  if (normalized === RECEIVABLE_BACKFILL_SQL) {
    return { tableName: "receivable", type: "data-backfill" };
  }

  const addColumn = /^ALTER\s+TABLE\s+`(consulting_contract|receivable)`\s+ADD(?:\s+COLUMN)?\s+`project_id`\s+char\(36\)\s+CHARACTER\s+SET\s+ascii\s+COLLATE\s+ascii_bin\s*$/iu.exec(
    statement,
  );
  if (addColumn) {
    return {
      columnName: "project_id",
      tableName: addColumn[1],
      type: "add-column",
    };
  }

  const compositeForeignKey = /^ALTER\s+TABLE\s+`(consulting_contract|receivable)`\s+ADD\s+CONSTRAINT\s+`(fk_(?:consulting_contract|receivable)_customer_project)`\s+FOREIGN\s+KEY\s*\(`customer_id`,`project_id`\)\s+REFERENCES\s+`customer_project`\s*\(`customer_id`,`project_id`\)\s+ON\s+DELETE\s+RESTRICT\s+ON\s+UPDATE\s+RESTRICT\s*$/iu.exec(
    statement,
  );
  if (compositeForeignKey) {
    const expectedConstraint =
      compositeForeignKey[1] === "consulting_contract"
        ? "fk_consulting_contract_customer_project"
        : "fk_receivable_customer_project";
    if (compositeForeignKey[2] !== expectedConstraint) {
      throw new PhpMyAdminBundleError();
    }
    return {
      columnNames: ["customer_id", "project_id"],
      constraintName: compositeForeignKey[2],
      referencedColumnNames: ["customer_id", "project_id"],
      referencedTableName: "customer_project",
      tableName: compositeForeignKey[1],
      type: "foreign-key",
    };
  }

  if (
    /^CREATE\s+UNIQUE\s+INDEX\s+`uq_consulting_contract_customer_project_start`\s+ON\s+`consulting_contract`\s*\(`customer_id`,`project_id`,`starts_on`\)\s*$/iu.test(
      statement,
    )
  ) {
    return {
      columnNames: ["customer_id", "project_id", "starts_on"],
      indexName: "uq_consulting_contract_customer_project_start",
      tableName: "consulting_contract",
      type: "create-index",
      unique: true,
    };
  }

  if (
    /^DROP\s+INDEX\s+`uq_consulting_contract_customer_start`\s+ON\s+`consulting_contract`\s*$/iu.test(
      statement,
    )
  ) {
    return {
      columnNames: ["customer_id", "starts_on"],
      indexName: "uq_consulting_contract_customer_start",
      tableName: "consulting_contract",
      type: "drop-index",
      unique: true,
    };
  }

  return null;
}

function parseUserPermissionsStatement(statement) {
  const normalized = statement.replaceAll(/\s+/gu, " ").trim();

  if (
    normalized ===
    "ALTER TABLE `user_account` DROP CONSTRAINT `chk_user_account_state`"
  ) {
    return {
      constraintName: "chk_user_account_state",
      tableName: "user_account",
      type: "drop-check",
    };
  }

  if (
    normalized ===
    "ALTER TABLE `user_account` ADD `display_name` varchar(191) NOT NULL DEFAULT 'Portal Yöneticisi' AFTER `email`, ADD `role` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'owner' AFTER `credential_version`"
  ) {
    return {
      columnNames: ["display_name", "role"],
      tableName: "user_account",
      type: "add-user-account-columns",
    };
  }

  if (
    normalized ===
    "ALTER TABLE `user_account` MODIFY `display_name` varchar(191) NOT NULL, MODIFY `role` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'member'"
  ) {
    return {
      columnNames: ["display_name", "role"],
      tableName: "user_account",
      type: "modify-user-account-columns",
    };
  }

  return null;
}

function parsePlanningExpenseCategoriesStatement(statement) {
  const normalized = statement.replaceAll(/\s+/gu, " ").trim();
  if (normalized !== EXPENSE_CATEGORY_SEED_SQL) return null;
  return {
    name: "seed_expense_category",
    rows: EXPENSE_CATEGORY_SEED_ROWS.map(([id, code]) => ({ code, id })),
    tableName: "expense_category",
    type: "data-seed",
  };
}

function parsePartialCardPaymentsStatement(statement) {
  const normalized = statement.replaceAll(/\s+/gu, " ").trim();
  if (normalized !== PARTIAL_CARD_PAYMENTS_BACKFILL_SQL) return null;
  return {
    backfillKind: "credit-card-installment-payments",
    name: "backfill_credit_card_installment_payments",
    tableName: "credit_card_installment_payment",
    type: "data-backfill",
  };
}

function managedColumnSpec(definition) {
  const varchar = /^varchar\((\d+)\)(?: CHARACTER SET (ascii|utf8mb4) COLLATE (ascii_bin|utf8mb4_unicode_ci))?(?: DEFAULT '([^']+)')?( NOT NULL)?$/u.exec(
    definition,
  );
  if (varchar) {
    return {
      characterSet: varchar[2],
      collation: varchar[3],
      columnType: `varchar(${varchar[1]})`,
      dataType: "varchar",
      defaultValue: varchar[4] ?? null,
      maxLength: Number(varchar[1]),
      nullable: varchar[5] === undefined,
    };
  }

  const char = /^char\((\d+)\)( CHARACTER SET ascii COLLATE ascii_bin)?$/u.exec(
    definition,
  );
  if (char) {
    return {
      characterSet: char[2] === undefined ? undefined : "ascii",
      collation: char[2] === undefined ? undefined : "ascii_bin",
      dataType: "char",
      defaultValue: null,
      maxLength: Number(char[1]),
      nullable: true,
    };
  }

  const datetime = /^datetime\((\d+)\)$/u.exec(definition);
  if (datetime) {
    return {
      dataType: "datetime",
      datetimePrecision: Number(datetime[1]),
      defaultValue: null,
      nullable: true,
    };
  }

  if (definition === "int unsigned DEFAULT 1 NOT NULL") {
    return {
      dataType: "int",
      defaultValue: "1",
      nullable: false,
      unsigned: true,
    };
  }

  if (definition === "tinyint unsigned") {
    return {
      dataType: "tinyint",
      defaultValue: null,
      nullable: true,
      unsigned: true,
    };
  }

  if (definition === "date") {
    return {
      dataType: "date",
      defaultValue: null,
      nullable: true,
    };
  }

  throw new PhpMyAdminBundleError();
}

function parseManagedForwardStatement(statement, migrationTag) {
  if (
    migrationTag !== RECORD_LIFECYCLE_MIGRATION_TAG &&
    migrationTag !== FINANCIAL_REVERSALS_MIGRATION_TAG &&
    migrationTag !== FINANCE_ACCOUNTS_LEDGER_MIGRATION_TAG &&
    migrationTag !== PLANNING_EXPENSE_CATEGORIES_MIGRATION_TAG &&
    migrationTag !== TAX_OBLIGATIONS_MIGRATION_TAG &&
    migrationTag !== EXPENSE_ACCOUNT_LEDGER_MIGRATION_TAG &&
    migrationTag !== RECURRING_TASKS_EXPENSES_MIGRATION_TAG &&
    migrationTag !== COLLECTION_CARD_ACCOUNTS_MIGRATION_TAG &&
    migrationTag !== BYPUSULA_AUTO_SYNC_MIGRATION_TAG
  ) {
    return null;
  }

  const normalized = statement.replaceAll(/\s+/gu, " ").trim();
  const dropCheck = /^ALTER TABLE `([^`]+)` DROP CONSTRAINT `([^`]+)`$/u.exec(
    normalized,
  );
  if (dropCheck) {
    const key = `${migrationTag}:${dropCheck[1]}:${dropCheck[2]}`;
    if (!managedDroppedChecks.has(key)) throw new PhpMyAdminBundleError();
    return {
      constraintName: dropCheck[2],
      tableName: dropCheck[1],
      type: "drop-check",
    };
  }

  const dropIndex = /^DROP INDEX `([^`]+)` ON `([^`]+)`$/u.exec(normalized);
  if (dropIndex) {
    const key = `${migrationTag}:${dropIndex[2]}:${dropIndex[1]}`;
    const columnNames = managedDroppedIndexes.get(key);
    if (!columnNames) throw new PhpMyAdminBundleError();
    return {
      columnNames,
      indexName: dropIndex[1],
      tableName: dropIndex[2],
      type: "drop-index",
      unique: false,
    };
  }

  const addColumn = /^ALTER TABLE `([^`]+)` ADD `([^`]+)` (.+)$/u.exec(
    normalized,
  );
  if (addColumn) {
    const key = `${migrationTag}:${addColumn[1]}:${addColumn[2]}`;
    const allowed = managedForwardColumns.get(key);
    if (!allowed || addColumn[3] !== allowed.definition) {
      throw new PhpMyAdminBundleError();
    }
    return {
      columnName: allowed.columnName,
      columnSpec: managedColumnSpec(allowed.definition),
      tableName: allowed.tableName,
      type: "add-column",
    };
  }

  const uniqueConstraint = /^ALTER TABLE `([^`]+)` ADD CONSTRAINT `([^`]+)` UNIQUE\(`([^`]+)`\)$/u.exec(
    normalized,
  );
  if (uniqueConstraint) {
    const key = `${migrationTag}:${uniqueConstraint[1]}:${uniqueConstraint[2]}:${uniqueConstraint[3]}`;
    if (!managedUniqueConstraints.has(key)) throw new PhpMyAdminBundleError();
    return {
      columnNames: [uniqueConstraint[3]],
      indexName: uniqueConstraint[2],
      tableName: uniqueConstraint[1],
      type: "create-index",
      unique: true,
    };
  }

  return null;
}

function hasUnquotedSemicolon(statement) {
  let quote = null;
  for (let index = 0; index < statement.length; index += 1) {
    const character = statement[index];
    if (quote !== null) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }
      if (character === quote) {
        if (statement[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === ";") {
      return true;
    }
  }
  return false;
}

export function analyzeMigrationStatement(statement, migrationTag) {
  if (
    typeof statement !== "string" ||
    statement.length === 0 ||
    /\b(?:PREPARE|EXECUTE|DEALLOCATE|SIGNAL|RESIGNAL|DELIMITER|PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/iu.test(
      statement,
    ) ||
    /@/u.test(statement) ||
    hasUnquotedSemicolon(statement)
  ) {
    throw new PhpMyAdminBundleError();
  }

  assertExactManagedMigrationStatement(statement, migrationTag);

  if (migrationTag === BYPUSULA_TRANSFER_MIGRATION_TAG &&
      /^ALTER\s+TABLE\s+`bypusula_analysis`\s+ADD\s+CONSTRAINT\s+`fk_bypusula_analysis_mapping`\s/iu.test(statement)) {
    // Exact statement hash above locks both ordered columns and FK actions.
    return {
      columnNames: ["customer_id", "project_id"],
      constraintName: "fk_bypusula_analysis_mapping",
      referencedColumnNames: ["customer_id", "project_id"],
      referencedTableName: "customer_project",
      tableName: "bypusula_analysis",
      type: "foreign-key",
    };
  }

  const customerProjectsPartnershipAnalysis =
    migrationTag === CUSTOMER_PROJECTS_PARTNERSHIP_MIGRATION_TAG
      ? parseCustomerProjectsPartnershipStatement(statement)
      : null;
  if (customerProjectsPartnershipAnalysis) {
    return customerProjectsPartnershipAnalysis;
  }

  const userPermissionsAnalysis =
    migrationTag === USER_PERMISSIONS_MIGRATION_TAG
      ? parseUserPermissionsStatement(statement)
      : null;
  if (userPermissionsAnalysis) {
    return userPermissionsAnalysis;
  }

  const planningExpenseCategoriesAnalysis =
    migrationTag === PLANNING_EXPENSE_CATEGORIES_MIGRATION_TAG
      ? parsePlanningExpenseCategoriesStatement(statement)
      : null;
  if (planningExpenseCategoriesAnalysis) {
    return planningExpenseCategoriesAnalysis;
  }

  const partialCardPaymentsAnalysis =
    migrationTag === PARTIAL_CARD_PAYMENTS_MIGRATION_TAG
      ? parsePartialCardPaymentsStatement(statement)
      : null;
  if (partialCardPaymentsAnalysis) return partialCardPaymentsAnalysis;

  const managedForwardAnalysis = parseManagedForwardStatement(
    statement,
    migrationTag,
  );
  if (managedForwardAnalysis) return managedForwardAnalysis;

  if (
    /^\s*(?:DROP|TRUNCATE|RENAME|REPLACE|DELETE|UPDATE)\s/iu.test(
      statement,
    )
  ) {
    throw new PhpMyAdminBundleError();
  }

  const analysis =
    parseCreateTable(statement) ??
    parseAlterConstraint(statement) ??
    parseCreateIndex(statement);
  if (!analysis) throw new PhpMyAdminBundleError();
  return analysis;
}

function constraintPredicate(tableName, constraintName, constraintType) {
  return `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE()
               AND TABLE_NAME = ${sqlString(tableName)}
               AND CONSTRAINT_NAME = ${sqlString(constraintName)}
               AND CONSTRAINT_TYPE = ${sqlString(constraintType)}) = 1`;
}

function managedColumnVerificationPredicate(analysis) {
  const spec = analysis.columnSpec;
  const predicates = [
    `TABLE_SCHEMA = DATABASE()`,
    `TABLE_NAME = ${sqlString(analysis.tableName)}`,
    `COLUMN_NAME = ${sqlString(analysis.columnName)}`,
    `DATA_TYPE = ${sqlString(spec.dataType)}`,
    `IS_NULLABLE = ${sqlString(spec.nullable ? "YES" : "NO")}`,
    "EXTRA = ''",
  ];
  if (spec.maxLength !== undefined) {
    predicates.push(`CHARACTER_MAXIMUM_LENGTH = ${spec.maxLength}`);
  }
  if (spec.columnType !== undefined) {
    predicates.push(`COLUMN_TYPE = ${sqlString(spec.columnType)}`);
  }
  if (spec.characterSet !== undefined) {
    predicates.push(`CHARACTER_SET_NAME = ${sqlString(spec.characterSet)}`);
  }
  if (spec.collation !== undefined) {
    predicates.push(`COLLATION_NAME = ${sqlString(spec.collation)}`);
  }
  if (spec.datetimePrecision !== undefined) {
    predicates.push(`DATETIME_PRECISION = ${spec.datetimePrecision}`);
  }
  if (spec.unsigned === true) {
    predicates.push("COLUMN_TYPE LIKE '%unsigned%'");
  }
  predicates.push(
    spec.defaultValue === null
      ? "(COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')"
      : `REPLACE(COLUMN_DEFAULT, '''', '') = ${sqlString(spec.defaultValue)}`,
  );
  return `(SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE ${predicates.join("\n               AND ")}) = 1`;
}

function dataSeedVerificationPredicate(analysis) {
  const rowPredicates = analysis.rows.map(
    (row) =>
      `(BINARY \`id\` = BINARY ${sqlString(row.id)} AND BINARY \`code\` = BINARY ${sqlString(row.code)} AND \`is_system\` = 1)`,
  );
  return `(SELECT COUNT(*) FROM ${quotedIdentifier(analysis.tableName)}
             WHERE ${rowPredicates.join(" OR ")}) = ${analysis.rows.length}
          AND (SELECT COUNT(*) FROM ${quotedIdentifier(analysis.tableName)}) = ${analysis.rows.length}`;
}

function statementVerificationPredicate(analysis) {
  if (analysis.type === "drop-check") {
    return `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE()
                 AND TABLE_NAME = ${sqlString(analysis.tableName)}
                 AND CONSTRAINT_NAME = ${sqlString(analysis.constraintName)}) = 0`;
  }

  if (analysis.type === "add-user-account-columns") {
    return `(SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = 'user_account'
                 AND COLUMN_NAME = 'display_name'
                 AND DATA_TYPE = 'varchar'
                 AND CHARACTER_MAXIMUM_LENGTH = 191
                 AND IS_NULLABLE = 'NO') = 1
            AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                     AND TABLE_NAME = 'user_account'
                     AND COLUMN_NAME = 'role'
                     AND DATA_TYPE = 'varchar'
                     AND CHARACTER_MAXIMUM_LENGTH = 16
                     AND CHARACTER_SET_NAME = 'ascii'
                     AND COLLATION_NAME = 'ascii_bin'
                     AND IS_NULLABLE = 'NO') = 1`;
  }

  if (analysis.type === "modify-user-account-columns") {
    return `(SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = 'user_account'
                 AND COLUMN_NAME = 'display_name'
                 AND DATA_TYPE = 'varchar'
                 AND CHARACTER_MAXIMUM_LENGTH = 191
                 AND IS_NULLABLE = 'NO'
                 AND COLUMN_DEFAULT IS NULL) = 1
            AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                     AND TABLE_NAME = 'user_account'
                     AND COLUMN_NAME = 'role'
                     AND DATA_TYPE = 'varchar'
                     AND CHARACTER_MAXIMUM_LENGTH = 16
                     AND CHARACTER_SET_NAME = 'ascii'
                     AND COLLATION_NAME = 'ascii_bin'
                     AND IS_NULLABLE = 'NO'
                     AND REPLACE(COLUMN_DEFAULT, '''', '') = 'member') = 1`;
  }

  if (analysis.type === "add-column") {
    if (analysis.columnSpec !== undefined) {
      return managedColumnVerificationPredicate(analysis);
    }
    return `(SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = ${sqlString(analysis.tableName)}
                 AND COLUMN_NAME = ${sqlString(analysis.columnName)}
                 AND DATA_TYPE = 'char'
                 AND COLUMN_TYPE = 'char(36)'
                 AND CHARACTER_SET_NAME = 'ascii'
                 AND COLLATION_NAME = 'ascii_bin'
                 AND IS_NULLABLE = 'YES'
                 AND (COLUMN_DEFAULT IS NULL OR BINARY COLUMN_DEFAULT = BINARY 'NULL')
                 AND EXTRA = '') = 1`;
  }

  if (analysis.type === "data-backfill") {
    return `(SELECT COUNT(*) FROM ${quotedIdentifier(analysis.tableName)}) = 0`;
  }

  if (analysis.type === "data-seed") {
    return dataSeedVerificationPredicate(analysis);
  }

  if (analysis.type === "drop-index") {
    return `(SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = ${sqlString(analysis.tableName)}
                 AND INDEX_NAME = ${sqlString(analysis.indexName)}) = 0`;
  }

  if (analysis.type === "create-table") {
    const constraints = analysis.constraintNames.map((constraint) => {
      const type =
        constraint.type === "UNIQUE"
          ? "UNIQUE"
          : constraint.type === "CHECK"
            ? "CHECK"
            : constraint.type === "FOREIGN KEY"
              ? "FOREIGN KEY"
            : "PRIMARY KEY";
      return constraintPredicate(analysis.tableName, constraint.name, type);
    });
    return [
      `(SELECT COUNT(*) FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}
            AND TABLE_TYPE = 'BASE TABLE'
            AND ENGINE = 'InnoDB'
            AND TABLE_COLLATION = 'utf8mb4_unicode_ci') = 1`,
      `(SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}) = ${analysis.columnNames.length}`,
      `(SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}
            AND COLUMN_NAME IN (${sqlStringList(analysis.columnNames)})) = ${analysis.columnNames.length}`,
      ...constraints,
    ].join(" AND ");
  }

  if (analysis.type === "check") {
    return constraintPredicate(
      analysis.tableName,
      analysis.constraintName,
      "CHECK",
    );
  }

  if (analysis.type === "foreign-key") {
    const columnNames = analysis.columnNames ?? [analysis.columnName];
    const referencedColumnNames =
      analysis.referencedColumnNames ?? [analysis.referencedColumnName];
    return [
      constraintPredicate(
        analysis.tableName,
        analysis.constraintName,
        "FOREIGN KEY",
      ),
      `(SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}
            AND CONSTRAINT_NAME = ${sqlString(analysis.constraintName)}
            AND REFERENCED_TABLE_NAME = ${sqlString(analysis.referencedTableName)}) = ${columnNames.length}`,
      ...columnNames.map(
        (columnName, index) =>
          `(SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
              WHERE CONSTRAINT_SCHEMA = DATABASE()
                AND TABLE_NAME = ${sqlString(analysis.tableName)}
                AND CONSTRAINT_NAME = ${sqlString(analysis.constraintName)}
                AND ORDINAL_POSITION = ${index + 1}
                AND POSITION_IN_UNIQUE_CONSTRAINT = ${index + 1}
                AND COLUMN_NAME = ${sqlString(columnName)}
                AND REFERENCED_TABLE_NAME = ${sqlString(analysis.referencedTableName)}
                AND REFERENCED_COLUMN_NAME = ${sqlString(referencedColumnNames[index])}) = 1`,
      ),
      `(SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(analysis.tableName)}
            AND CONSTRAINT_NAME = ${sqlString(analysis.constraintName)}
            AND UPDATE_RULE = 'RESTRICT'
            AND DELETE_RULE = 'RESTRICT') = 1`,
    ].join(" AND ");
  }

  return `(SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ${sqlString(analysis.tableName)}
               AND INDEX_NAME = ${sqlString(analysis.indexName)}) = 1
          AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ${sqlString(analysis.tableName)}
                   AND INDEX_NAME = ${sqlString(analysis.indexName)}) = ${analysis.columnNames.length}
          AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ${sqlString(analysis.tableName)}
                 AND INDEX_NAME = ${sqlString(analysis.indexName)}
                 AND COLUMN_NAME IN (${sqlStringList(analysis.columnNames)})) = ${analysis.columnNames.length}
          ${analysis.unique === true ? `AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ${sqlString(analysis.tableName)}
                   AND INDEX_NAME = ${sqlString(analysis.indexName)}
                   AND NON_UNIQUE = 0) = ${analysis.columnNames.length}` : ""}`;
}

function guardedStatementLines({ statement, expectedStep, predicate }) {
  const candidateHash = sha256(statement);
  const sessionPolicyGuard = `@pp_session_policy_applied = 1 AND (${mysqlSessionPolicyPredicate()})`;
  return [
    `SET @pp_candidate_sql = ${sqlHex(statement)};`,
    `SET @pp_step = IF(@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${sessionPolicyGuard}) AND SHA2(@pp_candidate_sql, 256) = ${sqlString(candidateHash)}, ${expectedStep}, -1);`,
    "SET @pp_sql = NULL;",
    `SET @pp_sql = IF(@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${sessionPolicyGuard}) AND SHA2(@pp_candidate_sql, 256) = ${sqlString(candidateHash)}, @pp_candidate_sql, ${sqlHex(SAFE_NOOP_QUERY)});`,
    "PREPARE pp_bundle_statement FROM @pp_sql;",
    "EXECUTE pp_bundle_statement;",
    "DEALLOCATE PREPARE pp_bundle_statement;",
    `SET @pp_step = IF(@pp_step = ${expectedStep} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${sessionPolicyGuard}) AND (${predicate}), ${expectedStep + 1}, -1);`,
  ];
}

function journalDefinition() {
  // Keep this equivalent to drizzle-orm/mysql-core's pinned migrator DDL.
  // The real MariaDB acceptance suite compares SHOW CREATE TABLE output from
  // this bundle with a fresh run by the official migration runner.
  return `CREATE TABLE IF NOT EXISTS \`${JOURNAL_TABLE}\` (
  \`id\` SERIAL PRIMARY KEY,
  \`hash\` TEXT NOT NULL,
  \`created_at\` BIGINT
)`;
}

function journalVerificationPredicate() {
  return `(SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = '${JOURNAL_TABLE}'
               AND TABLE_TYPE = 'BASE TABLE'
               AND ENGINE = 'InnoDB'
               AND TABLE_COLLATION LIKE 'utf8mb4\\_%') = 1
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}') = 3
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}'
                   AND COLUMN_NAME IN ('id', 'hash', 'created_at')) = 3
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}'
                   AND COLUMN_NAME = 'id'
                   AND DATA_TYPE = 'bigint'
                   AND COLUMN_TYPE LIKE '%unsigned%'
                   AND IS_NULLABLE = 'NO'
                   AND EXTRA LIKE '%auto_increment%') = 1
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}'
                   AND COLUMN_NAME = 'hash'
                   AND DATA_TYPE = 'text'
                   AND IS_NULLABLE = 'NO') = 1
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}'
                   AND COLUMN_NAME = 'created_at'
                   AND DATA_TYPE = 'bigint'
                   AND COLUMN_TYPE NOT LIKE '%unsigned%'
                   AND IS_NULLABLE = 'YES') = 1
          AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}') = 1
          AND (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = '${JOURNAL_TABLE}'
                   AND INDEX_NAME = 'PRIMARY'
                   AND NON_UNIQUE = 0
                   AND SEQ_IN_INDEX = 1
                   AND COLUMN_NAME = 'id') = 1`;
}

function expectedSchema(migrations) {
  const tables = new Map();
  const checks = [];
  const foreignKeys = [];
  const indexes = [];
  const jsonChecks = [];

  for (const migration of migrations) {
    for (const item of migration.statements) {
      const analysis = item.analysis;
      if (analysis.type === "create-table") {
        if (tables.has(analysis.tableName)) throw new PhpMyAdminBundleError();
        tables.set(analysis.tableName, [...analysis.columnNames]);
        for (const columnName of analysis.jsonColumnNames) {
          jsonChecks.push({ columnName, tableName: analysis.tableName });
        }
        for (const constraint of analysis.constraintNames) {
          if (constraint.type === "CHECK") {
            checks.push({ name: constraint.name, tableName: analysis.tableName });
          } else if (constraint.type === "FOREIGN KEY") {
            foreignKeys.push({
              name: constraint.name,
              tableName: analysis.tableName,
            });
          } else if (constraint.type === "UNIQUE") {
            indexes.push({ name: constraint.name, tableName: analysis.tableName });
          } else if (constraint.type === "PRIMARY KEY") {
            indexes.push({ name: "PRIMARY", tableName: analysis.tableName });
          }
        }
      } else if (analysis.type === "check") {
        checks.push({
          name: analysis.constraintName,
          tableName: analysis.tableName,
        });
      } else if (analysis.type === "foreign-key") {
        foreignKeys.push({
          name: analysis.constraintName,
          tableName: analysis.tableName,
        });
      } else if (analysis.type === "add-column") {
        const columns = tables.get(analysis.tableName);
        if (!columns || columns.includes(analysis.columnName)) {
          throw new PhpMyAdminBundleError();
        }
        columns.push(analysis.columnName);
      } else if (analysis.type === "add-user-account-columns") {
        const columns = tables.get(analysis.tableName);
        if (
          !columns ||
          analysis.columnNames.some((columnName) => columns.includes(columnName))
        ) {
          throw new PhpMyAdminBundleError();
        }
        columns.push(...analysis.columnNames);
      } else if (analysis.type === "modify-user-account-columns") {
        const columns = tables.get(analysis.tableName);
        if (
          !columns ||
          analysis.columnNames.some((columnName) => !columns.includes(columnName))
        ) {
          throw new PhpMyAdminBundleError();
        }
      } else if (analysis.type === "drop-check") {
        const check = checks.findIndex(
          (candidate) =>
            candidate.name === analysis.constraintName &&
            candidate.tableName === analysis.tableName,
        );
        if (check < 0) throw new PhpMyAdminBundleError();
        checks.splice(check, 1);
      } else if (analysis.type === "drop-index") {
        const index = indexes.findIndex(
          (candidate) =>
            candidate.name === analysis.indexName &&
            candidate.tableName === analysis.tableName,
        );
        if (index < 0) throw new PhpMyAdminBundleError();
        indexes.splice(index, 1);
      } else if (analysis.type === "create-index") {
        indexes.push({ name: analysis.indexName, tableName: analysis.tableName });
      }
    }
  }

  return {
    checks: checks.sort((left, right) =>
      `${left.tableName}:${left.name}`.localeCompare(
        `${right.tableName}:${right.name}`,
        "en",
      ),
    ),
    foreignKeys: foreignKeys.sort((left, right) =>
      `${left.tableName}:${left.name}`.localeCompare(
        `${right.tableName}:${right.name}`,
        "en",
      ),
    ),
    indexes: indexes.sort((left, right) =>
      `${left.tableName}:${left.name}`.localeCompare(
        `${right.tableName}:${right.name}`,
        "en",
      ),
    ),
    jsonChecks: jsonChecks.sort((left, right) =>
      `${left.tableName}:${left.columnName}`.localeCompare(
        `${right.tableName}:${right.columnName}`,
        "en",
      ),
    ),
    tables: Object.fromEntries([...tables.entries()].sort()),
  };
}

function postflightPredicate(
  schema,
  migrations,
  targetDatabaseSha256,
  serverVersionSha256,
) {
  const applicationTableNames = Object.keys(schema.tables);
  const allTableNames = [...applicationTableNames, JOURNAL_TABLE].sort();
  const totalApplicationColumns = Object.values(schema.tables).reduce(
    (total, columns) => total + columns.length,
    0,
  );
  const checkNames = schema.checks.map((constraint) => constraint.name);
  const foreignKeyNames = schema.foreignKeys.map((constraint) => constraint.name);
  const explicitIndexPredicates = schema.indexes.map(
    (index) =>
      `(BINARY TABLE_NAME = BINARY ${sqlString(index.tableName)} AND BINARY INDEX_NAME = BINARY ${sqlString(index.name)})`,
  );
  const seedRowsByTable = new Map();
  for (const migration of migrations) {
    for (const item of migration.statements) {
      if (item.analysis.type !== "data-seed") continue;
      const rows = seedRowsByTable.get(item.analysis.tableName) ?? [];
      rows.push(...item.analysis.rows);
      seedRowsByTable.set(item.analysis.tableName, rows);
    }
  }

  const predicates = [
    `SHA2(DATABASE(), 256) = ${sqlString(targetDatabaseSha256)}`,
    `SHA2(VERSION(), 256) = ${sqlString(serverVersionSha256)}`,
    `(${mysqlSessionPolicyPredicate()})`,
    "@@GLOBAL.check_constraint_checks = 1",
    "@@GLOBAL.foreign_key_checks = 1",
    "@@GLOBAL.unique_checks = 1",
    "@@GLOBAL.default_storage_engine = 'InnoDB'",
    `(SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()) = ${allTableNames.length}`,
    `(SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${sqlStringList(applicationTableNames)})
          AND TABLE_TYPE = 'BASE TABLE'
          AND ENGINE = 'InnoDB'
          AND TABLE_COLLATION = 'utf8mb4_unicode_ci') = ${applicationTableNames.length}`,
    journalVerificationPredicate(),
    `(SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${sqlStringList(applicationTableNames)})) = ${totalApplicationColumns}`,
    `(SELECT COUNT(*) FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE()) = 0`,
    `(SELECT COUNT(*) FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()) = 0`,
    `(SELECT COUNT(*) FROM information_schema.EVENTS
        WHERE EVENT_SCHEMA = DATABASE()) = 0`,
    `(SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`) = ${migrations.length}`,
  ];

  for (const [tableName, columns] of Object.entries(schema.tables)) {
    const seedRows = seedRowsByTable.get(tableName) ?? [];
    predicates.push(
      `(SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(tableName)}
            AND COLUMN_NAME IN (${sqlStringList(columns)})) = ${columns.length}`,
      seedRows.length === 0
        ? `(SELECT COUNT(*) FROM ${quotedIdentifier(tableName)}) = 0`
        : dataSeedVerificationPredicate({ rows: seedRows, tableName }),
    );
  }

  if (checkNames.length > 0) {
    predicates.push(
      `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND CONSTRAINT_TYPE = 'CHECK'
            AND CONSTRAINT_NAME IN (${sqlStringList(checkNames)})) = ${checkNames.length}`,
      `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND CONSTRAINT_TYPE = 'CHECK') = ${checkNames.length + schema.jsonChecks.length}`,
      `(SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()) = ${checkNames.length + schema.jsonChecks.length}`,
    );
  }
  for (const jsonCheck of schema.jsonChecks) {
    predicates.push(
      `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND TABLE_NAME = ${sqlString(jsonCheck.tableName)}
            AND CONSTRAINT_TYPE = 'CHECK'
            AND CONSTRAINT_NAME = ${sqlString(jsonCheck.columnName)}) = 1`,
      `(SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND CONSTRAINT_NAME = ${sqlString(jsonCheck.columnName)}
            AND CHECK_CLAUSE LIKE ${sqlString(`%json_valid(\`${jsonCheck.columnName}\`)%`)}) >= 1`,
    );
  }
  if (foreignKeyNames.length > 0) {
    predicates.push(
      `(SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE()
            AND CONSTRAINT_TYPE = 'FOREIGN KEY'
            AND CONSTRAINT_NAME IN (${sqlStringList(foreignKeyNames)})) = ${foreignKeyNames.length}`,
    );
  }
  if (explicitIndexPredicates.length > 0) {
    predicates.push(
      `(SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND (${explicitIndexPredicates.join(" OR ")})) = ${schema.indexes.length}`,
    );
  }

  for (const [index, migration] of migrations.entries()) {
    predicates.push(
      `(SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`
          WHERE id = ${index + 1}
            AND OCTET_LENGTH(hash) = 64
            AND BINARY hash = BINARY ${sqlString(migration.hash)}
            AND created_at = ${migration.createdAt}) = 1`,
    );
  }

  return predicates.join(" AND ");
}

function buildSql({
  migrations,
  schema,
  targetDatabaseSha256,
  serverVersionSha256,
  bundleId,
}) {
  const lines = [
    "-- Portal Pusula clean-only phpMyAdmin migration bundle.",
    `-- Format ${FORMAT_VERSION}; bundle ${bundleId}.`,
    "-- The target database name is intentionally not present in this artifact.",
    "-- Import only into the separately verified empty staging database.",
    "SET @pp_bundle_id = NULL;",
    "SET @pp_target_database_sha256 = NULL;",
    "SET @pp_server_version_sha256 = NULL;",
    "SET @pp_lock_name = NULL;",
    "SET @pp_lock_was_already_owned = NULL;",
    "SET @pp_lock_acquired = NULL;",
    "SET @pp_release_result = NULL;",
    "SET @pp_original_sql_mode = NULL;",
    "SET @pp_session_policy_applied = 0;",
    "SET @pp_session_restore_applied = 0;",
    "SET @pp_session_mode_restored = NULL;",
    "SET @pp_candidate_sql = NULL;",
    "SET @pp_sql = NULL;",
    "SET @pp_step = NULL;",
    "SET @pp_original_sql_mode = @@SESSION.sql_mode;",
    `SET @@SESSION.sql_mode = ${sqlString(MYSQL_SESSION_SQL_MODE)},
      @@SESSION.character_set_client = ${sqlString(MYSQL_SESSION_CHARACTER_SET)},
      @@SESSION.character_set_connection = ${sqlString(MYSQL_SESSION_CHARACTER_SET)},
      @@SESSION.character_set_results = ${sqlString(MYSQL_SESSION_CHARACTER_SET)},
      @@SESSION.collation_connection = ${sqlString(MYSQL_SESSION_COLLATION)},
      @@SESSION.time_zone = ${sqlString(MYSQL_SESSION_TIME_ZONE)},
      @@SESSION.autocommit = 1,
      @@SESSION.check_constraint_checks = 1,
      @@SESSION.foreign_key_checks = 1,
      @@SESSION.unique_checks = 1,
      @@SESSION.default_storage_engine = ${sqlString(MYSQL_SESSION_STORAGE_ENGINE)},
      @pp_session_policy_applied = 1;`,
    `SET @pp_bundle_id = ${sqlString(bundleId)};`,
    `SET @pp_target_database_sha256 = ${sqlString(targetDatabaseSha256)};`,
    `SET @pp_server_version_sha256 = ${sqlString(serverVersionSha256)};`,
    `SET @pp_lock_name = CONCAT(${sqlString(MIGRATION_LOCK_PREFIX)}, LEFT(SHA2(DATABASE(), 256), ${MIGRATION_LOCK_DIGEST_HEX_LENGTH}));`,
    "SET @pp_lock_was_already_owned = COALESCE(IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID(), 0);",
    `SET @pp_step = IF(@pp_original_sql_mode IS NOT NULL AND @pp_session_policy_applied = 1 AND (${mysqlSessionPolicyPredicate()}), 0, -1);`,
    `SET @pp_lock_acquired = IF(@pp_step = 0 AND NOT @pp_lock_was_already_owned, GET_LOCK(@pp_lock_name, ${MIGRATION_LOCK_TIMEOUT_SECONDS}), 0);`,
    "SET @pp_step = IF(@pp_step = 0 AND @pp_lock_acquired = 1 AND NOT @pp_lock_was_already_owned, 0, -1);",
    `SET @pp_step = IF(
      @pp_step = 0
      AND DATABASE() IS NOT NULL
      AND SHA2(DATABASE(), 256) = @pp_target_database_sha256
      AND SHA2(VERSION(), 256) = @pp_server_version_sha256
      AND LOCATE('MariaDB', VERSION()) > 0
      AND (
        CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED) > ${MINIMUM_MARIADB_MAJOR}
        OR (
          CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED) = ${MINIMUM_MARIADB_MAJOR}
          AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 2), '.', -1) AS UNSIGNED) >= ${MINIMUM_MARIADB_MINOR}
        )
      )
      AND (${mysqlSessionPolicyPredicate()})
      AND @@GLOBAL.check_constraint_checks = 1
      AND @@GLOBAL.foreign_key_checks = 1
      AND @@GLOBAL.unique_checks = 1
      AND @@GLOBAL.default_storage_engine = 'InnoDB'
      AND (SELECT COUNT(*) FROM information_schema.ENGINES
             WHERE ENGINE = 'InnoDB' AND SUPPORT IN ('YES', 'DEFAULT')) = 1
      AND (SELECT COUNT(*) FROM information_schema.SCHEMATA
             WHERE SCHEMA_NAME = DATABASE()
               AND DEFAULT_CHARACTER_SET_NAME = 'utf8mb4') = 1
      AND (SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()) = 0
      AND (SELECT COUNT(*) FROM information_schema.ROUTINES
             WHERE ROUTINE_SCHEMA = DATABASE()) = 0
      AND (SELECT COUNT(*) FROM information_schema.TRIGGERS
             WHERE TRIGGER_SCHEMA = DATABASE()) = 0
      AND (SELECT COUNT(*) FROM information_schema.EVENTS
             WHERE EVENT_SCHEMA = DATABASE()) = 0,
      1,
      -1
    );`,
  ];

  let step = 1;
  lines.push(
    ...guardedStatementLines({
      expectedStep: step,
      predicate: journalVerificationPredicate(),
      statement: journalDefinition(),
    }),
  );
  step += 1;

  for (const [migrationIndex, migration] of migrations.entries()) {
    for (const item of migration.statements) {
      lines.push(
        ...guardedStatementLines({
          expectedStep: step,
          predicate: statementVerificationPredicate(item.analysis),
          statement: item.sql,
        }),
      );
      step += 1;
    }

    const journalInsert = `INSERT INTO \`${JOURNAL_TABLE}\` (\`hash\`, \`created_at\`) VALUES (${sqlString(migration.hash)}, ${migration.createdAt})`;
    lines.push(
      ...guardedStatementLines({
        expectedStep: step,
        predicate: `(SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`) = ${migrationIndex + 1}
          AND (SELECT COUNT(*) FROM \`${JOURNAL_TABLE}\`
                 WHERE id = ${migrationIndex + 1}
                   AND OCTET_LENGTH(hash) = 64
                   AND BINARY hash = BINARY ${sqlString(migration.hash)}
                   AND created_at = ${migration.createdAt}) = 1`,
        statement: journalInsert,
      }),
    );
    step += 1;
  }

  lines.push(
    `SET @pp_step = IF(@pp_step = ${step} AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID() AND (${postflightPredicate(
      schema,
      migrations,
      targetDatabaseSha256,
      serverVersionSha256,
    )}), ${step + 1}, -1);`,
    "SET @pp_session_restore_applied = 0;",
    "SET @@SESSION.sql_mode = COALESCE(@pp_original_sql_mode, @@SESSION.sql_mode), @pp_session_restore_applied = 1;",
    "SET @pp_session_mode_restored = COALESCE(@pp_session_restore_applied = 1 AND BINARY @@SESSION.sql_mode = BINARY @pp_original_sql_mode, 0);",
    `SET @pp_step = IF(@pp_step = ${step + 1} AND @pp_session_mode_restored = 1 AND IS_USED_LOCK(@pp_lock_name) = CONNECTION_ID(), ${step + 2}, -1);`,
    `SET @pp_release_result = IF(@pp_lock_acquired = 1 AND NOT @pp_lock_was_already_owned, RELEASE_LOCK(@pp_lock_name), 0);`,
    `SET @pp_step = IF(@pp_step = ${step + 2} AND @pp_release_result = 1 AND COALESCE(IS_USED_LOCK(@pp_lock_name) <> CONNECTION_ID(), 1), ${step + 3}, -1);`,
    "SET @pp_sql = NULL;",
    `SET @pp_sql = IF(@pp_step = ${step + 3} AND @pp_session_mode_restored = 1 AND @pp_release_result = 1 AND COALESCE(IS_USED_LOCK(@pp_lock_name) <> CONNECTION_ID(), 1), ${sqlHex("SELECT 'PORTAL_PUSULA_MIGRATION_BUNDLE_OK' AS portal_pusula_migration_bundle_result")}, ${sqlHex(GUARD_FAILURE_QUERY)});`,
    "PREPARE pp_bundle_statement FROM @pp_sql;",
    "EXECUTE pp_bundle_statement;",
    "DEALLOCATE PREPARE pp_bundle_statement;",
    "SET @pp_candidate_sql = NULL;",
    "SET @pp_sql = NULL;",
    "SET @pp_target_database_sha256 = NULL;",
    "SET @pp_server_version_sha256 = NULL;",
    "SET @pp_lock_name = NULL;",
    "SET @pp_lock_was_already_owned = NULL;",
    "SET @pp_bundle_id = NULL;",
    "SET @pp_lock_acquired = NULL;",
    "SET @pp_release_result = NULL;",
    "SET @pp_original_sql_mode = NULL;",
    "SET @pp_session_policy_applied = NULL;",
    "SET @pp_session_restore_applied = NULL;",
    "SET @pp_session_mode_restored = NULL;",
    "SET @pp_step = NULL;",
    "",
  );

  // Every executable statement is deliberately one physical line. This keeps
  // the artifact compatible with phpMyAdmin's normal single-statement import
  // path and makes the integration harness exercise the same boundary.
  return `${lines
    .map((line) =>
      line.startsWith("--") || line === ""
        ? line
        : `${line.replaceAll(/\s*\r?\n\s*/gu, " ").trim()}`,
    )
    .join("\n")}\n`;
}

async function writeAtomic(path, content) {
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, content);
    await rm(path, { force: true });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function displayPath(projectRoot, absolutePath) {
  return relative(projectRoot, absolutePath).split(sep).join("/");
}

export async function buildPhpMyAdminMigrationBundle({
  projectRoot = defaultProjectRoot,
  outputDirectory = join(projectRoot, "dist"),
  targetDatabaseSha256,
  serverVersionSha256,
}) {
  validateTargetDatabaseSha256(targetDatabaseSha256);
  validateServerVersionSha256(serverVersionSha256);
  const migrationsFolder = join(projectRoot, "drizzle");
  const expectedBefore = await readExpectedMigrations(migrationsFolder);
  const migrations = [];

  for (const expected of expectedBefore) {
    const sql = await readFile(
      join(migrationsFolder, expected.sqlFileName),
      "utf8",
    );
    const statements = splitMigrationSql(sql).map((statement) => ({
      analysis: analyzeMigrationStatement(statement, expected.sqlFileName.replace(/\.sql$/u, "")),
      hash: sha256(statement),
      sql: statement,
    }));
    migrations.push({ ...expected, statements });
  }

  const expectedAfter = await readExpectedMigrations(migrationsFolder);
  assertExpectedMigrationsUnchanged(expectedBefore, expectedAfter);

  const schema = expectedSchema(migrations);
  const bundleIdentity = {
    formatVersion: FORMAT_VERSION,
    minimumMariaDb: `${MINIMUM_MARIADB_MAJOR}.${MINIMUM_MARIADB_MINOR}`,
    sessionPolicy: {
      characterSet: MYSQL_SESSION_CHARACTER_SET,
      collation: MYSQL_SESSION_COLLATION,
      modifiesGlobalSqlMode: false,
      restoresOriginalSqlMode: true,
      sqlMode: MYSQL_SESSION_SQL_MODE,
      storageEngine: MYSQL_SESSION_STORAGE_ENGINE,
      timeZone: MYSQL_SESSION_TIME_ZONE,
    },
    migrations: migrations.map((migration) => ({
      createdAt: migration.createdAt,
      hash: migration.hash,
      sqlFileName: migration.sqlFileName,
      statementHashes: migration.statements.map((statement) => statement.hash),
    })),
    schema,
    targetDatabaseSha256,
    serverVersionSha256,
  };
  const bundleId = sha256(`${JSON.stringify(bundleIdentity)}\n`);
  const sql = buildSql({
    bundleId,
    migrations,
    schema,
    targetDatabaseSha256,
    serverVersionSha256,
  });
  const sqlSha256 = sha256(sql);
  const manifest = {
    ...bundleIdentity,
    boundary:
      "Clean-only phpMyAdmin bootstrap. A partial DDL failure requires deleting and recreating the disposable target; this is not a rollback or backup artifact.",
    bundleId,
    sqlArtifact: "portal-pusula-phpmyadmin-migration.sql",
    sqlBytes: Buffer.byteLength(sql),
    sqlSha256,
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  const sqlPath = join(
    outputDirectory,
    "portal-pusula-phpmyadmin-migration.sql",
  );
  const manifestPath = join(
    outputDirectory,
    "portal-pusula-phpmyadmin-migration.manifest.json",
  );
  await writeAtomic(sqlPath, sql);
  await writeAtomic(manifestPath, manifestJson);

  return {
    bundleId,
    manifestPath: displayPath(projectRoot, manifestPath),
    migrationCount: migrations.length,
    sqlBytes: Buffer.byteLength(sql),
    sqlPath: displayPath(projectRoot, sqlPath),
    sqlSha256,
    statementCount: migrations.reduce(
      (count, migration) => count + migration.statements.length,
      0,
    ),
    targetDatabaseSha256,
    serverVersionSha256,
  };
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const summary = await buildPhpMyAdminMigrationBundle({
      targetDatabaseSha256: process.env.PHPMYADMIN_TARGET_DB_SHA256,
      serverVersionSha256: process.env.PHPMYADMIN_SERVER_VERSION_SHA256,
    });
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.error(
      error instanceof PhpMyAdminBundleError
        ? error.message
        : "phpMyAdmin migration bundle generation failed.",
    );
    process.exitCode = 1;
  }
}
