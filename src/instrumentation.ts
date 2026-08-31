export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ getServerEnvironment }, { appLogger }] = await Promise.all([
      import("@/platform/config/server-env"),
      import("@/platform/logging/logger"),
    ]);
    getServerEnvironment();

    appLogger.info(
      {
        event: "runtime.started",
        runtime: {
          name: "nodejs",
          version: process.version,
        },
      },
      "Portal Pusula runtime started",
    );
  }
}
