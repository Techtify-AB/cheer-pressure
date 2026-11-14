// The bridge, native side: takes the page's requests (lib/phone.ts, and lib/phoneBridge.ts which
// speaks the same wire), does them, and answers. The wire and every message's shape are in
// protocol.ts, which is byte for byte the same as lib/phone.ts.
//
//   web -> native  window.ReactNativeWebView.postMessage(JSON.stringify({ cheerPressure, id, kind, args }))
//   native -> web  window.__cheerPressurePhone.receive({ cheerPressure, id, ok, result | error })
//                  window.__cheerPressurePhone.receive({ cheerPressure, event, data })

import { Linking, Platform } from "react-native";
import { CheerNative } from "../modules/cheer-native";
import { IS_DEV } from "./config";
import * as health from "./health";
import * as notices from "./notifications";
import {
  PHONE_BRIDGE_VERSION,
  PHONE_REQUESTS,
  type NativeToWeb,
  type PhoneCapabilities,
  type PhoneErrorCode,
  type PhoneEventKind,
  type PhoneEvents,
  type PhonePermissionKind,
  type PhonePermissionState,
  type PhoneRequestKind,
  type PhoneRequests,
  type WebToNative,
} from "./protocol";

export class BridgeFailure extends Error {
  constructor(
    public code: PhoneErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function mediaState(kind: "camera" | "microphone"): PhonePermissionState {
  return CheerNative ? CheerNative.mediaPermission(kind) : "not-available";
}

async function requestMedia(kind: "camera" | "microphone"): Promise<PhonePermissionState> {
  return CheerNative ? CheerNative.requestMediaPermission(kind) : "not-available";
}

export interface BridgeHooks {
  /** Health's sheet has been answered: the page reads sleep and steps now rather than later. */
  healthAsked(): void;
}

type Handlers = { [K in PhoneRequestKind]: (args: PhoneRequests[K]["args"]) => Promise<PhoneRequests[K]["result"]> };

function handlers(hooks: BridgeHooks): Handlers {
  return {
    async getCapabilities(): Promise<PhoneCapabilities> {
      const h = await health.healthCapability();
      return {
        version: PHONE_BRIDGE_VERSION,
        platform: Platform.OS === "android" ? "android" : "ios",
        build: IS_DEV ? "development" : "release",
        health: h,
        notifications: await notices.notificationState(),
        camera: mediaState("camera"),
        microphone: mediaState("microphone"),
        demoHealth: IS_DEV && h.available,
      };
    },

    async requestPermission({ kind }) {
      const k = kind as PhonePermissionKind;
      let state: PhonePermissionState;
      switch (k) {
        case "health":
          state = await health.requestHealth();
          if (state !== "not-available") hooks.healthAsked();
          break;
        case "notifications":
          state = await notices.requestNotifications();
          break;
        case "camera":
        case "microphone":
          state = await requestMedia(k);
          break;
        case "camera-microphone": {
          const cam = await requestMedia("camera");
          const mic = await requestMedia("microphone");
          state = cam === "granted" && mic === "granted" ? "granted" : cam === "not-available" && mic === "not-available" ? "not-available" : "denied";
          break;
        }
        case "location":
          state = "not-available";
          break;
        default:
          throw new BridgeFailure("bad-request", `No such permission: ${String(kind)}.`);
      }
      return { kind: k, state };
    },

    async getSleep({ since }) {
      if (typeof since !== "string" || !DAY.test(since)) throw new BridgeFailure("bad-request", "since must be a day, YYYY-MM-DD.");
      return health.getSleep(since);
    },

    async getSteps({ since }) {
      if (typeof since !== "string" || !DAY.test(since)) throw new BridgeFailure("bad-request", "since must be a day, YYYY-MM-DD.");
      return health.getSteps(since);
    },

    async scheduleNotifications({ plan }) {
      return notices.schedulePlan(plan);
    },

    async cancelNotifications() {
      return notices.cancelAll();
    },

    async notifyNow({ notice }) {
      return notices.notifyNow(notice);
    },

    async openSettings() {
      await Linking.openSettings();
      return { opened: true };
    },

    async demoHealth({ action }) {
      if (!IS_DEV) throw new BridgeFailure("not-available", "Only in development builds.");
      if (action !== "add" && action !== "remove") throw new BridgeFailure("bad-request", "action must be add or remove.");
      // The page reads Health again itself (lib/phone.ts demoHealth).
      return health.demoHealth(action);
    },
  };
}

function errorOf(e: unknown): { code: PhoneErrorCode; message: string } {
  if (e instanceof BridgeFailure) return { code: e.code, message: e.message };
  if (e instanceof health.NotAvailable) return { code: "not-available", message: e.message };
  if (e instanceof notices.PlanRefused) return { code: e.code, message: e.message };
  return { code: "failed", message: e instanceof Error ? e.message : "The phone could not do that." };
}

export interface Bridge {
  /** One message from the page. Answers through `deliver`. Ignores anything that is not the bridge's. */
  receive(raw: string): void;
  event<E extends PhoneEventKind>(event: E, data: PhoneEvents[E]): void;
}

/** Extra requests outside the protocol (speech and conversation, mobile/src/voice), same wire. */
export type ExtraHandlers = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

export function createBridge(deliver: (msg: NativeToWeb) => void, hooks: BridgeHooks, extra: ExtraHandlers = {}): Bridge {
  const table = handlers(hooks) as unknown as Record<string, (args: unknown) => Promise<unknown>>;
  const known = new Set<string>(PHONE_REQUESTS);
  return {
    receive(raw) {
      let msg: WebToNative;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object" || typeof msg.cheerPressure !== "number" || typeof msg.id !== "string") return;
      const reply = (r: { ok: true; result: unknown } | { ok: false; error: { code: PhoneErrorCode; message: string } }) =>
        deliver({ cheerPressure: PHONE_BRIDGE_VERSION, id: msg.id, ...r } as NativeToWeb);
      if (msg.cheerPressure !== PHONE_BRIDGE_VERSION) {
        reply({ ok: false, error: { code: "bad-request", message: `The phone speaks bridge version ${PHONE_BRIDGE_VERSION}, the page ${msg.cheerPressure}.` } });
        return;
      }
      const kind = String(msg.kind);
      const run = known.has(kind) ? table[kind] : extra[kind];
      if (!run) {
        reply({ ok: false, error: { code: "not-available", message: `This phone app does not do ${kind}.` } });
        return;
      }
      const args = msg.args && typeof msg.args === "object" ? msg.args : {};
      run(args as never).then(
        (result) => reply({ ok: true, result }),
        (e) => reply({ ok: false, error: errorOf(e) }),
      );
    },
    event(event, data) {
      deliver({ cheerPressure: PHONE_BRIDGE_VERSION, event, data });
    },
  };
}
