import { callDeepSeek } from "./api.js";
import { getDateParts, getMinuteOfDay, getPeriod } from "./clock.js";
import { rememberStory } from "./memory.js";

export const IDENTITIES = ["无籍少年", "在籍平民", "书院学子", "应试士子", "得解士子", "衙门书吏", "进士(待阙)"];
export const REGISTRATION_COST = 300;
export const REGISTRATION_DAYS = 3;

export function normalizeIdentity(value) {
  if (value === "举人") return "得解士子";
  return IDENTITIES.includes(value) ? value : "无籍少年";
}

export function normalizeIdentityState(saved = {}) {
  return {
    householdRegistration: normalizeRegistration(saved.householdRegistration),
    identityMoments: saved.identityMoments && typeof saved.identityMoments === "object" ? saved.identityMoments : {},
  };
}

export function getIdentityContext(player) {
  const identity = normalizeIdentity(player.identity);
  const notes = {
    "无籍少年": "无籍无保，在体面场所近乎不可见，旁人只当城中浮浪少年。",
    "在籍平民": "有户籍可查，是城中良民，但门第仍低。",
    "书院学子": "入了书院，士人门第初开，寒素中有可造之名。",
    "应试士子": "有应试资格，临场前后被以士子看待。",
    "得解士子": "解试得中，在临安是有分量的体面人，门第观感大变。",
    "衙门书吏": "虽是小吏，却是官面上的人，坊市胥役都要掂量。",
    "进士(待阙)": "殿试唱名后的进士，虽待阙未注官，门第观感已为本作最高。",
  };
  const jieNote = player.scholar?.hadJie && identity !== "得解士子" && identity !== "进士(待阙)" ? "曾得解，仍受士林敬重。" : "";
  return `当前身份：${identity}。${notes[identity]}${jieNote}`;
}

export function getIdentitySystemPromptRule() {
  return "身份决定门第观感：无籍者在体面场所近乎不可见；在籍平民可被按良民对待；书院学子有寒素士人门面；应试士子有考试资格；得解士子在临安是有分量的体面人，门第观感大变；曾得解者亦受士林敬重；衙门书吏虽小却是官面上的人；进士(待阙)为本作最高门第观感，但不得生成官职内容。NPC对得解及以上身份的借贷信用应上调。不得由AI擅自改变身份，身份变迁只由代码条件判定。";
}

export function canApplyHouseholdRegistration(state) {
  if (normalizeIdentity(state.player.identity) !== "无籍少年") return { ok: false, reason: "你已经有了身份籍贯。" };
  if (state.player.identityState?.householdRegistration?.active) return { ok: false, reason: "附籍正在办理中。" };
  if (state.player.housing !== "租屋") return { ok: false, reason: "须先有租屋作为落脚住址。" };
  const guarantor = getRegistrationGuarantor(state.npcs);
  if (!guarantor) return { ok: false, reason: "须周大娘好感≥50或陈四信任≥50出面作保。" };
  const cost = getRegistrationCost(state.player);
  if (state.player.coins < cost) return { ok: false, reason: `打点需${cost}文。` };
  return { ok: true, guarantor, cost };
}

export function startHouseholdRegistration(state) {
  const gate = canApplyHouseholdRegistration(state);
  if (!gate.ok) return gate;
  const cost = gate.cost ?? REGISTRATION_COST;
  state.player.coins -= cost;
  state.player.identityState = normalizeIdentityState(state.player.identityState);
  state.player.identityState.householdRegistration = {
    active: true,
    remainingDays: REGISTRATION_DAYS,
    guarantorId: gate.guarantor.id,
  };
  gate.guarantor.memories = Array.isArray(gate.guarantor.memories) ? gate.guarantor.memories : [];
  gate.guarantor.memories.push({ date: formatDate(state.clock), text: `出面为玩家附籍作保，已收拾文书打点${cost}文。` });
  return { ok: true, message: `${gate.guarantor.name}答应作保，附籍文书开始办理，约需${REGISTRATION_DAYS}日。` };
}

export function tickHouseholdRegistration(state) {
  const registration = state.player.identityState?.householdRegistration;
  if (!registration?.active) return null;
  registration.remainingDays -= 1;
  if (registration.remainingDays > 0) return null;
  registration.active = false;
  state.player.identity = "在籍平民";
  return { from: "无籍少年", to: "在籍平民", reason: "附籍办成，有保人、有住址，户帖可查。" };
}

export async function runIdentityMoment(state, apiKey, mode, transition) {
  const { year, month, day } = getDateParts(state.clock);
  const maxChars = Number.isFinite(transition.maxChars) ? transition.maxChars : 400;
  const content = await callDeepSeek([
    { role: "system", content: `你是南宋临安身份变迁叙事器。只写一段中文叙事，不输出JSON。此为重要身份时刻，可写至${maxChars}字；克制、具体、重在礼法与旁人眼光变化。` },
    { role: "user", content: `重要时刻：玩家身份由“${transition.from}”变为“${transition.to}”。原因：${transition.reason}。时间：第${year}年${month}月${day}日。请写身份时刻叙事。` },
  ], mode, apiKey);
  const scene = String(content || `${transition.to}的身份落定。`).trim().slice(0, maxChars + 100);
  await rememberStory(state.player, state.clock, `身份变为${transition.to}`, apiKey);
  return scene;
}

function getRegistrationGuarantor(npcs) {
  const zhou = npcs.find((npc) => npc.id === "zhou_daniang");
  if ((zhou?.relation?.favor ?? 0) >= 50) return zhou;
  const chen = npcs.find((npc) => npc.id === "chen_si");
  if ((chen?.relation?.trust ?? 0) >= 50) return chen;
  return null;
}

function normalizeRegistration(saved = {}) {
  return {
    active: Boolean(saved.active),
    remainingDays: Number.isFinite(saved.remainingDays) ? Math.max(0, Math.floor(saved.remainingDays)) : 0,
    guarantorId: typeof saved.guarantorId === "string" ? saved.guarantorId : "",
  };
}

function formatDate(clock) {
  const { year, month, day } = getDateParts(clock);
  const minuteOfDay = getMinuteOfDay(clock);
  return `第${year}年${month}月${day}日 ${getPeriod(minuteOfDay)}`;
}

function getRegistrationCost(player) {
  return player.begging?.mode === "join" ? REGISTRATION_COST * 2 : REGISTRATION_COST;
}
