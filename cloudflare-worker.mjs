import handler from "./.open-next/worker.js";
import { normalizeClientAddress, runScheduledSync } from "./lib/cloudflare-scheduled.mjs";

const worker = {
  fetch(request, env, ctx) {
    return handler.fetch(normalizeClientAddress(request), env, ctx);
  },
  async scheduled(event, env, ctx) {
    await runScheduledSync(event, env, (request) => handler.fetch(request, env, ctx));
  },
};

export default worker;
