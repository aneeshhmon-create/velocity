import { fault, faultCodes } from "../shared/faults.js";

const looksJson = (type) => Boolean(type) && (type.startsWith("application/json") || type.includes("+json"));

export const payload = ({ limit = 1024 * 1024 } = {}) =>
  (req, res, next) => {
    if (!looksJson(req.headers["content-type"])) return next();

    const chunks = [];
    let total = 0;

    const detach = () => {
      req.pause();
      req.off("data", takeChunk);
      req.off("end", finishBody);
    };

    function takeChunk(chunk) {
      total += chunk.length;
      if (total > limit) {
        detach();
        return next(fault("JSON body too large", { code: faultCodes.bodyTooBig, status: 413 }));
      }
      chunks.push(chunk);
    }

    function finishBody() {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        req.payload = raw ? JSON.parse(raw) : {};
      } catch {
        return next(fault("Invalid JSON format", { code: faultCodes.badJson, status: 400 }));
      }
      next();
    }

    req.on("data", takeChunk);
    req.on("end", finishBody);
  };
