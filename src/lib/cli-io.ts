import process from "node:process";
import type { Connection } from "./slack/types.js";

export class CliIO {
  constructor(
    private readonly stdout: NodeJS.WriteStream = process.stdout,
    private readonly stderr: NodeJS.WriteStream = process.stderr,
  ) {}

  line(message: string): void {
    this.stdout.write(`${message}\n`);
  }

  error(message: string): void {
    this.stderr.write(`${message}\n`);
  }

  info(info: Connection): void {
    this.line(`Connection status: ${info.status}`);
    if (info.self?.username) {
      this.line(`Slack username: @${info.self.username}`);
    }
  }
}
