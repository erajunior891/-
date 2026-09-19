/**
 * Тактический ИИ Контроллер Гладиаторов Колизея
 * Реализует:
 * 1. 6 тактических состояний (COMBAT, GUARD, PROTECTING, FLANK, NEED_HEAL, PANIC)
 * 2. Командную защиту слабых и перехват игрока (Bodyguard / Intercept)
 * 3. Логику Медика (лечение, клич поддержки, самосохранение при уроне)
 * 4. Hit & Run для быстрых гладиаторов
 * 5. Кайтинг лучников к союзным танкам
 */
import { world, system } from "@minecraft/server";

export const AI_CONFIG = {
  DEBUG_MODE: false,        // Включить визуальное отображение состояний над мобами
  EVALUATION_INTERVAL: 6,   // Запуск цикла оценки каждые 6 тиков (0.3 сек)
  HEAL_HP_THRESHOLD: 0.55,  // Лечить союзников, если их ХП < 55%
  NEED_HEAL_THRESHOLD: 0.40,// Отступать к медику, если ХП < 40%
  MEDIC_HEAL_RADIUS: 4.2,   // Радиус действия исцеления медика (блоков)
  MEDIC_HEAL_COOLDOWN_TICKS: 160,  // Кулдаун лечения медика (8 сек = 160 тиков)
  MEDIC_SHOUT_COOLDOWN_TICKS: 640, // Кулдаун клича поддержки (32 сек)
  PANIC_DURATION_TICKS: 120,       // Длительность паники при смерти медика (6 сек)
  HIT_AND_RUN_RETREAT_TICKS: 36,   // Длительность фазы отскока быстрого гладиатора (1.8 сек)
};

/**
 * @typedef {"COMBAT" | "GUARD" | "PROTECTING" | "FLANK" | "NEED_HEAL" | "PANIC"} AIState
 * @typedef {"MEDIC" | "ARCHER" | "TANK" | "SHIELD" | "FAST"} AIRole
 */

export class GladiatorAIController {
  constructor() {
    /** @type {Map<string, {
     *   entity: any,
     *   role: AIRole,
     *   state: AIState,
     *   targetEntity: any,
     *   protectTarget: any,
     *   lastHealTick: number,
     *   lastShoutTick: number,
     *   hurtTimer: number,
     *   retreatTimer: number,
     *   panicTimer: number,
     *   lastHp: number
     * }>} */
    this.gladiators = new Map();
    this.currentTick = 0;

    this._initEvents();
  }

  /**
   * Подписка на игровые события (урон, смерть)
   */
  _initEvents() {
    // Реакция на урон: самосохранение медика и перехват игрока
    world.afterEvents.entityHurt.subscribe((event) => {
      const hurtEntity = event.hurtEntity;
      const damageSource = event.damageSource;
      if (!hurtEntity || !hurtEntity.isValid()) return;

      const record = this.gladiators.get(hurtEntity.id);
      if (record) {
        // Медик получил урон -> приоритетный отход на 3 сек
        if (record.role === "MEDIC") {
          record.hurtTimer = 60; // 3 секунды отступления
          record.state = "NEED_HEAL";
          try {
            // Медик бросает замедление под нападающего
            if (damageSource && damageSource.damagingEntity) {
              const attacker = damageSource.damagingEntity;
              if (attacker.isValid() && attacker.typeId === "minecraft:player") {
                attacker.addEffect("slowness", 60, { amplifier: 1, showParticles: true });
                hurtEntity.dimension.spawnParticle("minecraft:splash_spell_emitter", attacker.location);
              }
            }
          } catch (e) {}
        }

        // Если ранили союзника -> ближайшие щитоносцы получают импульс PROTECTING
        const healthComp = hurtEntity.getComponent("health");
        if (healthComp && healthComp.currentValue / healthComp.effectiveMax < AI_CONFIG.NEED_HEAL_THRESHOLD) {
          if (record.role !== "MEDIC") {
            record.state = "NEED_HEAL";
          }
          this._dispatchBodyguards(hurtEntity, damageSource?.damagingEntity);
        }
      }
    });

    // Реакция на смерть: паника при гибели медика
    world.afterEvents.entityDie.subscribe((event) => {
      const deadEntity = event.deadEntity;
      if (!deadEntity) return;

      const record = this.gladiators.get(deadEntity.id);
      if (record) {
        if (record.role === "MEDIC") {
          this._triggerTeamPanic(deadEntity.location, deadEntity.dimension);
        }
        this.gladiators.delete(deadEntity.id);
      }
    });
  }

