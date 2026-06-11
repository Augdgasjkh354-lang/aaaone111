const AUDIT_LOG_KEY = "linan-survival-ai-audit-log";
const AUDIT_LOG_LIMIT = 200;
const ALLOWED_FIELDS = new Set([
  "copper",
  "silver",
  "satiety",
  "stamina",
  "health",
  "injury_add",
  "injury_remove",
]);
const NPC_RELATION_FIELDS = ["favor", "trust", "doubt"];
const SKILL_KEYS = ["wen", "wu", "suan", "tan"];

const LIMITS = {
  copper: { min: -100, max: 100 },
  silver: { min: -2, max: 2 },
  satiety: { min: -30, max: 30 },
  stamina: { min: -20, max: 20 },
  health: { min: -15, max: 5 },
};

export function auditAndApplyStoryChanges(
  state,
  rawStateChanges = {},
  rawNpcUpdates = [],
  rawDebtUpdates = [],
  scene = "",
  presentNpcIds = [],
  rawSkillGain = null,
  rawMentorUnlock = "",
  rawItemGrant = null,
  rawItemRemove = "",
) {
  const stateChanges = sanitizeStateChanges(state.player, rawStateChanges, scene);
  const npcUpdates = sanitizeNpcUpdates(rawNpcUpdates, presentNpcIds, state.npcs, stateChanges);
  const debtUpdates = sanitizeDebtUpdates(rawDebtUpdates, presentNpcIds, state.npcs);
  const skillGain = sanitizeSkillGain(rawSkillGain);
  const mentorUnlock = sanitizeMentorUnlock(rawMentorUnlock, state);
  const itemGrant = sanitizeItemGrant(rawItemGrant);
  const itemRemove = sanitizeItemRemove(rawItemRemove, state.player);
  applyStateChanges(state.player, stateChanges);
  appendAuditLog(
    state,
    {
      state_changes: rawStateChanges ?? {},
      npc_updates: Array.isArray(rawNpcUpdates) ? rawNpcUpdates : [],
      debt_updates: Array.isArray(rawDebtUpdates) ? rawDebtUpdates : [],
      skill_gain: rawSkillGain,
      mentor_unlock: rawMentorUnlock,
      item_grant: rawItemGrant,
      item_remove: rawItemRemove,
    },
    { state_changes: stateChanges, npc_updates: npcUpdates, debt_updates: debtUpdates, skill_gain: skillGain, mentor_unlock: mentorUnlock, item_grant: itemGrant, item_remove: itemRemove },
  );
  return { stateChanges, npcUpdates, debtUpdates, skillGain, mentorUnlock, itemGrant, itemRemove };
}

export function auditAndApplyStateChanges(state, rawChanges = {}, scene = "") {
  const sanitizedChanges = sanitizeStateChanges(state.player, rawChanges, scene);
  applyStateChanges(state.player, sanitizedChanges);
  appendAuditLog(state, rawChanges, sanitizedChanges);
  return sanitizedChanges;
}

export function getAuditLog(state) {
  if (Array.isArray(state?.auditLog)) return state.auditLog;
  return readAuditLog();
}


function sanitizeSkillGain(rawGain) {
  if (!rawGain || typeof rawGain !== "object" || !SKILL_KEYS.includes(rawGain.skill)) return null;
  const amount = Math.min(1, Math.max(0, Number.parseInt(rawGain.amount, 10) || 0));
  return amount > 0 ? { skill: rawGain.skill, amount } : null;
}

function sanitizeMentorUnlock(rawUnlock, state) {
  if (!["wen", "wu", "suan"].includes(rawUnlock)) return "";
  if (rawUnlock === "wen" && (state.npcs.find((npc) => npc.id === "mr_wu")?.relation?.trust ?? 0) >= 25) return rawUnlock;
  if (rawUnlock === "wu" && (state.npcs.find((npc) => npc.id === "chen_si")?.relation?.trust ?? 0) >= 30) return rawUnlock;
  if (rawUnlock === "suan" && (state.npcs.find((npc) => npc.id === "liu_mazi")?.relation?.favor ?? 0) >= 20) return rawUnlock;
  return "";
}

