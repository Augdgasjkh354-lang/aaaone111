import { advanceClockToNextMorning, getDateParts, getMinuteOfDay } from "./clock.js";
import { getRoute, getTravelStaminaCost } from "./world.js";
import { changeSatiety, changeStamina } from "./player.js";
import { getAvailableWorks, createWorkAction, settleWork } from "./work.js";
import { getStudyOptions, gainSkill } from "./skills.js";
import { getBusinessActions, createBusinessAction, settleBusinessAction } from "./business.js";
import { getActiveFestival } from "./festival.js";

export const ROUTINE_PERIODS = ["晨", "午", "暮", "夜"];
export const ROUTINE_OPTIONS = [
  { id: "idle", name: "空闲" },
  { id: "work:scavenge", name: "活计：拾荒" },
  { id: "work:beg", name: "活计：讨饭" },
  { id: "work:copy_letters", name: "活计：抄书信" },
  { id: "work:dock_porter", name: "活计：码头扛包" },
  { id: "study:wen", name: "修习：文" },
  { id: "study:wu", name: "修习：武" },
  { id: "study:suan", name: "修习：算" },
  { id: "business:auto", name: "经营：自动平价" },
  { id: "travel:qinghefang", name: "出行：清河坊" },
  { id: "travel:dock", name: "出行：码头" },
];

export function normalizeRoutineState(saved = {}) {
  const schedule = saved.schedule && typeof saved.schedule === "object" ? saved.schedule : {};
  return {
    autoEat: saved.autoEat !== false,
    mealType: saved.mealType === "fine" ? "fine" : "rough",
    autoSleep: saved.autoSleep !== false,
    autoBath: Boolean(saved.autoBath),
    autoDues: saved.autoDues !== false,
    breakOnFestival: saved.breakOnFestival !== false,
    monthlySummary: saved.monthlySummary !== false,
    running: Boolean(saved.running),
    remainingDays: clampDay(saved.remainingDays ?? 0),
    daysRun: Number.isFinite(saved.daysRun) ? Math.max(0, Math.floor(saved.daysRun)) : 0,
    schedule: Object.fromEntries(ROUTINE_PERIODS.map((period) => [period, normalizeOption(schedule[period] ?? "idle")])),
    logs: Array.isArray(saved.logs) ? saved.logs.filter((line) => typeof line === "string").slice(-30) : [],
    monthReports: Array.isArray(saved.monthReports) ? saved.monthReports.filter((line) => typeof line === "string").slice(-12) : [],
    interrupt: typeof saved.interrupt === "string" ? saved.interrupt : "",
    lastMonthSummaryKey: typeof saved.lastMonthSummaryKey === "string" ? saved.lastMonthSummaryKey : "",
  };
}

export function getRoutineSettings(player) {
  player.routine = normalizeRoutineState(player.routine);
  return player.routine;
}

export function updateRoutineSettings(player, patch = {}) {
  const routine = getRoutineSettings(player);
  ["autoEat", "autoSleep", "autoBath", "autoDues", "breakOnFestival", "monthlySummary"].forEach((key) => {
    if (key in patch) routine[key] = Boolean(patch[key]);
  });
  if (patch.mealType) routine.mealType = patch.mealType === "fine" ? "fine" : "rough";
  ROUTINE_PERIODS.forEach((period) => {
    if (patch[`schedule_${period}`]) routine.schedule[period] = normalizeOption(patch[`schedule_${period}`]);
  });
  return routine;
}

export function startRoutineMode(player, days = 30) {
  const routine = getRoutineSettings(player);
  routine.running = true;
  routine.remainingDays = clampDay(days || 30);
  routine.daysRun = 0;
  routine.interrupt = "";
  return routine;
}

export function stopRoutineMode(player, reason = "") {
  const routine = getRoutineSettings(player);
  routine.running = false;
  routine.remainingDays = 0;
  if (reason) routine.interrupt = reason;
  return routine;
}

export function checkAutomationNeeds(state, helpers) {
  const routine = getRoutineSettings(state.player);
  const minute = getMinuteOfDay(state.clock);
  if (routine.autoEat && state.player.satiety < 40) {
    const cost = routine.mealType === "fine" ? 30 : Math.max(1, Math.round(10 * (state.world?.riceIndex ?? 100) / 100));
    if (state.player.coins < cost) return interrupt(routine, `自动吃饭失败：需${cost}文，钱不够。`);
    state.player.coins -= cost;
    changeSatiety(state.player, routine.mealType === "fine" ? 65 : 40);
    pushRoutineLog(routine, `自动吃${routine.mealType === "fine" ? "像样饭" : "粗饭"}-${cost}文。`);
  }
  if (routine.autoBath && state.player.cleanliness < 30) {
    if (state.player.coins < 5) return interrupt(routine, "自动洗浴失败：浴堂需5文，钱不够。");
    state.player.coins -= 5;
    state.player.cleanliness = 100;
    pushRoutineLog(routine, "自动去浴堂洗浴-5文。寒冷期不去河边。");
  }
  if (routine.autoSleep && minute >= 23 * 60) {
    helpers.sleepToMorning();
    pushRoutineLog(routine, "夜深自动就寝。 ");
  }
  return { ok: true };
}

