#!/usr/bin/env node

/**
 * WhatsApp MCP Server
 * Exposes two tools via the Model Context Protocol (stdio transport):
 *  1. send_whatsapp_message  – Send a message to a WhatsApp user via Meta Cloud API
 *  2. get_message_status     – Retrieve the delivery/read status of a sent message
 *
 * Also runs a small HTTP server to receive webhook status updates from Meta.
 * Status is persisted to a local JSON file (message_status.json) so both the
 * webhook and MCP tool share state across calls.
 *
 * Usage:
 *   node server.js
 * (Environment variables are loaded from .env file automatically)
 */

require('dotenv').config();

const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");

// ─── Config ──────────────────────────────────────────────────────────────────
const WHATSAPP_TOKEN       = process.env.WHATSAPP_TOKEN              || "YOUR_ACCESS_TOKEN";
const PHONE_NUMBER_ID      = process.env.WHATSAPP_PHONE_NUMBER_ID    || "YOUR_PHONE_NUMBER_ID";
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION         || "v19.0";
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN         || "YOUR_VERIFY_TOKEN";
const WEBHOOK_PORT         = process.env.WEBHOOK_PORT                 || 3000;
const STATUS_FILE          = process.env.STATUS_FILE                  || path.join(__dirname, "message_status.json");

const BASE_URL = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}`;

// ─── File-based Status Store ──────────────────────────────────────────────────
// Reads and writes to message_status.json so webhook + MCP tool share state.

function readStore() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
    }
  } catch (e) {
    process.stderr.write(`[Store] Failed to read status file: ${e.message}\n`);
  }
  return {};
}

function writeStore(store) {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (e) {
    process.stderr.write(`[Store] Failed to write status file: ${e.message}\n`);
  }
}

function setStatus(msgId, status, timestamp) {
  const store = readStore();
  store[msgId] = {
    status,
    timestamp,
    updated_at: new Date().toISOString(),
  };
  writeStore(store);
  process.stderr.write(`[Store] Saved → ${msgId}: ${status}\n`);
}

function getStatus(msgId) {
  const store = readStore();
  return store[msgId] || null;
}

// ─── Tiny HTTPS helper ────────────────────────────────────────────────────────
function request(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Webhook HTTP Server ──────────────────────────────────────────────────────
const webhookServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${WEBHOOK_PORT}`);

  // ── GET: Webhook verification handshake from Meta ──
  if (req.method === "GET" && url.pathname === "/webhook") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
      process.stderr.write("[Webhook] Verified by Meta.\n");
      res.writeHead(200);
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end("Forbidden");
    }
    return;
  }

  // ── POST: Incoming status update from Meta ──
  if (req.method === "POST" && url.pathname === "/webhook") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const entries = payload?.entry || [];
        for (const entry of entries) {
          const changes = entry?.changes || [];
          for (const change of changes) {
            const statuses = change?.value?.statuses || [];
            for (const s of statuses) {
              if (s.id && s.status) {
                // Always override with latest status (sent → delivered → read)
                setStatus(s.id, s.status, s.timestamp);
              }
            }
          }
        }
      } catch (e) {
        process.stderr.write(`[Webhook] Failed to parse payload: ${e.message}\n`);
      }
      res.writeHead(200);
      res.end("OK");
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

function startWebhookServer(port) {
  webhookServer.listen(port, () => {
    process.stderr.write(`[Webhook] HTTP server listening on port ${port}\n`);
  });
  webhookServer.once("error", (err) => {
    if (err.code === "EADDRINUSE") {
      process.stderr.write(`[Webhook] Port ${port} already in use. Trying port ${port + 1}...\n`);
      webhookServer.close();
      startWebhookServer(port + 1);
    } else {
      process.stderr.write(`[Webhook] Server error: ${err.message}\n`);
    }
  });
}

startWebhookServer(Number(WEBHOOK_PORT));

// ─── Tool implementations ─────────────────────────────────────────────────────

async function sendWhatsAppMessage({ to, message_type = "text", text, template_name, template_language, template_components }) {
  let payload;

  if (message_type === "text") {
    if (!text) throw new Error("'text' is required when message_type is 'text'");
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/\D/g, ""),
      type: "text",
      text: { preview_url: false, body: text },
    };
  } else if (message_type === "template") {
    if (!template_name) throw new Error("'template_name' is required when message_type is 'template'");
    payload = {
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""),
      type: "template",
      template: {
        name: template_name,
        language: { code: template_language || "en_US" },
        components: template_components || [],
      },
    };
  } else {
    throw new Error(`Unsupported message_type '${message_type}'. Use 'text' or 'template'.`);
  }

  const res = await request("POST", `${BASE_URL}/messages`, payload);

  if (res.status >= 400) {
    const errMsg = res.body?.error?.message || JSON.stringify(res.body);
    throw new Error(`WhatsApp API error (${res.status}): ${errMsg}`);
  }

  const msgId = res.body?.messages?.[0]?.id;

  // Seed the file store with initial "sent" status
  if (msgId) {
    setStatus(msgId, "sent", Math.floor(Date.now() / 1000).toString());
  }

  return {
    success: true,
    message_id: msgId,
    recipient: to,
    status: "sent",
    raw: res.body,
  };
}

