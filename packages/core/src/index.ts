export * from "./framework-detector";
export * from "./orchestrator";
export { resolveMaxAttempts, resolvePatience, resolveTimeoutMs, DEFAULT_MAX_ATTEMPTS, DEFAULT_PATIENCE } from "./options";
export { detectPackageManager, type PackageManager } from "@opspilot/analyzers";