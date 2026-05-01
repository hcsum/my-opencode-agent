import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ProxyAgent, fetch as undiciFetch } from "undici";
import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

import type { AppConfig } from "./types.js";
import { SerialQueue } from "./queue.js";
import { OpencodeSession } from "./opencode.js";
import { WorkflowRunner } from "./workflow.js";
import {
  clearPendingPermission,
  getPendingPermission,
  isProcessed,
  markProcessed,
  releaseClaim,
  upsertPendingPermission,
  tryClaimMessage,
} from "./db.js";
import type { PendingPermissionRecord } from "./db.js";
import type { PermissionResponse, TurnOutcome } from "./opencode.js";

interface ThreadMeta {
  senderEmail: string;
  senderName: string;
  subject: string;
  messageId: string;
}

export class GmailBridge {
  private oauth2Client: OAuth2Client | null = null;
  private gmail: gmail_v1.Gmail | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly threadMeta = new Map<string, ThreadMeta>();
  private readonly workflow: WorkflowRunner;
  private consecutiveErrors = 0;
  private userEmail = "";

  constructor(
    private readonly config: AppConfig,
    private readonly opencode: OpencodeSession,
    private readonly queue: SerialQueue,
  ) {
    this.workflow = new WorkflowRunner(opencode, queue);
  }

