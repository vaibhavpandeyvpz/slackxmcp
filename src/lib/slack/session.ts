import { EventEmitter } from "node:events";
import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { CliIO } from "../cli-io.js";
import type {
  Channel,
  Connection,
  Entity,
  LookupResult,
  Message,
  MessageReference,
  SlackAttachment,
} from "./types.js";

type SessionEvents = {
  message: [Message];
};

type SlackUserLike = {
  id?: string;
  name?: string;
  real_name?: string;
  is_bot?: boolean;
  profile?: {
    display_name?: string;
    real_name?: string;
  };
};

type SlackConversationLike = {
  id?: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
  num_members?: number;
  topic?: { value?: string };
  purpose?: { value?: string };
};

type SlackFileLike = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private_download?: string;
};

type SlackMessageLike = {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: string;
  files?: SlackFileLike[];
};

type SlackFileUploadArguments = Parameters<WebClient["filesUploadV2"]>[0];
type SlackUploadInput = {
  path?: string;
  content?: string;
  filename?: string;
  title?: string;
  altText?: string;
  snippetType?: string;
};

const APP_TOKEN_ENV_NAME = "SLACK_APP_TOKEN";

export class SlackSession {
  private readonly io: CliIO;
  private readonly token: string;
  private readonly tokenEnvName: string;
  private readonly appToken: string;
  private readonly events = new EventEmitter();
  private readonly webClient: WebClient;
  private app: App | null = null;
  private state: Connection["status"] = "idle";
  private self?: Entity;
  private startPromise?: Promise<void>;
  private readonly channelCache = new Map<string, Channel>();
  private readonly userCache = new Map<string, Entity>();

  constructor(options: {
    token: string;
    tokenEnvName: string;
    appToken: string;
    io?: CliIO;
  }) {
    this.token = options.token;
    this.tokenEnvName = options.tokenEnvName;
    this.appToken = options.appToken;
    this.io = options.io ?? new CliIO();
    this.webClient = new WebClient(this.token);
  }

  get client(): App | null {
    return this.app;
  }

  on<EventName extends keyof SessionEvents>(
    event: EventName,
    listener: (...args: SessionEvents[EventName]) => void,
  ): () => void {
    this.events.on(event, listener);
    return () => this.events.off(event, listener);
  }

  async start(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.connect().finally(() => {
      this.startPromise = undefined;
    });

    await this.startPromise;
  }

  async destroy(): Promise<void> {
    const app = this.app;
    this.app = null;
    this.state = "disconnected";

    if (!app) {
      return;
    }

    await app.stop();
  }

  async getMe(): Promise<Entity> {
    if (this.self) {
      return this.self;
    }

    const auth = await this.webClient.auth.test();
    const userId =
      typeof auth.user_id === "string" && auth.user_id.trim()
        ? auth.user_id.trim()
        : undefined;
    const username =
      typeof auth.user === "string" && auth.user.trim()
        ? auth.user.trim()
        : undefined;
    const selfType = this.inferTokenEntityType();
    const self =
      userId != null
        ? await this.lookupUserEntity(userId, selfType === "bot")
        : undefined;

    this.self = {
      id: self?.id ?? userId ?? "unknown",
      username: self?.username ?? username,
      name: self?.name,
      type: self?.type ?? selfType,
    };
    return this.self;
  }

  async getStatus(): Promise<Connection> {
    return {
      profile: {
        env: this.tokenEnvName,
        appEnv: APP_TOKEN_ENV_NAME,
      },
      status: this.state,
      device: {
        library: "@slack/bolt",
        mode: "socket_mode",
      },
      self: this.self,
    };
  }

  async getChannelInfo(channelId: string): Promise<Channel> {
    const channel = await this.lookupConversationById(channelId);
    if (!channel) {
      throw new Error(`Slack conversation not found: ${channelId}`);
    }

    return channel;
  }

