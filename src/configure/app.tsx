import React, { useCallback, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { z } from "zod";
import { configPath, rootPath } from "../lib/paths.js";
import type { SlackConfig } from "../lib/slack/config.js";
import { selectConfiguredToken } from "../lib/slack/config.js";
import { SlackSession } from "../lib/slack/session.js";
import type { Channel, UserProfile } from "../lib/slack/types.js";
import { BusyScreen } from "./components/BusyScreen.js";
import { HomeScreen } from "./components/HomeScreen.js";
import { MenuScreen } from "./components/MenuScreen.js";
import { PromptForm } from "./components/PromptForm.js";
import type {
  ConfigureAppProps,
  ConfigureScreen,
  MenuItem,
  Notice,
  PromptState,
} from "./types.js";

const channelPageSchema = z.object({
  next_cursor: z.string().optional(),
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      type: z.enum(["channel", "group", "im", "mpim", "unknown"]),
      flags: z.object({
        private: z.boolean(),
        dm: z.boolean(),
        mpim: z.boolean(),
        archived: z.boolean(),
      }),
      member_count: z.number().optional(),
    }),
  ),
});

const userPageSchema = z.object({
  next_cursor: z.string().optional(),
  users: z.array(
    z.object({
      user_id: z.string(),
      username: z.string().optional(),
      real_name: z.string().optional(),
      display_name: z.string().optional(),
      email: z.string().optional(),
      title: z.string().optional(),
      dm_channel_id: z.string().optional(),
      type: z.enum(["bot", "user"]),
    }),
  ),
});

