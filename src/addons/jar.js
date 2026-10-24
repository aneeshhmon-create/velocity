import { createHmac, timingSafeEqual } from "node:crypto";
import { fault, faultCodes } from "../shared/faults.js";

const digest = (value, secret) => createHmac("sha256", secret).update(value).digest("base64url");

const seal = (value, secret) => `s:${value}.${digest(value, secret)}`;

const unseal = (sealedCookies, secret) => {
  const body = sealedCookies.slice(2);
  const dot = body.lastIndexOf(".");
  if (dot === -1) return false;
  const value = body.slice(0, dot);
  const given = Buffer.from(body.slice(dot + 1));
  const expected = Buffer.from(digest(value, secret));
  return given.length === expected.length && timingSafeEqual(expected, given) ? value : false;
};

const decode = (value) => {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const readHeader = (header) => {
  const jar = Object.create(null);
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    if (!key || jar[key] !== undefined) continue;
    let value = pair.slice(eq + 1).trim();
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    jar[key] = decode(value);
  }
  return jar;
};

const toHeader = (name, value, o) => {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? "/"}`];
  if (o.domain) parts.push(`Domain=${o.domain}`);
  if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(o.maxAge / 1000)}`);
  if (o.expires) parts.push(`Expires=${o.expires.toUTCString()}`);
  if (o.httpOnly) parts.push("HttpOnly");
  if (o.secure) parts.push("Secure");
  if (o.sameSite) parts.push(`SameSite=${o.sameSite}`);
  return parts.join("; ");
};

const pushCookie = (res, header) => {
  const existing = res.getHeader("Set-Cookie");
  const list = existing ? [].concat(existing).map(String) : [];
  res.setHeader("Set-Cookie", [...list, header]);
};

export const jar = ({ secret } = {}) => {
  if (secret !== undefined && secret.length < 32) {
    throw fault("Secret must be at least 32 characters. HMAC security is only as strong as the key.", {
      code: faultCodes.shortSecret
    });
  }

  return (req, res, next) => {
    const openCookies = Object.create(null);
    const sealedCookies = Object.create(null);

    for (const [key, value] of Object.entries(readHeader(req.headers.cookie || ""))) {
      if (secret && value.startsWith("s:")) sealedCookies[key] = unseal(value, secret);
      else openCookies[key] = value;
    }

    req.cookieJar = openCookies;
    req.signedJar = sealedCookies;

    res.setCookie = (name, value, options = {}) => {
      if (options.signed && !secret) {
        throw new Error("jar: secret is required to use sealedCookies cookies");
      }
      const stored = options.signed ? seal(value, secret) : value;
      pushCookie(res, toHeader(name, stored, options));
      return res;
    };

    res.dropCookie = (name, options = {}) => {
      pushCookie(res, toHeader(name, "", { ...options, maxAge: 0, expires: new Date(0) }));
      return res;
    };

    next();
  };
};
