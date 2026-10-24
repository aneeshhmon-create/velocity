import fs from "node:fs";
import path from "node:path";
import { mediaFor } from "../shared/mediatypes.js";

export const assets = (folder, { prefix = "", live = false, exclude = [] } = {}) => {
  const base = path.resolve(folder);
  const skipped = exclude.map((record) => path.join(base, record));
  const isSkipped = (file) => skipped.some((record) => file.startsWith(record));
  const pathnameOf = (req) => (typeof req.url === "string" ? req.url.split("?")[0] : null);

  if (live) {
    return async (req, res, next) => {
      const pathname = pathnameOf(req);
      if (pathname === null) return next();

      const file = path.join(base, prefix ? pathname.slice(prefix.length) : pathname);
      const mime = mediaFor(file);
      if (!mime || !file.startsWith(base) || isSkipped(file)) return next();

      const stat = await fs.promises.stat(file).catch(() => null);
      return stat?.isFile() ? res.sendAsset(file, mime) : next();
    };
  }

  const gather = (dir) =>
    fs.readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (isSkipped(full)) return [];
      if (fs.statSync(full).isDirectory()) return gather(full);
      return mediaFor(name) ? [full] : [];
    });

  const index = new Map(
    gather(folder).map((full) => [
      prefix + "/" + path.relative(folder, full),
      { path: full, mime: mediaFor(full) }
    ])
  );

  return (req, res, next) => {
    const pathname = pathnameOf(req);
    const record = pathname === null ? undefined : index.get(pathname);
    return record ? res.sendAsset(record.path, record.mime) : next();
  };
};
