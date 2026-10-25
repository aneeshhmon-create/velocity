import http from "node:http";
import { NO_VARS } from "../paths/trie.js";

export class Inbound extends http.IncomingMessage {
  #search;

  constructor(socket) {
    super(socket);
    this.payload = undefined;
    this.vars = NO_VARS;
  }

  get search() {
    if (this.#search) return this.#search;
    const url = this.url || "";
    const at = url.indexOf("?");
    this.#search =
      at === -1 ? NO_VARS : Object.fromEntries(new URLSearchParams(url.slice(at + 1)));
    return this.#search;
  }
}
