import type { ReactNode } from 'react';
import { formatClock, formatOffset } from '@geogames/games';

const DAY = 24 * 60;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = [0, 15, 30, 45];

/** A time tried this level, and which way the answer lies from it. */
export interface TriedTime {
  minutes: number;
  /** 'earlier': the answer is earlier than this time. */
  way: 'earlier' | 'later';
}

/** The offset from UTC a local time implies, from −12:00 to +14:00. */
export function impliedOffset(local: number, utcHour: number): number {
  const d = (((local - utcHour * 60) % DAY) + DAY) % DAY;
  return d > 14 * 60 ? d - DAY : d;
}

/**
 * The time of day as buttons: 24 hours, then the minutes. Tapping an hour keeps
 * the minutes chosen so far (:00 at first), so most answers are one tap and Check.
 * The UTC hour is marked as the reference, and hours already tried show which
 * way the answer lies.
 */
export function TimePicker({
  utcHour,
  value,
  tried,
  onChange,
  onCheck,
  secondary,
}: {
  utcHour: number;
  value: number | null;
  tried: readonly TriedTime[];
  onChange(minutes: number): void;
  onCheck(): void;
  /** A secondary action shown beside Check, such as Skip, so it never needs a scroll. */
  secondary?: ReactNode;
}) {
  const hour = value === null ? null : Math.floor(value / 60);
  const minute = value === null ? null : value % 60;
  const wayAt = (h: number) => tried.filter((t) => Math.floor(t.minutes / 60) === h).map((t) => t.way);

  return (
    <div className="clock-picker">
      <div className="clock-hours" role="group" aria-label="Hour">
        {HOURS.map((h) => {
          const ways = wayAt(h);
          const label = String(h).padStart(2, '0');
          return (
            <button
              key={h}
              type="button"
              className={[
                'clock-hour',
                h === utcHour ? 'clock-hour-utc' : '',
                h === hour ? 'selected' : '',
                ways.length ? 'tried' : '',
              ].join(' ')}
              aria-pressed={h === hour}
              aria-label={`${label}${h === utcHour ? ', the UTC hour' : ''}${ways.length ? `, tried: ${ways.join(' and ')}` : ''}`}
              onClick={() => onChange(h * 60 + (minute ?? 0))}
            >
              {label}
              {ways.length > 0 && (
                <span className="clock-hour-way" aria-hidden="true">
                  {ways.map((w) => (w === 'earlier' ? '↓' : '↑')).join('')}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="clock-picker-row">
        <div className="clock-minutes" role="group" aria-label="Minutes">
          {MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              className={`clock-minute${m === minute ? ' selected' : ''}`}
              aria-pressed={m === minute}
              onClick={() => onChange((hour ?? utcHour) * 60 + m)}
            >
              :{String(m).padStart(2, '0')}
            </button>
          ))}
        </div>
        <p className="clock-chosen" aria-live="polite">
          {value === null ? (
            <span className="muted">Pick an hour</span>
          ) : (
            <>
              = <strong>{formatClock(value)}</strong> <span className="muted">{formatOffset(impliedOffset(value, utcHour))}</span>
            </>
          )}
        </p>
        {secondary}
        <button type="button" className="btn btn-primary clock-check" disabled={value === null} onClick={onCheck}>
          Check
        </button>
      </div>
    </div>
  );
}
