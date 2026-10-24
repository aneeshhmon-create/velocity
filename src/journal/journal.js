import { STATUS_CODES } from "node:http";
import { performance } from "node:perf_hooks";
import { createStamp, faultBlock, plainLine } from "./stamp.js";
import { TOKENS, DEFAULT_PATTERN, compilePattern } from "./pattern.js";
import { createWriter } from "./writer.js";

const BACKLOG_SLOTS = 64;

const headerValue = (req, name) => {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
};

let trafficRuleCount = 0;
const journals = new Set();
let current;
let spare;

export const createTrafficRule = (options = {}) => {
  trafficRuleCount++;
  return {
    parts: compilePattern(options.format ?? DEFAULT_PATTERN),
    ipHeader: options.ipHeader?.toLowerCase(),
    onlyErrors: options.onlyErrors ?? false,
    slowerThan: options.slowerThan,
    sample: Math.max(options.sample ?? 1, 1),
    skip: options.skip,
    tally: 0
  };
};

export const createJournal = (options = {}) => {
  const zone = options.timeZone ?? "utc";
  const bufferSize = options.bufferSize ?? 64 * 1024;
  const limit = Math.max(bufferSize, 1024) * BACKLOG_SLOTS;
  const out = createWriter(options.output ?? "stdout", zone, limit);
  const err = createWriter(options.errors ?? "stderr", zone, limit);
  const stamp = createStamp(zone);

  let buffer = "";
  let lines = 0;
  let pendingDay = "";

  const release = () => {
    if (!buffer) return;
    const text = buffer;
    const count = lines;
    buffer = "";
    lines = 0;
    out.write(pendingDay, text, count, true);
  };

  const openLine = () => {
    stamp.tick();
    const day = stamp.day();
    if (day !== pendingDay) {
      release();
      pendingDay = day;
    }
  };

  const closeLine = (line) => {
    buffer += line + "\n";
    lines++;
    if (buffer.length >= bufferSize) release();
  };

  const render = (piece, req, res, url, took, rule) => {
    if ("text" in piece) return piece.text;
    if ("header" in piece) return headerValue(req, piece.header) || "-";
    switch (piece.field) {
      case "date":
        return stamp.date;
      case "iso":
        return stamp.iso();
      case "ip":
        return (rule.ipHeader && headerValue(req, rule.ipHeader)) || req.socket?.remoteAddress || "-";
      case "method":
        return req.method;
      case "url":
        return url;
      case "path":
        return url.split("?")[0];
      case "status":
        return res.statusCode;
      case "status_message":
        return res.statusMessage || STATUS_CODES[res.statusCode] || "";
      case "ms":
        return took.toFixed(2);
      case "us":
        return Math.round(took * 1000);
      case "bytes":
        return res.meta.bytes;
    }
  };

  const traffic = (rule, req, res, url, started) => {
    const took = performance.now() - started;
    if (rule.onlyErrors && res.statusCode < 400) return;
    if (rule.slowerThan !== undefined && took <= rule.slowerThan) return;
    if (rule.skip?.(req, res)) return;
    if (rule.sample > 1 && rule.tally++ % rule.sample !== 0) return;

    openLine();
    closeLine(rule.parts.map((piece) => render(piece, req, res, url, took, rule)).join(""));
  };

  const note = (value) => {
    stamp.tick();
    if (typeof value !== "object" || value === null) {
      openLine();
      closeLine(`${stamp.date} -- ${value}`);
      return;
    }
    err.write(stamp.day(), faultBlock(stamp, value), 1, false);
  };

  const flushNow = () => {
    const text = buffer;
    buffer = "";
    lines = 0;
    out.writeSync(text ? { day: pendingDay, text } : undefined);
    err.writeSync();
  };

  setInterval(release, Math.max(options.flushEvery ?? 100, 1)).unref();

  const instance = { traffic, note, release, flushNow };
  journals.add(instance);
  return instance;
};

export const startJournal = (options) => (current = createJournal(options));

export const standbyJournal = () => (spare ??= createJournal());

export const wantsTrafficLines = () => trafficRuleCount > 0;

process.on("exit", () => {
  for (const instance of journals) instance.flushNow();
});

const trafficLogger = (options) => {
  const rule = createTrafficRule(options);
  return (req, res, next) => {
    if (!res.meta.trafficRule) {
      res.once("close", () =>
        (res.meta.journal ?? standbyJournal()).traffic(
          res.meta.trafficRule,
          req,
          res,
          res.meta.url,
          res.meta.started
        )
      );
    }
    res.meta.trafficRule = rule;
    next();
  };
};

const record = (value) => {
  if (current) return current.note(value);
  const stamp = createStamp("utc");
  stamp.tick();
  if (typeof value !== "object" || value === null) {
    process.stdout.write(plainLine(stamp, String(value)));
  } else {
    process.stderr.write(faultBlock(stamp, value));
  }
};

export const journal = Object.assign(record, { traffic: trafficLogger });
