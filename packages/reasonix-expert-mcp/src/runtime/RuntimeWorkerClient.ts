import { spawn, type SpawnResult } from "./spawn";
import { encodeRequestFrame, parseResponseFrame, type JsonRpcId } from "./protocol";
import { RuntimeWorkerError } from "./errors";

export { RuntimeWorkerError } from "./errors";

export interface RuntimeWorkerClientOptions {
  command: string[];
  requestTimeoutMs: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RuntimeWorkerClient {
  private readonly command: string[];
  private readonly requestTimeoutMs: number;
  private process: SpawnResult | null = null;
  private nextRequestNumber = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private stopping = false;

  constructor(options: RuntimeWorkerClientOptions) {
    this.command = options.command;
    this.requestTimeoutMs = options.requestTimeoutMs;
  }

  isRunning(): boolean {
    return this.process !== null;
  }

  async call(method: string, params: unknown = {}): Promise<unknown> {
    const proc = await this.ensureStarted();
    const id = `REQ-${this.nextRequestNumber++}`;
    const frame = encodeRequestFrame(id, method, params);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(RuntimeWorkerError.unavailable(`worker request ${id} timed out`));
        void this.stopProcess();
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const writer = proc.stdin.getWriter();
      writer.write(new TextEncoder().encode(frame)).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(RuntimeWorkerError.unavailable("failed to write worker request", error));
        void this.stopProcess();
      });
      writer.releaseLock();
    });
  }

  async shutdown(): Promise<unknown> {
    if (!this.process) {
      return null;
    }

    this.stopping = true;
    const proc = this.process;
    try {
      const result = await this.call("runtime.shutdown", {});
      await proc.exitCode.catch(() => undefined);
      return result;
    } finally {
      this.process = null;
      this.stopping = false;
    }
  }

  async restart(): Promise<void> {
    await this.stopProcess();
    await this.start();
  }

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    let proc: SpawnResult;
    try {
      proc = await spawn({ command: this.command });
    } catch (error) {
      throw RuntimeWorkerError.unavailable("failed to start runtime worker", error);
    }

    this.process = proc;
    void this.readStdout(proc);
    void this.drainStderr(proc);
    void proc.exitCode.then((exitCode) => this.handleExit(proc, exitCode));
  }

  private async ensureStarted(): Promise<SpawnResult> {
    await this.start();
    const proc = this.process;
    if (!proc) {
      throw RuntimeWorkerError.unavailable("runtime worker is unavailable");
    }
    return proc;
  }

  private async readStdout(proc: SpawnResult): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      const reader = proc.stdout.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          this.handleResponseLine(line);
          newlineIndex = buffer.indexOf("\n");
        }
      }
    } catch (error) {
      this.rejectAll(RuntimeWorkerError.unavailable("failed to read worker stdout", error));
    }
  }

  private handleResponseLine(line: string): void {
    let response;
    try {
      response = parseResponseFrame(line);
    } catch (error) {
      this.rejectAll(error);
      void this.stopProcess();
      return;
    }

    if (response.id == null) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if ("error" in response) {
      pending.reject(RuntimeWorkerError.fromJsonRpcError(response.error));
      return;
    }
    pending.resolve(response.result);
  }

  private async drainStderr(proc: SpawnResult): Promise<void> {
    const reader = proc.stderr.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // Diagnostics are non-authoritative for the client contract.
    }
  }

  private handleExit(proc: SpawnResult, exitCode: number): void {
    if (this.process !== proc) return;
    this.process = null;
    if (this.stopping && exitCode === 0) return;
    this.rejectAll(
      RuntimeWorkerError.unavailable(`runtime worker exited with code ${exitCode}`),
    );
  }

  private async stopProcess(): Promise<void> {
    const proc = this.process;
    if (!proc) return;
    this.process = null;
    proc.kill();
    await proc.exitCode.catch(() => undefined);
    this.rejectAll(RuntimeWorkerError.unavailable("runtime worker stopped"));
  }

  private rejectAll(error: unknown): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}




