import { formatClock, SPEEDS, getSurvivedDays, getMinuteOfDay, getPeriod, getDateParts } from "./clock.js";
import { describeHealth, describeSatiety, describeStamina } from "./player.js";
import { getLocation, getNeighborLocations, getTravelStaminaCost } from "./world.js";
import { getAuditLog } from "./guard.js";
import { getNpcDisplayName, getPlayerDebtLines, getPresentNpcs } from "./npcs.js";
import { getAvailableWorks } from "./work.js";
import { getBusinessActions, getBusinessLedger } from "./business.js";
import { getPurchasableItems } from "./items.js";
import { describeIllnesses } from "./illness.js";
import { getSkillSummary, getStudyOptions } from "./skills.js";
import { getRiceDouPrice } from "./worldtick.js";
import { getSeasonByMonth } from "./season.js";
import { isFestivalGamblingLegal } from "./festival.js";
import { getActiveNeighborStatuses } from "./neighborchain.js";
import { canApplyHouseholdRegistration } from "./identity.js";
import { getExamTimelineText } from "./scholar.js";
import { getJusticeActions, getJusticeLedgerLines } from "./justice.js";
import { ROUTINE_OPTIONS, ROUTINE_PERIODS, getRoutineLogLines } from "./routine.js";
import { getTianjiLog, isTianjiEnabled } from "./tianji.js";

export function bindControls(handlers) {
  document.getElementById("speedSelect").addEventListener("change", (event) => {
    handlers.onSpeedChange(Number(event.target.value));
  });

  document.getElementById("pauseButton").addEventListener("click", handlers.onTogglePause);
  document.getElementById("restartButton").addEventListener("click", handlers.onRestart);
  document.getElementById("deathRestartButton").addEventListener("click", handlers.onRestart);
  document.getElementById("travelToggleButton").addEventListener("click", handlers.onToggleTravel);
  document.getElementById("cancelTravelButton").addEventListener("click", handlers.onCancelTravel);
  bindTianjiMark(handlers);
  document.getElementById("settingsButton").addEventListener("click", handlers.onOpenSettings);
  document.getElementById("closeSettingsButton").addEventListener("click", handlers.onCloseSettings);
  document.getElementById("saveSettingsButton").addEventListener("click", () => {
    handlers.onSaveSettings({
      apiKey: document.getElementById("apiKeyInput").value,
      mode: document.getElementById("thinkingModeSelect").value,
    });
  });
  document.getElementById("housingSelect").addEventListener("change", (event) => {
    handlers.onHousingChange(event.target.value);
  });
  document.getElementById("viewAuditLogButton").addEventListener("click", handlers.onViewAuditLog);
  document.getElementById("neighborStatusButton").addEventListener("click", handlers.onViewNeighborStatus);
  document.getElementById("businessLedgerButton").addEventListener("click", handlers.onViewBusinessLedger);
  document.getElementById("justiceButton").addEventListener("click", handlers.onViewJustice);
  document.getElementById("routineButton").addEventListener("click", handlers.onViewRoutine);
  document.getElementById("tianjiPanelButton").addEventListener("click", handlers.onViewTianji);
  document.getElementById("closeTianjiButton").addEventListener("click", handlers.onCloseTianji);
  document.getElementById("restoreTianjiButton").addEventListener("click", handlers.onRestoreTianji);
  document.getElementById("saveRoutineButton").addEventListener("click", () => handlers.onSaveRoutine(readRoutineForm()));
  document.getElementById("startRoutineButton").addEventListener("click", () => handlers.onStartRoutine(Number(document.getElementById("routineDaysInput").value || 30)));
  document.getElementById("stopRoutineButton").addEventListener("click", handlers.onStopRoutine);
  document.getElementById("householdRegistrationButton").addEventListener("click", handlers.onHouseholdRegistration);
  document.getElementById("studyToggleButton").addEventListener("click", handlers.onToggleStudy);
  document.getElementById("purchaseToggleButton").addEventListener("click", handlers.onTogglePurchase);
  document.getElementById("repairToggleButton").addEventListener("click", handlers.onToggleRepair);
  document.getElementById("inventoryButton").addEventListener("click", () => document.getElementById("inventoryList").classList.toggle("hidden"));

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handlers.onAction(button.dataset.action));
  });

  document.getElementById("travelList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-destination]");
    if (!button || button.disabled) return;
    handlers.onTravel(button.dataset.destination);
  });

  document.getElementById("workList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-work], [data-business], [data-justice]");
    if (!button || button.disabled) return;
    if (button.dataset.business) handlers.onBusiness(button.dataset.business);
    else if (button.dataset.justice) handlers.onJustice(button.dataset.justice);
    else handlers.onWork(button.dataset.work);
  });
  document.getElementById("studyList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-study]");
    if (!button || button.disabled) return;
    handlers.onStudy(button.dataset.study);
  });
  document.getElementById("purchaseList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-purchase]");
    if (!button || button.disabled) return;
    handlers.onPurchase(button.dataset.purchase);
  });
  document.getElementById("repairList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-repair]");
    if (!button || button.disabled) return;
    handlers.onRepair(button.dataset.repair);
  });

  document.getElementById("freeActionForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("freeActionInput");
    handlers.onFreeAction(input.value);
  });

  document.getElementById("freeActionInput").addEventListener("input", (event) => {
    document.getElementById("freeActionButton").disabled = event.target.value.trim().length === 0;
  });
}

