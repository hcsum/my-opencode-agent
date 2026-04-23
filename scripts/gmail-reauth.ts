import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";

import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

interface OAuthInstalledConfig {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

interface OAuthRoot {
  installed?: OAuthInstalledConfig;
  web?: OAuthInstalledConfig;
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

async function main(): Promise<void> {
  const proxy = process.env.GMAIL_PROXY?.trim();
  if (proxy) {
    process.env.HTTP_PROXY = proxy;
    process.env.HTTPS_PROXY = proxy;
    process.env.ALL_PROXY = proxy;
    console.log(`[reauth] using proxy ${proxy}`);
  }

  const credDir = path.join(os.homedir(), ".gmail-mcp");
  const keysPath = path.join(credDir, "gcp-oauth.keys.json");
  const tokensPath = path.join(credDir, "credentials.json");

  if (!fs.existsSync(keysPath)) {
    throw new Error(`Missing OAuth client keys: ${keysPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(keysPath, "utf8")) as OAuthRoot;
  const installed = parsed.installed || parsed.web;
  if (!installed) {
    throw new Error("Invalid OAuth keys file: expected installed or web block");
  }

  const redirectUri = installed.redirect_uris?.[0] || "http://localhost";
  const oauth2Client = new google.auth.OAuth2(
    installed.client_id,
    installed.client_secret,
    redirectUri,
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("\nOpen this URL and complete authorization:\n");
  console.log(authUrl);
  console.log("\nPaste the `code` query value from the callback URL.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const code = (await rl.question("Authorization code: ")).trim();
    if (!code) {
      throw new Error("No authorization code provided");
    }

    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      console.warn(
        "[reauth] no refresh_token returned; keeping existing refresh_token if present",
      );
      if (fs.existsSync(tokensPath)) {
        const existing = JSON.parse(fs.readFileSync(tokensPath, "utf8")) as {
          refresh_token?: string;
        };
        if (existing.refresh_token) {
          tokens.refresh_token = existing.refresh_token;
        }
      }
    }

    fs.mkdirSync(credDir, { recursive: true });
    fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), "utf8");

    console.log(`\n[reauth] wrote updated credentials to ${tokensPath}`);
    console.log("[reauth] now run: npm run start:gmail");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[reauth] failed: ${message}`);
  process.exit(1);
});
