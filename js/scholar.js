import { callDeepSeek } from "./api.js";
import { getDateParts } from "./clock.js";
import { spendCoins } from "./player.js";
import { chance } from "./luck.js";

export const CLASSIC_BOOK_NAME = "经书";
export const CLASSIC_BOOK_PRICE = 800;
export const MENTOR_FEE = 500;
export const AUDIT_TUITION = 100;
export const ACADEMY_FEE = 1000;
export const EXAM_FEE = 400;
export const PROVINCIAL_EXAM_FEE = 600;
export const CLERK_BUY_IN = 2000;
export const CLERK_MONTHLY_PAY = 1200;
export const JIE_RUMOR_ID = "player_jie_scholar";

export function normalizeScholarState(saved = {}) {
  const nextExam = normalizeExamDate(saved.nextExam);
  return {
    masterWu: Boolean(saved.masterWu),
    auditing: Boolean(saved.auditing),
    academyStudent: Boolean(saved.academyStudent),
    hadJie: Boolean(saved.hadJie),
    jinshiRank: typeof saved.jinshiRank === "string" ? saved.jinshiRank : "",
    lastAuditTuitionMonth: typeof saved.lastAuditTuitionMonth === "string" ? saved.lastAuditTuitionMonth : "",
    nextExam,
    provincialExam: normalizeOptionalExamDate(saved.provincialExam),
    palaceExam: normalizeOptionalExamDate(saved.palaceExam),
    sameYearHooks: Array.isArray(saved.sameYearHooks) ? saved.sameYearHooks.filter((item) => typeof item === "string") : [],
    clerk: normalizeClerkState(saved.clerk),
    lastClerkPayMonth: typeof saved.lastClerkPayMonth === "string" ? saved.lastClerkPayMonth : "",
  };
}

export function getExamTimelineText(player) {
  const scholar = normalizeScholarState(player.scholar);
  const provincial = scholar.provincialExam ? `省试第${scholar.provincialExam.year}年${scholar.provincialExam.month}月` : "省试得解后次年2月";
  const palace = scholar.palaceExam ? `殿试第${scholar.palaceExam.year}年${scholar.palaceExam.month}月` : "殿试省试中后一月";
  return `解试第${scholar.nextExam.year}年8月 · ${provincial} · ${palace}`;
}

export function getNextExamDateText(player) {
  const exam = normalizeScholarState(player.scholar).nextExam;
  return `第${exam.year}年8月`;
}

export function isExamMonth(clock, player) {
  const { year, month } = getDateParts(clock);
  const exam = normalizeScholarState(player.scholar).nextExam;
  return year === exam.year && month === 8;
}

export async function tryHandleScholarFreeAction(state, text, apiKey, mode, helpers) {
  if (/(拜师|投师|束脩).*(吴先生)|吴先生.*(拜师|投师|束脩)/.test(text)) {
    return handleWuMentorship(state, apiKey, mode, helpers);
  }
  if (/(旁听|书院听课|入书院旁听)/.test(text)) return handleAuditStudy(state, helpers);
  if (/(正学|入学|书院学子|入书院)/.test(text)) return handleAcademyAdmission(state, helpers);
  if (/(省试|礼部试)/.test(text)) return handleProvincialExam(state, apiKey, mode, helpers);
  if (/(殿试|传胪|唱名)/.test(text)) return handlePalaceExam(state, apiKey, mode, helpers);
  if (/(报名|应试|解试|赴考)/.test(text)) return handlePrefecturalExam(state, apiKey, mode, helpers);
  if (/(买缺|书吏缺|衙门补吏|谋书吏)/.test(text)) return handleClerkPurchase(state, helpers);
  return null;
}

export function canStudyAtAcademy(state) {
  return state.player.location === "academy" && (state.player.scholar?.auditing || state.player.scholar?.academyStudent);
}

export function getWenStudyMultiplier(player) {
  return player.scholar?.academyStudent ? 1.5 : 1;
}

