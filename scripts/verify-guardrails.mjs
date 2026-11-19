import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const base = process.argv[2];
const destination = process.argv[3];
assert(
  base && destination,
  "Uso: node scripts/verify-guardrails.mjs URL arquivo-evidencia.json",
);
const results = [];
async function request(
  path,
  { method = "GET", cookie, body, headers = {}, raw = false } = {},
) {
  const started = performance.now();
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 400);
  }
  return {
    status: r.status,
    data,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    requestId: r.headers.get("x-request-id"),
  };
}
async function visitor() {
  const r = await fetch(base + "/api/session", {
    signal: AbortSignal.timeout(12000),
  });
  assert.equal(r.status, 200, "preparação de sessão própria");
  const cookie = r.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "cookie não recebido");
  await r.arrayBuffer();
  return cookie;
}
const startedAt = new Date().toISOString();
try {
  const a = await visitor(),
    b = await visitor();
  const ownHeaders = { Origin: base, "X-Periferia-Client": "web" };
  const beforeA = await request("/api/state", { cookie: a });
  const beforeB = await request("/api/state", { cookie: b });
  const catalogBefore = await request("/api/catalog", { cookie: a });
  const cases = [
    {
      name: "estado sem cookie de sessão",
      path: "/api/state",
      options: {},
      expected: [401],
    },
    {
      name: "mutação sem Origin e sem cabeçalho obrigatório do cliente",
      path: "/api/cart",
      options: { method: "PUT", cookie: a, body: { items: [] } },
      expected: [403],
    },
    {
      name: "origem externa apesar de cookie próprio e cabeçalho válido",
      path: "/api/cart",
      options: {
        method: "PUT",
        cookie: a,
        headers: {
          Origin: "https://origem-nao-autorizada.example",
          "X-Periferia-Client": "web",
        },
        body: { items: [] },
      },
      expected: [403],
    },
    {
      name: "quantidade zero rejeitada",
      path: "/api/cart",
      options: {
        method: "PUT",
        cookie: a,
        headers: ownHeaders,
        body: { items: [{ productId: "key-01", quantity: 0 }] },
      },
      expected: [400],
    },
    {
      name: "preço/campo extra injetado no carrinho rejeitado",
      path: "/api/cart",
      options: {
        method: "PUT",
        cookie: a,
        headers: ownHeaders,
        body: { items: [], totalCents: 1 },
      },
      expected: [400],
    },
    {
      name: "confirmação sem consentimento explícito",
      path: "/api/reservations",
      options: {
        method: "POST",
        cookie: b,
        headers: ownHeaders,
        body: {
          offerId: randomUUID(),
          name: "Validação HTTP",
          requestKey: randomUUID(),
          confirmed: false,
        },
      },
      expected: [400],
    },
    {
      name: "cookie fabricado não autentica uma sessão",
      path: "/api/state",
      options: { cookie: "periferia=" + "0".repeat(64) },
      expected: [401],
    },
    {
      name: "JSON malformado é rejeitado como entrada inválida",
      path: "/api/cart",
      options: {
        method: "PUT",
        cookie: b,
        headers: ownHeaders,
        body: '{"items":',
        raw: true,
      },
      expected: [400],
    },
  ];
  for (const test of cases) {
    const observed = await request(test.path, test.options);
    results.push({
      name: test.name,
      method: test.options.method || "GET",
      path: test.path,
      expectedStatuses: test.expected,
      observedStatus: observed.status,
      passed: test.expected.includes(observed.status),
      response: observed.data,
      durationMs: observed.durationMs,
      requestId: observed.requestId,
    });
    await new Promise((r) => setTimeout(r, 200));
  }
  const afterA = await request("/api/state", { cookie: a }),
    afterB = await request("/api/state", { cookie: b }),
    catalogAfter = await request("/api/catalog", { cookie: a });
  for (const state of [beforeA, beforeB, afterA, afterB]) {
    assert.equal(
      state.status,
      200,
      "Estado deve estar acessível para comparar invariantes",
    );
    assert(
      Array.isArray(state.data.cart) && Array.isArray(state.data.reservations),
    );
  }
  for (const catalog of [catalogBefore, catalogAfter]) {
    assert.equal(catalog.status, 200);
    assert(Array.isArray(catalog.data));
  }
  const invariants = {
    sessionACartUnchanged:
      JSON.stringify(beforeA.data.cart) === JSON.stringify(afterA.data.cart),
    sessionBCartUnchanged:
      JSON.stringify(beforeB.data.cart) === JSON.stringify(afterB.data.cart),
    sessionAReservationsUnchanged:
      JSON.stringify(beforeA.data.reservations) ===
      JSON.stringify(afterA.data.reservations),
    sessionBReservationsUnchanged:
      JSON.stringify(beforeB.data.reservations) ===
      JSON.stringify(afterB.data.reservations),
    publicAvailabilityUnchanged:
      JSON.stringify(catalogBefore.data.map((p) => [p.id, p.available])) ===
      JSON.stringify(catalogAfter.data.map((p) => [p.id, p.available])),
  };
  const evidence = {
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: new URL(base).host,
    base,
    scope:
      "8 negativos HTTP, tráfego baixo, duas sessões próprias em memória, sem reservas ou alteração intencional de estoque",
    sessionCount: 2,
    cookiesStored: false,
    secretsRead: false,
    results,
    invariants,
    limits: [
      "Não testa acesso a uma reserva existente de outra sessão, pois nenhuma reserva foi criada.",
      "Não testa rate limit por exaustão, carga, falhas, IA generativa ou jailbreak.",
      "Disponibilidade pública pode variar por testes concorrentes de outros agentes; não foi manipulada neste ensaio.",
    ],
  };
  await writeFile(destination, JSON.stringify(evidence, null, 2) + "\n");
  if (
    results.some((result) => !result.passed) ||
    Object.values(invariants).some((value) => !value)
  )
    process.exitCode = 1;
  console.log(
    JSON.stringify(
      {
        file: destination,
        passed: results.filter((r) => r.passed).length,
        total: results.length,
        unexpected: results.filter((r) => !r.passed),
        invariants,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    destination,
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        results,
        blocked: true,
        error: {
          name: error.name,
          code: error.cause?.code,
          message: error.message,
        },
        cookiesStored: false,
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
}
