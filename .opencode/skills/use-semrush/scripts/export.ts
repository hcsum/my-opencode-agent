#!/usr/bin/env npx tsx

import * as fs from "node:fs";
import * as path from "node:path";
import {
  closeBackgroundTab,
  evalInTab,
  getTabInfo,
  openBackgroundTab,
  runScript,
  ScriptResult,
} from "./lib/browser.js";

interface ExportInput {
  action: "export";
  domain: string;
}

type Input = ExportInput;

const PAGE_SETTLE_MS = 5000;
const POLL_INTERVAL_MS = 2000;
const DOWNLOAD_WAIT_MS = 60000;
const DOWNLOAD_POLL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRefDomainsPage(targetId: string): Promise<void> {
  await evalInTab(targetId, "document.body.innerText.slice(0, 100)");
  await sleep(PAGE_SETTLE_MS);

  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    const info = await getTabInfo(targetId);
    const state = await evalInTab<{
      text: string;
      hasTable: boolean;
      hasLogin: boolean;
    }>(
      targetId,
      `(() => {
        const text = (document.body.innerText || "").slice(0, 2000);
        const hasTable = document.querySelectorAll("table tbody tr").length > 0 ||
          document.querySelectorAll("[class*='row']").length > 0;
        const hasLogin = text.includes("登录") && text.includes("密码");
        return { text, hasTable, hasLogin };
      })()`,
    );

    const text = state.text.toLowerCase();
    const hasCfChallenge =
      text.includes("cloudflare") ||
      text.includes("checking your browser") ||
      text.includes("verify you are human");

    if (state.hasLogin) {
      throw new Error("Login required. Please log in to sem.3ue.co first.");
    }

    if (info.ready === "complete" && !hasCfChallenge && state.hasTable) {
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function waitForDownload(downloadDir: string): Promise<string | null> {
  const existingFiles = new Set(fs.readdirSync(downloadDir));

  const deadline = Date.now() + DOWNLOAD_WAIT_MS;

  while (Date.now() < deadline) {
    try {
      const files = fs.readdirSync(downloadDir);
      const newFiles = files.filter((f) => !existingFiles.has(f));
      const csvFile = newFiles.find(
        (f) => f.endsWith(".csv") || f.endsWith(".xlsx"),
      );

      if (csvFile) {
        return path.join(downloadDir, csvFile);
      }
    } catch {
      // downloadDir might not exist yet
    }

    await sleep(DOWNLOAD_POLL_MS);
  }

  return null;
}

async function handleExport(domain: string): Promise<ScriptResult> {
  if (!domain || domain.trim().length === 0) {
    return { success: false, message: "Domain is required" };
  }

  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  const pageUrl = `https://sem.3ue.co/analytics/refdomains/report/?q=${encodeURIComponent(cleanDomain)}&searchType=domain`;

  const targetId = await openBackgroundTab(pageUrl);

  try {
    await waitForRefDomainsPage(targetId);

    // Give the export button a unique ID, then click it
    await evalInTab(
      targetId,
      `(() => {
        const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "导出");
        if (btn) { btn.id = "sem-export-main"; return true; }
        return false;
      })()`,
    );

    const btnFound = await evalInTab<boolean>(
      targetId,
      "!!document.getElementById('sem-export-main')",
    );

    if (!btnFound) {
      return {
        success: false,
        message: "Export button not found on the page",
        data: { domain: cleanDomain, pageUrl },
      };
    }

    // Step 1: click "导出" to open the dropdown
    await evalInTab(
      targetId,
      `(() => {
        const btn = document.getElementById("sem-export-main");
        btn.scrollIntoView();
        btn.click();
      })()`,
    );

    await sleep(1500);

    // Step 2: find and click "CSV" in the dropdown
    const csvClicked = await evalInTab<boolean>(
      targetId,
      `(() => {
        const allEls = document.querySelectorAll("button, a, [role=menuitem], [role=option], li, div");
        const csvBtn = Array.from(allEls).find(el => {
          const t = el.textContent.trim();
          return t === "CSV" && el.offsetParent !== null;
        });
        if (csvBtn) {
          csvBtn.id = "sem-export-csv";
          csvBtn.click();
          return true;
        }
        return false;
      })()`,
    );

    if (!csvClicked) {
      return {
        success: false,
        message: "CSV option not found after clicking export. The dropdown may not have appeared.",
        data: { domain: cleanDomain },
      };
    }

    // Step 3: wait for download
    const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
    const downloadDir = path.join(homeDir, "Downloads");

    let downloadedFile: string | null = null;

    if (fs.existsSync(downloadDir)) {
      downloadedFile = await waitForDownload(downloadDir);
    }

    if (!downloadedFile) {
      return {
        success: false,
        message: "Download did not complete within timeout",
        data: { domain: cleanDomain },
      };
    }

    // Step 4: move file to notes/backlinks/{domain}.csv
    const outputDir = path.resolve("notes/backlinks");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `${cleanDomain}.csv`);

    fs.copyFileSync(downloadedFile, outputPath);
    fs.unlinkSync(downloadedFile);

    return {
      success: true,
      message: `Exported backlinks for ${cleanDomain} to ${outputPath}`,
      data: {
        domain: cleanDomain,
        outputPath,
      },
    };
  } catch (e) {
    return {
      success: false,
      message: `Export failed: ${e instanceof Error ? e.message : String(e)}`,
      data: { domain: cleanDomain },
    };
  } finally {
    if (targetId) {
      await sleep(2000);
      await closeBackgroundTab(targetId);
    }
  }
}

async function handleBrowse(input: Input): Promise<ScriptResult> {
  switch (input.action) {
    case "export":
      return handleExport(input.domain);

    default:
      return {
        success: false,
        message: `Unknown action: ${(input as Input).action}. Use "export".`,
      };
  }
}

runScript<Input>(handleBrowse);
