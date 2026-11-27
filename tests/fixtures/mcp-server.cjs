const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === "initialize")
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "grimoire-fixture", version: "1.0.0" },
    };
  else if (request.method === "tools/list")
    result = {
      tools: [
        {
          name: "read_echo",
          description: "Read fixture data",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
        {
          name: "write_echo",
          description: "Write fixture data",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
      ],
    };
  else if (request.method === "tools/call") {
    if (process.env.FIXTURE_LOG)
      appendFileSync(
        process.env.FIXTURE_LOG,
        JSON.stringify(request.params) + "\n",
      );
    result = {
      content: [
        { type: "text", text: `fixture:${request.params.arguments.text}` },
      ],
      isError: false,
    };
  } else if (request.method === "resources/list")
    result = {
      resources: [
        {
          uri: "fixture://readme",
          name: "Fixture readme",
          mimeType: "text/plain",
        },
      ],
    };
  else if (request.method === "resources/templates/list")
    result = { resourceTemplates: [] };
  else if (request.method === "resources/read")
    result = {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: "Fixture resource content",
        },
      ],
    };
  else {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "Unsupported fixture method" },
      }) + "\n",
    );
    return;
  }
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
  );
});