export function runRoutineDay(state, helpers) {
  const routine = getRoutineSettings(state.player);
  if (!routine.running) return { ok: false, message: "过日子未开启。" };
  const before = snapshot(state);
  const breakReason = getBreakReason(state, routine);
  if (breakReason) return interrupt(routine, breakReason);
  const parts = getDateParts(state.clock);
  const dateText = `第${parts.year}年${parts.month}月${parts.day}日`;
  const results = [];
  for (const period of ROUTINE_PERIODS) {
    const option = routine.schedule[period] || "idle";
    const result = executeRoutineOption(state, option, helpers);
    results.push(`${period}:${result.message}`);
    if (!result.ok) return interrupt(routine, `${period}日程中断：${result.message}`);
    const nowBreak = getBreakReason(state, routine);
    if (nowBreak) return interrupt(routine, nowBreak);
  }
  const after = snapshot(state);
  const line = `${dateText}｜${results.join("；")}｜损益${after.coins - before.coins}文｜饱${Math.floor(state.player.satiety)}体${Math.floor(state.player.stamina)}健${Math.floor(state.player.health)}`;
  pushRoutineLog(routine, line);
  maybeMakeMonthSummary(state, routine, parts, before, after);
  routine.remainingDays -= 1;
  routine.daysRun += 1;
  if (routine.remainingDays <= 0 || routine.daysRun >= 30) return interrupt(routine, "连续过日子已到上限30天，停下喘口气。", false);
  return { ok: true, message: line };
}

export function getRoutineLogLines(player) {
  const routine = getRoutineSettings(player);
  return [
    `过日子：${routine.running ? `运行中，余${routine.remainingDays}日` : "未开启"}${routine.interrupt ? `；打断：${routine.interrupt}` : ""}`,
    `自动：吃饭${routine.autoEat ? "开" : "关"}/${routine.mealType === "fine" ? "像样" : "粗饭"}，睡觉${routine.autoSleep ? "开" : "关"}，洗浴${routine.autoBath ? "开" : "关"}，续租发薪例钱${routine.autoDues ? "开" : "关"}`,
    `日程：${ROUTINE_PERIODS.map((p) => `${p}${optionName(routine.schedule[p])}`).join("；")}`,
    ...(routine.monthReports.length ? [`月结：${routine.monthReports.at(-1)}`] : []),
    ...(routine.logs.length ? routine.logs.slice(-30) : ["暂无起居日志。"]),
  ];
}

function executeRoutineOption(state, option, helpers) {
  if (option === "idle") { helpers.advance(360, { routine: true }); return { ok: true, message: "空过" }; }
  if (option.startsWith("travel:")) return autoTravel(state, option.split(":")[1], helpers);
  if (option.startsWith("work:")) return runWork(state, option.split(":")[1], helpers);
  if (option.startsWith("study:")) return runStudy(state, option.split(":")[1], helpers);
  if (option === "business:auto") return runBusiness(state, helpers);
  return { ok: false, message: "日程项无效" };
}

function runWork(state, workId, helpers) {
  const available = getAvailableWorks(state).find((work) => work.id === workId);
  if (!available?.available) return { ok: false, message: available?.reason || "活计不可做" };
  const action = createWorkAction(workId, state);
  if (!action || action.blockedReason) return { ok: false, message: action?.blockedReason || "活计失败" };
  helpers.advance(action.durationMinutes ?? action.remainingMinutes, { routine: true });
  const result = settleWork(state, workId);
  if (Math.random() < (result.forceTrouble ? 1 : (result.eventChance ?? 0) * 0.6)) return { ok: false, message: `${available.name}出了事，需亲自处理` };
  return { ok: true, message: result.message };
}

