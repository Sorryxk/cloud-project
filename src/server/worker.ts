import { Inject, Injectable } from "@nestjs/common";
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Db } from "./db";
import { Shop } from "./shop";
import { metric, log } from "./telemetry";
export const eventSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    kind: z.literal("EXPIRE_RESERVATION"),
    reservationId: z.string().uuid(),
  })
  .strict();
@Injectable()
export class Worker {
  stopped = false;
  sqs = new SQSClient({
    region: process.env.AWS_REGION || "us-east-2",
    endpoint: process.env.SQS_ENDPOINT || undefined,
    maxAttempts: 2,
  });
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Shop) readonly shop: Shop,
  ) {}
  async dispatch() {
    const claim = randomUUID();
    const rows = await this.db.$queryRaw<
      { id: string; reservationId: string }[]
    >`UPDATE "Outbox" SET "claimToken"=${claim},"leaseUntil"=NOW()+INTERVAL '30 seconds',attempts=attempts+1 WHERE id IN (SELECT id FROM "Outbox" WHERE "sentAt" IS NULL AND "availableAt"<=NOW() AND ("leaseUntil" IS NULL OR "leaseUntil"<NOW()) ORDER BY "availableAt" FOR UPDATE SKIP LOCKED LIMIT 20) RETURNING id,"reservationId"`;
    for (const row of rows) {
      try {
        await this.sqs.send(
          new SendMessageCommand({
            QueueUrl: process.env.SQS_QUEUE_URL,
            MessageBody: JSON.stringify({
              version: 1,
              id: row.id,
              kind: "EXPIRE_RESERVATION",
              reservationId: row.reservationId,
            }),
          }),
        );
        await this.db.outbox.updateMany({
          where: { id: row.id, claimToken: claim },
          data: { sentAt: new Date(), claimToken: null, leaseUntil: null },
        });
        metric("OutboxPublished", 1);
      } catch {
        log("outbox.send_failed", { eventId: row.id });
        metric("OutboxFailures", 1);
      }
    }
  }
  async consume() {
    const response = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: process.env.SQS_QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 30,
      }),
    );
    for (const message of response.Messages || []) {
      try {
        const event = eventSchema.parse(JSON.parse(message.Body || ""));
        await this.shop.finish(
          event.reservationId,
          "EXPIRED",
          undefined,
          event.id,
        );
        await this.sqs.send(
          new DeleteMessageCommand({
            QueueUrl: process.env.SQS_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
        log("event.processed", {
          eventId: event.id,
          reservationId: event.reservationId,
        });
      } catch {
        metric("MessageFailures", 1);
        log("event.failed", { messageId: message.MessageId });
      }
    }
  }
  async recover() {
    // Independente da fila: recupera vencimentos perdidos, inclusive após reinício.
    const rows = await this.db.reservation.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lt: new Date(Date.now() - 15000) },
      },
      take: 100,
      orderBy: { expiresAt: "asc" },
    });
    for (const r of rows) await this.shop.finish(r.id, "EXPIRED");
    const oldest = await this.db.reservation.findFirst({
      where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
      orderBy: { expiresAt: "asc" },
    });
    metric(
      "OldestExpirationLag",
      oldest ? (Date.now() - oldest.expiresAt.getTime()) / 1000 : 0,
      "Seconds",
    );
    await this.db.rateBucket.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 60000) } },
    });
  }
  async loop(fn: () => Promise<void>, interval: number) {
    while (!this.stopped) {
      const start = Date.now();
      try {
        await fn();
      } catch {
        log("worker.loop_failed");
        metric("WorkerFailures", 1);
      }
      if (!this.stopped)
        await new Promise((r) =>
          setTimeout(r, Math.max(100, interval - (Date.now() - start))),
        );
    }
  }
  async run() {
    await Promise.all([
      this.loop(() => this.dispatch(), 1000),
      this.loop(() => this.consume(), 100),
      this.loop(() => this.recover(), 5000),
    ]);
  }
}
