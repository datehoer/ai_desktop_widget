import http from "node:http";
import os from "node:os";
import { AppServerClient } from "./app-server-client.js";
import { StatusService } from "./status-service.js";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const refreshMs = Number(process.env.REFRESH_MS || 5_000);

const client = new AppServerClient();
const statusService = new StatusService(client);

client.on("stderr", (chunk) => {
  if (process.env.DEBUG_CODEX_BRIDGE) process.stderr.write(chunk);
});
client.on("protocolError", (error) => console.error(error.message));

function json(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(payload);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/healthz") {
    return json(response, 200, { ok: true, codexConnected: client.ready });
  }

  if (url.pathname === "/api/status") {
    // The ESP32 has a deliberately short HTTP timeout. Serve the latest snapshot
    // immediately and refresh Codex state in the background so a slow app-server
    // response cannot make the display lose its data.
    const status = statusService.snapshot();
    void statusService.refresh();
    // Cached data remains useful during a transient Codex/backend failure. Return it with
    // ok=false/stale=true so the display can preserve values and mark them as stale.
    return json(response, status.ok || status.updatedAt ? 200 : 503, status);
  }

  return json(response, 404, {
    error: "Not found",
    endpoint: "/api/status",
  });
});

server.listen(port, host, async () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry?.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${port}/api/status`);
  console.log(`Codex Usage Bridge listening on http://${host}:${port}`);
  for (const address of addresses) console.log(`ESP32 URL: ${address}`);
  await statusService.refresh();
});

const interval = setInterval(() => statusService.refresh(), refreshMs);
interval.unref();

function shutdown() {
  clearInterval(interval);
  client.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
