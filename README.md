# WhatsApp MCP Server

A **Model Context Protocol (MCP)** server that exposes two WhatsApp tools to Claude (or any MCP-compatible AI client) — powered by the **Meta WhatsApp Cloud API**.

---

## 🛠 Tools Exposed

### 1. `send_whatsapp_message`
Send a WhatsApp message to any user.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | ✅ | Recipient phone in E.164 format (e.g. `+14155238886`) |
| `message_type` | `"text"` \| `"template"` | ✅ | Type of message |
| `text` | string | ✅ (if text) | Body of the text message. Supports WhatsApp formatting |
| `template_name` | string | ✅ (if template) | Name of a pre-approved template |
| `template_language` | string | ❌ | BCP-47 code, default `en_US` |
| `template_components` | array | ❌ | Variable substitutions for the template |

**Returns:** `{ success, message_id, recipient, status, raw }`

---

### 2. `get_message_status`
Retrieve the delivery/read status of a sent message.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message_id` | string | ✅ | The `message_id` returned by `send_whatsapp_message` |

**Possible statuses:** `sent` → `delivered` → `read` | `failed`

**Returns:** `{ success, message_id, status, timestamp, raw }`

> **Note:** Meta pushes real-time status updates via webhook. This tool queries the Graph API for the latest known status at call time. For live status tracking, set up a webhook endpoint.

---

## 🚀 Setup

### Step 1 — Prerequisites

- **Node.js** 16+ installed
- A **Meta Developer Account** with a WhatsApp Business App

### Step 2 — Get your Meta credentials

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create a new App → choose **Business** type
3. Add the **WhatsApp** product
4. Under **WhatsApp → API Setup**, note your:
   - **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **Temporary / Permanent Access Token** → `WHATSAPP_TOKEN`
5. Add a test phone number to send to (Meta sandbox limits who you can message)

### Step 3 — Configure environment

```bash
cp .env.example .env
# Edit .env and fill in your token and phone number ID
```

### Step 4 — Connect to Claude Desktop

1. Open your Claude Desktop config file:
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

2. Merge the contents of `claude_desktop_config.json` (from this repo) into it, updating the absolute path and credentials:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["/absolute/path/to/whatsapp-mcp/server.js"],
      "env": {
        "WHATSAPP_TOKEN": "your_token",
        "WHATSAPP_PHONE_NUMBER_ID": "your_phone_number_id"
      }
    }
  }
}
```

3. **Restart Claude Desktop** — you'll see a 🔧 tools indicator confirming the server connected.

### Step 5 — Test it

In Claude Desktop, try:

> "Send a WhatsApp message to +14155238886 saying 'Hello from Claude!'"

Claude will call `send_whatsapp_message` and return a `message_id`.

Then:

> "What's the status of message wamid.ABC123...?"

Claude will call `get_message_status`.

---

## 🧪 Manual Testing (without Claude)

Run the server and pipe JSON-RPC requests to it:

```bash
# Set env vars
export WHATSAPP_TOKEN=your_token
export WHATSAPP_PHONE_NUMBER_ID=your_id

# Start server
node server.js

# In another terminal, send a test request:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node server.js
```

---

## 📁 Project Structure

```
whatsapp-mcp/
├── server.js                 # MCP server (zero external dependencies)
├── .env.example              # Environment variable template
├── claude_desktop_config.json # Paste into Claude Desktop config
└── README.md                 # This file
```

---

## 🔗 Meta API Reference

- [WhatsApp Cloud API – Send Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)
- [Message Status & Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components)
- [Template Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates)

---

## ⚠️ Important Notes

- **Sandbox limits:** In test mode, you can only message numbers added to the approved test list in your Meta dashboard.
- **Production:** For production use, get a permanent **System User Token** from Meta Business Manager.
- **Webhooks for status:** Real-time status updates require you to set up a webhook URL in your Meta App settings.
