/**
 * Мультиплеерный менеджер Колизея: волны, арена, спавн и контроль состояния
 */
import { world, system } from "@minecraft/server";
import { ARENA_CONFIG } from "./config.js";
import { EconomyManager } from "./economy.js";
import { GladiatorAIController } from "./gladiator_ai_controller.js";

export class ArenaManager {
  constructor() {
    this.status = "IDLE"; // IDLE, STARTING, WAVE_ACTIVE, INTERMISSION, VICTORY, DEFEAT
    this.currentWaveIndex = 0;
    this.center = { ...ARENA_CONFIG.fixedCenter };
    this.dimension = null;
    this.activeGladiatorIds = new Set();
    this.aiController = new GladiatorAIController();
    this.intermissionTimer = 0;
    this.totalKills = 0;
    /** @type {Set<string>} Имена игроков, участвующих в бою с момента старта */
    this.fightParticipants = new Set();
    /** @type {Set<string>} Имена игроков, присутствовавших на арене в начале текущей волны */
    this.waveParticipants = new Set();
  }

  /**
   * Находится ли точка внутри границ арены
   */
  isInsideArena(location) {
    if (!this.center) return false;
    const dx = location.x - this.center.x;
    const dz = location.z - this.center.z;
    const dy = Math.abs(location.y - this.center.y);
    const dist2D = Math.sqrt(dx * dx + dz * dz);
    return dist2D <= ARENA_CONFIG.arenaRadius && dy <= ARENA_CONFIG.heightRange;
  }

  /**
   * Получить всех живых игроков внутри арены
   */
  getArenaPlayers() {
    if (!this.dimension) return [];
    try {
      const players = this.dimension.getPlayers();
      return players.filter((player) => {
        if (!player.isValid()) return false;
        const health = player.getComponent("health");
        const isAlive = health ? health.currentValue > 0 : true;
        return isAlive && this.isInsideArena(player.location);
      });
    } catch (e) {
      console.warn(`Ошибка получения игроков арены: ${e}`);
      return [];
    }
  }

  /**
   * Получить игроков, имеющих право на награду за волну
   * (только те, кто был на арене в начале волны И находится на арене сейчас)
   */
  getRewardEligiblePlayers() {
    const arenaPlayers = this.getArenaPlayers();
    return arenaPlayers.filter((p) => this.waveParticipants.has(p.name));
  }

  /**
   * Полная очистка арены от мобов и выпавших предметов
   * Удаляет ВСЕ враждебные сущности, а не только гладиаторов
   */
  cleanArena() {
    if (!this.dimension) return;

    try {
      const entities = this.dimension.getEntities();
      for (const ent of entities) {
        if (!ent.isValid() || ent.typeId === "minecraft:player") continue;

        if (this.isInsideArena(ent.location)) {
          // Удаляем предметы на земле
          if (ent.typeId === "minecraft:item") {
            ent.remove();
            continue;
          }
          // Удаляем всех гладиаторов (наших кастомных мобов)
          if (ent.typeId.startsWith("colosseum:gladiator_")) {
            ent.remove();
            continue;
          }
          // Удаляем любых враждебных мобов (семейство monster или список hostile)
          try {
            if (typeof ent.matches === "function" && ent.matches({ families: ["monster"] })) {
              ent.remove();
              continue;
            }
            const familyComp = ent.getComponent("minecraft:type_family") || ent.getComponent("type_family");
            if (familyComp && typeof familyComp.getTypeFamilies === "function") {
              if (familyComp.getTypeFamilies().includes("monster")) {
                ent.remove();
                continue;
              }
            }
            // Резервный список ванильных враждебных сущностей
            const HOSTILE_MOBS = [
              "minecraft:zombie", "minecraft:skeleton", "minecraft:creeper", "minecraft:spider",
              "minecraft:cave_spider", "minecraft:witch", "minecraft:enderman", "minecraft:slime",
              "minecraft:magma_cube", "minecraft:phantom", "minecraft:drowned", "minecraft:husk",
              "minecraft:stray", "minecraft:pillager", "minecraft:vindicator", "minecraft:ravager",
              "minecraft:evoker", "minecraft:vex", "minecraft:warden", "minecraft:zombified_piglin",
              "minecraft:hoglin", "minecraft:zoglin", "minecraft:piglin_brute", "minecraft:breeze",
              "minecraft:bogged"
            ];
            if (HOSTILE_MOBS.includes(ent.typeId)) {
              ent.remove();
              continue;
            }
          } catch (_) {
            // Игнорируем ошибки для отдельных сущностей
          }
        }
      }
    } catch (e) {
      console.warn(`Ошибка очистки арены: ${e}`);
    }

    this.activeGladiatorIds.clear();
    this.aiController.clearAll();
  }

