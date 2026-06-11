import { advanceClock, advanceClockToNextMorning, createClock, getDateParts, getMinuteOfDay, getMinutesPerRealSecond, getPeriod } from "./clock.js";
import { addCoins, changeHealth, changeSatiety, changeStamina, createPlayer, getStaminaMax, spendCoins } from "./player.js";
import { checkBellyAfterMeal, dailyIllnessSettlement, getDoctorTreatmentCost, getIllnessStaminaCapMultiplier, noteLowSatiety, treatByDoctor } from "./illness.js";
import { getLocation, getRoute, getTravelStaminaCost } from "./world.js";
import { applyMetabolism, getDeath } from "./metabolism.js";
import { runStoryAction } from "./story.js";
import { createNpcs, getPresentNpcs as getNpcsAtLocation } from "./npcs.js";
import { getWorkById, createWorkAction, settleWork } from "./work.js";
import { institutions } from "./economy.js";
import { purchaseItem } from "./items.js";
import { gainSkill, getStudyOptions } from "./skills.js";
import { getColdSleepHealthPenalty, getRiverBathColdChance, getSeasonByMonth, isColdMonth } from "./season.js";
import { applyRicePressure, createWorldState, dailyWorldTick, getHooks } from "./worldtick.js";
import { bindControls, render } from "./ui.js";
import { clearSave, loadGame, saveGame } from "./save.js";

const MAX_FRAME_SECONDS = 0.5;
const AUTOSAVE_REAL_MS = 30_000;
const API_KEY_STORAGE_KEY = "linan-deepseek-api-key";
const THINKING_MODE_STORAGE_KEY = "linan-deepseek-thinking-mode";

let state = createInitialState();
let lastFrameTime = performance.now();
let lastAutosaveTime = performance.now();

bindControls({
  onSpeedChange(speedIndex) {
    state.clock.speedIndex = speedIndex;
    saveGame(state);
    render(state);
  },
  onTogglePause() {
    if (state.storyLoading) return;
    state.clock.paused = !state.clock.paused;
    saveGame(state);
    render(state);
  },
  onRestart: restartGame,
  onAction: startAction,
  onToggleTravel: toggleTravelList,
  onTravel: startTravel,
  onCancelTravel: cancelTravel,
  onFreeAction: startFreeAction,
  onOpenSettings: openSettings,
  onCloseSettings: closeSettings,
  onSaveSettings: saveSettings,
  onViewAuditLog: toggleAuditLog,
  onToggleWork: toggleWorkList,
  onWork: startWork,
  onHousingChange: changeHousing,
  onToggleStudy: toggleStudyList,
  onStudy: startStudy,
  onTogglePurchase: togglePurchaseList,
  onPurchase: buyItem,
  onToggleRepair: toggleRepairList,
  onRepair: startRepair,
});

ensureApiKeyOnFirstEnter();
render(state);
requestAnimationFrame(tick);

function createInitialState() {
  const saved = loadGame();
  return {
    clock: createClock(saved?.clock),
    player: createPlayer(saved?.player),
    npcs: createNpcs(saved?.npcs),
    world: createWorldState(saved?.world),
    currentAction: saved?.currentAction ?? null,
    dead: Boolean(saved?.dead),
    deathReason: saved?.deathReason ?? "",
    message: "请选择接下来做什么。",
    travelOpen: false,
    workOpen: false,
    studyOpen: false,
    purchaseOpen: false,
    repairOpen: false,
    storyLoading: false,
    storyLog: Array.isArray(saved?.storyLog) ? saved.storyLog : [],
    auditLog: Array.isArray(saved?.auditLog) ? saved.auditLog : [],
    settingsOpen: false,
    showAuditLog: false,
    storySettings: loadStorySettings(saved?.storySettings),
    lastDailySettlement: saved?.lastDailySettlement ?? "",
  };
}

function tick(now) {
  const realDeltaSeconds = Math.min((now - lastFrameTime) / 1000, MAX_FRAME_SECONDS);
  lastFrameTime = now;

  if (!state.clock.paused && !state.dead && !state.storyLoading) {
    const gameMinutes = realDeltaSeconds * getMinutesPerRealSecond(state.clock);
    advanceGame(gameMinutes);
  }

  if (now - lastAutosaveTime >= AUTOSAVE_REAL_MS) {
    saveGame(state);
    lastAutosaveTime = now;
  }

  render(state);
  requestAnimationFrame(tick);
}

