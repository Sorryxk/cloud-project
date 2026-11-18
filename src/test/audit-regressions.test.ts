import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ai } from "../server/ai";
import { Shop } from "../server/shop";
import type { Db } from "../server/db";

function offerFixture(
  round: number,
  previous: Record<string, unknown> | null = null,
) {
  let created = 0;
  const product = {
    id: "p",
    name: "Fixture",
    priceCents: 10000,
    costCents: 5000,
    minMarginBps: 2000,
  };
  const tx = {
    $queryRaw: async () => [{ id: "s" }],
    session: {
      findUniqueOrThrow: async () => ({
        negotiationRound: round - 1,
        cartVersion: 1,
        items: [{ productId: "p", quantity: 1, product }],
      }),
      update: async () => ({}),
    },
    offer: {
      findFirst: async () => previous,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created++;
        return { id: "new", ...data };
      },
    },
  };
  const db = {
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  } as unknown as Db;
  return { shop: new Shop(db), created: () => created };
}

test("concessões novas ficam abaixo do pedido em todas as rodadas", async () => {
  for (const round of [1, 2, 7, 8]) {
    for (const requested of [3, 5, 6, 20]) {
      const f = offerFixture(round);
      const result = await f.shop.offer("s", true, requested);
      assert(
        result.discountBps < requested * 100,
        `rodada ${round}, pedido ${requested}% resultou ${result.discountBps / 100}%`,
      );
    }
  }
});

test("contraproposta preserva oferta válida anterior sem nova concessão ou renovação", async () => {
  const previous = {
    id: "previous",
    discountBps: 500,
    expiresAt: new Date(Date.now() + 60000),
    lines: [],
    totalCents: 9500,
  };
  const f = offerFixture(2, previous);
  const result = await f.shop.offer("s", true, 5);
  assert.equal(result.id, "previous");
  assert.equal(result.expiresAt, previous.expiresAt);
  assert.equal(result.discountBps, 500);
  assert.equal(f.created(), 0);
});

test("concessão acima do pedido de 20% ainda pode chegar ao teto de 20%", async () => {
  const result = await offerFixture(8).shop.offer("s", true, 90);
  assert.equal(result.discountBps, 2000);
  assert.equal((result.lines as { unitCents: number }[])[0].unitCents, 8000);
});

function dependencyFixture(failedUntil: Date | null, synchronizeReads = false) {
  let deadline = failedUntil;
  let reads = 0;
  let releaseReads!: () => void;
  const allReads = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  const db = {
    dependency: {
      findUnique: async () => {
        const snapshot = deadline;
        if (synchronizeReads) {
          if (++reads === 2) releaseReads();
          await allReads;
        }
        return { name: "ai", failedUntil: snapshot };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { name: string; failedUntil: Date };
        data: { failedUntil: Date | null };
      }) => {
        if (
          where.name !== "ai" ||
          deadline?.getTime() !== where.failedUntil.getTime()
        )
          return { count: 0 };
        deadline = data.failedUntil;
        return { count: 1 };
      },
    },
  } as unknown as Db;
  return {
    db,
    deadline: () => deadline,
    set: (value: Date) => {
      deadline = value;
    },
  };
}

class ProbeAi extends Ai {
  probes = 0;
  probeAction: () => Promise<void> = async () => {};
  protected async probeDependency() {
    this.probes++;
    await this.probeAction();
  }
}

