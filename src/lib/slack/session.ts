import { EventEmitter } from "node:events";
import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type { KnownBlock } from "@slack/types";
import { CliIO } from "../cli-io.js";
import { saveSlackFile } from "../attachments.js";
import type {
  Channel,
  ChannelPermissionBehavior,
  ChannelPermissionOption,
  Connection,
  Entity,
  Message,
  MessageSearchResult,
  MessageReference,
  PermissionDecision,
  UserProfile,
} from "./types.js";

type SessionEvents = {
  message: [Message];
  permission: [PermissionDecision];
};

type SlackUserLike = {
  id?: string;
  name?: string;
  real_name?: string;
  is_bot?: boolean;
  deleted?: boolean;
  profile?: {
    display_name?: string;
    real_name?: string;
    email?: string;
    title?: string;
  };
};

type SlackConversationLike = {
  id?: string;
  name?: string;
  user?: string;
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

type SlackSearchMessageLike = {
  subtype?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  files?: SlackFileLike[];
  permalink?: string;
  score?: number;
  channel?: SlackConversationLike;
  username?: string;
};

type MessageSearchFilters = {
  inChannel?: string;
  inImOrMpim?: string;
  usersWith?: string;
  usersFrom?: string;
  dateBefore?: string;
  dateAfter?: string;
  dateOn?: string;
  dateDuring?: string;
  threadsOnly?: boolean;
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
  private readonly dmChannelCache = new Map<string, string>();
  private dmChannelCacheLoaded = false;

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
      status: this.state,
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

  async listChannels(
    channelTypes?: Array<"public_channel" | "private_channel" | "im" | "mpim">,
    sort?: "popularity",
    cursor?: string,
    limit?: number,
  ): Promise<object> {
    const response = await this.webClient.conversations.list({
      cursor,
      limit,
      types: channelTypes?.join(","),
    });

    const channels = (response.channels ?? []).map((conversation) => {
      const channel = this.normalizeChannel(
        conversation as SlackConversationLike,
      );
      this.channelCache.set(channel.id, channel);
      return channel;
    });

    if (sort === "popularity") {
      channels.sort(
        (left, right) => (right.member_count ?? 0) - (left.member_count ?? 0),
      );
    }

    return {
      ok: response.ok ?? true,
      next_cursor: response.response_metadata?.next_cursor,
      channels,
    };
  }

  async listUsers(cursor?: string, limit?: number): Promise<object> {
    await this.loadDmChannelCache();

    const response = await this.webClient.users.list({
      cursor,
      limit,
    });

    return {
      ok: response.ok ?? true,
      next_cursor: response.response_metadata?.next_cursor,
      users: (response.members ?? [])
        .map((user) => this.normalizeUserProfile(user as SlackUserLike))
        .filter((user): user is UserProfile => user != null),
    };
  }

  async searchMessages(
    searchQuery?: string,
    filters?: MessageSearchFilters,
    cursor?: string,
    limit?: number,
  ): Promise<object> {
    if (this.inferTokenEntityType() === "bot") {
      throw new Error(
        "slack_search_messages is not available for bot tokens. Use SLACK_USER_TOKEN with search:read instead.",
      );
    }

    const page = this.parseSearchPage(cursor);
    const query = await this.buildMessageSearchQuery(searchQuery, filters);
    const response = await this.webClient.search.messages({
      query,
      page,
      count: limit ?? 20,
      highlight: false,
    });

    const paging = response.messages?.paging;
    const pageCount =
      typeof paging?.page === "number" &&
      typeof paging?.pages === "number" &&
      paging.page < paging.pages
        ? String(paging.page + 1)
        : undefined;
    const matches = (response.messages?.matches ??
      []) as SlackSearchMessageLike[];

    return {
      ok: response.ok ?? true,
      query,
      total: response.messages?.total ?? matches.length,
      next_cursor: pageCount,
      messages: await Promise.all(
        matches.map(async (match) => this.normalizeSearchMessage(match)),
      ),
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

  async sendPermissionRequest(
    channelId: string,
    text: string,
    requestId: string,
    options: ChannelPermissionOption[],
    threadTs?: string,
  ): Promise<MessageReference> {
    const blocks: KnownBlock[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      },
      {
        type: "actions",
        elements: options.map((option) => ({
          type: "button",
          text: {
            type: "plain_text",
            text: option.label,
            emoji: true,
          },
          action_id: `hooman_approval_select:${option.id}`,
          value: JSON.stringify({
            requestId,
            optionId: option.id,
          }),
        })),
      },
    ];

    const response = await this.webClient.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadTs,
      blocks,
    } as never);

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
      files: response.files ?? [],
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
      app.action(/^hooman_approval_select(?:$|:)/, async ({ ack, body }) => {
        await ack();
        const payload = body as {
          actions?: Array<{ value?: unknown }>;
          channel?: { id?: unknown };
          container?: { message_ts?: unknown };
        };
        const action = Array.isArray(payload.actions)
          ? payload.actions[0]
          : undefined;
        const value =
          typeof action?.value === "string" ? action.value : undefined;
        const parsed = parsePermissionActionValue(value);
        if (!parsed) {
          return;
        }
        this.events.emit("permission", parsed);

        const channelId =
          typeof payload.channel?.id === "string"
            ? payload.channel.id
            : undefined;
        const messageTs =
          typeof payload.container?.message_ts === "string"
            ? payload.container.message_ts
            : undefined;
        if (channelId && messageTs) {
          await this.webClient.chat.update({
            channel: channelId,
            ts: messageTs,
            text: "Approval resolved.",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `Approval resolved: \`${parsed.behavior}\``,
                },
              },
            ],
          });
        }
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

      const channel = this.normalizeChannel(
        response.channel as SlackConversationLike,
      );
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

      const entity = this.normalizeUser(response.user as SlackUserLike, asBot);
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

  private async loadDmChannelCache(): Promise<void> {
    if (this.dmChannelCacheLoaded) {
      return;
    }

    let cursor: string | undefined;
    do {
      const response = await this.webClient.conversations.list({
        cursor,
        limit: 200,
        types: "im",
      });

      for (const conversation of response.channels ?? []) {
        const userId = (conversation as SlackConversationLike).user?.trim();
        const channelId = (conversation as SlackConversationLike).id?.trim();
        if (userId && channelId) {
          this.dmChannelCache.set(userId, channelId);
        }
      }

      cursor = response.response_metadata?.next_cursor || undefined;
    } while (cursor);

    this.dmChannelCacheLoaded = true;
  }

  private normalizeUserProfile(user: SlackUserLike): UserProfile | undefined {
    if (user.deleted || !user.id?.trim()) {
      return undefined;
    }

    const username =
      typeof user.name === "string" && user.name.trim()
        ? user.name.trim()
        : undefined;
    const realName =
      typeof user.real_name === "string" && user.real_name.trim()
        ? user.real_name.trim()
        : typeof user.profile?.real_name === "string" &&
            user.profile.real_name.trim()
          ? user.profile.real_name.trim()
          : undefined;
    const displayName =
      typeof user.profile?.display_name === "string" &&
      user.profile.display_name.trim()
        ? user.profile.display_name.trim()
        : undefined;
    const email =
      typeof user.profile?.email === "string" && user.profile.email.trim()
        ? user.profile.email.trim()
        : undefined;
    const title =
      typeof user.profile?.title === "string" && user.profile.title.trim()
        ? user.profile.title.trim()
        : undefined;

    return {
      user_id: user.id.trim(),
      username,
      real_name: realName,
      display_name: displayName,
      email,
      title,
      dm_channel_id: this.dmChannelCache.get(user.id.trim()),
      type: user.is_bot ? "bot" : "user",
    };
  }

  private parseSearchPage(cursor?: string): number {
    if (!cursor?.trim()) {
      return 1;
    }

    const page = Number.parseInt(cursor, 10);
    if (!Number.isFinite(page) || page < 1) {
      throw new Error(
        `Invalid cursor "${cursor}". Expected a positive page number.`,
      );
    }

    return page;
  }

  private async buildMessageSearchQuery(
    searchQuery?: string,
    filters?: MessageSearchFilters,
  ): Promise<string> {
    const terms = [searchQuery?.trim()].filter((value): value is string =>
      Boolean(value),
    );

    const channelTerm = await this.resolveChannelSearchTerm(filters?.inChannel);
    if (channelTerm) {
      terms.push(`in:${channelTerm}`);
    }

    const dmOrMpimTerm = await this.resolveDmOrMpimSearchTerm(
      filters?.inImOrMpim,
    );
    if (dmOrMpimTerm) {
      terms.push(`in:${dmOrMpimTerm}`);
    }

    const withUser = await this.resolveUserSearchTerm(filters?.usersWith);
    if (withUser) {
      terms.push(`with:${withUser}`);
    }

    const fromUser = await this.resolveUserSearchTerm(filters?.usersFrom);
    if (fromUser) {
      terms.push(`from:${fromUser}`);
    }

    if (filters?.dateBefore?.trim()) {
      terms.push(`before:${filters.dateBefore.trim()}`);
    }
    if (filters?.dateAfter?.trim()) {
      terms.push(`after:${filters.dateAfter.trim()}`);
    }
    if (filters?.dateOn?.trim()) {
      terms.push(`on:${filters.dateOn.trim()}`);
    }
    if (filters?.dateDuring?.trim()) {
      terms.push(`during:${filters.dateDuring.trim()}`);
    }
    if (filters?.threadsOnly) {
      terms.push("is:thread");
    }

    if (terms.length === 0) {
      throw new Error(
        "Provide at least one search term or filter for slack_search_messages.",
      );
    }

    return terms.join(" ");
  }

  private async resolveChannelSearchTerm(
    input?: string,
  ): Promise<string | undefined> {
    const value = input?.trim();
    if (!value) {
      return undefined;
    }

    const channel = await this.lookupConversationById(value);
    if (channel?.name) {
      return channel.type === "channel" ? `#${channel.name}` : channel.name;
    }

    return value.startsWith("#") ? value : `#${value}`;
  }

  private async resolveDmOrMpimSearchTerm(
    input?: string,
  ): Promise<string | undefined> {
    const value = input?.trim();
    if (!value) {
      return undefined;
    }

    const conversation = await this.lookupConversationById(value);
    if (!conversation) {
      return value;
    }

    if (conversation.type === "im") {
      await this.loadDmChannelCache();
      const userId = [...this.dmChannelCache.entries()].find(
        ([, channelId]) => channelId === conversation.id,
      )?.[0];
      if (!userId) {
        return value;
      }

      const user = await this.lookupUserEntity(userId, false);
      return user?.username ? `@${user.username}` : value;
    }

    return conversation.name ?? value;
  }

  private async resolveUserSearchTerm(
    input?: string,
  ): Promise<string | undefined> {
    const value = input?.trim();
    if (!value) {
      return undefined;
    }

    const looksLikeUserId = /^[UW][A-Z0-9]+$/i.test(value);
    if (looksLikeUserId) {
      const user = await this.lookupUserEntity(value, false);
      if (user?.username) {
        return `@${user.username}`;
      }
    }

    return value.startsWith("@") ? value : `@${value}`;
  }

  private async normalizeSearchMessage(
    message: SlackSearchMessageLike,
  ): Promise<MessageSearchResult> {
    const rawChannel = message.channel;
    const channelId = rawChannel?.id?.trim() || "unknown";
    const channel =
      rawChannel != null
        ? this.normalizeChannel(rawChannel)
        : ((await this.lookupConversationById(channelId)) ??
          ({
            id: channelId,
            type: "unknown",
            flags: {
              private: false,
              dm: false,
              mpim: false,
              archived: false,
            },
          } as Channel));
    this.channelCache.set(channel.id, channel);

    const sender =
      typeof message.user === "string" && message.user.trim()
        ? await this.lookupUserEntity(message.user.trim(), false)
        : undefined;
    const text = message.text ?? "";

    return {
      id: `${channel.id}:${message.ts ?? "unknown"}`,
      ts: message.ts ?? "",
      thread_ts: message.thread_ts,
      text,
      channel,
      sender,
      timestamp: this.timestampFromSlackTs(message.ts),
      subtype: message.subtype,
      attachments: await this.downloadAttachments(message.files ?? []),
      links: this.extractLinks(text),
      permalink: message.permalink,
      score: message.score,
    };
  }

  private normalizeUser(user: SlackUserLike, asBot: boolean): Entity {
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

  private normalizeChannel(conversation: SlackConversationLike): Channel {
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
    const attachments = await this.downloadAttachments(event.files ?? []);

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

  private async downloadAttachments(files: SlackFileLike[]): Promise<string[]> {
    const paths = await Promise.all(
      files.map((file) => saveSlackFile(file, this.token)),
    );
    return paths.filter((path): path is string => Boolean(path));
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

function parsePermissionActionValue(
  value: string | undefined,
): PermissionDecision | null {
  if (!value) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const data = parsed as { requestId?: unknown; optionId?: unknown };
  const requestId =
    typeof data.requestId === "string"
      ? data.requestId.trim().toLowerCase()
      : "";
  const optionId =
    typeof data.optionId === "string" ? data.optionId.trim().toLowerCase() : "";
  if (!requestId || !optionId) {
    return null;
  }
  const behavior = toBehavior(optionId);
  if (!behavior) {
    return null;
  }
  return { requestId, behavior };
}

function toBehavior(value: string): ChannelPermissionBehavior | null {
  if (value === "allow_once") {
    return "allow_once";
  }
  if (value === "allow_always" || value === "allow-always") {
    return "allow_always";
  }
  if (value === "deny") {
    return "deny";
  }
  return null;
}
