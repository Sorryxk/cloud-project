import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_API_URL || "http://127.0.0.1:3187";
async function visitor() {
  const r = await fetch(base + "/api/session");
  assert.equal(r.status, 200);
  assert(
    !r.headers
      .get("content-security-policy")
      ?.includes("upgrade-insecure-requests"),
  );
  const cookie = r.headers.get("set-cookie")!;
  assert(cookie.includes("HttpOnly"));
  return cookie.split(";")[0];
}
async function call(
  path: string,
  cookie: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return fetch(base + "/api/" + path, {
    method,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-Periferia-Client": "web",
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
test("HTTP: sessão privada, catálogo sem dados internos e rejeição de CSRF", async () => {
  const cookie = await visitor();
  const catalog = await call("catalog", cookie);
  assert.equal(catalog.status, 200);
  const body = await catalog.json();
  assert.equal(body.length, 12);
  assert(!JSON.stringify(body).includes("costCents"));
  assert(!JSON.stringify(body).includes("minMarginBps"));
  assert.equal(
    (
      await call(
        "cart",
        cookie,
        "PUT",
        { items: [] },
        { Origin: "https://outro.example" },
      )
    ).status,
    403,
  );
  assert.equal((await fetch(base + "/api/state")).status, 401);
});
test("HTTP: preço forjado é rejeitado; confirmação e cancelamento preservam estoque", async () => {
  const cookie = await visitor(),
    other = await visitor();
  let r = await call("cart", cookie, "PUT", {
    items: [{ productId: "key-01", quantity: 1 }],
    totalCents: 1,
  });
  assert.equal(r.status, 400);
  r = await call("cart", cookie, "PUT", {
    items: [{ productId: "key-01", quantity: 1 }],
  });
  assert.equal(r.status, 200);
  r = await call("offers", cookie, "POST");
  assert.equal(r.status, 201);
  const state = await r.json();
  const request = {
    offerId: state.offer.id,
    name: "Teste HTTP",
    requestKey: state.offer.id,
    confirmed: true,
  };
  r = await call("reservations", cookie, "POST", request);
  assert.equal(r.status, 201);
  const confirmed = await r.json(),
    id = confirmed.reservations[0].id;
  const duplicate = await call("reservations", cookie, "POST", request);
  assert.equal(duplicate.status, 201);
  assert.equal((await duplicate.json()).reservations.length, 1);
  assert.equal(
    (
      await call(`reservations/${id}/cancel`, other, "POST", {
        confirmed: true,
      })
    ).status,
    404,
  );
  r = await call(`reservations/${id}/cancel`, cookie, "POST", {
    confirmed: true,
  });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).reservations[0].status, "CANCELLED");
});
test("HTTP: chat retorna eventos progressivos e estado persistido", async () => {
  const cookie = await visitor();
  const r = await call("chat", cookie, "POST", {
    message: "Quero um teclado para trabalhar",
  });
  assert.equal(r.status, 200);
  assert(r.headers.get("content-type")?.includes("text/event-stream"));
  const text = await r.text();
  assert(text.includes("event: delta"));
  assert(text.includes("event: done"));
  const state = await (await call("state", cookie)).json();
  assert.equal(state.messages.length, 2);
  assert(state.messages.some((m: { role: string }) => m.role === "assistant"));
});

test("HTTP: IA indisponível bloqueia novas reservas, mas mantém consulta e cancelamento", async () => {
  const { spawn } = await import("node:child_process");
  const { createServer } = await import("node:net");
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as import("node:net").AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const child = spawn(process.execPath, ["dist/server/main.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      AI_MODE: "openai",
      OPENAI_API_KEY: "",
    },
    stdio: "ignore",
  });
  const target = `http://127.0.0.1:${port}`;
  const cookie = await visitor();
  let reservationId: string | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        ready = (await fetch(target + "/health/ready")).ok;
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(ready, "API de teste indisponível");
    await call("cart", cookie, "PUT", {
      items: [{ productId: "mouse-01", quantity: 1 }],
    });
    const offer = await (await call("offers", cookie, "POST")).json();
    const existing = await (
      await call("reservations", cookie, "POST", {
        offerId: offer.offer.id,
        name: "Teste de falha da IA",
        requestKey: randomUUID(),
        confirmed: true,
      })
    ).json();
    reservationId = existing.reservations[0].id;
    const headers = {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-Periferia-Client": "web",
    };
    assert.equal((await fetch(target + "/api/state", { headers })).status, 200);
    assert.equal(
      (await fetch(target + "/api/offers", { method: "POST", headers })).status,
      503,
    );
    assert.equal(
      (
        await fetch(target + "/api/chat", {
          method: "POST",
          headers,
          body: JSON.stringify({ message: "Olá" }),
        })
      ).status,
      503,
    );
    assert.equal(
      (
        await fetch(target + `/api/reservations/${reservationId}/cancel`, {
          method: "POST",
          headers,
          body: JSON.stringify({ confirmed: true }),
        })
      ).status,
      201,
    );
  } finally {
    child.kill("SIGTERM");
    if (reservationId)
      await call(`reservations/${reservationId}/cancel`, cookie, "POST", {
        confirmed: true,
      });
  }
});
