import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ZodError, z } from "zod";
import { configPath } from "../paths.js";

const allowlistSchema = z.object({
  channels: z.array(z.string()).default([]),
  users: z.array(z.string()).default([]),
});

const slackConfigSchema = z.object({
  appToken: z.string().default(""),
  botToken: z.string().default(""),
  userToken: z.string().default(""),
  allowlist: allowlistSchema.default({
    channels: [],
    users: [],
  }),
});

export type SlackAllowlist = z.infer<typeof allowlistSchema>;
export type SlackConfig = z.infer<typeof slackConfigSchema>;
export type SlackTokenSource = "botToken" | "userToken";

export type SlackEventAllowlist = {
  channels: ReadonlySet<string>;
  users: ReadonlySet<string>;
  enabled: boolean;
};

const DEFAULT_CONFIG: SlackConfig = {
  appToken: "",
  botToken: "",
  userToken: "",
  allowlist: {
    channels: [],
    users: [],
  },
};

export async function loadSlackConfig(): Promise<SlackConfig> {
  const path = configPath();
  try {
    const content = await readFile(path, "utf8");
    return normalizeConfig(slackConfigSchema.parse(JSON.parse(content)));
  } catch (error) {
    if (isMissingFile(error)) {
      return DEFAULT_CONFIG;
    }
    if (error instanceof ZodError) {
      throw new Error(
        `Invalid Slack config at ${path}. Expected { appToken, botToken, userToken, allowlist: { channels, users } }.`,
      );
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in Slack config at ${path}.`);
    }
    throw error;
  }
}

export async function saveSlackConfig(config: SlackConfig): Promise<string> {
  const path = configPath();
  const normalized = normalizeConfig(config);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return path;
}

export function createEventAllowlist(
  allowlist: SlackAllowlist,
): SlackEventAllowlist {
  const channels = new Set(normalizeIds(allowlist.channels));
  const users = new Set(normalizeIds(allowlist.users));
  return {
    channels,
    users,
    enabled: channels.size > 0 || users.size > 0,
  };
}

export function selectConfiguredToken(
  config: SlackConfig,
): { token: string; tokenSource: SlackTokenSource } | undefined {
  const botToken = config.botToken.trim();
  if (botToken) {
    return { token: botToken, tokenSource: "botToken" };
  }
  const userToken = config.userToken.trim();
  if (userToken) {
    return { token: userToken, tokenSource: "userToken" };
  }
  return undefined;
}

function normalizeConfig(config: SlackConfig): SlackConfig {
  return {
    appToken: config.appToken.trim(),
    botToken: config.botToken.trim(),
    userToken: config.userToken.trim(),
    allowlist: {
      channels: normalizeIds(config.allowlist.channels),
      users: normalizeIds(config.allowlist.users),
    },
  };
}

function normalizeIds(values: ReadonlyArray<string>): string[] {
  return Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
