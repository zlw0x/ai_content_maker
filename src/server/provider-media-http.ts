import dns from "node:dns";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction, type TcpNetConnectOpts } from "node:net";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createUnzip } from "node:zlib";
import { HttpError } from "./errors";

const blocked = new BlockList();
// Private, local, transition, documentation, benchmark, multicast and reserved ranges.
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, prefix);
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blocked.addSubnet(address, prefix, "ipv6");
blocked.addAddress("168.63.129.16"); // Azure platform virtual IP.
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

function isPublicAddress({ address, family }: dns.LookupAddress) {
  if (family === 4 && isIP(address) === 4) return !blocked.check(address);
  return family === 6 && isIP(address) === 6 && !address.includes("%") &&
    globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

const publicLookup: LookupFunction = (hostname, options, callback) => {
  // The socket uses these addresses directly, with no second lookup between check and connect.
  dns.lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    if (!addresses.length || addresses.some(address => !isPublicAddress(address))) {
      return callback(new HttpError(502, "UNSAFE_MEDIA_ADDRESS", "Хранилище провайдера разрешилось в недопустимый адрес"), []);
    }
    if (options.all) return callback(null, addresses);
    const [first] = addresses;
    callback(null, first.address, first.family);
  });
};

export function parseProviderMediaUrl(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname;
    if (url.protocol !== "https:" || url.username || url.password || url.port || !host ||
      isIP(host) || host.startsWith("[") || host === "localhost" ||
      [".localhost", ".local", ".internal"].some(suffix => host.endsWith(suffix))) return null;
    return url;
  } catch {
    return null;
  }
}

function pinnedOptions(url: URL, signal: AbortSignal): https.RequestOptions & Pick<TcpNetConnectOpts, "autoSelectFamily"> {
  return {
    lookup: publicLookup, autoSelectFamily: true, agent: false, rejectUnauthorized: true, servername: url.hostname, signal,
  };
}

export async function downloadProviderMedia(url: URL, maxBytes: number) {
  const signal = AbortSignal.timeout(120_000);
  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      https.get(url, { ...pinnedOptions(url, signal), headers: { "accept-encoding": "gzip, deflate, br" } }, resolve)
        .once("error", reject);
    });
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
      response.destroy();
      throw new HttpError(502, "OUTPUT_DOWNLOAD_FAILED", "Результат пока недоступен");
    }
    if (Number(response.headers["content-length"]) > maxBytes) {
      response.destroy();
      throw new HttpError(502, "OUTPUT_TOO_LARGE", "Результат слишком большой");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    async function collect(source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > maxBytes) throw new HttpError(502, "OUTPUT_TOO_LARGE", "Результат слишком большой");
        chunks.push(chunk);
      }
    }

    const encoding = response.headers["content-encoding"]?.trim().toLowerCase();
    if (!encoding || encoding === "identity") {
      await collect(response);
    } else if (encoding === "gzip" || encoding === "deflate" || encoding === "br") {
      await pipeline(response, encoding === "br" ? createBrotliDecompress() : createUnzip(), collect, { signal });
    } else {
      response.destroy();
      throw new HttpError(502, "OUTPUT_DOWNLOAD_FAILED", "Неподдерживаемое сжатие результата");
    }
    return { body: Buffer.concat(chunks, size), declaredType: (response.headers["content-type"] ?? "").split(";")[0].toLowerCase() };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "OUTPUT_DOWNLOAD_FAILED", "Результат пока недоступен");
  }
}

export async function putProviderMedia(url: URL, body: Buffer, signedHeaders: Record<string, string> = {}) {
  try {
    const headers = new Headers(signedHeaders);
    const host = headers.get("host");
    const length = headers.get("content-length");
    if ((host !== null && host.toLowerCase() !== url.host) || (length !== null && length !== String(body.length)) ||
      ["authorization", "proxy-authorization", "transfer-encoding", "expect", "upgrade"].some(name => headers.has(name))) {
      throw new HttpError(502, "BAD_UPLOAD_HEADERS", "Недопустимые заголовки загрузки");
    }
    headers.set("content-length", String(body.length));
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      https.request(url, {
        ...pinnedOptions(url, AbortSignal.timeout(120_000)), method: "PUT", headers: Object.fromEntries(headers),
      }, resolve).once("error", reject).end(body);
    });
    response.destroy();
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
      throw new HttpError(502, "UPLOAD_FAILED", "Загрузка изображения не удалась");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "UPLOAD_FAILED", "Загрузка изображения не удалась");
  }
}
