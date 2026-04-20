import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { packageMetadata } from "../package-metadata.js";
import { SlackChannel } from "../slack/channel.js";
import type { SlackSession } from "../slack/session.js";
import { createJsonResult } from "./helpers.js";

function instructions(channel = false): string {
  const files = ["formatting.md", channel ? "channel.md" : null].filter(
    Boolean,
  );
  const root = dirname(fileURLToPath(import.meta.url));
  const sections = files.map((file) =>
    readFileSync(resolve(root, `../../prompts/${file}`), "utf8").trim(),
  );
  return `${sections.join("\n\n").trim()}\n`;
}

export class SlackMcpServer {
  readonly mcp: McpServer;

  private constructor(
    private readonly session: SlackSession,
    private readonly channel?: string,
  ) {
    this.mcp = new McpServer(
      {
        name: packageMetadata.name,
        version: packageMetadata.version,
      },
      {
        capabilities: {
          experimental: channel
            ? {
                "identity/user": { path: "meta.user" },
                "identity/session": { path: "meta.session" },
                [channel]: {},
              }
            : undefined,
        },
        instructions: instructions(Boolean(channel)),
      },
    );
  }

  static create(session: SlackSession, channel?: string): SlackMcpServer {
    const server = new SlackMcpServer(session, channel);
    server.registerTools();
    return server;
  }

  async start(transport: Transport): Promise<void> {
    await this.mcp.connect(transport);
  }

  async subscribe(): Promise<void> {
    if (!this.channel) {
      throw new Error("Channel not specified");
    }

    const channel = new SlackChannel(
      this.session,
      this.mcp.server,
      this.channel,
    );
    await channel.start();
  }

