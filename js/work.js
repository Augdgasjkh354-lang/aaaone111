import { canSpendStamina, checkStrenuousWorsening, markOutdoorWork } from "./illness.js";
import { addCoins, changeSatiety, changeStamina } from "./player.js";
import { getDateParts, getMinuteOfDay, getPeriod } from "./clock.js";
import { isColdMonth } from "./season.js";
import { getHooks } from "./worldtick.js";
import { chance } from "./luck.js";
import { getActiveFestival, isNightMarket } from "./festival.js";
import { gainSkill } from "./skills.js";
import { canDoClerkDuty, canTutorChildren, getClerkWorkDefinition, getTutorWorkDefinition, settleClerkDuty } from "./scholar.js";
import { getLaborStaminaMultiplier } from "./labor.js";

export const WORK_DEFINITIONS = [
  { id: "scavenge", name: "拾荒", durationMinutes: 120, staminaCost: 10, description: "无门槛，得3-15文。" },
  { id: "beg", name: "讨饭", durationMinutes: 120, staminaCost: 5, description: "无门槛，得0-10文；御街、瓦子稍好。" },
  { id: "beg_pay", name: "讨饭（交例钱）", durationMinutes: 120, staminaCost: 5, description: "三成归钱团头，正常讨。" },
  { id: "beg_resist", name: "讨饭（不交硬讨）", durationMinutes: 120, staminaCost: 5, description: "可能被赶打，钱团头疑心上涨。" },
  { id: "beg_join", name: "讨饭（钱团头门下）", durationMinutes: 120, staminaCost: 5, description: "两成归钱团头，收益+50%。" },
  { id: "dock_porter", name: "码头扛包", durationMinutes: 240, staminaCost: 35, description: "需陈四信任，得90-110文。" },
  { id: "watch_stall", name: "帮周大娘看摊", durationMinutes: 180, staminaCost: 12, description: "需周大娘好感，得30文并管一顿饭。" },
  { id: "copy_letters", name: "替吴先生抄书信", durationMinutes: 120, staminaCost: 8, description: "需识字，得20文并增长识字。" },
  { id: "liu_job", name: "刘麻子的活", durationMinutes: 180, staminaCost: 15, description: "需刘麻子好感，得200-400文，但容易惹麻烦。" },
];

export function getAvailableWorks(state) {
  const works = [...WORK_DEFINITIONS];
  if (canDoClerkDuty(state.player)) works.push(getClerkWorkDefinition());
  if (canTutorChildren(state.player)) works.push(getTutorWorkDefinition(state.player));
  if (state.player.begging?.mode === "join") works.push(getDynamicWork("qian_runner", state.player));
  if (getActiveFestival(getDateParts(state.clock))) works.push({ id: "festival_oddjob", name: "挑担帮闲", durationMinutes: 120, staminaCost: 15, description: "节庆零工，得40-60文。" });
  if (state.player.begging?.mode === "none" && state.player.begging?.qianContacted) return works.filter((work) => !["beg", "beg_pay", "beg_resist", "beg_join"].includes(work.id)).concat(WORK_DEFINITIONS.filter((work) => ["beg_pay", "beg_resist", "beg_join"].includes(work.id))).map((work) => ({ ...work, ...getWorkAvailability(state, work.id) }));
  return works.map((work) => ({
    ...work,
    ...getWorkAvailability(state, work.id),
  }));
}

export function createWorkAction(workId, state) {
  const work = getDynamicWork(workId, state.player) ?? WORK_DEFINITIONS.find((item) => item.id === workId);
  if (!work) return null;
  const availability = getWorkAvailability(state, workId);
  if (!availability.available) return { blockedReason: availability.reason };
  const staminaCost = Math.ceil(work.staminaCost * getLaborStaminaMultiplier(state.player, work.staminaCost));
  const illnessGate = canSpendStamina(state.player, staminaCost);
  if (!illnessGate.ok) return { blockedReason: illnessGate.reason };
  if (state.player.stamina < staminaCost) return { blockedReason: "体力不支，做不动这份活。" };

  checkStrenuousWorsening(state.player, staminaCost);
  changeStamina(state.player, -staminaCost);
  return {
    type: "livelihood",
    workId,
    label: work.name,
    remainingMinutes: work.durationMinutes,
    durationMinutes: work.durationMinutes,
  };
}