function advanceGame(gameMinutes, options = {}) {
  if (gameMinutes <= 0) return;

  const previousDateParts = getDateParts(state.clock);
  advanceClock(state.clock, gameMinutes);
  runDailySettlementsSince(previousDateParts);
  applyMetabolism(state.player, gameMinutes, options);
  advanceCurrentAction(gameMinutes);
  checkDeath();
}

function startAction(actionName) {
  if (state.dead || state.currentAction || state.storyLoading) return;

  const actions = {
    eat: () => eatMeal(),
    sleep: () => sleepToMorning(),
    work: () => toggleWorkList(),
  };

  actions[actionName]?.();
  saveGame(state);
  render(state);
}

async function startFreeAction(actionText) {
  const text = String(actionText || "").trim();
  if (!text || state.dead || state.currentAction || state.storyLoading) return;

  if (!ensureApiKeyOnFirstEnter()) {
    state.message = "请先设置DeepSeek API Key。";
    state.settingsOpen = true;
    render(state);
    return;
  }

  const wasPaused = state.clock.paused;
  state.storyLoading = true;
  state.clock.paused = true;
  state.travelOpen = false;
  state.message = "……";
  render(state);

  try {
    const result = await runStoryAction(state, text, state.storySettings.apiKey, state.storySettings.mode);
    appendStory(result.scene);
    if (!result.rejected) {
      advanceGame(result.durationMinutes);
      handleHousingDiscovery(text);
      handleRentIntent(text);
      state.message = `此事耗时约 ${result.durationMinutes} 分钟。`;
    } else {
      state.message = "此事未曾发生。";
    }
    saveGame(state);
  } catch (error) {
    state.message = `AI调用失败：${error.message}`;
  } finally {
    state.storyLoading = false;
    state.clock.paused = state.dead ? true : wasPaused;
    lastFrameTime = performance.now();
    lastAutosaveTime = performance.now();
    saveGame(state);
    render(state);
  }
}

function eatMeal() {
  const mealPrice = Math.max(1, Math.round(10 * (state.world?.riceIndex ?? 100) / 100));
  if (!spendCoins(state.player, mealPrice)) {
    state.message = `铜钱不足，买不起这顿饭（需${mealPrice}文）。`;
    return;
  }

  checkBellyAfterMeal(state.player, 40);
  changeSatiety(state.player, 40);
  state.message = `热饭下肚，花了${mealPrice}文。`;
}

function sleepToMorning() {
  const previousDateParts = getDateParts(state.clock);
  const sleptMinutes = advanceClockToNextMorning(state.clock);
  runDailySettlementsSince(previousDateParts);
  applyMetabolism(state.player, sleptMinutes, { sleeping: true });
  const capRatio = getHousingStaminaCapRatio();
  state.player.stamina = Math.min(getStaminaMax(state.player) * capRatio * getIllnessStaminaCapMultiplier(state.player), state.player.stamina);
  state.message = resolveHousingSleepMessage();
  checkDeath();
}

function toggleTravelList() {
  if (state.dead || state.currentAction || state.storyLoading) return;

  state.travelOpen = !state.travelOpen;
  state.workOpen = false;
  state.studyOpen = false;
  state.purchaseOpen = false;
  state.repairOpen = false;
  render(state);
}

function toggleWorkList() {
  if (state.dead || state.currentAction || state.storyLoading) return;

  state.workOpen = !state.workOpen;
  state.travelOpen = false;
  render(state);
}

function toggleStudyList() {
  if (state.dead || state.currentAction || state.storyLoading) return;
  state.studyOpen = !state.studyOpen;
  state.travelOpen = false;
  state.workOpen = false;
  state.purchaseOpen = false;
  state.repairOpen = false;
  render(state);
}

function togglePurchaseList() {
  if (state.dead || state.currentAction || state.storyLoading) return;
  state.purchaseOpen = !state.purchaseOpen;
  state.travelOpen = false;
  state.workOpen = false;
  state.studyOpen = false;
  state.repairOpen = false;
  render(state);
}

function toggleRepairList() {
  if (state.dead || state.currentAction || state.storyLoading) return;
  state.repairOpen = !state.repairOpen;
  state.travelOpen = false;
  state.workOpen = false;
  state.studyOpen = false;
  state.purchaseOpen = false;
  render(state);
}