  private registerTools(): void {
    this.mcp.registerTool(
      "slack_get_me",
      {
        title: "Get connected Slack identity",
        description:
          "Return the current identity details for the connected Slack bot or user session.",
      },
      async () => createJsonResult(await this.session.getMe()),
    );

    this.mcp.registerTool(
      "slack_get_status",
      {
        title: "Get Slack connection status",
        description:
          "Return the current Socket Mode connection status for this Slack app session.",
      },
      async () => createJsonResult(await this.session.getStatus()),
    );

    this.mcp.registerTool(
      "slack_get_channel",
      {
        title: "Get Slack conversation",
        description:
          "Get details for a Slack public channel, private channel, DM, or MPIM by ID.",
        inputSchema: z.object({
          channelId: z.string().describe("Target Slack conversation ID."),
        }),
      },
      async ({ channelId }) =>
        createJsonResult(await this.session.getChannelInfo(channelId)),
    );

    this.mcp.registerTool(
      "slack_get_channel_members",
      {
        title: "Get Slack conversation members",
        description:
          "List users that belong to a Slack public channel, private channel, or multi-person DM.",
        inputSchema: z.object({
          channelId: z.string().describe("Target Slack conversation ID."),
        }),
      },
      async ({ channelId }) =>
        createJsonResult(await this.session.getChannelMembers(channelId)),
    );

    this.mcp.registerTool(
      "slack_list_channels",
      {
        title: "List Slack conversations",
        description:
          "List Slack conversations with optional type, sort, and pagination filters.",
        inputSchema: z.object({
          filters: z
            .object({
              channel_types: z
                .array(
                  z.enum(["public_channel", "private_channel", "im", "mpim"]),
                )
                .optional()
                .describe(
                  "Optional Slack conversation types to include in the result set.",
                ),
              sort: z
                .enum(["popularity"])
                .optional()
                .describe(
                  "Optional sort mode. popularity sorts by member count descending.",
                ),
              limit: z.number().int().min(1).max(999).optional(),
              cursor: z.string().optional(),
            })
            .optional(),
        }),
      },
      async ({ filters }) =>
        createJsonResult(
          await this.session.listChannels(
            filters?.channel_types,
            filters?.sort,
            filters?.cursor,
            filters?.limit,
          ),
        ),
    );

    this.mcp.registerTool(
      "slack_list_users",
      {
        title: "List Slack users",
        description: "List Slack users with optional pagination filters.",
        inputSchema: z.object({
          filters: z
            .object({
              limit: z.number().int().min(1).max(999).optional(),
              cursor: z.string().optional(),
            })
            .optional(),
        }),
      },
      async ({ filters }) =>
        createJsonResult(
          await this.session.listUsers(filters?.cursor, filters?.limit),
        ),
    );

    this.mcp.registerTool(
      "slack_search_messages",
      {
        title: "Search Slack messages",
        description:
          "Search Slack messages using a free-text query plus optional channel, user, date, and thread filters. This tool requires a user token rather than a bot token.",
        inputSchema: z.object({
          query: z
            .string()
            .optional()
            .describe("Optional free-text search query or Slack message URL."),
          filters: z
            .object({
              in_channel: z
                .string()
                .optional()
                .describe(
                  "Optional public or private channel ID or name to constrain the search.",
                ),
              in_im_or_mpim: z
                .string()
                .optional()
                .describe(
                  "Optional DM or MPIM conversation ID or name to constrain the search.",
                ),
              users_with: z
                .string()
                .optional()
                .describe(
                  "Optional user ID or username to constrain results to messages involving that user.",
                ),
              users_from: z
                .string()
                .optional()
                .describe(
                  "Optional user ID or username to constrain results to messages sent by that user.",
                ),
              date_before: z
                .string()
                .optional()
                .describe(
                  "Optional upper-bound date filter, for example 2023-10-01.",
                ),
              date_after: z
                .string()
                .optional()
                .describe(
                  "Optional lower-bound date filter, for example 2023-10-01.",
                ),
              date_on: z
                .string()
                .optional()
                .describe(
                  "Optional exact date filter, for example 2023-10-01.",
                ),
              date_during: z
                .string()
                .optional()
                .describe(
                  "Optional relative date filter, for example July or Today.",
                ),
              threads_only: z
                .boolean()
                .optional()
                .describe("If true, only thread messages are returned."),
            })
            .optional(),
          cursor: z
            .string()
            .optional()
            .describe(
              "Optional page cursor returned as next_cursor by the prior result.",
            ),
          limit: z.number().int().min(1).max(100).optional(),
        }),
      },
      async ({ query, filters, cursor, limit }) =>
        createJsonResult(
          await this.session.searchMessages(
            query,
            filters
              ? {
                  inChannel: filters.in_channel,
                  inImOrMpim: filters.in_im_or_mpim,
                  usersWith: filters.users_with,
                  usersFrom: filters.users_from,
                  dateBefore: filters.date_before,
                  dateAfter: filters.date_after,
                  dateOn: filters.date_on,
                  dateDuring: filters.date_during,
                  threadsOnly: filters.threads_only,
                }
              : undefined,
            cursor,
            limit,
          ),
        ),
    );

    this.mcp.registerTool(
      "slack_get_channel_history",
      {
        title: "Get Slack conversation history",
        description:
          "Fetch messages from a Slack conversation with optional pagination and time bounds.",
        inputSchema: z.object({
          channelId: z.string().describe("Target Slack conversation ID."),
          limit: z.number().int().min(1).max(200).optional(),
          cursor: z.string().optional(),
          oldest: z.string().optional(),
          latest: z.string().optional(),
          inclusive: z.boolean().optional(),
        }),
      },
      async ({ channelId, limit, cursor, oldest, latest, inclusive }) =>
        createJsonResult(
          await this.session.getChannelHistory({
            channelId,
            limit,
            cursor,
            oldest,
            latest,
            inclusive,
          }),
        ),
    );

    this.mcp.registerTool(
      "slack_get_thread_replies",
      {
        title: "Get Slack thread replies",
        description:
          "Fetch replies for a Slack thread using the parent message timestamp.",
        inputSchema: z.object({
          channelId: z.string().describe("Target Slack conversation ID."),
          ts: z.string().describe("Parent message timestamp."),
          limit: z.number().int().min(1).max(200).optional(),
          cursor: z.string().optional(),
        }),
      },
      async ({ channelId, ts, limit, cursor }) =>
        createJsonResult(
          await this.session.getThreadReplies({
            channelId,
            ts,
            limit,
            cursor,
          }),
        ),
    );

    this.mcp.registerTool(
      "slack_send_message",
      {
        title: "Send a Slack message",
        description:
          "Send a plain text message to a Slack conversation, optionally into an existing thread.",
        inputSchema: z.object({
          channelId: z.string().describe("Target Slack conversation ID."),
          text: z.string().describe("Message text."),
          threadTs: z
            .string()
            .optional()
            .describe("Optional parent thread timestamp."),
        }),
      },
      async ({ channelId, text, threadTs }) =>
        createJsonResult(
          await this.session.sendMessage(channelId, text, threadTs),
        ),
    );

    this.mcp.registerTool(
      "slack_send_files",
      {
        title: "Send Slack files",
        description:
          "Upload one or more files to a Slack conversation using local file paths or inline text content, optionally in an existing thread.",
        inputSchema: z
          .object({
            channelId: z.string().describe("Target Slack conversation ID."),
            files: z
              .array(
                z
                  .object({
                    path: z
                      .string()
                      .optional()
                      .describe(
                        "Absolute or relative local file path to upload.",
                      ),
                    content: z
                      .string()
                      .optional()
                      .describe(
                        "Inline file contents to upload when no path is provided.",
                      ),
                    filename: z
                      .string()
                      .optional()
                      .describe(
                        "Optional filename override for the uploaded file.",
                      ),
                    title: z
                      .string()
                      .optional()
                      .describe("Optional Slack file title."),
                    altText: z
                      .string()
                      .optional()
                      .describe(
                        "Optional accessibility description for image uploads.",
                      ),
                    snippetType: z
                      .string()
                      .optional()
                      .describe(
                        "Optional snippet syntax type, for example text or javascript.",
                      ),
                  })
                  .refine((value) => Boolean(value.path || value.content), {
                    message: "Each file must provide either path or content.",
                  }),
              )
              .min(1)
              .optional()
              .describe(
                "Optional array of files to upload in one Slack message.",
              ),
            path: z
              .string()
              .optional()
              .describe("Absolute or relative local file path to upload."),
            content: z
              .string()
              .optional()
              .describe(
                "Inline file contents to upload when no path is provided.",
              ),
            filename: z
              .string()
              .optional()
              .describe("Optional filename override for the uploaded file."),
            title: z.string().optional().describe("Optional Slack file title."),
            altText: z
              .string()
              .optional()
              .describe(
                "Optional accessibility description for image uploads.",
              ),
            snippetType: z
              .string()
              .optional()
              .describe(
                "Optional snippet syntax type, for example text or javascript.",
              ),
            initialComment: z
              .string()
              .optional()
              .describe("Optional message text posted with the uploaded file."),
            threadTs: z
              .string()
              .optional()
              .describe("Optional parent thread timestamp."),
          })
          .refine(
            (value) =>
              Boolean(value.files?.length || value.path || value.content),
            {
              message: "Provide either files or a single path/content.",
            },
          )
          .refine(
            (value) =>
              !value.files ||
              !(
                value.path ||
                value.content ||
                value.filename ||
                value.title ||
                value.altText ||
                value.snippetType
              ),
            {
              message:
                "Use either files or the single-file fields, not both in the same call.",
            },
          ),
      },
      async ({
        channelId,
        files,
        path,
        content,
        filename,
        title,
        altText,
        snippetType,
        initialComment,
        threadTs,
      }) =>
        createJsonResult(
          await this.session.sendFiles({
            channelId,
            files: files ?? [
              {
                path,
                content,
                filename,
                title,
                altText,
                snippetType,
              },
            ],
            initialComment,
            threadTs,
          }),
        ),
    );

    this.mcp.registerTool(
      "slack_reply_to_message",
      {
        title: "Reply to a Slack message",
        description:
          "Reply to an existing Slack thread by providing the parent message timestamp.",
        inputSchema: z.object({
          channelId: z.string().describe("Target Slack conversation ID."),
          threadTs: z.string().describe("Parent message timestamp."),
          text: z.string().describe("Reply text."),
        }),
      },
      async ({ channelId, threadTs, text }) =>
        createJsonResult(
          await this.session.replyToMessage(channelId, threadTs, text),
        ),
    );

    this.mcp.registerTool(
      "slack_react_to_message",
      {
        title: "React to a Slack message",
        description:
          "Add an emoji reaction to a Slack message using the Slack reaction name without surrounding colons.",
        inputSchema: z.object({
          channelId: z.string().describe("Target Slack conversation ID."),
          timestamp: z.string().describe("Target message timestamp."),
          reaction: z
            .string()
            .optional()
            .describe("Slack reaction name, for example thumbsup or eyes."),
        }),
      },
      async ({ channelId, timestamp, reaction }) => {
        await this.session.reactToMessage(channelId, timestamp, reaction);
        return createJsonResult({ ok: true });
      },
    );

    this.mcp.registerTool(
      "slack_edit_message",
      {
        title: "Edit a Slack message",
        description:
          "Edit a previously sent Slack message using its conversation ID and timestamp.",
        inputSchema: z.object({
          channelId: z.string().describe("Target Slack conversation ID."),
          timestamp: z.string().describe("Target message timestamp."),
          text: z.string().describe("Updated message text."),
        }),
      },
      async ({ channelId, timestamp, text }) => {
        await this.session.editMessage(channelId, timestamp, text);
        return createJsonResult({ ok: true });
      },
    );

    this.mcp.registerTool(
      "slack_delete_message",
      {
        title: "Delete a Slack message",
        description:
          "Delete a previously sent Slack message using its conversation ID and timestamp.",
        inputSchema: z.object({
          channelId: z.string().describe("Target Slack conversation ID."),
          timestamp: z.string().describe("Target message timestamp."),
        }),
      },
      async ({ channelId, timestamp }) => {
        await this.session.deleteMessage(channelId, timestamp);
        return createJsonResult({ ok: true });
      },
    );
  }
}
