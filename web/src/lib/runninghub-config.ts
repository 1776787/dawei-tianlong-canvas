/** RunningHub's OpenAPI host. Workflow webpage URLs are not API endpoints. */
export const RUNNINGHUB_BASE_URL = "https://www.runninghub.cn";

/**
 * Keep the legacy configurable field backwards-compatible while ensuring every
 * request uses the official RunningHub OpenAPI host.
 */
export function normalizeRunningHubBaseUrl(_value?: string): string {
    return RUNNINGHUB_BASE_URL;
}
