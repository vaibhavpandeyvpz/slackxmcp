export type Entity = {
  id: string;
  username?: string;
  name?: string;
  type: "bot" | "user";
};

export type Channel = {
  id: string;
  name?: string;
  type: "channel" | "group" | "im" | "mpim" | "unknown";
  topic?: string;
  purpose?: string;
  flags: {
    private: boolean;
    dm: boolean;
    mpim: boolean;
    archived: boolean;
  };
  member_count?: number;
};

export type Connection = {
  profile: {
    env: string;
    appEnv: string;
  };
  status: "idle" | "starting" | "connected" | "disconnected";
  device: {
    library: "@slack/bolt";
    mode: "socket_mode";
  };
  self?: Entity;
};

export type LookupResult = {
  q: string;
  id?: string;
  name?: string;
  type?: Channel["type"];
  found: boolean;
};

export type MessageReference = {
  channel_id: string;
  ts: string;
  thread_ts?: string;
};

export type SlackAttachment = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private_download?: string;
};

export type Message = {
  id: string;
  ts: string;
  thread_ts?: string;
  text: string;
  channel: Channel;
  sender?: Entity;
  timestamp: string;
  subtype?: string;
  attachments: SlackAttachment[];
  links: string[];
};
