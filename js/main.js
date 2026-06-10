import { advanceClock, advanceClockToNextMorning, createClock, getMinutesPerRealSecond } from "./clock.js";
import { addCoins, changeSatiety, changeStamina, createPlayer, getStaminaMax, spendCoins } from "./player.js";
import { applyMetabolism, getDeath } from "./metabolism.js";
import { bindControls, render } from "./ui.js";
import { clearSave, loadGame, saveGame } from "./save.js";

const MAX_FRAME_SECONDS = 0.5;
const AUTOSAVE_REAL_MS = 30_000;

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
    state.clock.paused = !state.clock.paused;
    saveGame(state);
    render(state);
  },
  onRestart: restartGame,
  onAction: startAction,
});

render(state);
requestAnimationFrame(tick);

function createInitialState() {
  const saved = loadGame();
  return {
    clock: createClock(saved?.clock),
    player: createPlayer(saved?.player),
    currentAction: saved?.currentAction ?? null,
    dead: Boolean(saved?.dead),
    deathReason: saved?.deathReason ?? "",
    message: "请选择接下来做什么。",
  };
}

function tick(now) {
  const realDeltaSeconds = Math.min((now - lastFrameTime) / 1000, MAX_FRAME_SECONDS);
  lastFrameTime = now;

  if (!state.clock.paused && !state.dead) {
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

  advanceClock(state.clock, gameMinutes);
  applyMetabolism(state.player, gameMinutes, options);
  advanceCurrentAction(gameMinutes);
  checkDeath();
}

function startAction(actionName) {
  if (state.dead || state.currentAction) return;

  const actions = {
    eat: () => eatMeal(),
    sleep: () => sleepToMorning(),
    work: () => beginTimedAction({
      type: "work",
      label: "做工",
      durationMinutes: 4 * 60,
      staminaCost: 30,
      rewardCoins: 50,
      startedMessage: "你揽下半日活计，埋头做工。",
      doneMessage: "做工完毕，得了50文。",
    }),
    wander: () => beginTimedAction({
      type: "wander",
      label: "闲逛",
      durationMinutes: 60,
      staminaCost: 5,
      rewardCoins: 0,
      startedMessage: "你沿街闲逛，听瓦舍茶坊人声鼎沸。",
      doneMessage: "闲逛回来，暂且无事发生。",
    }),
  };

  actions[actionName]?.();
  saveGame(state);
  render(state);
}

function eatMeal() {
  if (!spendCoins(state.player, 10)) {
    state.message = "铜钱不足，买不起这顿饭。";
    return;
  }

  changeSatiety(state.player, 40);
  state.message = "热饭下肚，身上有了些暖意。";
}

function sleepToMorning() {
  const sleptMinutes = advanceClockToNextMorning(state.clock);
  applyMetabolism(state.player, sleptMinutes, { sleeping: true });
  state.player.stamina = getStaminaMax(state.player);
  state.message = "一觉醒来，天色复明。";
  checkDeath();
}

function beginTimedAction(action) {
  if (state.player.stamina < action.staminaCost) {
    state.message = "体力不支，眼下做不动这件事。";
    return;
  }

  // 行动开始时先扣体力，耗时由主循环继续推进。
  changeStamina(state.player, -action.staminaCost);
  state.currentAction = {
    type: action.type,
    label: action.label,
    remainingMinutes: action.durationMinutes,
    rewardCoins: action.rewardCoins,
    doneMessage: action.doneMessage,
  };
  state.message = action.startedMessage;
}

function advanceCurrentAction(gameMinutes) {
  if (!state.currentAction) return;

  state.currentAction.remainingMinutes -= gameMinutes;
  if (state.currentAction.remainingMinutes > 0) return;

  if (state.currentAction.rewardCoins > 0) {
    addCoins(state.player, state.currentAction.rewardCoins);
  }
  state.message = state.currentAction.doneMessage;
  state.currentAction = null;
  saveGame(state);
}

function checkDeath() {
  const death = getDeath(state.player);
  if (!death) return;

  state.dead = true;
  state.deathReason = death.reason;
  state.clock.paused = true;
  state.currentAction = null;
  saveGame(state);
}

function restartGame() {
  clearSave();
  state = {
    clock: createClock(),
    player: createPlayer(),
    currentAction: null,
    dead: false,
    deathReason: "",
    message: "新的一日，从临安清晨开始。",
  };
  lastFrameTime = performance.now();
  lastAutosaveTime = performance.now();
  saveGame(state);
  render(state);
}
