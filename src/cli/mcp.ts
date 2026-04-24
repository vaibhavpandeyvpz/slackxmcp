import process from "node:process";
import type { Command as CommanderCommand } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CliIO } from "../lib/cli-io.js";
import { SlackMcpServer } from "../lib/mcp/server.js";
import { register } from "../lib/signal-handler.js";
import { createEventAllowlist, loadSlackConfig } from "../lib/slack/config.js";
import { SlackSession } from "../lib/slack/session.js";
import type { CliCommand } from "../types.js";
import {
  resolveSlackCredentials,
  slackAppTokenHelpMessage,
  slackTokenHelpMessage,
} from "./slack-auth.js";

export class McpCommand implements CliCommand {
  constructor(
    private readonly io = new CliIO(process.stderr, process.stderr),
  ) {}

  register(program: CommanderCommand): void {
    program
      .command("mcp")
      .description("Start the stdio MCP server for a Slack Socket Mode app")
      .option(
        "--channels",
        "Enable hooman/channel notifications for Slack messages",
      )
      .action(this.action.bind(this));
  }

  private async action(options: { channels?: boolean }): Promise<void> {
    let keep = false;
    const config = await loadSlackConfig();
    const credentials = resolveSlackCredentials(config);

    if (!credentials?.token) {
      throw new Error(slackTokenHelpMessage());
    }

    if (!credentials.appToken) {
      throw new Error(slackAppTokenHelpMessage());
    }

    const session = new SlackSession({
      token: credentials.token,
      tokenEnvName: credentials.tokenEnvName,
      appToken: credentials.appToken,
      io: this.io,
    });

    let destroyed = false;
    const closeSession = async () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      await session.destroy();
    };

    const unregister = register(async () => {
      this.io.line("Shutting down Slack MCP server...");
      await closeSession();
    });

    try {
      const allowlist = options.channels
        ? createEventAllowlist(config.allowlist)
        : undefined;
      const server = SlackMcpServer.create(
        session,
        Boolean(options.channels),
        allowlist,
      );
      await server.start(new StdioServerTransport());
      if (options.channels) {
        await server.subscribe();
      }
      this.io.line("Starting Slack MCP server...");
      await session.start();
      keep = true;
    } finally {
      unregister();
      if (!keep) {
        await closeSession();
      }
    }
  }
}
