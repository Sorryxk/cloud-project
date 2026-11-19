import "reflect-metadata";
import "dotenv/config";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { resolve } from "node:path";
import { Db } from "./db";
import { Shop } from "./shop";
import { Security } from "./security";
import { Ai } from "./ai";
import { Api, Health, Errors } from "./http";
import { log, requestId, metric, inContext } from "./telemetry";
@Module({ controllers: [Api, Health], providers: [Db, Shop, Security, Ai] })
class App {}
async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.AI_MODE !== "bedrock" || !process.env.AWS_REGION)
  )
    throw Error("Produção exige Amazon Bedrock e região AWS configurada.");
  const app = await NestFactory.create(App, { bodyParser: false });
  const server = app.getHttpAdapter().getInstance();
  // Confiar somente no salto do ALB. SG deve impedir qualquer acesso direto à aplicação.
  server.set("trust proxy", process.env.TRUST_ALB === "true" ? 1 : false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests:
            process.env.COOKIE_SECURE === "true" ? [] : null,
        },
      },
      strictTransportSecurity:
        process.env.COOKIE_SECURE === "true" ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());
  app.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const id = requestId(),
        start = Date.now();
      res.setHeader("X-Request-Id", id);
      res.on("finish", () => {
        log("http.request", {
          requestId: id,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        });
        if (req.path.startsWith("/api"))
          metric("ApiLatency", Date.now() - start, "Milliseconds");
      });
      inContext({ requestId: id }, next);
    },
  );
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  const web = resolve(process.cwd(), "apps/web/dist");
  app.use(express.static(web, { index: "index.html" }));
  server.get("/", (_req: express.Request, res: express.Response) =>
    res.sendFile(resolve(web, "index.html")),
  );
  await app.listen(Number(process.env.PORT || 3000), "0.0.0.0");
  log("api.started", {
    port: Number(process.env.PORT || 3000),
    aiMode: process.env.AI_MODE || "bedrock",
  });
}
main().catch(() => {
  log("startup.failed");
  process.exitCode = 1;
});