export function ConfigureApp({
  initial,
  onSave,
  onExit,
}: ConfigureAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<ConfigureScreen>({ kind: "home" });
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<SlackConfig>(initial);
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [dmNamesByChannel, setDmNamesByChannel] = useState<
    Record<string, string>
  >({});

  const runTask = useCallback(
    async (label: string, task: () => Promise<void>) => {
      setBusyMessage(label);
      try {
        await task();
      } catch (error) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyMessage(null);
      }
    },
    [],
  );

  const setSuccess = useCallback((text: string) => {
    setNotice({ kind: "success", text });
  }, []);

  useInput(
    (input, key) => {
      if (key.ctrl && input.toLowerCase() === "c") {
        onExit();
        exit();
        return;
      }
      if (!key.escape || busyMessage) {
        return;
      }
      if (prompt) {
        prompt.onCancel?.();
        setPrompt(null);
        return;
      }
      if (screen.kind !== "home") {
        setScreen({ kind: "home" });
      }
    },
    { isActive: true },
  );

  const promptToken = useCallback(
    (field: "appToken" | "botToken" | "userToken", label: string) => {
      setPrompt({
        title: `Update ${label}`,
        label,
        note: "Value is stored in ~/.slackxmcp/config.json.",
        initialValue: draft[field],
        onSubmit: async (value) => {
          const next = value.trim();
          setDraft((current) => ({ ...current, [field]: next }));
          setPrompt(null);
          setSuccess(`Updated ${label}.`);
        },
      });
    },
    [draft, setSuccess],
  );

  const openUsersEditor = useCallback(() => {
    void runTask("Loading Slack users...", async () => {
      const loadedUsers = await fetchAllUsers(draft);
      setUsers(loadedUsers);
      setScreen({ kind: "edit-users" });
    });
  }, [draft, runTask]);

  const openChannelsEditor = useCallback(() => {
    void runTask("Loading Slack channels...", async () => {
      const [loadedChannels, loadedUsers] = await Promise.all([
        fetchAllChannels(draft),
        fetchAllUsers(draft),
      ]);
      setChannels(loadedChannels);
      setDmNamesByChannel(buildDmNamesByChannel(loadedUsers));
      setScreen({ kind: "edit-channels" });
    });
  }, [draft, runTask]);

  const saveAndExit = useCallback(() => {
    void runTask("Saving configuration...", async () => {
      if (!draft.appToken.trim()) {
        throw new Error("App token is required.");
      }
      if (!draft.botToken.trim() && !draft.userToken.trim()) {
        throw new Error("Either bot token or user token is required.");
      }
      await onSave(draft);
      onExit();
      exit();
    });
  }, [draft, exit, onExit, onSave, runTask]);

  const summary = useMemo(
    () =>
      `users:${draft.allowlist.users.length} • channels:${draft.allowlist.channels.length}`,
    [draft],
  );

  const renderHome = () => {
    const items: MenuItem[] = [
      {
        label: `App token • ${maskPresence(draft.appToken)}`,
        value: () => promptToken("appToken", "App token"),
      },
      {
        label: `Bot token • ${maskPresence(draft.botToken)}`,
        value: () => promptToken("botToken", "Bot token"),
      },
      {
        label: `User token • ${maskPresence(draft.userToken)}`,
        value: () => promptToken("userToken", "User token"),
      },
      {
        label: `Allowed users • ${draft.allowlist.users.length} selected`,
        value: openUsersEditor,
      },
      {
        label: `Allowed channels • ${draft.allowlist.channels.length} selected`,
        value: openChannelsEditor,
      },
      {
        label: "Save and exit",
        value: saveAndExit,
      },
      {
        label: "Exit without saving",
        value: () => {
          onExit();
          exit();
        },
      },
    ];
    return (
      <HomeScreen
        rootPath={rootPath()}
        configPath={configPath()}
        items={items}
      />
    );
  };

  const renderUsersEditor = () => {
    const entries = users ?? [];
    const selected = new Set(draft.allowlist.users);
    const items: MenuItem[] = [
      ...entries.map((user) => {
        const isSelected = selected.has(user.user_id);
        return {
          key: `user:${user.user_id}`,
          label: `${isSelected ? "[x]" : "[ ]"} ${formatUserLabel(user)}`,
          value: () => {
            setDraft((current) => ({
              ...current,
              allowlist: {
                ...current.allowlist,
                users: toggleId(current.allowlist.users, user.user_id),
              },
            }));
          },
        };
      }),
      {
        key: "users:back",
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];
    return (
      <MenuScreen
        title="Allowed Users"
        description="Toggle users for inbound event allowlist."
        items={items}
        searchable
        pageSize={5}
        footerHint="type: search | enter: toggle/select | esc: back | ctrl+c: exit"
      />
    );
  };

  const renderChannelsEditor = () => {
    const entries = channels ?? [];
    const selected = new Set(draft.allowlist.channels);
    const items: MenuItem[] = [
      ...entries.map((channel) => {
        const isSelected = selected.has(channel.id);
        return {
          key: `channel:${channel.id}`,
          label: `${isSelected ? "[x]" : "[ ]"} ${formatChannelLabel(channel, dmNamesByChannel)}`,
          value: () => {
            setDraft((current) => ({
              ...current,
              allowlist: {
                ...current.allowlist,
                channels: toggleId(current.allowlist.channels, channel.id),
              },
            }));
          },
        };
      }),
      {
        key: "channels:back",
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];
    return (
      <MenuScreen
        title="Allowed Channels"
        description="Toggle channels for inbound event allowlist."
        items={items}
        searchable
        pageSize={5}
        footerHint="type: search | enter: toggle/select | esc: back | ctrl+c: exit"
      />
    );
  };

  const body = (() => {
    if (busyMessage) {
      return <BusyScreen message={busyMessage} />;
    }
    if (prompt) {
      return (
        <PromptForm
          prompt={prompt}
          onSubmit={async (value) => {
            try {
              await prompt.onSubmit(value);
            } catch (error) {
              setNotice({
                kind: "error",
                text: error instanceof Error ? error.message : String(error),
              });
            }
          }}
        />
      );
    }
    if (screen.kind === "edit-users") {
      return renderUsersEditor();
    }
    if (screen.kind === "edit-channels") {
      return renderChannelsEditor();
    }
    return renderHome();
  })();

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      {notice ? (
        <Box marginTop={1}>
          <Text color={noticeColor(notice.kind)}>{notice.text}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="gray">{summary}</Text>
      </Box>
      {body}
    </Box>
  );
}

function noticeColor(kind: Notice["kind"]): "green" | "yellow" | "red" {
  if (kind === "success") {
    return "green";
  }
  if (kind === "info") {
    return "yellow";
  }
  return "red";
}

function maskPresence(value: string): string {
  return value.trim() ? "[REDACTED]" : "empty";
}

function toggleId(list: ReadonlyArray<string>, id: string): string[] {
  const set = new Set(list);
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function formatUserLabel(user: UserProfile): string {
  const preferredName =
    user.display_name?.trim() ||
    user.real_name?.trim() ||
    (user.username ? `@${user.username}` : undefined);
  if (!preferredName) {
    return user.user_id;
  }
  return `${preferredName} (${user.user_id})`;
}

function formatChannelLabel(
  channel: Channel,
  dmNamesByChannel: Record<string, string>,
): string {
  if (channel.name?.trim()) {
    const prefix =
      channel.type === "channel" || channel.type === "group" ? "#" : "";
    return `${prefix}${channel.name.trim()} (${channel.id})`;
  }
  if (channel.type === "im") {
    const participant = dmNamesByChannel[channel.id];
    if (participant) {
      return `DM - ${participant} (${channel.id})`;
    }
    return `DM (${channel.id})`;
  }
  if (channel.type === "mpim") {
    return `Group DM (${channel.id})`;
  }
  return channel.id;
}

function buildDmNamesByChannel(
  users: ReadonlyArray<UserProfile>,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const user of users) {
    const dmChannelId = user.dm_channel_id?.trim();
    if (!dmChannelId) {
      continue;
    }
    const label =
      user.display_name?.trim() ||
      user.real_name?.trim() ||
      (user.username ? `@${user.username}` : undefined) ||
      user.user_id;
    mapping[dmChannelId] = label;
  }
  return mapping;
}

async function fetchAllUsers(config: SlackConfig): Promise<UserProfile[]> {
  const session = createSession(config);
  let cursor: string | undefined;
  const users: UserProfile[] = [];
  try {
    do {
      const page = userPageSchema.parse(await session.listUsers(cursor, 200));
      users.push(...page.users);
      cursor = page.next_cursor?.trim() || undefined;
    } while (cursor);
    return users.sort((a, b) => a.user_id.localeCompare(b.user_id));
  } finally {
    await session.destroy();
  }
}

async function fetchAllChannels(config: SlackConfig): Promise<Channel[]> {
  const session = createSession(config);
  let cursor: string | undefined;
  const channels: Channel[] = [];
  try {
    do {
      const page = channelPageSchema.parse(
        await session.listChannels(
          ["public_channel", "private_channel", "im", "mpim"],
          undefined,
          cursor,
          200,
        ),
      );
      channels.push(...page.channels);
      cursor = page.next_cursor?.trim() || undefined;
    } while (cursor);
    return channels.sort((a, b) => a.id.localeCompare(b.id));
  } finally {
    await session.destroy();
  }
}

function createSession(config: SlackConfig): SlackSession {
  if (!config.appToken.trim()) {
    throw new Error("App token is required before loading allowlist data.");
  }
  const token = selectConfiguredToken(config);
  if (!token) {
    throw new Error(
      "Bot token or user token is required before loading allowlist.",
    );
  }
  return new SlackSession({
    token: token.token,
    tokenEnvName:
      token.tokenSource === "botToken" ? "SLACK_BOT_TOKEN" : "SLACK_USER_TOKEN",
    appToken: config.appToken.trim(),
  });
}
