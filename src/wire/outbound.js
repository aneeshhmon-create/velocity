import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { sendSqueezed } from "./squeeze.js";
import { fault, faultCodes, isHangup } from "../shared/faults.js";
import { mediaFor, extOf } from "../shared/mediatypes.js";

const noMediaTypeFault = (file, position) =>
  fault(
    `MIME type is missing for "${file}". Pass it as the ${position} argument or register the extension via velocity({ mediaTypes: { ${extOf(file) || "ext"}: "..." } }).`,
    { code: faultCodes.noMediaType }
  );

const outboundApi = {
  setStatus(code) {
    this.statusCode = code;
    return this;
  },

  asDownload(filename) {
    this.setHeader("Content-Disposition", filename ? `attachment; filename="${filename}"` : "attachment");
    return this;
  },

  goTo(location) {
    this.writeHead(302, { Location: location });
    this.end();
  },

  sendJson(data) {
    if (this.headersSent) return Promise.resolve();
    const body = JSON.stringify(data);
    if (this.meta.compression) {
      return sendSqueezed(this, "application/json", body, this.meta.compression);
    }
    this.setHeader("Content-Type", "application/json");
    this.end(body);
    return Promise.resolve();
  },

  sendSqueezed(mime, body, size) {
    if (this.headersSent) return Promise.resolve();
    if (!this.meta.compression) {
      throw fault(
        "compression is not enabled. Pass `compression` to velocity({ compression: true | { ... } }) to use res.sendSqueezed.",
        { code: faultCodes.squeezeOff }
      );
    }
    return sendSqueezed(this, mime, body, this.meta.compression, size);
  },

  view() {
    throw fault(
      "views are not enabled. Add pages() via app.attach(pages()) to use res.view.",
      { code: faultCodes.viewsOff }
    );
  },

  async sendAsset(path, mime) {
    if (this.headersSent) return;
    mime ??= mediaFor(path);
    if (!mime) throw noMediaTypeFault(path, "second");

    try {
      const stat = await fs.stat(path);
      if (!stat.isFile()) {
        throw fault(`Not a file: ${path}`, { code: faultCodes.notAnAsset });
      }

      if (this.meta.compression) {
        await sendSqueezed(this, mime, createReadStream(path), this.meta.compression, stat.size);
        return;
      }

      this.setHeader("Content-Type", mime);
      this.setHeader("Content-Length", String(stat.size));
      await pipeline(createReadStream(path), this);
    } catch (err) {
      if (err?.code === faultCodes.notAnAsset) throw err;
      if (err?.code === "ENOENT") {
        throw fault(`File not found: ${path}`, { code: faultCodes.assetMissing });
      }
      throw fault(`Failed to send file: ${path}`, {
        code: faultCodes.sendFailed,
        hungUp: isHangup(err)
      });
    }
  }
};

const meterBytes = (res) => {
  const sizeOf = (chunk, encoding) => {
    if (res.req?.method === "HEAD") return 0;
    if (typeof chunk === "string") return Buffer.byteLength(chunk, typeof encoding === "string" ? encoding : "utf8");
    return chunk instanceof Uint8Array ? chunk.byteLength : 0;
  };
  const { write, end } = res;
  res.write = (chunk, encoding, cb) => {
    res.meta.bytes += sizeOf(chunk, encoding);
    return write.call(res, chunk, encoding, cb);
  };
  res.end = (chunk, encoding, cb) => {
    res.meta.bytes += sizeOf(chunk, encoding);
    return end.call(res, chunk, encoding, cb);
  };
};

export class Outbound extends http.ServerResponse {
  constructor(req, options) {
    super(req, options);
    this.meta = undefined;
  }
}

Object.assign(Outbound.prototype, outboundApi);

export const shapeOutbound = (res, meta, metering) => {
  res.meta = meta;
  if (metering) meterBytes(res);
  return res;
};
