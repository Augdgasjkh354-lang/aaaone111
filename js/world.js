export const START_LOCATION_ID = "slum_alley";
export const TRAVEL_STAMINA_PER_10_MINUTES = 2;

export const LOCATIONS = [
  {
    id: "slum_alley",
    name: "贫民巷",
    description: "城南偏僻巷陌里屋檐低矮，主角暂且在此栖身。",
    neighbors: [
      { id: "south_homes", minutes: 10 },
      { id: "city_god_temple", minutes: 20 },
      { id: "rice_market", minutes: 30 },
    ],
  },
  {
    id: "rice_market",
    name: "米市",
    description: "米铺粮船往来不绝，空气里混着谷糠与汗味。",
    neighbors: [
      { id: "qinghefang", minutes: 15 },
      { id: "dock", minutes: 20 },
      { id: "slum_alley", minutes: 30 },
    ],
  },
  {
    id: "qinghefang",
    name: "清河坊",
    description: "商铺沿街排开，药铺、食肆与行商招牌相连。",
    neighbors: [
      { id: "imperial_street", minutes: 10 },
      { id: "rice_market", minutes: 15 },
      { id: "wazi", minutes: 15 },
      { id: "city_god_temple", minutes: 20 },
    ],
  },
  {
    id: "imperial_street",
    name: "御街",
    description: "御街宽阔笔直，车马行人向皇城方向川流不息。",
    neighbors: [
      { id: "qinghefang", minutes: 10 },
      { id: "wazi", minutes: 15 },
      { id: "dock", minutes: 35 },
    ],
  },
  {
    id: "wazi",
    name: "瓦子",
    description: "勾栏瓦舍人声鼎沸，说唱杂戏的锣鼓声不曾停歇。",
    neighbors: [
      { id: "qinghefang", minutes: 15 },
      { id: "imperial_street", minutes: 15 },
      { id: "city_god_temple", minutes: 25 },
    ],
  },
  {
    id: "city_god_temple",
    name: "城隍庙",
    description: "庙前香烟缭绕，摊贩与求签的人挤在石阶两旁。",
    neighbors: [
      { id: "south_homes", minutes: 15 },
      { id: "slum_alley", minutes: 20 },
      { id: "qinghefang", minutes: 20 },
      { id: "wazi", minutes: 25 },
    ],
  },
  {
    id: "dock",
    name: "码头",
    description: "河埠船桅林立，脚夫扛货的号子沿水面传开。",
    neighbors: [
      { id: "rice_market", minutes: 20 },
      { id: "south_homes", minutes: 30 },
      { id: "imperial_street", minutes: 35 },
    ],
  },
  {
    id: "south_homes",
    name: "城南民居",
    description: "城南住户密集，井台旁总有人洗菜闲话。",
    neighbors: [
      { id: "slum_alley", minutes: 10 },
      { id: "city_god_temple", minutes: 15 },
      { id: "dock", minutes: 30 },
    ],
  },
];

const LOCATION_BY_ID = new Map(LOCATIONS.map((location) => [location.id, location]));

export function getLocation(locationId) {
  return LOCATION_BY_ID.get(locationId) ?? LOCATION_BY_ID.get(START_LOCATION_ID);
}

export function getNeighborLocations(locationId) {
  return getLocation(locationId).neighbors.map((route) => ({
    ...route,
    location: getLocation(route.id),
  }));
}

export function getRoute(originId, destinationId) {
  return getLocation(originId).neighbors.find((route) => route.id === destinationId) ?? null;
}

export function getTravelStaminaCost(minutes) {
  return (minutes / 10) * TRAVEL_STAMINA_PER_10_MINUTES;
}