function bindTianjiMark(handlers) {
  const mark = document.getElementById("tianjiMark");
  let timer = null;
  let longPressed = false;
  const clear = () => { if (timer) window.clearTimeout(timer); timer = null; };
  const start = (event) => {
    event.preventDefault();
    longPressed = false;
    clear();
    timer = window.setTimeout(() => { longPressed = true; handlers.onTianjiLongPress(); }, 3000);
  };
  const end = (event) => {
    event.preventDefault();
    clear();
  };
  mark.addEventListener("pointerdown", start);
  mark.addEventListener("pointerup", end);
  mark.addEventListener("pointerleave", end);
  mark.addEventListener("pointercancel", end);
  mark.addEventListener("click", (event) => {
    event.preventDefault();
    if (longPressed) return;
    handlers.onTianjiClick();
  });
}

export function render(state) {
  renderTime(state);
  renderPlayer(state);
  renderStoryLog(state);
  renderActions(state);
  renderSettings(state);
  renderTianjiMark(state);
  renderDeath(state);
}

function renderTime(state) {
  const { dateText, timeText } = formatClock(state.clock);
  document.getElementById("dateLine").textContent = dateText;
  const { month } = getDateParts(state.clock);
  document.getElementById("timeLine").textContent = `${timeText} · ${getSeasonByMonth(month)} · ${getExamTimelineText(state.player)}`;

  const speedSelect = document.getElementById("speedSelect");
  speedSelect.value = String(state.clock.speedIndex);
  speedSelect.title = SPEEDS[state.clock.speedIndex]?.label ?? "一档";
  speedSelect.disabled = state.storyLoading;

  const pauseButton = document.getElementById("pauseButton");
  pauseButton.textContent = state.clock.paused ? "继续" : "暂停";
  pauseButton.disabled = state.storyLoading;

  document.getElementById("settingsButton").disabled = state.storyLoading;
  document.getElementById("restartButton").disabled = state.storyLoading;
}

