#!/usr/bin/env node

/**
 * WhatsApp Template Manager — MCP Server (Interactive Menu Flow)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tools:
 *  1. whatsapp_template_menu      – Shows a menu and guides the user to choose an action
 *  2. create_whatsapp_template    – Create a new template (MARKETING / UTILITY / AUTHENTICATION)
 *  3. list_whatsapp_templates     – List all templates with optional filters
 *  4. get_template_details        – Get full details + status of one template
 *  5. delete_whatsapp_template    – Delete a template by name
 *
 * Usage:
 *   WHATSAPP_TOKEN=<token> WHATSAPP_BUSINESS_ACCOUNT_ID=<waba_id> node server.js
 */

const https = require("https");

// ─── Config ───────────────────────────────────────────────────────────────────
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN                || "YOUR_ACCESS_TOKEN";
const WABA_ID        = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID  || "YOUR_WABA_ID";
const API_VERSION    = process.env.WHATSAPP_API_VERSION          || "v19.0";
const GRAPH_BASE     = `https://graph.facebook.com/${API_VERSION}`;

// ─── HTTPS helper ─────────────────────────────────────────────────────────────
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsed.hostname,
      path    : parsed.pathname + parsed.search,
      method,
      headers : {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type" : "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end",  ()  => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function apiError(res) {
  return res.body?.error?.message || JSON.stringify(res.body);
}

// ─── Tool 0: whatsapp_template_menu ──────────────────────────────────────────
function showMenu() {
  return {
    message: "👋 Welcome to the WhatsApp Template Manager! What would you like to do?",
    instructions: "Please present these as clickable numbered choices to the user and wait for their selection before proceeding:",
    choices: [
      { number: 1, action: "create",  label: "✏️  Create a new template",              description: "Build a new MARKETING, UTILITY, or AUTHENTICATION template" },
      { number: 2, action: "list",    label: "📋 List all my templates",               description: "See all templates with their approval status" },
      { number: 3, action: "details", label: "🔍 Get details of a specific template",  description: "View full info, status, and components of one template" },
      { number: 4, action: "delete",  label: "🗑️  Delete a template",                  description: "Permanently remove a template from your account" },
    ],
    next_step: "Once the user picks a number, call the matching tool OR ask the follow-up questions shown below for that action.",
    follow_up_guide: {
      "1_create": [
        "Ask: What should the template be called? (e.g. order_update)",
        "Ask: What category? Present choices: MARKETING | UTILITY | AUTHENTICATION",
        "Ask: What language? (default en_US — ask only if they want a different language)",
        "Ask: Do you want a header? If yes: TEXT, IMAGE, VIDEO, or DOCUMENT?",
        "Ask: What should the body text say? (tip: use {{1}} {{2}} for variables)",
        "Ask: Do you want a footer? (optional)",
        "Ask: Do you want buttons? QUICK_REPLY, URL, or PHONE_NUMBER? (optional)",
        "Then call create_whatsapp_template with the collected answers"
      ],
      "2_list": [
        "Ask: Do you want to filter by status? Present choices: All | APPROVED | PENDING | REJECTED | PAUSED",
        "Ask: Do you want to filter by category? Present choices: All | MARKETING | UTILITY | AUTHENTICATION",
        "Then call list_whatsapp_templates"
      ],
      "3_details": [
        "Ask: What is the name of the template you want to look up?",
        "Then call get_template_details"
      ],
      "4_delete": [
        "Ask: What is the name of the template you want to delete?",
        "Warn the user: ⚠️ This cannot be undone. Confirm they want to proceed.",
        "Then call delete_whatsapp_template"
      ]
    }
  };
}

