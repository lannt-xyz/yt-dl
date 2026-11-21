import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom chưa cài đặt phát media
Object.defineProperties(window.HTMLMediaElement.prototype, {
  play: { configurable: true, value: () => Promise.resolve() },
  pause: { configurable: true, value: () => undefined },
});

// jsdom không có canvas / pointer capture / media load
HTMLCanvasElement.prototype.getContext = (() => null) as never;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;
Object.defineProperty(window.HTMLMediaElement.prototype, "load", {
  configurable: true,
  value: () => undefined,
});