function renderPlayer(state) {
  const { player } = state;
  const location = getLocation(player.location);
  const injuries = Array.isArray(player.injuries) && player.injuries.length > 0 ? player.injuries.join("、") : "无";
  const presentNpcs = getPresentNpcs(state.npcs, location.id, getPeriod(getMinuteOfDay(state.clock)));
  const presentNpcText = presentNpcs.length > 0
    ? presentNpcs.map((npc) => getNpcDisplayName(npc)).join("、")
    : "无人留意";
  const debtLines = getPlayerDebtLines(state.npcs);
  const inventoryNames = player.inventory.length > 0 ? player.inventory.map((item) => item.name).join("、") : "无";
  const locationDescription = location.id === "rice_market"
    ? `${location.description} 今日米价：斗米${getRiceDouPrice(state.world)}文。`
    : location.description;
  document.getElementById("statusGrid").innerHTML = `
    <article class="status-item location-item">
      <div class="status-label">当前位置</div>
      <div class="status-value">${escapeHtml(location.name)}</div>
      <div class="status-description">${escapeHtml(locationDescription)}</div>
      <div class="status-description">此处有：${escapeHtml(presentNpcText)}</div>
      <div class="status-description">身份：${escapeHtml(player.identity)}</div>
      <div class="status-description">住所：${escapeHtml(player.housing)}</div>
      <div class="status-description">衣着：${escapeHtml(player.clothing)}；整洁：${getCleanlinessText(player.cleanliness)}</div>
      <div class="status-description">能力：${escapeHtml(getSkillSummary(player.skills))}</div>
      <div class="status-description">随身：${escapeHtml(inventoryNames)}</div>
      <div class="status-description">${debtLines.length > 0 ? escapeHtml(debtLines.join("、")) : "债务：无"}</div>
    </article>
    <article class="status-item">
      <div class="status-label">饱腹</div>
      <div class="status-value">${describeSatiety(player.satiety)}</div>
    </article>
    <article class="status-item">
      <div class="status-label">体力</div>
      <div class="status-value">${describeStamina(player.stamina)}</div>
    </article>
    <article class="status-item">
      <div class="status-label">健康</div>
      <div class="status-value">${describeHealth(player.health)}</div>
      <div class="status-description">伤病：${escapeHtml(injuries)}</div>
      <div class="status-description">疾病：${escapeHtml(describeIllnesses(player))}</div>
    </article>
  `;

  document.getElementById("moneyRow").innerHTML = `
    <article class="money-item">
      <div class="money-label">铜钱</div>
      <div class="money-value">${Math.floor(player.coins)} 文</div>
    </article>
    <article class="money-item">
      <div class="money-label">银两</div>
      <div class="money-value">${player.silver}</div>
    </article>
    <article class="money-item">
      <div class="money-label">会子</div>
      <div class="money-value">${player.huizi}</div>
    </article>
  `;
}

function renderStoryLog(state) {
  const log = document.getElementById("storyLog");
  const entries = Array.isArray(state.storyLog) ? state.storyLog : [];
  log.innerHTML = entries.length > 0
    ? entries.map((scene) => `<p>${escapeHtml(scene)}</p>`).join("")
    : `<p class="empty-story">故事尚未展开。</p>`;
  log.scrollTop = log.scrollHeight;
}

function renderActions(state) {
  const busy = Boolean(state.currentAction) || state.dead || state.storyLoading;
  const traveling = state.currentAction?.type === "travel";

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = busy;
  });
  ["studyToggleButton", "purchaseToggleButton", "repairToggleButton", "inventoryButton"].forEach((id) => {
    document.getElementById(id).disabled = busy;
  });

  renderTravelControls(state, busy, traveling);
  renderWorkControls(state, busy);
  renderStudyControls(state, busy);
  renderPurchaseControls(state, busy);
  renderRepairControls(state, busy);
  renderInventory(state);
  renderFreeAction(state, busy);

  const note = document.getElementById("actionNote");
  if (state.dead) {
    note.textContent = "一切行动都已停止。";
  } else if (state.storyLoading) {
    note.textContent = "……";
  } else if (traveling) {
    const destination = getLocation(state.currentAction.destinationId);
    note.textContent = `前往${destination.name}…还需 ${Math.ceil(state.currentAction.remainingMinutes)} 分钟。`;
  } else if (state.currentAction) {
    note.textContent = `${state.currentAction.label}中，尚余约 ${Math.ceil(state.currentAction.remainingMinutes)} 分钟。`;
  } else {
    note.textContent = state.message || "请选择接下来做什么。";
  }
}

