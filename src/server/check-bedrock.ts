import { bedrockClient, bedrockModel } from "./bedrock";
import { log } from "./telemetry";
import assert from "node:assert/strict";
import type {
  ResponseInput,
  ResponseOutputItem,
} from "openai/resources/responses/responses";

(async () => {
  const client = bedrockClient(20000);
  const input: ResponseInput = [
    {
      role: "user",
      content: "Consulte probe_catalog e depois responda apenas OK.",
    },
  ];
  for (let round = 0; round < 2; round++) {
    const stream = await client.responses.create({
      model: bedrockModel(),
      input,
      store: false,
      stream: true,
      reasoning: { effort: "none" },
      max_output_tokens: 128,
      parallel_tool_calls: false,
      tools: [
        {
          type: "function",
          name: "probe_catalog",
          description: "Catálogo fictício do teste de acesso.",
          strict: true,
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ],
      tool_choice:
        round === 0 ? { type: "function", name: "probe_catalog" } : "none",
    });
    let output: ResponseOutputItem[] | undefined;
    let text = "";
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") text += event.delta;
      if (event.type === "response.completed") output = event.response.output;
      if (
        ["response.failed", "response.incomplete", "error"].includes(event.type)
      )
        throw Error("Bedrock não concluiu o streaming.");
    }
    if (!output) throw Error("Streaming sem resposta concluída.");
    const calls = output.filter((item) => item.type === "function_call");
    if (round === 0) {
      if (calls.length !== 1 || calls[0].name !== "probe_catalog")
        throw Error("Ferramenta esperada não recebida.");
      assert.deepEqual(JSON.parse(calls[0].arguments), {});
      input.push(
        {
          type: "function_call",
          call_id: calls[0].call_id,
          name: calls[0].name,
          arguments: calls[0].arguments,
        },
        {
          type: "function_call_output",
          call_id: calls[0].call_id,
          output: '{"products":[]}',
        },
      );
    } else if (calls.length || text.trim() !== "OK")
      throw Error("Resultado da ferramenta não concluído.");
  }
  log("ai.bedrock_probe_ok", {
    model: bedrockModel(),
    region: process.env.AWS_REGION,
    streaming: true,
    toolRoundTrip: true,
  });
})().catch(() => {
  log("ai.bedrock_probe_failed", {});
  process.exitCode = 1;
});
