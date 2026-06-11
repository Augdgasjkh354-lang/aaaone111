import { callDeepSeek } from "./api.js";
import { worldOverride } from "./luck.js";

export const TIANJI_LOG_KEY = "linan-tianji-log-v1";
export const TIANJI_SNAPSHOT_KEY = "linan-tianji-snapshot-v1";

const MAX_LOG = 300;
const OPS = new Set(["set", "add", "remove", "push"]);
const ROOT_WHITELIST = new Set(["player", "npcs", "world"]);
const STAT_0_100 = new Set(["health", "stamina", "satiety", "cleanliness", "reputation", "officialRisk", "favor", "trust", "doubt", "relation", "proficiency", "regulars", "loyalty", "skill", "craft"]);
const NON_NEGATIVE_NUMBERS = new Set(["coins", "silver", "huizi", "age", "baseAge", "cash", "qty", "amount", "price", "riceIndex", "periodProfit", "progress", "crowding", "wallet"]);
const EVIDENCE_KINDS = new Set(["人证", "物证", "书证"]);

export function normalizeTianjiState(saved = {}) {
  return {
    enabled: Boolean(saved.enabled),
    passphrase: typeof saved.passphrase === "string" ? saved.passphrase.slice(0, 8) : "",
    sessionSnapshotTaken: Boolean(saved.sessionSnapshotTaken),
    lastReceipt: typeof saved.lastReceipt === "string" ? saved.lastReceipt : "",
  };
}

export function isTianjiEnabled(player) {
  return Boolean(player?.tianji?.enabled);
}

export function canOpenTianji(state) {
  const cases = state.player?.justice?.crime?.cases ?? [];
  const arresting = cases.some((item) => item.status === "缉拿" && (item.arrestCountdown ?? 0) > 0);
  return arresting ? { ok: false, reason: "缉拿执行三日内不可开启天机：天网恢恢，这一刻先于天机。" } : { ok: true, reason: "" };
}

export function setTianjiEnabled(state, enabled, passphrase = "") {
  state.player.tianji = normalizeTianjiState(state.player.tianji);
  if (enabled) {
    const gate = canOpenTianji(state);
    if (!gate.ok) return gate;
    if (passphrase) state.player.tianji.passphrase = passphrase.slice(0, 8);
    state.player.tianji.enabled = true;
    state.player.tianji.sessionSnapshotTaken = false;
    state.player.tianji.lastReceipt = "天机已开。";
    return { ok: true, reason: "天机已开。" };
  }
  state.player.tianji.enabled = false;
  state.player.tianji.sessionSnapshotTaken = false;
  state.player.tianji.lastReceipt = "天机已闭。";
  return { ok: true, reason: "天机已闭。" };
}

export async function runTianjiCommand(state, rawText, apiKey) {
  const text = String(rawText || "").trim();
  if (!text) return { receipt: "天机无字。", parsed: { mutations: [], unparsed: "" }, results: [] };
  const parsed = await parseTianjiCommand(state, text, apiKey);
  const mutations = Array.isArray(parsed.mutations) ? parsed.mutations : [];
  if (mutations.length > 0 && !state.player.tianji?.sessionSnapshotTaken) {
    snapshotTianjiSession(state);
    state.player.tianji.sessionSnapshotTaken = true;
  }
  const results = mutations.map((mutation) => applyMutation(state, mutation));
  worldOverride.lastTianjiMutations = results.map((item) => ({ target: item.target, op: item.op, ok: item.ok }));
  recomputeDerivedState(state);
  const receipt = buildReceipt(results, parsed.unparsed);
  state.player.tianji.lastReceipt = receipt;
  appendTianjiLog({ raw: text, parsed, results, timestamp: new Date().toISOString() });
  return { receipt, parsed, results };
}