function renderWorkControls(state, busy) {
  const workList = document.getElementById("workList");
  workList.classList.toggle("hidden", !state.workOpen || busy);
  if (!state.workOpen || busy) {
    workList.innerHTML = "";
    return;
  }

  const workButtons = getAvailableWorks(state).map((work) => `
    <button type="button" data-work="${work.id}" ${work.available ? "" : "disabled"} title="${escapeHtml(work.reason || work.description)}">
      <span>${escapeHtml(work.name)}</span>
      <small>${work.durationMinutes / 60}小时 · ${work.available ? escapeHtml(work.description) : escapeHtml(work.reason)}</small>
    </button>
  `);
  const businessButtons = getBusinessActions(state).map((action) => `
    <button type="button" data-business="${action.id}" ${action.available ? "" : "disabled"} title="${escapeHtml(action.reason || action.description)}">
      <span>${escapeHtml(action.name)}</span>
      <small>${action.available ? escapeHtml(action.description) : escapeHtml(action.reason)}</small>
    </button>
  `);
  const justiceButtons = getJusticeActions(state).map((action) => `
    <button type="button" data-justice="${action.id}" ${action.available ? "" : "disabled"} title="${escapeHtml(action.reason || action.description)}">
      <span>${escapeHtml(action.name)}</span>
      <small>${action.available ? escapeHtml(action.description) : escapeHtml(action.reason)}</small>
    </button>
  `);
  workList.innerHTML = [...workButtons, ...businessButtons, ...justiceButtons].join("");
}

function renderStudyControls(state, busy) {
  const list = document.getElementById("studyList");
  list.classList.toggle("hidden", !state.studyOpen || busy);
  if (!state.studyOpen || busy) { list.innerHTML = ""; return; }
  list.innerHTML = getStudyOptions(state).map((item) => `
    <button type="button" data-study="${item.id}" ${item.available ? "" : "disabled"}>
      <span>${escapeHtml(item.name)}</span><small>${item.durationMinutes / 60}小时 · ${item.available ? "修习进度" : escapeHtml(item.reason)}</small>
    </button>`).join("");
}

function renderPurchaseControls(state, busy) {
  const list = document.getElementById("purchaseList");
  list.classList.toggle("hidden", !state.purchaseOpen || busy);
  if (!state.purchaseOpen || busy) { list.innerHTML = ""; return; }
  const items = getPurchasableItems(state.player.location);
  list.innerHTML = items.length > 0 ? items.map((item) => `
    <button type="button" data-purchase="${item.id}" ${state.player.coins >= item.price ? "" : "disabled"}>
      <span>${escapeHtml(item.vendor)}：${escapeHtml(item.name)}</span><small>${item.price}文</small>
    </button>`).join("") : "<p>此地无可购置之物。</p>";
}

function renderRepairControls(state, busy) {
  const list = document.getElementById("repairList");
  list.classList.toggle("hidden", !state.repairOpen || busy);
  if (!state.repairOpen || busy) { list.innerHTML = ""; return; }
  const gambleOpen = isFestivalGamblingLegal(getDateParts(state.clock), state.player.location);
  const gambleButtons = [10, 50, 100, 500].map((bet) => `<button type="button" data-repair="gamble_${bet}" ${gambleOpen && state.player.coins >= bet ? "" : "disabled"}><span>关扑${bet}文</span><small>${gambleOpen ? "胜得双倍" : "节庆或瓦子开放"}</small></button>`).join("");
  list.innerHTML = `
    <button type="button" data-repair="river_bath" ${state.player.location === "dock" ? "" : "disabled"}><span>河边洗澡</span><small>2小时 · 免费</small></button>
    <button type="button" data-repair="bathhouse" ${state.player.location === "qinghefang" && state.player.coins >= 5 ? "" : "disabled"}><span>浴堂洗澡</span><small>1小时 · 5文</small></button>
    <button type="button" data-repair="divination" ${state.player.location === "city_god_temple" && state.player.coins >= 10 ? "" : "disabled"}><span>卦肆问卜</span><small>1小时 · 10文</small></button>
    ${gambleButtons}
    <button type="button" data-repair="massage"><span>推拿将养</span><small>需安郎中在场 · 150文</small></button>
    <button type="button" data-repair="doctor"><span>求医</span><small>需安郎中在场</small></button>`;
}

function renderInventory(state) {
  const list = document.getElementById("inventoryList");
  const items = state.player.inventory;
  list.innerHTML = items.length > 0 ? items.map((item) => `<p>${escapeHtml(item.name)}：${escapeHtml(item.desc || item.kind)}</p>`).join("") : "<p>背包空空。</p>";
}

