# slackmcp

`slackmcp` is an open-source Slack stdio MCP server built on top of the official [`@slack/bolt`](https://www.npmjs.com/package/@slack/bolt), [`@slack/web-api`](https://www.npmjs.com/package/@slack/web-api), `commander`, and `@modelcontextprotocol/sdk`.

It lets MCP-compatible clients interact with Slack through Web API tools and optionally subscribe to inbound Slack messages through a Socket Mode powered MCP notification channel.

## Highlights

- Exposes Slack as an MCP server over stdio.
- Uses Slack Bolt Socket Mode for inbound event delivery.
- Uses the official Slack Web API client for reads and writes.
- Connects using either `SLACK_BOT_TOKEN` or `SLACK_USER_TOKEN`, plus `SLACK_APP_TOKEN`.
- Provides tools for identity, status, conversation lookups, history, thread replies, and common message mutations.
- Can emit incoming Slack message events over an optional MCP notification channel.

## Requirements

- Node.js `24+`
- A Slack bot token exported as `SLACK_BOT_TOKEN`, or a Slack user token exported as `SLACK_USER_TOKEN`
- A Slack app-level Socket Mode token exported as `SLACK_APP_TOKEN`
- A Slack app with Socket Mode enabled

## Slack App Setup

At minimum, configure:

- Socket Mode enabled with an app token that has `connections:write`
- Token scopes for whichever Slack token you use:
  - `channels:read`
  - `groups:read`
  - `im:read`
  - `mpim:read`
  - `channels:history`
  - `groups:history`
  - `im:history`
  - `mpim:history`
  - `chat:write`
  - `reactions:write`
  - `users:read`
- Event subscriptions for the message surfaces you care about, such as:
  - `message.channels`
  - `message.groups`
  - `message.im`
  - `message.mpim`

Depending on your workspace policy and the conversations you target, Slack may require additional scopes.

## Installation

Use it without installing globally:

```bash
npx slackmcp mcp
```

Or for local development:

```bash
npm install
npm run build
npm run dev -- mcp
```

## Quick Start

1. Export your Slack credentials:

```bash
export SLACK_BOT_TOKEN="xoxb-your-bot-token"
export SLACK_APP_TOKEN="xapp-your-app-token"
```

If you prefer a user token instead:

```bash
export SLACK_USER_TOKEN="xoxp-your-user-token"
export SLACK_APP_TOKEN="xapp-your-app-token"
```

2. Start the MCP server:

```bash
npx slackmcp mcp
```

3. If your MCP host supports notifications and you want inbound Slack events, provide a channel name:

```bash
npx slackmcp mcp --channel claude/channel
```

The server uses stdio, so it is meant to be launched by an MCP client or wrapper rather than browsed directly in a terminal.

## CLI Usage

### MCP Server

```bash
npx slackmcp mcp
```

Starts the stdio MCP server for the configured Slack app.

## MCP Tools

The server currently exposes these tools:

- `slack_get_me`
- `slack_get_status`
- `slack_get_channel`
- `slack_get_channel_members`
- `slack_lookup_channel`
- `slack_get_channel_history`
- `slack_get_thread_replies`
- `slack_send_message`
- `slack_send_files`
- `slack_reply_to_message`
- `slack_react_to_message`
- `slack_edit_message`
- `slack_delete_message`

## Push Channel

When started with `--channel <name>`, the server:

- advertises the experimental MCP capability `<name>`
- advertises `identity/user` with path `meta.user`
- advertises `identity/session` with path `meta.session`
- emits `notifications/<name>` for inbound Slack message events

Each notification includes:

- `content`: a JSON-encoded event payload
- `meta.source`: always `slack`
- `meta.user`: the Slack sender ID when available
- `meta.session`: the Slack conversation ID

The JSON-decoded `content` payload includes:

- `source`
- `self`
- `message`
- `text`

Inbound notification messages ignore Slack bot/system message subtypes.

## Notes

- Slack message mutation tools target explicit `channelId` and `timestamp` values.
- `slack_send_files` uses Slack's upload flow and accepts either a single `path` or `content`, or a `files` array for uploading multiple files in one call.
- `slack_reply_to_message` expects a parent `threadTs`.
- `slack_lookup_channel` resolves exact names and IDs; if you need history after a lookup, pass the resolved ID to the history tools.
- The CLI intentionally exposes only `slackmcp mcp`.