  async launch(): Promise<void> {
    this.setupProxy();

    const credDir = path.join(os.homedir(), ".gmail-mcp");
    const keysPath = path.join(credDir, "gcp-oauth.keys.json");
    const tokensPath = path.join(credDir, "credentials.json");

    if (!fs.existsSync(keysPath) || !fs.existsSync(tokensPath)) {
      console.warn(
        "[gmail] skipping — missing credentials in ~/.gmail-mcp/",
      );
      return;
    }

    const keys = JSON.parse(fs.readFileSync(keysPath, "utf8"));
    const installed = keys.installed || keys.web;
    if (!installed) {
      console.warn("[gmail] skipping — invalid OAuth keys file");
      return;
    }

    const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));

    this.oauth2Client = new google.auth.OAuth2(
      installed.client_id,
      installed.client_secret,
      installed.redirect_uris?.[0] || "http://localhost",
    );

    this.oauth2Client.setCredentials(tokens);

    this.oauth2Client.on("tokens", (newTokens) => {
      const updated = {
        ...tokens,
        ...newTokens,
      };
      fs.writeFileSync(tokensPath, JSON.stringify(updated, null, 2), "utf8");
      console.log("[gmail] refreshed OAuth tokens");
    });

    this.gmail = google.gmail({ version: "v1", auth: this.oauth2Client });

    let profile;
    try {
      profile = await this.gmail.users.getProfile({ userId: "me" });
    } catch (error) {
      if (isRevokedRefreshTokenError(error)) {
        console.error(
          "[gmail] OAuth refresh token expired or revoked. Run `npx tsx scripts/gmail-reauth.ts` to reconnect Gmail.",
        );
        return;
      }
      throw error;
    }

    this.userEmail = profile.data.emailAddress || "";
    console.log(`[gmail] connected as ${this.userEmail}`);

    await this.pollForMessages();
    this.schedulePoll();

    console.log(
      `[gmail] polling every ${this.config.gmailPollIntervalMs}ms; to=${this.config.gmailTo}`,
    );
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.gmail = null;
    this.oauth2Client = null;
    console.log("[gmail] stopped");
  }

  private schedulePoll(): void {
    const backoffMs =
      this.consecutiveErrors > 0
        ? Math.min(
            this.config.gmailPollIntervalMs *
              Math.pow(2, this.consecutiveErrors),
            30 * 60 * 1000,
          )
        : this.config.gmailPollIntervalMs;

    this.pollTimer = setTimeout(() => {
      this.pollForMessages()
        .catch((err) => console.error("[gmail] poll error", err))
        .finally(() => {
          if (this.gmail) this.schedulePoll();
        });
    }, backoffMs);
  }

  private async pollForMessages(): Promise<void> {
    if (!this.gmail) return;

    const query = `to:${this.config.gmailTo} newer_than:3d`;
    console.log(`[gmail] polling: ${query}`);
    const res = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 10,
    });

    const messages = res.data.messages || [];

    let newCount = 0;
    for (const msg of messages) {
      if (!msg.id || isProcessed(msg.id)) continue;
      if (!tryClaimMessage(msg.id)) {
        console.log(`[gmail] skipped claimed message ${msg.id}`);
        continue;
      }
      newCount++;
      console.log(`[gmail] processing new message ${msg.id}`);
      try {
        await this.processMessage(msg.id);
      } catch (err) {
        releaseClaim(msg.id);
        console.error(`[gmail] failed to process message ${msg.id}`, err);
      }
    }

    console.log(
      `[gmail] poll result: ${messages.length} total, ${newCount} new`,
    );
    this.consecutiveErrors = 0;
  }

  private async processMessage(messageId: string): Promise<void> {
    if (!this.gmail) return;

    const startedAt = Date.now();

    const res = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
    console.log(`[gmail] fetched ${messageId} in ${Date.now() - startedAt}ms`);

    const message = res.data;
    const headers = message.payload?.headers || [];
    const threadId = message.threadId || messageId;

    const fromHeader =
      headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
    const subject =
      headers.find((h) => h.name?.toLowerCase() === "subject")?.value ||
      "(no subject)";
    const rfcMessageId =
      headers.find((h) => h.name?.toLowerCase() === "message-id")?.value || "";

    const { name: senderName, email: senderEmail } = parseFromHeader(
      fromHeader,
    );

    const body = this.extractTextBody(message.payload) || "";

    this.threadMeta.set(threadId, {
      senderEmail,
      senderName,
      subject,
      messageId: rfcMessageId,
    });

    const textBody = stripQuotedReply(body).trim() || subject;
    const content = `[Email from ${senderName} <${senderEmail}>]\nSubject: ${subject}\n\n${textBody}`;

    const pendingPermission = getPendingPermission(threadId);
    if (pendingPermission) {
      await this.handlePendingPermission({
        messageId,
        threadId,
        textBody,
        pendingPermission,
      });
      return;
    }

    console.log(
      `[gmail] enqueue from=${senderName} <${senderEmail}> subject=${subject}`,
    );

    try {
      const queuedAt = Date.now();
      const workflowCommand = this.workflow.parse(textBody);
      const result = workflowCommand
        ? await this.workflow.run({
            command: workflowCommand,
            sourceChannel: "gmail",
            sourceSession: threadId,
            senderName,
            chatTitle: subject,
            timestamp: new Date(
              parseInt(message.internalDate || String(Date.now()), 10),
            ),
          })
        : await this.queue.enqueue(
            `gmail from=${senderEmail} subject=${subject}`,
            async () => {
              const opencodeStartedAt = Date.now();
              const response = await this.opencode.sendTurnWithApproval("gmail", {
                text: content,
                senderName,
                chatTitle: subject,
                timestamp: new Date(
                  parseInt(message.internalDate || String(Date.now()), 10),
                ),
                sessionKey: `gmail:${threadId}`,
                sessionTitle: `Gmail ${subject}`,
              });
              console.log(
                `[gmail] opencode completed ${messageId} in ${Date.now() - opencodeStartedAt}ms`,
              );
              return response;
            },
          );

      console.log(
        `[gmail] queue+opencode completed ${messageId} in ${Date.now() - queuedAt}ms`,
      );

      await this.finishMessage(messageId, threadId, result, startedAt);
    } catch (err) {
      releaseClaim(messageId);
      console.error(`[gmail] failed to process/reply thread ${threadId}`, err);
      throw err;
    }

    markProcessed(messageId, threadId, subject, senderEmail);
  }

  private async handlePendingPermission(params: {
    messageId: string;
    threadId: string;
    textBody: string;
    pendingPermission: PendingPermissionRecord;
  }): Promise<void> {
    const decision = parsePermissionResponse(params.textBody);

    if (!decision) {
      await this.sendReply(
        params.threadId,
        buildPermissionPrompt(params.pendingPermission, true),
      );
      await this.markRead(params.messageId);
      return;
    }

    const outcome = await this.queue.enqueue(
      `gmail permission ${params.pendingPermission.permissionId}`,
      () =>
        this.opencode.resolvePermission(
          params.pendingPermission.sessionId,
          params.pendingPermission.permissionId,
          params.pendingPermission.messageId,
          decision,
        ),
    );

    await this.finishMessage(params.messageId, params.threadId, outcome, Date.now());
  }

  private async finishMessage(
    messageId: string,
    threadId: string,
    outcome: TurnOutcome | string,
    startedAt: number,
  ): Promise<void> {
    const replyStartedAt = Date.now();

    if (typeof outcome === "string") {
      clearPendingPermission(threadId);
      await this.sendReply(threadId, outcome);
    } else if (outcome.kind === "completed") {
      clearPendingPermission(threadId);
      await this.sendReply(threadId, outcome.text);
    } else {
      upsertPendingPermission({
        threadId,
        sessionId: outcome.permission.sessionId,
        permissionId: outcome.permission.permissionId,
        messageId: outcome.permission.messageId,
        title: outcome.permission.title,
        type: outcome.permission.type,
        pattern: outcome.permission.pattern,
      });
      await this.sendReply(threadId, buildPermissionPrompt(outcome.permission));
    }

    console.log(
      `[gmail] reply sent ${messageId} in ${Date.now() - replyStartedAt}ms`,
    );

    const markReadStartedAt = Date.now();
    await this.markRead(messageId);
    console.log(
      `[gmail] marked read ${messageId} in ${Date.now() - markReadStartedAt}ms`,
    );
    console.log(
      `[gmail] replied to thread ${threadId} total=${Date.now() - startedAt}ms`,
    );
  }

  private extractTextBody(
    payload: gmail_v1.Schema$MessagePart | undefined,
  ): string {
    if (!payload) return "";

    if (
      payload.mimeType === "text/plain" &&
      payload.body?.data
    ) {
      return Buffer.from(payload.body.data, "base64url").toString("utf8");
    }

    if (payload.parts?.length) {
      for (const part of payload.parts) {
        const text = this.extractTextBody(part);
        if (text) return text;
      }
    }

    return "";
  }

  private async sendReply(
    threadId: string,
    text: string,
  ): Promise<void> {
    if (!this.gmail) return;

    const meta = this.threadMeta.get(threadId);
    if (!meta) {
      console.warn(`[gmail] no meta for thread ${threadId}, skipping reply`);
      return;
    }

    const subject = meta.subject.startsWith("Re:")
      ? meta.subject
      : `Re: ${meta.subject}`;

    const references = meta.messageId
      ? `In-Reply-To: ${meta.messageId}\r\nReferences: ${meta.messageId}\r\n`
      : "";

    const raw = [
      `To: ${meta.senderName} <${meta.senderEmail}>`,
      `Reply-To: ${this.config.gmailTo}`,
      `Subject: =?utf-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `${references}Content-Type: text/plain; charset=utf-8`,
      "",
      text,
    ].join("\r\n");

    const encoded = Buffer.from(raw).toString("base64url");

    await this.gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encoded,
        threadId,
      },
    });
  }

  private async markRead(messageId: string): Promise<void> {
    if (!this.gmail) return;

    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        removeLabelIds: ["UNREAD"],
      },
    });
  }

  private setupProxy(): void {
    const proxy =
      process.env.HTTPS_PROXY?.trim() ||
      process.env.https_proxy?.trim();

    if (!proxy) return;

    process.env.HTTPS_PROXY = proxy;

    const agent = new ProxyAgent(proxy);
    const origFetch = globalThis.fetch;

    globalThis.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url.includes("googleapis.com") || url.includes("google.com")) {
        return undiciFetch(input as Parameters<typeof undiciFetch>[0], {
          ...init,
          dispatcher: agent,
        } as Parameters<typeof undiciFetch>[1]) as Promise<Response>;
      }

      return origFetch(input, init);
    };

    console.log(`[gmail] using proxy ${proxy}`);
  }
}

function parseFromHeader(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, ""),
      email: match[2].trim(),
    };
  }
  if (from.includes("@")) {
    return { name: from, email: from };
  }
  return { name: from, email: from };
}

function stripQuotedReply(body: string): string {
  const normalized = body.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const kept: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === "--" || trimmed === "__") {
      break;
    }

    if (trimmed.startsWith(">")) {
      break;
    }

    if (isReplyHeader(trimmed)) {
      break;
    }

    kept.push(line);
  }

  return kept.join("\n").trim();
}

function isReplyHeader(line: string): boolean {
  if (!line) return false;

  return (
    /^On .+wrote:$/i.test(line) ||
    /^在.+写道：$/i.test(line) ||
    /^.+于.+写道：$/i.test(line) ||
    /^.+ wrote:$/i.test(line) ||
    /^-+Original Message-+$/i.test(line) ||
    /^-+ Forwarded message -+$/i.test(line) ||
    /^From:\s+/i.test(line) ||
    /^Sent:\s+/i.test(line) ||
    /^Date:\s+/i.test(line) ||
    /^Subject:\s+/i.test(line) ||
    /^To:\s+/i.test(line) ||
    /^发件人：/i.test(line) ||
    /^发送时间：/i.test(line) ||
    /^日期：/i.test(line) ||
    /^主题：/i.test(line) ||
    /^收件人：/i.test(line)
  );
}

function parsePermissionResponse(text: string): PermissionResponse | undefined {
  const normalized = text.trim().toUpperCase();

  if (
    normalized === "APPROVE" ||
    normalized.startsWith("APPROVE ") ||
    normalized === "ALLOW" ||
    normalized.startsWith("ALLOW ") ||
    normalized === "YES"
  ) {
    return "once";
  }

  if (normalized === "ALWAYS" || normalized.startsWith("ALWAYS ")) {
    return "always";
  }

  if (
    normalized === "REJECT" ||
    normalized.startsWith("REJECT ") ||
    normalized === "DENY" ||
    normalized.startsWith("DENY ") ||
    normalized === "NO"
  ) {
    return "reject";
  }

  return undefined;
}

function buildPermissionPrompt(
  permission: Pick<
    PendingPermissionRecord,
    "title" | "type" | "pattern"
  >,
  remindOnly = false,
): string {
  const lines = [
    remindOnly
      ? "This thread is waiting for your approval before I can continue."
      : "I need your approval before I can continue this request.",
    `Permission: ${permission.title || permission.type}`,
  ];

  if (permission.pattern) {
    lines.push(`Target: ${permission.pattern}`);
  }

  lines.push(
    "Reply with APPROVE to allow once, ALWAYS to remember this permission, or REJECT to deny it.",
  );

  return lines.join("\n");
}

function isRevokedRefreshTokenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const cause = "response" in error ? error.response : undefined;
  if (!cause || typeof cause !== "object") return false;

  const data = "data" in cause ? cause.data : undefined;
  if (!data || typeof data !== "object") return false;

  const grantError = "error" in data ? data.error : undefined;
  return grantError === "invalid_grant";
}