function renderFreeAction(state, busy) {
  const form = document.getElementById("freeActionForm");
  const input = document.getElementById("freeActionInput");
  const button = document.getElementById("freeActionButton");
  form.classList.toggle("hidden", Boolean(state.player.routine?.running) && !isTianjiEnabled(state.player));
  input.disabled = busy;
  button.disabled = busy || input.value.trim().length === 0;
  button.textContent = state.storyLoading ? "……" : (isTianjiEnabled(state.player) ? "天机" : "行动");
  input.placeholder = isTianjiEnabled(state.player) ? "天机已开：例如，把我的铜钱设为一千文" : "例如：我去米市看看粮价";
}

function renderTravelControls(state, busy, traveling) {
  const toggleButton = document.getElementById("travelToggleButton");
  const travelList = document.getElementById("travelList");
  const cancelButton = document.getElementById("cancelTravelButton");

  toggleButton.disabled = busy;
  toggleButton.textContent = state.travelOpen ? "收起出行" : "出行";
  travelList.classList.toggle("hidden", !state.travelOpen || busy);
  cancelButton.classList.toggle("hidden", !traveling);
  cancelButton.disabled = state.dead || state.storyLoading;

  if (traveling || !state.travelOpen || state.dead) {
    travelList.innerHTML = "";
    return;
  }

  const neighbors = getNeighborLocations(state.player.location);
  travelList.innerHTML = neighbors.map((route) => {
    const staminaCost = getTravelStaminaCost(route.minutes);
    const disabled = state.player.stamina < staminaCost;
    const title = disabled ? `体力不足，需${staminaCost}体力` : `步行${route.minutes}分钟`;
    return `
      <button type="button" data-destination="${route.id}" ${disabled ? "disabled" : ""} title="${title}">
        <span>${escapeHtml(route.location.name)}</span>
        <small>${route.minutes}分钟${disabled ? " · 体力不足" : ""}</small>
      </button>
    `;
  }).join("");
}

function renderSettings(state) {
  const overlay = document.getElementById("settingsOverlay");
  const wasHidden = overlay.classList.contains("hidden");
  overlay.classList.toggle("hidden", !state.settingsOpen);
  if (!state.settingsOpen) return;

  if (wasHidden) {
    document.getElementById("apiKeyInput").value = state.storySettings.apiKey || "";
    document.getElementById("thinkingModeSelect").value = state.storySettings.mode || "disabled";
  }
  document.getElementById("housingSelect").value = state.player.housing;
  const registrationGate = canApplyHouseholdRegistration(state);
  const registrationButton = document.getElementById("householdRegistrationButton");
  registrationButton.classList.toggle("hidden", !registrationGate.ok);
  registrationButton.disabled = !registrationGate.ok;
  registrationButton.title = registrationGate.ok ? "满足条件，办理需3日" : registrationGate.reason;
  document.querySelector('#housingSelect option[value="破庙"]').disabled = !state.player.unlockedHousing?.temple;
  renderNeighborStatus(state);
  renderBusinessLedger(state);
  renderJustice(state);
  renderRoutine(state);
  renderTianjiPanel(state);
  renderAuditLog(state);
}


function renderTianjiMark(state) {
  const mark = document.getElementById("tianjiMark");
  const enabled = isTianjiEnabled(state.player);
  mark.classList.toggle("enabled", enabled);
  mark.textContent = enabled ? "天机" : "天机";
  mark.title = enabled ? "天机已开：点击入天机页，长按三秒关闭" : "长按三秒开启天机";
}

function renderTianjiPanel(state) {
  const panel = document.getElementById("tianjiPanel");
  panel.classList.toggle("hidden", !state.showTianji);
  if (!state.showTianji) return;
  const tianji = state.player.tianji || {};
  document.getElementById("tianjiStatus").textContent = tianji.enabled ? "朱红常亮：天机已开。自由输入将改走天机管线。" : "天机未开。长按右上天机印三秒启闭。";
  document.getElementById("closeTianjiButton").textContent = tianji.enabled ? "关闭天机" : "开启天机";
  document.getElementById("tianjiReceipt").textContent = tianji.lastReceipt || "天机无声。";
  const entries = getTianjiLog().slice().reverse();
  document.getElementById("tianjiLog").innerHTML = entries.length ? entries.map((entry) => `
    <article class="audit-entry"><time>${escapeHtml(entry.timestamp)}</time><pre>原文：${escapeHtml(entry.raw)}\n解析：${escapeHtml(JSON.stringify(entry.parsed))}\n结果：${escapeHtml(JSON.stringify(entry.results))}</pre></article>
  `).join("") : "<p>暂无天机录。</p>";
}