function startWork(workId) {
  if (state.dead || state.currentAction || state.storyLoading) return;

  const action = createWorkAction(workId, state);
  if (!action) return;
  if (action.blockedReason) {
    state.message = action.blockedReason;
    render(state);
    return;
  }

  state.currentAction = action;
  closeMenus();
  state.message = `你开始${action.label}。`;
  saveGame(state);
  render(state);
}

function startStudy(studyId) {
  if (state.dead || state.currentAction || state.storyLoading) return;
  const option = getStudyOptions(state).find((item) => item.id === studyId);
  if (!option) return;
  if (!option.available) {
    state.message = option.reason;
    render(state);
    return;
  }
  if (state.player.stamina < option.staminaCost) {
    state.message = "体力不支，修习不动。";
    render(state);
    return;
  }
  changeStamina(state.player, -option.staminaCost);
  state.currentAction = { type: "study", label: option.name, studyId, skill: option.skill, remainingMinutes: option.durationMinutes };
  closeMenus();
  state.message = `你开始${option.name}。`;
  saveGame(state);
  render(state);
}

function buyItem(itemId) {
  if (state.dead || state.currentAction || state.storyLoading) return;
  const result = purchaseItem(state.player, itemId);
  state.message = result.message;
  saveGame(state);
  render(state);
}

function startRepair(repairId) {
  if (state.dead || state.currentAction || state.storyLoading) return;
  if (repairId === "river_bath") {
    if (!["dock"].includes(state.player.location)) {
      state.message = "此处不便去河边洗澡。";
      render(state);
      return;
    }
    state.currentAction = { type: "repair", label: "河边洗澡", repairId, remainingMinutes: 120 };
  } else if (repairId === "doctor") {
    return seekDoctor();
  } else if (repairId === "bathhouse") {
    if (state.player.location !== "qinghefang") {
      state.message = "浴堂在清河坊。";
      render(state);
      return;
    }
    if (!spendCoins(state.player, 5)) {
      state.message = "浴堂要5文。";
      render(state);
      return;
    }
    state.currentAction = { type: "repair", label: "浴堂洗澡", repairId, remainingMinutes: 60 };
  }
  closeMenus();
  saveGame(state);
  render(state);
}

function seekDoctor() {
  const present = getNpcsAtLocation(state.npcs, state.player.location, getPeriod(getMinuteOfDay(state.clock)));
  if (!present.some((npc) => npc.id === "an_langzhong")) {
    state.message = "安郎中不在此处。";
    render(state);
    return;
  }
  const cost = getDoctorTreatmentCost(state.player);
  if (cost <= 0) {
    state.message = "安郎中看过，说暂无重症需诊治。";
    render(state);
    return;
  }
  const paid = Math.min(state.player.coins, cost);
  state.player.coins -= paid;
  const owed = cost - paid;
  if (owed > 0) {
    const an = state.npcs.find((npc) => npc.id === "an_langzhong");
    an.debts.push({ withPlayer: "player_owes", amount: owed, note: "诊金药钱", date: getDateKey() });
  }
  const result = treatByDoctor(state.player);
  state.message = `${result.message}${owed > 0 ? ` 赊欠安郎中${owed}文。` : ` 花费${cost}文。`}`;
  appendStory(state.message);
  closeMenus();
  saveGame(state);
  render(state);
}

function startTravel(destinationId) {
  if (state.dead || state.currentAction || state.storyLoading) return;

  const route = getRoute(state.player.location, destinationId);
  if (!route) {
    state.message = "此处暂不能前往那里。";
    render(state);
    return;
  }

  const staminaCost = getTravelStaminaCost(route.minutes);
  if (state.player.stamina < staminaCost) {
    state.message = `体力不足，走完全程需${staminaCost}体力。`;
    render(state);
    return;
  }

  state.currentAction = {
    type: "travel",
    label: "赶路",
    originId: state.player.location,
    destinationId,
    durationMinutes: route.minutes,
    remainingMinutes: route.minutes,
    staminaCost,
  };
  state.travelOpen = false;
  state.workOpen = false;
  state.message = `你动身前往${getLocation(destinationId).name}。`;
  saveGame(state);
  render(state);
}

