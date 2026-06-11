import { isColdMonth } from "./season.js";

export const ILLNESSES = {
  wind_cold: { id: "wind_cold", name: "风寒" },
  belly: { id: "belly", name: "腹疾" },
  fever: { id: "fever", name: "热病" },
  frostbite: { id: "frostbite", name: "冻疮" },
  trauma: { id: "trauma", name: "外伤" },
  recovery: { id: "recovery", name: "将养" },
};

export function normalizeIllnesses(savedIllnesses = [], savedInjuries = []) {
  const illnesses = Array.isArray(savedIllnesses) ? savedIllnesses : [];
  const normalized = illnesses
    .filter((illness) => illness && ILLNESSES[illness.id])
    .map((illness) => ({
      id: illness.id,
      name: ILLNESSES[illness.id].name,
      stage: illness.stage === "重" ? "重" : "轻",
      days: Math.max(0, Number.parseInt(illness.days, 10) || 0),
    }));

  if (Array.isArray(savedInjuries) && savedInjuries.includes("风寒") && !normalized.some((illness) => illness.id === "wind_cold")) {
    normalized.push({ id: "wind_cold", name: "风寒", stage: "轻", days: 0 });
  }
  return normalized;
}

export function describeIllnesses(player) {
  if (!Array.isArray(player.illnesses) || player.illnesses.length === 0) return "无病症";
  return player.illnesses.map((illness) => `${illness.stage}${illness.name}${illness.days > 0 ? `（${illness.days}日）` : ""}`).join("、");
}

export function hasSevereIllness(player) {
  return player.illnesses?.some((illness) => illness.stage === "重") ?? false;
}

export function isRecuperating(player) {
  return player.illnesses?.some((illness) => illness.id === "recovery") ?? false;
}

export function canSpendStamina(player, staminaCost) {
  if (hasSevereIllness(player) && staminaCost >= 20) return { ok: false, reason: "病体撑不住" };
  if (isRecuperating(player) && staminaCost >= 20) return { ok: false, reason: "仍在将养，重活撑不住" };
  return { ok: true, reason: "" };
}

export function getIllnessStaminaCapMultiplier(player) {
  return hasSevereIllness(player) ? 0.5 : 1;
}

export function addIllness(player, id, stage = "轻") {
  if (!ILLNESSES[id]) return false;
  player.illnesses = normalizeIllnesses(player.illnesses);
  const existing = player.illnesses.find((illness) => illness.id === id);
  if (existing) {
    if (stage === "重") existing.stage = "重";
    return false;
  }
  player.illnesses.push({ id, name: ILLNESSES[id].name, stage: stage === "重" ? "重" : "轻", days: 0 });
  return true;
}

export function markOutdoorWork(player, workId, context = {}) {
  player.dailyOutdoorWork = true;
  if (context.cold && player.clothing === "褴褛") rollIllness(player, "wind_cold", 0.04 * context.multiplier);
  if (workId === "dock_porter" && context.summer) rollIllness(player, "fever", 0.06 * context.multiplier);
  if (context.cold && (player.clothing === "褴褛" || !context.hasWinterClothes)) rollIllness(player, "frostbite", 0.05 * context.multiplier);
}

export function dailyIllnessSettlement(player, context = {}) {
  player.illnesses = normalizeIllnesses(player.illnesses, player.injuries);
  const multiplier = context.illnessMultiplier ?? 1;

  if (context.cold && player.housing === "露宿") rollIllness(player, "wind_cold", 0.08 * multiplier);
  if (player.cleanliness < 25) rollIllness(player, "belly", 0.03 * multiplier);
  if (context.cold && player.dailyOutdoorWork && (player.clothing === "褴褛" || !context.hasWinterClothes)) {
    rollIllness(player, "frostbite", 0.05 * multiplier);
  }

  player.illnesses.forEach((illness) => {
    illness.days += 1;
    if (illness.id === "recovery") {
      player.health = Math.min(100, player.health + 3);
      if (illness.days >= 3) illness.cured = true;
      return;
    }

    player.health = Math.max(1, player.health - (illness.stage === "重" ? 5 : 2));
    if (illness.stage === "轻" && illness.days >= 5 && Math.random() < 0.1 * multiplier) illness.stage = "重";
  });

  player.illnesses = player.illnesses.filter((illness) => !illness.cured);
  player.dailyOutdoorWork = false;
}

export function checkStrenuousWorsening(player, staminaCost) {
  if (staminaCost < 30 || !Array.isArray(player.illnesses)) return;
  const light = player.illnesses.find((illness) => illness.stage === "轻" && illness.id !== "recovery");
  if (light && Math.random() < 0.15) light.stage = "重";
}

export function checkBellyAfterMeal(player, satietyGain) {
  if ((player.lowSatietyDays ?? 0) >= 2 && satietyGain >= 30) rollIllness(player, "belly", 0.2);
}

export function noteLowSatiety(player) {
  if (player.satiety < 15) player.lowSatietyDays = (player.lowSatietyDays ?? 0) + 1;
  else player.lowSatietyDays = 0;
}

export function treatWithPatentMedicine(player) {
  player.illnesses = normalizeIllnesses(player.illnesses);
  const index = player.illnesses.findIndex((illness) => illness.stage === "轻" && illness.id !== "recovery");
  if (index < 0) return "";
  const [removed] = player.illnesses.splice(index, 1);
  return removed.name;
}

export function getDoctorTreatmentCost(player) {
  const severe = player.illnesses?.find((illness) => illness.stage === "重");
  if (!severe) return 0;
  const medicine = { wind_cold: 220, belly: 260, fever: 500, frostbite: 300, trauma: 350 }[severe.id] ?? 300;
  return 100 + medicine;
}

export function treatByDoctor(player) {
  const cost = getDoctorTreatmentCost(player);
  if (cost <= 0) return { cost: 0, message: "暂无重症可请郎中诊治。" };
  player.illnesses = player.illnesses.filter((illness) => illness.stage !== "重");
  addIllness(player, "recovery", "轻");
  return { cost, message: "安郎中诊治后嘱你将养三日。" };
}

function rollIllness(player, id, probability) {
  if (Math.random() < probability) addIllness(player, id, "轻");
}
