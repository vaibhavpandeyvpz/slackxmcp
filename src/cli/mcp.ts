import process from "node:process";
import type { Command as CommanderCommand } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CliIO } from "../lib/cli-io.js";
import { SlackMcpServer } from "../lib/mcp/server.js";
import { register } from "../lib/signal-handler.js";
import { SlackSession } from "../lib/slack/session.js";
import type { CliCommand } from "../types.js";

const TOKEN_ENV_NAMES = ["SLACK_BOT_TOKEN", "SLACK_USER_TOKEN"] as const;
const APP_TOKEN_ENV_NAME = "SLACK_APP_TOKEN";

export class McpCommand implements CliCommand {
  constructor(
    private readonly io = new CliIO(process.stderr, process.stderr),
  ) {}

  register(program: CommanderCommand): void {
    program
      .command("mcp")
      .description("Start the stdio MCP server for a Slack Socket Mode app")
      .option("--channel <name>", "Channel name, for receiving notifications")
      .action(this.action.bind(this));
  }

  private async action(options: { channel?: string }): Promise<void> {
    let keep = false;
    const tokenConfig = resolveSlackToken();
    const appToken = process.env[APP_TOKEN_ENV_NAME]?.trim();

    if (!tokenConfig) {
      throw new Error(
        `Set ${TOKEN_ENV_NAMES.join(" or ")} before starting slackmcp.`,
      );
    }

    if (!appToken) {
      throw new Error(`Set ${APP_TOKEN_ENV_NAME} before starting slackmcp.`);
    }

    const session = new SlackSession({
      token: tokenConfig.value,
      tokenEnvName: tokenConfig.envName,
      appToken,
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
      const server = SlackMcpServer.create(session, options.channel);
      await server.start(new StdioServerTransport());
      if (options.channel) {
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

function resolveSlackToken():
  | { envName: (typeof TOKEN_ENV_NAMES)[number]; value: string }
  | undefined {
  for (const envName of TOKEN_ENV_NAMES) {
    const value = process.env[envName]?.trim();
    if (value) {
      return { envName, value };
    }
  }

  return undefined;
}
