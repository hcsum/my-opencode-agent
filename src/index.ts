import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import { ExecutionSlot } from "./execution-slot.js";
import { OpencodeSession } from "./opencode.js";
import { PublicEventPublisher } from "./public-activity.js";
import { SerialQueue } from "./queue.js";
import { GmailBridge } from "./gmail.js";
import { initDatabase } from "./db.js";
import { getRuntimeLogPath, setupFileLogging } from "./logger.js";
import { launchScheduler, type Scheduler } from "./scheduler/index.js";

const BRIDGE_PROCESS_MARKERS = ["src/index.ts", "dist/index.js"];

setupFileLogging();
console.log(`[app] runtime log file: ${getRuntimeLogPath()}`);

async function main(): Promise<void> {
  const releaseLock = acquireInstanceLock();
  const config = loadConfig();
  const publicActivity = new PublicEventPublisher(
    config.publicActivityDir,
    config.publicActivityMaxEvents,
    {
      commitSha: config.deployCommitSha,
      runId: config.deployRunId,
      actor: config.deployActor,
      deployedAt: config.deployedAt,
    },
  );
  const executionSlot = new ExecutionSlot();
  initDatabase();
  const queue = new SerialQueue(publicActivity);
  const opencode = new OpencodeSession(config, publicActivity);
  await opencode.healthcheck();
  publicActivity.setIdleIfNoActiveRuns();

  const launches: Promise<void>[] = [];
  let scheduler: Scheduler | undefined;

  if (config.agentInboxEmail) {
    const bridge = new GmailBridge(
      config,
      opencode,
      queue,
      publicActivity,
      executionSlot,
    );
    launches.push(
      bridge.launch().catch((err) => console.error("[gmail] failed to start", err)),
    );
    launches.push(
      launchScheduler({
        config,
        opencode,
        queue,
        bridge,
        publicActivity,
        executionSlot,
      })
        .then((s) => {
          scheduler = s;
        })
        .catch((err) => console.error("[scheduler] failed to start", err)),
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
    void scheduler?.stop();
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
  if (process.env.BRIDGE_DISABLE_LOCK === "true") {
    return () => {};
  }

  const lockPath = path.join(".data", "bridge.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }), "utf8");
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
    if (activePid && isBridgeProcessAlive(activePid)) {
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
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as { pid?: unknown };
      return typeof parsed.pid === "number" && Number.isInteger(parsed.pid)
        ? parsed.pid
        : undefined;
    }
    const pid = Number(raw);
    return Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isBridgeProcessAlive(pid: number): boolean {
  if (!isPidAlive(pid)) return false;

  const cmdline = readProcessCommandLine(pid);
  if (!cmdline) return true;
  return BRIDGE_PROCESS_MARKERS.some((marker) => cmdline.includes(marker));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readProcessCommandLine(pid: number): string | undefined {
  if (process.platform !== "linux") return undefined;

  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
  } catch {
    return undefined;
  }
}
