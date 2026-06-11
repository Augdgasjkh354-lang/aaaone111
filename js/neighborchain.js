import { callDeepSeek } from "./api.js";
import { chance } from "./luck.js";

export function normalizeNeighborState(saved = {}) {
  return {
    chains: Array.isArray(saved.chains) ? saved.chains : [],
    used: Array.isArray(saved.used) ? saved.used : [],
    echoes: Array.isArray(saved.echoes) ? saved.echoes : [],
    pendingNarratives: Array.isArray(saved.pendingNarratives) ? saved.pendingNarratives : [],
    recentVisits: saved.recentVisits && typeof saved.recentVisits === "object" ? saved.recentVisits : {},
    ripples: Array.isArray(saved.ripples) ? saved.ripples : [],
  };
}

export function noteLocationVisit(state, dateParts) {
  state.world.neighborChains = normalizeNeighborState(state.world.neighborChains);
  state.world.neighborChains.recentVisits[state.player.location] = dateKey(dateParts);
}

export function getActiveNeighborStatuses(world) {
  const ns = normalizeNeighborState(world.neighborChains);
  return ns.chains.filter((chain) => chain.status === "active").map((chain) => `${chain.title}：${chain.stageText}`);
}

export function getRippleText(world, locationId) {
  const ns = normalizeNeighborState(world.neighborChains);
  return ns.ripples.filter((r) => r.locationId === locationId && r.remainingDays > 0).map((r) => r.text).join(" ");
}

export function dailyNeighborChainTick(state, dateParts) {
  const ns = state.world.neighborChains = normalizeNeighborState(state.world.neighborChains);
  ns.ripples = ns.ripples.map((r) => ({ ...r, remainingDays: r.remainingDays - 1 })).filter((r) => r.remainingDays > 0);
  triggerChains(state, dateParts, ns);
  advanceChains(state, dateParts, ns);
  advanceEchoes(state, dateParts, ns);
}

export function applyNeighborIntervention(state, kind, amount = 0) {
  const ns = state.world.neighborChains = normalizeNeighborState(state.world.neighborChains);
  const chain = ns.chains.find((item) => item.status === "active" && item.id === kind);
  if (!chain) return null;
  if (kind === "zhou_husband" && amount >= 400 && state.player.coins >= amount) {
    state.player.coins -= amount;
    chain.interventions.money = (chain.interventions.money ?? 0) + amount;
    return { handled: true, message: "你拿出钱请安郎中去看周大娘丈夫。" };
  }
  if (kind === "cuier_medicine" && amount >= 200 && state.player.coins >= amount) {
    state.player.coins -= amount;
    chain.interventions.money = amount;
    return { handled: true, message: "你垫了翠儿娘的药钱。" };
  }
  if (kind === "old_he_winter" && amount >= 30 && state.player.coins >= amount) {
    state.player.coins -= amount;
    chain.interventions.coal = true;
    return { handled: true, message: "你买了一篮炭送去给老何。" };
  }
  if (kind === "chen_wages") {
    chain.interventions.joined = true;
    state.player.officialRisk = (state.player.officialRisk ?? 0) + 10;
    return { handled: true, message: "你跟陈四一道去船行讨薪，军巡铺那边也多记了你一笔。" };
  }
  if (kind === "zhou_echo") {
    const chen = state.npcs.find((npc) => npc.id === "chen_si");
    chain.interventions.support = (state.player.skills?.tan ?? 0) >= 35 || (chen?.relation?.trust ?? 0) >= 20;
    return { handled: true, message: "你答应替周大娘撑这一场。" };
  }
  return null;
}

export async function runNeighborNarrative(state, apiKey, mode, item) {
  const npc = state.npcs.find((n) => n.id === item.npcId);
  const content = await callDeepSeek([
    { role: "system", content: "你写南宋临安街坊事件关键节点。只输出一段中文叙事，不要JSON。死亡、痊愈、决裂等节点可写至400字，克制具体。逝者不得复活。" },
    { role: "user", content: `人物：${npc?.name ?? item.npcId}。节点：${item.title}。事实：${item.prompt}` },
  ], mode, apiKey);
  return String(content || item.prompt).trim().slice(0, 500);
}

