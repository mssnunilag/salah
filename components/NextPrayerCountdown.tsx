import { useEffect, useState } from "react";
import { type Minutes, type PrayerTimes, nextPrayer } from "@/lib/prayer-times";

const LABELS = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
} as const;

/** Minutes since local midnight, read from the device clock. */
function minutesNow(): Minutes {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** Starts as null so the server render and the first client render agree,
 *  then the real time is filled in after mount. A minute is the finest
 *  resolution shown, so a one-minute tick never shows a stale countdown. */
export function NextPrayerCountdown({ times }: { times: PrayerTimes }) {
  const [now, setNow] = useState<Minutes | null>(null);

  useEffect(() => {
    setNow(minutesNow());
    const id = setInterval(() => setNow(minutesNow()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (now === null) return null;

  const next = nextPrayer(times, now);
  const hours = Math.floor(next.minutesUntil / 60);
  const mins = next.minutesUntil % 60;
  const remaining = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <p className="mb-4 text-sm">
      <span className="text-[var(--color-ink-soft)]">Next prayer</span>{" "}
      <span className="font-medium">{LABELS[next.prayer]}</span>{" "}
      <span className="font-mono tabular-nums">in {remaining}</span>
    </p>
  );
}
