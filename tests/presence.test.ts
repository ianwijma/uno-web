import { describe, expect, it } from "vitest";
import { peerHealth } from "../src/lib/network/presence";

describe("peer presence", () => {
  it("shows heartbeat gaps as flaky before offline, then recovers on fresh traffic", () => {
    expect(peerHealth(1000, 5500)).toBe("stable");
    expect(peerHealth(1000, 5501)).toBe("flaky");
    expect(peerHealth(1000, 13000)).toBe("flaky");
    expect(peerHealth(1000, 13001)).toBe("offline");
    expect(peerHealth(13001, 13001)).toBe("stable");
  });
  it("gives unknown peers a discovery window but does not leave them orange forever", () => {
    expect(peerHealth(undefined, 1000, 1000)).toBe("flaky");
    expect(peerHealth(undefined, 13001, 1000)).toBe("offline");
  });
});
