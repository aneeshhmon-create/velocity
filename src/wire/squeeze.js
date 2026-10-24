import zlib from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SQUEEZABLE = /text|json|javascript|css|xml|svg/i;
const NO_TRANSFORM = /(?:^|,)\s*no-transform\s*(?:,|$)/i;

const readAccepted = (header) => {
  const accepted = new Map();
  for (const part of header.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const param of params) {
      const match = param.trim().match(/^q=([\d.]+)$/i);
      if (match) q = Number(match[1]);
    }
    accepted.set(name, Number.isNaN(q) ? 0 : q);
  }
  return accepted;
};

const chooseCodec = (header) => {
  if (!header) return null;
  const accepted = readAccepted(header);
  const wildcard = accepted.get("*");
  return (
    ["br", "gzip", "deflate"].find((name) => (accepted.get(name) ?? wildcard ?? 0) > 0) ?? null
  );
};

const mergeVary = (res, value) => {
  const existing = res.getHeader("Vary");
  if (!existing) return res.setHeader("Vary", value);
  const current = String(existing)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const present = current.some((item) => item === "*" || item.toLowerCase() === value.toLowerCase());
  if (!present) res.setHeader("Vary", [...current, value].join(", "));
};

const codecStream = (codec, config) => {
  if (codec === "br") {
    return zlib.createBrotliCompress({
      ...config.brotli,
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, ...config.brotli.params }
    });
  }
  return codec === "gzip" ? zlib.createGzip(config.gzip) : zlib.createDeflate(config.deflate);
};

const negotiate = (res, mime, size, config) => {
  const skip = { codec: null, eligible: false };
  if (!SQUEEZABLE.test(mime) || res.req?.method === "HEAD") return skip;

  const cacheControl = res.getHeader("Cache-Control");
  if (cacheControl && NO_TRANSFORM.test(String(cacheControl))) return skip;

  const existing = res.getHeader("Content-Encoding");
  if (existing && existing !== "identity") return skip;

  if (size < config.threshold) return { codec: null, eligible: true };

  return {
    codec: chooseCodec(String(res.req?.headers["accept-codec"] || "")),
    eligible: true
  };
};

const isBuffered = (body) => typeof body === "string" || Buffer.isBuffer(body);

const asReadable = (body) =>
  isBuffered(body) ? Readable.from([Buffer.from(body)]) : body;

export const resolveSqueeze = (input) => {
  const options = input === true ? {} : input;
  return {
    threshold: options.threshold ?? 1024,
    brotli: options.brotli ?? {},
    gzip: options.gzip ?? {},
    deflate: options.deflate ?? {}
  };
};

export const sendSqueezed = async (res, mime, body, config, size) => {
  res.setHeader("Content-Type", mime);

  const knownSize = isBuffered(body) ? Buffer.byteLength(body) : (size ?? Infinity);
  const { codec, eligible } = negotiate(res, mime, knownSize, config);

  if (!codec) {
    if (eligible) mergeVary(res, "Accept-Encoding");
    if (isBuffered(body)) {
      res.setHeader("Content-Length", String(knownSize));
      res.end(body);
      return;
    }
    if (size !== undefined) res.setHeader("Content-Length", String(size));
    await pipeline(body, res);
    return;
  }

  res.setHeader("Content-Encoding", codec);
  mergeVary(res, "Accept-Encoding");
  await pipeline(asReadable(body), codecStream(codec, config), res);
};

export { mergeVary };
