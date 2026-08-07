import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type RequestContext = {
  requestId: string;
  staleNotices: string[];
};

const requestStorage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(requestId: string = randomUUID()): RequestContext {
  return {
    requestId,
    staleNotices: []
  };
}

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestStorage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return requestStorage.getStore();
}