  /**
   * Сбросить все участники боя при завершении
   */
  resetFight() {
    this.activeGladiatorIds.clear();
    this.aiController.clearAll();
    this.fightParticipants.clear();
    this.waveParticipants.clear();
    this.currentWaveIndex = 0;
    this.totalKills = 0;
    this.intermissionTimer = 0;
    this.status = "IDLE";
  }

  /**
   * Запуск сражения игроком
   */
  startFight(starterPlayer) {
    // Блокируем запуск если бой активен ИЛИ в процессе завершения (VICTORY/DEFEAT)
    if (this.status !== "IDLE") {
      if (this.status === "VICTORY") {
        starterPlayer.sendMessage(`§e⏳ Подождите завершения церемонии победы...§r`);
      } else if (this.status === "DEFEAT") {
        starterPlayer.sendMessage(`§e⏳ Подождите завершения сброса арены...§r`);
      } else {
        starterPlayer.sendMessage(`§c⚔ Бой уже в разгаре! Текущая волна: ${this.currentWaveIndex + 1}§r`);
      }
      starterPlayer.playSound("note.bass", { volume: 1.0, pitch: 0.8 });
      return;
    }

    this.dimension = starterPlayer.dimension;

    if (ARENA_CONFIG.useDynamicCenter) {
      this.center = {
        x: Math.floor(starterPlayer.location.x),
        y: Math.floor(starterPlayer.location.y),
        z: Math.floor(starterPlayer.location.z)
      };
    } else {
      this.center = { ...ARENA_CONFIG.fixedCenter };
    }

    if (ARENA_CONFIG.cleanArenaBeforeStart) {
      this.cleanArena();
    }

    // Получаем игроков на арене и ГАРАНТИРУЕМ что стартующий игрок включён
    const arenaPlayers = this.getArenaPlayers();
    const starterIncluded = arenaPlayers.some((p) => p.name === starterPlayer.name);
    if (!starterIncluded && starterPlayer.isValid()) {
      arenaPlayers.push(starterPlayer);
    }

    if (ARENA_CONFIG.teleportPlayersOnStart) {
      for (const p of arenaPlayers) {
        p.teleport({
          x: this.center.x + ARENA_CONFIG.playerTeleportOffset.x,
          y: this.center.y + ARENA_CONFIG.playerTeleportOffset.y,
          z: this.center.z + ARENA_CONFIG.playerTeleportOffset.z
        });
      }
    }

    this.status = "STARTING";
    this.currentWaveIndex = 0;
    this.totalKills = 0;
    this.fightParticipants.clear();
    this.waveParticipants.clear();

    // Запоминаем всех участников боя
    for (const p of arenaPlayers) {
      this.fightParticipants.add(p.name);
    }

    // Оповещение о начале боя
    EconomyManager.broadcastTitle(
      arenaPlayers,
      "§c⚔ КОЛИЗЕЙ ⚔§r",
      `§eБой начал: §f${starterPlayer.name}§e! Приготовьтесь к бою!§r`
    );
    EconomyManager.broadcastSound(arenaPlayers, "raid.horn", 1.0, 1.0);

    // Запуск первой волны через 3 секунды
    system.runTimeout(() => {
      if (this.status === "STARTING") {
        this.spawnCurrentWave();
      }
    }, 60);
  }

  /**
   * Генерация конфигурации волны (штатной или бесконечной)
   */
  getWaveConfig() {
    const waveNum = this.currentWaveIndex + 1;

    if (this.currentWaveIndex < ARENA_CONFIG.waves.length) {
      return ARENA_CONFIG.waves[this.currentWaveIndex];
    }

    if (ARENA_CONFIG.enableEndlessMode) {
      const extra = this.currentWaveIndex - ARENA_CONFIG.waves.length + 1;
      return {
        waveNumber: waveNum,
        title: `§5Бесконечная волна ${waveNum}§r`,
        spawns: [
          { type: "colosseum:gladiator_champion", count: 2 + Math.floor(extra / 2) },
          { type: "colosseum:gladiator_heavy", count: 3 + extra },
          { type: "colosseum:gladiator_archer", count: 3 + extra },
          { type: "colosseum:gladiator_fast", count: 4 + extra }
        ],
        rewardCoins: ARENA_CONFIG.waves.length > 0
          ? ARENA_CONFIG.waves[ARENA_CONFIG.waves.length - 1].rewardCoins + extra * 30
          : 100 + extra * 30
      };
    }

    return null; // Все волны пройдены и бесконечный режим отключён
  }

