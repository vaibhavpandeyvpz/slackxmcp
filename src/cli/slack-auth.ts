import {
  selectConfiguredToken,
  type SlackConfig,
} from "../lib/slack/config.js";

export function resolveSlackCredentials(config: SlackConfig):
  | {
      token: string;
      tokenEnvName: string;
      appToken: string;
    }
  | undefined {
  const configuredToken = selectConfiguredToken(config);
  const configuredAppToken = config.appToken.trim();
  if (configuredToken && configuredAppToken) {
    return {
      token: configuredToken.token,
      tokenEnvName:
        configuredToken.tokenSource === "botToken"
          ? "SLACK_BOT_TOKEN"
          : "SLACK_USER_TOKEN",
      appToken: configuredAppToken,
    };
  }
  return undefined;
}

export function slackTokenHelpMessage(): string {
  return 'Run "slackxmcp configure" with a bot token or user token before starting slackxmcp.';
}

export function slackAppTokenHelpMessage(): string {
  return 'Run "slackxmcp configure" with an app token before starting slackxmcp.';
}
