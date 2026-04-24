import type { SlackConfig } from "../lib/slack/config.js";

export type MenuAction = () => void | Promise<void>;

export type MenuItem = {
  key?: string;
  label: string;
  boldSubstring?: string;
  value: MenuAction;
};

export type Notice = {
  kind: "success" | "error" | "info";
  text: string;
};

export type PromptState = {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  note?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onCancel?: () => void;
};

export type ConfigureScreen =
  | { kind: "home" }
  | { kind: "edit-users" }
  | { kind: "edit-channels" };

export type ConfigureAppProps = {
  initial: SlackConfig;
  onSave: (config: SlackConfig) => Promise<void>;
  onExit: () => void;
};