async function realMode(fn: () => Promise<void>) {
  const prior = {
    mode: process.env.AI_MODE,
    key: process.env.OPENAI_API_KEY,
    base: process.env.OPENAI_BASE_URL,
  };
  process.env.AI_MODE = "openai";
  process.env.OPENAI_API_KEY = "placeholder-for-isolated-test";
  try {
    await fn();
  } finally {
    for (const [key, value] of [
      ["AI_MODE", prior.mode],
      ["OPENAI_API_KEY", prior.key],
      ["OPENAI_BASE_URL", prior.base],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
}

async function enteredProbe(ai: ProbeAi) {
  let entered!: () => void, release!: () => void;
  const entry = new Promise<boolean>((resolve) => {
    entered = () => resolve(true);
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  ai.probeAction = async () => {
    entered();
    await barrier;
  };
  const running = ai.assertAvailable();
  const reached = await Promise.race([
    entry,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  assert(
    reached,
    "falha vencida deve executar probe antes de liberar operações",
  );
  return { running, release };
}

test("falha vencida só libera operações após probe bem-sucedido", async () =>
  realMode(async () => {
    const f = dependencyFixture(new Date(Date.now() - 1000));
    const ai = new ProbeAi(f.db, {} as Shop);
    await ai.assertAvailable();
    assert.equal(ai.probes, 1);
    assert.equal(f.deadline(), null);
    await ai.assertAvailable();
    assert.equal(ai.probes, 1);
  }));

test("probe malsucedido mantém bloqueio e aplica novo cooldown", async () =>
  realMode(async () => {
    const f = dependencyFixture(new Date(Date.now() - 1000));
    const ai = new ProbeAi(f.db, {} as Shop);
    ai.probeAction = async () => {
      throw Error("falha controlada sem credenciais");
    };
    await assert.rejects(ai.assertAvailable());
    assert(f.deadline() && f.deadline()!.getTime() > Date.now() + 25000);
    await assert.rejects(ai.assertAvailable());
    assert.equal(ai.probes, 1);
  }));

test("lease de recuperação permite um único probe entre réplicas", async () =>
  realMode(async () => {
    const f = dependencyFixture(new Date(Date.now() - 1000));
    const a = new ProbeAi(f.db, {} as Shop),
      b = new ProbeAi(f.db, {} as Shop);
    const active = await enteredProbe(a);
    try {
      await assert.rejects(b.assertAvailable());
      assert.equal(b.probes, 0);
    } finally {
      active.release();
    }
    await active.running;
    assert.equal(a.probes, 1);
    assert.equal(f.deadline(), null);
  }));

test("CAS impede dois probes quando réplicas leem a mesma falha vencida", async () =>
  realMode(async () => {
    const f = dependencyFixture(new Date(Date.now() - 1000), true);
    const a = new ProbeAi(f.db, {} as Shop),
      b = new ProbeAi(f.db, {} as Shop);
    const results = await Promise.allSettled([
      a.assertAvailable(),
      b.assertAvailable(),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(a.probes + b.probes, 1);
    assert.equal(f.deadline(), null);
  }));

test("probe antigo não limpa falha mais nova de outra réplica", async () =>
  realMode(async () => {
    const f = dependencyFixture(new Date(Date.now() - 1000));
    const ai = new ProbeAi(f.db, {} as Shop);
    const active = await enteredProbe(ai);
    const newer = new Date(Date.now() + 90000);
    f.set(newer);
    active.release();
    await assert.rejects(active.running);
    assert.equal(f.deadline()?.getTime(), newer.getTime());
  }));

test("probe real usa Responses sem ferramentas nem armazenamento", async () =>
  realMode(async () => {
    let body: Record<string, unknown> | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(String(options?.body));
      return new Response(
        JSON.stringify({
          id: "resp_fixture",
          object: "response",
          status: "completed",
          output: [],
          model: "gpt-6-luna",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    try {
      const f = dependencyFixture(new Date(Date.now() - 1000));
      await new Ai(f.db, {} as Shop).assertAvailable();
      assert(body, "o probe deve chamar o provedor");
      assert.equal(body.store, false);
      assert.equal(body.tools, undefined);
      assert.equal(body.stream, undefined);
      assert.equal(f.deadline(), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }));

test("HTTP 200 com resposta incompleta não reabre o gate", async () =>
  realMode(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "resp_fixture",
          object: "response",
          status: "incomplete",
          output: [],
          model: "gpt-6-luna",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    try {
      const f = dependencyFixture(new Date(Date.now() - 1000));
      await assert.rejects(new Ai(f.db, {} as Shop).assertAvailable());
      assert(f.deadline() && f.deadline()!.getTime() > Date.now() + 25000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }));

test("estado retorna todas as reservas ativas além das últimas 30 finalizadas", async () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({
    id: `r${i}`,
    sessionId: "s",
    requestKey: `k${i}`,
    status: i < 35 ? "ACTIVE" : "CANCELLED",
    createdAt: new Date(1000 + i),
    expiresAt: new Date(Date.now() + 60000),
  }));
  function select(options: {
    where?: { status?: string | { not: string } };
    take?: number;
  }) {
    const rule = options.where?.status;
    return rows
      .filter(
        (r) =>
          !rule ||
          (typeof rule === "string"
            ? r.status === rule
            : r.status !== rule.not),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.take ?? rows.length);
  }
  const db = {
    session: {
      findUniqueOrThrow: async (options: {
        include: { reservations: Parameters<typeof select>[0] };
      }) => ({
        cartVersion: 0,
        items: [],
        messages: [],
        offers: [],
        reservations: select(options.include.reservations),
      }),
    },
    reservation: {
      findMany: async (options: Parameters<typeof select>[0]) =>
        select(options),
    },
  } as unknown as Db;
  const state = await new Shop(db).state("s");
  assert.equal(
    state.reservations.filter((r) => r.status === "ACTIVE").length,
    35,
  );
  assert.equal(
    state.reservations.filter((r) => r.status === "CANCELLED").length,
    30,
  );
  assert.equal(state.reservations.length, 65);
  assert(
    state.reservations.every(
      (r) => r.sessionId === undefined && r.requestKey === undefined,
    ),
  );
});
