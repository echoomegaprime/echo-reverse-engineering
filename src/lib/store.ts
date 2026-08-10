import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DATA = process.env.ECHO_DATA_DIR || join(process.cwd(), "data");

export function ensureData() {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
}

export function loadJson<T>(name: string, fallback: T): T {
  ensureData();
  const p = join(DATA, name);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(name: string, data: unknown) {
  ensureData();
  writeFileSync(join(DATA, name), JSON.stringify(data, null, 2) + "\n");
}

export function id(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export type Job = {
  id: string;
  kind: string;
  tool: string;
  status: "queued" | "completed" | "failed";
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export function createJob(kind: string, tool: string, input: Record<string, unknown>): Job {
  const now = new Date().toISOString();
  const job: Job = {
    id: id("job"),
    kind,
    tool,
    status: "queued",
    input,
    createdAt: now,
    updatedAt: now,
  };
  const all = loadJson<Job[]>("jobs.json", []);
  all.unshift(job);
  saveJson("jobs.json", all.slice(0, 200));
  return job;
}

export function completeJob(jobId: string, result: unknown, error?: string) {
  const all = loadJson<Job[]>("jobs.json", []);
  const i = all.findIndex((j) => j.id === jobId);
  if (i < 0) return null;
  all[i] = {
    ...all[i],
    status: error ? "failed" : "completed",
    result,
    error,
    updatedAt: new Date().toISOString(),
  };
  saveJson("jobs.json", all);
  return all[i];
}

export function audit(event: string, detail: Record<string, unknown>) {
  ensureData();
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...detail }) + "\n";
  writeFileSync(join(DATA, "audit.jsonl"), line, { flag: "a" });
}
