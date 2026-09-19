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

type ManagedWebSocket = WebSocket & { isAlive?: boolean };

export class AgentHub {
  private readonly sockets = new Map<string, ManagedWebSocket>();
  private readonly pending = new Map<string, Pending>();
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.AGENT_WS_MAX_PAYLOAD_BYTES,
    perMessageDeflate: false
  });
  private readonly heartbeatTimer: NodeJS.Timeout;

  constructor(private readonly store: Store) {
    this.heartbeatTimer = setInterval(
      () => this.heartbeat(),
      config.AGENT_WS_HEARTBEAT_MS
    );
    this.heartbeatTimer.unref();
  }

  attach(server: HttpServer): void {
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname !== "/agent/ws") {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => this.accept(ws, request));
    });
  }

  isOnline(deviceId: string): boolean {
    return this.sockets.get(deviceId)?.readyState === WebSocket.OPEN;
  }

  disconnect(deviceId: string, reason = "Device removed"): void {
    const ws = this.sockets.get(deviceId);
    this.sockets.delete(deviceId);
    if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, reason);
    this.rejectPendingForDevice(deviceId, new Error(reason));
  }

  async call(
    deviceId: string,
    kind: RpcRequest["kind"],
    params: Record<string, unknown>,
    timeoutMs = config.AGENT_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    const ws = this.sockets.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Device is offline");
    if (this.pending.size >= config.MAX_PENDING_AGENT_REQUESTS) {
      throw new Error("Relay is busy; try again shortly");
    }
    if (this.pendingForDevice(deviceId) >= config.MAX_PENDING_AGENT_REQUESTS_PER_DEVICE) {
      throw new Error("Too many concurrent requests for this device");
    }
    if (ws.bufferedAmount > config.AGENT_WS_MAX_PAYLOAD_BYTES * 2) {
      throw new Error("Device connection is backpressured");
    }

    const id = randomUUID();
    const payload: RpcRequest = { id, kind, params };

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Device request timed out"));
      }, timeoutMs);

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

  private accept(rawWs: WebSocket, request: IncomingMessage): void {
    const ws = rawWs as ManagedWebSocket;
    const auth = request.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
    const device = token ? this.store.findDeviceByToken(token) : null;

    if (!device) {
      ws.close(1008, "Unauthorized");
      return;
    }

    const previous = this.sockets.get(device.id);
    if (!previous && this.sockets.size >= config.MAX_AGENT_CONNECTIONS) {
      ws.close(1013, "Relay connection limit reached");
      return;
    }
    if (previous && previous.readyState === WebSocket.OPEN) previous.close(1000, "Replaced");

    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    this.sockets.set(device.id, ws);
    this.store.touchDevice(device.id);

    ws.on("message", (raw) => {
      try {
        const response = RpcResponseSchema.parse(JSON.parse(raw.toString()));
        const pending = this.pending.get(response.id);
        if (!pending || pending.deviceId !== device.id) return;

        clearTimeout(pending.timer);
        this.pending.delete(response.id);
        pending.resolve(response);
      } catch {
        ws.close(1003, "Invalid response");
      }
    });

    ws.on("close", () => this.onSocketGone(device.id, ws, "Device disconnected"));
    ws.on("error", () => this.onSocketGone(device.id, ws, "Device connection failed"));
  }

  private heartbeat(): void {
    for (const [deviceId, ws] of this.sockets) {
      if (ws.readyState !== WebSocket.OPEN) {
        this.onSocketGone(deviceId, ws, "Device connection closed");
        continue;
      }
      if (ws.isAlive === false) {
        ws.terminate();
        this.onSocketGone(deviceId, ws, "Device heartbeat timed out");
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
        this.onSocketGone(deviceId, ws, "Device heartbeat failed");
      }
    }
  }

  private onSocketGone(deviceId: string, ws: ManagedWebSocket, reason: string): void {
    if (this.sockets.get(deviceId) !== ws) return;
    this.sockets.delete(deviceId);
    this.rejectPendingForDevice(deviceId, new Error(reason));
  }

  private pendingForDevice(deviceId: string): number {
    let count = 0;
    for (const pending of this.pending.values()) {
      if (pending.deviceId === deviceId) count += 1;
    }
    return count;
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