export function hasJieCredit(player) {
  return Boolean(player.scholar?.hadJie) || player.identity === "得解士子" || player.identity === "进士(待阙)";
}

export function isClerkVacancyOpen(world) {
  return world.activeEvents?.some((event) => event.id === "clerk_vacancy");
}

export function getClerkWorkDefinition() {
  return { id: "yamen_duty", name: "衙门当值", durationMinutes: 360, staminaCost: 15, description: "书吏月钱制，每月初发1200文。" };
}

export function getTutorWorkDefinition(player) {
  const reward = player.identity === "进士(待阙)" ? 160 : 80;
  return { id: "tutor_children", name: "蒙师", durationMinutes: 180, staminaCost: 8, description: `教富家子弟，得${reward}文，算/谈偶有长进。` };
}

export function canDoClerkDuty(player) {
  return player.identity === "衙门书吏";
}

export function canTutorChildren(player) {
  return hasJieCredit(player) || (player.skills?.wen ?? 0) >= 75;
}

export function settleClerkDuty(state) {
  state.player.scholar = normalizeScholarState(state.player.scholar);
  state.player.scholar.clerk.absentDays = 0;
  state.player.scholar.clerk.lastDutyDate = dateKey(getDateParts(state.clock));
  const grey = chance(0.08, "good_work_event", state.player);
  return { message: grey ? "衙门当值一日，有旧吏低声提及一桩灰色差事，利害未明。" : "衙门当值六小时，簿书牌票照例归档。", eventChance: grey ? 1 : 0.05, forceTrouble: grey };
}

export function monthlyScholarSettlement(state, dateParts) {
  state.player.scholar = normalizeScholarState(state.player.scholar);
  if (dateParts.day === 1 && state.player.identity === "衙门书吏") {
    const monthKey = `${dateParts.year}-${dateParts.month}`;
    if (state.player.scholar.lastClerkPayMonth !== monthKey) {
      state.player.coins += CLERK_MONTHLY_PAY;
      state.player.scholar.lastClerkPayMonth = monthKey;
      state.message = `月初衙门发书吏月钱${CLERK_MONTHLY_PAY}文。`;
    }
  }
  if (state.player.identity === "衙门书吏") {
    const last = state.player.scholar.clerk.lastDutyDate;
    if (last && last !== dateKey(dateParts)) state.player.scholar.clerk.absentDays += 1;
    if (state.player.scholar.clerk.absentDays >= 5) {
      state.player.identity = "在籍平民";
      state.player.scholar.clerk.dismissed = true;
      state.message = "衙门点卯连缺五日，书吏名籍被革，仍回在籍平民。";
      return { from: "衙门书吏", to: "在籍平民", reason: "衙门当值连续缺勤五日，被革退出缺。" };
    }
  }
  if (state.player.identity === "得解士子" && state.player.scholar.provincialExam && isAfterExamMonth(dateParts, state.player.scholar.provincialExam)) {
    state.player.identity = "书院学子";
    state.player.scholar.hadJie = true;
    state.player.scholar.provincialExam = null;
    state.message = "省试考期已过，得解资格作废，仍归书院学子；曾得解之名仍在士林。";
    return { from: "得解士子", to: "书院学子", reason: "得解资格仅至次年省试，逾期未赴试而作废；曾得解之名入档。" };
  }
  return null;
}

export function applyJieSocialEffects(state) {
  state.player.scholar.hadJie = true;
  const maxIds = new Set(["mr_wu", "sun_yasi"]);
  state.npcs.forEach((npc) => {
    const delta = maxIds.has(npc.id) ? 20 : getPersonalityJieDelta(npc);
    npc.relation.favor = clamp(npc.relation.favor + delta, -100, 100);
    npc.impression = `${npc.impression === "尚不认识此人" ? "听闻" : npc.impression}；如今知道玩家得解，是贫巷里出头的体面士子。`;
    npc.memories = Array.isArray(npc.memories) ? npc.memories : [];
    npc.memories.push({ date: formatDateText(getDateParts(state.clock)), text: "听闻玩家解试得中，贫巷出了得解士子。" });
  });
  injectJieRumor(state.world);
}

