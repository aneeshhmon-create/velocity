export const openapi = (spec, prefix = "/api-docs") => {
  const bootScript = `window.onload = function() {
  SwaggerUIBundle({
    url: "${prefix}/spec.json",
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: "StandaloneLayout"
  });
};`;

  return (req, res, next) => {
    switch (req.url) {
      case prefix:
      case `${prefix}/`:
        res.writeHead(302, { Location: `${prefix}/index.html` });
        return res.end();
      case `${prefix}/spec.json`:
        return res.sendJson(spec);
      case `${prefix}/swagger-bootScript.js`:
        res.setHeader("Content-Type", "application/javascript");
        return res.end(bootScript);
      default:
        return next();
    }
  };
};
