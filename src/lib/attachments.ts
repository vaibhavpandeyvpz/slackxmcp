import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { attachmentsRoot } from "./paths.js";

type SlackDownloadableFile = {
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  url_private_download?: string;
};

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\]/g, "_").slice(0, 200) || "file";
}

function extensionForMimeType(mimeType?: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "video/mp4":
      return ".mp4";
    case "audio/mpeg":
      return ".mp3";
    case "audio/ogg":
      return ".ogg";
    case "application/pdf":
      return ".pdf";
    default:
      return "";
  }
}

export async function saveSlackFile(
  file: SlackDownloadableFile,
  token: string,
): Promise<string | undefined> {
  const url = file.url_private_download?.trim();
  if (!url) {
    return undefined;
  }

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      return undefined;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const rawName = file.name ?? file.title ?? `attachment-${Date.now()}`;
    const safeName = extname(rawName)
      ? sanitizeFilename(rawName)
      : sanitizeFilename(rawName) + extensionForMimeType(file.mimetype);
    const root = attachmentsRoot();
    await mkdir(root, { recursive: true });
    const localPath = join(root, `${randomUUID()}-${safeName}`);
    await writeFile(localPath, buffer);
    return localPath;
  } catch {
    return undefined;
  }
}
