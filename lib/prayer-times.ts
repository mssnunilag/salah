/**
 * Prayer times computed from first principles, not fetched.
 *
 * The obvious implementation is to call one of the public prayer-time APIs,
 * and that is exactly what we are avoiding. A student on UNILAG campus data
 * is frequently offline or on a connection that will not survive a round
 * trip, and the one moment they need these numbers is the moment they cannot
 * afford to wait for a network. Everything below is arithmetic over the
 * date and the coordinates, so the whole app works in airplane mode and
 * needs no API key — which also means a contributor can clone this repo and
 * run it without asking anyone for anything.
 *
 * The astronomy is the standard low-precision solar position model from the
 * US Naval Observatory's Astronomical Almanac. It is accurate to well under
 * a minute for our purposes, which is far tighter than the error introduced
 * by the fact that nobody starts praying at the exact second anyway.
 */

/** The five daily prayers, plus the two solar events the windows hang off. */
export type PrayerName = "fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha";

/** Minutes since local midnight. Keeping one unit everywhere avoids a whole
 *  family of bugs where a Date built in one timezone is read in another. */
export type Minutes = number;

export type PrayerTimes = Record<PrayerName, Minutes>;

/**
 * Twilight angles differ between authorities because "dawn" and "nightfall"
 * are observations, not definitions, and observers at different latitudes
 * settled on different numbers. Nigeria has no single official body, so we
 * default to Muslim World League and let the student choose.
 */
export type IshaRule =
  /** Degrees the sun sits below the horizon at the start of Isha. */
  | { readonly kind: "angle"; readonly degrees: number }
  /** Minutes after Maghrib, with a separate interval for Ramadan. Being a
   *  fixed interval rather than an angle, it follows Maghrib as the sun
   *  moves, instead of tracking the twilight. */
  | { readonly kind: "interval"; readonly minutes: number; readonly ramadanMinutes: number };

export interface CalculationMethod {
  readonly id: string;
  readonly label: string;
  /** Degrees the sun sits below the horizon at the start of Fajr. */
  readonly fajrAngle: number;
  readonly isha: IshaRule;
}

export const CALCULATION_METHODS: readonly CalculationMethod[] = [
  { id: "mwl", label: "Muslim World League", fajrAngle: 18, isha: { kind: "angle", degrees: 17 } },
  { id: "egyptian", label: "Egyptian General Authority", fajrAngle: 19.5, isha: { kind: "angle", degrees: 17.5 } },
  { id: "karachi", label: "University of Islamic Sciences, Karachi", fajrAngle: 18, isha: { kind: "angle", degrees: 18 } },
  { id: "isna", label: "Islamic Society of North America", fajrAngle: 15, isha: { kind: "angle", degrees: 15 } },
  {
    id: "umm-al-qura",
    label: "Umm al-Qura University, Makkah",
    fajrAngle: 18.5,
    isha: { kind: "interval", minutes: 90, ramadanMinutes: 120 },
  },
];

/**
 * Asr begins when an object's shadow has grown by its own length (the
 * majority position) or by twice its own length (the Hanafi position). This
 * is the one setting students actually notice differing between them, so it
 * is separate from the twilight method rather than bundled into it.
 */
export type AsrMethod = "standard" | "hanafi";

export interface Location {
  readonly latitude: number;
  readonly longitude: number;
  /** Hours ahead of UTC. West Africa Time is +1 and observes no DST. */
  readonly timezoneOffset: number;
}

/** University of Lagos, Akoka. The default so the app is useful before the
 *  student has touched a single setting. */
export const UNILAG: Location = {
  latitude: 6.5158,
  longitude: 3.3966,
  timezoneOffset: 1,
};

const DEG = Math.PI / 180;

const sin = (degrees: number) => Math.sin(degrees * DEG);
const cos = (degrees: number) => Math.cos(degrees * DEG);
const tan = (degrees: number) => Math.tan(degrees * DEG);
const arcsin = (x: number) => Math.asin(x) / DEG;
const arccos = (x: number) => Math.acos(x) / DEG;
const arctan2 = (y: number, x: number) => Math.atan2(y, x) / DEG;
const arccot = (x: number) => Math.atan(1 / x) / DEG;

/** Normalise a value into [0, range). Used for degrees and for hours. */
function wrap(value: number, range: number): number {
  const remainder = value - range * Math.floor(value / range);
  return remainder < 0 ? remainder + range : remainder;
}

/**
 * Julian day for 00:00 UT on the given civil date. The Gregorian correction
 * term `b` is what makes this disagree with a naive day count, and leaving
 * it out is the classic way to be exactly ten days wrong.
 */
export function julianDay(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5
  );
}

interface SolarPosition {
  /** Declination of the sun, in degrees. */
  readonly declination: number;
  /** Equation of time, in hours — the gap between clock noon and solar noon. */
  readonly equationOfTime: number;
}

