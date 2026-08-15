import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import readline from "node:readline";

export class AppServerClient extends EventEmitter {
  constructor({ command = process.env.CODEX_BIN || "codex", requestTimeoutMs = 15_000 } = {}) {
    super();
    this.command = command;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.process = null;
    this.ready = false;
  }

  async connect() {
    if (this.ready) return;
    if (this.process) throw new Error("Codex App Server is already starting");

    const child = spawn(this.command, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.process = child;

    child.once("error", (error) => {
      this.#failAll(error);
      if (this.process === child) {
        this.process = null;
        this.ready = false;
      }
    });
    child.once("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      this.#failAll(new Error(`Codex App Server exited with ${detail}`));
      if (this.process === child) {
        this.process = null;
        this.ready = false;
      }
      this.emit("disconnected");
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.emit("stderr", chunk));

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.#handleLine(line));

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "codex_usage_widget",
          title: "Codex Usage Widget",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
          optOutNotificationMethods: [
            "item/agentMessage/delta",
            "item/reasoning/summaryTextDelta",
            "command/exec/outputDelta",
          ],
        },
      });
      this.notify("initialized", {});
      this.ready = true;
    } catch (error) {
      // An initialize timeout used to leave a live child behind. Every later
      // refresh then failed with "already starting" and the widget stayed stale
      // forever. Drop that child so the next refresh can make a clean attempt.
      if (this.process === child) {
        this.process = null;
        this.ready = false;
      }
      child.kill("SIGTERM");
      throw error;
    }
  }

  request(method, params) {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error("Codex App Server is not connected"));
    }

    const id = this.nextId++;
    const message = params === undefined ? { method, id } : { method, id, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timeout, method });
      this.#send(message);
    });
  }

  notify(method, params = {}) {
    this.#send({ method, params });
  }

  close() {
    this.ready = false;
    this.process?.kill("SIGTERM");
  }

  #send(message) {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("protocolError", new Error(`Invalid JSON from app-server: ${line}`));
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.emit("unmatchedResponse", message);
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${pending.method}: ${message.error.message || "unknown error"}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) this.emit("notification", message);
  }

  #failAll(error) {
    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    this.pending.clear();
  }
}
