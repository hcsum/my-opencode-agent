import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import { OpencodeSession } from "./opencode.js";
import { SerialQueue } from "./queue.js";
import { TelegramBridge } from "./telegram.js";
import { GmailBridge } from "./gmail.js";
import { initDatabase } from "./db.js";

async function main(): Promise<void> {
  const releaseLock = acquireInstanceLock();
  const config = loadConfig();
  initDatabase();
  const queue = new SerialQueue();
  const opencode = new OpencodeSession(config);
  await opencode.healthcheck();

  const launches: Promise<void>[] = [];

  if (config.telegramBotToken !== "123456:replace-me") {
    launches.push(
      new TelegramBridge(config, opencode, queue)
        .launch()
        .catch((err) => console.error("[telegram] failed to start", err)),
    );
  } else {
    console.log("[telegram] skipped — placeholder bot token");
  }

  if (config.gmailTo) {
    launches.push(
      new GmailBridge(config, opencode, queue)
        .launch()
        .catch((err) => console.error("[gmail] failed to start", err)),
    );
  }

  try {
    await Promise.all(launches);
  } catch (error) {
    releaseLock();
    throw error;
  }

  const shutdown = () => {
    releaseLock();
  };

  process.once("exit", shutdown);
  process.once("SIGINT", () => {
    shutdown();
  });
  process.once("SIGTERM", () => {
    shutdown();
  });
}

main().catch((error) => {
  console.error("[app] startup failed", error);
  process.exit(1);
});

function acquireInstanceLock(): () => void {
  const lockPath = path.join(".data", "bridge.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, String(process.pid), "utf8");
    let released = false;

    return () => {
      if (released) return;
      released = true;
      fs.closeSync(fd);
      fs.rmSync(lockPath, { force: true });
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EEXIST") throw error;

    const activePid = readActivePid(lockPath);
    if (activePid && isPidAlive(activePid)) {
      throw new Error(
        `[app] bridge already running with pid ${activePid}; refusing second instance`,
      );
    }

    fs.rmSync(lockPath, { force: true });
    return acquireInstanceLock();
  }
}

function readActivePid(lockPath: string): number | undefined {
  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
