import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Entity, Message } from "./types.js";
import type { SlackSession } from "./session.js";

export interface MessageChannelEvent {
  source: "slack";
  self: Entity;
  message: Message;
  text: string;
}

export class SlackChannel {
  private unsubscribe?: () => void;
  private self?: Entity;

  constructor(
    private readonly session: SlackSession,
    private readonly mcp: Server,
    private readonly channel: string,
  ) {}

  async start(): Promise<void> {
    this.unsubscribe = this.session.on("message", (message) => {
      void this.publish(message);
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
    this.unsubscribe?.();
    this.unsubscribe = undefined;
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
          },
        },
      } as never);
    } catch {
      // Ignore closed transport or unsupported client errors.
    }
  }
}