  /**
   * Спавн текущей волны
   */
  spawnCurrentWave() {
    this.activeGladiatorIds.clear();
    const arenaPlayers = this.getArenaPlayers();

    const waveConfig = this.getWaveConfig();
    const waveNum = this.currentWaveIndex + 1;

    if (!waveConfig) {
      this.triggerVictory();
      return;
    }

    // Запоминаем участников текущей волны (для расчёта наград)
    this.waveParticipants.clear();
    for (const p of arenaPlayers) {
      this.waveParticipants.add(p.name);
      this.fightParticipants.add(p.name); // Также добавляем в общий список
    }

    // Оповещение о волне
    EconomyManager.broadcastTitle(arenaPlayers, `§eВОЛНА ${waveNum}§r`, waveConfig.title);
    EconomyManager.broadcastSound(arenaPlayers, "horn.call.0", 1.0, 1.0);

    const offsets = ARENA_CONFIG.spawnOffsets;
    let spawnIndex = 0;
    let spawnedCount = 0;

    for (const group of waveConfig.spawns) {
      for (let i = 0; i < group.count; i++) {
        const offset = offsets[spawnIndex % offsets.length];
        spawnIndex++;

        const spawnPos = {
          x: this.center.x + offset.x,
          y: this.center.y + offset.y,
          z: this.center.z + offset.z
        };

        try {
          const mob = this.dimension.spawnEntity(group.type, spawnPos);
          if (mob && mob.id) {
            this.activeGladiatorIds.add(mob.id);
            this.aiController.registerGladiator(mob);
            spawnedCount++;
          }
        } catch (e) {
          console.warn(`Не удалось заспавнить гладиатора ${group.type} на [${spawnPos.x}, ${spawnPos.y}, ${spawnPos.z}]: ${e}`);
        }
      }
    }

    // Если ни один враг не заспавнился — автоматический переход, а не зависание
    if (spawnedCount === 0) {
      console.warn(`[Колизей] Волна ${waveNum}: не удалось заспавнить ни одного врага! Пропускаем волну.`);
      EconomyManager.broadcastTitle(
        arenaPlayers,
        `§cОшибка спавна§r`,
        `§7Волна ${waveNum} пропущена из-за ошибки. Переход к следующей...§r`
      );
      // Переходим к следующей волне через intermission
      this.currentWaveIndex++;
      const nextConfig = this.getWaveConfig();
      if (nextConfig) {
        this.status = "INTERMISSION";
        this.intermissionTimer = ARENA_CONFIG.intermissionSeconds;
      } else {
        this.triggerVictory();
      }
      return;
    }

    this.status = "WAVE_ACTIVE";
  }

  /**
   * Обработка гибели сущности
   */
  handleEntityDeath(deadEntity, damageSource) {
    if (this.status !== "WAVE_ACTIVE") return;

    if (this.activeGladiatorIds.has(deadEntity.id)) {
      this.activeGladiatorIds.delete(deadEntity.id);
      this.totalKills++;

      if (damageSource && damageSource.damagingEntity && damageSource.damagingEntity.typeId === "minecraft:player") {
        try {
          damageSource.damagingEntity.playSound("random.orb", { volume: 0.6, pitch: 1.4 });
        } catch (_) {
          // Игрок мог стать невалидным
        }
      }

      // Все враги повержены
      if (this.activeGladiatorIds.size === 0) {
        this.onWaveCleared();
      }
    }
  }

  /**
   * Завершение волны и раздача наград
   */
  onWaveCleared() {
    const waveNum = this.currentWaveIndex + 1;
    const waveConfig = this.getWaveConfig();

    // Расчёт наград через единый метод getWaveConfig()
    const rewardCoins = waveConfig ? waveConfig.rewardCoins : 100;
    // Трофей выдаётся ТОЛЬКО из скрипта, а не из лут-таблицы босса
    const rewardTrophy = waveConfig ? !!waveConfig.rewardTrophy : false;

    // Награды только для тех, кто был на арене в начале волны И сейчас на ней
    const eligiblePlayers = this.getRewardEligiblePlayers();

    for (const player of eligiblePlayers) {
      EconomyManager.giveCoins(player, rewardCoins);
      if (rewardTrophy) {
        EconomyManager.giveTrophy(player);
      }
    }

    // Звук победы для всех кто на арене
    const arenaPlayers = this.getArenaPlayers();
    EconomyManager.broadcastSound(arenaPlayers, "ui.toast.challenge_complete", 1.0, 1.0);

    // Проверка победы (если последняя штатная волна и бесконечный режим выключен)
    if (this.currentWaveIndex === ARENA_CONFIG.waves.length - 1 && !ARENA_CONFIG.enableEndlessMode) {
      this.triggerVictory();
      return;
    }

    // Переход к перерыву перед следующей волной
    this.status = "INTERMISSION";
    this.intermissionTimer = ARENA_CONFIG.intermissionSeconds;
    this.currentWaveIndex++;

    EconomyManager.broadcastTitle(
      arenaPlayers,
      `§aВолна ${waveNum} пройдена!§r`,
      `§eНаграда: +${rewardCoins} монет каждому бойцу!§r`
    );
  }

