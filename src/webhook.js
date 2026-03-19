import http from "node:http";
import dotenv from "dotenv";
import { playRandomEpisode } from "./playback.js";

dotenv.config({ quiet: true });

const host = process.env.PLEX_WEBHOOK_HOST || "0.0.0.0";
const port = Number(process.env.PLEX_WEBHOOK_PORT || 8787);
const webhookToken = (process.env.PLEX_WEBHOOK_TOKEN || "").trim();

let inFlight = false;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function isAuthorized(req, url) {
  if (!webhookToken) return true;
  const bearer = getBearerToken(req);
  const headerToken = String(req.headers["x-webhook-token"] || "").trim();
  const queryToken = String(url.searchParams.get("token") || "").trim();
  return bearer === webhookToken || headerToken === webhookToken || queryToken === webhookToken;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const method = (req.method || "GET").toUpperCase();

  if (method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "plex-collection-shuffler",
      inFlight,
    });
    return;
  }

  if (method === "POST" && url.pathname === "/play") {
    if (!isAuthorized(req, url)) {
      sendJson(res, 401, {
        ok: false,
        error: "Unauthorized",
      });
      return;
    }

    if (inFlight) {
      sendJson(res, 409, {
        ok: false,
        error: "A playback request is already running",
      });
      return;
    }

    inFlight = true;
    try {
      const result = await playRandomEpisode({ logger: console });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
      });
    } finally {
      inFlight = false;
    }
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: "Not found",
  });
});

server.listen(port, host, () => {
  const authMode = webhookToken ? "token required" : "no token";
  console.log("Webhook listening on http://" + host + ":" + port + " (" + authMode + ")");
});