// ─── Tool 1: create_whatsapp_template ────────────────────────────────────────
async function createTemplate({
  name, category, language = "en_US",
  header_type, header_text,
  body_text, footer_text, buttons = [],
  add_security_recommendation = false,
  code_expiration_minutes,
}) {
  if (!name)     throw new Error("'name' is required");
  if (!category) throw new Error("'category' is required");
  if (!body_text && category.toUpperCase() !== "AUTHENTICATION")
    throw new Error("'body_text' is required for MARKETING and UTILITY templates");

  const cat = category.toUpperCase();
  const components = [];

  if (header_type && header_text) {
    components.push({
      type  : "HEADER",
      format: header_type.toUpperCase(),
      ...(header_type.toUpperCase() === "TEXT" ? { text: header_text } : {}),
    });
  }

  if (cat === "AUTHENTICATION") {
    components.push({ type: "BODY", add_security_recommendation });
    if (code_expiration_minutes)
      components.push({ type: "FOOTER", code_expiration_minutes: Number(code_expiration_minutes) });
    components.push({ type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] });
  } else {
    components.push({ type: "BODY", text: body_text });
    if (footer_text) components.push({ type: "FOOTER", text: footer_text });
    if (buttons.length > 0) components.push({ type: "BUTTONS", buttons });
  }

  const payload = {
    name      : name.toLowerCase().replace(/\s+/g, "_"),
    category  : cat,
    language,
    components,
  };

  const res = await request("POST", `${GRAPH_BASE}/${WABA_ID}/message_templates`, payload);
  if (res.status >= 400) throw new Error(`Meta API error (${res.status}): ${apiError(res)}`);

  return {
    success     : true,
    template_id : res.body?.id,
    name        : payload.name,
    category    : cat,
    language,
    status      : res.body?.status || "PENDING",
    message     : "✅ Template submitted! Meta will review it — approval usually takes a few minutes to 24 hours.",
    next_action : "You can check approval status anytime by choosing option 3 (Get details) from the menu.",
    raw         : res.body,
  };
}

// ─── Tool 2: list_whatsapp_templates ─────────────────────────────────────────
async function listTemplates({ status_filter, category_filter, limit = 20 }) {
  let url = `${GRAPH_BASE}/${WABA_ID}/message_templates?limit=${limit}&fields=id,name,category,language,status,components,rejected_reason,quality_score`;
  if (status_filter)   url += `&status=${status_filter.toUpperCase()}`;
  if (category_filter) url += `&category=${category_filter.toUpperCase()}`;

  const res = await request("GET", url);
  if (res.status >= 400) throw new Error(`Meta API error (${res.status}): ${apiError(res)}`);

  const templates = (res.body?.data || []).map((t) => ({
    id             : t.id,
    name           : t.name,
    category       : t.category,
    language       : t.language,
    status         : t.status,
    rejected_reason: t.rejected_reason || null,
    quality_score  : t.quality_score?.score || null,
  }));

  return {
    success      : true,
    total        : templates.length,
    templates,
    next_action  : "Would you like to get full details of any template? Just tell me the name!",
  };
}

// ─── Tool 3: get_template_details ────────────────────────────────────────────
async function getTemplateDetails({ template_name }) {
  if (!template_name) throw new Error("'template_name' is required");

  const url = `${GRAPH_BASE}/${WABA_ID}/message_templates?name=${encodeURIComponent(template_name)}&fields=id,name,category,language,status,components,rejected_reason,quality_score,last_updated_time`;
  const res = await request("GET", url);
  if (res.status >= 400) throw new Error(`Meta API error (${res.status}): ${apiError(res)}`);

  const templates = res.body?.data || [];
  if (templates.length === 0)
    return { success: false, message: `No template found with name "${template_name}".` };

  return {
    success  : true,
    total    : templates.length,
    templates: templates.map((t) => ({
      id             : t.id,
      name           : t.name,
      category       : t.category,
      language       : t.language,
      status         : t.status,
      rejected_reason: t.rejected_reason || "N/A",
      quality_score  : t.quality_score?.score || "N/A",
      last_updated   : t.last_updated_time || "N/A",
      components     : t.components,
    })),
    next_action: "Would you like to do anything else? Type 'menu' to see options.",
  };
}

