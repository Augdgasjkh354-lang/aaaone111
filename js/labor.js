export function normalizeLabor(saved = {}) {
  return {
    toll: Number.isFinite(saved.toll) ? Math.max(0, saved.toll) : 0,
    oldInjury: Boolean(saved.oldInjury),
    massageUntil: typeof saved.massageUntil === "string" ? saved.massageUntil : "",
    restDays: Number.isFinite(saved.restDays) ? Math.max(0, Math.floor(saved.restDays)) : 0,
  };
}

export function addLaborToll(player, amount) {
  player.labor = normalizeLabor(player.labor);
  const factor = (player.baseAge ?? 20) < 16 ? 1.3 : 1;
  player.labor.toll += amount * factor;
  if (player.labor.toll >= 600) player.labor.oldInjury = true;
}

export function dailyLaborSettlement(player, dateKey, didHeavyWork, context = {}) {
  player.labor = normalizeLabor(player.labor);
  if (didHeavyWork) {
    player.labor.restDays = 0;
  } else {
    player.labor.restDays += 1;
    if (player.labor.restDays >= 7 && player.labor.toll > 0) player.labor.toll = Math.max(0, player.labor.toll - 3);
  }
  if (!player.labor.oldInjury && player.labor.toll < 260) player.labor.restDays = Math.min(player.labor.restDays, 7);
  if (player.labor.oldInjury && context.cold) player.health = Math.max(1, player.health - 1);
}

export function getLaborStaminaMultiplier(player, staminaCost) {
  const labor = normalizeLabor(player.labor);
  if (staminaCost < 20) return 1;
  return labor.toll >= 300 ? 1.2 : 1;
}

export function getLaborStaminaCapPenalty(player, dateKey = "") {
  const labor = normalizeLabor(player.labor);
  if (!labor.oldInjury) return 0;
  if (labor.massageUntil && labor.massageUntil >= dateKey) return 0;
  return 10;
}

export function getLaborContext(player, weatherText = "") {
  const labor = normalizeLabor(player.labor);
  if (labor.oldInjury) return "劳损：旧伤缠身，寒冷日更耗身，重活已不如从前。";
  if (labor.toll >= 300) return `劳损：腰背劳损，${/雨|寒|冷/.test(weatherText) ? "阴雨寒冷时酸痛更明。" : "重活后腰背发紧。"}`;
  return "";
}

export function applyMassage(player, untilDateKey) {
  player.labor = normalizeLabor(player.labor);
  player.labor.massageUntil = untilDateKey;
}