function cancelTravel() {
  if (state.currentAction?.type !== "travel" || state.storyLoading) return;

  const origin = getLocation(state.currentAction.originId);
  state.player.location = origin.id;
  state.message = `你停下脚步，仍在${origin.name}。`;
  state.currentAction = null;
  state.travelOpen = false;
  saveGame(state);
  render(state);
}

function advanceCurrentAction(gameMinutes) {
  if (!state.currentAction) return;

  if (state.currentAction.type === "travel") {
    advanceTravel(gameMinutes);
    return;
  }

  if (state.currentAction.type === "livelihood") {
    advanceLivelihood(gameMinutes);
    return;
  }

  if (state.currentAction.type === "study" || state.currentAction.type === "repair") {
    advanceUtilityAction(gameMinutes);
    return;
  }

  state.currentAction.remainingMinutes -= gameMinutes;
  if (state.currentAction.remainingMinutes > 0) return;

  if (state.currentAction.rewardCoins > 0) {
    addCoins(state.player, state.currentAction.rewardCoins);
  }
  state.message = state.currentAction.doneMessage;
  state.currentAction = null;
  saveGame(state);
}

function advanceTravel(gameMinutes) {
  const action = state.currentAction;
  const minutesAdvanced = Math.min(gameMinutes, action.remainingMinutes);
  const staminaCost = getTravelStaminaCost(minutesAdvanced);

  changeStamina(state.player, -staminaCost);
  action.remainingMinutes -= gameMinutes;
  if (action.remainingMinutes > 0) return;

  const destination = getLocation(action.destinationId);
  state.player.location = destination.id;
  state.message = `你抵达了${destination.name}。`;
  state.currentAction = null;
  saveGame(state);
}

function advanceUtilityAction(gameMinutes) {
  state.currentAction.remainingMinutes -= gameMinutes;
  if (state.currentAction.remainingMinutes > 0) return;
  const action = state.currentAction;
  state.currentAction = null;
  if (action.type === "study") {
    const dateKey = getDateKey();
    gainSkill(state.player, action.skill, 1, dateKey);
    state.message = `${action.label}完毕，略有长进。`;
    appendStory(state.message);
  } else if (action.repairId === "river_bath") {
    state.player.cleanliness = 85;
    state.message = "在河边洗净尘垢。";
    maybeCatchWindCold();
  } else if (action.repairId === "bathhouse") {
    state.player.cleanliness = 100;
    state.message = "在浴堂洗浴一番，周身清爽。";
  }
  saveGame(state);
}

function advanceLivelihood(gameMinutes) {
  state.currentAction.remainingMinutes -= gameMinutes;
  if (state.currentAction.remainingMinutes > 0) return;

  const action = state.currentAction;
  state.currentAction = null;
  finishWorkAction(action);
}

async function finishWorkAction(action) {
  const result = settleWork(state, action.workId);
  state.message = result.message;
  appendStory(result.message);
  saveGame(state);

  const shouldTriggerEvent = result.forceTrouble || Math.random() < result.eventChance;
  if (!shouldTriggerEvent || !ensureApiKeyOnFirstEnter()) {
    render(state);
    return;
  }

  const wasPaused = state.clock.paused;
  state.storyLoading = true;
  state.clock.paused = true;
  render(state);

  try {
    const work = getWorkById(action.workId);
    const location = getLocation(state.player.location);
    const event = await runStoryAction(
      state,
      `工中事件：${work.name}`,
      state.storySettings.apiKey,
      state.storySettings.mode,
      `工种：${work.name}；地点：${location.name}；城市机构状态：${Object.values(institutions).map((item) => `${item.name}${item.status}`).join("；")}`,
    );
    appendStory(event.scene);
    state.message = `${work.name}时出了点事。`;
  } catch (error) {
    state.message = `工中事件调用失败：${error.message}`;
  } finally {
    state.storyLoading = false;
    state.clock.paused = state.dead ? true : wasPaused;
    lastFrameTime = performance.now();
    saveGame(state);
    render(state);
  }
}

function checkDeath() {
  const death = getDeath(state.player);
  if (!death) return;

  state.dead = true;
  state.deathReason = death.reason;
  state.clock.paused = true;
  state.currentAction = null;
  state.storyLoading = false;
  saveGame(state);
}

