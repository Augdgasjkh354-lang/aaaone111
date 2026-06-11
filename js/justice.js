import { findActionableCase, getCrimeActions, getEvidenceStrength, getStrongWitnessCount, normalizeCrimeState, runCrimeCounterAction } from "./crime.js";

const AGENCY = {
  军巡铺: { maxSeverity: 3, efficiency: 4 },
  府衙: { maxSeverity: 4, efficiency: 5 },
  提刑司: { maxSeverity: 5, efficiency: 7 },
};

export function normalizeJusticeState(saved = {}) {
  return {
    crime: normalizeCrimeState(saved.crime),
    punishment: normalizePunishment(saved.punishment),
    heardLog: Array.isArray(saved.heardLog) ? saved.heardLog.filter((item) => typeof item === "string").slice(-20) : [],
    lastDailyKey: typeof saved.lastDailyKey === "string" ? saved.lastDailyKey : "",
  };
}

export function getJusticeActions(state) {
  const justice = ensureJustice(state.player);
  const actions = getCrimeActions(state.player);
  const wanted = justice.crime.cases.some((item) => item.status === "缉拿");
  actions.push({ id: "justice:hide", name: "躲藏避缉", description: "缉拿期每日判定 · 生计冻结", available: wanted, reason: "暂无缉拿风声" });
  return actions;
}

export function createJusticeAction(actionId, state) {
  ensureJustice(state.player);
  if (actionId === "justice:hide") return hideFromArrest(state);
  return runCrimeCounterAction(actionId, state);
}

export function dailyJusticeTick(state, dateParts) {
  const justice = ensureJustice(state.player);
  const dateKey = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  if (justice.lastDailyKey === dateKey) return [];
  justice.lastDailyKey = dateKey;
  const messages = [];
  tickPunishment(state, messages);
  handleBlackmail(state, dateParts, messages);
  const activeCount = justice.crime.cases.filter((item) => ["立案", "查办", "缉拿"].includes(item.status)).length;
  justice.crime.cases.forEach((crimeCase) => {
    if (crimeCase.status === "潜伏") maybeFileCase(state, crimeCase, activeCount, messages);
  });
  justice.crime.cases
    .filter((item) => ["立案", "查办"].includes(item.status))
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 3)
    .forEach((crimeCase) => advanceInvestigation(state, crimeCase, messages));
  justice.crime.cases.filter((item) => item.status === "缉拿").forEach((crimeCase) => advanceArrest(state, crimeCase, messages));
  return messages;
}

export function getJusticeLedgerLines(state) {
  const justice = ensureJustice(state.player);
  const visible = justice.crime.cases.filter((item) => item.heard);
  const lines = [
    `官面风险：${Math.floor(state.player.officialRisk ?? 0)}；案底${justice.crime.records.length}件；${justice.punishment.branded ? "刺字在身" : "无刺字"}`,
  ];
  lines.push(`听到风声的案子：${visible.length ? visible.map((item) => `${item.type}/${item.status}/${item.agency || "未定"}/进度${Math.floor(item.progress)}%`).join("；") : "无"}`);
  if (justice.punishment.freezeDays > 0) lines.push(`生计冻结：${justice.punishment.freezeReason}${justice.punishment.freezeDays}日。`);
  if (justice.heardLog.length) lines.push(`官面风闻：${justice.heardLog.slice(-5).join("；")}`);
  return lines;
}

export function getJusticeContext(state) {
  const justice = ensureJustice(state.player);
  const visible = justice.crime.cases.filter((item) => item.heard && ["立案", "查办", "缉拿"].includes(item.status));
  const punishment = justice.punishment.branded ? "刺字标签在身" : "无明面刑名";
  return `官面：officialRisk ${Math.floor(state.player.officialRisk ?? 0)}；${punishment}；${visible.length ? visible.map((item) => `${item.type}${item.status}进度${Math.floor(item.progress)}%`).join("、") : "未听到案子风声"}。`;
}

export function isLivelihoodFrozen(player) {
  const punishment = ensureJustice(player).punishment;
  return punishment.freezeDays > 0 || punishment.hidingDays > 0;
}

