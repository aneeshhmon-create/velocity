import { randomBytes, pbkdf2, createHmac, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { fault, faultCodes } from "../shared/faults.js";

const stretch = promisify(pbkdf2);

const fallbacks = {
  iterations: 210_000,
  keylen: 64,
  digest: "sha512",
  saltSize: 32,
  hmacAlgorithm: "sha256",
  tokenIdSize: 20,
  tokenExpiry: 7 * 24 * 60 * 60 * 1000
};

export const hashSecret = async (password, options = {}) => {
  const { iterations, keylen, digest, saltSize } = { ...fallbacks, ...dropUndefined(options) };
  const salt = randomBytes(saltSize);
  const hash = await stretch(password, salt, iterations, keylen, digest);
  return ["pbkdf2", iterations, keylen, digest, salt.toString("hex"), hash.toString("hex")].join(":");
};

export const checkSecret = async (password, stored) => {
  const parts = stored.slice(stored.indexOf(":") + 1).split(":");
  if (parts.length !== 5) return false;
  const [iterText, keyText, digest, saltHex, hashHex] = parts;
  const iterations = parseInt(iterText, 10);
  const keylen = parseInt(keyText, 10);
  if (!digest || !saltHex || !hashHex || Number.isNaN(iterations) || Number.isNaN(keylen)) return false;

  const hash = await stretch(password, Buffer.from(saltHex, "hex"), iterations, keylen, digest);
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === hash.length && timingSafeEqual(hash, expected);
};

function dropUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

export const identity = (options) => {
  if (!options.secret || options.secret.length < 32) {
    throw fault("Secret must be at least 32 characters. HMAC security is only as strong as the key.", {
      code: faultCodes.shortSecret
    });
  }

  const {
    secret,
    saveToken,
    findToken,
    revokeToken,
    tokenExpiry = fallbacks.tokenExpiry,
    hmacAlgorithm = fallbacks.hmacAlgorithm,
    tokenIdSize = fallbacks.tokenIdSize
  } = options;

  const kdfOptions = dropUndefined({
    iterations: options.iterations,
    keylen: options.keylen,
    digest: options.digest,
    saltSize: options.saltSize
  });

  const tagFor = (id) => createHmac(hmacAlgorithm, secret).update(id).digest("hex");

  const tokenIdOf = (token) => {
    const dot = token.indexOf(".");
    if (dot === -1) return null;
    const id = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1), "hex");
    const expected = Buffer.from(tagFor(id), "hex");
    return given.length === expected.length && timingSafeEqual(expected, given) ? id : null;
  };

  const surface = {
    hashSecret: ({ password }) => hashSecret(password, kdfOptions),

    async signIn({ password, hashedPassword, userId }) {
      if (!(await checkSecret(password, hashedPassword))) return null;
      const id = randomBytes(tokenIdSize).toString("hex");
      await saveToken(id, userId, new Date(Date.now() + tokenExpiry));
      return `${id}.${tagFor(id)}`;
    },

    async checkToken(token) {
      const id = token && tokenIdOf(token);
      if (!id) return null;
      const record = await findToken(id);
      if (!record || new Date(record.expiresAt) < new Date()) return null;
      return { userId: record.userId };
    }
  };

  if (revokeToken) {
    surface.signOut = async (token) => {
      const id = tokenIdOf(token);
      if (!id) return false;
      await revokeToken(id);
      return true;
    };
  }

  return (req, res, next) => {
    Object.assign(req, surface);
    next();
  };
};
