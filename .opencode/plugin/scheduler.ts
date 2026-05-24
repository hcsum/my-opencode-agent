import { type Plugin, tool } from "@opencode-ai/plugin";

const z = tool.schema;

const PORT = Number(process.env.SCHEDULER_API_PORT) || 4097;
const BASE = `http://127.0.0.1:${PORT}/scheduler`;

async function callApi(
  op: string,
  body: Record<string, unknown> | undefined,
): Promise<string> {
  const method = body ? "POST" : "GET";
  const res = await fetch(`${BASE}/${op}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.error === "string") detail = parsed.error;
    } catch {
      /* keep raw text */
    }
    throw new Error(`scheduler ${op} failed (${res.status}): ${detail}`);
  }
  return text;
}

export const SchedulerPlugin: Plugin = async () => ({
  tool: {
    schedule_create: tool({
      description:
        "Create a scheduled task that will run autonomously on the given cadence. Use kind='cron' for recurring tasks (provide a 5-field POSIX cron expression like '0 8 * * 1-5'); use kind='once' for one-off tasks (provide an ISO 8601 runAt with timezone offset). The prompt is what the scheduler will send to Pikachū at fire time — write it as if the user themselves is asking. The summary is a short label shown in result emails. Returns the created task id and nextRunAt.",
      args: {
        kind: z.enum(["cron", "once"]).describe("'cron' for recurring or 'once' for one-off"),
        cron: z
          .string()
          .optional()
          .describe("POSIX 5-field cron expression, required when kind=cron"),
        runAt: z
          .string()
          .optional()
          .describe("ISO 8601 timestamp with timezone offset, required when kind=once"),
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone (e.g. 'America/Los_Angeles'). Falls back to USER_TIMEZONE env when omitted",
          ),
        prompt: z
          .string()
          .describe("Instruction sent to Pikachū at fire time (e.g. 'produce the morning report')"),
        summary: z
          .string()
          .describe("Short label used in result email subjects (e.g. 'Morning report')"),
      },
      async execute(args) {
        return callApi("create", args);
      },
    }),

    schedule_list: tool({
      description:
        "List all scheduled tasks (active and paused). Returns an array of tasks with their id, kind, schedule, prompt, summary, enabled flag, next run time, last run time, run count, and last status.",
      args: {},
      async execute() {
        return callApi("list", undefined);
      },
    }),

    schedule_delete: tool({
      description: "Permanently delete a scheduled task by its id.",
      args: { id: z.string().describe("Task id returned by schedule_create or schedule_list") },
      async execute(args) {
        return callApi("delete", args);
      },
    }),

    schedule_pause: tool({
      description:
        "Pause a scheduled task without deleting it. Paused tasks will not fire until resumed. Use this when the user wants to temporarily suppress a task.",
      args: { id: z.string() },
      async execute(args) {
        return callApi("pause", args);
      },
    }),

    schedule_resume: tool({
      description:
        "Resume a paused scheduled task. Recomputes the next fire time from now (does not back-fill missed runs).",
      args: { id: z.string() },
      async execute(args) {
        return callApi("resume", args);
      },
    }),

    schedule_run_now: tool({
      description:
        "Fire a scheduled task immediately, ignoring its scheduled cadence. Useful for testing a task or honoring an ad-hoc request like 'run my morning report now'. Returns an error if the task is already running.",
      args: { id: z.string() },
      async execute(args) {
        return callApi("run_now", args);
      },
    }),
  },
});

export default SchedulerPlugin;