function maybeFileCase(state, crimeCase, activeCount, messages) {
  const strength = getEvidenceStrength(crimeCase);
  if (activeCount >= 3) {
    crimeCase.queueDays += 1;
    if (crimeCase.severity <= 2 && crimeCase.queueDays > 30) archiveCase(state, crimeCase, "小案排队太久，无人有空管");
    return;
  }
  const coreVictimBonus = crimeCase.evidence.some((item) => /老何|周大娘|陈四|吴先生|翠儿|安郎中|刘麻子|孙押司|钱团头/.test(item.name)) ? 0.15 : 0;
  const probability = Math.min(0.95, crimeCase.severity * 0.03 + coreVictimBonus + (getStrongWitnessCount(crimeCase) > 0 ? 0.08 : 0) + (state.player.officialRisk ?? 0) / 1000 + 0.02 + strength / 500);
  if (Math.random() >= probability) return;
  crimeCase.status = "立案";
  crimeCase.agency = getAgency(crimeCase.severity);
  crimeCase.heard = true;
  pushHeard(state, `${crimeCase.agency}给${crimeCase.type}案立了案。`);
  pushRumor(state, `${crimeCase.agency}近日在查${crimeCase.type}案。`);
  messages.push(`${crimeCase.agency}立了${crimeCase.type}案，风声开始传出来。`);
}

function advanceInvestigation(state, crimeCase, messages) {
  crimeCase.status = "查办";
  crimeCase.activeDays += 1;
  const strength = getEvidenceStrength(crimeCase);
  if (strength < Math.max(3, crimeCase.severity * 2)) crimeCase.weakEvidenceDays += 1;
  else crimeCase.weakEvidenceDays = 0;
  if (crimeCase.weakEvidenceDays >= 15 && crimeCase.severity < 5) {
    archiveCase(state, crimeCase, "证据太薄，拖成不了了之");
    messages.push(`${crimeCase.type}案证据太薄，官面渐渐搁下。`);
    return;
  }
  const agency = AGENCY[crimeCase.agency] ?? AGENCY.军巡铺;
  let efficiency = agency.efficiency * (crimeCase.severity >= 5 ? 2 : 1);
  if (crimeCase.suppressUntil > crimeCase.activeDays) efficiency *= 0.5;
  crimeCase.progress = Math.min(100, crimeCase.progress + efficiency * (0.5 + strength / 20));
  if (crimeCase.progress >= 30 && !crimeCase.nodes.tight) {
    crimeCase.nodes.tight = true;
    crimeCase.heard = true;
    pushHeard(state, `${crimeCase.type}案风声紧，相关地方开始盘问。`);
  }
  if (crimeCase.progress >= 60 && !crimeCase.nodes.summons) {
    crimeCase.nodes.summons = true;
    const talkOk = Math.random() < 0.35 + (state.player.skills?.tan ?? 0) / 180;
    if (talkOk) crimeCase.progress = Math.max(35, crimeCase.progress - 10);
    else crimeCase.progress = Math.min(84, crimeCase.progress + 5);
    messages.push(`官面为${crimeCase.type}案传讯问话，${talkOk ? "你周旋过去，进度稍缓。" : "话里露怯，风声更紧。"}`);
  }
  if (crimeCase.progress >= 85 && !crimeCase.nodes.arrest) {
    crimeCase.nodes.arrest = true;
    crimeCase.status = "缉拿";
    crimeCase.arrestCountdown = 3;
    crimeCase.heard = true;
    pushHeard(state, `${crimeCase.type}案已到缉拿边缘。`);
    pushRumor(state, `${crimeCase.agency}出牌缉拿${crimeCase.type}案犯。`);
  }
}

function advanceArrest(state, crimeCase, messages) {
  if (ensureJustice(state.player).punishment.hidingDays > 0) return;
  crimeCase.arrestCountdown = Math.max(0, (crimeCase.arrestCountdown ?? 3) - 1);
  if (crimeCase.arrestCountdown > 0) return;
  adjudicate(state, crimeCase, messages);
}

function adjudicate(state, crimeCase, messages) {
  const justice = ensureJustice(state.player);
  const strength = getEvidenceStrength(crimeCase);
  let conviction = strength;
  if (!crimeCase.retrialUsed && (state.player.skills?.tan ?? 0) + (state.player.skills?.wen ?? 0) >= 80) {
    crimeCase.retrialUsed = true;
    conviction = Math.max(0, conviction - 2);
    messages.push(`${crimeCase.type}案过堂时翻异别勘，证据减了两分。`);
  }
  if (conviction < crimeCase.severity * 3) {
    crimeCase.status = "归档";
    justice.crime.records.push(`${crimeCase.type}疑案未定`);
    messages.push(`${crimeCase.type}案证据不足，暂归档，但案底影子留在官面。`);
    return;
  }
  crimeCase.status = "结案";
  const sentence = sentenceForSeverity(crimeCase.severity);
  state.player.officialRisk = (state.player.officialRisk ?? 0) + crimeCase.severity * 4;
  justice.crime.records.push(`${crimeCase.type}${sentence.name}`);
  if (crimeCase.severity <= 2) {
    state.player.health = Math.max(1, state.player.health - 20);
  } else if (crimeCase.severity === 3) {
    justice.punishment.branded = true;
    justice.punishment.freezeDays = 15;
    justice.punishment.freezeReason = "枷号";
  } else if (crimeCase.severity === 4) {
    justice.punishment.branded = true;
    justice.punishment.freezeDays = 90;
    justice.punishment.freezeReason = "厢军苦役";
  } else {
    state.dead = true;
    state.deathReason = `${crimeCase.type}案问斩`;
    state.clock.paused = true;
  }
  pushRumor(state, `${crimeCase.type}案结案，判作${sentence.name}。`);
  messages.push(`过堂、推勘、判决三段走完，${crimeCase.type}案定作${sentence.name}。`);
}