function sanitizeItemGrant(rawItem) {
  if (!rawItem || typeof rawItem !== "object") return null;
  const name = sanitizeShortText(rawItem.name, 60);
  if (!name) return null;
  return { name, desc: sanitizeShortText(rawItem.desc, 60) };
}

function sanitizeItemRemove(rawName, player) {
  const name = sanitizeShortText(rawName, 60);
  if (!name) return "";
  return Array.isArray(player.inventory) && player.inventory.some((item) => item.kind === "随身物" && item.name === name) ? name : "";
}

function sanitizeStateChanges(player, rawChanges, scene) {
  const source = rawChanges && typeof rawChanges === "object" ? rawChanges : {};
  const sanitized = {};

  Object.entries(source).forEach(([field, value]) => {
    if (!ALLOWED_FIELDS.has(field)) return;

    if (field === "injury_add" || field === "injury_remove") {
      const injury = sanitizeShortText(value, 20);
      if (injury) sanitized[field] = injury;
      return;
    }

    const integerValue = Number.parseInt(value, 10);
    if (!Number.isFinite(integerValue)) return;

    const clamped = clamp(integerValue, LIMITS[field].min, LIMITS[field].max);
    if (field === "copper") {
      if (clamped > 50 && scene.length <= 50) return;
      sanitized.copper = Math.max(-Math.floor(player.coins), clamped);
      return;
    }

    if (field === "silver") {
      sanitized.silver = Math.max(-Math.floor(player.silver), clamped);
      return;
    }

    if (field === "health") {
      sanitized.health = Math.max(1 - player.health, clamped);
      return;
    }

    sanitized[field] = clamped;
  });

  return sanitized;
}

function sanitizeNpcUpdates(rawNpcUpdates, presentNpcIds, npcs = [], stateChanges = {}) {
  if (!Array.isArray(rawNpcUpdates)) return [];

  const presentIdSet = new Set(presentNpcIds);
  const updates = rawNpcUpdates.reduce((items, rawUpdate) => {
    if (!rawUpdate || typeof rawUpdate !== "object" || !presentIdSet.has(rawUpdate.id)) return items;

    const update = { id: rawUpdate.id };
    const relationDelta = sanitizeRelationDelta(rawUpdate.relation_delta);
    if (Object.keys(relationDelta).length > 0) update.relation_delta = relationDelta;

    const cashDelta = sanitizeNpcCashDelta(rawUpdate.cash_delta, npcs.find((npc) => npc.id === rawUpdate.id));
    if (Number.isFinite(cashDelta)) update.cash_delta = cashDelta;

    const memory = sanitizeShortText(rawUpdate.memory, 60);
    if (memory) update.memory = memory;

    const impression = sanitizeShortText(rawUpdate.impression, 60);
    if (impression) update.impression = impression;

    if (update.relation_delta || Number.isFinite(update.cash_delta) || update.memory || update.impression) items.push(update);
    return items;
  }, []);

  mirrorPlayerCopperToNpcCash(updates, stateChanges, npcs);
  return updates;
}

function sanitizeRelationDelta(rawDelta) {
  const source = rawDelta && typeof rawDelta === "object" ? rawDelta : {};
  return NPC_RELATION_FIELDS.reduce((delta, field) => {
    const value = Number.parseInt(source[field], 10);
    if (Number.isFinite(value)) delta[field] = clamp(value, -10, 10);
    return delta;
  }, {});
}

function sanitizeNpcCashDelta(value, npc) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  const clamped = clamp(parsed, -300, 300);
  const cash = Number.isFinite(npc?.assets?.cash) ? npc.assets.cash : 0;
  return Math.max(-cash, clamped);
}

