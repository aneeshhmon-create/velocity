import fs from "node:fs";
import path from "node:path";
import { createStamp, plainLine } from "./stamp.js";

const RECHECK_MS = 5000;

export const createWriter = (output, zone, limit) => {
  const writer = { dropped: 0 };
  const backlog = [];
  let backlogSize = 0;
  let writing = false;
  let fd = null;
  let currentPath = "";
  let lastCheck = 0;
  let failing = false;

  const toStdio = typeof output === "string";
  const stdio = () => (output === "stderr" ? process.stderr : process.stdout);

  const complainOnce = (message, error) => {
    if (failing) return;
    failing = true;
    console.error(message, error);
  };

  const releaseFile = () => {
    if (fd === null) return;
    const old = fd;
    fd = null;
    fs.close(old, () => {});
  };

  const acquireFile = (day) => {
    const target = output.file.includes("{day}") ? output.file.replaceAll("{day}", day) : output.file;
    const now = Date.now();
    const due = now - lastCheck >= RECHECK_MS;
    if (due) lastCheck = now;

    if (currentPath !== target || fd === null || (due && !fs.existsSync(target))) {
      releaseFile();
      currentPath = target;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fd = fs.openSync(target, "a");
        failing = false;
      } catch (error) {
        complainOnce(`[velocity] Failed to open the log file ${target}:`, error);
      }
    }
    return fd;
  };

  const announceLoss = () => {
    if (!writer.dropped) return;
    const count = writer.dropped;
    writer.dropped = 0;
    const stamp = createStamp(zone);
    stamp.tick();
    writer.write(
      stamp.day(),
      plainLine(stamp, `[velocity] ${count} log lines were dropped, because the log couldn't be written as fast as they came`),
      0,
      false
    );
  };

  const pump = () => {
    if (writing || !backlog.length) return;
    const { day, text } = backlog[0];
    const target = acquireFile(day);
    if (target === null) {
      backlog.shift();
      backlogSize -= text.length;
      return pump();
    }
    writing = true;
    fs.write(target, text, (error) => {
      writing = false;
      backlog.shift();
      backlogSize -= text.length;
      if (error) {
        complainOnce(`[velocity] Failed to write to the log file ${currentPath}:`, error);
        releaseFile();
      } else {
        announceLoss();
      }
      pump();
    });
  };

  writer.write = (day, text, lines, mayDrop) => {
    if (toStdio) {
      if (mayDrop && stdio().writableLength > limit) {
        writer.dropped += lines;
        return false;
      }
      stdio().write(text);
      announceLoss();
      return true;
    }
    if (mayDrop && backlogSize + text.length > limit) {
      writer.dropped += lines;
      return false;
    }
    backlog.push({ day, text });
    backlogSize += text.length;
    pump();
    return true;
  };

  writer.writeSync = (last) => {
    const pending = backlog.splice(writing ? 1 : 0);
    if (last) pending.push(last);
    for (const { day, text } of pending) {
      backlogSize -= text.length;
      if (toStdio) {
        stdio().write(text);
        continue;
      }
      const target = acquireFile(day);
      if (target === null) continue;
      try {
        fs.writeSync(target, text);
      } catch {}
    }
  };

  return writer;
};
