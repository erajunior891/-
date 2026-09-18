/**
 * Конфигурация аддона «Колизей»
 * Версия: 1.26.51+ (Android / Win / iOS)
 * Поддержка мультиплеера: Да
 */

export const ARENA_CONFIG = {
  // Настройки расположения арены:
  // Если useDynamicCenter = true, центром арены станет место игрока, использовавшего боевой рог.
  // Если false, используются фиксированные координаты fixedCenter.
  useDynamicCenter: true,

  fixedCenter: {
    x: 0,
    y: 65,
    z: 0
  },

  // Радиус арены (в блоках). Все игроки в этом радиусе считаются участниками боя
  arenaRadius: 28,

  // Высота зоны арены (вверх и вниз от центра)
  heightRange: 16,

  // Очищать ли арену от чужих мобов и мусора перед стартом
  cleanArenaBeforeStart: true,

  // Телепортировать ли игроков на арену при старте боя
  teleportPlayersOnStart: false,
  playerTeleportOffset: { x: 0, y: 0, z: 0 },

  // Смещение точек спавна гладиаторов относительно центра арены (ворота арены: Север, Юг, Восток, Запад)
  spawnOffsets: [
    { x: 0, y: 0, z: 18 },   // Северные ворота
    { x: 0, y: 0, z: -18 },  // Южные ворота
    { x: 18, y: 0, z: 0 },   // Восточные ворота
    { x: -18, y: 0, z: 0 },  // Западные ворота
    { x: 12, y: 0, z: 12 },  // Северо-восток
    { x: -12, y: 0, z: 12 }, // Северо-запад
    { x: 12, y: 0, z: -12 }, // Юго-восток
    { x: -12, y: 0, z: -12 } // Юго-запад
  ],

  // Время перерыва между волнами (в секундах)
  intermissionSeconds: 5,

  // Конфигурация 5 основных волн
  waves: [
    {
      waveNumber: 1,
      title: "§eВолна I: Новобранцы Арены§r",
      spawns: [
        { type: "colosseum:gladiator_normal", count: 6 }
      ],
      rewardCoins: 15
    },
    {
      waveNumber: 2,
      title: "§6Волна II: Тяжёлый Авангард§r",
      spawns: [
        { type: "colosseum:gladiator_normal", count: 4 },
        { type: "colosseum:gladiator_heavy", count: 3 }
      ],
      rewardCoins: 30
    },
    {
      waveNumber: 3,
      title: "§cВолна III: Ловкие Стрелки и Бегуны§r",
      spawns: [
        { type: "colosseum:gladiator_fast", count: 4 },
        { type: "colosseum:gladiator_normal", count: 3 },
        { type: "colosseum:gladiator_archer", count: 2 }
      ],
      rewardCoins: 50
    },
    {
      waveNumber: 4,
      title: "§4Волна IV: Элита Колизея§r",
      spawns: [
        { type: "colosseum:gladiator_champion", count: 2 },
        { type: "colosseum:gladiator_archer", count: 4 },
        { type: "colosseum:gladiator_heavy", count: 3 }
      ],
      rewardCoins: 80
    },
    {
      waveNumber: 5,
      title: "§5Волна V: Финальный Триумф (Босс)§r",
      spawns: [
        { type: "colosseum:gladiator_boss", count: 1 },
        { type: "colosseum:gladiator_champion", count: 2 },
        { type: "colosseum:gladiator_fast", count: 4 }
      ],
      rewardCoins: 150,
      rewardTrophy: true
    }
  ],

  // Бесконечный режим после 5 волны
  enableEndlessMode: true
};
