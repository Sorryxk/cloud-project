import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
const context = new AsyncLocalStorage<Record<string, string>>();
export function inContext<T>(data: Record<string, string>, fn: () => T): T {
  return context.run(data, fn);
}
export function log(event: string, data: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      event,
      ...context.getStore(),
      ...data,
    }),
  );
}
export function metric(name: string, value: number, unit = "Count") {
  if (process.env.NODE_ENV === "production")
    console.log(
      JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: "Periferia",
              Dimensions: [["Service"]],
              Metrics: [{ Name: name, Unit: unit }],
            },
          ],
        },
        Service: process.env.SERVICE_NAME || "api",
        [name]: value,
      }),
    );
  else log("metric", { name, value, unit });
}
export const requestId = () => randomUUID();