function mirrorPlayerCopperToNpcCash(updates, stateChanges, npcs = []) {
  if (!Number.isFinite(stateChanges.copper) || stateChanges.copper === 0 || updates.length !== 1) return;

  const npc = npcs.find((item) => item.id === updates[0].id);
  const cash = Number.isFinite(npc?.assets?.cash) ? npc.assets.cash : 0;
  updates[0].cash_delta = Math.max(-cash, clamp(-stateChanges.copper, -300, 300));
}

function sanitizeDebtUpdates(rawDebtUpdates, presentNpcIds, npcs = []) {
  if (!Array.isArray(rawDebtUpdates)) return [];

  const presentIdSet = new Set(presentNpcIds);
  return rawDebtUpdates.reduce((updates, rawUpdate) => {
    if (!rawUpdate || typeof rawUpdate !== "object" || !presentIdSet.has(rawUpdate.npc_id)) return updates;
    if (!["player_owes", "npc_owes"].includes(rawUpdate.direction)) return updates;

    const amountDelta = clamp(Number.parseInt(rawUpdate.amount_delta, 10), -500, 500);
    if (!Number.isFinite(amountDelta) || amountDelta === 0) return updates;

    const npc = npcs.find((item) => item.id === rawUpdate.npc_id);
    const existing = Array.isArray(npc?.debts)
      ? npc.debts.find((debt) => debt.withPlayer === rawUpdate.direction)
      : null;
    const currentAmount = Number.isFinite(existing?.amount) ? existing.amount : 0;
    const sanitizedAmount = Math.max(-currentAmount, amountDelta);
    if (sanitizedAmount === 0) return updates;

    updates.push({
      npc_id: rawUpdate.npc_id,
      direction: rawUpdate.direction,
      amount_delta: sanitizedAmount,
      note: sanitizeShortText(rawUpdate.note, 40) || "借贷",
    });
    return updates;
  }, []);
}

function applyStateChanges(player, changes) {
  if (Number.isFinite(changes.copper)) {
    player.coins = Math.max(0, player.coins + changes.copper);
  }

  if (Number.isFinite(changes.silver)) {
    player.silver = Math.max(0, player.silver + changes.silver);
  }

  if (Number.isFinite(changes.satiety)) {
    player.satiety = clamp(player.satiety + changes.satiety, 0, 100);
  }

  if (Number.isFinite(changes.stamina)) {
    player.stamina = clamp(player.stamina + changes.stamina, 0, 100);
  }

  if (Number.isFinite(changes.health)) {
    player.health = Math.max(1, clamp(player.health + changes.health, 0, 100));
  }

  if (changes.injury_add) {
    player.injuries = Array.isArray(player.injuries) ? player.injuries : [];
    if (!player.injuries.includes(changes.injury_add)) player.injuries.push(changes.injury_add);
  }

  if (changes.injury_remove && Array.isArray(player.injuries)) {
    player.injuries = player.injuries.filter((injury) => injury !== changes.injury_remove);
  }
}

function appendAuditLog(state, rawChanges, appliedChanges) {
  const entry = {
    timestamp: new Date().toISOString(),
    raw: rawChanges ?? {},
    applied: appliedChanges,
  };
  const sourceLog = Array.isArray(state.auditLog) ? state.auditLog : readAuditLog();
  sourceLog.push(entry);
  while (sourceLog.length > AUDIT_LOG_LIMIT) sourceLog.shift();
  state.auditLog = sourceLog;
  localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(sourceLog));
}

function readAuditLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUDIT_LOG_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-AUDIT_LOG_LIMIT) : [];
  } catch (error) {
    console.warn("审计日志读取失败，已重置。", error);
    return [];
  }
}

function sanitizeShortText(value, maxLength) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text || text === "null") return "";
  return text.slice(0, maxLength);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
