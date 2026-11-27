import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 3001);
serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Grimoire Agent: http://127.0.0.1:${info.port}`);
});
