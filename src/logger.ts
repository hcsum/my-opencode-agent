import fs from "node:fs";
import path from "node:path";
import util from "node:util";

const LOG_PATH = path.join(".data", "bridge.runtime.log");

export function setupFileLogging(): void {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

  const stream = fs.createWriteStream(LOG_PATH, { flags: "a" });
  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };

  const writeLine = (level: string, args: unknown[]) => {
    const line = `${new Date().toISOString()} ${level} ${util.format(...args)}\n`;
    stream.write(line);
  };

  console.log = (...args: unknown[]) => {
    original.log(...args);
    writeLine("[log]", args);
  };

  console.info = (...args: unknown[]) => {
    original.info(...args);
    writeLine("[info]", args);
  };

  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    writeLine("[warn]", args);
  };

  console.error = (...args: unknown[]) => {
    original.error(...args);
    writeLine("[error]", args);
  };

  process.on("warning", (warning) => {
    writeLine("[warning]", [warning.stack || warning.message]);
  });
}

export function getRuntimeLogPath(): string {
  return LOG_PATH;
}