function hideFromArrest(state) {
  const justice = ensureJustice(state.player);
  const crimeCase = justice.crime.cases.find((item) => item.status === "缉拿");
  if (!crimeCase) return { ok: false, message: "暂无缉拿风声。" };
  const ok = Math.random() < 0.35 + ((state.player.skills?.tan ?? 0) + (state.player.skills?.wu ?? 0)) / 260;
  justice.punishment.hidingDays = 1;
  if (ok) {
    crimeCase.arrestCountdown = (crimeCase.arrestCountdown ?? 0) + 1;
    return { ok: true, message: "你躲过一日盘查，生计也跟着冻住。" };
  }
  crimeCase.arrestCountdown = 0;
  return { ok: true, message: "躲藏失手，差役循线找近了。" };
}

function tickPunishment(state, messages) {
  const punishment = ensureJustice(state.player).punishment;
  if (punishment.hidingDays > 0) punishment.hidingDays -= 1;
  if (punishment.freezeDays > 0) {
    punishment.freezeDays -= 1;
    if (punishment.freezeDays % 10 === 0 || punishment.freezeDays === 0) messages.push(`${punishment.freezeReason}尚余${punishment.freezeDays}日，生计仍冻着。`);
    if (punishment.freezeReason === "枷号") state.player.health = Math.max(1, state.player.health - 1);
    if (punishment.freezeDays === 0) punishment.freezeReason = "";
  }
}

function handleBlackmail(state, dateParts, messages) {
  const crime = ensureJustice(state.player).crime;
  if (crime.handles.length === 0 || crime.lastBlackmailYear === dateParts.year) return;
  if (Math.random() > 0.35) return;
  const handle = crime.handles[Math.floor(Math.random() * crime.handles.length)];
  const amount = Math.min(state.player.coins, Math.max(80, Math.floor(handle.amount * 0.6)));
  state.player.coins -= amount;
  crime.lastBlackmailYear = dateParts.year;
  messages.push(`${handle.source}握着把柄来索钱，讹去${amount}文。`);
}

function archiveCase(state, crimeCase, reason) {
  crimeCase.status = "归档";
  crimeCase.heard = crimeCase.heard || Math.random() < 0.5;
  ensureJustice(state.player).crime.records.push(`${crimeCase.type}归档：${reason}`);
}

function getAgency(severity) {
  if (severity >= 5) return "提刑司";
  if (severity >= 4) return "府衙";
  return "军巡铺";
}

function sentenceForSeverity(severity) {
  if (severity <= 2) return { name: "杖刑释放" };
  if (severity === 3) return { name: "刺字枷号十五日" };
  if (severity === 4) return { name: "刺配充军，入厢军九十日苦役" };
  return { name: "问斩" };
}

function ensureJustice(player) {
  player.justice = normalizeJusticeState(player.justice);
  return player.justice;
}

function normalizePunishment(saved = {}) {
  return {
    branded: Boolean(saved.branded),
    freezeDays: Number.isFinite(saved.freezeDays) ? Math.max(0, Math.floor(saved.freezeDays)) : 0,
    freezeReason: typeof saved.freezeReason === "string" ? saved.freezeReason : "",
    hidingDays: Number.isFinite(saved.hidingDays) ? Math.max(0, Math.floor(saved.hidingDays)) : 0,
  };
}

function pushHeard(state, text) {
  const justice = ensureJustice(state.player);
  justice.heardLog.push(text);
  justice.heardLog = justice.heardLog.slice(-20);
}

function pushRumor(state, text) {
  state.world.activeEvents = Array.isArray(state.world.activeEvents) ? state.world.activeEvents : [];
  state.world.activeEvents.push({ id: `justice_${Date.now()}_${Math.random()}`, name: "官面风声", text, remainingDays: 7 });
}