function triggerChains(state, dateParts, ns) {
  if (isWinter(dateParts) && !ns.used.includes("zhou_husband")) startChain(state, ns, "zhou_husband", "周大娘丈夫病重", "zhou_daniang", "病重", "周大娘丈夫病倒，炊饼摊前少了往日烟火。", 2);
  const cuier = state.npcs.find((npc) => npc.id === "cuier");
  if ((cuier?.relation?.favor ?? 0) >= 15 && !ns.used.includes("cuier_medicine")) startChain(state, ns, "cuier_medicine", "翠儿娘的药钱", "cuier", "求告", "翠儿娘药钱不够，孩子在瓦子跑腿时更沉默。", 3);
  if (state.world.activeEvents?.some((event) => event.id === "cold_wave") && !ns.used.includes("old_he_winter")) startChain(state, ns, "old_he_winter", "老何过冬", "old_he", "冻病", "老何冻病在巷尾，咳声比平日更空。", 2);
  if (!ns.used.includes("chen_wages")) {
    state.world.dockWageDelayDays = (state.world.dockWageDelayDays ?? 0) + 1;
    if (state.world.dockWageDelayDays >= 30) startChain(state, ns, "chen_wages", "陈四讨薪", "chen_si", "聚众", "船行拖欠工钱满月，陈四正聚拢脚夫讨说法。", 2);
  }
  if (dateParts.month === 9 && dateParts.day === 1 && !ns.used.includes(`wu_despair_${dateParts.year}`)) startChain(state, ns, `wu_despair_${dateParts.year}`, "吴先生心灰", "mr_wu", "落寞", "解试放榜后，吴先生仍未得中，城隍庙前的摊子收得更早。", 2);
  if (dateParts.month === 11 && dateParts.day === 1) triggerAgingChain(state, dateParts, ns);
}

function startChain(state, ns, id, title, npcId, stage, text, days) {
  ns.used.push(id);
  ns.chains.push({ id, title, npcId, stageIndex: 0, stage, stageText: text, daysLeft: days, status: "active", interventions: {} });
  updateNpcStage(state, npcId, text);
  addLocalRumor(state, ns, npcId, text);
}


function triggerAgingChain(state, dateParts, ns) {
  const target = state.npcs.find((n) => n.alive !== false && n.present !== false && (n.age + dateParts.year - 1) >= 65 && (n.agingSickCount ?? 0) < 2 && !ns.used.includes(`aging_${n.id}_${dateParts.year}`));
  if (!target) return;
  const protectedByCare = (target.relation?.favor ?? 0) >= 40;
  if (!chance(protectedByCare ? 0.04 : 0.15, "bad_aging", state.player)) return;
  startChain(state, ns, `aging_${target.id}_${dateParts.year}`, `${target.name}寒冬病倒`, target.id, "垂危", `${target.name}年岁高了，入冬后病倒在住处附近。`, 3);
  target.agingSickCount = (target.agingSickCount ?? 0) + 1;
}

function advanceAging(state, ns, chain) {
  const n = npc(state, chain.npcId);
  const saved = chance((n?.relation?.favor ?? 0) >= 40 ? 0.75 : 0.45, "good_neighbor", state.player);
  if (saved) finishChain(state, ns, chain, "救回", `${n?.name}寒冬垂危后救回，老迈之态更深。`, () => { n.situation = "老迈病后，作息收缩在居所附近。"; n.impression = "寒冬病倒后被救回，更显老迈。"; if ((n.agingSickCount ?? 0) >= 2) n.schedule = shrinkSchedule(n.schedule); });
  else finishChain(state, ns, chain, "病亡", `${n?.name}寒冬病倒后未能救回。`, () => markNpcDead(state, chain.npcId, "病亡", ns));
}

function shrinkSchedule(schedule = {}) {
  const home = schedule.夜 || schedule.暮 || schedule.晨;
  return { 晨: home, 午: home, 暮: home, 夜: home };
}

function advanceChains(state, dateParts, ns) {
  ns.chains.filter((c) => c.status === "active").forEach((chain) => {
    chain.daysLeft -= 1;
    if (chain.daysLeft > 0) return;
    if (chain.id === "zhou_husband") return advanceZhou(state, ns, chain);
    if (chain.id === "cuier_medicine") return advanceCuier(state, ns, chain);
    if (chain.id === "old_he_winter") return advanceOldHe(state, ns, chain);
    if (chain.id === "chen_wages") return advanceChen(state, ns, chain);
    if (chain.id.startsWith("wu_despair")) return advanceWu(state, ns, chain);
    if (chain.id.startsWith("aging_")) return advanceAging(state, ns, chain);
    if (chain.id === "zhou_echo") return finishZhouEcho(state, ns, chain);
  });
}