export function settleWork(state, workId) {
  const work = getDynamicWork(workId, state.player) ?? WORK_DEFINITIONS.find((item) => item.id === workId);
  if (!work) return { message: "这份活计不了了之。", eventChance: 0 };

  if (workId === "yamen_duty") return settleClerkDuty(state);

  if (workId === "festival_oddjob") {
    let reward = randomInt(40, 60);
    if (isNightMarket(state.player.location, getPeriod(getMinuteOfDay(state.clock)))) reward = Math.round(reward * 1.3);
    addCoins(state.player, reward);
    return { message: `节庆里替人挑担帮闲，得${reward}文。`, eventChance: 0.12, goodEventChance: 0.04 };
  }

  if (workId === "tutor_children") {
    const reward = state.player.identity === "进士(待阙)" ? 160 : 80;
    addCoins(state.player, reward);
    let bonus = "";
    if (chance(0.18, "good_skill_bonus", state.player)) {
      const skill = chance(0.5, "neutral") ? "suan" : "tan";
      const gained = gainSkill(state.player, skill, 1, dateKey(getDateParts(state.clock)));
      if (gained > 0) bonus = `，${skill === "suan" ? "算" : "谈"}也长进一分`;
    }
    return { message: `去富家坐馆教蒙童三小时，收得束脩${reward}文${bonus}。`, eventChance: 0.12 };
  }

  if (workId === "scavenge") {
    const reward = randomInt(3, 15);
    addCoins(state.player, reward);
    state.player.cleanliness = Math.max(0, state.player.cleanliness - 10);
    markOutdoorWork(state.player, workId, getOutdoorContext(state));
    return { message: `拾荒回来，拣卖得${reward}文。`, eventChance: 0.18 };
  }

  if (["beg", "beg_pay", "beg_resist", "beg_join"].includes(workId)) {
    return settleBegging(state, workId);
  }

  state.player.beggingStreak = 0;

  if (workId === "dock_porter") {
    const hooks = getHooks(state.world);
    let reward = Math.round(randomInt(90, 110) * hooks.porterMultiplier);
    if (state.player.labor?.oldInjury) reward = Math.round(reward * 0.7);
    if (state.player.inventory.some((item) => item.name === "扁担麻绳")) reward = Math.round(reward * 1.1);
    addCoins(state.player, reward);
    state.player.cleanliness = Math.max(0, state.player.cleanliness - 15);
    markOutdoorWork(state.player, workId, getOutdoorContext(state));
    return { message: `码头扛包完工，领到${reward}文。`, eventChance: 0.18 };
  }

  if (workId === "watch_stall") {
    addCoins(state.player, 30);
    changeSatiety(state.player, 35);
    const chain = state.world?.neighborChains?.chains?.find((item) => item.id === "zhou_husband" && item.status === "active");
    if (chain) chain.interventions.watchStall = (chain.interventions.watchStall ?? 0) + 1;
    return { message: "替周大娘看摊三时辰，得30文，还吃了一顿炊饼。", eventChance: 0.18 };
  }

  if (workId === "copy_letters") {
    addCoins(state.player, 20);
    gainSkill(state.player, "wen", 1, dateKey(getDateParts(state.clock)));
    return { message: "替吴先生抄完书信，得20文，字也熟了一分。", eventChance: 0.18 };
  }

  if (workId === "liu_job") {
    const reward = randomInt(200, 400);
    addCoins(state.player, reward);
    return { message: `替刘麻子跑完一桩活，拿到${reward}文。`, eventChance: 0.3, forceTrouble: chance(0.3, "bad_work_trouble", state.player) };
  }

  if (workId === "qian_runner") {
    const reward = randomInt(90, 180);
    addCoins(state.player, reward);
    return { message: `替钱团头跑完一桩灰色小活，拿到${reward}文。`, eventChance: 0.18, forceTrouble: chance(0.12, "bad_work_trouble", state.player) };
  }

  return { message: `${work.name}做完了。`, eventChance: 0.18 };
}

export function getWorkById(workId) {
  return getDynamicWork(workId) ?? WORK_DEFINITIONS.find((work) => work.id === workId) ?? null;
}

function getWorkAvailability(state, workId) {
  const work = getDynamicWork(workId, state.player) ?? WORK_DEFINITIONS.find((item) => item.id === workId);
  const illnessGate = canSpendStamina(state.player, work?.staminaCost ?? 0);
  if (!illnessGate.ok) return { available: false, reason: illnessGate.reason };

  if (workId === "yamen_duty" && !canDoClerkDuty(state.player)) {
    return { available: false, reason: "须为衙门书吏" };
  }

  if (workId === "tutor_children" && !canTutorChildren(state.player)) {
    return { available: false, reason: "需曾得解、得解士子或文≥75" };
  }

  if (workId === "dock_porter") {
    const chenSi = state.npcs.find((npc) => npc.id === "chen_si");
    if ((chenSi?.relation?.trust ?? 0) < 20) return { available: false, reason: "陈四还信不过你" };
  }

  if (workId === "watch_stall") {
    const zhou = state.npcs.find((npc) => npc.id === "zhou_daniang");
    if ((zhou?.workPausedUntil ?? 0) > 0) return { available: false, reason: "周大娘摊子暂歇" };
    if ((zhou?.relation?.favor ?? 0) < 15) return { available: false, reason: "周大娘还没放心把摊交给你" };
  }

  if (workId === "copy_letters" && (state.player.skills?.wen ?? 0) < 30) {
    return { available: false, reason: "你还不识字" };
  }

  if (workId === "beg_join") {
    const qian = state.npcs.find((npc) => npc.id === "qian_tuantou");
    if ((qian?.relation?.favor ?? 0) < 30) return { available: false, reason: "钱团头好感不足30" };
  }

  if (workId === "qian_runner") {
    if (state.player.begging?.mode !== "join") return { available: false, reason: "须投靠钱团头" };
  }

  if (workId === "liu_job") {
    const liu = state.npcs.find((npc) => npc.id === "liu_mazi");
    if ((liu?.relation?.favor ?? 0) < 10) return { available: false, reason: "刘麻子还不肯把活交给你" };
  }

  return { available: true, reason: "" };
}