export function applyJinshiSocialEffects(state, rank) {
  state.npcs.forEach((npc) => {
    const delta = npc.id === "mr_wu" ? 30 : npc.id === "sun_yasi" ? 28 : 18;
    npc.relation.favor = clamp(npc.relation.favor + delta, -100, 100);
    npc.relation.trust = clamp((npc.relation.trust ?? 0) + Math.floor(delta / 2), -100, 100);
    npc.impression = `玩家已是${rank}进士，虽待阙未注官，却是本作最高门第人物。`;
    npc.memories = Array.isArray(npc.memories) ? npc.memories : [];
    npc.memories.push({ date: formatDateText(getDateParts(state.clock)), text: `传胪唱名后，玩家成了${rank}进士，正在待阙。` });
  });
}

async function handleWuMentorship(state, apiKey, mode, helpers) {
  const wu = state.npcs.find((npc) => npc.id === "mr_wu");
  if ((wu?.relation?.trust ?? 0) < 40) return helpers.fail("吴先生还未信你到肯收徒。") ;
  if ((state.player.skills?.wen ?? 0) < 28) return helpers.fail("文未到28，吴先生不肯考较。") ;
  if (!spendCoins(state.player, MENTOR_FEE)) return helpers.fail(`束脩需${MENTOR_FEE}文。`);
  const scene = await generatePlainScene(apiKey, mode, "吴先生拜师考较", `玩家备束脩${MENTOR_FEE}文向吴先生拜师。代码判定wen≥28，考较通过。请写当场试文识字、收徒过程。`);
  state.player.scholar.masterWu = true;
  state.player.mentorUnlocks.wen = true;
  wu.relation.trust = Math.min(100, (wu.relation.trust ?? 0) + 25);
  wu.relation.favor = Math.min(100, (wu.relation.favor ?? 0) + 20);
  wu.impression = "已收入门下的寒门弟子，肯下功夫。";
  wu.memories.push({ date: helpers.dateText(), text: "收玩家为弟子，受束脩并当场考较通过。" });
  helpers.append(scene);
  helpers.save();
  return { handled: true, message: "拜师吴先生已成，文上限提高。" };
}

function handleAuditStudy(state, helpers) {
  if (!state.player.scholar.masterWu) return helpers.fail("须先拜师吴先生，由他引荐旁听。") ;
  const monthKey = monthKeyOf(getDateParts(state.clock));
  if (state.player.scholar.lastAuditTuitionMonth !== monthKey) {
    if (!spendCoins(state.player, AUDIT_TUITION)) return helpers.fail(`本月旁听束金需${AUDIT_TUITION}文。`);
    state.player.scholar.lastAuditTuitionMonth = monthKey;
  }
  state.player.scholar.auditing = true;
  helpers.append("吴先生递了话，书院允你在廊下旁听。本月束金已清，可在书院修习。 ");
  return { handled: true, message: "已获书院旁听资格。" };
}

async function handleAcademyAdmission(state, helpers) {
  if (state.player.identity !== "在籍平民") return helpers.fail("须先附籍成为在籍平民。") ;
  if (!state.player.scholar.masterWu) return helpers.fail("须吴先生引荐。") ;
  if ((state.player.skills?.wen ?? 0) < 45) return helpers.fail("文需45方可入正学。") ;
  if (!spendCoins(state.player, ACADEMY_FEE)) return helpers.fail(`入学金需${ACADEMY_FEE}文。`);
  state.player.scholar.academyStudent = true;
  state.player.scholar.auditing = true;
  const previous = state.player.identity;
  state.player.identity = "书院学子";
  helpers.append("入学金交讫，吴先生具名引荐，书院将你列入正学名册。此后可在书院修习，文业进境更快。 ");
  await helpers.identityMoment({ from: previous, to: "书院学子", reason: "入书院正学，名册有列。" });
  return { handled: true, message: "成为书院学子。" };
}

