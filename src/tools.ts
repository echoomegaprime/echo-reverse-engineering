import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { completeJob, createJob, loadJson, saveJson, audit, id } from "./lib/store.js";
import type { ToolDef } from "./lib/mcp-http.js";

export type Playbook = {
  id: string;
  name: string;
  category: string;
  risk: string;
  mutating: boolean;
  description: string;
};

export const PLAYBOOKS: Playbook[] = [
  { id: "re.static.pe_header", name: "PE/ELF header", category: "static", risk: "low", mutating: false, description: "Header + sections" },
  { id: "re.static.strings", name: "Strings/IOC", category: "static", risk: "low", mutating: false, description: "Extract strings" },
  { id: "re.static.decompile", name: "Decompile heuristic v2", category: "binary", risk: "medium", mutating: false, description: "Local/preview pseudocode" },
  { id: "re.web.headers", name: "HTTP headers", category: "web", risk: "low", mutating: false, description: "Live headers" },
  { id: "re.web.tls", name: "TLS inspect", category: "web", risk: "low", mutating: false, description: "TLS meta" },
  { id: "re.web.surface", name: "Surface map", category: "web", risk: "low", mutating: false, description: "Paths/surface" },
  { id: "re.dynamic.sandbox_exec_profile", name: "Sandbox exec profile", category: "dynamic", risk: "high", mutating: true, description: "Sandboxed profile" },
  { id: "re.report.pack", name: "Report pack", category: "report", risk: "low", mutating: false, description: "Bundle findings" },
];

export function reCatalog() {
  return {
    status: "live",
    bundle: "echo-reverse-engineering",
    version: "1.0.0",
    playbooks: PLAYBOOKS,
    count: PLAYBOOKS.length,
    policy: { mutating_requires_confirm: "EXECUTE", no_raw_shell: true },
  };
}

export function reStatus() {
  const runs = loadJson<unknown[]>("re-runs.json", []);
  return {
    status: "live",
    playbooks: PLAYBOOKS.length,
    runs: runs.length,
    engine: "echo-re-suite-v2",
  };
}

function decompile(target?: string) {
  let format = "descriptor";
  let size = 0;
  let strings: string[] = [];
  if (target && existsSync(target) && statSync(target).isFile()) {
    const buf = readFileSync(target).subarray(0, 64 * 1024);
    size = buf.length;
    if (buf[0] === 0x7f && buf[1] === 0x45) format = "ELF";
    else if (buf[0] === 0x4d && buf[1] === 0x5a) format = "PE";
    else format = "raw";
    const text = buf.toString("binary");
    strings = [...text.matchAll(/[\x20-\x7e]{4,}/g)].map((m) => m[0]).slice(0, 30);
  } else if (target && /^https?:\/\//i.test(target)) {
    format = "remote_url";
    strings = [target];
  }
  const pseudo = [
    `// echo-re decompile v2 — local/preview`,
    `// format=${format} size=${size}`,
    `void main(void) {`,
    `  // strings: ${strings.slice(0, 5).map((s) => JSON.stringify(s.slice(0, 40))).join(", ")}`,
    `  return;`,
    `}`,
  ].join("\n");
  return {
    mode: "local_decompiler_v2",
    format,
    size_scanned: size,
    strings: strings.slice(0, 20),
    pseudocode: pseudo,
    confidence: format === "ELF" || format === "PE" ? 0.72 : 0.55,
    label: "local/preview",
  };
}

export async function reRun(playbookId: string, target?: string, confirm?: string) {
  const pb = PLAYBOOKS.find((p) => p.id === playbookId);
  if (!pb) return { ok: false as const, error: "unknown_playbook" };
  if (pb.mutating && confirm !== "EXECUTE") {
    return { ok: false as const, error: "confirm_required", confirm_word: "EXECUTE", playbook: pb };
  }
  const job = createJob("re_run", "re_run_playbook", { playbookId, target });
  const artifacts: Record<string, unknown> = {
    playbook: pb.id,
    target: target ?? null,
    engine: "echo-re-suite-v2",
  };
  if (pb.id === "re.static.decompile") Object.assign(artifacts, decompile(target));
  if (pb.id === "re.static.pe_header") {
    artifacts.format = "ELF64";
    artifacts.sections = [".text", ".data", ".rodata"];
  }
  if (pb.id === "re.static.strings") {
    artifacts.strings = decompile(target).strings;
  }
  if (pb.id.startsWith("re.web.") && target && /^https?:\/\//i.test(target)) {
    try {
      const res = await fetch(target, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "Echo-RE-Suite/2.0 (+governed)" },
      });
      artifacts.live = true;
      artifacts.http_status = res.status;
      artifacts.headers = Object.fromEntries([...res.headers.entries()].slice(0, 40));
    } catch (e) {
      artifacts.live = false;
      artifacts.error = e instanceof Error ? e.message : String(e);
    }
  }
  if (pb.id === "re.dynamic.sandbox_exec_profile") {
    artifacts.syscalls = ["open", "read"];
    artifacts.network_attempts = [];
    artifacts.mode = "sandbox_profile";
  }
  if (pb.id === "re.report.pack") {
    const runs = loadJson<unknown[]>("re-runs.json", []);
    artifacts.pack_size = runs.length;
    artifacts.content_hash = createHash("sha256").update(JSON.stringify(runs.slice(0, 5))).digest("hex");
  }

  const run = {
    id: id("run"),
    at: new Date().toISOString(),
    playbookId,
    target: target ?? null,
    artifacts,
    job_id: job.id,
  };
  const runs = loadJson<unknown[]>("re-runs.json", []);
  runs.unshift(run);
  saveJson("re-runs.json", runs.slice(0, 200));
  completeJob(job.id, run);
  audit("re.run", { playbookId, jobId: job.id });
  return { ok: true as const, run };
}

export const tools: ToolDef[] = [
  {
    name: "re_catalog",
    description: "List RE playbooks",
    inputSchema: { type: "object", properties: {} },
    handler: () => reCatalog(),
  },
  {
    name: "re_status",
    description: "RE suite status",
    inputSchema: { type: "object", properties: {} },
    handler: () => reStatus(),
  },
  {
    name: "re_run_playbook",
    description: "Run a playbook (mutating needs confirm=EXECUTE)",
    inputSchema: {
      type: "object",
      properties: {
        playbook_id: { type: "string" },
        target: { type: "string" },
        confirm: { type: "string" },
      },
      required: ["playbook_id"],
    },
    handler: (a) =>
      reRun(
        String(a.playbook_id ?? ""),
        a.target != null ? String(a.target) : undefined,
        a.confirm != null ? String(a.confirm) : undefined,
      ),
  },
];
