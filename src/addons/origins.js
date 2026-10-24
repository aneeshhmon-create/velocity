import { mergeVary } from "../wire/squeeze.js";

const accepts = async (origin, rule) => {
  if (rule === true || rule === "*") return true;
  if (rule === false || !origin) return false;
  if (typeof rule === "string") return rule === origin;
  if (Array.isArray(rule)) return rule.includes(origin);
  if (rule instanceof RegExp) return rule.test(origin);
  if (typeof rule === "function") return Boolean(await rule(origin));
  return false;
};

const csv = (value) => (Array.isArray(value) ? value.join(",") : value);

export const origins = ({
  origin = "*",
  methods = "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders,
  exposedHeaders,
  credentials = false,
  maxAge = 86400,
  preflightContinue = false,
  optionsSuccessStatus = 204
} = {}) => {
  const verbList = csv(methods);
  const allowCsv = csv(allowedHeaders);
  const exposeCsv = csv(exposedHeaders);

  return async (req, res, next) => {
    const requestOrigin = req.headers.origin;
    if (!requestOrigin || !(await accepts(requestOrigin, origin))) return next();

    const allowOrigin = origin === "*" && !credentials ? "*" : requestOrigin;
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    if (allowOrigin !== "*") mergeVary(res, "Origin");
    if (credentials) res.setHeader("Access-Control-Allow-Credentials", "true");
    if (exposeCsv) res.setHeader("Access-Control-Expose-Headers", exposeCsv);

    const preflight =
      req.method === "OPTIONS" && req.headers["access-control-request-method"] !== undefined;
    if (!preflight) return next();

    res.setHeader("Access-Control-Allow-Methods", verbList);

    const requested = req.headers["access-control-request-headers"];
    if (allowCsv) res.setHeader("Access-Control-Allow-Headers", allowCsv);
    else if (origin !== "*") res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    else if (requested) res.setHeader("Access-Control-Allow-Headers", requested);

    res.setHeader("Access-Control-Max-Age", String(maxAge));

    if (preflightContinue) return next();
    res.statusCode = optionsSuccessStatus;
    res.end();
  };
};
