import { loadConfig } from "./config.js";
import { OpencodeSession } from "./opencode.js";
import { SerialQueue } from "./queue.js";
import { TelegramBridge } from "./telegram.js";
import { GmailBridge } from "./gmail.js";
import { initDatabase } from "./db.js";

async function main(): Promise<void> {
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

  await Promise.all(launches);
}

main().catch((error) => {
  console.error("[app] startup failed", error);
  process.exit(1);
});