// ─── Tool 4: delete_whatsapp_template ────────────────────────────────────────
async function deleteTemplate({ template_name, template_id }) {
  if (!template_name) throw new Error("'template_name' is required");

  let url = `${GRAPH_BASE}/${WABA_ID}/message_templates?name=${encodeURIComponent(template_name)}`;
  if (template_id) url += `&hsm_id=${template_id}`;

  const res = await request("DELETE", url);
  if (res.status >= 400) throw new Error(`Meta API error (${res.status}): ${apiError(res)}`);

  return {
    success      : true,
    deleted      : res.body?.success === true,
    template_name,
    message      : `🗑️ Template "${template_name}" has been deleted.`,
    note         : "APPROVED templates sent in the last 30 days cannot be recovered.",
    next_action  : "Would you like to do anything else? Type 'menu' to go back to the main menu.",
    raw          : res.body,
  };
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "whatsapp_template_menu",
    description:
      "ALWAYS call this tool first when the user wants to manage WhatsApp templates, " +
      "or when they say things like 'manage templates', 'template menu', 'what can I do', or just 'menu'. " +
      "This returns a numbered list of actions. Present them clearly to the user as choices and wait for " +
      "their selection. Then ask the follow-up questions for that specific action before calling other tools. " +
      "Do NOT skip directly to other tools without first letting the user choose from the menu.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_whatsapp_template",
    description:
      "Create a new WhatsApp Business message template. Call this ONLY after the user has " +
      "selected 'Create' from the menu AND you have collected: template name, category " +
      "(MARKETING / UTILITY / AUTHENTICATION), body text, and any optional parts (header, footer, buttons).",
    inputSchema: {
      type    : "object",
      required: ["name", "category"],
      properties: {
        name           : { type: "string", description: "Template name in snake_case (e.g. order_update). Spaces auto-converted." },
        category       : { type: "string", enum: ["MARKETING", "UTILITY", "AUTHENTICATION"], description: "MARKETING for promotions, UTILITY for transactional, AUTHENTICATION for OTP." },
        language       : { type: "string", description: "BCP-47 language code. Default: en_US. Others: ar, es_ES, fr, hi, pt_BR." },
        header_type    : { type: "string", enum: ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"], description: "Optional header type." },
        header_text    : { type: "string", description: "Header text. Required if header_type is TEXT. Supports {{1}}." },
        body_text      : { type: "string", description: "Main message body. Supports variables {{1}}, {{2}}, etc. Required for MARKETING and UTILITY." },
        footer_text    : { type: "string", description: "Optional footer. No variables allowed." },
        buttons        : { type: "array", description: "Optional buttons. QUICK_REPLY: {type:'QUICK_REPLY',text:'Yes'}. URL: {type:'URL',text:'Track',url:'https://...'}. PHONE: {type:'PHONE_NUMBER',text:'Call',phone_number:'+1...'}.", items: { type: "object" } },
        add_security_recommendation: { type: "boolean", description: "AUTHENTICATION only. Adds security disclaimer." },
        code_expiration_minutes    : { type: "number", description: "AUTHENTICATION only. OTP expiry in minutes." },
      },
    },
  },
  {
    name: "list_whatsapp_templates",
    description:
      "List all WhatsApp templates in the Business Account. Call this after the user selects 'List' " +
      "from the menu and optionally chooses a status or category filter.",
    inputSchema: {
      type: "object",
      properties: {
        status_filter  : { type: "string", enum: ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"], description: "Filter by approval status." },
        category_filter: { type: "string", enum: ["MARKETING", "UTILITY", "AUTHENTICATION"], description: "Filter by category." },
        limit          : { type: "number", description: "Max results (default 20, max 100)." },
      },
    },
  },
  {
    name: "get_template_details",
    description:
      "Get full details of a specific WhatsApp template by name. Call this after the user selects " +
      "'Get details' from the menu and provides a template name.",
    inputSchema: {
      type    : "object",
      required: ["template_name"],
      properties: {
        template_name: { type: "string", description: "Exact template name to look up." },
      },
    },
  },
  {
    name: "delete_whatsapp_template",
    description:
      "Permanently delete a WhatsApp template. Call this ONLY after the user selected 'Delete' from " +
      "the menu, provided the template name, AND explicitly confirmed they want to proceed with deletion.",
    inputSchema: {
      type    : "object",
      required: ["template_name"],
      properties: {
        template_name: { type: "string", description: "Name of the template to delete." },
        template_id  : { type: "string", description: "Optional. Target a specific language variant." },
      },
    },
  },
];

// ─── MCP Protocol Handler ─────────────────────────────────────────────────────
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
        capabilities   : { tools: {} },
        serverInfo     : { name: "whatsapp-template-mcp", version: "2.0.0" },
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
      if      (name === "whatsapp_template_menu")    result = showMenu();
      else if (name === "create_whatsapp_template")  result = await createTemplate(args);
      else if (name === "list_whatsapp_templates")   result = await listTemplates(args);
      else if (name === "get_template_details")      result = await getTemplateDetails(args);
      else if (name === "delete_whatsapp_template")  result = await deleteTemplate(args);
      else throw new Error(`Unknown tool: ${name}`);

      return {
        jsonrpc, id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
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

  if (method === "notifications/initialized") return null;

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
        jsonrpc: "2.0", id: null,
        error: { code: -32700, message: "Parse error", data: e.message },
      });
    }
  }
});

process.stdin.on("end", () => process.exit(0));
process.stderr.write("[WhatsApp Template MCP v2] Ready. Listening on stdio...\n");