function appendStory(scene) {
  const text = String(scene || "").trim();
  if (!text) return;
  state.storyLog.push(text);
  if (state.storyLog.length > 50) state.storyLog = state.storyLog.slice(-50);
}

function openSettings() {
  state.settingsOpen = true;
  state.showAuditLog = false;
  render(state);
}

function closeSettings() {
  state.settingsOpen = false;
  state.showAuditLog = false;
  render(state);
}

function saveSettings(settings) {
  state.storySettings = {
    apiKey: String(settings.apiKey || "").trim(),
    mode: normalizeThinkingMode(settings.mode),
  };
  localStorage.setItem(API_KEY_STORAGE_KEY, state.storySettings.apiKey);
  localStorage.setItem(THINKING_MODE_STORAGE_KEY, state.storySettings.mode);
  state.message = "DeepSeek设置已保存。";
  state.settingsOpen = false;
  render(state);
}

function toggleAuditLog() {
  state.showAuditLog = !state.showAuditLog;
  render(state);
}

function loadStorySettings(savedSettings = {}) {
  const storedMode = localStorage.getItem(THINKING_MODE_STORAGE_KEY) || savedSettings.mode || "disabled";
  return {
    apiKey: localStorage.getItem(API_KEY_STORAGE_KEY) || "",
    mode: normalizeThinkingMode(storedMode),
  };
}

function ensureApiKeyOnFirstEnter() {
  if (state.storySettings.apiKey) return true;

  const key = window.prompt("请输入DeepSeek API Key，用于故事生成：")?.trim() || "";
  if (!key) return false;

  state.storySettings.apiKey = key;
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
  return true;
}

function normalizeThinkingMode(mode) {
  return ["disabled", "high", "max"].includes(mode) ? mode : "disabled";
}

function runDailySettlementsSince(previousDateParts) {
  const currentDateParts = getDateParts(state.clock);
  const previousOrdinal = datePartsToOrdinal(previousDateParts);
  const currentOrdinal = datePartsToOrdinal(currentDateParts);
  for (let ordinal = previousOrdinal + 1; ordinal <= currentOrdinal; ordinal += 1) {
    runDailySettlementFor(ordinalToDateParts(ordinal));
  }
}

function runDailySettlementFor(dateParts) {
  const dateKey = dateKeyFromParts(dateParts);
  if (state.lastDailySettlement === dateKey) return;
  state.lastDailySettlement = dateKey;

  const season = getSeasonByMonth(dateParts.month);
  dailyWorldTick(state.world, dateParts, season);
  applyRicePressure(state.npcs, state.world.riceIndex);
  handleDailyCleanliness(dateKey);
  noteLowSatiety(state.player);
  dailyIllnessSettlement(state.player, {
    cold: isColdMonth(dateParts.month),
    hasWinterClothes: hasInventoryItem("冬衣"),
    illnessMultiplier: getHooks(state.world).illnessMultiplier,
  });
  handleMonthlyRent(dateParts);
}

function datePartsToOrdinal({ year, month, day }) {
  return (year - 1) * 360 + (month - 1) * 30 + day;
}

function ordinalToDateParts(ordinal) {
  const zeroBased = ordinal - 1;
  const year = Math.floor(zeroBased / 360) + 1;
  const dayOfYear = zeroBased % 360;
  const month = Math.floor(dayOfYear / 30) + 1;
  const day = (dayOfYear % 30) + 1;
  return { year, month, day };
}

function dateKeyFromParts({ year, month, day }) {
  return `${year}-${month}-${day}`;
}


function closeMenus() {
  state.travelOpen = false;
  state.workOpen = false;
  state.studyOpen = false;
  state.purchaseOpen = false;
  state.repairOpen = false;
}

function getHousingStaminaCapRatio() {
  if (state.player.housing === "租屋") return 1;
  if (state.player.housing === "破庙") return 0.85;
  return 0.7;
}