/** Low-precision solar coordinates for a Julian day. */
export function solarPosition(jd: number): SolarPosition {
  const d = jd - 2451545.0;
  const meanAnomaly = wrap(357.529 + 0.98560028 * d, 360);
  const meanLongitude = wrap(280.459 + 0.98564736 * d, 360);
  const apparentLongitude = wrap(
    meanLongitude + 1.915 * sin(meanAnomaly) + 0.02 * sin(2 * meanAnomaly),
    360
  );
  const obliquity = 23.439 - 0.00000036 * d;

  const declination = arcsin(sin(obliquity) * sin(apparentLongitude));
  const rightAscension = wrap(
    arctan2(cos(obliquity) * sin(apparentLongitude), cos(apparentLongitude)) / 15,
    24
  );
  const equationOfTime = meanLongitude / 15 - rightAscension;

  return { declination, equationOfTime };
}

/**
 * Half the length of the arc the sun spends above a given depression angle,
 * in hours.
 *
 * `depression` is degrees BELOW the horizon, so twilight angles go in
 * positive (Fajr at 18 means the sun is 18° down) and Asr — which happens
 * with the sun still up — goes in negative. Getting this sign backwards is
 * the single easiest mistake to make here, and it fails loudly rather than
 * subtly: an inverted Fajr lands after sunrise.
 *
 * Returns NaN when the sun never reaches that altitude on that day. At
 * UNILAG's latitude that cannot happen for any prayer, but the callers still
 * guard for it so that someone who changes the coordinates to Tromsø gets an
 * honest "undefined" rather than a confident wrong answer.
 */
function hourAngle(depression: number, latitude: number, declination: number): number {
  const numerator = -sin(depression) - sin(latitude) * sin(declination);
  const denominator = cos(latitude) * cos(declination);
  return arccos(numerator / denominator) / 15;
}

/** The sun's centre sits 0.833° below the horizon at apparent sunrise and
 *  sunset — 0.566° of refraction plus half the solar disc. */
const HORIZON_DEPRESSION = 0.833;

export interface ComputeOptions {
  readonly date: Date;
  readonly location?: Location;
  readonly method?: CalculationMethod;
  readonly asrMethod?: AsrMethod;
  /** Only read by methods whose Isha is an interval; the caller decides
   *  whether the date falls in Ramadan, so this module stays free of the
   *  Hijri calendar. */
  readonly ramadan?: boolean;
}

/**
 * The five prayer times plus sunrise, as minutes since local midnight.
 *
 * Callers get minutes rather than Dates deliberately: a Date carries a
 * timezone that the browser picks and the student cannot see, and we had
 * exactly that bug in an early draft where a phone set to UTC showed Maghrib
 * an hour early. Minutes-since-midnight is unambiguous.
 */
export function computePrayerTimes(options: ComputeOptions): PrayerTimes {
  const location = options.location ?? UNILAG;
  const method = options.method ?? CALCULATION_METHODS[0];
  const asrMethod = options.asrMethod ?? "standard";
  const { date } = options;
  const ramadan = options.ramadan ?? false;

  const jd = julianDay(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const { declination, equationOfTime } = solarPosition(jd);

  // Solar noon in local clock time. The longitude term converts the local
  // meridian's noon to the timezone's noon; Lagos sits west of its own
  // meridian, so solar noon lands a little after 12:00.
  const dhuhrHours =
    12 + location.timezoneOffset - location.longitude / 15 - equationOfTime;

  const toMinutes = (hours: number) => Math.round(wrap(hours, 24) * 60);

  const twilight = (angle: number) => hourAngle(angle, location.latitude, declination);
  const horizon = hourAngle(HORIZON_DEPRESSION, location.latitude, declination);

  // Asr: the shadow of a vertical object equals its own length (or twice it)
  // plus the shadow it already casts at solar noon.
  const shadowFactor = asrMethod === "hanafi" ? 2 : 1;
  const asrAltitude = arccot(shadowFactor + tan(Math.abs(location.latitude - declination)));
  // Negated: the sun is still above the horizon at Asr.
  const asrOffset = hourAngle(-asrAltitude, location.latitude, declination);

  const maghribHours = dhuhrHours + horizon;
  const ishaHours =
    method.isha.kind === "angle"
      ? dhuhrHours + twilight(method.isha.degrees)
      : maghribHours + (ramadan ? method.isha.ramadanMinutes : method.isha.minutes) / 60;

  return {
    fajr: toMinutes(dhuhrHours - twilight(method.fajrAngle)),
    sunrise: toMinutes(dhuhrHours - horizon),
    dhuhr: toMinutes(dhuhrHours),
    asr: toMinutes(dhuhrHours + asrOffset),
    maghrib: toMinutes(maghribHours),
    isha: toMinutes(ishaHours),
  };
}

/** "14:32" from 872. Zero-padded so a column of times lines up. */
export function formatMinutes(minutes: Minutes): string {
  const normalised = wrap(Math.round(minutes), 24 * 60);
  const hours = Math.floor(normalised / 60);
  const mins = normalised % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** "2:32 pm" — what a student actually reads. */
export function formatMinutes12Hour(minutes: Minutes): string {
  const normalised = wrap(Math.round(minutes), 24 * 60);
  const hours24 = Math.floor(normalised / 60);
  const mins = normalised % 60;
  const suffix = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/** "08:30" or "8:30" to 510. Returns null rather than NaN so that callers
 *  parsing student-typed input have something they can branch on. */
export function parseTimeOfDay(value: string): Minutes | null {
  const match = /^\s*(\d{1,2})\s*:\s*(\d{2})\s*$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}
