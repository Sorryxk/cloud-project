import "reflect-metadata";
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Db } from "../server/db";
import { Shop, floorPrice, unitPrice } from "../server/shop";
import { Security } from "../server/security";
import { Ai } from "../server/ai";
import { Worker, eventSchema } from "../server/worker";
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  GetQueueAttributesCommand,
  ChangeMessageVisibilityCommand,
} from "@aws-sdk/client-sqs";
const createdSessions: string[] = [],
  createdProducts: string[] = [];
const db = new Db(),
  shop = new Shop(db),
  security = new Security(db);
const sqs = new SQSClient({
  region: "us-east-2",
  endpoint: process.env.SQS_ENDPOINT,
  maxAttempts: 1,
});
after(async () => {
  for (const r of await db.reservation.findMany({
    where: { sessionId: { in: createdSessions }, status: "ACTIVE" },
  }))
    await shop.finish(r.id, "CANCELLED", r.sessionId);
  await db.product.updateMany({
    where: { id: { in: createdProducts } },
    data: { active: false },
  });
  sqs.destroy();
  await db.$disconnect();
});
async function session() {
  const s = await db.session.create({
    data: {
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  createdSessions.push(s.id);
  return s;
}
async function product(stock = 3) {
  const p = await db.product.create({
    data: {
      id: "test-" + randomUUID(),
      name: "Produto de teste",
      category: "Teclados",
      description: "Fixture isolada",
      priceCents: 20000,
      costCents: 13000,
      minMarginBps: 2000,
      stock,
    },
  });
  createdProducts.push(p.id);
  return p;
}
async function fixture(stock = 3) {
  const s = await session(),
    p = await product(stock);
  await shop.setCart(s.id, [{ productId: p.id, quantity: 1 }]);
  const o = await shop.offer(s.id);
  return { s, p, o };
}
async function reservation() {
  const f = await fixture();
  const r = await shop.confirm(f.s.id, f.o.id, "Teste", randomUUID());
  return { ...f, r };
}
test("preço respeita piso e teto, inclusive arredondamento", () => {
  assert.equal(floorPrice(8000, 2000), 10000);
  assert.equal(unitPrice(20000, 13000, 2000, 9000), 16250);
  assert.equal(unitPrice(20000, 10000, 2000, 9000), 16000);
});
test("catálogo público não revela custo nem margem", async () => {
  const rows = await shop.catalog();
  assert(rows.length >= 12);
  for (const p of rows) {
    assert(!("costCents" in p));
    assert(!("minMarginBps" in p));
  }
});
test("resumo não reserva estoque; reserva e outbox são persistidas juntas", async () => {
  const { s, p, o } = await fixture();
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p.id } })).reserved,
    0,
  );
  const r = await shop.confirm(s.id, o.id, "Teste", randomUUID());
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p.id } })).reserved,
    1,
  );
  assert(
    await db.outbox.findUnique({
      where: {
        reservationId_kind: { reservationId: r.id, kind: "EXPIRE_RESERVATION" },
      },
    }),
  );
});
test("mesma confirmação simultânea não cria duas reservas", async () => {
  const { s, p, o } = await fixture();
  const key = randomUUID();
  const results = await Promise.all([
    shop.confirm(s.id, o.id, "Teste", key),
    shop.confirm(s.id, o.id, "Teste", key),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p.id } })).reserved,
    1,
  );
});
test("disputa pela última unidade permite somente uma reserva", async () => {
  const p = await product(1),
    a = await session(),
    b = await session();
  for (const s of [a, b])
    await shop.setCart(s.id, [{ productId: p.id, quantity: 1 }]);
  const oa = await shop.offer(a.id),
    ob = await shop.offer(b.id);
  const results = await Promise.allSettled([
    shop.confirm(a.id, oa.id, "A", randomUUID()),
    shop.confirm(b.id, ob.id, "B", randomUUID()),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p.id } })).reserved,
    1,
  );
});
test("quantidade reduzida exige resumo novo e não reserva os outros itens", async () => {
  const { s, p } = await fixture(2),
    p2 = await product(5);
  await shop.setCart(s.id, [
    { productId: p.id, quantity: 3 },
    { productId: p2.id, quantity: 1 },
  ]);
  const o = await shop.offer(s.id);
  await assert.rejects(shop.confirm(s.id, o.id, "Teste", randomUUID()));
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p2.id } })).reserved,
    0,
  );
  const state = await shop.state(s.id);
  assert.equal(state.cart.find((l) => l.productId === p.id)?.quantity, 2);
  assert(state.offer);
  assert.notEqual(state.offer.id, o.id);
});
test("oferta vencida ou carrinho alterado não confirmam", async () => {
  const f = await fixture();
  await db.offer.update({
    where: { id: f.o.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(shop.confirm(f.s.id, f.o.id, "Teste", randomUUID()));
  const g = await fixture();
  await shop.setCart(g.s.id, [{ productId: g.p.id, quantity: 2 }]);
  await assert.rejects(shop.confirm(g.s.id, g.o.id, "Teste", randomUUID()));
});
test("negociação nunca aceita automaticamente e não renova oferta sem concessão", async () => {
  const { s } = await fixture();
  const a = await shop.offer(s.id, true, 20);
  assert.equal(a.discountBps, 300);
  const b = await shop.offer(s.id);
  assert.equal(a.id, b.id);
  assert.equal(a.expiresAt.getTime(), b.expiresAt.getTime());
  for (let i = 0; i < 10; i++) await shop.offer(s.id, true, 90);
  const offer = (await shop.state(s.id)).offer!;
  assert(offer.discountBps <= 2000);
  const lines = offer.lines as { unitCents: number }[];
  assert(lines[0].unitCents >= 16250);
});
test("cancelamento e expiração concorrentes liberam uma única vez", async () => {
  const { r, s, p } = await reservation();
  await db.reservation.update({
    where: { id: r.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await Promise.all([
    shop.finish(r.id, "CANCELLED", s.id),
    shop.finish(r.id, "EXPIRED", undefined, randomUUID()),
  ]);
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p.id } })).reserved,
    0,
  );
  assert.equal(
    (await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status,
    "EXPIRED",
  );
});
test("uma sessão não pode cancelar reserva de outra", async () => {
  const { r, p } = await reservation();
  const stranger = await session();
  await assert.rejects(shop.finish(r.id, "CANCELLED", stranger.id));
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p.id } })).reserved,
    1,
  );
});
test("evento repetido não devolve estoque duas vezes", async () => {
  const { r, p } = await reservation();
  await db.reservation.update({
    where: { id: r.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const eventId = randomUUID();
  await shop.finish(r.id, "EXPIRED", undefined, eventId);
  await shop.finish(r.id, "EXPIRED", undefined, eventId);
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p.id } })).reserved,
    0,
  );
});
test("limite distribuído conta chamadas concorrentes de duas instâncias", async () => {
  const key = randomUUID(),
    second = new Security(db);
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? second : security).rate(key, 10),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 10);
  assert.equal(results.filter((r) => r.status === "rejected").length, 2);
});
test("lease de chat impede duas mensagens simultâneas entre réplicas", async () => {
  const s = await session();
  await db.session.update({
    where: { id: s.id },
    data: {
      chatLeaseUntil: new Date(Date.now() + 30000),
      chatLeaseToken: randomUUID(),
    },
  });
  await assert.rejects(new Ai(db, shop).chat(s.id, "Olá", () => {}));
});
test("outbox conserva evento em falha e publica após recuperação", async () => {
  const { r } = await reservation();
  await db.reservation.update({
    where: { id: r.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await db.outbox.update({
    where: {
      reservationId_kind: { reservationId: r.id, kind: "EXPIRE_RESERVATION" },
    },
    data: { availableAt: new Date(Date.now() - 1000) },
  });
  const w = new Worker(db, shop),
    good = w.sqs;
  w.sqs = {
    send: async () => {
      throw Error("falha simulada");
    },
  } as unknown as SQSClient;
  await w.dispatch();
  let row = await db.outbox.findUniqueOrThrow({
    where: {
      reservationId_kind: { reservationId: r.id, kind: "EXPIRE_RESERVATION" },
    },
  });
  assert.equal(row.sentAt, null);
  await db.outbox.update({
    where: { id: row.id },
    data: { leaseUntil: new Date(Date.now() - 1000) },
  });
  w.sqs = good;
  await w.dispatch();
  row = await db.outbox.findUniqueOrThrow({ where: { id: row.id } });
  assert(row.sentAt);
  await w.consume();
  assert.equal(
    (await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status,
    "EXPIRED",
  );
  good.destroy();
});
test("recuperação reconcilia reserva vencida sem depender da fila", async () => {
  const { r, p } = await reservation();
  await db.reservation.update({
    where: { id: r.id },
    data: { expiresAt: new Date(Date.now() - 20000) },
  });
  const w = new Worker(db, shop);
  await w.recover();
  w.sqs.destroy();
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p.id } })).reserved,
    0,
  );
});
test("evento inválido é rejeitado e chega à DLQ após retentativas no emulador", async () => {
  assert.equal(eventSchema.safeParse({ kind: "EXECUTE_SQL" }).success, false);
  const queue = process.env.SQS_QUEUE_URL!;
  const dlq = queue.replace("reservation-events", "reservation-dlq");
  const tag = randomUUID();
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queue,
      MessageBody: JSON.stringify({ invalid: tag }),
    }),
  );
  let inDlq = false;
  for (let i = 0; i < 8 && !inDlq; i++) {
    const batch = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queue,
        WaitTimeSeconds: 0,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 0,
      }),
    );
    for (const msg of batch.Messages || [])
      if (msg.Body?.includes(tag))
        await sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queue,
            ReceiptHandle: msg.ReceiptHandle,
            VisibilityTimeout: 0,
          }),
        );
    const result = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: dlq,
        WaitTimeSeconds: 0,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 0,
      }),
    );
    inDlq = !!result.Messages?.some((m) => m.Body?.includes(tag));
  }
  assert(inDlq);
  const attrs = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlq,
      AttributeNames: ["ApproximateNumberOfMessages"],
    }),
  );
  assert(Number(attrs.Attributes?.ApproximateNumberOfMessages) > 0);
});
