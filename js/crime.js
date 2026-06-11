import { chance } from "./luck.js";

export const CRIME_TYPES = ["窃盗", "抢夺", "斗殴伤人", "欺诈", "杀人", "纵火", "销赃"];
const VIOLENT_TYPES = new Set(["斗殴伤人", "杀人", "纵火"]);

export function normalizeCrimeState(saved = {}) {
  return {
    cases: Array.isArray(saved.cases) ? saved.cases.map(normalizeCase).filter(Boolean).slice(-40) : [],
    records: Array.isArray(saved.records) ? saved.records.map((item) => String(item).slice(0, 60)).slice(-20) : [],
    handles: Array.isArray(saved.handles) ? saved.handles.map(normalizeHandle).filter(Boolean).slice(-20) : [],
    sunYasiTrace: Number.isFinite(saved.sunYasiTrace) ? Math.max(0, Math.floor(saved.sunYasiTrace)) : 0,
    lastBlackmailYear: Number.isFinite(saved.lastBlackmailYear) ? Math.max(0, Math.floor(saved.lastBlackmailYear)) : 0,
  };
}

export function precheckCrimeAction(state, actionText, presentNpcs = []) {
  const detected = detectCrimeType(actionText);
  if (!detected) return null;
  const skillKey = VIOLENT_TYPES.has(detected.type) ? "wu" : "tan";
  const skill = state.player.skills?.[skillKey] ?? 0;
  const base = VIOLENT_TYPES.has(detected.type) ? 0.32 : 0.42;
  const success = chance(base + skill / 220, "good_crime_attempt", state.player, { maxDelta: 0.2 });
  const noticedChance = success ? 0.12 + detected.severity * 0.04 : 0.45 + detected.severity * 0.08;
  const noticed = chance(noticedChance, "bad_crime_seen", state.player, { maxDelta: 0.15 });
  const witnesses = noticed ? pickWitnesses(presentNpcs, detected.severity) : [];
  const anonymousWitnesses = noticed ? Math.min(3, Math.max(1, detected.severity - witnesses.length > 2 ? 2 : 1)) : 0;
  const outcome = success ? (noticed ? "得手但被当场察觉" : "得手且暂未暴露") : (noticed ? "失手且被当场察觉" : "失手但暂未暴露");
  return { ...detected, skillKey, success, noticed, outcome, witnesses, anonymousWitnesses, contextText: `高风险行动前置判定：${detected.type}，严重度${detected.severity}，既定结果为“${outcome}”。AI必须按此结果叙事，不得改写成相反结果。${witnesses.length ? `在场目击：${witnesses.join("、")}。` : ""}${anonymousWitnesses ? `另有路人目击${anonymousWitnesses}人。` : ""}` };
}

export function buildFallbackCrimeReport(precheck) {
  return precheck ? { type: precheck.type, severity: precheck.severity, witnesses: precheck.witnesses, anonymousWitnesses: precheck.anonymousWitnesses } : null;
}