function renderNeighborStatus(state) {
  const log = document.getElementById("neighborStatusLog");
  log.classList.toggle("hidden", !state.showNeighborStatus);
  if (!state.showNeighborStatus) return;
  const statuses = getActiveNeighborStatuses(state.world);
  log.innerHTML = statuses.length > 0
    ? statuses.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
    : `<p>街坊眼下无急事。</p>`;
}

function renderBusinessLedger(state) {
  const log = document.getElementById("businessLedgerLog");
  log.classList.toggle("hidden", !state.showBusinessLedger);
  if (!state.showBusinessLedger) return;
  log.innerHTML = getBusinessLedger(state).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function renderJustice(state) {
  const log = document.getElementById("justiceLog");
  log.classList.toggle("hidden", !state.showJustice);
  if (!state.showJustice) return;
  log.innerHTML = getJusticeLedgerLines(state).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function renderRoutine(state) {
  const panel = document.getElementById("routinePanel");
  panel.classList.toggle("hidden", !state.showRoutine);
  if (!state.showRoutine) return;
  const routine = state.player.routine;
  document.getElementById("routineAutoEat").checked = routine.autoEat;
  document.getElementById("routineMealType").value = routine.mealType;
  document.getElementById("routineAutoSleep").checked = routine.autoSleep;
  document.getElementById("routineAutoBath").checked = routine.autoBath;
  document.getElementById("routineAutoDues").checked = routine.autoDues;
  document.getElementById("routineBreakFestival").checked = routine.breakOnFestival;
  document.getElementById("routineMonthlySummary").checked = routine.monthlySummary;
  ROUTINE_PERIODS.forEach((period) => {
    const select = document.getElementById(`routineSchedule${period}`);
    select.innerHTML = ROUTINE_OPTIONS.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
    select.value = routine.schedule?.[period] || "idle";
  });
  document.getElementById("routineLog").innerHTML = getRoutineLogLines(state.player).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function readRoutineForm() {
  const patch = {
    autoEat: document.getElementById("routineAutoEat").checked,
    mealType: document.getElementById("routineMealType").value,
    autoSleep: document.getElementById("routineAutoSleep").checked,
    autoBath: document.getElementById("routineAutoBath").checked,
    autoDues: document.getElementById("routineAutoDues").checked,
    breakOnFestival: document.getElementById("routineBreakFestival").checked,
    monthlySummary: document.getElementById("routineMonthlySummary").checked,
  };
  ROUTINE_PERIODS.forEach((period) => { patch[`schedule_${period}`] = document.getElementById(`routineSchedule${period}`).value; });
  return patch;
}

function renderAuditLog(state) {
  const log = document.getElementById("auditLog");
  log.classList.toggle("hidden", !state.showAuditLog);
  if (!state.showAuditLog) return;

  const entries = getAuditLog(state).slice().reverse();
  log.innerHTML = entries.length > 0
    ? entries.map((entry) => `
      <article class="audit-entry">
        <time>${escapeHtml(entry.timestamp)}</time>
        <pre>原始：${escapeHtml(JSON.stringify(entry.raw))}\n允许：${escapeHtml(JSON.stringify(entry.applied))}\n最终：${escapeHtml(JSON.stringify(entry.final_applied ?? entry.applied))}</pre>
      </article>
    `).join("")
    : `<p>暂无审计日志。</p>`;
}

function renderDeath(state) {
  const overlay = document.getElementById("deathOverlay");
  overlay.classList.toggle("hidden", !state.dead);
  if (!state.dead) return;

  document.getElementById("deathReason").textContent = state.deathReason || "你饿死了。";
  document.getElementById("survivalDays").textContent = `存活 ${getSurvivedDays(state.clock)} 天`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[char]));
}

function getCleanlinessText(value) {
  if (value < 25) return "蓬头垢面";
  if (value < 50) return "风尘仆仆";
  if (value <= 80) return "还算干净";
  return "清爽整洁";
}
