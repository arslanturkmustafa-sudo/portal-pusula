export class LifecycleArchivedRecordError extends Error {
  constructor() {
    super("Archived records cannot be changed outside the lifecycle command.");
    this.name = "LifecycleArchivedRecordError";
  }
}

export class LifecycleDependencyConflictError extends Error {
  constructor() {
    super("The record has dependencies that prevent this lifecycle command.");
    this.name = "LifecycleDependencyConflictError";
  }
}

export class LifecycleParentUnavailableError extends Error {
  constructor() {
    super("A required parent record is unavailable.");
    this.name = "LifecycleParentUnavailableError";
  }
}

export class LifecycleStateConflictError extends Error {
  constructor() {
    super("The record state does not allow this lifecycle command.");
    this.name = "LifecycleStateConflictError";
  }
}
