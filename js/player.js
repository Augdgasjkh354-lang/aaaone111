import { normalizeIllnesses } from "./illness.js";
import { normalizeClothing, normalizeInventory } from "./items.js";
import { normalizeDailySkillGains, normalizeMentors, normalizeSkillProgress, normalizeSkills } from "./skills.js";
import { normalizeIdentity, normalizeIdentityState } from "./identity.js";
import { normalizeScholarState } from "./scholar.js";
import { createLuck } from "./luck.js";
import { normalizeScamState } from "./scam.js";
import { normalizeLabor } from "./labor.js";
import { START_LOCATION_ID, getLocation } from "./world.js";

export function createPlayer(savedPlayer = {}) {
  const savedLocation = typeof savedPlayer.location === "string" ? savedPlayer.location : START_LOCATION_ID;

  return {
    coins: Number.isFinite(savedPlayer.coins) ? savedPlayer.coins : 80,
    silver: Number.isFinite(savedPlayer.silver) ? savedPlayer.silver : 0,
    huizi: Number.isFinite(savedPlayer.huizi) ? savedPlayer.huizi : 0,
    health: clampStat(savedPlayer.health ?? 100),
    stamina: clampStat(savedPlayer.stamina ?? 100),
    satiety: clampStat(savedPlayer.satiety ?? 75),
    baseAge: Number.isFinite(savedPlayer.baseAge) ? savedPlayer.baseAge : 20,
    location: getLocation(savedLocation).id,
    injuries: Array.isArray(savedPlayer.injuries) ? savedPlayer.injuries.filter((injury) => typeof injury === "string" && injury !== "风寒") : [],
    memories: Array.isArray(savedPlayer.memories) ? savedPlayer.memories : [],
    identity: normalizeIdentity(savedPlayer.identity),
    identityState: normalizeIdentityState(savedPlayer.identityState),
    scholar: normalizeScholarState(savedPlayer.scholar),
    reputation: Number.isFinite(savedPlayer.reputation) ? savedPlayer.reputation : 0,
    luck: createLuck(savedPlayer.luck),
    scams: normalizeScamState(savedPlayer.scams),
    gambling: normalizeGambling(savedPlayer.gambling),
    begging: normalizeBegging(savedPlayer.begging),
    labor: normalizeLabor(savedPlayer.labor),
    officialRisk: Number.isFinite(savedPlayer.officialRisk) ? savedPlayer.officialRisk : 0,
    skills: normalizeSkills(savedPlayer.skills),
    mentorUnlocks: normalizeMentors(savedPlayer.mentorUnlocks),
    dailySkillGains: normalizeDailySkillGains(savedPlayer.dailySkillGains),
    skillProgress: normalizeSkillProgress(savedPlayer.skillProgress),
    inventory: normalizeInventory(savedPlayer.inventory),
    clothing: normalizeClothing(savedPlayer.clothing),
    cleanliness: clampStat(savedPlayer.cleanliness ?? 50),
    lastCleanlinessDay: typeof savedPlayer.lastCleanlinessDay === "string" ? savedPlayer.lastCleanlinessDay : "",
    lastWindColdDay: typeof savedPlayer.lastWindColdDay === "string" ? savedPlayer.lastWindColdDay : "",
    illnesses: normalizeIllnesses(savedPlayer.illnesses, savedPlayer.injuries),
    lowSatietyDays: Number.isFinite(savedPlayer.lowSatietyDays) ? savedPlayer.lowSatietyDays : 0,
    dailyOutdoorWork: Boolean(savedPlayer.dailyOutdoorWork),
    housing: normalizeHousing(savedPlayer.housing),
    unlockedHousing: normalizeUnlockedHousing(savedPlayer.unlockedHousing),
    beggingStreak: Number.isFinite(savedPlayer.beggingStreak) ? savedPlayer.beggingStreak : 0,
    reputationMark: typeof savedPlayer.reputationMark === "string" ? savedPlayer.reputationMark : "",
    lastRentMonthKey: typeof savedPlayer.lastRentMonthKey === "string" ? savedPlayer.lastRentMonthKey : "",
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

function normalizeHousing(housing) {
  return ["露宿", "破庙", "租屋"].includes(housing) ? housing : "露宿";
}

function normalizeUnlockedHousing(unlockedHousing = {}) {
  return {
    temple: Boolean(unlockedHousing.temple),
    rented: Boolean(unlockedHousing.rented),
  };
}

function normalizeGambling(saved = {}) {
  return {
    lossStreak: Number.isFinite(saved.lossStreak) ? Math.max(0, Math.floor(saved.lossStreak)) : 0,
    lostToday: Number.isFinite(saved.lostToday) ? Math.max(0, Math.floor(saved.lostToday)) : 0,
    lastDateKey: typeof saved.lastDateKey === "string" ? saved.lastDateKey : "",
    redEyeUntil: typeof saved.redEyeUntil === "string" ? saved.redEyeUntil : "",
  };
}

function normalizeBegging(saved = {}) {
  return {
    territoryCount: Number.isFinite(saved.territoryCount) ? Math.max(0, Math.floor(saved.territoryCount)) : 0,
    qianContacted: Boolean(saved.qianContacted),
    mode: ["none", "pay", "resist", "join"].includes(saved.mode) ? saved.mode : "none",
    qianNarrated: Boolean(saved.qianNarrated),
  };
}
