/**
 * Главная точка входа аддона «Колизей»
 * Версия для Minecraft Bedrock 1.26.51+ (Android / Win / iOS)
 * Поддержка мультиплеера
 */
import { world, system } from "@minecraft/server";
import { ArenaManager } from "./arena_manager.js";

const arena = new ArenaManager();

// Обработка использования боевого рога старта боя
world.afterEvents.itemUse.subscribe((event) => {
  const item = event.itemStack;
  const player = event.source;

  if (item && item.typeId === "colosseum:start_fight") {
    arena.startFight(player);
  }
});

// Обработка гибели мобов для трекинга волн и убийств
world.afterEvents.entityDie.subscribe((event) => {
  const deadEntity = event.deadEntity;
  const damageSource = event.damageSource;

  if (deadEntity) {
    arena.handleEntityDeath(deadEntity, damageSource);
  }
});

// Периодический цикл для Actionbar HUD и таймеров волн (раз в 20 тиков = 1 секунда)
system.runInterval(() => {
  arena.tick();
}, 20);

console.warn("§6[Колизей]§r §aАддон успешно загружен и готов к сражениям! Версия 1.26+ (Multiplayer)§r");
