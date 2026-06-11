import { advanceClock, advanceClockToNextMorning, createClock, getDateParts, getMinuteOfDay, getMinutesPerRealSecond, getPeriod } from "./clock.js";
import { addCoins, changeHealth, changeSatiety, changeStamina, createPlayer, getStaminaMax, spendCoins } from "./player.js";
import { checkBellyAfterMeal, dailyIllnessSettlement, getDoctorTreatmentCost, getIllnessStaminaCapMultiplier, noteLowSatiety, treatByDoctor } from "./illness.js";
import { getLocation, getRoute, getTravelStaminaCost } from "./world.js";
import { applyMetabolism, getDeath } from "./metabolism.js";
import { runStoryAction } from "./story.js";
import { createNpcs, getPresentNpcs as getNpcsAtLocation } from "./npcs.js";
import { getWorkById, createWorkAction, settleWork } from "./work.js";
import { createBusinessAction, dailyBusinessExtendedSettlement, getBusinessContext, monthlyBusinessSettlement, settleBusinessAction } from "./business.js";
import { institutions } from "./economy.js";
import { purchaseItem } from "./items.js";
import { gainSkill, getStudyOptions } from "./skills.js";
import { getColdSleepHealthPenalty, getRiverBathColdChance, getSeasonByMonth, isColdMonth } from "./season.js";
import { chance } from "./luck.js";
import { getDivinationText } from "./luck.js";
import { dailyFestivalTick, isFestivalGamblingLegal } from "./festival.js";
import { maybeTriggerScam } from "./scam.js";
import { addLaborToll, applyMassage, dailyLaborSettlement, getLaborStaminaCapPenalty } from "./labor.js";
import { applyNeighborIntervention, dailyNeighborChainTick, noteLocationVisit, runNeighborNarrative } from "./neighborchain.js";
import { applyRicePressure, createWorldState, dailyWorldTick, getHooks } from "./worldtick.js";
import { canApplyHouseholdRegistration, runIdentityMoment, startHouseholdRegistration, tickHouseholdRegistration } from "./identity.js";
import { getWenStudyMultiplier, monthlyScholarSettlement, tryHandleScholarFreeAction } from "./scholar.js";
import { bindControls, render } from "./ui.js";
import { createJusticeAction, dailyJusticeTick, isLivelihoodFrozen } from "./justice.js";
import { checkAutomationNeeds, runRoutineDay, startRoutineMode, stopRoutineMode, updateRoutineSettings } from "./routine.js";
import { clearSave, loadGame, saveGame } from "./save.js";
import { canOpenTianji, isTianjiEnabled, restoreLastTianjiSnapshot, runTianjiCommand, setTianjiEnabled } from "./tianji.js";

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
  onViewNeighborStatus: toggleNeighborStatus,
  onViewBusinessLedger: toggleBusinessLedger,
  onViewJustice: toggleJustice,
  onViewRoutine: toggleRoutine,
  onViewTianji: toggleTianjiPanel,
  onTianjiClick: openTianjiPanel,
  onTianjiLongPress: toggleTianjiEnabled,
  onCloseTianji: toggleTianjiEnabled,
  onRestoreTianji: restoreTianji,
  onSaveRoutine: saveRoutineSettings,
  onStartRoutine: startRoutineDays,
  onStopRoutine: stopRoutine,
  onJustice: startJustice,
  onToggleWork: toggleWorkList,
  onWork: startWork,
  onBusiness: startBusiness,
  onHousingChange: changeHousing,
  onToggleStudy: toggleStudyList,
  onStudy: startStudy,
  onTogglePurchase: togglePurchaseList,
  onPurchase: buyItem,
  onToggleRepair: toggleRepairList,
  onRepair: startRepair,
  onHouseholdRegistration: handleHouseholdRegistration,
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
    pendingIdentityMoments: [],
    storyLoading: false,
    storyLog: Array.isArray(saved?.storyLog) ? saved.storyLog : [],
    auditLog: Array.isArray(saved?.auditLog) ? saved.auditLog : [],
    settingsOpen: false,
    showAuditLog: false,
    showNeighborStatus: false,
    showBusinessLedger: false,
    showJustice: false,
    showRoutine: false,
    showTianji: false,
    storySettings: loadStorySettings(saved?.storySettings),
    lastDailySettlement: saved?.lastDailySettlement ?? "",
  };
}

