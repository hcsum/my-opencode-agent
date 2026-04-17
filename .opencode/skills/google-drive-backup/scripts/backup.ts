import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const CREDENTIALS_DIR = path.join(os.homedir(), ".gdrive-backup");
const KEYS_PATH = path.join(CREDENTIALS_DIR, "gcp-oauth.keys.json");
const TOKENS_PATH = path.join(CREDENTIALS_DIR, "credentials.json");
const DRIVE_SCOPE = ["https://www.googleapis.com/auth/drive"];

interface BackupInput {
  folderId?: string;
  sourceDir?: string;
  versionLabel?: string;
}

interface UploadResult {
  path: string;
  fileId: string;
}

interface OAuthKeysFile {
  installed?: OAuthClientConfig;
  web?: OAuthClientConfig;
}

interface OAuthClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

async function main(): Promise<void> {
  const input = await readInput();
  const folderId =
    input.folderId?.trim() || process.env.GDRIVE_NOTES_BACKUP_FOLDER_ID?.trim();

  if (!folderId) {
    throw new Error(
      "Missing target Drive folder ID. Pass folderId in stdin JSON or set GDRIVE_NOTES_BACKUP_FOLDER_ID.",
    );
  }

  const sourceDir = path.resolve(input.sourceDir?.trim() || "notes");
  const sourceRootName = path.basename(sourceDir);

  const sourceStats = await fsp.stat(sourceDir).catch(() => null);
  if (!sourceStats || !sourceStats.isDirectory()) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const drive = await createDriveClient();
  const versionFolderName =
    input.versionLabel?.trim() || new Date().toISOString().replace(/[:]/g, "-");

  const versionFolderId = await createFolder(drive, versionFolderName, folderId);
  const sourceFolderId = await createFolder(drive, sourceRootName, versionFolderId);
  const files = await listFiles(sourceDir);
  const uploaded: UploadResult[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(sourceDir, filePath);
    const parentId = await ensureDriveFolders(
      drive,
      sourceFolderId,
      path.dirname(relativePath),
    );
    const fileId = await uploadFile(
      drive,
      parentId,
      path.basename(filePath),
      filePath,
    );

    uploaded.push({
      path: path.posix.join(sourceRootName, toPosixPath(relativePath)),
      fileId,
    });
  }

  console.log(
    JSON.stringify(
      {
        folderId: versionFolderId,
        folderName: versionFolderName,
        fileCount: uploaded.length,
        files: uploaded,
      },
      null,
      2,
    ),
  );
}

async function readInput(): Promise<BackupInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }

  return JSON.parse(text) as BackupInput;
}

async function createDriveClient() {
  if (!fs.existsSync(KEYS_PATH) || !fs.existsSync(TOKENS_PATH)) {
    throw new Error(
      `Missing Google Drive OAuth files in ${CREDENTIALS_DIR}. Run auth.ts first.`,
    );
  }

  const raw = JSON.parse(await fsp.readFile(KEYS_PATH, "utf8")) as OAuthKeysFile;
  const client = raw.installed || raw.web;
  if (!client) {
    throw new Error(`Invalid OAuth keys file: ${KEYS_PATH}`);
  }

  const redirectUri = client.redirect_uris?.[0] || "http://localhost";
  const oauth2Client = new google.auth.OAuth2(
    client.client_id,
    client.client_secret,
    redirectUri,
  );

  const tokens = JSON.parse(await fsp.readFile(TOKENS_PATH, "utf8"));
  oauth2Client.setCredentials(tokens);

  oauth2Client.on("tokens", async (newTokens) => {
    const updated = {
      ...tokens,
      ...newTokens,
    };
    await fsp.writeFile(TOKENS_PATH, JSON.stringify(updated, null, 2), "utf8");
  });

  return google.drive({ version: "v3", auth: oauth2Client });
}

async function listFiles(dirPath: string): Promise<string[]> {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (shouldSkip(entry.name)) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function shouldSkip(name: string): boolean {
  return [".git", "node_modules", "dist", ".DS_Store", ".env"].includes(name);
}

async function ensureDriveFolders(
  drive: ReturnType<typeof google.drive>,
  rootParentId: string,
  relativeDir: string,
): Promise<string> {
  if (relativeDir === "." || !relativeDir) {
    return rootParentId;
  }

  const parts = toPosixPath(relativeDir).split("/").filter(Boolean);
  let parentId = rootParentId;

  for (const part of parts) {
    parentId = await findOrCreateFolder(drive, part, parentId);
  }

  return parentId;
}

async function findOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string,
): Promise<string> {
  const escapedName = name.replace(/'/g, "\\'");
  const response = await drive.files.list({
    q: [
      `'${parentId}' in parents`,
      `name='${escapedName}'`,
      "mimeType='application/vnd.google-apps.folder'",
      "trashed=false",
    ].join(" and "),
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const existing = response.data.files?.[0]?.id;
  if (existing) {
    return existing;
  }

  return createFolder(drive, name, parentId);
}

async function createFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string,
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name,
      parents: [parentId],
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const id = response.data.id;
  if (!id) {
    throw new Error(`Failed to create Drive folder: ${name}`);
  }

  return id;
}

async function uploadFile(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
  fileName: string,
  filePath: string,
): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parentId],
    },
    media: {
      body: fs.createReadStream(filePath),
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const id = response.data.id;
  if (!id) {
    throw new Error(`Failed to upload file: ${filePath}`);
  }

  return id;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
