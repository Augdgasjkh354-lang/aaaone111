// Future god-mode hook: worldOverride will eventually feed deterministic overrides through
// chance() and state mutation entry points. It is intentionally inert in this release.
export const worldOverride = {};

export function createLuck(savedLuck) {
  if (Number.isFinite(savedLuck) && savedLuck >= 1 && savedLuck <= 100) return Math.round(savedLuck);
  return Math.max(1, Math.min(100, Math.round(boxMullerNormal(50, 16))));
}

export function chance(baseProb, tag = "neutral", playerOrLuck = null, options = {}) {
  const base = clamp(Number(baseProb) || 0, 0, 1);
  const luck = typeof playerOrLuck === "number" ? playerOrLuck : playerOrLuck?.luck;
  if (!Number.isFinite(luck) || tag === "neutral") return Math.random() < base;
  const span = Number.isFinite(options.maxDelta) ? Math.max(0, options.maxDelta) : null;
  const factor = getLuckFactor(luck, tag);
  const adjusted = span == null ? base * factor : base + clamp((factor - 1) * base, -span, span);
  return Math.random() < clamp(adjusted, 0, 1);
}

export function getLuckBand(luck) {
  if (luck >= 80) return "大吉";
  if (luck >= 60) return "小吉";
  if (luck >= 40) return "平";
  if (luck >= 20) return "小凶";
  return "大凶";
}

export function getDivinationText(player) {
  if ((player.labor?.toll ?? 0) >= 300 && (player.luck ?? 50) < 40) {
    const body = ["签上筋骨二字发沉，先生劝你少扛重物，寒雨日更要护腰。", "卦里土气压身，旧劳未散，莫拿年轻身子当柴烧。"];
    return body[Math.floor(Math.random() * body.length)];
  }
  const pool = DIVINATION_TEXTS[getLuckBand(player.luck)] ?? DIVINATION_TEXTS["平"];
  return pool[Math.floor(Math.random() * pool.length)];
}

function getLuckFactor(luck, tag) {
  const normalized = clamp((luck - 50) / 50, -1, 1);
  const influence = normalized * 0.15;
  if (String(tag).startsWith("good")) return 1 + influence;
  if (String(tag).startsWith("bad")) return 1 - influence;
  return 1;
}

function boxMullerNormal(mean, stdDev) {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const DIVINATION_TEXTS = {
  "大吉": ["签头有青云气，事虽迟，终有贵人扶一把。", "卦上见春水生纹，莫贪急利，正路自有回响。", "今日问来是上平中带吉，凡事留三分，反得七分。"],
  "小吉": ["灯前影不偏，近来小事多顺，远事还须耐烦。", "签语说瓦上霜消，行路虽冷，脚下不滑。", "此卦不许暴富，只许勤里得便宜。"],
  "平": ["签筒无大响，平平二字最难得，守住饭碗便是福。", "卦肆先生说，风从巷中过，不偏不倚，且看自己脚力。", "今日问事，如井水照面，清浊都在自己手里。"],
  "小凶": ["签尾带涩，近来少往热闹处争先，免惹闲气。", "卦上乌云不厚，却遮半月，钱袋须系紧些。", "先生说小坎在前，低头过去，不必硬撞。"],
  "大凶": ["签落无声，先生只说少赌少信生人，归路走亮处。", "卦辞有破耗相，今日莫贪便宜，便宜多有钩子。", "灯花爆冷，凡有人催你快应，十有八九要缓。"],
};
