import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { google } from "googleapis";

const CREDENTIALS_DIR = path.join(os.homedir(), ".gdrive-backup");
const KEYS_PATH = path.join(CREDENTIALS_DIR, "gcp-oauth.keys.json");
const TOKENS_PATH = path.join(CREDENTIALS_DIR, "credentials.json");
const DRIVE_SCOPE = ["https://www.googleapis.com/auth/drive"];

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
  if (!fs.existsSync(KEYS_PATH)) {
    throw new Error(`Missing OAuth keys file: ${KEYS_PATH}`);
  }

  const raw = JSON.parse(fs.readFileSync(KEYS_PATH, "utf8")) as OAuthKeysFile;
  const client = raw.installed || raw.web;
  if (!client) {
    throw new Error(`Invalid OAuth keys file: ${KEYS_PATH}`);
  }

  const redirectUri = pickRedirectUri(client.redirect_uris || []);
  const redirectUrl = new URL(redirectUri);
  const port = Number(redirectUrl.port || 80);

  const oauth2Client = new google.auth.OAuth2(
    client.client_id,
    client.client_secret,
    redirectUri,
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: DRIVE_SCOPE,
  });

  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });

  console.log("Open this URL in your browser:");
  console.log(authUrl);

  const code = await waitForOAuthCode(port, redirectUrl.pathname || "/");
  const tokenResponse = await oauth2Client.getToken(code);

  if (!tokenResponse.tokens.access_token && !tokenResponse.tokens.refresh_token) {
    throw new Error("Google OAuth succeeded but returned no usable tokens");
  }

  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokenResponse.tokens, null, 2), "utf8");

  console.log(`Saved Google Drive credentials to ${TOKENS_PATH}`);
}

function pickRedirectUri(uris: string[]): string {
  const loopbackUri = uris.find((value) => {
    try {
      const url = new URL(value);
      return url.hostname === "127.0.0.1" || url.hostname === "localhost";
    } catch {
      return false;
    }
  });

  if (!loopbackUri) {
    throw new Error(
      "OAuth client must include a localhost or 127.0.0.1 redirect URI for local auth",
    );
  }

  return loopbackUri;
}

function waitForOAuthCode(port: number, expectedPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Google OAuth callback after 5 minutes"));
    }, 5 * 60 * 1000);

    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${port}`);
        if (requestUrl.pathname !== expectedPath) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        if (error) {
          clearTimeout(timeout);
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end(`Google OAuth failed: ${error}`);
          server.close();
          reject(new Error(`Google OAuth failed: ${error}`));
          return;
        }

        const code = requestUrl.searchParams.get("code");
        if (!code) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("Missing OAuth code");
          return;
        }

        clearTimeout(timeout);
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("Google Drive auth completed. You can close this tab.");
        server.close();
        resolve(code);
      } catch (error) {
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(port, "127.0.0.1");
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
