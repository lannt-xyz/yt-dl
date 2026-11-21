import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { Job } from "../api/types";
import { AuthContext } from "../state/auth";
import { EventsProvider } from "../state/events";
import { JobsProvider } from "../state/jobs";
import { PlayerProvider } from "../state/player";
import { ToastProvider } from "../state/toast";
import { TrimProvider } from "../state/trim";
import { YtdlpProvider } from "../state/ytdlp";

type Listener = (e: MessageEvent<string>) => void;

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent<string>);
    }
  }
  static latest() {
    return FakeEventSource.instances.at(-1)!;
  }
}

export interface Call {
  url: string;
  method: string;
  body?: unknown;
}

type Handler = (call: Call) => { status?: number; body?: unknown } | undefined;

/** Giả lập fetch: trả danh sách job + cho phép ghi đè từng endpoint. */
export function mockApi(initial: Job[] = [], handler?: Handler) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call = { url, method, body };
    calls.push(call);
    if (url === "/api/auth/status" && !handler?.(call)) {
      return new Response(JSON.stringify({ required: false, authenticated: true }));
    }
    const custom = handler?.(call);
    if (custom) {
      return new Response(custom.status === 204 ? null : JSON.stringify(custom.body ?? {}), {
        status: custom.status ?? 200,
      });
    }
    if (url.startsWith("/api/jobs?") && method === "GET") {
      return new Response(JSON.stringify({ items: initial, total: initial.length, unseen: 0 }));
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", FakeEventSource);
  FakeEventSource.instances = [];
  return { calls, fetchMock };
}

export function renderApp(ui: ReactElement) {
  return render(
    <ToastProvider>
      <AuthContext.Provider value={{ required: false, logout: async () => {} }}>
        <EventsProvider>
          <PlayerProvider>
            <JobsProvider>
              <YtdlpProvider>
                <TrimProvider>{ui}</TrimProvider>
              </YtdlpProvider>
            </JobsProvider>
          </PlayerProvider>
        </EventsProvider>
      </AuthContext.Provider>
    </ToastProvider>,
  );
}