  /**
   * Зарегистрировать гладиатора в тактической сети
   */
  registerGladiator(entity) {
    if (!entity || !entity.isValid()) return;
    const typeId = entity.typeId;

    let role = "SHIELD";
    if (typeId === "colosseum:gladiator_medic") role = "MEDIC";
    else if (typeId === "colosseum:gladiator_archer") role = "ARCHER";
    else if (typeId === "colosseum:gladiator_heavy" || typeId === "colosseum:gladiator_boss") role = "TANK";
    else if (typeId === "colosseum:gladiator_fast") role = "FAST";
    else if (typeId === "colosseum:gladiator_normal" || typeId === "colosseum:gladiator_champion") role = "SHIELD";

    const healthComp = entity.getComponent("health");
    const currentHp = healthComp ? healthComp.currentValue : 20;

    this.gladiators.set(entity.id, {
      entity,
      role,
      state: "COMBAT",
      targetEntity: null,
      protectTarget: null,
      lastHealTick: -AI_CONFIG.MEDIC_HEAL_COOLDOWN_TICKS,
      lastShoutTick: -AI_CONFIG.MEDIC_SHOUT_COOLDOWN_TICKS,
      hurtTimer: 0,
      retreatTimer: 0,
      panicTimer: 0,
      lastHp: currentHp
    });
  }

  /**
   * Снять гладиатора с учета
   */
  unregisterGladiator(entityId) {
    this.gladiators.delete(entityId);
  }

  /**
   * Очистить всех гладиаторов (при смене волны или рестарте)
   */
  clearAll() {
    this.gladiators.clear();
  }

  /**
   * Главный тактический такт (вызывается раз в 6 тиков)
   */
  tick(currentTick) {
    this.currentTick = currentTick;

    // 1. Очистка невалидных сущностей
    for (const [id, record] of this.gladiators.entries()) {
      if (!record.entity || !record.entity.isValid()) {
        this.gladiators.delete(id);
      }
    }

    if (this.gladiators.size === 0) return;

    // 2. Найти активного медика
    let activeMedic = null;
    for (const record of this.gladiators.values()) {
      if (record.role === "MEDIC" && record.entity.isValid()) {
        activeMedic = record;
        break;
      }
    }

    // 3. Найти ближайшего игрока-цель
    const sampleRecord = this.gladiators.values().next().value;
    const dimension = sampleRecord ? sampleRecord.entity.dimension : null;
    let closestPlayer = null;
    if (dimension) {
      try {
        const players = dimension.getPlayers();
        if (players.length > 0) {
          closestPlayer = players[0]; // Первичная цель
        }
      } catch (e) {}
    }

    // 4. Поведение каждого гладиатора
    for (const record of this.gladiators.values()) {
      this._evaluateGladiatorState(record, activeMedic, closestPlayer);
      this._executeGladiatorTactics(record, activeMedic, closestPlayer);
    }
  }

  /**
   * Оценка и смена состояния гладиатора
   */
  _evaluateGladiatorState(record, activeMedic, player) {
    const entity = record.entity;
    const health = entity.getComponent("health");
    if (!health) return;

    const hpRatio = health.currentValue / health.effectiveMax;

    // Уменьшение таймеров
    if (record.hurtTimer > 0) record.hurtTimer -= AI_CONFIG.EVALUATION_INTERVAL;
    if (record.retreatTimer > 0) record.retreatTimer -= AI_CONFIG.EVALUATION_INTERVAL;
    if (record.panicTimer > 0) {
      record.panicTimer -= AI_CONFIG.EVALUATION_INTERVAL;
      record.state = "PANIC";
      return;
    }

    // Роль: МЕДИК
    if (record.role === "MEDIC") {
      if (record.hurtTimer > 0) {
        record.state = "NEED_HEAL"; // Отступает при опасности
      } else {
        record.state = "GUARD"; // Держится во 2-й линии
      }
      return;
    }

    // Критическое здоровье -> отход к медику
    if (hpRatio < AI_CONFIG.NEED_HEAL_THRESHOLD && activeMedic) {
      record.state = "NEED_HEAL";
      return;
    }

    // Роль: БЫСТРЫЙ ГЛАДИАТОР (Акробат)
    if (record.role === "FAST") {
      if (record.retreatTimer > 0) {
        record.state = "FLANK"; // Фаза отскока после удара (Hit & Run)
      } else {
        record.state = "COMBAT";
      }
      return;
    }

    // Роль: ЩИТОНОСЦЫ и ТАНКИ
    if (record.role === "SHIELD" || record.role === "TANK") {
      // Если игрок близко к медику -> перехват!
      if (activeMedic && player && player.isValid()) {
        const distToMedic = this._getDistance(player.location, activeMedic.entity.location);
        if (distToMedic < 7.0) {
          record.state = "PROTECTING";
          record.protectTarget = activeMedic.entity;
          return;
        }
      }

      // Если рядом есть лучник или медик -> удержание строя
      if (activeMedic && this._getDistance(entity.location, activeMedic.entity.location) < 6.0) {
        record.state = "GUARD";
        return;
      }

      record.state = "COMBAT";
      return;
    }

    // Роль: ЛУЧНИК
    if (record.role === "ARCHER") {
      if (player && this._getDistance(entity.location, player.location) < 4.5) {
        record.state = "GUARD"; // Пятится к танкам
      } else {
        record.state = "COMBAT";
      }
    }
  }

