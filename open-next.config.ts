import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Authenticated dashboard data is never stored in a shared page cache.
export default defineCloudflareConfig();