export async function parseTianjiCommand(state, text, apiKey) {
  const content = await callDeepSeek([
    { role: "system", content: "你是世界变更解析器，把玩家自然语言意图翻译为对游戏状态树的精确操作。只输出JSON，格式为{\"mutations\":[{\"target\":\"状态路径\",\"op\":\"set/add/remove/push\",\"value\":任意JSON值}],\"unparsed\":\"无法解析的部分原话\"}。不理解的部分如实放入unparsed，绝不猜测，绝不生成叙事。路径优先使用player、npcs.<id>、world开头。不要输出案件状态、量刑、天机系统自身、时间引擎常量、存档结构、价格锚点表或chance参数的变更。" },
    { role: "user", content: `当前世界状态摘要：\n${buildWorldSummary(state)}\n\n天机原文：${text}` },
  ], "high", apiKey);
  return sanitizeParsedJson(content);
}

export function getTianjiLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TIANJI_LOG_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-MAX_LOG) : [];
  } catch (error) {
    console.warn("天机录读取失败。", error);
    return [];
  }
}

export function restoreLastTianjiSnapshot(state) {
  const raw = localStorage.getItem(TIANJI_SNAPSHOT_KEY);
  if (!raw) return { ok: false, message: "暂无可回溯的上一会话。" };
  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch (error) {
    return { ok: false, message: `回溯失败：${error.message}` };
  }
  ["clock", "player", "npcs", "world", "currentAction", "dead", "deathReason", "storyLog", "auditLog", "lastDailySettlement"].forEach((key) => {
    if (key in snapshot) state[key] = snapshot[key];
  });
  state.player.tianji = normalizeTianjiState(state.player.tianji);
  state.player.tianji.enabled = false;
  state.player.tianji.sessionSnapshotTaken = false;
  state.player.tianji.lastReceipt = "已回溯上一天机会话。";
  return { ok: true, message: "已回溯上一天机会话。" };
}

export function clearTianjiStorage() {
  localStorage.removeItem(TIANJI_LOG_KEY);
  localStorage.removeItem(TIANJI_SNAPSHOT_KEY);
}

function applyMutation(state, mutation) {
  const target = typeof mutation?.target === "string" ? mutation.target.trim() : "";
  const op = typeof mutation?.op === "string" ? mutation.op.trim() : "";
  if (!target || !OPS.has(op)) return reject(target, op, "格式不合天机网关。", mutation?.value);
  const pathCheck = checkPath(target);
  if (!pathCheck.ok) return reject(target, op, pathCheck.reason, mutation.value);
  const resolved = resolvePath(state, target, op);
  if (!resolved.ok) return reject(target, op, resolved.reason, mutation.value);
  const before = cloneValue(resolved.parent?.[resolved.key]);
  const validation = validateValue(target, op, mutation.value, before);
  if (!validation.ok) return reject(target, op, validation.reason, mutation.value);

  if (op === "set") resolved.parent[resolved.key] = validation.value;
  else if (op === "add") resolved.parent[resolved.key] = validation.value;
  else if (op === "push") resolved.parent[resolved.key].push(validation.value);
  else if (op === "remove") removeValue(resolved.parent, resolved.key, validation.value);

  handleConsistencySideEffects(state, target, before, resolved.parent?.[resolved.key]);
  return { target, op, value: validation.value, ok: true, message: "已改" };
}

function checkPath(target) {
  const parts = target.split(".").filter(Boolean);
  if (!ROOT_WHITELIST.has(parts[0])) return { ok: false, reason: "路径不在天机白名单。" };
  if (parts.includes("tianji")) return { ok: false, reason: "天机系统自身不可改。" };
  if (parts[0] === "clock" || /(^|\.)(save|localStorage|storySettings|auditLog|chance|PRICE|BASE|constant)/i.test(target)) return { ok: false, reason: "命中时间/存档/锚点/概率黑名单。" };
  if (/^player\.justice\.crime\.cases\.[^.]+\.status$/.test(target) || /^player\.justice\.punishment/.test(target) || /sentence|verdict|量刑|判决/.test(target)) return { ok: false, reason: "案件状态与量刑结论属司法审查权，不可改。" };
  return { ok: true, reason: "" };
}

