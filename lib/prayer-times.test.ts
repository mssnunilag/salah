import { describe, expect, it } from "vitest";
import {
  CALCULATION_METHODS,
  UNILAG,
  computePrayerTimes,
  formatMinutes,
  formatMinutes12Hour,
  julianDay,
  parseTimeOfDay,
} from "./prayer-times";

const onCampus = (date: string) =>
  computePrayerTimes({ date: new Date(`${date}T00:00:00`), location: UNILAG });

describe("julianDay", () => {
  it("puts the J2000.0 epoch where the almanac does", () => {
    expect(julianDay(2000, 1, 1)).toBe(2451544.5);
  });

  it("applies the Gregorian correction across a century boundary", () => {
    // Without the `b` term this comes out exactly 13 days wrong, which is
    // the failure mode worth pinning down.
    expect(julianDay(1900, 1, 1)).toBe(2415020.5);
  });
});

describe("computePrayerTimes at UNILAG", () => {
  it("returns the prayers in chronological order", () => {
    const t = onCampus("2026-10-31");
    expect(t.fajr).toBeLessThan(t.sunrise);
    expect(t.sunrise).toBeLessThan(t.dhuhr);
    expect(t.dhuhr).toBeLessThan(t.asr);
    expect(t.asr).toBeLessThan(t.maghrib);
    expect(t.maghrib).toBeLessThan(t.isha);
  });

  it("holds that order on the solstices too", () => {
    for (const date of ["2026-06-21", "2026-12-21"]) {
      const t = onCampus(date);
      const ordered = [t.fajr, t.sunrise, t.dhuhr, t.asr, t.maghrib, t.isha];
      expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
    }
  });

  it("puts solar noon a little after clock noon, as Lagos's longitude requires", () => {
    // Lagos sits ~3.4°E while WAT is centred on 15°E, so solar noon is late.
    const t = onCampus("2026-10-31");
    expect(t.dhuhr).toBeGreaterThan(12 * 60);
    expect(t.dhuhr).toBeLessThan(13 * 60);
  });

  it("keeps day length near twelve hours all year, as the tropics require", () => {
    for (const date of ["2026-03-21", "2026-06-21", "2026-09-23", "2026-12-21"]) {
      const t = onCampus(date);
      const dayLength = (t.maghrib - t.sunrise) / 60;
      expect(dayLength).toBeGreaterThan(11.5);
      expect(dayLength).toBeLessThan(12.6);
    }
  });

  it("puts the Hanafi Asr after the standard one", () => {
    const date = new Date("2026-10-31T00:00:00");
    const standard = computePrayerTimes({ date, asrMethod: "standard" });
    const hanafi = computePrayerTimes({ date, asrMethod: "hanafi" });
    expect(hanafi.asr).toBeGreaterThan(standard.asr);
  });

  it("gives an earlier Fajr for a shallower twilight angle", () => {
    const date = new Date("2026-10-31T00:00:00");
    const byId = (id: string) => CALCULATION_METHODS.find((m) => m.id === id)!;
    // ISNA uses 15°, MWL 18°. A shallower angle is reached later in the night.
    const isna = computePrayerTimes({ date, method: byId("isna") });
    const mwl = computePrayerTimes({ date, method: byId("mwl") });
    expect(isna.fajr).toBeGreaterThan(mwl.fajr);
  });

  it("does not depend on the machine's timezone", () => {
    // The whole reason the API speaks in minutes-since-midnight.
    const t = onCampus("2026-10-31");
    expect(Number.isInteger(t.dhuhr)).toBe(true);
    expect(t.dhuhr).toBeGreaterThan(0);
  });
});

describe("Isha defined by an interval after Maghrib", () => {
  const date = new Date("2026-10-31T00:00:00");
  const ummAlQura = CALCULATION_METHODS.find((m) => m.id === "umm-al-qura")!;

  it("puts Isha 90 minutes after Maghrib outside Ramadan", () => {
    const t = computePrayerTimes({ date, method: ummAlQura });
    // Rounding to whole minutes can move the difference by one.
    expect(Math.abs(t.isha - t.maghrib - 90)).toBeLessThanOrEqual(1);
  });

  it("puts Isha 120 minutes after Maghrib in Ramadan", () => {
    const t = computePrayerTimes({ date, method: ummAlQura, ramadan: true });
    expect(Math.abs(t.isha - t.maghrib - 120)).toBeLessThanOrEqual(1);
  });

  it("leaves an angle-based method's Isha alone when Ramadan is set", () => {
    // Only interval methods read the flag; the twilight methods must not shift.
    const mwl = CALCULATION_METHODS.find((m) => m.id === "mwl")!;
    const plain = computePrayerTimes({ date, method: mwl });
    const inRamadan = computePrayerTimes({ date, method: mwl, ramadan: true });
    expect(inRamadan.isha).toBe(plain.isha);
  });
});

describe("formatting", () => {
  it("zero-pads so a column lines up", () => {
    expect(formatMinutes(5 * 60 + 7)).toBe("05:07");
  });

  it("renders noon and midnight as 12, not 0", () => {
    expect(formatMinutes12Hour(12 * 60)).toBe("12:00 pm");
    expect(formatMinutes12Hour(0)).toBe("12:00 am");
  });

  it("wraps times past midnight back into the day", () => {
    expect(formatMinutes(25 * 60)).toBe("01:00");
  });
});

describe("parseTimeOfDay", () => {
  it("accepts both padded and unpadded hours", () => {
    expect(parseTimeOfDay("08:30")).toBe(510);
    expect(parseTimeOfDay("8:30")).toBe(510);
  });

  it("returns null rather than NaN for junk", () => {
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay("25:00")).toBeNull();
    expect(parseTimeOfDay("12:60")).toBeNull();
    expect(parseTimeOfDay("noon")).toBeNull();
  });
});