function resolveHousingSleepMessage() {
  const { month } = getDateParts(state.clock);
  const coldPenalty = isColdMonth(month) ? getColdSleepHealthPenalty(state.player.housing, hasInventoryItem("冬衣")) : 0;
  const eventColdExtra = getHooks(state.world).coldExtra;
  if (coldPenalty < 0) changeHealth(state.player, coldPenalty + eventColdExtra);
  if (state.player.housing === "租屋") return "在租屋里睡醒，精神复原。";

  const risk = state.player.housing === "破庙" ? 0.03 : 0.08;
  if (Math.random() >= risk) return state.player.housing === "破庙" ? "在破庙里歇了一夜，天明醒来。" : "露宿一夜，勉强睡到天亮。";

  if (Math.random() < 0.5) {
    changeHealth(state.player, -5);
    return "夜里受了寒，醒来身子更差。";
  }

  const lost = Math.min(Math.floor(state.player.coins), Math.floor(Math.random() * 12) + 3);
  state.player.coins -= lost;
  return `夜里钱袋被摸走，少了${lost}文。`;
}

function maybeCatchWindCold() {
  const { month } = getDateParts(state.clock);
  if (Math.random() < getRiverBathColdChance(month) && !state.player.injuries.includes("风寒")) {
    state.player.injuries.push("风寒");
    state.message += " 河风一激，染上风寒。";
  }
}

function handleDailyCleanliness(dateKey) {
  if (state.player.lastCleanlinessDay === dateKey) return;
  state.player.cleanliness = Math.max(0, state.player.cleanliness - 3);
  state.player.lastCleanlinessDay = dateKey;
}

function hasInventoryItem(name) {
  return state.player.inventory.some((item) => item.name === name);
}

function getDateKey() {
  return dateKeyFromParts(getDateParts(state.clock));
}

function handleHousingDiscovery(text) {
  if (state.player.location !== "city_god_temple") return;
  if (!/(破庙|庙里落脚|在破庙落脚|借宿城隍庙)/.test(text)) return;

  state.player.unlockedHousing.temple = true;
  state.player.housing = "破庙";
  state.message = "你记下了破庙可落脚，今后可在此栖身。";
}

function handleRentIntent(text) {
  if (/(租屋|租房|赁屋)/.test(text)) attemptRentHousing();
}

function changeHousing(housing) {
  if (housing === "露宿") {
    state.player.housing = "露宿";
  } else if (housing === "破庙") {
    if (!state.player.unlockedHousing.temple) {
      state.message = "你还不知道哪里有破庙能落脚。";
      render(state);
      return;
    }
    state.player.housing = "破庙";
  } else if (housing === "租屋") {
    attemptRentHousing();
  }
  saveGame(state);
  render(state);
}

function attemptRentHousing() {
  if (state.player.housing === "租屋") return true;
  const cost = 650;
  if (!spendCoins(state.player, cost)) {
    state.message = "租屋需押金200文并先付月租450文，钱还不够。";
    return false;
  }
  state.player.housing = "租屋";
  state.player.unlockedHousing.rented = true;
  state.player.lastRentMonthKey = getRentMonthKey();
  state.message = "你付了押金和一月租钱，有了租屋。";
  return true;
}

function handleMonthlyRent(dateParts = getDateParts(state.clock)) {
  if (state.player.housing !== "租屋") return;
  if (dateParts.day !== 1 || state.clock.elapsedMinutes <= 0) return;

  const monthKey = getRentMonthKey(dateParts);
  if (state.player.lastRentMonthKey === monthKey) return;

  if (spendCoins(state.player, 450)) {
    state.player.lastRentMonthKey = monthKey;
    state.message = "月初扣了租屋月租450文。";
    return;
  }

  state.player.housing = "露宿";
  state.player.lastRentMonthKey = monthKey;
  state.message = "月租交不起，租屋退了，只得露宿。";
}

function getRentMonthKey(dateParts = getDateParts(state.clock)) {
  const { year, month } = dateParts;
  return `${year}-${month}`;
}

function restartGame() {
  clearSave();
  state = {
    clock: createClock(),
    player: createPlayer(),
    npcs: createNpcs(),
    world: createWorldState(),
    currentAction: null,
    dead: false,
    deathReason: "",
    message: "新的一日，从临安清晨开始。",
    travelOpen: false,
    workOpen: false,
    studyOpen: false,
    purchaseOpen: false,
    repairOpen: false,
    storyLoading: false,
    storyLog: [],
    auditLog: [],
    settingsOpen: false,
    showAuditLog: false,
    storySettings: loadStorySettings(),
    lastDailySettlement: "",
  };
  lastFrameTime = performance.now();
  lastAutosaveTime = performance.now();
  saveGame(state);
  render(state);
}
