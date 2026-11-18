import "reflect-metadata";
import "dotenv/config";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createServer } from "node:http";
import { Db } from "./db";
import { Shop } from "./shop";
import { Worker } from "./worker";
import { log } from "./telemetry";
@Module({ providers: [Db, Shop, Worker] })
class App {}
async function main() {
  const app = await NestFactory.createApplicationContext(App);
  const worker = app.get(Worker);
  const server = createServer(async (req, res) => {
    if (req.url !== "/health/live" && req.url !== "/health/ready") {
      res.writeHead(404).end();
      return;
    }
    if (req.url === "/health/live") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end('{"status":"ok"}');
      return;
    }
    try {
      await app.get(Db).$queryRaw`SELECT 1`;
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end('{"status":"ok"}');
    } catch {
      res.writeHead(503).end();
    }
  }).listen(Number(process.env.WORKER_PORT || 3001), "0.0.0.0");
  const stop = () => {
    worker.stopped = true;
    server.close();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await worker.run();
  await app.close();
}
main().catch(() => {
  log("worker.startup_failed");
  process.exitCode = 1;
});
