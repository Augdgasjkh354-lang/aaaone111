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
    reason: "你饿死了。",
  };
}