function runStudy(state, skill, helpers) {
  const option = getStudyOptions(state).find((item) => item.skill === skill && item.available);
  if (!option) return { ok: false, message: "修习条件失效" };
  if (state.player.stamina < option.staminaCost) return { ok: false, message: "体力不足以修习" };
  changeStamina(state.player, -option.staminaCost);
  helpers.advance(option.durationMinutes, { routine: true, studying: true });
  const gained = gainSkill(state.player, option.skill, 1, helpers.dateKey(), { multiplier: option.skill === "wen" ? helpers.wenMultiplier() : 1 });
  return { ok: true, message: `${option.name}${gained ? "+1" : "略过"}` };
}

function runBusiness(state, helpers) {
  const actionDef = getBusinessActions(state).find((item) => item.available && (/^vend:.*:fair$/.test(item.id) || /^shop_vend:/.test(item.id)));
  if (!actionDef) return { ok: false, message: "经营前置失效" };
  const result = createBusinessAction(actionDef.id, state);
  if (!result.ok || !result.action) return { ok: false, message: result.message || "经营失败" };
  helpers.advance(result.action.remainingMinutes, { routine: true });
  const settled = settleBusinessAction(state, result.action);
  if (Math.random() < 0.09) return { ok: false, message: "出摊/开铺事件掷中，需亲自处理" };
  return { ok: true, message: settled.message };
}

function autoTravel(state, destinationId, helpers) {
  if (state.player.location === destinationId) { helpers.advance(60, { routine: true }); return { ok: true, message: "已在此地" }; }
  const route = getRoute(state.player.location, destinationId);
  if (!route) return { ok: false, message: "路线不通" };
  const cost = getTravelStaminaCost(route.minutes);
  if (state.player.stamina < cost) return { ok: false, message: "赶路体力不足" };
  changeStamina(state.player, -cost);
  helpers.advance(route.minutes, { routine: true });
  state.player.location = destinationId;
  return { ok: true, message: `到${destinationId}` };
}

function getBreakReason(state, routine) {
  if (state.player.health < 45) return "健康低于45。";
  if (Array.isArray(state.player.injuries) && state.player.injuries.length > 0) return "身上有伤病。";
  if (state.player.illnesses && Object.values(state.player.illnesses).some((v) => v && typeof v === "object" ? v.active : Boolean(v))) return "患病未愈。";
  if ((state.player.labor?.toll ?? 0) >= 300) return "劳损升档。";
  if (state.player.coins < estimateDailyCost(routine)) return "现金低于当日预计支出。";
  if (state.player.justice?.crime?.cases?.some((item) => item.heard && ["立案", "查办", "缉拿"].includes(item.status))) return "官面案件有新风声。";
  if (routine.breakOnFestival && isFestivalFirstDay(getDateParts(state.clock))) return "节庆首日，停下等你决定。";
  return "";
}

function maybeMakeMonthSummary(state, routine, parts, before, after) {
  if (!routine.monthlySummary || parts.day !== 1) return;
  const monthKey = `${parts.year}-${parts.month}`;
  if (routine.lastMonthSummaryKey === monthKey) return;
  routine.lastMonthSummaryKey = monthKey;
  const recent = routine.logs.slice(-30);
  const text = `起居注：一月按日程度日，收支${after.coins - before.coins}文，身体${after.health >= before.health ? "尚稳" : "转弱"}，大事有${recent.slice(-2).join("；").slice(0, 70) || "无"}。`.slice(0, 120);
  routine.monthReports.push(text);
  routine.monthReports = routine.monthReports.slice(-12);
  state.player.memories = Array.isArray(state.player.memories) ? state.player.memories : [];
  state.player.memories.push({ date: `第${parts.year}年${parts.month}月`, text });
}

function interrupt(routine, message, stop = true) {
  if (stop) routine.running = false;
  routine.interrupt = message;
  pushRoutineLog(routine, `打断：${message}`);
  return { ok: false, message };
}

function pushRoutineLog(routine, line) {
  routine.logs.push(String(line).trim());
  routine.logs = routine.logs.slice(-30);
}

function isFestivalFirstDay(parts) {
  const festival = getActiveFestival(parts);
  return Boolean(festival && festival.month === parts.month && festival.day === parts.day);
}

function snapshot(state) { return { coins: Math.floor(state.player.coins), health: state.player.health }; }
function estimateDailyCost(routine) { return (routine.autoEat ? (routine.mealType === "fine" ? 30 : 10) : 0) + (routine.autoBath ? 5 : 0); }
function normalizeOption(option) { return ROUTINE_OPTIONS.some((item) => item.id === option) ? option : "idle"; }
function optionName(option) { return ROUTINE_OPTIONS.find((item) => item.id === option)?.name ?? "空闲"; }
function clampDay(value) { return Math.max(0, Math.min(30, Math.floor(Number(value) || 0))); }