  async getChannelMembers(channelId: string): Promise<Entity[]> {
    const ids: string[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.webClient.conversations.members({
        channel: channelId,
        cursor,
        limit: 200,
      });
      ids.push(
        ...(response.members ?? []).filter(
          (member): member is string =>
            typeof member === "string" && member !== "",
        ),
      );
      cursor = response.response_metadata?.next_cursor || undefined;
    } while (cursor);

    const members = await Promise.all(
      ids.map(async (id) => this.lookupUserEntity(id, false)),
    );

    return members.filter((member): member is Entity => member != null);
  }

  async lookupChannel(input: string): Promise<LookupResult> {
    const query = input.trim();
    const direct = await this.lookupConversationById(query);
    if (direct) {
      return {
        q: query,
        id: direct.id,
        name: direct.name,
        type: direct.type,
        found: true,
      };
    }

    const needle = query.replace(/^#/, "").toLowerCase();
    let cursor: string | undefined;

    do {
      const response = await this.webClient.conversations.list({
        cursor,
        limit: 200,
        types: "public_channel,private_channel,mpim,im",
        exclude_archived: true,
      });
      const match = (response.channels ?? []).find((channel) => {
        return (
          typeof channel.id === "string" &&
          typeof channel.name === "string" &&
          channel.name.toLowerCase() === needle
        );
      });
      if (match) {
        const normalized = this.toChannel(match as SlackConversationLike);
        this.channelCache.set(normalized.id, normalized);
        return {
          q: query,
          id: normalized.id,
          name: normalized.name,
          type: normalized.type,
          found: true,
        };
      }
      cursor = response.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return {
      q: query,
      found: false,
    };
  }

  async getChannelHistory(input: {
    channelId: string;
    limit?: number;
    cursor?: string;
    oldest?: string;
    latest?: string;
    inclusive?: boolean;
  }): Promise<object> {
    const response = await this.webClient.conversations.history({
      channel: input.channelId,
      limit: input.limit,
      cursor: input.cursor,
      oldest: input.oldest,
      latest: input.latest,
      inclusive: input.inclusive,
    });

    return {
      ok: response.ok ?? true,
      has_more: response.has_more ?? false,
      next_cursor: response.response_metadata?.next_cursor,
      messages: await Promise.all(
        (response.messages ?? []).map(async (message) =>
          this.normalizeMessage(
            {
              ...(message as SlackMessageLike),
              channel: input.channelId,
            },
            false,
          ),
        ),
      ),
    };
  }

  async getThreadReplies(input: {
    channelId: string;
    ts: string;
    limit?: number;
    cursor?: string;
  }): Promise<object> {
    const response = await this.webClient.conversations.replies({
      channel: input.channelId,
      ts: input.ts,
      limit: input.limit,
      cursor: input.cursor,
    });

    return {
      ok: response.ok ?? true,
      has_more: response.has_more ?? false,
      next_cursor: response.response_metadata?.next_cursor,
      messages: await Promise.all(
        (response.messages ?? []).map(async (message) =>
          this.normalizeMessage(
            {
              ...(message as SlackMessageLike),
              channel: input.channelId,
            },
            false,
          ),
        ),
      ),
    };
  }

  async sendMessage(
    channelId: string,
    text: string,
    threadTs?: string,
  ): Promise<MessageReference> {
    const response = await this.webClient.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadTs,
    });

    return {
      channel_id: channelId,
      ts: response.ts ?? "",
      thread_ts: response.message?.thread_ts ?? threadTs,
    };
  }

  async sendFiles(input: {
    channelId: string;
    files: SlackUploadInput[];
    initialComment?: string;
    threadTs?: string;
  }): Promise<object> {
    const uploads = input.files.map((file) => this.createUploadEntry(file));
    const upload = (
      uploads.length === 1
        ? {
            channel_id: input.channelId,
            ...uploads[0],
          }
        : {
            channel_id: input.channelId,
            file_uploads: uploads,
          }
    ) as SlackFileUploadArguments;

    if (input.threadTs) {
      Object.assign(upload, { thread_ts: input.threadTs });
    }
    if (input.initialComment) {
      Object.assign(upload, { initial_comment: input.initialComment });
    }

    const response = await this.webClient.filesUploadV2(upload);

    return {
      ok: response.ok ?? true,
      channel_id: input.channelId,
      thread_ts: input.threadTs,
      files: ((response.files ?? []) as SlackFileLike[]).map((file) =>
        this.toAttachment(file),
      ),
    };
  }

