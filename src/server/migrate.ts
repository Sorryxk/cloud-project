import "dotenv/config";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { Db } from "./db";
import { seed } from "./seed";
import { log } from "./telemetry";

// Entrada operacional separada: credenciais injetadas pelo ECS/Secrets Manager.
// Nunca chamada pelo HTTP ou pelas ferramentas da IA.
async function main() {
  const host = process.env.DB_HOST;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const apiPassword = process.env.API_DB_PASSWORD;
  const workerPassword = process.env.WORKER_DB_PASSWORD;
  const caPath = process.env.DATABASE_CA_PATH;
  if (
    !host ||
    !username ||
    !password ||
    !apiPassword ||
    !workerPassword ||
    !caPath
  )
    throw new Error("Configuração operacional incompleta.");
  if (![apiPassword, workerPassword].every((p) => /^[a-f0-9]{64}$/.test(p)))
    throw new Error("Formato de senha operacional inesperado.");
  const base = new URL(`postgresql://${host}:5432/periferia`);
  base.username = username;
  base.password = password;
  const migration = new URL(base);
  migration.searchParams.set("sslmode", "require");
  migration.searchParams.set("sslaccept", "strict");
  migration.searchParams.set("sslcert", caPath);
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: { ...process.env, DATABASE_URL: migration.toString() },
      encoding: "utf8",
      timeout: 180000,
    },
  );
  if (result.status !== 0) {
    let reason = result.stderr || "Falha na migration.";
    for (const secret of [password, apiPassword, workerPassword])
      reason = reason
        .replaceAll(secret, "[redacted]")
        .replaceAll(encodeURIComponent(secret), "[redacted]");
    log("migration.failed", { reason: reason.slice(0, 2000) });
    throw new Error("Migration não concluída.");
  }
  process.env.DATABASE_URL = base.toString();
  const db = new Db();
  try {
    await seed(db);
  } finally {
    await db.$disconnect();
  }
  const client = new Client({
    connectionString: base.toString(),
    ssl: { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true },
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const [role, secret] of [
      ["periferia_api", apiPassword],
      ["periferia_worker", workerPassword],
    ]) {
      await client.query(
        `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} LOGIN; END IF; END $$`,
      );
      await client.query(`ALTER ROLE ${role} PASSWORD '${secret}'`);
    }
    const sql = readFileSync("infra/aws/database-roles.sql", "utf8").replace(
      /^CREATE ROLE.*;$/gm,
      "",
    );
    await client.query(sql);
    await client.query("COMMIT");
    log("bootstrap.completed");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
main().catch(() => {
  log("bootstrap.failed");
  process.exitCode = 1;
});