function tick(now) {
  const realDeltaSeconds = Math.min((now - lastFrameTime) / 1000, MAX_FRAME_SECONDS);
  lastFrameTime = now;

  if (!state.clock.paused && !state.dead && !state.storyLoading) {
    if (state.player.routine?.running && !state.currentAction) {
      runOneRoutineDay();
    } else {
      const gameMinutes = realDeltaSeconds * getMinutesPerRealSecond(state.clock);
      advanceGame(gameMinutes);
      runRoutineAutomation();
    }
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
  stopRoutineMode(state.player);

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
  stopRoutineMode(state.player);
  const text = String(actionText || "").trim();
  if (!text || state.dead || state.currentAction || state.storyLoading) return;

  if (isTianjiEnabled(state.player)) return startTianjiCommand(text);

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
    const begResult = handleBeggingChoice(text);
    if (begResult?.handled) {
      state.message = begResult.message;
      saveGame(state);
      return;
    }
    const neighborResult = handleNeighborIntervention(text);
    if (neighborResult?.handled) {
      state.message = neighborResult.message;
      saveGame(state);
      return;
    }
    const scholarResult = await tryHandleScholarFreeAction(state, text, state.storySettings.apiKey, state.storySettings.mode, createScholarHelpers(wasPaused));
    if (scholarResult?.handled) {
      state.message = scholarResult.message;
      saveGame(state);
      return;
    }
    const result = await runStoryAction(state, text, state.storySettings.apiKey, state.storySettings.mode);
    appendStory(result.scene);
    if (!result.rejected) {
      advanceGame(result.durationMinutes);
      handleHousingDiscovery(text);
      handleRentIntent(text);
      state.message = `此事耗时约 ${result.durationMinutes} 分钟。`;
      await triggerScamIfAny({ tag: "free_action" });
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

async function startTianjiCommand(text) {
  if (!ensureApiKeyOnFirstEnter()) {
    state.message = "请先设置DeepSeek API Key。";
    state.settingsOpen = true;
    render(state);
    return;
  }
  const wasPaused = state.clock.paused;
  state.storyLoading = true;
  state.clock.paused = true;
  state.message = "天机解析中……";
  render(state);
  try {
    const result = await runTianjiCommand(state, text, state.storySettings.apiKey);
    state.message = result.receipt;
  } catch (error) {
    state.message = `天机失败：${error.message}`;
  } finally {
    state.storyLoading = false;
    state.clock.paused = state.dead ? true : wasPaused;
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
  state.player.stamina = Math.min((getStaminaMax(state.player) - getLaborStaminaCapPenalty(state.player, getDateKey())) * capRatio * getIllnessStaminaCapMultiplier(state.player), state.player.stamina);
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

function startBusiness(actionId) {
  stopRoutineMode(state.player);
  if (state.dead || state.currentAction || state.storyLoading) return;
  if (isLivelihoodFrozen(state.player)) { state.message = "官面状态压着，生计暂冻。"; render(state); return; }
  const result = createBusinessAction(actionId, state);
  if (!result.ok) {
    state.message = result.message;
    render(state);
    return;
  }
  if (result.action) {
    state.currentAction = result.action;
    closeMenus();
    state.message = `你开始${result.action.label}。`;
  } else {
    state.message = result.message;
    if (result.transition) queueIdentityMoment(result.transition);
    maybeTriggerBusinessScam(actionId);
  }
  saveGame(state);
  render(state);
}

function startJustice(actionId) {
  stopRoutineMode(state.player);
  if (state.dead || state.currentAction || state.storyLoading) return;
  const result = createJusticeAction(actionId, state);
  state.message = result.message;
  saveGame(state);
  render(state);
}

function startWork(workId) {
  stopRoutineMode(state.player);
  if (state.dead || state.currentAction || state.storyLoading) return;
  if (isLivelihoodFrozen(state.player)) { state.message = "官面状态压着，活计暂冻。"; render(state); return; }

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
  stopRoutineMode(state.player);
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
  if (String(repairId).startsWith("gamble_")) return startGambling(Number(String(repairId).split("_")[1]));
  if (repairId === "divination") {
    if (state.player.location !== "city_god_temple") { state.message = "卦肆在城隍庙。"; render(state); return; }
    if (!spendCoins(state.player, 10)) { state.message = "卦资10文，钱不够。"; render(state); return; }
    state.currentAction = { type: "repair", label: "卦肆问卜", repairId, remainingMinutes: 60 };
  } else if (repairId === "river_bath") {
    if (!["dock"].includes(state.player.location)) {
      state.message = "此处不便去河边洗澡。";
      render(state);
      return;
    }
    state.currentAction = { type: "repair", label: "河边洗澡", repairId, remainingMinutes: 120 };
  } else if (repairId === "massage") {
    return seekMassage();
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
  stopRoutineMode(state.player);
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

  if (state.currentAction.type === "business") {
    advanceBusiness(gameMinutes);
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
    gainSkill(state.player, action.skill, 1, dateKey, { multiplier: action.skill === "wen" ? getWenStudyMultiplier(state.player) : 1 });
    state.message = `${action.label}完毕，略有长进。`;
    appendStory(state.message);
  } else if (action.repairId === "river_bath") {
    state.player.cleanliness = 85;
    state.message = "在河边洗净尘垢。";
    maybeCatchWindCold();
  } else if (action.repairId === "divination") {
    state.message = getDivinationText(state.player);
    appendStory(`卦肆批语：${state.message}`);
    triggerScamIfAny({ tag: "divination" });
  } else if (action.repairId === "bathhouse") {
    state.player.cleanliness = 100;
    state.message = "在浴堂洗浴一番，周身清爽。";
  }
  saveGame(state);
}

function advanceBusiness(gameMinutes) {
  state.currentAction.remainingMinutes -= gameMinutes;
  if (state.currentAction.remainingMinutes > 0) return;
  const action = state.currentAction;
  state.currentAction = null;
  const result = settleBusinessAction(state, action);
  state.message = result.message;
  appendStory(result.message);
  saveGame(state);
  render(state);
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
  applyWorkLabor(action.workId);
  state.message = result.message;
  appendStory(result.message);
  saveGame(state);

  if (result.qianContact) {
    await narrateQianContact();
  }
  await triggerScamIfAny({ tag: action.workId });

  const tag = result.forceTrouble ? "bad_work_trouble" : result.goodEventChance ? "good_work_event" : "bad_work_event";
  const shouldTriggerEvent = result.forceTrouble || chance(result.goodEventChance ?? result.eventChance, tag, state.player);
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
      `工种：${work.name}；地点：${location.name}；城市机构状态：${Object.values(institutions).map((item) => `${item.name}${item.status}`).join("；")}；${getBusinessContext(state)}`,
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
  state.showNeighborStatus = false;
  state.showBusinessLedger = false;
  state.showJustice = false;
  state.showRoutine = false;
  state.showTianji = false;
  render(state);
}

function toggleNeighborStatus() {
  state.showNeighborStatus = !state.showNeighborStatus;
  state.showAuditLog = false;
  state.showBusinessLedger = false;
  state.showJustice = false;
  render(state);
}

function toggleBusinessLedger() {
  state.showBusinessLedger = !state.showBusinessLedger;
  state.showAuditLog = false;
  state.showNeighborStatus = false;
  state.showJustice = false;
  state.showRoutine = false;
  state.showTianji = false;
  render(state);
}

function toggleJustice() {
  state.showJustice = !state.showJustice;
  state.showAuditLog = false;
  state.showNeighborStatus = false;
  state.showBusinessLedger = false;
  state.showRoutine = false;
  state.showTianji = false;
  render(state);
}

function toggleRoutine() {
  state.showRoutine = !state.showRoutine;
  state.showAuditLog = false;
  state.showNeighborStatus = false;
  state.showBusinessLedger = false;
  state.showJustice = false;
  state.showTianji = false;
  render(state);
}

function toggleTianjiPanel() {
  state.showTianji = !state.showTianji;
  state.settingsOpen = true;
  state.showAuditLog = false;
  state.showNeighborStatus = false;
  state.showBusinessLedger = false;
  state.showJustice = false;
  state.showRoutine = false;
  render(state);
}

function openTianjiPanel() {
  state.settingsOpen = true;
  state.showTianji = true;
  state.showAuditLog = false;
  state.showNeighborStatus = false;
  state.showBusinessLedger = false;
  state.showJustice = false;
  state.showRoutine = false;
  render(state);
}

function toggleTianjiEnabled() {
  const enabled = isTianjiEnabled(state.player);
  if (enabled) {
    const result = setTianjiEnabled(state, false);
    state.message = result.reason;
    saveGame(state);
    render(state);
    return;
  }
  const gate = canOpenTianji(state);
  if (!gate.ok) { state.message = gate.reason; render(state); return; }
  const warningOk = window.confirm("天机一开,世界由你。此后种种,不复为命。");
  if (!warningOk) return;
  let passphrase = state.player.tianji?.passphrase || "";
  if (!passphrase) {
    passphrase = (window.prompt("首次开启天机，请设四字口令：") || "").trim();
    if (Array.from(passphrase).length !== 4) { state.message = "口令须为四字。"; render(state); return; }
  } else {
    const input = (window.prompt("请输入天机四字口令：") || "").trim();
    if (input !== passphrase) { state.message = "口令不合，天机未开。"; render(state); return; }
  }
  stopRoutineMode(state.player, "天机已开，过日子自动停下。");
  const result = setTianjiEnabled(state, true, passphrase);
  state.message = result.reason;
  saveGame(state);
  render(state);
}

function restoreTianji() {
  const result = restoreLastTianjiSnapshot(state);
  state.message = result.message;
  saveGame(state);
  render(state);
}

function saveRoutineSettings(settings) {
  updateRoutineSettings(state.player, settings);
  state.message = "起居设置已保存。";
  saveGame(state);
  render(state);
}

function startRoutineDays(days = 30) {
  startRoutineMode(state.player, days);
  state.clock.paused = false;
  state.message = `开始过日子（${days}日内）。`;
  saveGame(state);
  render(state);
}

function stopRoutine() {
  stopRoutineMode(state.player, "手动暂停过日子。");
  state.message = "过日子已暂停。";
  saveGame(state);
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
  noteLocationVisit(state, dateParts);
  dailyWorldTick(state.world, dateParts, season);
  dailyFestivalTick(state.world, dateParts);
  resetDailyGambling(dateKey);
  applyRicePressure(state.npcs, state.world.riceIndex);
  state.npcs.forEach((npc) => { if ((npc.workPausedUntil ?? 0) > 0) npc.workPausedUntil -= 1; });
  dailyNeighborChainTick(state, dateParts);
  handleDailyCleanliness(dateKey);
  noteLowSatiety(state.player);
  dailyIllnessSettlement(state.player, {
    cold: isColdMonth(dateParts.month),
    hasWinterClothes: hasInventoryItem("冬衣"),
    illnessMultiplier: getHooks(state.world).illnessMultiplier,
  });
  dailyLaborSettlement(state.player, dateKey, Boolean(state.player.didHeavyWorkToday), { cold: isColdMonth(dateParts.month) });
  dailyBusinessExtendedSettlement(state, dateParts).forEach(appendStory);
  if (dateParts.day === 1) monthlyBusinessSettlement(state, dateParts).forEach(appendStory);
  dailyJusticeTick(state, dateParts).forEach(appendStory);
  state.player.didHeavyWorkToday = false;
  handleMonthlyRent(dateParts);
  flushNeighborNarratives();
  const registrationTransition = tickHouseholdRegistration(state);
  if (registrationTransition) queueIdentityMoment(registrationTransition);
  const scholarTransition = monthlyScholarSettlement(state, dateParts);
  if (scholarTransition) queueIdentityMoment(scholarTransition);
  flushIdentityMoments();
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
  if (!chance(risk, "bad_housing_event", state.player)) return state.player.housing === "破庙" ? "在破庙里歇了一夜，天明醒来。" : "露宿一夜，勉强睡到天亮。";

  if (chance(0.5, "bad_housing_health", state.player)) {
    changeHealth(state.player, -5);
    return "夜里受了寒，醒来身子更差。";
  }

  const lost = Math.min(Math.floor(state.player.coins), Math.floor(Math.random() * 12) + 3);
  state.player.coins -= lost;
  return `夜里钱袋被摸走，少了${lost}文。`;
}

function maybeCatchWindCold() {
  const { month } = getDateParts(state.clock);
  if (chance(getRiverBathColdChance(month), "bad_illness", state.player) && !state.player.injuries.includes("风寒")) {
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
  const baseCost = 650;
  const cost = state.player.begging?.mode === "join" ? baseCost + 300 : baseCost;
  if (!spendCoins(state.player, cost)) {
    state.message = state.player.begging?.mode === "join" ? "丐籍之人办住处打点更重，租屋合需950文，钱还不够。" : "租屋需押金200文并先付月租450文，钱还不够。";
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




function handleNeighborIntervention(text) {
  if (/(周大娘|丈夫|安郎中).*(400|四百|请医|看病)/.test(text)) return applyNeighborIntervention(state, "zhou_husband", 400);
  if (/(翠儿|药钱).*(200|二百|垫付)/.test(text)) return applyNeighborIntervention(state, "cuier_medicine", 200);
  if (/(翠儿|刘麻子|印子钱).*(350|三百五十|代偿)/.test(text)) return applyNeighborIntervention(state, "cuier_medicine", 350);
  if (/(老何).*(炭|冬衣|求医)/.test(text)) return applyNeighborIntervention(state, "old_he_winter", 30);
  if (/(陈四|讨薪|船行)/.test(text)) return applyNeighborIntervention(state, "chen_wages", 0);
  if (/(周大娘|摊位|小叔子|撑场)/.test(text)) return applyNeighborIntervention(state, "zhou_echo", 0);
  return null;
}

function applyWorkLabor(workId) {
  const toll = { dock_porter: 2, scavenge: 0.5, festival_oddjob: 1.5, yamen_duty: 0.3 }[workId] ?? 0;
  if (toll <= 0) return;
  addLaborToll(state.player, toll);
  if (["dock_porter", "festival_oddjob"].includes(workId)) state.player.didHeavyWorkToday = true;
}

async function flushNeighborNarratives() {
  const queue = state.world.neighborChains?.pendingNarratives;
  if (!Array.isArray(queue) || queue.length === 0 || state.storyLoading || !state.storySettings.apiKey) return;
  const item = queue.shift();
  const wasPaused = state.clock.paused;
  state.storyLoading = true;
  state.clock.paused = true;
  render(state);
  try {
    const scene = await runNeighborNarrative(state, state.storySettings.apiKey, state.storySettings.mode, item);
    appendStory(scene);
    state.message = item.title;
  } catch (error) {
    state.message = `街坊关键节点叙事失败：${error.message}`;
  } finally {
    state.storyLoading = false;
    state.clock.paused = state.dead ? true : wasPaused;
    saveGame(state);
    render(state);
  }
}

function seekMassage() {
  const present = getNpcsAtLocation(state.npcs, state.player.location, getPeriod(getMinuteOfDay(state.clock)));
  if (!present.some((npc) => npc.id === "an_langzhong")) { state.message = "安郎中不在此处。"; render(state); return; }
  if (!spendCoins(state.player, 150)) { state.message = "推拿将养需150文。"; render(state); return; }
  const parts = getDateParts(state.clock);
  const until = dateKeyFromParts(ordinalToDateParts(datePartsToOrdinal(parts) + 30));
  applyMassage(state.player, until);
  state.message = "安郎中推拿后说只是压住旧伤，治标不治本。";
  appendStory(state.message);
  saveGame(state);
  render(state);
}

function handleBeggingChoice(text) {
  state.player.begging = state.player.begging ?? { mode: "none", qianContacted: false };
  if (!state.player.begging.qianContacted) return null;
  if (/(交例钱|交钱|认例)/.test(text)) {
    state.player.begging.mode = "pay";
    return { handled: true, message: "你认下钱团头的例钱，往后讨饭三成归他。" };
  }
  if (/(不交|硬讨|硬来)/.test(text)) {
    state.player.begging.mode = "resist";
    return { handled: true, message: "你不认例钱，往后硬在地盘上讨饭。" };
  }
  if (/(投靠|入伙|跟钱团头)/.test(text)) {
    const qian = state.npcs.find((npc) => npc.id === "qian_tuantou");
    if ((qian?.relation?.favor ?? 0) < 30) return { handled: true, message: "钱团头还不肯收你入门下。" };
    state.player.begging.mode = "join";
    if (qian) qian.memories.push({ date: getDateKey(), text: "玩家投到钱团头门下，讨饭抽两成，换好位置。" });
    return { handled: true, message: "你投到钱团头门下，往后讨饭抽两成，但能占好位置。" };
  }
  return null;
}

async function narrateQianContact() {
  if (state.player.begging?.qianNarrated || !ensureApiKeyOnFirstEnter()) return;
  state.player.begging.qianNarrated = true;
  const wasPaused = state.clock.paused;
  state.storyLoading = true;
  state.clock.paused = true;
  render(state);
  try {
    const result = await runStoryAction(state, "身份时刻：钱团头的人来问讨饭地盘规矩", state.storySettings.apiKey, state.storySettings.mode, "重要时刻：玩家在贫民巷/米市/瓦子讨饭累计三次，钱团头的人前来问话。叙事可长至400字，写地盘规矩与三条路：交例钱、不交硬讨、投靠。不要改变身份。 ");
    appendStory(result.scene);
    state.message = "钱团头的人来问话，往后讨饭须择规矩。";
  } catch (error) {
    state.message = `钱团头问话叙事失败：${error.message}`;
  } finally {
    state.storyLoading = false;
    state.clock.paused = state.dead ? true : wasPaused;
    saveGame(state);
    render(state);
  }
}

async function maybeTriggerBusinessScam() {
  if (!state.storySettings.apiKey) return;
  const tag = state.player.business?.pendingScamTag || "";
  if (!tag) return;
  state.player.business.pendingScamTag = "";
  await triggerScamIfAny({ tag });
  saveGame(state);
  render(state);
}

async function triggerScamIfAny(context = {}) {
  if (!state.storySettings.apiKey) return;
  const scam = await maybeTriggerScam(state, state.storySettings.apiKey, state.storySettings.mode, context);
  if (!scam) return;
  appendStory(scam.scene);
  state.message = scam.spotted ? `识破${scam.scam.name}。` : `中了${scam.scam.name}，损失${scam.loss}文。`;
}

function resetDailyGambling(dateKey) {
  state.player.gambling = state.player.gambling ?? {};
  if (state.player.gambling.lastDateKey === dateKey) return;
  if (state.player.gambling.lostToday >= 300) state.player.gambling.redEyeUntil = dateKey;
  state.player.gambling.lostToday = 0;
  state.player.gambling.lastDateKey = dateKey;
}

function startGambling(bet) {
  if (!isFestivalGamblingLegal(getDateParts(state.clock), state.player.location)) {
    state.message = "此时此地关扑不敢明摆。";
    render(state);
    return;
  }
  if (!spendCoins(state.player, bet)) {
    state.message = `押${bet}文，钱不够。`;
    render(state);
    return;
  }
  const won = chance(0.42, "good_gamble_win", state.player);
  state.player.gambling = state.player.gambling ?? { lossStreak: 0, lostToday: 0 };
  if (won) {
    addCoins(state.player, bet * 2);
    state.player.gambling.lossStreak = 0;
    state.message = `关扑押${bet}文，赢回${bet * 2}文。`;
  } else {
    state.player.gambling.lossStreak += 1;
    state.player.gambling.lostToday = (state.player.gambling.lostToday ?? 0) + bet;
    state.message = `关扑押${bet}文，输了。`;
  }
  appendStory(state.message);
  if (!won && state.player.gambling.lossStreak >= 3) triggerScamIfAny({ tag: "gamble_loss_streak" });
  saveGame(state);
  render(state);
}

async function handleHouseholdRegistration() {
  if (state.dead || state.currentAction || state.storyLoading) return;
  const gate = canApplyHouseholdRegistration(state);
  if (!gate.ok) {
    state.message = gate.reason;
    render(state);
    return;
  }
  const result = startHouseholdRegistration(state);
  state.message = result.message;
  saveGame(state);
  render(state);
}

function queueIdentityMoment(transition) {
  if (!transition) return;
  state.pendingIdentityMoments = Array.isArray(state.pendingIdentityMoments) ? state.pendingIdentityMoments : [];
  state.pendingIdentityMoments.push(transition);
}

async function flushIdentityMoments() {
  if (state.storyLoading || !Array.isArray(state.pendingIdentityMoments) || state.pendingIdentityMoments.length === 0) return;
  if (!state.storySettings.apiKey) return;
  const transition = state.pendingIdentityMoments.shift();
  const wasPaused = state.clock.paused;
  state.storyLoading = true;
  state.clock.paused = true;
  render(state);
  try {
    const scene = await runIdentityMoment(state, state.storySettings.apiKey, state.storySettings.mode, transition);
    appendStory(scene);
    state.message = `身份变为${transition.to}。`;
  } catch (error) {
    state.message = `身份时刻调用失败：${error.message}`;
  } finally {
    state.storyLoading = false;
    state.clock.paused = state.dead ? true : wasPaused;
    saveGame(state);
    render(state);
  }
}

function createScholarHelpers(wasPaused) {
  return {
    append: appendStory,
    save: () => saveGame(state),
    advance: (minutes) => advanceGame(minutes, { studying: true }),
    dateText: () => {
      const { year, month, day } = getDateParts(state.clock);
      return `第${year}年${month}月${day}日`;
    },
    fail: (message) => ({ handled: true, message }),
    identityMoment: async (transition) => {
      try {
        const scene = await runIdentityMoment(state, state.storySettings.apiKey, state.storySettings.mode, transition);
        appendStory(scene);
      } catch (error) {
        state.message = `身份时刻调用失败：${error.message}`;
      } finally {
        state.clock.paused = state.dead ? true : wasPaused;
      }
    },
  };
}

function createRoutineHelpers() {
  return {
    advance: (minutes, options = {}) => advanceGame(minutes, options),
    sleepToMorning,
    dateKey: getDateKey,
    wenMultiplier: () => getWenStudyMultiplier(state.player),
  };
}

function runRoutineAutomation() {
  const result = checkAutomationNeeds(state, createRoutineHelpers());
  if (result?.ok === false) {
    state.clock.paused = true;
    state.message = result.message;
    saveGame(state);
  }
}

function runOneRoutineDay() {
  const result = runRoutineDay(state, createRoutineHelpers());
  state.message = result.message;
  if (!result.ok) state.clock.paused = true;
  checkDeath();
  saveGame(state);
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
    pendingIdentityMoments: [],
    storyLoading: false,
    storyLog: [],
    auditLog: [],
    settingsOpen: false,
    showAuditLog: false,
    showNeighborStatus: false,
    showBusinessLedger: false,
    showJustice: false,
    showRoutine: false,
    showTianji: false,
    storySettings: loadStorySettings(),
    lastDailySettlement: "",
  };
  lastFrameTime = performance.now();
  lastAutosaveTime = performance.now();
  saveGame(state);
  render(state);
}
