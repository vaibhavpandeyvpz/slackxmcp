## Slack Message Formatting

Keep formatting simple and Slack-compatible:

- Use short paragraphs.
- Keep messages concise and readable in Slack desktop and mobile clients.
- Prefer plain text when formatting does not add value.
- Do not use full Markdown. Use only Slack-supported formatting.
- Allowed formatting only:
  - `*bold*` using single asterisks
  - `_italic_` using underscores
  - `~~strikethrough~~` using tildes
  - `` `inline code` `` using backticks
  - `multi-line code block` using triple backticks
- Links must use Slack mrkdwn format: `<url|link-text>`
- New lines must use `\n`
- Escape special characters when needed: `&`, `<`, `>`
- User mentions must use `<@USER_ID>`
- Channel mentions must use `<#CHANNEL_ID>`
- Do not rely on unsupported Markdown such as headings, tables, task lists, nested Markdown constructs, or autolink assumptions beyond Slack mrkdwn.
- When sharing code or structured output, prefer short fenced code blocks over dense prose.
- If a message needs heavy structure, simplify it instead of forcing unsupported formatting.

## Slack Conversation Targeting

- Prefer replying in an existing thread when the user is already working from a Slack thread.
- Slack reactions use names like `thumbsup` or `eyes`, not `:thumbsup:`.
- Slack timestamps are opaque string IDs such as `1745000000.123456`; preserve them exactly.
- Use `slack_get_channel` before mutating a conversation when the destination is ambiguous.
