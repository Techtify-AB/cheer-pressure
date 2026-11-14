"use client";

// A seam for the robot, not the robot itself. The robot is a board on USB that sends
// and receives one line of text (JSON) per message at 115200 baud.
//
// - WebSerialRobot works in Chrome and Edge on a computer (Web Serial).
// - TauriRobot is a marked stub: the desktop app has no serial port yet.
//
// Pages use getRobot() and the Robot interface only.

import { isDesktop } from "./platform";

export interface Robot {
  /** Asks the person to pick the port, then opens it. */
  connect(): Promise<void>;
  /** Sends one line. A newline is added. */
  sendLine(line: string): Promise<void>;
  /** Calls back for every line the robot sends. Returns a function that stops it. */
  onLine(handler: (line: string) => void): () => void;
  disconnect(): Promise<void>;
  readonly connected: boolean;
}

export type RobotSupport = { ok: true } | { ok: false; reason: string };

export const BAUD_RATE = 115200;

// Minimal Web Serial types (not in TypeScript's DOM library yet).
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

function serial(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { serial?: SerialLike }).serial ?? null;
}

export class WebSerialRobot implements Robot {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private handlers = new Set<(line: string) => void>();
  private encoder = new TextEncoder();

  get connected() {
    return this.port !== null;
  }

  async connect() {
    const s = serial();
    if (!s) throw new Error("This browser has no Web Serial.");
    const port = await s.requestPort();
    await port.open({ baudRate: BAUD_RATE });
    this.port = port;
    void this.readLoop(port);
  }

  private async readLoop(port: SerialPortLike) {
    if (!port.readable) return;
    const decoder = new TextDecoder();
    let buffer = "";
    this.reader = port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          if (line) this.handlers.forEach((h) => h(line));
          nl = buffer.indexOf("\n");
        }
      }
    } catch {
      // The cable was pulled or the port closed.
    } finally {
      this.reader?.releaseLock();
      this.reader = null;
      this.port = null;
    }
  }

  async sendLine(line: string) {
    if (!this.port?.writable) throw new Error("The robot is not connected.");
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(this.encoder.encode(`${line}\n`));
    } finally {
      writer.releaseLock();
    }
  }

  onLine(handler: (line: string) => void) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async disconnect() {
    const port = this.port;
    await this.reader?.cancel().catch(() => {});
    await port?.close().catch(() => {});
    this.port = null;
  }
}

// TODO(robot, desktop): a serial port in the desktop app. Plan: a Rust command pair
// (robot_connect, robot_send) plus a "robot-line" event, using a maintained serial
// crate, wrapped in lib/platform.ts. Until then the desktop app says it is not there.
export class TauriRobot implements Robot {
  readonly connected = false;
  async connect(): Promise<void> {
    throw new Error("The robot cannot connect from the desktop app yet.");
  }
  async sendLine(): Promise<void> {
    throw new Error("The robot cannot connect from the desktop app yet.");
  }
  onLine() {
    return () => {};
  }
  async disconnect() {}
}

export function robotSupport(): RobotSupport {
  if (isDesktop()) {
    return { ok: false, reason: "The desktop app can't talk to the robot yet. Open this page in Chrome to connect it." };
  }
  if (!serial()) {
    return { ok: false, reason: "Connecting the robot needs Chrome or Edge on a computer." };
  }
  return { ok: true };
}

export function getRobot(): Robot {
  return isDesktop() ? new TauriRobot() : new WebSerialRobot();
}

// The robot the person connected in this window, shared by every page, so it stays connected
// while the app is open and other parts of the app can use it.

let current: Robot | null = null;

/** The connected robot, or null. */
export function connectedRobot(): Robot | null {
  return current?.connected ? current : null;
}

/** Connects (asking the person to pick the port) and keeps it as the app's robot. */
export async function connectRobot(): Promise<Robot> {
  const existing = connectedRobot();
  if (existing) return existing;
  const r = getRobot();
  await r.connect();
  current = r;
  return r;
}

/** What the robot is sent when a greeting from someone the person trusts arrives. */
export const GREETING_LINE = '{"t":"led","mode":"greeting","color":"warm","ms":4000}';

/** Sends one line if a robot is connected; does nothing if none is. Never throws. */
export async function sendIfConnected(line: string): Promise<boolean> {
  const r = connectedRobot();
  if (!r) return false;
  try {
    await r.sendLine(line);
    return true;
  } catch {
    return false;
  }
}
