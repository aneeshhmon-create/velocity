export const TOKENS = ["date", "iso", "ip", "method", "url", "path", "status", "status_message", "ms", "us", "bytes"];
export const DEFAULT_PATTERN = "{date} -- {ip} -- {method} {url} {status} {status_message} -- {ms} ms";

export const compilePattern = (pattern) => {
  const parts = [];
  let rest = pattern;
  for (let open = rest.indexOf("{"); open !== -1; open = rest.indexOf("{")) {
    const close = rest.indexOf("}", open);
    if (close === -1) {
      throw new Error(`[velocity] The request log pattern has a { without a }: "${pattern}"`);
    }
    const name = rest.slice(open + 1, close);
    if (open > 0) parts.push({ text: rest.slice(0, open) });
    if (TOKENS.includes(name)) {
      parts.push({ field: name });
    } else if (name.startsWith("header:") && name.length > 7) {
      parts.push({ header: name.slice(7).toLowerCase() });
    } else {
      throw new Error(
        `[velocity] Unknown name {${name}} in the request log pattern. The names are ${TOKENS.map((f) => `{${f}}`).join(" ")} and {header:NAME}.`
      );
    }
    rest = rest.slice(close + 1);
  }
  if (rest) parts.push({ text: rest });
  return parts;
};
