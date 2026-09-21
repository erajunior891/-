/**
 * Тактический ИИ Контроллер Гладиаторов Колизея
 * Версия: 1.5.0 (Мультиплеер 1.26+)
 * 
 * Реализует:
 * 1. Полноценное исцеление Медика:
 *    - Самолечение при получении урона и HP < 60%
 *    - Дистанционный бросок взрывных зелий (Splash AoE) раненым союзникам (до 15 блоков)
 *    - AoE регенерация и стойкость в зоне взрыва зелья
 *    - Защитное зелье замедления/слабости под ноги игроку
 *    - Клич поддержки рогом
 * 2. Гладиатор-Берсерк:
 *    - Механика неистовой ярости (ENRAGED) при HP < 45%
 *    - Баффы Силы и Скорости II, частицы пламени, боевой рык
 *    - Заражение яростью союзных быстрых бойцов
 *    - Игнорирование отхода к медику
 * 3. Гладиатор-Ретиарий:
 *    - Бросок ловчей сети раз в 11 секунд (Slowness IV + Weakness)
 *    - Командное целеуказание для лучников и танков на пойманную жертву
 * 4. Тактические приемы:
 *    - Акробатический прыжок (Leap) и отскок (Hit & Run) у Быстрых
 *    - Рывок со щитом (Shield Dash) у Щитоносцев
 *    - Аура стойкости щитоносцев рядом с Медиком
 *    - Движение раненых навстречу Медику
 *    - Паника отряда при гибели Медика
 */
import { world, system } from "@minecraft/server";

export const AI_CONFIG = {
  DEBUG_MODE: false,               // Включить визуальное отображение состояний над мобами
  EVALUATION_INTERVAL: 6,          // Запуск цикла оценки каждые 6 тиков (0.3 сек)
  HEAL_HP_THRESHOLD: 0.75,         // Лечить союзников, если их ХП < 75%
  NEED_HEAL_THRESHOLD: 0.45,       // Отступать к медику, если ХП < 45%
  MEDIC_HEAL_DIRECT_RADIUS: 4.5,   // Прямое полевое лечение (блоков)
  MEDIC_POTION_THROW_MAX_DIST: 15.0,// Максимальная дистанция броска зелья исцеления
  MEDIC_POTION_SPLASH_RADIUS: 4.5, // Радиус взрыва зелья (AoE)
  MEDIC_HEAL_COOLDOWN_TICKS: 120,  // Кулдаун лечения медика (6 сек = 120 тиков)
  MEDIC_SELF_HEAL_THRESHOLD: 0.60, // Самолечение медика при HP < 60%
  MEDIC_SHOUT_COOLDOWN_TICKS: 500, // Кулдаун клича поддержки (25 сек)
  PANIC_DURATION_TICKS: 120,       // Длительность паники при смерти медика (6 сек)
  HIT_AND_RUN_RETREAT_TICKS: 36,   // Длительность фазы отскока быстрого гладиатора (1.8 сек)
  BERSERK_RAGE_THRESHOLD: 0.45,    // Порог активации ярости берсерка (HP < 45%)
  RETIARIUS_NET_COOLDOWN_TICKS: 220, // Кулдаун сети ретиария (11 сек)
  RETIARIUS_NET_MAX_DIST: 12.0,    // Дистанция броска сети (блоков)
};

