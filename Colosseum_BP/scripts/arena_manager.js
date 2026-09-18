/**
 * Мультиплеерный менеджер Колизея: волны, арена, спавн и контроль состояния
 */
import { world, system } from "@minecraft/server";
import { ARENA_CONFIG } from "./config.js";
import { EconomyManager } from "./economy.js";

export class ArenaManager {
  constructor() {
    this.status = "IDLE"; // IDLE, STARTING, WAVE_ACTIVE, INTERMISSION, VICTORY, DEFEAT
    this.currentWaveIndex = 0;
    this.center = { ...ARENA_CONFIG.fixedCenter };
    this.dimension = null;
    this.activeGladiatorIds = new Set();
    this.intermissionTimer = 0;
    this.totalKills = 0;
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
    const players = this.dimension.getPlayers();
    return players.filter((player) => {
      if (!player.isValid()) return false;
      const health = player.getComponent("health");
      const isAlive = health ? health.currentValue > 0 : true;
      return isAlive && this.isInsideArena(player.location);
    });
  }

  /**
   * Полная очистка арены от мобов и выпавших предметов
   */
  cleanArena() {
    if (!this.dimension) return;

    try {
      const entities = this.dimension.getEntities();
      for (const ent of entities) {
        if (!ent.isValid() || ent.typeId === "minecraft:player") continue;

        if (this.isInsideArena(ent.location)) {
          // Удаляем предметы на земле и всех гладиаторов или враждебных мобов
          if (ent.typeId === "minecraft:item" || ent.typeId.startsWith("colosseum:gladiator_")) {
            ent.remove();
          }
        }
      }
    } catch (e) {
      console.warn(`Ошибка очистки арены: ${e}`);
    }

    this.activeGladiatorIds.clear();
  }

  /**
   * Запуск сражения игроком
   */
  startFight(starterPlayer) {
    if (this.status === "WAVE_ACTIVE" || this.status === "STARTING" || this.status === "INTERMISSION") {
      starterPlayer.sendMessage(`§c⚔ Бой уже в разгаре! Текущая волна: ${this.currentWaveIndex + 1}§r`);
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

    const arenaPlayers = this.getArenaPlayers();
    if (arenaPlayers.length === 0) {
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
   * Спавн текущей волны
   */
  spawnCurrentWave() {
    this.activeGladiatorIds.clear();
    const arenaPlayers = this.getArenaPlayers();

    let waveConfig = null;
    const waveNum = this.currentWaveIndex + 1;

    if (this.currentWaveIndex < ARENA_CONFIG.waves.length) {
      waveConfig = ARENA_CONFIG.waves[this.currentWaveIndex];
    } else if (ARENA_CONFIG.enableEndlessMode) {
      // Генерация бесконечной волны с нарастающей сложностью
      const extra = this.currentWaveIndex - ARENA_CONFIG.waves.length + 1;
      waveConfig = {
        waveNumber: waveNum,
        title: `§5Бесконечная волна ${waveNum}§r`,
        spawns: [
          { type: "colosseum:gladiator_champion", count: 2 + Math.floor(extra / 2) },
          { type: "colosseum:gladiator_heavy", count: 3 + extra },
          { type: "colosseum:gladiator_archer", count: 3 + extra },
          { type: "colosseum:gladiator_fast", count: 4 + extra }
        ],
        rewardCoins: 100 + extra * 30
      };
    } else {
      this.triggerVictory();
      return;
    }

    // Оповещение о волне
    EconomyManager.broadcastTitle(arenaPlayers, `§eВОЛНА ${waveNum}§r`, waveConfig.title);
    EconomyManager.broadcastSound(arenaPlayers, "horn.call.0", 1.0, 1.0);

    const offsets = ARENA_CONFIG.spawnOffsets;
    let spawnIndex = 0;

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
          this.activeGladiatorIds.add(mob.id);
        } catch (e) {
          console.warn(`Не удалось заспавнить гладиатора ${group.type}: ${e}`);
        }
      }
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
        damageSource.damagingEntity.playSound("random.orb", { volume: 0.6, pitch: 1.4 });
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
    const arenaPlayers = this.getArenaPlayers();
    const waveNum = this.currentWaveIndex + 1;

    let waveConfig = ARENA_CONFIG.waves[this.currentWaveIndex];
    let rewardCoins = waveConfig ? waveConfig.rewardCoins : (100 + (this.currentWaveIndex - 5) * 30);
    let rewardTrophy = waveConfig ? !!waveConfig.rewardTrophy : false;

    // Раздача наград всем участникам на арене (мультиплеер!)
    for (const player of arenaPlayers) {
      EconomyManager.giveCoins(player, rewardCoins);
      if (rewardTrophy) {
        EconomyManager.giveTrophy(player);
      }
    }

    EconomyManager.broadcastSound(arenaPlayers, "ui.toast.challenge_complete", 1.0, 1.0);

    // Проверка победы (если волна 5 и бесконечный режим выключен)
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
      this.status = "IDLE";
    }, 140);
  }

  /**
   * Поражение на арене (все бойцы пали или покинули арену)
   */
  triggerDefeat() {
    this.status = "DEFEAT";

    try {
      const allPlayers = this.dimension.getPlayers();
      EconomyManager.broadcastTitle(
        allPlayers,
        "§c☠ ПОРАЖЕНИЕ В КОЛИЗЕЕ ☠§r",
        "§7Все гладиаторы арены одержали верх... Попробуйте снова!§r"
      );
      EconomyManager.broadcastSound(allPlayers, "beacon.deactivate", 1.0, 0.8);
    } catch (e) {
      console.warn(`Ошибка при поражении: ${e}`);
    }

    this.cleanArena();
    this.status = "IDLE";
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
