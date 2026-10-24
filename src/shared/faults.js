export const faultCodes = Object.freeze({
  noMediaType: "VELOCITY_ERR_NO_MEDIA_TYPE",
  assetMissing: "VELOCITY_ERR_ASSET_MISSING",
  notAnAsset: "VELOCITY_ERR_NOT_AN_ASSET",
  sendFailed: "VELOCITY_ERR_SEND_FAILED",
  badJson: "VELOCITY_ERR_BAD_JSON",
  bodyTooBig: "VELOCITY_ERR_BODY_TOO_BIG",
  shortSecret: "VELOCITY_ERR_SHORT_SECRET",
  squeezeOff: "VELOCITY_ERR_SQUEEZE_OFF",
  viewsOff: "VELOCITY_ERR_VIEWS_OFF",
  routeClash: "VELOCITY_ERR_ROUTE_CLASH",
  routeInvalid: "VELOCITY_ERR_ROUTE_INVALID",
  missingClash: "VELOCITY_ERR_MISSING_CLASH",
  viewFailed: "VELOCITY_ERR_VIEW_FAILED"
});

const hangupCodes = new Set([
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_DESTROYED",
  "ECONNRESET",
  "EPIPE"
]);

export const fault = (message, { code, status, hungUp } = {}) => {
  const err = Object.assign(new Error(message), { velocityFault: true });
  if (code) err.code = code;
  if (status) err.status = status;
  if (hungUp) err.clientDisconnect = true;
  Error.captureStackTrace(err, fault);
  return err;
};

export const isHangup = (err) => hangupCodes.has(err?.code);
