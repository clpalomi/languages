const PARAMS = {
  decayHalfLifeDays: 10,
  baseRate: 2.35,
  blockSize: 10,
  gainMargin: 1,
  loseMargin: 0.92,
  multipliers: {
    sameDay: 2.3,
    consecutiveDay: 2.25,
    sameWeek: 2.2,
    consecutiveWeek: 2.15,
    sameMonth: 2.05,
    consecutiveMonth: 2.02,
    default: 1.00
  },
};

export function computeStudyStrength(sessions, params = PARAMS) {
  const ordered = [...sessions].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  let value = 0;
  let blocks = 0;
  let lastDate = null;

  const timeline = [];

  for (const session of ordered) {
    const date = new Date(session.date);
    const minutes = Number(session.minutes || 0);

    if (lastDate) {
      const daysGap = daysBetween(lastDate, date);
      value *= Math.exp(-daysGap / params.decayHalfLifeDays);
    }

    const multiplier = lastDate
      ? getConsistencyMultiplier(lastDate, date, params.multipliers)
      : 1;

    value += minutes * params.baseRate * multiplier;

    const gainBlocks = Math.floor(
      value / (params.blockSize * params.gainMargin)
    );

    if (gainBlocks > blocks) {
      blocks = gainBlocks;
    }

    const loseThreshold = blocks * params.blockSize * params.loseMargin;

    if (blocks > 0 && value < loseThreshold) {
      blocks = Math.floor(value / (params.blockSize * params.gainMargin));
    }

    timeline.push({
      date: session.date,
      language: session.language,
      minutes,
      multiplier,
      value,
      blocks
    });

    lastDate = date;
  }

  return timeline;
}

function daysBetween(a, b) {
  return Math.max(0, (b - a) / (1000 * 60 * 60 * 24));
}

function getConsistencyMultiplier(prev, current, m) {
  const gap = daysBetween(prev, current);

  if (gap < 1) return m.sameDay;
  if (gap <= 1.5) return m.consecutiveDay;
  if (gap <= 7) return m.sameWeek;
  if (gap <= 14) return m.consecutiveWeek;
  if (gap <= 31) return m.sameMonth;
  if (gap <= 62) return m.consecutiveMonth;

  return m.default;
}
