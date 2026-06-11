export function getSeasonByMonth(month) {
  if (month >= 1 && month <= 3) return "春";
  if (month >= 4 && month <= 6) return "夏";
  if (month >= 7 && month <= 9) return "秋";
  return "冬";
}

export function isColdMonth(month) {
  return month >= 10 || month <= 2;
}

export function getClimateText(month) {
  if (month === 12) return "腊月，城中寒气刺骨";
  if (month >= 10 || month <= 2) return "寒冷期，临安晨夜湿冷";
  if (month >= 1 && month <= 3) return "春日潮润，城中草木渐生";
  if (month >= 4 && month <= 6) return "夏日湿热，街巷气味蒸腾";
  if (month >= 7 && month <= 9) return "秋日渐凉，江风带着水气";
  return "时令平平，城中照常营生";
}

export function getColdSleepHealthPenalty(housing, hasWinterClothes) {
  if (hasWinterClothes) return 0;
  if (housing === "露宿") return -3;
  if (housing === "破庙") return -1;
  return 0;
}

export function getRiverBathColdChance(month) {
  return isColdMonth(month) ? 0.5 : 0.05;
}
