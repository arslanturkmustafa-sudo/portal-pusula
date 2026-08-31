export type SafeError = {
  errorCode: "UNEXPECTED_ERROR";
  errorType: string;
};

export function toSafeError(error: unknown): SafeError {
  return {
    errorCode: "UNEXPECTED_ERROR",
    errorType: error instanceof Error ? error.name : "UnknownError",
  };
}

