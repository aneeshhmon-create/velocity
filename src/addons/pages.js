import path from "node:path";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sendSqueezed } from "../wire/squeeze.js";
import { fault, faultCodes, isHangup } from "../shared/faults.js";
import { mediaFor, extOf } from "../shared/mediatypes.js";

const HOLDBACK = 128;
const MARKUP =
  /<velocity\s+include="([^"]+)"\s*\/?>|<velocity\s+html=\{([^}]+)\}\s*\/?>|\{\{([^}]+)\}\}/g;
const TAG_EDGES = [
  ["{{", "}}"],
  ["<velocity", ">"]
];

const escapeMarkup = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const drain = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

const createPageStream = (data, baseDir) => {
  let held = "";

  const fill = async (stream, text) => {
    let cursor = 0;
    for (const match of text.matchAll(MARKUP)) {
      if (match.index > cursor) stream.push(text.slice(cursor, match.index));
      const [whole, include, raw, escaped] = match;

      if (include !== undefined) {
        const file = path.resolve(baseDir, include);
        const nested = createPageStream(data, path.dirname(file));
        nested.end(Buffer.from(await readFile(file, "utf8")));
        stream.push(await drain(nested));
      } else {
        const value = data[(raw ?? escaped).trim()];
        if (value !== undefined) stream.push(raw !== undefined ? String(value) : escapeMarkup(String(value)));
      }
      cursor = match.index + whole.length;
    }
    if (cursor < text.length) stream.push(text.slice(cursor));
  };

  const cutPoint = (text) => {
    let boundary = text.length - HOLDBACK;
    for (const [open, close] of TAG_EDGES) {
      const start = text.lastIndexOf(open, boundary - 1);
      if (start === -1) continue;
      const end = text.indexOf(close, start + open.length);
      if (end === -1 || end >= boundary) boundary = Math.min(boundary, start);
    }
    return boundary;
  };

  const stream = new Transform({
    transform(chunk, _encoding, done) {
      const text = held + chunk.toString("utf8");
      if (text.length <= HOLDBACK) {
        held = text;
        return done();
      }
      const boundary = cutPoint(text);
      held = text.slice(boundary);
      const ready = text.slice(0, boundary);
      if (!ready) return done();
      fill(stream, ready).then(() => done(), done);
    },
    flush(done) {
      if (!held) return done();
      fill(stream, held).then(() => done(), done);
    }
  });

  return stream;
};

export const pages = () => (req, res, next) => {
  res.view = async (filePath, data, mime) => {
    if (res.headersSent) return;
    mime ??= mediaFor(filePath);
    if (!mime) {
      throw fault(
        `MIME type is missing for "${filePath}". Pass it as the third argument or register the extension via velocity({ mediaTypes: { ${extOf(filePath) || "ext"}: "..." } }).`,
        { code: faultCodes.noMediaType }
      );
    }

    const file = path.resolve(filePath);
    const output = () => createPageStream(data, path.dirname(file));

    try {
      if (res.meta.compression) {
        const transform = output();
        pipeline(createReadStream(file), transform).catch(() => {});
        await sendSqueezed(res, mime, transform, res.meta.compression);
        return;
      }
      res.setHeader("Content-Type", mime);
      await pipeline(createReadStream(file), output(), res);
    } catch (err) {
      throw fault(`Failed to render "${filePath}." Error: ${err}`, {
        code: faultCodes.viewFailed,
        hungUp: isHangup(err)
      });
    }
  };
  next();
};

export const pageToString = async (filePath, data) => {
  const file = path.resolve(filePath);
  const transform = createPageStream(data, path.dirname(file));
  createReadStream(file).pipe(transform);
  return (await drain(transform)).toString("utf8");
};
