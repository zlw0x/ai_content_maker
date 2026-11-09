import assert from "node:assert/strict";
import dns from "node:dns";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { HttpError } from "../src/server/errors";
import { readProviderImage } from "../src/server/media";
import { downloadProviderMedia, putProviderMedia } from "../src/server/provider-media-http";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.WAVESPEED_MODE = "mock";
process.env.OUTPUT_HOST_ALLOWLIST = "cdn.example.invalid,[::1],127.0.0.1";

const origin = "https://cdn.example.invalid";
const signedUrl = new URL(origin + "/photo%20example.png?sig=a%2Bb%2F%3D");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const code = (value: string) => (error: unknown) => error instanceof HttpError && error.code === value;

test("provider media requires an exact HTTPS hostname even if a literal is configured", async t => {
  const request = t.mock.method(https, "get", () => assert.fail("HTTPS must not be called"));
  for (const url of ["not-a-url", "http://cdn.example.invalid", "https://user@cdn.example.invalid",
    "https://cdn.example.invalid:444", "https://127.0.0.1/image", "https://[::1]/image"]) {
    await assert.rejects(readProviderImage(url), code("UNSAFE_MEDIA_URL"));
  }
  await assert.rejects(readProviderImage("https://cdn.example.invalid.other.test/image"), code("OUTPUT_HOST_NOT_ALLOWED"));
  assert.equal(request.mock.callCount(), 0);
});

test("the HTTPS socket rejects nonpublic and mixed DNS answers before it connects", async t => {
  const server = createServer();
  t.after(() => server.close());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = server.address();
  assert(endpoint && typeof endpoint === "object");
  let connections = 0;
  server.on("connection", socket => { connections++; socket.destroy(); });
  let answers: dns.LookupAddress[] = [];
  const resolve = t.mock.method(dns, "lookup", (hostname: string, options: object,
    callback: (error: null, records: dns.LookupAddress[]) => void) => {
    assert.equal(hostname, "cdn.example.invalid");
    assert.deepEqual(options, { all: true });
    queueMicrotask(() => callback(null, answers));
  });
  const url = new URL(origin + ":" + endpoint.port);
  for (const address of ["127.0.0.1", "10.1.2.3", "172.31.1.1", "192.168.1.1", "100.64.0.1",
    "169.254.169.254", "168.63.129.16", "::ffff:127.0.0.1", "fe80::1", "fd00::1", "2002:7f00:1::1", "3fff::1"]) {
    answers = [{ address, family: address.includes(":") ? 6 : 4 }];
    await assert.rejects(downloadProviderMedia(url, 1024), code("UNSAFE_MEDIA_ADDRESS"));
  }
  answers = [{ address: "3.174.113.12", family: 4 }, { address: "127.0.0.1", family: 4 }];
  await assert.rejects(downloadProviderMedia(url, 1024), code("UNSAFE_MEDIA_ADDRESS"));
  await assert.rejects(putProviderMedia(url, png), code("UNSAFE_MEDIA_ADDRESS"));
  answers = [];
  await assert.rejects(downloadProviderMedia(url, 1024), code("UNSAFE_MEDIA_ADDRESS"));
  assert.equal(resolve.mock.callCount(), 15);
  assert.equal(connections, 0);
});

test("signed PUT refuses unsafe headers before sending bytes and never follows a redirect", async t => {
  let responseDestroyed = false;
  const request = t.mock.method(https, "request", (url: URL, options: https.RequestOptions,
    onResponse: (response: IncomingMessage) => void) => {
    assert.equal(url.href, signedUrl.href);
    assert.equal(options.method, "PUT");
    assert.equal(options.servername, signedUrl.hostname);
    assert.equal(options.rejectUnauthorized, true);
    assert.ok(options.lookup);
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      end(body: Buffer) {
        assert.deepEqual(body, png);
        queueMicrotask(() => onResponse({
          statusCode: 307, headers: { location: "https://another.example.invalid/file" },
          destroy() { responseDestroyed = true; },
        } as unknown as IncomingMessage));
      },
    }) as ClientRequest;
  });
  for (const [name, value] of Object.entries({
    host: "another.example.invalid", "content-length": "1", authorization: "unexpected",
    "proxy-authorization": "unexpected", "transfer-encoding": "chunked", expect: "100-continue", upgrade: "websocket",
  })) {
    await assert.rejects(putProviderMedia(signedUrl, png, { [name]: value }), code("BAD_UPLOAD_HEADERS"));
  }
  assert.equal(request.mock.callCount(), 0);
  await assert.rejects(putProviderMedia(signedUrl, png), code("UPLOAD_FAILED"));
  assert.equal(request.mock.callCount(), 1);
  assert.equal(responseDestroyed, true);
});

test("CDN requests preserve signed URLs and use only vetted addresses, without following redirects", async t => {
  const addresses = [{ address: "2600:9000::1", family: 6 }, { address: "3.174.113.12", family: 4 }];
  t.mock.method(dns, "lookup", (_hostname: string, _options: object,
    callback: (error: null, records: dns.LookupAddress[]) => void) => queueMicrotask(() => callback(null, addresses)));
  let statusCode = 200;
  let headers: Record<string, string> = { "content-type": "application/octet-stream", "content-encoding": "gzip" };
  let payload = gzipSync(png);
  const responses: Readable[] = [];
  const request = t.mock.method(https, "get", (url: URL, options: https.RequestOptions & { autoSelectFamily?: boolean },
    onResponse: (response: IncomingMessage) => void) => {
    assert.equal(url.href, signedUrl.href);
    assert.equal(options.agent, false);
    assert.equal(options.autoSelectFamily, true);
    assert.equal(options.rejectUnauthorized, true);
    assert.ok(options.signal);
    const emitter = new EventEmitter();
    options.lookup!(url.hostname, { all: true }, (error, records) => {
      assert.equal(error, null);
      assert.deepEqual(records, addresses);
      const response = Readable.from([payload]);
      responses.push(response);
      onResponse(Object.assign(response, { statusCode, headers }) as unknown as IncomingMessage);
    });
    return emitter as ClientRequest;
  });
  assert.deepEqual(await readProviderImage(signedUrl.href), png);
  await assert.rejects(downloadProviderMedia(signedUrl, 7), code("OUTPUT_TOO_LARGE"));
  statusCode = 302;
  headers = { location: "https://another.example.invalid/file" };
  payload = Buffer.alloc(0);
  await assert.rejects(downloadProviderMedia(signedUrl, 1024), code("OUTPUT_DOWNLOAD_FAILED"));
  assert.equal(request.mock.callCount(), 3);
  assert.ok(responses.every(response => response.destroyed));
});