export function landCrimeReport(state, report, context = {}) {
  if (!report) return null;
  state.player.justice.crime = normalizeCrimeState(state.player.justice?.crime);
  const id = `case_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const crimeCase = {
    id,
    type: CRIME_TYPES.includes(report.type) ? report.type : "窃盗",
    date: context.dateText ?? "今日",
    ordinal: context.ordinal ?? 1,
    locationId: context.locationId ?? state.player.location,
    severity: clamp(report.severity ?? 1, 1, 5),
    evidence: generateEvidence(state, report, context, id),
    status: "潜伏",
    progress: 0,
    agency: "",
    heard: (report.witnesses?.length ?? 0) > 0 || (report.anonymousWitnesses ?? 0) > 0,
    queueDays: 0,
    activeDays: 0,
    weakEvidenceDays: 0,
    arrestCountdown: null,
    nodes: { tight: false, summons: false, arrest: false },
    suppressUntil: 0,
  };
  state.player.justice.crime.cases.push(crimeCase);
  state.player.officialRisk = (state.player.officialRisk ?? 0) + Math.max(1, crimeCase.severity - 1);
  if (crimeCase.heard) pushRumor(state, `${getAgencyName(crimeCase.severity)}听闻${crimeCase.locationId}有${crimeCase.type}案。`);
  return crimeCase;
}

export function getEvidenceStrength(crimeCase) {
  return (crimeCase.evidence ?? []).filter((item) => !item.removed).reduce((sum, item) => sum + item.strength, 0);
}

export function getStrongWitnessCount(crimeCase) {
  return (crimeCase.evidence ?? []).filter((item) => !item.removed && item.kind === "人证" && item.strength >= 7).length;
}

export function findActionableCase(player) {
  const crime = normalizeCrimeState(player.justice?.crime);
  return crime.cases.find((item) => ["潜伏", "立案", "查办", "缉拿"].includes(item.status)) ?? null;
}

export function getCrimeActions(player) {
  const crime = normalizeCrimeState(player.justice?.crime);
  const active = crime.cases.find((item) => ["潜伏", "立案", "查办"].includes(item.status));
  const evidence = active?.evidence?.find((item) => !item.removed && item.kind !== "人证");
  const witness = active?.evidence?.find((item) => !item.removed && item.kind === "人证");
  const stolen = player.inventory?.some((item) => item.stolen) ?? false;
  return [
    { id: "justice:sell_stolen", name: "销赃", description: "三成价 · 10%添新人证", available: stolen, reason: "身上无赃物" },
    { id: "justice:destroy_evidence", name: "灭迹", description: "清洗物证 · 失手可能添人证", available: Boolean(active && evidence), reason: "暂无可灭物证" },
    { id: "justice:bribe_witness", name: "买通人证", description: "强度×50文 · 生成把柄", available: Boolean(active && witness), reason: "暂无可买通人证" },
    { id: "justice:intimidate_witness", name: "恐吓人证", description: "武判定 · 失败添恐吓新案", available: Boolean(active && witness), reason: "暂无可恐吓人证" },
    { id: "justice:suppress_case", name: "托孙押司压案", description: "relation≥50 · 府衙以下", available: Boolean(active), reason: "暂无可压案件" },
  ];
}

export function runCrimeCounterAction(actionId, state) {
  state.player.justice.crime = normalizeCrimeState(state.player.justice?.crime);
  const active = state.player.justice.crime.cases.find((item) => ["潜伏", "立案", "查办"].includes(item.status));
  if (actionId === "justice:sell_stolen") return sellStolen(state);
  if (!active) return { ok: false, message: "暂无可处理的案子。" };
  if (actionId === "justice:destroy_evidence") return destroyEvidence(state, active);
  if (actionId === "justice:bribe_witness") return bribeWitness(state, active);
  if (actionId === "justice:intimidate_witness") return intimidateWitness(state, active);
  if (actionId === "justice:suppress_case") return suppressCase(state, active);
  return { ok: false, message: "没有这项反侦查行动。" };
}

function sellStolen(state) {
  const stolenItems = state.player.inventory.filter((item) => item.stolen);
  if (stolenItems.length === 0) return { ok: false, message: "身上无赃物。" };
  const value = stolenItems.length * 30;
  state.player.coins += value;
  state.player.inventory = state.player.inventory.filter((item) => !item.stolen);
  const active = findActionableCase(state.player);
  if (active && Math.random() < 0.1) {
    active.evidence.push(makeEvidence("人证", "销赃线认人", randomInt(4, 8), 5));
    active.heard = true;
    return { ok: true, message: `赃物三成价出手，得${value}文，却在销赃线上添了新人证。` };
  }
  return { ok: true, message: `赃物三成价出手，得${value}文。` };
}

function destroyEvidence(state, crimeCase) {
  const evidence = crimeCase.evidence.find((item) => !item.removed && item.kind !== "人证");
  if (!evidence) return { ok: false, message: "暂无可灭物证。" };
  const ok = Math.random() < Math.max(0.15, 0.65 + (state.player.skills?.tan ?? 0) / 200 - evidence.cleanDifficulty / 20);
  if (ok) { evidence.removed = true; return { ok: true, message: `灭去${evidence.name}，这条物证暂断。` }; }
  if (Math.random() < 0.15) crimeCase.evidence.push(makeEvidence("人证", "灭迹时被撞见", randomInt(4, 8), 6));
  return { ok: true, message: `灭迹失手，${crimeCase.evidence.at(-1)?.name === "灭迹时被撞见" ? "还被人撞见。" : "未能去掉物证。"}` };
}

function bribeWitness(state, crimeCase) {
  const evidence = crimeCase.evidence.find((item) => !item.removed && item.kind === "人证" && item.strength > 1);
  if (!evidence) return { ok: false, message: "暂无可买通人证。" };
  const cost = evidence.strength * 50;
  if (state.player.coins < cost) return { ok: false, message: `买通需${cost}文。` };
  state.player.coins -= cost;
  const ok = Math.random() < 0.45 + (state.player.skills?.tan ?? 0) / 160;
  if (ok) {
    evidence.strength = 1;
    state.player.justice.crime.handles.push({ source: evidence.name, amount: cost, lastYear: 0 });
    return { ok: true, message: `花${cost}文买通${evidence.name}，证词弱到只剩把柄。` };
  }
  return { ok: true, message: `花${cost}文递话未成，对方反更疑你。` };
}

function intimidateWitness(state, crimeCase) {
  const evidence = crimeCase.evidence.find((item) => !item.removed && item.kind === "人证" && item.strength > 1);
  if (!evidence) return { ok: false, message: "暂无可恐吓人证。" };
  if (Math.random() < 0.35 + (state.player.skills?.wu ?? 0) / 160) {
    evidence.strength = Math.max(1, Math.floor(evidence.strength / 2));
    return { ok: true, message: `${evidence.name}被吓住，证词强度减半。` };
  }
  landCrimeReport(state, { type: "斗殴伤人", severity: 2, witnesses: [], anonymousWitnesses: 1 }, { dateText: crimeCase.date, ordinal: crimeCase.ordinal, locationId: crimeCase.locationId });
  return { ok: true, message: "恐吓不成，反添一桩恐吓伤人新案。" };
}

function suppressCase(state, crimeCase) {
  const sun = state.npcs.find((npc) => npc.id === "sun_yasi");
  if ((sun?.relation?.favor ?? 0) < 50) return { ok: false, message: "孙押司关系未到50。" };
  if (crimeCase.severity >= 5 || crimeCase.agency === "提刑司") return { ok: false, message: "命案大案压不住。" };
  const cost = Math.min(1500, 500 + crimeCase.severity * 250);
  if (state.player.coins < cost) return { ok: false, message: `压案需${cost}文。` };
  state.player.coins -= cost;
  crimeCase.suppressUntil = (crimeCase.activeDays ?? 0) + 30;
  state.player.justice.crime.sunYasiTrace += 1;
  if (state.player.justice.crime.sunYasiTrace >= 3) pushRumor(state, "孙押司吃案太多，御街茶肆有人说风头不对。 ");
  return { ok: true, message: `托孙押司花${cost}文压案，三十日内承办效率减半。` };
}

function detectCrimeType(text) {
  const source = String(text || "");
  if (/(杀|捅死|弄死|灭口)/.test(source)) return { type: "杀人", severity: 5 };
  if (/(纵火|放火|烧掉|点火烧)/.test(source)) return { type: "纵火", severity: 5 };
  if (/(抢|夺|劫|硬拿|强夺)/.test(source)) return { type: "抢夺", severity: 3 };
  if (/(打|揍|伤人|行凶|砍|刺)/.test(source)) return { type: "斗殴伤人", severity: 3 };
  if (/(偷|盗|扒|摸走|顺走)/.test(source)) return { type: "窃盗", severity: 2 };
  if (/(骗|诈|假契|讹|赖账)/.test(source)) return { type: "欺诈", severity: 2 };
  if (/(销赃|卖赃)/.test(source)) return { type: "销赃", severity: 2 };
  return null;
}

function generateEvidence(state, report, context, crimeId) {
  const evidence = [];
  (report.witnesses ?? []).forEach((npcId) => {
    const npc = state.npcs.find((item) => item.id === npcId);
    const doubt = npc?.relation?.doubt ?? 5;
    evidence.push(makeEvidence("人证", npc?.name ? `${npc.name}证词` : `${npcId}证词`, clamp(4 + Math.floor(doubt / 10) + report.severity, 1, 10), report.severity + 2));
  });
  for (let i = 0; i < (report.anonymousWitnesses ?? 0); i += 1) evidence.push(makeEvidence("人证", `路人证词${i + 1}`, clamp(3 + report.severity, 1, 10), report.severity + 2));
  if (["窃盗", "抢夺", "销赃"].includes(report.type)) { evidence.push(makeEvidence("物证", "赃物流转", clamp(3 + report.severity, 1, 10), report.severity + 2)); if (context.precheck?.success) addStolenItem(state.player, report, crimeId); }
  if (["斗殴伤人", "杀人"].includes(report.type)) evidence.push(makeEvidence("物证", "凶器/伤痕", clamp(4 + report.severity, 1, 10), report.severity + 3));
  if (report.type === "纵火") evidence.push(makeEvidence("物证", "火场残迹", 9, 8));
  if (report.type === "欺诈") evidence.push(makeEvidence("书证", "契约文书疑点", clamp(3 + report.severity, 1, 10), report.severity + 2));
  if (Math.random() < 0.35 || report.severity >= 4) evidence.push(makeEvidence("物证", "现场遗留", clamp(2 + report.severity, 1, 10), report.severity + 2));
  if (report.severity >= 5) evidence.forEach((item) => { item.cleanDifficulty += 3; });
  return evidence;
}

function addStolenItem(player, report, crimeId) { player.inventory.push({ name: report.type === "销赃" ? "来路不明货" : "赃物包", desc: `${report.type}所得，见不得光`, kind: "赃物", stolen: true, crimeId }); }
function makeEvidence(kind, name, strength, cleanDifficulty) { return { id: `ev_${Math.random().toString(36).slice(2, 8)}`, kind, name, strength: clamp(strength, 1, 10), cleanDifficulty: Math.max(1, Math.floor(cleanDifficulty)), removed: false }; }

function normalizeCase(item) {
  if (!item || typeof item.id !== "string") return null;
  return { id: item.id, type: CRIME_TYPES.includes(item.type) ? item.type : "窃盗", date: typeof item.date === "string" ? item.date : "旧日", ordinal: Number.isFinite(item.ordinal) ? Math.max(1, Math.floor(item.ordinal)) : 1, locationId: typeof item.locationId === "string" ? item.locationId : "slum_alley", severity: clamp(item.severity ?? 1, 1, 5), evidence: Array.isArray(item.evidence) ? item.evidence.map(normalizeEvidence).filter(Boolean) : [], status: ["潜伏", "立案", "查办", "缉拿", "结案", "归档"].includes(item.status) ? item.status : "潜伏", progress: clamp(item.progress ?? 0, 0, 100), agency: typeof item.agency === "string" ? item.agency : "", heard: Boolean(item.heard), queueDays: Number.isFinite(item.queueDays) ? Math.max(0, Math.floor(item.queueDays)) : 0, activeDays: Number.isFinite(item.activeDays) ? Math.max(0, Math.floor(item.activeDays)) : 0, weakEvidenceDays: Number.isFinite(item.weakEvidenceDays) ? Math.max(0, Math.floor(item.weakEvidenceDays)) : 0, arrestCountdown: Number.isFinite(item.arrestCountdown) ? Math.max(0, Math.floor(item.arrestCountdown)) : null, nodes: item.nodes && typeof item.nodes === "object" ? item.nodes : { tight: false, summons: false, arrest: false }, suppressUntil: Number.isFinite(item.suppressUntil) ? Math.max(0, Math.floor(item.suppressUntil)) : 0 };
}
function normalizeEvidence(item) { return item && typeof item.name === "string" ? { id: typeof item.id === "string" ? item.id : `ev_${Math.random().toString(36).slice(2, 8)}`, kind: ["人证", "物证", "书证"].includes(item.kind) ? item.kind : "物证", name: item.name.slice(0, 40), strength: clamp(item.strength ?? 1, 1, 10), cleanDifficulty: Math.max(1, Math.floor(item.cleanDifficulty ?? 3)), removed: Boolean(item.removed) } : null; }
function normalizeHandle(item) { return item && typeof item.source === "string" ? { source: item.source.slice(0, 40), amount: Math.max(0, Math.floor(item.amount ?? 0)), lastYear: Math.max(0, Math.floor(item.lastYear ?? 0)) } : null; }
function pickWitnesses(presentNpcs, severity) { return presentNpcs.slice(0, Math.min(presentNpcs.length, severity >= 4 ? 3 : 2)).map((npc) => npc.id); }
function getAgencyName(severity) { if (severity >= 5) return "提刑司"; if (severity >= 4) return "府衙"; return "军巡铺"; }
function pushRumor(state, text) { state.world.activeEvents = Array.isArray(state.world.activeEvents) ? state.world.activeEvents : []; state.world.activeEvents.push({ id: `justice_${Date.now()}_${Math.random()}`, name: "官面风声", text, remainingDays: 7 }); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Math.round(Number(value) || 0))); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
