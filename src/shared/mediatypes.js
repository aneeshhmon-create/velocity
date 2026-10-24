export const mediaTypes = {
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  eot: "application/vnd.ms-fontobject",
  otf: "font/otf",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
  gif: "image/gif",
  ico: "image/x-icon",
  json: "application/json",
  map: "application/json",
  webmanifest: "application/manifest+json",
  xml: "application/xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  webp: "image/webp",
  avif: "image/avif"
};

export const extOf = (file) => {
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(dot + 1) : "";
};

export const mediaFor = (file) => mediaTypes[extOf(file)];
