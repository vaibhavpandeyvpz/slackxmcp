# slackxmcp

`slackxmcp` is an open-source Slack stdio MCP server built on top of the official [`@slack/bolt`](https://www.npmjs.com/package/@slack/bolt), [`@slack/web-api`](https://www.npmjs.com/package/@slack/web-api), `commander`, and `@modelcontextprotocol/sdk`.

It lets MCP-compatible clients interact with Slack through Web API tools and optionally subscribe to inbound Slack messages through a Socket Mode powered MCP notification channel.

## Highlights

- Exposes Slack as an MCP server over stdio.
- Uses Slack Bolt Socket Mode for inbound event delivery.
- Uses the official Slack Web API client for reads and writes.
- Supports interactive configuration via `slackxmcp configure`.
- Provides tools for identity, status, conversation lookups, history, thread replies, and common message mutations.
- Can emit incoming Slack message events over an optional MCP notification channel.

## Requirements

- Node.js `24+`
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

If you want to use `slack_search_messages`, you will typically also need a user token with `search:read` because Slack does not expose message search through bot tokens.

## Installation

Use it without installing globally:

```bash
npx slackxmcp mcp
```

Or for local development:

```bash
npm install
npm run build
npm run dev -- mcp
```

## Quick Start

1. Run the interactive configuration:

```bash
slackxmcp configure
```

This writes:

```text
.slackxmcp/config.json
```

If `./.slackxmcp` exists in the current working directory, that path is used. Otherwise, `~/.slackxmcp/config.json` is used.

2. Start the MCP server:

```bash
npx slackxmcp mcp
```

3. If your MCP host supports notifications and you want inbound Slack events, enable channels:

```bash
npx slackxmcp mcp --channels
```

The server uses stdio, so it is meant to be launched by an MCP client or wrapper rather than browsed directly in a terminal.

## CLI Usage

### MCP Server

```bash
npx slackxmcp mcp
```

Starts the stdio MCP server for the configured Slack app.

### Configure

```bash
npx slackxmcp configure
```

Then opens an interactive configure UI (Ink) to manage:

- `App token`
- `Bot token`
- `User token`
- `Allowed users`
- `Allowed channels`

Allowlist items are toggled from menu screens (select an entry to toggle it, then choose `Back`).

Everything is persisted to:

```text
.slackxmcp/config.json
```

If `./.slackxmcp` exists in the current working directory, that path is used. Otherwise, `~/.slackxmcp/config.json` is used.

## MCP Tools

The server currently exposes these tools:

- `slack_get_me`
- `slack_get_status`
- `slack_get_channel`
- `slack_get_channel_members`
- `slack_list_channels`
- `slack_list_users`
- `slack_search_messages`
- `slack_get_channel_history`
- `slack_get_thread_replies`
- `slack_send_message`
- `slack_send_files`
- `slack_reply_to_message`
- `slack_react_to_message`
- `slack_edit_message`
- `slack_delete_message`

## Push Channel

When started with `--channels`, the server:

- advertises the experimental MCP capability `hooman/channel`
- advertises `hooman/user` with path `meta.user`
- advertises `hooman/session` with path `meta.session`
- advertises `hooman/thread` with path `meta.thread`
- advertises `hooman/channel/permission` for remote daemon approvals
- emits `notifications/hooman/channel` for inbound Slack message events

If allowlist entries are configured, `notifications/hooman/channel` events are emitted only when either:

- `meta.session` (conversation ID) is in `allowlist.channels`, or
- `meta.user` (sender user ID) is in `allowlist.users`

When no allowlist is configured (or both arrays are empty), all inbound channel events are emitted.

Each notification includes:

- `content`: a JSON-encoded event payload
- `meta.source`: always `slack`
- `meta.user`: the Slack sender ID when available
- `meta.session`: the Slack conversation ID
- `meta.thread`: the Slack thread timestamp, or the message timestamp for non-threaded messages

The JSON-decoded `content` payload includes:

- `source`
- `self`
- `message`
- `text`

Inbound notification messages ignore Slack bot/system message subtypes.

When Hooman sends `notifications/hooman/channel/permission_request`, `slackxmcp` posts the request back into the originating Slack conversation/thread with **Block Kit action buttons** derived from `params.options` (defaults: allow once, always allow, deny). Tapping a button is relayed back over `notifications/hooman/channel/permission`. There is no text-command approval path; the Slack app must have **Interactivity** enabled so Bolt can receive `block_actions` over Socket Mode.

## License

See [LICENSE](LICENSE) file.
