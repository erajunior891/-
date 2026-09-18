/**
 * Экономика и вспомогательные функции наград для игроков
 */
import { ItemStack, world } from "@minecraft/server";

export class EconomyManager {
  /**
   * Выдать сестерции игроку
   * @param {import("@minecraft/server").Player} player
   * @param {number} amount
   */
  static giveCoins(player, amount) {
    if (!player || !player.isValid() || amount <= 0) return;

    try {
      const inventory = player.getComponent("inventory");
      if (inventory && inventory.container) {
        let remaining = amount;
        while (remaining > 0) {
          const batch = Math.min(remaining, 64);
          const item = new ItemStack("colosseum:coin", batch);
          const leftover = inventory.container.addItem(item);
          if (leftover && leftover.amount > 0) {
            // Если инвентарь полон, спавним монеты под игроком
            player.dimension.spawnItem(leftover, player.location);
          }
          remaining -= batch;
        }
      } else {
        const item = new ItemStack("colosseum:coin", amount);
        player.dimension.spawnItem(item, player.location);
      }

      player.sendMessage(`§6+${amount} Сестерциев!§r (Валюта арены получена)`);
      player.playSound("random.orb", { volume: 0.8, pitch: 1.2 });
    } catch (e) {
      console.warn(`Ошибка при выдаче монет игроку: ${e}`);
    }
  }

  /**
   * Выдать триумфальный кубок за победу над боссом
   * @param {import("@minecraft/server").Player} player
   */
  static giveTrophy(player) {
    if (!player || !player.isValid()) return;

    try {
      const inventory = player.getComponent("inventory");
      const trophy = new ItemStack("colosseum:trophy", 1);
      if (inventory && inventory.container) {
        const leftover = inventory.container.addItem(trophy);
        if (leftover && leftover.amount > 0) {
          player.dimension.spawnItem(leftover, player.location);
        }
      } else {
        player.dimension.spawnItem(trophy, player.location);
      }

      player.sendMessage("§e🏆 Вы получили Кубок Триумфатора Колизея!§r");
    } catch (e) {
      console.warn(`Ошибка при выдаче трофея: ${e}`);
    }
  }

  /**
   * Отправить заголовок на экран списку игроков
   */
  static broadcastTitle(players, title, subtitle = "") {
    for (const player of players) {
      if (player.isValid()) {
        player.onScreenDisplay.setTitle(title, {
          fadeInDuration: 10,
          stayDuration: 50,
          fadeOutDuration: 15,
          subtitle: subtitle
        });
      }
    }
  }

  /**
   * Проиграть звук списку игроков
   */
  static broadcastSound(players, soundName, volume = 1.0, pitch = 1.0) {
    for (const player of players) {
      if (player.isValid()) {
        player.playSound(soundName, { volume, pitch });
      }
    }
  }

  /**
   * Отправить текст в Actionbar
   */
  static broadcastActionbar(players, text) {
    for (const player of players) {
      if (player.isValid()) {
        player.onScreenDisplay.setActionBar(text);
      }
    }
  }
}
