import React from "react";
import { render } from "ink";
import { loadSlackConfig, saveSlackConfig } from "../lib/slack/config.js";
import { ConfigureApp } from "./app.js";

export async function configure(): Promise<void> {
  const initial = await loadSlackConfig();
  let done = false;
  const { waitUntilExit, unmount } = render(
    <ConfigureApp
      initial={initial}
      onSave={async (config) => {
        await saveSlackConfig(config);
      }}
      onExit={() => {
        done = true;
      }}
    />,
    { exitOnCtrlC: false },
  );

  try {
    await waitUntilExit();
  } finally {
    if (!done) {
      unmount();
    }
  }
}