function resolvePath(state, target, op) {
  const parts = target.split(".").filter(Boolean);
  let cursor = state;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const next = resolveSegment(cursor, part);
    if (next === undefined || next === null) return { ok: false, reason: `引用不存在：${parts.slice(0, i + 1).join(".")}` };
    cursor = next;
  }
  const keyPart = parts.at(-1);
  const key = resolveKey(cursor, keyPart);
  if (key === undefined && !["add", "set"].includes(op)) return { ok: false, reason: `引用不存在：${target}` };
  if (op === "push" && !Array.isArray(cursor[key])) return { ok: false, reason: "push目标必须是数组。" };
  return { ok: true, parent: cursor, key: key ?? keyPart };
}

function resolveSegment(cursor, part) {
  if (Array.isArray(cursor)) {
    if (/^\d+$/.test(part)) return cursor[Number(part)];
    return cursor.find((item) => item?.id === part || item?.name === part);
  }
  return cursor?.[part];
}

function resolveKey(cursor, part) {
  if (Array.isArray(cursor)) {
    if (/^\d+$/.test(part) && cursor[Number(part)] !== undefined) return Number(part);
    const idx = cursor.findIndex((item) => item?.id === part || item?.name === part);
    return idx >= 0 ? idx : undefined;
  }
  return Object.prototype.hasOwnProperty.call(cursor || {}, part) ? part : undefined;
}

function validateValue(target, op, value, before) {
  if (op === "remove") return { ok: true, value };
  if (op === "add") {
    if (!Number.isFinite(Number(before)) || !Number.isFinite(Number(value))) return { ok: false, reason: "add只允许作用于数值。" };
    return { ok: true, value: clampNumberForPath(target, Number(before) + Number(value)) };
  }
  if (op === "push") return { ok: true, value };
  if (typeof before === "number") {
    if (!Number.isFinite(Number(value))) return { ok: false, reason: "数值字段必须给数值。" };
    return { ok: true, value: clampNumberForPath(target, Number(value)) };
  }
  if (typeof before === "boolean") return { ok: true, value: Boolean(value) };
  if (target.endsWith(".kind") && before && EVIDENCE_KINDS.has(before) && !EVIDENCE_KINDS.has(value)) return { ok: false, reason: "证据类型枚举不合法。" };
  if (before !== undefined && before !== null && typeof value !== typeof before && typeof before !== "object") return { ok: false, reason: "类型不匹配。" };
  return { ok: true, value };
}

function clampNumberForPath(target, value) {
  const leaf = target.split(".").at(-1);
  if (STAT_0_100.has(leaf) || /relation|reputation|officialRisk|proficiency|regulars|crowding|doubt|favor|trust/.test(target)) return clamp(value, 0, 100);
  if (target.endsWith(".strength")) return clamp(value, 1, 10);
  if (target.endsWith(".cleanDifficulty")) return Math.max(1, Math.round(value));
  if (NON_NEGATIVE_NUMBERS.has(leaf)) return Math.max(0, Math.round(value));
  return Number.isInteger(value) ? Math.round(value) : value;
}

function removeValue(parent, key, value) {
  if (Array.isArray(parent)) { parent.splice(key, 1); return; }
  if (Array.isArray(parent[key])) {
    const idx = parent[key].findIndex((item) => item === value || item?.id === value || item?.name === value);
    if (idx >= 0) parent[key].splice(idx, 1);
    return;
  }
  delete parent[key];
}