async function handlePrefecturalExam(state, apiKey, mode, helpers) {
  if (state.player.identity !== "书院学子") return helpers.fail("须为在籍且书院学子方可报名解试。") ;
  if ((state.player.skills?.wen ?? 0) < 55) return helpers.fail("文需55方可报名。") ;
  if (!isExamMonth(state.clock, state.player)) return helpers.fail(`当前不是考期，下次考期：${getNextExamDateText(state.player)}。`);
  const wu = state.npcs.find((npc) => npc.id === "mr_wu");
  if (!state.player.scholar.masterWu || !wu) return helpers.fail("须吴先生作保。") ;
  if (!spendCoins(state.player, EXAM_FEE)) return helpers.fail(`考费需${EXAM_FEE}文。`);
  state.player.identity = "应试士子";
  await helpers.identityMoment({ from: "书院学子", to: "应试士子", reason: "考期报名，吴先生作保，入场有名。" });
  for (let i = 1; i <= 3; i += 1) {
    const scene = await generatePlainScene(apiKey, mode, `解试第${i}日`, `玩家参加三日解试第${i}日。考题氛围、场规、疲惫由你呈现；不要判结果。`);
    helpers.append(scene);
    helpers.advance(24 * 60);
  }
  const passed = chance(getPrefecturalPassRate(state.player.skills.wen), "good_exam", state.player, { maxDelta: 0.01 });
  if (passed) {
    state.player.identity = "得解士子";
    state.player.scholar.hadJie = true;
    state.player.scholar.provincialExam = { year: getDateParts(state.clock).year + 1, month: 2 };
    applyJieSocialEffects(state);
    await helpers.identityMoment({ from: "应试士子", to: "得解士子", reason: "解试得中，取得次年省试资格，临安门第观感大变。" });
  } else {
    state.player.identity = "书院学子";
    state.player.reputation = (state.player.reputation ?? 0) + 3;
    state.player.memories.push({ date: helpers.dateText(), text: "解试落第，却结识一名同年，日后或可再叙。" });
    state.player.scholar.sameYearHooks.push(`第${getDateParts(state.clock).year}年解试同年`);
    const scene = await generatePlainScene(apiKey, mode, "解试落第", "玩家大概率落第。请写放榜日落第百态，兼写玩家得一条同年人脉钩子。 ");
    helpers.append(scene);
  }
  state.player.scholar.nextExam = { year: state.player.scholar.nextExam.year + 3, month: 8 };
  return { handled: true, message: passed ? "解试得中，成为得解士子。" : "解试落第，仍归书院学子。" };
}

async function handleProvincialExam(state, apiKey, mode, helpers) {
  state.player.scholar = normalizeScholarState(state.player.scholar);
  if (state.player.identity !== "得解士子") return helpers.fail("须为得解士子，方可赴次年省试。") ;
  const exam = state.player.scholar.provincialExam;
  if (!exam || !isSameExamMonth(getDateParts(state.clock), exam)) return helpers.fail(`当前不是省试考期，${exam ? `省试在第${exam.year}年${exam.month}月` : "尚未排定省试"}。`);
  const wu = state.npcs.find((npc) => npc.id === "mr_wu");
  if (!wu) return helpers.fail("须吴先生具保状。") ;
  if (!spendCoins(state.player, PROVINCIAL_EXAM_FEE)) return helpers.fail(`省试考费需${PROVINCIAL_EXAM_FEE}文。`);
  wu.memories.push({ date: helpers.dateText(), text: "为玩家赴省试具保状。" });
  const titles = ["省试第一场·经义", "省试第二场·论", "省试第三场·策"];
  for (const title of titles) {
    const scene = await generatePlainScene(apiKey, mode, title, "玩家以得解士子身份赴礼部省试。本场只写题目氛围、场规、士子群像与临场压力；结果由代码另定。", 500);
    helpers.append(scene);
    helpers.advance(24 * 60);
  }
  const passed = chance(getProvincialPassRate(state.player), "good_exam", state.player, { maxDelta: 0.01 });
  if (passed) {
    const now = getDateParts(state.clock);
    state.player.scholar.palaceExam = addMonths({ year: now.year, month: now.month }, 1);
    state.player.scholar.provincialExam = null;
    helpers.append("省试榜出，名在其上。礼部试已过，殿试定在一月之后；此关不再淘汰，只待御前定名次。 ");
    return { handled: true, message: "省试得中，一月后殿试。" };
  }
  state.player.identity = "书院学子";
  state.player.scholar.hadJie = true;
  state.player.scholar.provincialExam = null;
  state.player.reputation = (state.player.reputation ?? 0) + 8;
  state.player.memories.push({ date: helpers.dateText(), text: "省试落第，得解资格作废，但曾得解之名留在士林。" });
  state.player.scholar.sameYearHooks.push(`第${getDateParts(state.clock).year}年省试同年`);
  const scene = await generatePlainScene(apiKey, mode, "省试落第", "玩家省试落第，身份回书院学子并永久有曾得解之名。请写出省试落第不同于解试落第的分量：已有体面、已有期待、失落更重，但士林仍敬其曾得解。", 500);
  helpers.append(scene);
  return { handled: true, message: "省试落第，得解资格作废，仍有曾得解之名。" };
}

