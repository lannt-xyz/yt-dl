import { detectSupport, isIos, isStandalone, urlBase64ToUint8Array } from "../push";
import { searchOf, tabFromSearch } from "../route";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

describe("isIos", () => {
  it("nhận diện iPhone/iPad", () => {
    expect(isIos(IPHONE)).toBe(true);
    expect(isIos("... iPad; CPU OS 18_0 ...")).toBe(true);
  });
  it("iPadOS giả danh Mac nhưng có cảm ứng", () => {
    expect(isIos(MAC, "MacIntel", 5)).toBe(true);
    expect(isIos(MAC, "MacIntel", 0)).toBe(false);
  });
  it("Android và desktop không phải iOS", () => {
    expect(isIos(ANDROID, "Linux armv8l", 5)).toBe(false);
  });
});

describe("isStandalone", () => {
  const nav = (standalone?: boolean) => ({ standalone });
  it("iOS: navigator.standalone", () => {
    expect(isStandalone({ navigator: nav(true) })).toBe(true);
    expect(isStandalone({ navigator: nav(false) })).toBe(false);
  });
  it("display-mode: standalone", () => {
    expect(isStandalone({ navigator: nav(), matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isStandalone({ navigator: nav(), matchMedia: () => ({ matches: false }) })).toBe(false);
  });
  it("không có matchMedia", () => {
    expect(isStandalone({ navigator: nav() })).toBe(false);
  });
});

describe("detectSupport", () => {
  const base = { ios: false, standalone: false, hasServiceWorker: true, hasPushManager: true, hasNotification: true };
  it("iOS chưa cài ra Màn hình chính → cần cài, dù API có sẵn", () => {
    expect(detectSupport({ ...base, ios: true })).toBe("needs-install");
  });
  it("iOS đã cài → ok", () => {
    expect(detectSupport({ ...base, ios: true, standalone: true })).toBe("ok");
  });
  it("thiếu API → không hỗ trợ", () => {
    expect(detectSupport({ ...base, hasPushManager: false })).toBe("unsupported");
    expect(detectSupport({ ...base, hasServiceWorker: false })).toBe("unsupported");
    expect(detectSupport({ ...base, hasNotification: false })).toBe("unsupported");
  });
  it("trình duyệt thường đủ API → ok", () => {
    expect(detectSupport(base)).toBe("ok");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("giải mã base64url có/không padding", () => {
    expect([...urlBase64ToUint8Array("AQID")]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array("AQI")]).toEqual([1, 2]);
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255]);
  });
  it("khóa VAPID 65 byte", () => {
    const key = btoa(String.fromCharCode(4, ...Array(64).fill(7))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(urlBase64ToUint8Array(key)).toHaveLength(65);
  });
});

describe("route", () => {
  it("tabFromSearch", () => {
    expect(tabFromSearch("?tab=history")).toBe("history");
    expect(tabFromSearch("?tab=history&job=x")).toBe("history");
    expect(tabFromSearch("?tab=download")).toBe("download");
    expect(tabFromSearch("?tab=bậy")).toBe("download");
    expect(tabFromSearch("")).toBe("download");
  });
  it("searchOf", () => {
    expect(searchOf("/?tab=history&job=1")).toBe("?tab=history&job=1");
    expect(searchOf("/")).toBe("");
  });
});
