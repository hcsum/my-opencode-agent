import { loadConfig } from "./config.js";
import { OpencodeSession } from "./opencode.js";
import { SerialQueue } from "./queue.js";
import { TelegramBridge } from "./telegram.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const queue = new SerialQueue();
  const opencode = new OpencodeSession(config);
  await opencode.healthcheck();

  const bridge = new TelegramBridge(config, opencode, queue);
  await bridge.launch();
}

main().catch((error) => {
  console.error("[app] startup failed", error);
  process.exit(1);
});