  /**
   * Выполнение тактических действий в зависимости от состояния
   */
  _executeGladiatorTactics(record, activeMedic, player) {
    const entity = record.entity;

    // Режим отладки: визуальный маркер над головой
    if (AI_CONFIG.DEBUG_MODE) {
      this._renderDebugTag(record);
    }

    // 1. Поведение МЕДИКА
    if (record.role === "MEDIC") {
      this._runMedicBehavior(record, player);
      return;
    }

    // 2. Поведение при NEED_HEAL (отход к медику)
    if (record.state === "NEED_HEAL" && activeMedic && activeMedic.entity.isValid()) {
      const medicLoc = activeMedic.entity.location;
      const dist = this._getDistance(entity.location, medicLoc);
      if (dist > 3.0) {
        // Движение навстречу медику
        this._impulseTowards(entity, medicLoc, 0.22);
      }
      return;
    }

    // 3. Поведение быстрого гладиатора (Hit & Run)
    if (record.role === "FAST") {
      if (player && player.isValid()) {
        const dist = this._getDistance(entity.location, player.location);
        // Если только что был в упор (< 2.2 блока) и не в фазе отката -> активируем отскок
        if (dist < 2.2 && record.retreatTimer <= 0) {
          record.retreatTimer = AI_CONFIG.HIT_AND_RUN_RETREAT_TICKS;
          record.state = "FLANK";
          // Импульс отскока назад и вбок
          this._impulseAway(entity, player.location, 0.35);
          entity.addEffect("speed", 30, { amplifier: 1, showParticles: false });
        }
      }
      return;
    }

    // 4. Поведение щитоносцев при PROTECTING (перехват)
    if (record.state === "PROTECTING" && player && player.isValid()) {
      // Сближение с игроком для блокирования
      this._impulseTowards(entity, player.location, 0.25);
      // Если игрок близко -> поднять щит
      if (this._getDistance(entity.location, player.location) < 3.5) {
        entity.triggerEvent("colosseum:start_blocking");
      }
      return;
    }

    // 5. Поведение лучника (кайтинг к ближайшему щитоносцу)
    if (record.role === "ARCHER" && player && player.isValid()) {
      const distToPlayer = this._getDistance(entity.location, player.location);
      if (distToPlayer < 4.5) {
        // Найти ближайшего щитоносца
        const nearestTank = this._findNearestAllyWithRole(entity, ["TANK", "SHIELD"]);
        if (nearestTank) {
          // Отступаем по направлению к танку
          this._impulseTowards(entity, nearestTank.location, 0.28);
        } else {
          // Просто пятится от игрока
          this._impulseAway(entity, player.location, 0.28);
        }
      }
    }
  }

  /**
   * Логика Медика: лечение раненых, клич поддержки, самосохранение
   */
  _runMedicBehavior(record, player) {
    const medic = record.entity;

    // 1. Самосохранение: если атакован, отбегает от игрока
    if (record.hurtTimer > 0 && player && player.isValid()) {
      this._impulseAway(medic, player.location, 0.32);
      return;
    }

    // 2. Проверка возможности лечения
    if (this.currentTick - record.lastHealTick >= AI_CONFIG.MEDIC_HEAL_COOLDOWN_TICKS) {
      // Ищем наиболее раненого союзника в радиусе 4.2 блоков
      let mostWounded = null;
      let lowestHpRatio = 1.0;

      for (const other of this.gladiators.values()) {
        if (other.entity.id === medic.id) continue;
        if (!other.entity.isValid()) continue;

        const health = other.entity.getComponent("health");
        if (!health) continue;

        const ratio = health.currentValue / health.effectiveMax;
        if (ratio < AI_CONFIG.HEAL_HP_THRESHOLD) {
          const dist = this._getDistance(medic.location, other.entity.location);
          if (dist <= AI_CONFIG.MEDIC_HEAL_RADIUS && ratio < lowestHpRatio) {
            lowestHpRatio = ratio;
            mostWounded = other.entity;
          }
        }
      }

      // Применяем лечение к раненому союзнику
      if (mostWounded) {
        record.lastHealTick = this.currentTick;
        try {
          // Эффекты лечения
          mostWounded.addEffect("instant_health", 1, { amplifier: 0, showParticles: true });
          mostWounded.addEffect("regeneration", 80, { amplifier: 0, showParticles: true }); // 4 сек регенерации
          medic.dimension.spawnParticle("minecraft:heart_particle", mostWounded.location);
          medic.dimension.spawnParticle("minecraft:villager_happy", medic.location);
          medic.dimension.playSound("random.potion.brewed", mostWounded.location, { volume: 0.8, pitch: 1.1 });
        } catch (e) {}
      }
    }

    // 3. Клич поддержки (раз в 32 сек)
    if (this.currentTick - record.lastShoutTick >= AI_CONFIG.MEDIC_SHOUT_COOLDOWN_TICKS) {
      record.lastShoutTick = this.currentTick;
      try {
        medic.dimension.playSound("item.horn.sound.0", medic.location, { volume: 1.0, pitch: 1.2 });
        // Бафф ближайших союзников
        for (const other of this.gladiators.values()) {
          if (!other.entity.isValid()) continue;
          if (this._getDistance(medic.location, other.entity.location) <= 7.0) {
            other.entity.addEffect("resistance", 120, { amplifier: 0, showParticles: true }); // 6 сек стойкости
            other.entity.addEffect("speed", 100, { amplifier: 0, showParticles: false });      // 5 сек скорости
            medic.dimension.spawnParticle("minecraft:critical_hit_emitter", other.entity.location);
          }
        }
      } catch (e) {}
    }
  }

