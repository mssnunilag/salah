"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type AsrMethod,
  CALCULATION_METHODS,
  computePrayerTimes,
  formatMinutes,
  parseTimeOfDay,
} from "@/lib/prayer-times";
import { type Lecture, type Weekday, WEEKDAYS, analyseDay } from "@/lib/timetable";
import { loadLectures, saveLectures } from "@/lib/storage";
import { PrayerTable } from "@/components/PrayerTable";
import { NextPrayerCountdown } from "@/components/NextPrayerCountdown";
import { ConflictList } from "@/components/ConflictList";
import campus from "@/data/campus-spaces.json";

/** A plausible week so the conflict panel means something the first time
 *  the page loads. The student clears it with one button. */
const SAMPLE_TIMETABLE: Lecture[] = [
  { id: "s1", title: "CHM 201 practical", day: "Tuesday", start: 15 * 60, end: 18 * 60, venue: "Chem lab" },
  { id: "s2", title: "MTH 202", day: "Monday", start: 12 * 60, end: 14 * 60, venue: "LT1" },
  { id: "s3", title: "GST 212", day: "Thursday", start: 16 * 60, end: 17 * 60 + 55 },
];

export default function Home() {
  const [methodId, setMethodId] = useState(CALCULATION_METHODS[0].id);
  const [asrMethod, setAsrMethod] = useState<AsrMethod>("standard");
  const [day, setDay] = useState<Weekday>("Tuesday");
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // The date is read once on the client. Computing it during render would
  // make the server and client markup disagree at midnight and produce a
  // hydration mismatch — rare, but exactly the kind of bug nobody reproduces.
  const [today, setToday] = useState<Date | null>(null);

  useEffect(() => {
    const stored = loadLectures();
    setLectures(stored.length > 0 ? stored : SAMPLE_TIMETABLE);
    setToday(new Date());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveLectures(lectures);
  }, [lectures, hydrated]);

  const method = CALCULATION_METHODS.find((m) => m.id === methodId)!;

  const times = useMemo(
    () => computePrayerTimes({ date: today ?? new Date(2026, 0, 1), method, asrMethod }),
    [today, method, asrMethod]
  );

  const conflicts = useMemo(
    () => analyseDay(times, lectures, day),
    [times, lectures, day]
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Salat Campus</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)] dark:text-white/60">
          Prayer times for University of Lagos, Akoka — computed on your device, no
          network needed — and a check of which lectures collide with which prayer.
        </p>
      </header>

      <section className="mb-8 rounded-xl border border-[var(--color-rule)] bg-[var(--color-card)] p-4 dark:bg-white/5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">
            {today
              ? today.toLocaleDateString("en-NG", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
              : "Today"}
          </h2>
          <label className="ml-auto text-xs">
            <span className="sr-only">Calculation method</span>
            <select
              value={methodId}
              onChange={(e) => setMethodId(e.target.value)}
              className="rounded border border-[var(--color-rule)] bg-transparent px-2 py-1 text-xs"
            >
              {CALCULATION_METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="sr-only">Asr method</span>
            <select
              value={asrMethod}
              onChange={(e) => setAsrMethod(e.target.value as AsrMethod)}
              className="rounded border border-[var(--color-rule)] bg-transparent px-2 py-1 text-xs"
            >
              <option value="standard">Asr: standard</option>
              <option value="hanafi">Asr: Hanafi</option>
            </select>
          </label>
        </div>
        <NextPrayerCountdown times={times} />
        <PrayerTable times={times} />
      </section>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Your week</h2>
          <button
            type="button"
            onClick={() => setLectures([])}
            className="ml-auto rounded border border-[var(--color-rule)] px-2 py-1 text-xs"
          >
            Clear timetable
          </button>
        </div>

        <LectureForm onAdd={(lecture) => setLectures((prev) => [...prev, lecture])} />

        {lectures.length > 0 && (
          <ul className="mt-3 space-y-1">
            {lectures
              .slice()
              .sort(
                (a, b) =>
                  WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.start - b.start
              )
              .map((lecture) => (
                <li
                  key={lecture.id}
                  className="flex items-center gap-3 rounded border border-[var(--color-rule)] px-3 py-1.5 text-sm"
                >
                  <span className="w-20 shrink-0 text-xs text-[var(--color-ink-soft)]">
                    {lecture.day.slice(0, 3)}
                  </span>
                  <span className="font-mono text-xs tabular-nums">
                    {formatMinutes(lecture.start)}–{formatMinutes(lecture.end)}
                  </span>
                  <span className="truncate">{lecture.title}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${lecture.title}`}
                    onClick={() =>
                      setLectures((prev) => prev.filter((l) => l.id !== lecture.id))
                    }
                    className="ml-auto text-xs text-[var(--color-ink-soft)] hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Conflicts</h2>
          <label className="ml-auto text-xs">
            <span className="sr-only">Day to check</span>
            <select
              value={day}
              onChange={(e) => setDay(e.target.value as Weekday)}
              className="rounded border border-[var(--color-rule)] bg-transparent px-2 py-1 text-xs"
            >
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ConflictList conflicts={conflicts} />
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">Where to pray on campus</h2>
        <p className="mb-3 text-xs text-[var(--color-ink-soft)]">
          Seed data — every entry still needs checking on the ground. Correcting one is
          a good first contribution.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {campus.spaces.map((space) => (
            <li
              key={space.id}
              className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-card)] p-3 text-sm dark:bg-white/5"
            >
              <p className="font-medium">{space.name}</p>
              <p className="text-xs text-[var(--color-ink-soft)]">{space.area}</p>
              <p className="mt-1 text-xs">
                {space.hasWudu ? "Wudu on site" : "No wudu on site"}
                {space.sisters ? " · sisters' section" : ""}
                {space.jumuah ? " · Jumu'ah" : ""}
                {!space.verified && " · unverified"}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function LectureForm({ onAdd }: { onAdd: (lecture: Lecture) => void }) {
  const [title, setTitle] = useState("");
  const [day, setDay] = useState<Weekday>("Monday");
  const [start, setStart] = useState("14:00");
  const [end, setEnd] = useState("16:00");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const startMinutes = parseTimeOfDay(start);
    const endMinutes = parseTimeOfDay(end);

    if (!title.trim()) return setError("Give the lecture a name.");
    if (startMinutes === null || endMinutes === null)
      return setError("Times must look like 14:00.");
    if (endMinutes <= startMinutes) return setError("It has to end after it starts.");

    onAdd({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim(),
      day,
      start: startMinutes,
      end: endMinutes,
    });
    setTitle("");
    setError(null);
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Course title"
        aria-label="Course title"
        className="min-w-40 flex-1 rounded border border-[var(--color-rule)] bg-transparent px-2 py-1.5 text-sm"
      />
      <select
        value={day}
        onChange={(e) => setDay(e.target.value as Weekday)}
        aria-label="Day"
        className="rounded border border-[var(--color-rule)] bg-transparent px-2 py-1.5 text-sm"
      >
        {WEEKDAYS.map((d) => (
          <option key={d} value={d}>
            {d.slice(0, 3)}
          </option>
        ))}
      </select>
      <input
        value={start}
        onChange={(e) => setStart(e.target.value)}
        aria-label="Start time"
        className="w-20 rounded border border-[var(--color-rule)] bg-transparent px-2 py-1.5 text-center font-mono text-sm"
      />
      <input
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        aria-label="End time"
        className="w-20 rounded border border-[var(--color-rule)] bg-transparent px-2 py-1.5 text-center font-mono text-sm"
      />
      <button
        type="submit"
        className="rounded bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white"
      >
        Add
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-[var(--color-blocked)]">
          {error}
        </p>
      )}
    </form>
  );
}