async function getMessageStatus({ message_id }) {
  // Reads from message_status.json — updated by webhook in real time
  const entry = getStatus(message_id);

  if (!entry) {
    return {
      success: false,
      message_id,
      error: "No status found for this message ID. Either it was not sent in this session, or no webhook update has been received yet.",
    };
  }

  return {
    success: true,
    message_id,
    status: entry.status,         // sent | delivered | read | failed
    timestamp: entry.timestamp,
    updated_at: entry.updated_at,
  };
}

// ─── MCP Protocol (stdio) ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "send_whatsapp_message",
    description:
      "Send a WhatsApp message to a user via the Meta (Facebook) WhatsApp Cloud API. " +
      "Supports plain text messages and pre-approved template messages. " +
      "Returns a message_id that can be used with get_message_status to track delivery.",
    inputSchema: {
      type: "object",
      required: ["to", "message_type"],
      properties: {
        to: {
          type: "string",
          description:
            "Recipient phone number in E.164 format (e.g. +14155238886 or 14155238886). " +
            "Country code must be included. Non-digit characters are stripped automatically.",
        },
        message_type: {
          type: "string",
          enum: ["text", "template"],
          description:
            "Type of message to send. Use 'text' for a plain text message, " +
            "or 'template' to send a pre-approved WhatsApp Business template.",
        },
        text: {
          type: "string",
          description:
            "The body of the text message. Required when message_type is 'text'. " +
            "Supports WhatsApp formatting: *bold*, _italic_, ~strikethrough~, ```mono```.",
        },
        template_name: {
          type: "string",
          description:
            "Name of the approved WhatsApp Business template to send. " +
            "Required when message_type is 'template'.",
        },
        template_language: {
          type: "string",
          description:
            "BCP-47 language code for the template (e.g. 'en_US', 'es_ES'). " +
            "Defaults to 'en_US'.",
        },
        template_components: {
          type: "array",
          description:
            "Array of template component objects (header, body, buttons) " +
            "with variable substitutions. See Meta docs for schema.",
          items: { type: "object" },
        },
      },
    },
  },
  {
    name: "get_message_status",
    description:
      "Get the delivery status of a WhatsApp message previously sent via send_whatsapp_message. " +
      "Possible statuses: 'sent' (delivered to Meta), 'delivered' (delivered to device), " +
      "'read' (opened by recipient), 'failed' (delivery failure). " +
      "Status is updated in real-time via Meta webhook and persisted to message_status.json.",
    inputSchema: {
      type: "object",
      required: ["message_id"],
      properties: {
        message_id: {
          type: "string",
          description:
            "The WhatsApp message ID returned by send_whatsapp_message " +
            "(e.g. 'wamid.HBgNMTQxNTUyMzg4ODYVAgASGBQ2MkIxQ...').",
        },
      },
    },
  },
];

function sendResponse(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handleRequest(req) {
  const { jsonrpc, id, method, params } = req;

  if (method === "initialize") {
    return {
      jsonrpc, id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "whatsapp-mcp", version: "1.0.0" },
      },
    };
  }

  if (method === "tools/list") {
    return { jsonrpc, id, result: { tools: TOOLS } };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    try {
      let result;
      if (name === "send_whatsapp_message") {
        result = await sendWhatsAppMessage(args);
      } else if (name === "get_message_status") {
        result = await getMessageStatus(args);
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
      return {
        jsonrpc, id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      };
    } catch (err) {
      return {
        jsonrpc, id,
        result: {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        },
      };
    }
  }

  if (method === "notifications/initialized") {
    return null;
  }

  return {
    jsonrpc, id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

// ─── stdin reader ─────────────────────────────────────────────────────────────
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const req = JSON.parse(trimmed);
      const res = await handleRequest(req);
      if (res) sendResponse(res);
    } catch (e) {
      sendResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error", data: e.message },
      });
    }
  }
});

process.stdin.on("end", () => process.exit(0));
process.stderr.write("[WhatsApp MCP Server] Ready. Listening on stdio...\n");