  async replyToMessage(
    channelId: string,
    threadTs: string,
    text: string,
  ): Promise<MessageReference> {
    return this.sendMessage(channelId, text, threadTs);
  }

  async reactToMessage(
    channelId: string,
    timestamp: string,
    reaction = "thumbsup",
  ): Promise<void> {
    await this.webClient.reactions.add({
      channel: channelId,
      timestamp,
      name: reaction,
    });
  }

  async editMessage(
    channelId: string,
    timestamp: string,
    text: string,
  ): Promise<void> {
    await this.webClient.chat.update({
      channel: channelId,
      ts: timestamp,
      text,
    });
  }

  async deleteMessage(channelId: string, timestamp: string): Promise<void> {
    await this.webClient.chat.delete({
      channel: channelId,
      ts: timestamp,
    });
  }

  private async connect(): Promise<void> {
    if (this.app) {
      return;
    }

    this.state = "starting";

    try {
      const app = new App({
        token: this.token,
        appToken: this.appToken,
        socketMode: true,
      });

      app.error(async (error) => {
        this.io.error(
          error instanceof Error ? error.message : JSON.stringify(error),
        );
      });

      app.event("message", async ({ event }) => {
        await this.handleIncomingMessage(event as SlackMessageLike);
      });

      this.app = app;
      this.self = await this.getMe();
      await app.start();

      this.state = "connected";
      this.io.line(
        `Connected to Slack bot @${this.self.username ?? this.self.id}.`,
      );
    } catch (error) {
      this.state = "disconnected";
      throw error;
    }
  }

  private async handleIncomingMessage(event: SlackMessageLike): Promise<void> {
    if (this.shouldIgnoreMessage(event)) {
      return;
    }

    const message = await this.normalizeMessage(event, false);
    this.events.emit("message", message);
  }

  private shouldIgnoreMessage(event: SlackMessageLike): boolean {
    if (event.subtype || event.bot_id) {
      return true;
    }

    const channelId = event.channel?.trim();
    if (!channelId) {
      return true;
    }
    return false;
  }