  /**
   * Вызов телохранителей на защиту союзника
   */
  _dispatchBodyguards(woundedEntity, threatEntity) {
    if (!woundedEntity || !woundedEntity.isValid()) return;

    let assigned = 0;
    for (const record of this.gladiators.values()) {
      if (record.entity.id === woundedEntity.id) continue;
      if (record.role === "SHIELD" || record.role === "TANK") {
        const dist = this._getDistance(record.entity.location, woundedEntity.location);
        if (dist < 10.0 && record.state !== "PROTECTING") {
          record.state = "PROTECTING";
          record.protectTarget = woundedEntity;
          assigned++;
          if (assigned >= 2) break; // Максимум 2 телохранителя
        }
      }
    }
  }

  /**
   * Запуск паники в отряде при гибели Медика
   */
  _triggerTeamPanic(medicLocation, dimension) {
    try {
      if (dimension) {
        dimension.playSound("mob.zombie.unfect", medicLocation, { volume: 1.0, pitch: 0.8 });
      }
    } catch (e) {}

    for (const record of this.gladiators.values()) {
      if (record.entity.isValid()) {
        record.panicTimer = AI_CONFIG.PANIC_DURATION_TICKS;
        record.state = "PANIC";
        try {
          record.entity.dimension.spawnParticle("minecraft:knockback_roar_particle", record.entity.location);
          // Дезориентация / ярость: кратковременная слабость и ускорение
          record.entity.addEffect("speed", 120, { amplifier: 1, showParticles: true });
        } catch (e) {}
      }
    }
  }

  /**
   * Найти ближайшего союзника определенной роли
   */
  _findNearestAllyWithRole(sourceEntity, roles) {
    let nearest = null;
    let minDist = 999;

    for (const record of this.gladiators.values()) {
      if (record.entity.id === sourceEntity.id) continue;
      if (!record.entity.isValid()) continue;

      if (roles.includes(record.role)) {
        const dist = this._getDistance(sourceEntity.location, record.entity.location);
        if (dist < minDist) {
          minDist = dist;
          nearest = record.entity;
        }
      }
    }
    return nearest;
  }

  /**
   * Придать мягкий импульс движения в сторону точки
   */
  _impulseTowards(entity, targetLoc, strength = 0.2) {
    try {
      const dx = targetLoc.x - entity.location.x;
      const dz = targetLoc.z - entity.location.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0.1) {
        entity.applyImpulse({
          x: (dx / len) * strength,
          y: 0.0,
          z: (dz / len) * strength
        });
      }
    } catch (e) {}
  }

  /**
   * Придать мягкий импульс движения в сторону ОТ точки (отскок / кайтинг)
   */
  _impulseAway(entity, targetLoc, strength = 0.25) {
    try {
      const dx = entity.location.x - targetLoc.x;
      const dz = entity.location.z - targetLoc.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0.1) {
        entity.applyImpulse({
          x: (dx / len) * strength,
          y: 0.05,
          z: (dz / len) * strength
        });
      }
    } catch (e) {}
  }

  /**
   * Евклидово расстояние между двумя точками
   */
  _getDistance(locA, locB) {
    const dx = locA.x - locB.x;
    const dy = locA.y - locB.y;
    const dz = locA.z - locB.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Отображение отладочного бейджа над головой в DEV режиме
   */
  _renderDebugTag(record) {
    try {
      const health = record.entity.getComponent("health");
      const hp = health ? Math.round(health.currentValue) : "?";
      record.entity.nameTag = `§e[${record.state}] §f${record.role} §c${hp}HP§r`;
    } catch (e) {}
  }
}
