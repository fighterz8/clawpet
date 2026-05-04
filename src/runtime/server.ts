import { serve } from "@hono/node-server";
import { createRuntimeApp } from "./app";

const port = Number(process.env.CLAWPET_RUNTIME_PORT ?? 8737);
const hostname = process.env.CLAWPET_RUNTIME_HOST ?? "127.0.0.1";

serve({
  fetch: createRuntimeApp().fetch,
  port,
  hostname,
});

console.log(`Clawpet runtime listening on http://${hostname}:${port}`);
