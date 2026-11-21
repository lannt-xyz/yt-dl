import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom chưa cài đặt phát media
Object.defineProperties(window.HTMLMediaElement.prototype, {
  play: { configurable: true, value: () => Promise.resolve() },
  pause: { configurable: true, value: () => undefined },
});