function handleConsistencySideEffects(state, target, before, after) {
  if (/^npcs\.[^.]+\.alive$/.test(target) && before === false && after === true) {
    const npcId = target.split(".")[1];
    const npc = state.npcs.find((item) => item.id === npcId || item.name === npcId);
    if (npc) {
      npc.memories = Array.isArray(npc.memories) ? npc.memories : [];
      npc.memories.push({ date: "天机后", text: "系统记忆：仿佛大病一场。" });
      npc.memories = npc.memories.slice(-10);
    }
  }
  if (/^npcs\.[^.]+\.(personality|situation|identity|impression)$/.test(target)) {
    const npcId = target.split(".")[1];
    const npc = state.npcs.find((item) => item.id === npcId || item.name === npcId);
    if (npc) npc.tianjiCardNote = "天机改定，卡片文本自下一次互动起按新设定注入。";
  }
}

function recomputeDerivedState(state) {
  state.player.health = clamp(state.player.health, 0, 100);
  state.player.satiety = clamp(state.player.satiety, 0, 100);
  state.player.cleanliness = clamp(state.player.cleanliness, 0, 100);
  state.player.officialRisk = clamp(state.player.officialRisk ?? 0, 0, 100);
  state.player.coins = Math.max(0, Math.round(state.player.coins ?? 0));
  (state.player.justice?.crime?.cases ?? []).forEach((crimeCase) => {
    crimeCase.evidenceStrength = (crimeCase.evidence ?? []).filter((item) => !item.removed).reduce((sum, item) => sum + (Number(item.strength) || 0), 0);
  });
}

function buildReceipt(results, unparsed = "") {
  const lines = results.length ? results.map((item) => `${item.ok ? "已改" : "已拒"} ${item.target || "(无路径)"}：${item.message}`) : ["未执行任何变更。"];
  if (unparsed) lines.push(`未解析：${unparsed}。请换个说法。`);
  return lines.join("\n");
}

function buildWorldSummary(state) {
  const player = state.player;
  const npcLines = (state.npcs ?? []).slice(0, 20).map((npc) => `${npc.id}/${npc.name}: relation=${JSON.stringify(npc.relation)} age=${npc.age} alive=${npc.alive !== false} situation=${npc.situation}`).join("\n");
  const cases = player.justice?.crime?.cases?.map((item) => `${item.id}:${item.type}/${item.status}/证据${(item.evidence ?? []).map((ev) => `${ev.id || ev.name}:${ev.kind}:${ev.strength}${ev.removed ? "已移除" : ""}`).join(",")}`).join("\n") || "无";
  return [
    `player: coins=${player.coins}, health=${player.health}, stamina=${player.stamina}, satiety=${player.satiety}, luck=${JSON.stringify(player.luck)}, identity=${player.identity}, location=${player.location}, officialRisk=${player.officialRisk}`,
    `business=${JSON.stringify(player.business ?? {}).slice(0, 1200)}`,
    `world: riceIndex=${state.world?.riceIndex}, activeEvents=${JSON.stringify(state.world?.activeEvents ?? []).slice(0, 800)}`,
    `npcs:\n${npcLines}`,
    `justice cases:\n${cases}`,
  ].join("\n");
}

function sanitizeParsedJson(content) {
  const text = String(content || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { mutations: [], unparsed: `解析器未返回合法JSON：${text.slice(0, 120)}` };
  }
  return {
    mutations: Array.isArray(parsed.mutations) ? parsed.mutations.slice(0, 20) : [],
    unparsed: typeof parsed.unparsed === "string" ? parsed.unparsed.slice(0, 240) : "",
  };
}

function snapshotTianjiSession(state) {
  const snapshot = {};
  ["clock", "player", "npcs", "world", "currentAction", "dead", "deathReason", "storyLog", "auditLog", "lastDailySettlement"].forEach((key) => { snapshot[key] = cloneValue(state[key]); });
  localStorage.setItem(TIANJI_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

function appendTianjiLog(entry) {
  const log = getTianjiLog();
  log.push(entry);
  localStorage.setItem(TIANJI_LOG_KEY, JSON.stringify(log.slice(-MAX_LOG)));
}

function reject(target, op, message, value) { return { target, op, value, ok: false, message }; }
function cloneValue(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Math.round(Number(value) || 0))); }
