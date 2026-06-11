import { canSpendStamina, checkStrenuousWorsening, markOutdoorWork } from "./illness.js";
import { addCoins, changeSatiety, changeStamina } from "./player.js";
import { getDateParts } from "./clock.js";
import { isColdMonth } from "./season.js";
import { getHooks } from "./worldtick.js";

export const WORK_DEFINITIONS = [
  { id: "scavenge", name: "拾荒", durationMinutes: 120, staminaCost: 10, description: "无门槛，得3-15文。" },
  { id: "beg", name: "讨饭", durationMinutes: 120, staminaCost: 5, description: "无门槛，得0-10文；御街、瓦子稍好。" },
  { id: "dock_porter", name: "码头扛包", durationMinutes: 240, staminaCost: 35, description: "需陈四信任，得90-110文。" },
  { id: "watch_stall", name: "帮周大娘看摊", durationMinutes: 180, staminaCost: 12, description: "需周大娘好感，得30文并管一顿饭。" },
  { id: "copy_letters", name: "替吴先生抄书信", durationMinutes: 120, staminaCost: 8, description: "需识字，得20文并增长识字。" },
  { id: "liu_job", name: "刘麻子的活", durationMinutes: 180, staminaCost: 15, description: "需刘麻子好感，得200-400文，但容易惹麻烦。" },
];

export function getAvailableWorks(state) {
  return WORK_DEFINITIONS.map((work) => ({
    ...work,
    ...getWorkAvailability(state, work.id),
  }));
}

export function createWorkAction(workId, state) {
  const work = WORK_DEFINITIONS.find((item) => item.id === workId);
  if (!work) return null;
  const availability = getWorkAvailability(state, workId);
  if (!availability.available) return { blockedReason: availability.reason };
  const illnessGate = canSpendStamina(state.player, work.staminaCost);
  if (!illnessGate.ok) return { blockedReason: illnessGate.reason };
  if (state.player.stamina < work.staminaCost) return { blockedReason: "体力不支，做不动这份活。" };

  checkStrenuousWorsening(state.player, work.staminaCost);
  changeStamina(state.player, -work.staminaCost);
  return {
    type: "livelihood",
    workId,
    label: work.name,
    remainingMinutes: work.durationMinutes,
    durationMinutes: work.durationMinutes,
  };
}

export function settleWork(state, workId) {
  const work = WORK_DEFINITIONS.find((item) => item.id === workId);
  if (!work) return { message: "这份活计不了了之。", eventChance: 0 };

  if (workId === "scavenge") {
    const reward = randomInt(3, 15);
    addCoins(state.player, reward);
    state.player.cleanliness = Math.max(0, state.player.cleanliness - 10);
    markOutdoorWork(state.player, workId, getOutdoorContext(state));
    return { message: `拾荒回来，拣卖得${reward}文。`, eventChance: 0.18 };
  }

  if (workId === "beg") {
    const hooks = getHooks(state.world);
    const highYield = ["imperial_street", "wazi"].includes(state.player.location);
    let reward = highYield ? randomInt(3, 14) : randomInt(0, 10);
    reward = Math.round(reward * hooks.begMultiplier * (state.player.location === "wazi" ? hooks.waziBegMultiplier : 1));
    addCoins(state.player, reward);
    state.player.beggingStreak = (state.player.beggingStreak || 0) + 1;
    state.player.reputationMark = "讨饭露了脸";
    return { message: `讨饭两时辰，得了${reward}文。`, eventChance: 0.18 };
  }

  state.player.beggingStreak = 0;

  if (workId === "dock_porter") {
    const hooks = getHooks(state.world);
    let reward = Math.round(randomInt(90, 110) * hooks.porterMultiplier);
    if (state.player.inventory.some((item) => item.name === "扁担麻绳")) reward = Math.round(reward * 1.1);
    addCoins(state.player, reward);
    state.player.cleanliness = Math.max(0, state.player.cleanliness - 15);
    markOutdoorWork(state.player, workId, getOutdoorContext(state));
    return { message: `码头扛包完工，领到${reward}文。`, eventChance: 0.18 };
  }

  if (workId === "watch_stall") {
    addCoins(state.player, 30);
    changeSatiety(state.player, 35);
    return { message: "替周大娘看摊三时辰，得30文，还吃了一顿炊饼。", eventChance: 0.18 };
  }

  if (workId === "copy_letters") {
    addCoins(state.player, 20);
    state.player.skills.wen = Math.min(100, state.player.skills.wen + 1);
    return { message: "替吴先生抄完书信，得20文，字也熟了一分。", eventChance: 0.18 };
  }

  if (workId === "liu_job") {
    const reward = randomInt(200, 400);
    addCoins(state.player, reward);
    return { message: `替刘麻子跑完一桩活，拿到${reward}文。`, eventChance: 0.3, forceTrouble: Math.random() < 0.3 };
  }

  return { message: `${work.name}做完了。`, eventChance: 0.18 };
}

export function getWorkById(workId) {
  return WORK_DEFINITIONS.find((work) => work.id === workId) ?? null;
}

function getWorkAvailability(state, workId) {
  const work = WORK_DEFINITIONS.find((item) => item.id === workId);
  const illnessGate = canSpendStamina(state.player, work?.staminaCost ?? 0);
  if (!illnessGate.ok) return { available: false, reason: illnessGate.reason };

  if (workId === "dock_porter") {
    const chenSi = state.npcs.find((npc) => npc.id === "chen_si");
    if ((chenSi?.relation?.trust ?? 0) < 20) return { available: false, reason: "陈四还信不过你" };
  }

  if (workId === "watch_stall") {
    const zhou = state.npcs.find((npc) => npc.id === "zhou_daniang");
    if ((zhou?.relation?.favor ?? 0) < 15) return { available: false, reason: "周大娘还没放心把摊交给你" };
  }

  if (workId === "copy_letters" && (state.player.skills?.wen ?? 0) < 30) {
    return { available: false, reason: "你还不识字" };
  }

  if (workId === "liu_job") {
    const liu = state.npcs.find((npc) => npc.id === "liu_mazi");
    if ((liu?.relation?.favor ?? 0) < 10) return { available: false, reason: "刘麻子还不肯把活交给你" };
  }

  return { available: true, reason: "" };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getOutdoorContext(state) {
  const { month } = getDateParts(state.clock);
  const hooks = getHooks(state.world);
  return {
    cold: isColdMonth(month),
    summer: month >= 4 && month <= 6,
    hasWinterClothes: state.player.inventory.some((item) => item.name === "冬衣"),
    multiplier: hooks.illnessMultiplier,
  };
}