function advanceZhou(state, ns, chain) {
  if (chain.stageIndex === 0) return setStage(state, ns, chain, 1, "恶化", "周大娘丈夫病势恶化，摊子开开停停。", 2);
  const helped = (chain.interventions.money ?? 0) >= 400 || (chain.interventions.watchStall ?? 0) >= 2;
  const saved = chance(helped ? 0.5 : 0.2, "good_neighbor", state.player);
  if (saved) finishChain(state, ns, chain, "痊愈", "周大娘丈夫从鬼门关转回，周大娘把这份恩记得很深。", () => {
    const z = npc(state, "zhou_daniang"); z.relation.favor += 25; z.relation.trust += 20; z.impression = "丈夫病重时受过玩家相助，认定此人可作保。";
  });
  else finishChain(state, ns, chain, "亡故", `周大娘丈夫亡故。玩家${helped ? "曾设法相助却未救回" : "未能介入"}。`, () => {
    const z = npc(state, "zhou_daniang"); z.assets.status = "拮据"; z.assets.incomeSource = "炊饼摊停歇后勉力维持"; z.impression = helped ? "记得玩家曾帮着救丈夫，悲中有恩。" : "丈夫亡故，日子骤冷，对无人伸手一事沉在心里。"; z.situation = "丈夫新亡，炊饼摊歇业二十天。"; z.workPausedUntil = 20;
    ns.echoes.push({ id: "zhou_echo", dueIn: 40 }); addRipple(ns, "slum_alley", "周大娘家挂了白，巷口炊饼香少了。", 7);
  });
}

function advanceCuier(state, ns, chain) {
  if (chain.stageIndex === 0) {
    if ((chain.interventions.money ?? 0) >= 200) return finishChain(state, ns, chain, "解局", "翠儿娘有了药钱，翠儿把这份恩记成长期记忆。", () => { const c = npc(state, "cuier"); c.relation.favor += 25; c.relation.trust += 15; c.impression = "记得玩家替娘垫过药钱。"; });
    return setStage(state, ns, chain, 1, "印子钱", "翠儿没筹到药钱，只得借刘麻子的印子钱。", 60);
  }
  if (chain.stageIndex === 1) return setStage(state, ns, chain, 2, "被拿捏", "刘麻子拿债逼翠儿替他跑事，玩家仍可代偿本息三百五十文。", 5);
  if ((chain.interventions.money ?? 0) >= 350) return finishChain(state, ns, chain, "解局", "玩家代偿本息，翠儿脱出刘麻子拿捏。", () => { const c = npc(state, "cuier"); c.relation.favor += 30; c.relation.trust += 20; c.impression = "被玩家从印子钱里拉出来。"; });
  finishChain(state, ns, chain, "受制", "翠儿被刘麻子债务拿捏，往后跑腿多了一层阴影。", () => { const c = npc(state, "cuier"); c.situation = "欠着刘麻子的印子钱，跑腿时受他支使。"; c.impression = "因药钱债被刘麻子拿捏。"; });
}

function advanceOldHe(state, ns, chain) {
  if (chain.stageIndex === 0) return setStage(state, ns, chain, 1, "垂危", "老何冻病转重，破被底下只剩一口气似的咳。", 2);
  const helped = chain.interventions.coal;
  const dead = chance(helped ? 0.15 : 0.6, "bad_neighbor_death", state.player);
  if (dead) finishChain(state, ns, chain, "冻亡", `老何冻亡。玩家${helped ? "送过炭火仍未留住" : "未曾照管"}。`, () => { markNpcDead(state, "old_he", "冻亡", ns); ns.echoes.push({ id: "old_he_echo", dueIn: 14 }); addRipple(ns, "slum_alley", "老何常坐的墙根空了，破席卷在一旁。", 7); });
  else finishChain(state, ns, chain, "活过冬", "老何熬过这场寒，欠玩家一份活命情。", () => { const h = npc(state, "old_he"); h.relation.favor += 25; h.relation.trust += 10; h.impression = "靠玩家送炭救过一冬。"; });
}

function advanceChen(state, ns, chain) {
  if (chain.stageIndex === 0) return setStage(state, ns, chain, 1, "对峙", "陈四带脚夫堵在船行门口，军巡铺的人远远看着。", 2);
  const success = chance(chain.interventions.joined ? 0.6 : 0.5, "good_neighbor", state.player);
  if (success) finishChain(state, ns, chain, "讨回", "脚夫讨回拖欠工钱，码头活气重新顺起来。", () => { npc(state, "chen_si").relation.trust += 15; });
  else finishChain(state, ns, chain, "锁拿", "讨薪失败，陈四被锁拿三日，军巡铺记下名字。", () => { const c = npc(state, "chen_si"); c.situation = "因讨薪被锁拿三日，出来后更沉默。"; c.impression = "讨薪败了，军巡铺记过名字。"; });
}

