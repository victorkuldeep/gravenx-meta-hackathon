import { describe, expect, it } from "vitest";
import { clearBeacon, readBeacon, writeBeacon } from "./beacon";

describe("bridge beacon", () => {
  it("round-trips a beacon and clears it", () => {
    const before = readBeacon();
    try {
      writeBeacon(49321, "123456");
      const back = readBeacon();
      expect(back?.port).toBe(49321);
      expect(back?.code).toBe("123456");
      expect(back?.v).toBe(1);
      clearBeacon();
      expect(readBeacon()).toBeNull();
    } finally {
      // Never clobber a real hub beacon the test run did not create.
      if (before) writeBeacon(before.port, before.code);
      else clearBeacon();
    }
  });

  it("returns null when no beacon exists", () => {
    const before = readBeacon();
    try {
      clearBeacon();
      clearBeacon(); // double-clear is safe
      expect(readBeacon()).toBeNull();
    } finally {
      if (before) writeBeacon(before.port, before.code);
    }
  });
});
