import { formatClock, SPEEDS, getSurvivedDays, getMinuteOfDay, getPeriod, getDateParts } from "./clock.js";
import { describeHealth, describeSatiety, describeStamina } from "./player.js";
import { getLocation, getNeighborLocations, getTravelStaminaCost } from "./world.js";
import { getAuditLog } from "./guard.js";
import { getNpcDisplayName, getPlayerDebtLines, getPresentNpcs } from "./npcs.js";
import { getAvailableWorks } from "./work.js";
import { getPurchasableItems } from "./items.js";
import { describeIllnesses } from "./illness.js";
import { getSkillSummary, getStudyOptions } from "./skills.js";
import { getRiceDouPrice } from "./worldtick.js";
import { getSeasonByMonth } from "./season.js";

export function bindControls(handlers) {
  document.getElementById("speedSelect").addEventListener("change", (event) => {
    handlers.onSpeedChange(Number(event.target.value));
  });

  document.getElementById("pauseButton").addEventListener("click", handlers.onTogglePause);
  document.getElementById("restartButton").addEventListener("click", handlers.onRestart);
  document.getElementById("deathRestartButton").addEventListener("click", handlers.onRestart);
  document.getElementById("travelToggleButton").addEventListener("click", handlers.onToggleTravel);
  document.getElementById("cancelTravelButton").addEventListener("click", handlers.onCancelTravel);
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
    const button = event.target.closest("[data-work]");
    if (!button || button.disabled) return;
    handlers.onWork(button.dataset.work);
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

export function render(state) {
  renderTime(state);
  renderPlayer(state);
  renderStoryLog(state);
  renderActions(state);
  renderSettings(state);
  renderDeath(state);
}

function renderTime(state) {
  const { dateText, timeText } = formatClock(state.clock);
  document.getElementById("dateLine").textContent = dateText;
  const { month } = getDateParts(state.clock);
  document.getElementById("timeLine").textContent = `${timeText} · ${getSeasonByMonth(month)}`;

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

  workList.innerHTML = getAvailableWorks(state).map((work) => `
    <button type="button" data-work="${work.id}" ${work.available ? "" : "disabled"} title="${escapeHtml(work.reason || work.description)}">
      <span>${escapeHtml(work.name)}</span>
      <small>${work.durationMinutes / 60}小时 · ${work.available ? escapeHtml(work.description) : escapeHtml(work.reason)}</small>
    </button>
  `).join("");
}

function renderStudyControls(state, busy) {
  const list = document.getElementById("studyList");
  list.classList.toggle("hidden", !state.studyOpen || busy);
  if (!state.studyOpen || busy) { list.innerHTML = ""; return; }
  list.innerHTML = getStudyOptions(state).map((item) => `
    <button type="button" data-study="${item.id}" ${item.available ? "" : "disabled"}>
      <span>${escapeHtml(item.name)}</span><small>${item.durationMinutes / 60}小时 · ${item.available ? "能力+1" : escapeHtml(item.reason)}</small>
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
  list.innerHTML = `
    <button type="button" data-repair="river_bath" ${state.player.location === "dock" ? "" : "disabled"}><span>河边洗澡</span><small>2小时 · 免费</small></button>
    <button type="button" data-repair="bathhouse" ${state.player.location === "qinghefang" && state.player.coins >= 5 ? "" : "disabled"}><span>浴堂洗澡</span><small>1小时 · 5文</small></button>
    <button type="button" data-repair="doctor"><span>求医</span><small>需安郎中在场</small></button>`;
}

function renderInventory(state) {
  const list = document.getElementById("inventoryList");
  const items = state.player.inventory;
  list.innerHTML = items.length > 0 ? items.map((item) => `<p>${escapeHtml(item.name)}：${escapeHtml(item.desc || item.kind)}</p>`).join("") : "<p>背包空空。</p>";
}

function renderFreeAction(state, busy) {
  const input = document.getElementById("freeActionInput");
  const button = document.getElementById("freeActionButton");
  input.disabled = busy;
  button.disabled = busy || input.value.trim().length === 0;
  button.textContent = state.storyLoading ? "……" : "行动";
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
  document.querySelector('#housingSelect option[value="破庙"]').disabled = !state.player.unlockedHousing?.temple;
  renderAuditLog(state);
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