  /**
   * Триумфальная победа на арене
   */
  triggerVictory() {
    this.status = "VICTORY";
    const arenaPlayers = this.getArenaPlayers();

    EconomyManager.broadcastTitle(
      arenaPlayers,
      "§6🏆 ПОБЕДА В КОЛИЗЕЕ! 🏆§r",
      "§fВсе волны пройдены! Вы — истинные чемпионы Рима!§r"
    );
    EconomyManager.broadcastSound(arenaPlayers, "ui.toast.challenge_complete", 1.0, 0.9);

    system.runTimeout(() => {
      this.cleanArena();
      this.resetFight();
    }, 140);
  }

  /**
   * Поражение на арене (все бойцы пали или покинули арену)
   * Оповещение ТОЛЬКО игрокам арены, а не всем в измерении
   */
  triggerDefeat() {
    this.status = "DEFEAT";

    try {
      // Уведомляем только участников боя, а не весь dimension
      const notifyPlayers = [];
      if (this.dimension) {
        const allPlayers = this.dimension.getPlayers();
        for (const p of allPlayers) {
          if (p.isValid() && this.fightParticipants.has(p.name)) {
            notifyPlayers.push(p);
          }
        }
      }
      // Если никого из участников не найдено, просто сбрасываем
      if (notifyPlayers.length > 0) {
        EconomyManager.broadcastTitle(
          notifyPlayers,
          "§c☠ ПОРАЖЕНИЕ В КОЛИЗЕЕ ☠§r",
          "§7Все гладиаторы арены одержали верх... Попробуйте снова!§r"
        );
        EconomyManager.broadcastSound(notifyPlayers, "beacon.deactivate", 1.0, 0.8);
      }
    } catch (e) {
      console.warn(`Ошибка при поражении: ${e}`);
    }

    this.cleanArena();
    this.resetFight();
  }

  /**
   * Периодический цикл (вызывается раз в секунду / 20 тиков)
   */
  tick() {
    if (this.status === "IDLE") return;

    const arenaPlayers = this.getArenaPlayers();

    // Если бой идет, но на арене никого нет в живых — поражение
    if ((this.status === "WAVE_ACTIVE" || this.status === "INTERMISSION") && arenaPlayers.length === 0) {
      this.triggerDefeat();
      return;
    }

    if (this.status === "WAVE_ACTIVE") {
      // Проверяем, не «пропали» ли сущности (entity.isValid() === false)
      // Это предотвращает зависание волны при деспавне мобов
      const staleIds = [];
      for (const id of this.activeGladiatorIds) {
        let found = false;
        try {
          // Пробуем найти сущность среди всех в мире
          const entities = this.dimension.getEntities();
          for (const ent of entities) {
            if (ent.id === id && ent.isValid()) {
              found = true;
              break;
            }
          }
        } catch (_) {
          // Ошибка при запросе — пропускаем проверку
          found = true; // Не удаляем при ошибке
        }
        if (!found) {
          staleIds.push(id);
        }
      }

      // Удаляем «призрачные» ID
      for (const staleId of staleIds) {
        this.activeGladiatorIds.delete(staleId);
        this.totalKills++;
      }

      // Если после очистки врагов не осталось — волна пройдена
      if (this.activeGladiatorIds.size === 0) {
        this.onWaveCleared();
        return;
      }

      const waveNum = this.currentWaveIndex + 1;
      const totalDisplay = ARENA_CONFIG.enableEndlessMode ? "∞" : ARENA_CONFIG.waves.length;
      const hudText = `§6⚔ Волна: §e${waveNum}/${totalDisplay} §7| §cВрагов: §e${this.activeGladiatorIds.size} §7| §bБойцов: §a${arenaPlayers.length}§r`;
      EconomyManager.broadcastActionbar(arenaPlayers, hudText);
    } else if (this.status === "INTERMISSION") {
      this.intermissionTimer--;
      if (this.intermissionTimer <= 0) {
        this.spawnCurrentWave();
      } else {
        const text = `§aОтдых... §eСледующая волна через: §c${this.intermissionTimer}с§r`;
        EconomyManager.broadcastActionbar(arenaPlayers, text);
        EconomyManager.broadcastSound(arenaPlayers, "random.click", 0.6, 1.2);
      }
    }
  }
}
