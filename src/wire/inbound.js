import { NO_VARS } from "../paths/trie.js";

export const shapeInbound = (req) => {
  let parsedSearch;

  req.payload = undefined;
  req.vars = NO_VARS;

  Object.defineProperty(req, "search", {
    enumerable: true,
    get() {
      if (parsedSearch) return parsedSearch;
      const url = req.url || "";
      const at = url.indexOf("?");
      parsedSearch =
        at === -1 ? NO_VARS : Object.fromEntries(new URLSearchParams(url.slice(at + 1)));
      return parsedSearch;
    }
  });

  return req;
};
