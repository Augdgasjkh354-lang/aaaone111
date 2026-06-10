import { formatClock, SPEEDS, getSurvivedDays } from "./clock.js";
import { describeHealth, describeSatiety, describeStamina } from "./player.js";

export function bindControls(handlers) {
  document.getElementById("speedSelect").addEventListener("change", (event) => {
    handlers.onSpeedChange(Number(event.target.value));
  });

  document.getElementById("pauseButton").addEventListener("click", handlers.onTogglePause);
  document.getElementById("restartButton").addEventListener("click", handlers.onRestart);
  document.getElementById("deathRestartButton").addEventListener("click", handlers.onRestart);

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handlers.onAction(button.dataset.action));
  });
}

export function render(state) {
  renderTime(state);
  renderPlayer(state);
  renderActions(state);
  renderDeath(state);
}

function renderTime(state) {
  const { dateText, timeText } = formatClock(state.clock);
  document.getElementById("dateLine").textContent = dateText;
  document.getElementById("timeLine").textContent = timeText;

  const speedSelect = document.getElementById("speedSelect");
  speedSelect.value = String(state.clock.speedIndex);
  speedSelect.title = SPEEDS[state.clock.speedIndex]?.label ?? "一档";

  document.getElementById("pauseButton").textContent = state.clock.paused ? "继续" : "暂停";
}

function renderPlayer(state) {
  const { player } = state;
  document.getElementById("statusGrid").innerHTML = `
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

function renderActions(state) {
  const busy = Boolean(state.currentAction) || state.dead;
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = busy;
  });

  const note = document.getElementById("actionNote");
  if (state.dead) {
    note.textContent = "一切行动都已停止。";
  } else if (state.currentAction) {
    note.textContent = `${state.currentAction.label}中，尚余约 ${Math.ceil(state.currentAction.remainingMinutes)} 分钟。`;
  } else {
    note.textContent = state.message || "请选择接下来做什么。";
  }
}

function renderDeath(state) {
  const overlay = document.getElementById("deathOverlay");
  overlay.classList.toggle("hidden", !state.dead);
  if (!state.dead) return;

  document.getElementById("deathReason").textContent = state.deathReason || "你饿死了。";
  document.getElementById("survivalDays").textContent = `存活 ${getSurvivedDays(state.clock)} 天`;
}
