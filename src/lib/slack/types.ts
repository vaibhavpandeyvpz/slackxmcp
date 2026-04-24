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

export type UserProfile = {
  user_id: string;
  username?: string;
  real_name?: string;
  display_name?: string;
  email?: string;
  title?: string;
  dm_channel_id?: string;
  type: "bot" | "user";
};

export type Connection = {
  status: "idle" | "starting" | "connected" | "disconnected";
  self?: Entity;
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

export type MessageSearchResult = Message & {
  permalink?: string;
  score?: number;
};

export type ChannelPermissionBehavior = "allow_once" | "allow_always" | "deny";

export type ChannelPermissionOption = {
  id: string;
  label: string;
};

export type PermissionDecision = {
  requestId: string;
  behavior: ChannelPermissionBehavior;
};
