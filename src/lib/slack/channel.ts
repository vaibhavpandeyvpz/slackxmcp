import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Entity, Message, PermissionDecision } from "./types.js";
import type { SlackSession } from "./session.js";

export interface MessageChannelEvent {
  source: "slack";
  self: Entity;
  message: Message;
  text: string;
}

export class SlackChannel {
  private unsubscribe1?: () => void;
  private unsubscribe2?: () => void;
  private self?: Entity;

  constructor(
    private readonly session: SlackSession,
    private readonly mcp: Server,
    private readonly channel: string,
  ) {}

  async start(): Promise<void> {
    this.unsubscribe1 = this.session.on("message", (message) => {
      void this.publish(message);
    });
    this.unsubscribe2 = this.session.on("permission", (decision) => {
      void this.publishPermission(decision);
    });

    if (this.session.client) {
      this.self = await this.session.getMe();
    }

    const onclose = this.mcp.onclose;
    this.mcp.onclose = () => {
      this.stop();
      onclose?.();
    };
  }

  private stop(): void {
    this.unsubscribe1?.();
    this.unsubscribe1 = undefined;
    this.unsubscribe2?.();
    this.unsubscribe2 = undefined;
  }

  private async publish(message: Message): Promise<void> {
    try {
      this.self ??= await this.session.getMe();
      const event: MessageChannelEvent = {
        source: "slack",
        self: this.self,
        message,
        text: message.text,
      };

      await this.mcp.notification({
        method: `notifications/${this.channel}`,
        params: {
          content: JSON.stringify(event),
          meta: {
            source: "slack",
            user: event.message.sender?.id,
            session: event.message.channel.id,
            thread: event.message.thread_ts ?? event.message.ts,
          },
        },
      } as never);
    } catch {
      // Ignore closed transport or unsupported client errors.
    }
  }

  private async publishPermission(decision: PermissionDecision): Promise<void> {
    await this.mcp.notification({
      method: "notifications/hooman/channel/permission",
      params: {
        request_id: decision.requestId,
        behavior: decision.behavior,
      },
    } as never);
  }
}
