import { homedir } from "node:os";
import { join } from "node:path";

export const APP_FOLDER = ".slackxmcp";
const SLACKMCP_HOME_ENV = "SLACKMCP_HOME";

export function appRoot(): string {
  const override = process.env[SLACKMCP_HOME_ENV]?.trim();
  if (override) {
    return override;
  }

  return join(homedir(), APP_FOLDER);
}

export function rootPath(): string {
  return appRoot();
}

export function attachmentsRoot(): string {
  return join(appRoot(), "attachments");
}

export function configPath(): string {
  return join(appRoot(), "config.json");
}