function settleBegging(state, workId) {
  const hooks = getHooks(state.world);
  const highYield = ["imperial_street", "wazi"].includes(state.player.location);
  const festival = getActiveFestival(getDateParts(state.clock));
  const night = isNightMarket(state.player.location, getPeriod(getMinuteOfDay(state.clock)));
  let reward = highYield ? randomInt(3, 14) : randomInt(0, 10);
  reward = Math.round(reward * hooks.begMultiplier * (state.player.location === "wazi" ? hooks.waziBegMultiplier : 1));
  if (festival) reward *= 2;
  if (night) reward = Math.round(reward * 1.3);
  state.player.beggingStreak = (state.player.beggingStreak || 0) + 1;
  state.player.reputationMark = "讨饭露了脸";

  const inTurf = ["slum_alley", "rice_market", "wazi"].includes(state.player.location);
  state.player.begging = state.player.begging ?? { territoryCount: 0, qianContacted: false, mode: "none" };
  if (inTurf && !state.player.begging.qianContacted) {
    state.player.begging.territoryCount += 1;
    if (state.player.begging.territoryCount >= 3) {
      state.player.begging.qianContacted = true;
      addCoins(state.player, reward);
      return { message: `讨饭两时辰，得了${reward}文。`, eventChance: 0.18, qianContact: true };
    }
  }

  if (workId === "beg_pay" || state.player.begging.mode === "pay") {
    const cut = Math.floor(reward * 0.3);
    payQian(state, cut);
    addCoins(state.player, reward - cut);
    return { message: `讨饭两时辰，得${reward}文，交给钱团头例钱${cut}文。`, eventChance: 0.16 };
  }
  if (workId === "beg_join" || state.player.begging.mode === "join") {
    reward = Math.round(reward * 1.5);
    const cut = Math.floor(reward * 0.2);
    payQian(state, cut);
    addCoins(state.player, reward - cut);
    return { message: `借钱团头的好位置讨饭，得${reward}文，抽给他${cut}文。`, eventChance: 0.14 };
  }
  if (workId === "beg_resist") {
    const qian = state.npcs.find((npc) => npc.id === "qian_tuantou");
    if (qian) qian.relation.doubt = Math.min(100, (qian.relation.doubt ?? 0) + 5);
    if (chance(0.4, "bad_beg_drive", state.player)) {
      state.player.cleanliness = Math.max(0, state.player.cleanliness - 10);
      return { message: "硬在地盘上讨饭，被钱团头的人驱赶，铜钱没落着，衣上又添尘泥。", eventChance: 0.12 };
    }
    if (chance(0.15, "bad_beg_beaten", state.player)) {
      state.player.health = Math.max(1, state.player.health - 8);
      return { message: "硬讨时挨了一顿拳脚，身上疼痛，今日没讨着钱。", eventChance: 0.15 };
    }
    addCoins(state.player, reward);
    return { message: `硬着头皮讨了两时辰，得${reward}文。`, eventChance: 0.2 };
  }
  addCoins(state.player, reward);
  return { message: `讨饭两时辰，得了${reward}文。`, eventChance: 0.18 };
}

function payQian(state, amount) {
  const qian = state.npcs.find((npc) => npc.id === "qian_tuantou");
  if (qian) qian.assets.cash += amount;
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

function dateKey(parts) { return `${parts.year}-${parts.month}-${parts.day}`; }

function getDynamicWork(workId, player = {}) {
  if (workId === "yamen_duty") return getClerkWorkDefinition();
  if (workId === "tutor_children") return getTutorWorkDefinition(player);
  if (workId === "festival_oddjob") return { id: "festival_oddjob", name: "挑担帮闲", durationMinutes: 120, staminaCost: 15, description: "节庆零工，得40-60文。" };
  if (workId === "qian_runner") return { id: "qian_runner", name: "钱团头的跑腿", durationMinutes: 180, staminaCost: 12, description: "需投靠钱团头，价低些但较稳。" };
  return null;
}
