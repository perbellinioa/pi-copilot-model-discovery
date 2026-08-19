import assert from "node:assert/strict";
import test from "node:test";
import { fetchCopilotCatalog } from "../src/fetch-catalog.js";

test("fetches the live catalog with native provider headers and validators", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ data: [{ id: "model-a", undocumented_secret: "discard-me" }] }), {
      status: 200,
      headers: { "content-type": "application/json", etag: '"new"' },
    });
  };

  const result = await fetchCopilotCatalog({
    token: "secret-token",
    baseUrl: "https://copilot.test/",
    providerHeaders: { "User-Agent": "native-pi-header", Ignored: null },
    validators: { etag: '"old"', lastModified: Date.UTC(2026, 0, 1) },
    signal: new AbortController().signal,
    fetchImplementation: fakeFetch,
  });

  assert.equal(requestedUrl, "https://copilot.test/models");
  assert.equal(requestedHeaders?.get("authorization"), "Bearer secret-token");
  assert.equal(requestedHeaders?.get("user-agent"), "native-pi-header");
  assert.equal(requestedHeaders?.get("if-none-match"), '"old"');
  assert.equal(requestedHeaders?.get("if-modified-since"), "Thu, 01 Jan 2026 00:00:00 GMT");
  assert.equal(requestedHeaders?.has("ignored"), false);
  assert.equal(result.status, "modified");
  if (result.status === "modified") {
    assert.equal(result.models[0]?.id, "model-a");
    assert.equal("undocumented_secret" in (result.models[0] as object), false);
  }
  assert.equal(result.etag, '"new"');
});

test("handles a conditional 304 without parsing a body", async () => {
  const fakeFetch: typeof globalThis.fetch = async () => new Response(null, {
    status: 304,
    headers: { etag: '"same"' },
  });
  const result = await fetchCopilotCatalog({
    token: "token",
    baseUrl: "https://copilot.test",
    signal: new AbortController().signal,
    fetchImplementation: fakeFetch,
  });
  assert.deepEqual(result, { status: "not-modified", etag: '"same"', lastModified: undefined });
});

test("rejects invalid catalogs", async () => {
  const fakeFetch: typeof globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), { status: 200 });
  await assert.rejects(
    fetchCopilotCatalog({
      token: "token",
      baseUrl: "https://copilot.test",
      signal: new AbortController().signal,
      fetchImplementation: fakeFetch,
    }),
    /invalid catalog/,
  );
});
