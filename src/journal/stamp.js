const DIVIDER = "-".repeat(39);

export const pad = (n, width = 2) => String(n).padStart(width, "0");

export const createStamp = (zone) => {
  const stamp = { date: "", offset: "Z", millis: 0 };
  let lastSecond = -1;

  const format = (d) => {
    const local = zone === "local";
    const get = (utc, loc) => (local ? d[loc]() : d[utc]());
    stamp.date =
      `${pad(get("getUTCFullYear", "getFullYear"), 4)}-${pad(get("getUTCMonth", "getMonth") + 1)}-${pad(get("getUTCDate", "getDate"))} ` +
      `${pad(get("getUTCHours", "getHours"))}:${pad(get("getUTCMinutes", "getMinutes"))}:${pad(get("getUTCSeconds", "getSeconds"))}`;
    if (local) {
      const offset = -d.getTimezoneOffset();
      const minutes = Math.abs(offset);
      stamp.offset = `${offset < 0 ? "-" : "+"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    } else {
      stamp.offset = "Z";
    }
  };

  stamp.tick = () => {
    const now = Date.now();
    const second = Math.floor(now / 1000);
    stamp.millis = now - second * 1000;
    if (second !== lastSecond) {
      lastSecond = second;
      format(new Date(second * 1000));
    }
  };
  stamp.day = () => stamp.date.slice(0, 10);
  stamp.iso = () =>
    `${stamp.date.slice(0, 10)}T${stamp.date.slice(11)}.${pad(stamp.millis, 3)}${stamp.offset}`;
  return stamp;
};

export const plainLine = (stamp, text) => `${stamp.date} -- ${text}\n`;

export const faultBlock = (stamp, error) => {
  const lines = [DIVIDER, stamp.date];
  if (error?.name) lines.push(`Error Name: ${error.name}`);
  if (error?.message) lines.push(`Error Message: ${error.message}`);
  if (error?.stack) lines.push(`Error Stack:\n${error.stack}`);
  lines.push(DIVIDER, "");
  return lines.join("\n");
};
