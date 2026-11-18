import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const args = Object.fromEntries(
  process.argv.slice(2).map((v) => v.replace(/^--/, "").split("=")),
);
const users = Number(args.users || 10),
  seconds = Number(args.seconds || 30),
  base = args.base || "http://127.0.0.1:3187";
if (
  !Number.isInteger(users) ||
  users < 1 ||
  users > 50 ||
  seconds < 1 ||
  seconds > 600
)
  throw Error("Use --users=1..50 e --seconds=1..600.");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookies = [];
for (let i = 0; i < users; i++) {
  let r = await fetch(base + "/api/session");
  if (r.status === 429) {
    await sleep(Number(r.headers.get("retry-after") || 60) * 1000);
    i--;
    continue;
  }
  if (!r.ok) throw Error("Falha ao preparar sessão: " + r.status);
  const state = await r.json();
  if (state.aiMode !== "mock")
    throw Error(
      "Este teste é de infraestrutura local com mock. Não gerar custo de IA real automaticamente.",
    );
  cookies.push(r.headers.get("set-cookie").split(";")[0]);
}
const samples = [],
  codes = {};
const start = Date.now(),
  until = start + seconds * 1000;
await Promise.all(
  cookies.map(async (cookie) => {
    while (Date.now() < until) {
      const t = performance.now();
      try {
        const r = await fetch(base + "/api/catalog", {
          headers: { Cookie: cookie },
        });
        await r.arrayBuffer();
        codes[r.status] = (codes[r.status] || 0) + 1;
        samples.push(performance.now() - t);
      } catch {
        codes.network = (codes.network || 0) + 1;
      }
      await sleep(Math.max(1000, users * 60));
    }
  }),
);
samples.sort((a, b) => a - b);
const percentile = (p) =>
  samples[Math.min(samples.length - 1, Math.floor(samples.length * p))] || 0;
const result = {
  environment: "local-mock",
  users,
  seconds,
  requests: samples.length,
  statuses: codes,
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  p99Ms: percentile(0.99),
  note: "Consultas HTTP locais. Não comprova autoscaling AWS, fluxo de compra sob carga ou latência da IA real.",
};
console.log(JSON.stringify(result, null, 2));
if (args.out) await writeFile(args.out, JSON.stringify(result, null, 2) + "\n");
