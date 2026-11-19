import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bedrockClient, bedrockModel } from "../server/bedrock";

const credentials = async () => ({
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret",
  sessionToken: "test-session",
});

test("Bedrock assina o payload UTF-8 e ignora a chave/base da OpenAI", async () => {
  const region = process.env.AWS_REGION;
  const oldKey = process.env.OPENAI_API_KEY;
  const oldBase = process.env.OPENAI_BASE_URL;
  process.env.AWS_REGION = "sa-east-1";
  process.env.OPENAI_API_KEY = "chave-antiga-nao-deve-ser-enviada";
  process.env.OPENAI_BASE_URL = "https://example.invalid/v1";
  let calls = 0;
  const transport: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(
      String(input),
      "https://bedrock-runtime.sa-east-1.amazonaws.com/openai/v1/responses",
    );
    const headers = new Headers(init?.headers);
    assert.match(headers.get("authorization") || "", /^AWS4-HMAC-SHA256 /);
    assert.match(
      headers.get("authorization") || "",
      /sa-east-1\/bedrock\/aws4_request/,
    );
    assert.equal(headers.get("x-amz-security-token"), "test-session");
    assert.equal(
      headers.get("x-amz-content-sha256"),
      createHash("sha256").update(String(init?.body)).digest("hex"),
    );
    assert(!JSON.stringify([...headers]).includes(process.env.OPENAI_API_KEY!));
    assert.equal(init?.redirect, "error");
    assert(init?.signal);
    return Response.json({
      id: "response-test",
      object: "response",
      status: "completed",
      output: [],
    });
  };
  try {
    const client = bedrockClient(1000, { credentials, fetch: transport });
    await client.responses.create({
      model: bedrockModel(),
      input: "Olá, orçamento de R$ 150.",
      store: false,
    });
    assert.equal(calls, 1);
  } finally {
    for (const [key, value] of [
      ["AWS_REGION", region],
      ["OPENAI_API_KEY", oldKey],
      ["OPENAI_BASE_URL", oldBase],
    ])
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
  }
});

test("Bedrock bloqueia host alternativo antes de resolver credenciais", async () => {
  const prior = process.env.AWS_REGION;
  process.env.AWS_REGION = "us-east-2";
  let credentialCalls = 0,
    networkCalls = 0;
  try {
    const client = bedrockClient(1000, {
      credentials: async () => {
        credentialCalls++;
        return credentials();
      },
      fetch: async () => {
        networkCalls++;
        throw Error("Não pode acessar a rede.");
      },
    });
    client.baseURL = "https://example.invalid/v1";
    await assert.rejects(
      client.responses.create({ model: bedrockModel(), input: "OK" }),
    );
    assert.equal(credentialCalls, 0);
    assert.equal(networkCalls, 0);
  } finally {
    if (prior === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = prior;
  }
});

test("Bedrock conserva streaming Responses e não usa retentativa automática", async () => {
  const prior = process.env.AWS_REGION;
  process.env.AWS_REGION = "us-east-2";
  let calls = 0;
  try {
    const client = bedrockClient(1000, {
      credentials,
      fetch: async () => {
        calls++;
        return new Response(
          'data: {"type":"response.output_text.delta","delta":"OK"}\n\ndata: {"type":"response.completed","response":{"output":[]}}\n\ndata: [DONE]\n\n',
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });
    const stream = await client.responses.create({
      model: bedrockModel(),
      input: "OK",
      stream: true,
    });
    let answer = "";
    for await (const event of stream)
      if (event.type === "response.output_text.delta") answer += event.delta;
    assert.equal(answer, "OK");
    assert.equal(calls, 1);
    assert.equal(client.maxRetries, 0);
  } finally {
    if (prior === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = prior;
  }
});