async function handlePalaceExam(state, apiKey, mode, helpers) {
  state.player.scholar = normalizeScholarState(state.player.scholar);
  const exam = state.player.scholar.palaceExam;
  if (!exam) return helpers.fail("尚未排定殿试。") ;
  if (!isSameExamMonth(getDateParts(state.clock), exam)) return helpers.fail(`殿试在第${exam.year}年${exam.month}月。`) ;
  const rank = rollPalaceRank(state.player.skills?.wen ?? 0);
  const titles = ["殿试·入宫", "殿试·对策", "殿试·传胪唱名"];
  for (const title of titles) {
    const scene = await generatePlainScene(apiKey, mode, title, `玩家省试已中，入殿试。殿试不淘汰，最终名次档由代码定为${rank}。本段写最高规格科举氛围，不写任何官职内容。`, 600);
    helpers.append(scene);
  }
  state.player.identity = "进士(待阙)";
  state.player.scholar.jinshiRank = rank;
  state.player.scholar.palaceExam = null;
  applyJinshiSocialEffects(state, rank);
  await helpers.identityMoment({ from: "得解士子", to: "进士(待阙)", reason: `殿试传胪唱名，列${rank}，注官仍须候缺；官人候阙中，仕途篇章待续。`, maxChars: 500 });
  helpers.append("官人候阙中，仕途篇章待续。 ");
  return { handled: true, message: "殿试唱名，成为进士(待阙)。" };
}

async function handleClerkPurchase(state, helpers) {
  if (state.player.identity !== "在籍平民" && state.player.identity !== "书院学子") return helpers.fail("须先在籍。") ;
  if ((state.player.skills?.wen ?? 0) < 60 || (state.player.skills?.suan ?? 0) < 40) return helpers.fail("须文≥60且算≥40。") ;
  const sun = state.npcs.find((npc) => npc.id === "sun_yasi");
  if ((sun?.relation?.favor ?? 0) < 40 || (sun?.relation?.trust ?? 0) < 30) return helpers.fail("孙押司尚不肯透露缺额。") ;
  if (!isClerkVacancyOpen(state.world)) return helpers.fail("衙门眼下没有补吏缺额。") ;
  if (!spendCoins(state.player, CLERK_BUY_IN)) return helpers.fail(`买缺需${CLERK_BUY_IN}文。`);
  sun.assets.cash += CLERK_BUY_IN;
  sun.memories.push({ date: helpers.dateText(), text: "替玩家打点衙门书吏缺额，收买缺钱。" });
  const previous = state.player.identity;
  state.player.identity = "衙门书吏";
  state.player.scholar.clerk = { active: true, absentDays: 0, lastDutyDate: dateKey(getDateParts(state.clock)), dismissed: false };
  await helpers.identityMoment({ from: previous, to: "衙门书吏", reason: "孙押司引荐，衙门补吏缺额内买缺入名。" });
  return { handled: true, message: "买缺入名，成为衙门书吏。" };
}

