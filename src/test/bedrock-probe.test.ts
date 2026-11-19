import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function probe(scenario: "success" | "forbidden" | "invalid-tool") {
  const directory = mkdtempSync(join(tmpdir(), "periferia-probe-"));
  const preload = join(directory, "transport.cjs");
  writeFileSync(
    preload,
    `
    let requests = 0;
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (!body.stream || body.store !== false) throw Error('Contrato de streaming ausente');
      if (process.env.PROBE_SCENARIO === 'forbidden')
        return new Response('{"message":"Stream denied"}', {status:403, headers:{'Content-Type':'application/json'}});
      requests++;
      const output = requests === 1 ? [{type:'function_call',name:'probe_catalog',arguments:process.env.PROBE_SCENARIO==='invalid-tool'?'[]':'{}',call_id:'fixture-call'}] : [];
      if (requests === 2 && !body.input.some(item => item.type === 'function_call_output' && item.call_id === 'fixture-call'))
        throw Error('Resultado da ferramenta não foi enviado');
      const events = requests === 2 ? [{type:'response.output_text.delta',delta:'OK'}] : [];
      events.push({type:'response.completed', response:{output,status:'completed'}});
      return new Response(events.map(event => 'data: '+JSON.stringify(event)+'\\n\\n').join('')+'data: [DONE]\\n\\n', {headers:{'Content-Type':'text/event-stream'}});
    };
  `,
  );
  try {
    return spawnSync(
      process.execPath,
      ["--require", preload, resolve(__dirname, "../server/check-bedrock.js")],
      {
        encoding: "utf8",
        timeout: 8000,
        env: {
          ...process.env,
          PROBE_SCENARIO: scenario,
          AWS_REGION: "us-east-2",
          AWS_ACCESS_KEY_ID: "fixture-access",
          AWS_SECRET_ACCESS_KEY: "fixture-secret",
          AWS_SESSION_TOKEN: "fixture-session",
          AWS_EC2_METADATA_DISABLED: "true",
        },
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("preflight exige streaming e round-trip da ferramenta antes de liberar o deploy", () => {
  const result = probe("success");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"event":"ai.bedrock_probe_ok"/);
  assert.match(result.stdout, /"toolRoundTrip":true/);
});

test("negação de streaming faz o preflight encerrar com erro", () => {
  const result = probe("forbidden");
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /"event":"ai.bedrock_probe_failed"/);
  assert.doesNotMatch(result.stdout, /fixture-secret|fixture-session/);
});

test("argumentos de ferramenta fora do contrato não passam no preflight", () => {
  const result = probe("invalid-tool");
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /"event":"ai.bedrock_probe_failed"/);
});
