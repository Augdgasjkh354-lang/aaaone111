import { changeHealth, changeSatiety, changeStamina, getStaminaMax } from "./player.js";

const SATIETY_LOSS_PER_HOUR = 2.4;
const STARVING_HEALTH_LOSS_PER_HOUR = 1;
const AWAKE_STAMINA_LOSS_PER_HOUR = 1.2;
const SLEEP_STAMINA_RECOVER_PER_HOUR = 18;

export function applyMetabolism(player, gameMinutes, { sleeping = false } = {}) {
  if (gameMinutes <= 0 || player.health <= 0) return;

  const hours = gameMinutes / 60;
  // 饱腹随游戏时间持续下降，睡觉也会变饿。
  changeSatiety(player, -SATIETY_LOSS_PER_HOUR * hours);

  if (sleeping) {
    player.stamina = Math.min(getStaminaMax(player), player.stamina + SLEEP_STAMINA_RECOVER_PER_HOUR * hours);
  } else {
    changeStamina(player, -AWAKE_STAMINA_LOSS_PER_HOUR * hours);
  }

  // 本阶段只实现饥饿造成的死亡链路。
  if (player.satiety < 15) {
    changeHealth(player, -STARVING_HEALTH_LOSS_PER_HOUR * hours);
  }
}

export function getDeath(player) {
  if (player.health > 0) return null;
  return {
    reason: getDeathReason(player),
  };
}

function getDeathReason(player) {
  if (player.identity === "进士(待阙)") return "进士候阙未久，竟困饿病死临安。坊巷与士林说起，皆叹一个已传胪唱名的人没等到注官。";
  if (player.identity === "得解士子" || player.scholar?.hadJie) return "曾得解的士子困饿而死。贫巷记得他登过解榜，士林也知这份分量，死讯便不只是无名饿殍。";
  return "你饿死了。";
}