function getPrefecturalPassRate(wen) {
  if (wen >= 85) return 0.06;
  if (wen >= 75) return 0.04;
  if (wen >= 65) return 0.02;
  return 0.01;
}

function getProvincialPassRate(player) {
  const wen = player.skills?.wen ?? 0;
  let rate = 0.03;
  if (wen >= 95) rate = 0.10;
  else if (wen >= 85) rate = 0.08;
  else if (wen >= 75) rate = 0.05;
  const hookBonus = Math.min(0.02, (player.scholar?.sameYearHooks?.length ?? 0) * 0.005);
  return Math.min(0.12, rate + hookBonus);
}

function rollPalaceRank(wen) {
  let first = 0.005;
  let second = 0.15;
  if (wen >= 95) { first += 0.01; second += 0.08; }
  else if (wen >= 85) { first += 0.005; second += 0.05; }
  else if (wen < 75) { first *= 0.5; second -= 0.04; }
  const roll = Math.random();
  if (roll < first) return "一甲";
  if (roll < first + second) return "二甲";
  return "三甲及以下";
}

async function generatePlainScene(apiKey, mode, title, prompt, maxChars = 500) {
  const content = await callDeepSeek([
    { role: "system", content: `你是南宋临安文路事件叙事器。只输出一段中文叙事，不要JSON。克制具体，100-${maxChars}字。` },
    { role: "user", content: `${title}：${prompt}` },
  ], mode, apiKey);
  return String(content || title).trim().slice(0, maxChars + 100);
}

function injectJieRumor(world) {
  world.activeEvents = Array.isArray(world.activeEvents) ? world.activeEvents : [];
  world.activeEvents = world.activeEvents.filter((event) => event.id !== JIE_RUMOR_ID);
  world.activeEvents.push({ id: JIE_RUMOR_ID, name: "贫巷出了得解士子", text: "贫巷出了得解士子，街坊说起时都压低又抬高了声。", remainingDays: 15, hook: {} });
}

function getPersonalityJieDelta(npc) {
  if (["zhou_daniang", "chen_si", "an_langzhong"].includes(npc.id)) return 16;
  if (["liu_mazi"].includes(npc.id)) return 12;
  return 10;
}

function normalizeExamDate(saved = {}) {
  const year = Number.isFinite(saved.year) ? Math.max(1, Math.floor(saved.year)) : 1;
  return { year, month: 8 };
}

function normalizeOptionalExamDate(saved = null) {
  if (!saved || !Number.isFinite(saved.year) || !Number.isFinite(saved.month)) return null;
  return { year: Math.max(1, Math.floor(saved.year)), month: clamp(Math.floor(saved.month), 1, 12) };
}

function normalizeClerkState(saved = {}) {
  return {
    active: Boolean(saved.active),
    absentDays: Number.isFinite(saved.absentDays) ? Math.max(0, Math.floor(saved.absentDays)) : 0,
    lastDutyDate: typeof saved.lastDutyDate === "string" ? saved.lastDutyDate : "",
    dismissed: Boolean(saved.dismissed),
  };
}

function isSameExamMonth(parts, exam) {
  return parts.year === exam.year && parts.month === exam.month;
}

function isAfterExamMonth(parts, exam) {
  return parts.year > exam.year || (parts.year === exam.year && parts.month > exam.month);
}

function addMonths(exam, months) {
  const zeroBased = (exam.year - 1) * 12 + (exam.month - 1) + months;
  return { year: Math.floor(zeroBased / 12) + 1, month: (zeroBased % 12) + 1 };
}

function formatDateText(parts) { return `第${parts.year}年${parts.month}月${parts.day}日`; }
function monthKeyOf(parts) { return `${parts.year}-${parts.month}`; }
function dateKey(parts) { return `${parts.year}-${parts.month}-${parts.day}`; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