  private async lookupConversationById(
    channelId: string,
  ): Promise<Channel | undefined> {
    const cached = this.channelCache.get(channelId);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.webClient.conversations.info({
        channel: channelId,
      });
      if (!response.channel) {
        return undefined;
      }

      const channel = this.toChannel(response.channel as SlackConversationLike);
      this.channelCache.set(channel.id, channel);
      return channel;
    } catch {
      return undefined;
    }
  }

  private async lookupUserEntity(
    userId: string,
    asBot: boolean,
  ): Promise<Entity | undefined> {
    const cached = this.userCache.get(userId);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.webClient.users.info({ user: userId });
      if (!response.user) {
        return undefined;
      }

      const entity = this.toEntity(response.user as SlackUserLike, asBot);
      this.userCache.set(entity.id, entity);
      return entity;
    } catch {
      return asBot
        ? {
            id: userId,
            type: "bot",
          }
        : undefined;
    }
  }

  private toEntity(user: SlackUserLike, asBot: boolean): Entity {
    const username =
      typeof user.name === "string" && user.name.trim()
        ? user.name.trim()
        : undefined;
    const profileName =
      typeof user.profile?.display_name === "string" &&
      user.profile.display_name.trim()
        ? user.profile.display_name.trim()
        : undefined;
    const realName =
      typeof user.real_name === "string" && user.real_name.trim()
        ? user.real_name.trim()
        : typeof user.profile?.real_name === "string" &&
            user.profile.real_name.trim()
          ? user.profile.real_name.trim()
          : undefined;

    return {
      id: user.id?.trim() || "unknown",
      username,
      name: profileName ?? realName,
      type: asBot || user.is_bot ? "bot" : "user",
    };
  }

  private toChannel(conversation: SlackConversationLike): Channel {
    return {
      id: conversation.id?.trim() || "unknown",
      name:
        typeof conversation.name === "string" && conversation.name.trim()
          ? conversation.name.trim()
          : undefined,
      type: this.detectConversationType(conversation),
      topic: conversation.topic?.value?.trim() || undefined,
      purpose: conversation.purpose?.value?.trim() || undefined,
      flags: {
        private: Boolean(conversation.is_private),
        dm: Boolean(conversation.is_im),
        mpim: Boolean(conversation.is_mpim),
        archived: Boolean(conversation.is_archived),
      },
      member_count: conversation.num_members,
    };
  }

  private detectConversationType(
    conversation: SlackConversationLike,
  ): Channel["type"] {
    if (conversation.is_im) {
      return "im";
    }
    if (conversation.is_mpim) {
      return "mpim";
    }
    if (conversation.is_group || conversation.is_private) {
      return "group";
    }
    if (conversation.is_channel) {
      return "channel";
    }
    return "unknown";
  }

  private async normalizeMessage(
    event: SlackMessageLike,
    outgoing: boolean,
  ): Promise<Message> {
    const channelId = event.channel?.trim() || "unknown";
    const channel =
      (await this.lookupConversationById(channelId)) ??
      ({
        id: channelId,
        type: event.channel_type === "im" ? "im" : "unknown",
        flags: {
          private: false,
          dm: event.channel_type === "im",
          mpim: event.channel_type === "mpim",
          archived: false,
        },
      } as Channel);
    const sender =
      typeof event.user === "string" && event.user.trim()
        ? await this.lookupUserEntity(event.user.trim(), outgoing)
        : outgoing
          ? await this.getMe()
          : undefined;
    const attachments = (event.files ?? []).map((file) =>
      this.toAttachment(file),
    );

    return {
      id: `${channelId}:${event.ts ?? "unknown"}`,
      ts: event.ts ?? "",
      thread_ts: event.thread_ts,
      text: event.text ?? "",
      channel,
      sender,
      timestamp: this.timestampFromSlackTs(event.ts),
      subtype: event.subtype,
      attachments,
      links: this.extractLinks(event.text ?? ""),
    };
  }

  private toAttachment(file: SlackFileLike): SlackAttachment {
    return {
      id: file.id,
      name: file.name,
      title: file.title,
      mimetype: file.mimetype,
      filetype: file.filetype,
      size: file.size,
      url_private_download: file.url_private_download,
    };
  }

  private createUploadEntry(input: SlackUploadInput): object {
    const upload = (
      input.path
        ? {
            file: input.path,
          }
        : {
            content: input.content ?? "",
          }
    ) as Record<string, string>;

    if (input.filename) {
      upload.filename = input.filename;
    }
    if (input.title) {
      upload.title = input.title;
    }
    if (input.altText) {
      upload.alt_text = input.altText;
    }
    if (input.snippetType) {
      upload.snippet_type = input.snippetType;
    }

    return upload;
  }

  private extractLinks(text: string): string[] {
    return Array.from(
      text.matchAll(/<((?:https?:\/\/|mailto:)[^>|]+)(?:\|[^>]+)?>/g),
    )
      .map((match) => match[1])
      .filter((link): link is string => Boolean(link));
  }

  private timestampFromSlackTs(ts?: string): string {
    const seconds = Number(ts?.split(".")[0] ?? "");
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return new Date().toISOString();
    }

    return new Date(seconds * 1000).toISOString();
  }

  private inferTokenEntityType(): Entity["type"] {
    return this.token.startsWith("xoxp-") ? "user" : "bot";
  }
}
