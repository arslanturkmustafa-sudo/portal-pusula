export type ArchiveMetadata = Readonly<{
  archiveReason: string | null;
  archivedAtUtc: string | null;
  archivedByUserAccountId: string | null;
  version: number;
}>;

type ArchiveMetadataRow = Readonly<{
  archive_reason: string | null;
  archived_at_utc: string | Date | null;
  archived_by_user_account_id: string | null;
  version: number;
}>;

function canonicalDateTime(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().replace("T", " ").replace("Z", "000");
  }
  return value;
}

export function mapArchiveMetadata(row: ArchiveMetadataRow): ArchiveMetadata {
  if (!Number.isSafeInteger(row.version) || row.version < 1) {
    throw new Error("Record version is invalid.");
  }

  const archivedValues = [
    row.archive_reason,
    row.archived_at_utc,
    row.archived_by_user_account_id,
  ];
  if (archivedValues.every((value) => value === null)) {
    return {
      archiveReason: null,
      archivedAtUtc: null,
      archivedByUserAccountId: null,
      version: row.version,
    };
  }
  if (archivedValues.some((value) => value === null)) {
    throw new Error("Record archive metadata is incomplete.");
  }

  const reason = row.archive_reason as string;
  if (reason.trim() !== reason || reason.length < 1 || reason.length > 500) {
    throw new Error("Record archive reason is invalid.");
  }

  return {
    archiveReason: reason,
    archivedAtUtc: canonicalDateTime(row.archived_at_utc as string | Date),
    archivedByUserAccountId: row.archived_by_user_account_id as string,
    version: row.version,
  };
}

export function isArchived(record: ArchiveMetadata): boolean {
  return record.archivedAtUtc !== null;
}
