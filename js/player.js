export function createPlayer(savedPlayer = {}) {
  return {
    coins: Number.isFinite(savedPlayer.coins) ? savedPlayer.coins : 80,
    silver: Number.isFinite(savedPlayer.silver) ? savedPlayer.silver : 0,
    huizi: Number.isFinite(savedPlayer.huizi) ? savedPlayer.huizi : 0,
    health: clampStat(savedPlayer.health ?? 100),
    stamina: clampStat(savedPlayer.stamina ?? 100),
    satiety: clampStat(savedPlayer.satiety ?? 75),
    baseAge: Number.isFinite(savedPlayer.baseAge) ? savedPlayer.baseAge : 20,
  };
}

export function clampStat(value) {
  return Math.max(0, Math.min(100, Number(value)));
}

export function getStaminaMax(player) {
  // 健康太差时，即使睡足也难以恢复到满体力。
  if (player.health >= 70) return 100;
  if (player.health >= 40) return 85;
  if (player.health >= 15) return 65;
  return 45;
}

export function spendCoins(player, amount) {
  if (player.coins < amount) return false;
  player.coins -= amount;
  return true;
}

export function addCoins(player, amount) {
  player.coins += amount;
}

export function changeSatiety(player, amount) {
  player.satiety = clampStat(player.satiety + amount);
}

export function changeStamina(player, amount) {
  player.stamina = Math.max(0, Math.min(getStaminaMax(player), player.stamina + amount));
}

export function changeHealth(player, amount) {
  player.health = clampStat(player.health + amount);
  player.stamina = Math.min(player.stamina, getStaminaMax(player));
}

export function getCurrentAge(player, elapsedMinutes) {
  // 年龄是后台数值：按游戏时间自然增长，但本阶段不在界面显示具体数字。
  return player.baseAge + elapsedMinutes / (60 * 24 * 30 * 12);
}

export function describeSatiety(value) {
  if (value > 70) return "腹中饱足";
  if (value >= 40) return "略有饥意";
  if (value >= 15) return "饥肠辘辘";
  return "饿得发慌";
}

export function describeHealth(value) {
  if (value > 70) return "身子康健";
  if (value >= 40) return "略感不适";
  if (value >= 15) return "病气缠身";
  return "气若游丝";
}

export function describeStamina(value) {
  if (value > 70) return "精力充沛";
  if (value >= 40) return "略有倦意";
  if (value >= 15) return "步履沉重";
  return "几近力竭";
}
