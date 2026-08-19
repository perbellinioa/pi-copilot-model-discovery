import assert from "node:assert/strict";
import test from "node:test";
import { fetchCopilotCatalog } from "../src/fetch-catalog.js";

test("fetches the live catalog with native provider headers", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
      status: 200,
      headers: { "content-type": "application/json", etag: '"abc"' },
    });
  };

  const result = await fetchCopilotCatalog(
    "secret-token",
    "https://copilot.test/",
    { "User-Agent": "native-pi-header", Ignored: null },
    new AbortController().signal,
    fakeFetch,
  );

  assert.equal(requestedUrl, "https://copilot.test/models");
  assert.equal(requestedHeaders?.get("authorization"), "Bearer secret-token");
  assert.equal(requestedHeaders?.get("user-agent"), "native-pi-header");
  assert.equal(requestedHeaders?.has("ignored"), false);
  assert.equal(result.models[0]?.id, "model-a");
  assert.equal(result.etag, '"abc"');
});

test("rejects invalid catalogs", async () => {
  const fakeFetch: typeof globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), { status: 200 });
  await assert.rejects(
    fetchCopilotCatalog("token", "https://copilot.test", undefined, new AbortController().signal, fakeFetch),
    /invalid catalog/,
  );
});
