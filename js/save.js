const SAVE_KEY = "linan-survival-v0-1";

export function saveGame(state) {
  const data = {
    version: 1,
    clock: state.clock,
    player: state.player,
    npcs: state.npcs,
    world: state.world,
    lastDailySettlement: state.lastDailySettlement,
    currentAction: state.currentAction,
    dead: state.dead,
    deathReason: state.deathReason,
    storyLog: state.storyLog,
    auditLog: state.auditLog,
    storySettings: { mode: state.storySettings?.mode },
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

export function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    return data?.version === 1 ? data : null;
  } catch (error) {
    console.warn("存档读取失败，已忽略旧存档。", error);
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}
