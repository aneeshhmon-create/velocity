import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { resolveSqueeze } from "../wire/squeeze.js";
import { fault, faultCodes, isHangup } from "../shared/faults.js";
import { mediaTypes } from "../shared/mediatypes.js";
import { createTrie } from "../paths/trie.js";
import { startJournal, standbyJournal, wantsTrafficLines } from "../journal/journal.js";
import { createChain } from "./chain.js";
import { shapeInbound } from "../wire/inbound.js";
import { shapeOutbound } from "../wire/outbound.js";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

export const createVelocity = (options = {}) => {
  const server = options.https ? https.createServer(options.https) : http.createServer();
  const trie = createTrie();
  const globals = [];
  const compression = options.compression ? resolveSqueeze(options.compression) : undefined;
  const journal = options.journal ? startJournal(options.journal) : undefined;
  let faultHandler;
  let missingHandler;

  if (options.mediaTypes) Object.assign(mediaTypes, options.mediaTypes);

  server.on("close", () => {
    if (journal) journal.release();
    else if (wantsTrafficLines()) standbyJournal().release();
  });

  const handleFault = async (error, req, res) => {
    if (res.headersSent) req.socket?.destroy();
    else res.setHeader("Connection", "close");

    if (isHangup(error) && !error.clientDisconnect) error.clientDisconnect = true;

    try {
      await faultHandler?.(error, req, res);
    } catch (handlerFailure) {
      console.error("[velocity] error handler failed while processing:", error, "\nReason:", handlerFailure);
      if (!res.headersSent) {
        try {
          res.statusCode = 500;
          res.end();
        } catch {}
      }
    }
  };

  const chain = createChain(handleFault);

  const route = async (req, res) => {
    const path = req.url.split("?")[0];
    const match = trie.lookup(req.method || "", path);

    if (match) {
      req.vars = match.vars;
      return chain.run(match.links, req, res);
    }

    if (missingHandler) {
      try {
        return await missingHandler(req, res);
      } catch (error) {
        return handleFault(error, req, res);
      }
    }

    return res.setStatus(404).sendJson({ error: `Cannot ${req.method} ${path}` });
  };

  server.on("request", async (req, res) => {
    const tracking = wantsTrafficLines();
    const meta = { compression, bytes: 0 };
    if (tracking) Object.assign(meta, { started: performance.now(), url: req.url || "", journal });

    shapeInbound(req);
    shapeOutbound(res, meta, tracking);
    await chain.run(globals, req, res, () => route(req, res));
  });

  const buildLinks = (args) => {
    const handler = args.at(-1);
    if (typeof handler !== "function") {
      throw new Error("Route definition must include a handler");
    }
    const middleware = args.slice(0, -1).flat();
    return [...middleware, (req, res) => handler(req, res)];
  };

  const instance = {
    add(method, path, ...args) {
      trie.insert(method, path, buildLinks(args));
      return instance;
    },

    attach(middleware) {
      globals.push(middleware);
      return instance;
    },

    catchErrors(handler) {
      faultHandler = handler;
      return instance;
    },

    missing(handler) {
      if (missingHandler) {
        throw fault("A not-found handler is already registered. Only one can be set per instance.", {
          code: faultCodes.missingClash
        });
      }
      missingHandler = handler;
      return instance;
    },

    start: (...args) => server.listen(...args),
    location: () => server.address(),
    stop: (cb) => server.close(cb),
    raw: server
  };

  for (const method of METHODS) {
    instance[method] = (path, ...args) => instance.add(method, path, ...args);
  }

  return instance;
};
