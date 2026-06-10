export const SPEEDS = [
  { label: "一档", minutesPerTick: 5 },
  { label: "二档", minutesPerTick: 20 },
  { label: "三档", minutesPerTick: 60 },
  { label: "四档", minutesPerTick: 120 },
  { label: "五档", minutesPerTick: 240 },
];

const MINUTES_PER_DAY = 24 * 60;
const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;
const START_HOUR = 6;
const START_YEAR = 1;
const START_MONTH = 1;
const START_DAY = 1;

export function createClock(savedClock = {}) {
  return {
    elapsedMinutes: Number.isFinite(savedClock.elapsedMinutes) ? savedClock.elapsedMinutes : 0,
    speedIndex: Number.isInteger(savedClock.speedIndex) ? savedClock.speedIndex : 0,
    paused: Boolean(savedClock.paused),
  };
}

export function getMinutesPerRealSecond(clock) {
  const speed = SPEEDS[clock.speedIndex] ?? SPEEDS[0];
  // 规格要求“4秒现实时间 = N游戏分钟”，所以每现实秒推进 N / 4 游戏分钟。
  return speed.minutesPerTick / 4;
}

export function advanceClock(clock, minutes) {
  clock.elapsedMinutes = Math.max(0, clock.elapsedMinutes + minutes);
  return clock.elapsedMinutes;
}

export function advanceClockToNextMorning(clock) {
  const currentMinuteOfDay = getMinuteOfDay(clock);
  const targetMinute = START_HOUR * 60;
  const rawMinutesUntilMorning = currentMinuteOfDay < targetMinute
    ? targetMinute - currentMinuteOfDay
    : MINUTES_PER_DAY - currentMinuteOfDay + targetMinute;
  const minutesToAdvance = rawMinutesUntilMorning === 0 ? MINUTES_PER_DAY : rawMinutesUntilMorning;
  advanceClock(clock, minutesToAdvance);
  return minutesToAdvance;
}

export function getTotalDays(clock) {
  return Math.floor((START_HOUR * 60 + clock.elapsedMinutes) / MINUTES_PER_DAY);
}

export function getSurvivedDays(clock) {
  return Math.floor(clock.elapsedMinutes / MINUTES_PER_DAY) + 1;
}

export function getMinuteOfDay(clock) {
  return (START_HOUR * 60 + Math.floor(clock.elapsedMinutes)) % MINUTES_PER_DAY;
}

export function getDateParts(clock) {
  const totalDays = getTotalDays(clock);
  const year = START_YEAR + Math.floor(totalDays / (DAYS_PER_MONTH * MONTHS_PER_YEAR));
  const dayOfYear = totalDays % (DAYS_PER_MONTH * MONTHS_PER_YEAR);
  const month = START_MONTH + Math.floor(dayOfYear / DAYS_PER_MONTH);
  const day = START_DAY + (dayOfYear % DAYS_PER_MONTH);
  return { year, month, day };
}

export function getPeriod(minuteOfDay) {
  const hour = Math.floor(minuteOfDay / 60);
  if (hour >= 6 && hour < 11) return "晨";
  if (hour >= 11 && hour < 17) return "午";
  if (hour >= 17 && hour < 22) return "暮";
  return "夜";
}

export function formatClock(clock) {
  const { year, month, day } = getDateParts(clock);
  const minuteOfDay = getMinuteOfDay(clock);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const paddedHour = String(hour).padStart(2, "0");
  const paddedMinute = String(minute).padStart(2, "0");

  return {
    dateText: `第${year}年${month}月${day}日`,
    timeText: `${getPeriod(minuteOfDay)} ${paddedHour}:${paddedMinute}`,
  };
}
