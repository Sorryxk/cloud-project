import OpenAI from "openai";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";
import { Hash } from "@smithy/hash-node";
import { log, metric } from "./telemetry";

export const bedrockModel = () =>
  process.env.BEDROCK_MODEL_ID || "global.openai.gpt-6-luna";
const runtimeCredentials = defaultProvider();

type Credentials = () => Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}>;

// OpenAI é somente o cliente do protocolo Responses. A inferência e a
// autenticação são AWS; nenhuma chave ou chamada api.openai.com é utilizada.
export function bedrockClient(
  timeout: number,
  overrides: { credentials?: Credentials; fetch?: typeof fetch } = {},
) {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region || !/^[a-z]{2}-[a-z]+-\d$/.test(region))
    throw Error("Região AWS válida é obrigatória para o Bedrock.");
  const origin = `https://bedrock-runtime.${region}.amazonaws.com`;
  const signer = new SignatureV4({
    region,
    service: "bedrock",
    credentials: overrides.credentials || runtimeCredentials,
    sha256: Hash.bind(null, "sha256"),
  });
  const transport = overrides.fetch || globalThis.fetch;
  const signedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      url.origin !== origin ||
      url.pathname !== "/openai/v1/responses" ||
      url.search ||
      request.method !== "POST"
    )
      throw Error("Destino de inferência Bedrock não autorizado.");
    const headers = new Headers(request.headers);
    headers.delete("authorization");
    headers.delete("x-api-key");
    headers.set("host", url.host);
    const body = await request.text();
    const signed = await signer.sign({
      protocol: url.protocol,
      hostname: url.hostname,
      path: url.pathname,
      method: request.method,
      headers: Object.fromEntries(headers.entries()),
      body,
    });
    const start = Date.now();
    const response = await transport(url, {
      method: request.method,
      headers: signed.headers,
      body,
      signal: request.signal,
      redirect: "error",
    });
    metric("BedrockLatency", Date.now() - start, "Milliseconds");
    log("ai.bedrock_response", {
      region,
      status: response.status,
      awsRequestId: response.headers.get("x-amzn-requestid"),
    });
    return response;
  };
  return new OpenAI({
    apiKey: "bedrock-iam-auth",
    baseURL: origin + "/openai/v1",
    fetch: signedFetch,
    maxRetries: 0,
    timeout,
  });
}