function advanceWu(state, ns, chain) {
  if (chain.stageIndex === 0) return setStage(state, ns, chain, 1, "收摊念头", "吴先生动了离开临安的念头，代写摊上纸墨渐少。", 3);
  if (state.player.scholar?.masterWu) return finishChain(state, ns, chain, "留下", "玩家已拜师，师徒名分把吴先生留在临安。", () => { npc(state, "mr_wu").impression = "因弟子仍在，心灰后还是留下教书。"; });
  const wu = npc(state, "mr_wu");
  if ((wu.relation.trust ?? 0) < 30 && chance(0.3, "bad_neighbor_leave", state.player)) finishChain(state, ns, chain, "离开", "吴先生离开临安，文路师承断绝，只能等后续版本另寻师承。", () => markNpcLeft(state, "mr_wu", "离开临安", ns));
  else finishChain(state, ns, chain, "勉强留下", "吴先生终究没走，只是更少开口。", () => { wu.situation = "落第后心灰，勉强留在临安代写。"; });
}

function advanceEchoes(state, dateParts, ns) {
  ns.echoes.forEach((echo) => { echo.dueIn -= 1; });
  ns.echoes.filter((echo) => echo.dueIn <= 0 && !echo.started).forEach((echo) => {
    echo.started = true;
    if (echo.id === "zhou_echo") ns.chains.push({ id: "zhou_echo", title: "小叔子上门贱买摊位", npcId: "zhou_daniang", stageIndex: 0, stage: "撑场", stageText: "周大娘小叔子上门贱买摊位。", daysLeft: 2, status: "active", interventions: {} });
    if (echo.id === "old_he_echo") { state.player.inventory.push({ name: "老何的旧棉絮", desc: "贫民巷分老何破烂时留下的旧棉絮", kind: "随身物" }); ns.pendingNarratives.push({ npcId: "old_he", title: "贫民巷分破烂", prompt: "老何冻亡后十四天，贫民巷分他留下的破烂，玩家取走老何的旧棉絮。" }); }
  });
  ns.echoes = ns.echoes.filter((echo) => !echo.started);
}

function finishZhouEcho(state, ns, chain) {
  const keep = chain.interventions.support || !chance(0.6, "bad_neighbor_loss", state.player);
  if (keep) finishChain(state, ns, chain, "保摊", "玩家替周大娘撑住场面，摊位保住。", () => { npc(state, "zhou_daniang").situation = "摊位险些被贱买，幸而保住。"; });
  else finishChain(state, ns, chain, "易手", "无人撑场，小叔子贱买摊位，周大娘改做浆洗。", () => { const z = npc(state, "zhou_daniang"); z.situation = "摊位易手，改做浆洗。"; z.assets.incomeSource = "替人浆洗衣物"; z.schedule = { 晨: "south_homes", 午: "south_homes", 暮: "south_homes", 夜: "south_homes" }; });
}

function setStage(state, ns, chain, index, stage, text, days) { chain.stageIndex = index; chain.stage = stage; chain.stageText = text; chain.daysLeft = days; updateNpcStage(state, chain.npcId, text); addLocalRumor(state, ns, chain.npcId, text); }
function finishChain(state, ns, chain, ending, prompt, apply) { chain.status = "closed"; chain.ending = ending; apply?.(); ns.pendingNarratives.push({ npcId: chain.npcId, title: `${chain.title}：${ending}`, prompt }); const n = npc(state, chain.npcId); if (n) { n.memories.push({ date: "近日", text: prompt, pivotal: true }); n.situation = n.situation || prompt; n.impression = n.impression === "尚不认识此人" ? prompt : n.impression; } }
function markNpcDead(state, npcId, reason, ns) { const n = npc(state, npcId); if (!n) return; n.alive = false; n.present = false; n.situation = `已${reason}`; n.impression = `逝者：${reason}`; settleDeadDebts(state, n); }
function markNpcLeft(state, npcId, reason, ns) { const n = npc(state, npcId); if (!n) return; n.present = false; n.situation = reason; n.impression = reason; }
function settleDeadDebts(state, n) { (n.debts || []).forEach((d) => { if (d.withPlayer === "player_owes") state.player.memories.push({ date: "近日", text: `欠${n.name}的${d.amount}文再也还不上了。` }); }); n.debts = []; }
function updateNpcStage(state, npcId, text) { const n = npc(state, npcId); if (n) n.situation = text; }
function addLocalRumor(state, ns, npcId, text) { const n = npc(state, npcId); const loc = n?.schedule?.午 || n?.schedule?.晨; if (!loc || !ns.recentVisits[loc]) return; state.world.activeEvents.push({ id: `neighbor_${Date.now()}_${npcId}`, name: "街坊近况", text, remainingDays: 3, hook: {} }); }
function addRipple(ns, locationId, text, days) { ns.ripples.push({ locationId, text, remainingDays: days }); }
function npc(state, id) { return state.npcs.find((n) => n.id === id); }
function isWinter(parts) { return [10, 11, 12].includes(parts.month); }
function dateKey({ year, month, day }) { return `${year}-${month}-${day}`; }
