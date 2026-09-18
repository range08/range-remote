import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { RpcResponseSchema, type RpcRequest, type RpcResponse } from "@range-remote/shared";
import { config } from "./config.js";
import type { Store } from "./store.js";

type Pending = {
  deviceId: string;
  resolve: (value: RpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class AgentHub {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly pending = new Map<string, Pending>();
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(private readonly store: Store) {}

  attach(server: HttpServer): void {
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname !== "/agent/ws") return;
      this.wss.handleUpgrade(request, socket, head, (ws) => this.accept(ws, request));
    });
  }

  isOnline(deviceId: string): boolean {
    return this.sockets.get(deviceId)?.readyState === WebSocket.OPEN;
  }

  disconnect(deviceId: string): void {
    const ws = this.sockets.get(deviceId);
    this.sockets.delete(deviceId);
    if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, "Device removed");
    this.rejectPendingForDevice(deviceId, new Error("Device was removed"));
  }

  async call(
    deviceId: string,
    kind: RpcRequest["kind"],
    params: Record<string, unknown>
  ): Promise<unknown> {
    const ws = this.sockets.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Device is offline");

    const id = randomUUID();
    const payload: RpcRequest = { id, kind, params };

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Device request timed out"));
      }, config.AGENT_REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        deviceId,
        timer,
        reject,
        resolve: (response) => {
          if (!response.ok) reject(new Error(response.error ?? "Device operation failed"));
          else resolve(response.result);
        }
      });

      ws.send(JSON.stringify(payload), (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private accept(ws: WebSocket, request: IncomingMessage): void {
    const auth = request.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
    const device = token ? this.store.findDeviceByToken(token) : null;

    if (!device) {
      ws.close(1008, "Unauthorized");
      return;
    }

    const previous = this.sockets.get(device.id);
    if (previous && previous.readyState === WebSocket.OPEN) previous.close(1000, "Replaced");

    this.sockets.set(device.id, ws);
    this.store.touchDevice(device.id);

    ws.on("message", (raw) => {
      try {
        const response = RpcResponseSchema.parse(JSON.parse(raw.toString()));
        const pending = this.pending.get(response.id);
        if (!pending) return;

        clearTimeout(pending.timer);
        this.pending.delete(response.id);
        pending.resolve(response);
      } catch {
        ws.close(1003, "Invalid response");
      }
    });

    ws.on("close", () => {
      if (this.sockets.get(device.id) === ws) {
        this.sockets.delete(device.id);
        this.rejectPendingForDevice(device.id, new Error("Device disconnected"));
      }
    });

    ws.on("error", () => {
      if (this.sockets.get(device.id) === ws) {
        this.sockets.delete(device.id);
        this.rejectPendingForDevice(device.id, new Error("Device connection failed"));
      }
    });
  }

  private rejectPendingForDevice(deviceId: string, error: Error): void {
    for (const [id, pending] of this.pending) {
      if (pending.deviceId !== deviceId) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}