/**
 * @typedef {"COMBAT" | "GUARD" | "PROTECTING" | "FLANK" | "NEED_HEAL" | "PANIC" | "ENRAGED" | "HEALING"} AIState
 * @typedef {"MEDIC" | "ARCHER" | "TANK" | "SHIELD" | "FAST" | "BERSERK" | "RETIARIUS"} AIRole
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
     *   lastNetTick: number,
     *   hurtTimer: number,
     *   retreatTimer: number,
     *   panicTimer: number,
     *   enraged: boolean,
     *   lastHp: number
     * }>} */
    this.gladiators = new Map();
    this.currentTick = 0;
    this.trappedTarget = null;
    this.trappedUntilTick = 0;

    this._initEvents();
  }

  /**
   * Подписка на игровые события (урон, смерть)
   */
  _initEvents() {
    // Реакция на урон
    world.afterEvents.entityHurt.subscribe((event) => {
      const hurtEntity = event.hurtEntity;
      const damageSource = event.damageSource;
      if (!hurtEntity || !hurtEntity.isValid()) return;

      const record = this.gladiators.get(hurtEntity.id);
      if (record) {
        // Медик получил урон -> приоритетный отход и защитное зелье под нападающего
        if (record.role === "MEDIC") {
          record.hurtTimer = 60; // 3 секунды отступления
          record.state = "NEED_HEAL";
          try {
            if (damageSource && damageSource.damagingEntity) {
              const attacker = damageSource.damagingEntity;
              if (attacker.isValid() && attacker.typeId === "minecraft:player") {
                // Швыряет зелье замедления и слабости под игрока
                attacker.addEffect("slowness", 80, { amplifier: 1, showParticles: true });
                attacker.addEffect("weakness", 80, { amplifier: 0, showParticles: true });
                hurtEntity.dimension.spawnParticle("minecraft:splash_spell_emitter", attacker.location);
                hurtEntity.dimension.playSound("random.glass", attacker.location, { volume: 0.9, pitch: 1.0 });
              }
            }
          } catch (e) {}
        }

        // Проверка входа Берсерка в ярость при получении урона
        if (record.role === "BERSERK") {
          const healthComp = hurtEntity.getComponent("health");
          if (healthComp && (healthComp.currentValue / healthComp.effectiveMax) < AI_CONFIG.BERSERK_RAGE_THRESHOLD) {
            this._triggerBerserkRage(record);
          }
        }

        // Если ранили союзника -> ближайшие щитоносцы получают импульс PROTECTING
        const healthComp = hurtEntity.getComponent("health");
        if (healthComp && (healthComp.currentValue / healthComp.effectiveMax) < AI_CONFIG.NEED_HEAL_THRESHOLD) {
          if (record.role !== "MEDIC" && record.role !== "BERSERK") {
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
    else if (typeId === "colosseum:gladiator_berserk") role = "BERSERK";
    else if (typeId === "colosseum:gladiator_retiarius") role = "RETIARIUS";
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
      lastNetTick: -AI_CONFIG.RETIARIUS_NET_COOLDOWN_TICKS,
      hurtTimer: 0,
      retreatTimer: 0,
      panicTimer: 0,
      enraged: false,
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
    this.trappedTarget = null;
    this.trappedUntilTick = 0;
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

    // Сброс цели ловушки сети при истечении таймера
    if (this.currentTick > this.trappedUntilTick) {
      this.trappedTarget = null;
    }

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

    // Роль: БЕРСЕРК
    if (record.role === "BERSERK") {
      if (hpRatio < AI_CONFIG.BERSERK_RAGE_THRESHOLD && !record.enraged) {
        this._triggerBerserkRage(record);
      }
      if (record.enraged) {
        record.state = "ENRAGED";
        return; // В ярости не отступает к медику!
      }
      record.state = "COMBAT";
      return;
    }

    // Роль: МЕДИК
    if (record.role === "MEDIC") {
      if (record.hurtTimer > 0) {
        record.state = "NEED_HEAL"; // Отступает при опасности
      } else {
        record.state = "GUARD";     // Держится во 2-й линии
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
        if (distToMedic < 7.5) {
          record.state = "PROTECTING";
          record.protectTarget = activeMedic.entity;
          return;
        }
      }

      // Если рядом есть медик -> удержание строя
      if (activeMedic && this._getDistance(entity.location, activeMedic.entity.location) < 6.0) {
        record.state = "GUARD";
        return;
      }

      record.state = "COMBAT";
      return;
    }

    // Роль: РЕТИАРИЙ
    if (record.role === "RETIARIUS") {
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

    // 1. Поведение МЕДИКА (Приоритет: Самолечение, Зелья исцеления союзникам, Зелье замедления)
    if (record.role === "MEDIC") {
      this._runMedicBehavior(record, player);
      return;
    }

    // 2. Поведение БЕРСЕРКА в ярости
    if (record.role === "BERSERK") {
      this._runBerserkBehavior(record, player);
      return;
    }

    // 3. Поведение РЕТИАРИЯ (Бросок сети)
    if (record.role === "RETIARIUS") {
      this._runRetiariusBehavior(record, player);
      return;
    }

    // 4. Поведение при NEED_HEAL (отход к медику)
    if (record.state === "NEED_HEAL" && activeMedic && activeMedic.entity.isValid()) {
      const medicLoc = activeMedic.entity.location;
      const dist = this._getDistance(entity.location, medicLoc);
      if (dist > 3.0) {
        // Движение навстречу медику
        this._impulseTowards(entity, medicLoc, 0.26);
      }
      return;
    }

    // 5. Поведение быстрого гладиатора (Hit & Run + Акробатический прыжок Leap)
    if (record.role === "FAST") {
      this._runFastGladiatorBehavior(record, player);
      return;
    }

    // 6. Поведение щитоносцев (Shield Dash + Защитная аура около медика)
    if (record.role === "SHIELD" || record.role === "TANK") {
      this._runShieldBehavior(record, activeMedic, player);
      return;
    }

    // 7. Поведение лучника (кайтинг + синергия по пойманной цели)
    if (record.role === "ARCHER") {
      this._runArcherBehavior(record, player);
    }
  }

  /**
   * Полная логика Медика: самолечение, бросок зелий исцеления по площади, зелье замедления, клич
   */
  _runMedicBehavior(record, player) {
    const medic = record.entity;
    const health = medic.getComponent("health");
    if (!health) return;

    // 1. Самолечение Медика (Self-Heal): если HP < 60%
    const medicHpRatio = health.currentValue / health.effectiveMax;
    if (medicHpRatio < AI_CONFIG.MEDIC_SELF_HEAL_THRESHOLD) {
      if (this.currentTick - record.lastHealTick >= AI_CONFIG.MEDIC_HEAL_COOLDOWN_TICKS) {
        record.lastHealTick = this.currentTick;
        try {
          medic.addEffect("instant_health", 1, { amplifier: 0, showParticles: true });
          medic.addEffect("regeneration", 120, { amplifier: 1, showParticles: true }); // 6 сек регенерации II
          medic.dimension.spawnParticle("minecraft:heart_particle", medic.location);
          medic.dimension.spawnParticle("minecraft:villager_happy", medic.location);
          medic.dimension.playSound("random.potion.brewed", medic.location, { volume: 1.0, pitch: 1.2 });
        } catch (e) {}
      }
    }

    // 2. Самосохранение: если игрок подошел близко (< 5.5 блоков) -> отбегание и зелье замедления
    if (player && player.isValid()) {
      const distToPlayer = this._getDistance(medic.location, player.location);
      if (distToPlayer < 5.5) {
        this._impulseAway(medic, player.location, 0.35);
        medic.addEffect("speed", 40, { amplifier: 1, showParticles: false });

        // Если получил урон или игрок в упор -> бросает зелье замедления
        if (record.hurtTimer > 0) {
          try {
            player.addEffect("slowness", 80, { amplifier: 1, showParticles: true });
            player.addEffect("weakness", 80, { amplifier: 0, showParticles: true });
            medic.dimension.spawnParticle("minecraft:splash_spell_emitter", player.location);
            medic.dimension.playSound("random.glass", player.location, { volume: 0.9, pitch: 1.1 });
          } catch (e) {}
        }
        return;
      }
    }

    // 3. Дистанционное исцеление союзников (Splash Potion Throw): радиус до 15 блоков
    if (this.currentTick - record.lastHealTick >= AI_CONFIG.MEDIC_HEAL_COOLDOWN_TICKS) {
      let mostWounded = null;
      let lowestHpRatio = 1.0;

      for (const other of this.gladiators.values()) {
        if (other.entity.id === medic.id) continue;
        if (!other.entity.isValid()) continue;

        const otherHealth = other.entity.getComponent("health");
        if (!otherHealth) continue;

        const ratio = otherHealth.currentValue / otherHealth.effectiveMax;
        if (ratio < AI_CONFIG.HEAL_HP_THRESHOLD) {
          const dist = this._getDistance(medic.location, other.entity.location);
          if (dist <= AI_CONFIG.MEDIC_POTION_THROW_MAX_DIST && ratio < lowestHpRatio) {
            lowestHpRatio = ratio;
            mostWounded = other.entity;
          }
        }
      }

      // Бросаем зелье в зону раненого союзника
      if (mostWounded) {
        record.lastHealTick = this.currentTick;
        const targetLoc = mostWounded.location;
        const dist = this._getDistance(medic.location, targetLoc);

        try {
          // Звук броска и разбития флакона
          medic.dimension.playSound("random.bow", medic.location, { volume: 0.8, pitch: 0.8 });
          medic.dimension.playSound("random.glass", targetLoc, { volume: 1.0, pitch: 1.1 });
          medic.dimension.playSound("random.potion.brewed", targetLoc, { volume: 1.0, pitch: 1.2 });

          // Визуальные частицы взрыва исцеляющего зелья (AoE)
          medic.dimension.spawnParticle("minecraft:splash_spell_emitter", targetLoc);
          medic.dimension.spawnParticle("minecraft:heart_particle", targetLoc);
          medic.dimension.spawnParticle("minecraft:villager_happy", targetLoc);

          // Исцеляем всех союзников в радиусе падения зелья
          for (const ally of this.gladiators.values()) {
            if (!ally.entity.isValid()) continue;
            const distToSplash = this._getDistance(ally.entity.location, targetLoc);
            if (distToSplash <= AI_CONFIG.MEDIC_POTION_SPLASH_RADIUS) {
              ally.entity.addEffect("instant_health", 1, { amplifier: 0, showParticles: true });
              ally.entity.addEffect("regeneration", 120, { amplifier: 0, showParticles: true }); // 6 сек регенерации
              ally.entity.addEffect("resistance", 100, { amplifier: 0, showParticles: false });  // 5 сек стойкости
              medic.dimension.spawnParticle("minecraft:heart_particle", ally.entity.location);
            }
          }
        } catch (e) {}

        // Если раненый союзник далеко, медик аккуратно сближается
        if (dist > 6.0) {
          this._impulseTowards(medic, targetLoc, 0.22);
        }
      }
    }

    // 4. Клич поддержки (Horn Shout) раз в 25 секунд
    if (this.currentTick - record.lastShoutTick >= AI_CONFIG.MEDIC_SHOUT_COOLDOWN_TICKS) {
      record.lastShoutTick = this.currentTick;
      try {
        medic.dimension.playSound("item.horn.sound.0", medic.location, { volume: 1.0, pitch: 1.2 });
        // Бафф ближайших бойцов
        for (const other of this.gladiators.values()) {
          if (!other.entity.isValid()) continue;
          if (this._getDistance(medic.location, other.entity.location) <= 8.0) {
            other.entity.addEffect("resistance", 140, { amplifier: 0, showParticles: true }); // 7 сек стойкости
            other.entity.addEffect("speed", 120, { amplifier: 0, showParticles: false });      // 6 сек скорости
            medic.dimension.spawnParticle("minecraft:critical_hit_emitter", other.entity.location);
          }
        }
      } catch (e) {}
    }
  }

  /**
   * Активация неистовой ярости Берсерка
   */
  _triggerBerserkRage(record) {
    if (record.enraged) return;
    record.enraged = true;
    record.state = "ENRAGED";

    const entity = record.entity;
    try {
      // Оглушительный рык ярости
      entity.dimension.playSound("mob.ravager.roar", entity.location, { volume: 1.0, pitch: 1.4 });
      entity.dimension.spawnParticle("minecraft:mobflame_emitter", entity.location);
      entity.dimension.spawnParticle("minecraft:critical_hit_emitter", entity.location);

      // Баффы силы и скорости II
      entity.addEffect("strength", 300, { amplifier: 0, showParticles: true }); // 15 сек силы
      entity.addEffect("speed", 300, { amplifier: 1, showParticles: true });    // 15 сек скорости II

      // Синергия с Быстрыми гладиаторами: вдохновляет их скоростью
      for (const ally of this.gladiators.values()) {
        if (ally.role === "FAST" && ally.entity.isValid()) {
          if (this._getDistance(entity.location, ally.entity.location) <= 10.0) {
            ally.entity.addEffect("speed", 160, { amplifier: 0, showParticles: true });
            entity.dimension.spawnParticle("minecraft:critical_hit_emitter", ally.entity.location);
          }
        }
      }
    } catch (e) {}
  }

  /**
   * Поведение Берсерка в бою
   */
  _runBerserkBehavior(record, player) {
    const entity = record.entity;
    if (!player || !player.isValid()) return;

    // В ярости берсерк неудержимо бросается на игрока с увеличенной скоростью
    if (record.enraged) {
      this._impulseTowards(entity, player.location, 0.30);
      try {
        if (Math.random() < 0.25) {
          entity.dimension.spawnParticle("minecraft:critical_hit_emitter", entity.location);
        }
      } catch (e) {}
    }
  }

  /**
   * Поведение Ретиария: бросок сети и наведение отряда
   */
  _runRetiariusBehavior(record, player) {
    const entity = record.entity;
    if (!player || !player.isValid()) return;

    const dist = this._getDistance(entity.location, player.location);

    // Бросок сети (кулдаун 11 сек, дистанция 3-12 блоков)
    if (this.currentTick - record.lastNetTick >= AI_CONFIG.RETIARIUS_NET_COOLDOWN_TICKS) {
      if (dist >= 3.0 && dist <= AI_CONFIG.RETIARIUS_NET_MAX_DIST) {
        record.lastNetTick = this.currentTick;
        this.trappedTarget = player;
        this.trappedUntilTick = this.currentTick + 80; // 4 секунды опутания

        try {
          // Звук броска сети
          entity.dimension.playSound("random.bow", entity.location, { volume: 1.0, pitch: 0.7 });
          entity.dimension.playSound("mob.spider.say", player.location, { volume: 1.0, pitch: 1.3 });

          // Частицы паутины/сети
          entity.dimension.spawnParticle("minecraft:water_evaporation_bucket_emitter", player.location);
          entity.dimension.spawnParticle("minecraft:cloud_particle", player.location);

          // Эффект опутания (Slowness IV + Weakness)
          player.addEffect("slowness", 80, { amplifier: 3, showParticles: true });
          player.addEffect("weakness", 80, { amplifier: 0, showParticles: true });

          // Сигнал в actionbar игроку
          if (typeof player.onScreenDisplay?.setActionBar === "function") {
            player.onScreenDisplay.setActionBar("§c🕸 Ретиарий опутал вас сетью!§r");
          }

          // Синергия: все лучники и танки реагируют на пойманную жертву
          for (const ally of this.gladiators.values()) {
            if (ally.role === "ARCHER" && ally.entity.isValid()) {
              ally.entity.addEffect("speed", 60, { amplifier: 0, showParticles: false });
            } else if ((ally.role === "BERSERK" || ally.role === "TANK") && ally.entity.isValid()) {
              this._impulseTowards(ally.entity, player.location, 0.35); // Рывок к опутаному
            }
          }
        } catch (e) {}
      }
    }
  }

  /**
   * Поведение быстрого гладиатора (Hit & Run + Leap)
   */
  _runFastGladiatorBehavior(record, player) {
    const entity = record.entity;
    if (!player || !player.isValid()) return;

    const dist = this._getDistance(entity.location, player.location);

    // 1. Акробатический прыжок (Leap at target) при сближении с 3.5 до 6 блоков
    if (dist >= 3.5 && dist <= 6.0 && record.retreatTimer <= 0) {
      if (Math.random() < 0.20) {
        this._impulseTowards(entity, player.location, 0.45, 0.32);
        try {
          entity.dimension.playSound("mob.slime.attack", entity.location, { volume: 0.6, pitch: 1.2 });
        } catch (e) {}
      }
    }

    // 2. Отскок после удара (Hit & Run) при дистанции < 2.2 блока
    if (dist < 2.2 && record.retreatTimer <= 0) {
      record.retreatTimer = AI_CONFIG.HIT_AND_RUN_RETREAT_TICKS;
      record.state = "FLANK";
      this._impulseAway(entity, player.location, 0.36);
      try {
        entity.addEffect("speed", 30, { amplifier: 1, showParticles: false });
      } catch (e) {}
    }
  }

  /**
   * Поведение щитоносцев (Shield Dash + аура медика)
   */
  _runShieldBehavior(record, activeMedic, player) {
    const entity = record.entity;

    // Пассивная синергия с Медиком: если рядом с медиком (< 6 блоков), щитоносец получает стойкость
    if (activeMedic && activeMedic.entity.isValid()) {
      if (this._getDistance(entity.location, activeMedic.entity.location) <= 6.0) {
        try {
          entity.addEffect("resistance", 30, { amplifier: 0, showParticles: false });
        } catch (e) {}
      }
    }

    if (!player || !player.isValid()) return;
    const dist = this._getDistance(entity.location, player.location);

    // Рывок со щитом (Shield Dash): при открытии игрока на дистанции 3-5 блоков
    if (dist >= 3.0 && dist <= 5.5 && Math.random() < 0.15) {
      this._impulseTowards(entity, player.location, 0.32);
      try {
        entity.dimension.playSound("item.shield.block", entity.location, { volume: 0.8, pitch: 1.1 });
        entity.dimension.spawnParticle("minecraft:crit_smoke_emitter", entity.location);
      } catch (e) {}
    }

    // Перехват при PROTECTING
    if (record.state === "PROTECTING") {
      this._impulseTowards(entity, player.location, 0.25);
      if (dist < 3.5) {
        try {
          entity.triggerEvent("colosseum:start_blocking");
        } catch (e) {}
      }
    }
  }

  /**
   * Поведение лучника (кайтинг + синергия по сети)
   */
  _runArcherBehavior(record, player) {
    const entity = record.entity;
    if (!player || !player.isValid()) return;

    const distToPlayer = this._getDistance(entity.location, player.location);

    // Если игрок пойман в сеть Ретиария -> лучник стремится занять позицию и стреляет
    if (this.trappedTarget && this.trappedTarget.isValid() && this.trappedTarget.id === player.id) {
      if (distToPlayer > 12.0) {
        this._impulseTowards(entity, player.location, 0.22);
      }
      return;
    }

    // Обычный кайтинг к союзным танкам
    if (distToPlayer < 4.5) {
      const nearestTank = this._findNearestAllyWithRole(entity, ["TANK", "SHIELD"]);
      if (nearestTank) {
        this._impulseTowards(entity, nearestTank.location, 0.28);
      } else {
        this._impulseAway(entity, player.location, 0.28);
      }
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
          // Дезориентация / ярость: кратковременная паника и ускорение
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
  _impulseTowards(entity, targetLoc, strength = 0.2, upward = 0.0) {
    try {
      const dx = targetLoc.x - entity.location.x;
      const dz = targetLoc.z - entity.location.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0.1) {
        entity.applyImpulse({
          x: (dx / len) * strength,
          y: upward,
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
          y: 0.06,
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
