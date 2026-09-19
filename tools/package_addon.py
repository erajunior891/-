import json
import os
import re
import sys
import zipfile

# Windows cp1251/cp866 консоли не поддерживают Unicode символы (→, ✅, ❌)
# Принудительно переключаем stdout на UTF-8
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')


# ─── Утилиты ───────────────────────────────────────────────────────────

RP = "Colosseum_RP"
BP = "Colosseum_BP"

SKIP_DIRS = {".git", "tools", "brain", "Запчасти", ".agents", "node_modules"}


def _load_json(path):
    """Безопасная загрузка JSON файла."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _walk_json(base, ext=".json"):
    """Генератор (путь, данные) по всем JSON файлам внутри base."""
    if not os.path.isdir(base):
        return
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fname in files:
            if fname.endswith(ext):
                path = os.path.join(root, fname)
                data = _load_json(path)
                if data is not None:
                    yield path, data


def _texture_exists(rp_relative_path):
    """Проверяет, существует ли файл текстуры (с или без .png)."""
    full = os.path.join(RP, rp_relative_path)
    return os.path.exists(full) or os.path.exists(full + ".png")


def _collect_geometry_ids():
    """Собирает все geometry.* идентификаторы из моделей RP."""
    ids = set()
    for path, data in _walk_json(os.path.join(RP, "models")):
        # format_version 1.12.0+ : "minecraft:geometry" → list of {"description": {"identifier": ...}}
        for geo in data.get("minecraft:geometry", []):
            desc = geo.get("description", {})
            gid = desc.get("identifier")
            if gid:
                ids.add(gid)
        # Legacy format_version 1.8.0 / 1.10.0 : top-level keys starting with "geometry."
        for key in data:
            if key.startswith("geometry."):
                ids.add(key)
    return ids


def _collect_animation_ids():
    """Собирает все animation.* идентификаторы из файлов анимаций RP."""
    ids = set()
    for path, data in _walk_json(os.path.join(RP, "animations")):
        for key in data.get("animations", {}):
            ids.add(key)
    return ids


def _collect_anim_controller_ids():
    """Собирает все controller.animation.* идентификаторы."""
    ids = set()
    for path, data in _walk_json(os.path.join(RP, "animation_controllers")):
        for key in data.get("animation_controllers", {}):
            ids.add(key)
    return ids


def _collect_render_controller_ids():
    """Собирает все controller.render.* идентификаторы."""
    ids = set()
    for path, data in _walk_json(os.path.join(RP, "render_controllers")):
        for key in data.get("render_controllers", {}):
            ids.add(key)
    return ids


def _collect_bp_item_ids():
    """Собирает все identifier из items/ BP."""
    ids = set()
    for path, data in _walk_json(os.path.join(BP, "items")):
        desc = data.get("minecraft:item", {}).get("description", {})
        iid = desc.get("identifier")
        if iid:
            ids.add(iid)
    return ids


def _collect_bp_entity_ids():
    """Собирает все identifier из entities/ BP."""
    ids = set()
    for path, data in _walk_json(os.path.join(BP, "entities")):
        desc = data.get("minecraft:entity", {}).get("description", {})
        eid = desc.get("identifier")
        if eid:
            ids.add(eid)
    return ids


# ─── Проверки ──────────────────────────────────────────────────────────

def check_json_syntax():
    """1. Проверка синтаксиса JSON во всех пакетах."""
    print("=== 1. Проверка синтаксиса JSON ===")
    errors = 0
    checked = 0
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for file in files:
            if file.endswith(".json"):
                path = os.path.join(root, file)
                checked += 1
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        json.load(f)
                except Exception as e:
                    print(f"  [ОШИБКА] Некорректный JSON: {path}\n           {e}")
                    errors += 1
    print(f"  Проверено: {checked}, ошибок: {errors}")
    return errors


def check_item_textures():
    """2a. item_texture.json → PNG файлы."""
    print("\n--- 2a. item_texture.json → текстуры ---")
    errors = 0
    path = os.path.join(RP, "textures", "item_texture.json")
    if not os.path.exists(path):
        print("  [ПРОПУСК] Файл item_texture.json не найден")
        return 0
    data = _load_json(path)
    if not data:
        return 0
    for key, val in data.get("texture_data", {}).items():
        tex_ref = val.get("textures")
        if isinstance(tex_ref, str) and not _texture_exists(tex_ref):
            print(f"  [ОШИБКА] item_texture '{key}' → отсутствует: {tex_ref}")
            errors += 1
        elif isinstance(tex_ref, dict):
            p = tex_ref.get("path", "")
            if p and not _texture_exists(p):
                print(f"  [ОШИБКА] item_texture '{key}' → отсутствует: {p}")
                errors += 1
    if errors == 0:
        print("  OK")
    return errors


def check_client_entity_render_controllers(available_rcs):
    """2b. client_entity → render_controllers."""
    print("\n--- 2b. client_entity → render_controllers ---")
    errors = 0
    for path, data in _walk_json(os.path.join(RP, "entity")):
        desc = data.get("minecraft:client_entity", {}).get("description", {})
        fname = os.path.basename(path)
        for rc in desc.get("render_controllers", []):
            # render_controllers могут быть строкой или dict с условием
            rc_id = rc if isinstance(rc, str) else list(rc.keys())[0] if isinstance(rc, dict) else None
            if rc_id and rc_id not in available_rcs:
                # Пропускаем стандартные item render controllers
                if rc_id.startswith("controller.render.item"):
                    continue
                print(f"  [ОШИБКА] {fname} → render_controller не найден: {rc_id}")
                errors += 1
    if errors == 0:
        print("  OK")
    return errors


def check_client_entity_geometry(available_geos):
    """2c. client_entity → geometry."""
    print("\n--- 2c. client_entity → geometry ---")
    errors = 0
    for path, data in _walk_json(os.path.join(RP, "entity")):
        desc = data.get("minecraft:client_entity", {}).get("description", {})
        fname = os.path.basename(path)
        for slot, geo_id in desc.get("geometry", {}).items():
            if geo_id not in available_geos:
                # Пропускаем стандартные ванильные геометрии
                if geo_id.startswith("geometry.humanoid"):
                    continue
                print(f"  [ОШИБКА] {fname} [geometry.{slot}] → не найдена: {geo_id}")
                errors += 1
    if errors == 0:
        print("  OK")
    return errors


def check_client_entity_textures():
    """2d. client_entity → textures (файлы)."""
    print("\n--- 2d. client_entity → текстуры ---")
    errors = 0
    for path, data in _walk_json(os.path.join(RP, "entity")):
        desc = data.get("minecraft:client_entity", {}).get("description", {})
        fname = os.path.basename(path)
        for slot, tex_path in desc.get("textures", {}).items():
            if not _texture_exists(tex_path):
                print(f"  [ОШИБКА] {fname} [textures.{slot}] → файл не найден: {tex_path}")
                errors += 1
    if errors == 0:
        print("  OK")
    return errors


def check_client_entity_animations(available_anims, available_ac):
    """2e. client_entity → animations (идентификаторы анимаций и контроллеров)."""
    print("\n--- 2e. client_entity → animations ---")
    errors = 0
    all_known = available_anims | available_ac
    for path, data in _walk_json(os.path.join(RP, "entity")):
        desc = data.get("minecraft:client_entity", {}).get("description", {})
        fname = os.path.basename(path)
        for short_name, anim_id in desc.get("animations", {}).items():
            if anim_id not in all_known:
                # Пропускаем стандартные ванильные анимации
                if anim_id.startswith("animation.humanoid.") or anim_id.startswith("animation.player."):
                    continue
                print(f"  [ОШИБКА] {fname} [animations.{short_name}] → не найдена: {anim_id}")
                errors += 1
    if errors == 0:
        print("  OK")
    return errors


def check_anim_controller_animations(available_anims):
    """2f. animation_controller → animation (ссылки по short name проверить нельзя, но можно проверить прямые)."""
    print("\n--- 2f. animation_controllers → animations ---")
    errors = 0
    # Animation controllers reference animations by short names defined in client_entity,
    # so direct cross-ref isn't fully possible here. We check for obvious broken patterns.
    for path, data in _walk_json(os.path.join(RP, "animation_controllers")):
        fname = os.path.basename(path)
        for ac_id, ac_def in data.get("animation_controllers", {}).items():
            for state_name, state_def in ac_def.get("states", {}).items():
                anims = state_def.get("animations", [])
                for anim_ref in anims:
                    # Если ссылка — полный ID (animation.*), проверяем
                    ref = anim_ref if isinstance(anim_ref, str) else list(anim_ref.keys())[0] if isinstance(anim_ref, dict) else None
                    if ref and ref.startswith("animation.") and ref not in available_anims:
                        print(f"  [ОШИБКА] {fname} [{ac_id}] state '{state_name}' → анимация не найдена: {ref}")
                        errors += 1
    if errors == 0:
        print("  OK (short-name ссылки проверяются через client_entity)")
    return errors


def check_attachable_geometry(available_geos):
    """2g. attachable → geometry."""
    print("\n--- 2g. attachable → geometry ---")
    errors = 0
    for path, data in _walk_json(os.path.join(RP, "attachables")):
        desc = data.get("minecraft:attachable", {}).get("description", {})
        fname = os.path.basename(path)
        for slot, geo_id in desc.get("geometry", {}).items():
            if geo_id not in available_geos:
                print(f"  [ОШИБКА] {fname} [geometry.{slot}] → не найдена: {geo_id}")
                errors += 1
        # Также проверяем текстуры attachable
        for slot, tex_path in desc.get("textures", {}).items():
            # Пропускаем стандартные enchanted glint текстуры
            if "enchanted" in slot or "misc/" in tex_path:
                continue
            if not _texture_exists(tex_path):
                print(f"  [ОШИБКА] {fname} [textures.{slot}] → файл не найден: {tex_path}")
                errors += 1
    if errors == 0:
        print("  OK")
    return errors


def check_render_controller_textures():
    """2h. render_controller → texture (проверка Texture.* ссылок на Molang patterns)."""
    print("\n--- 2h. render_controllers → текстурные слоты ---")
    errors = 0
    # Render controllers reference textures/geometry by Molang short names (Texture.default, Geometry.default)
    # which resolve through client_entity. Direct path checks aren't meaningful here,
    # but we can flag any Array.<string> patterns that look like absolute paths.
    for path, data in _walk_json(os.path.join(RP, "render_controllers")):
        fname = os.path.basename(path)
        for rc_id, rc_def in data.get("render_controllers", {}).items():
            textures = rc_def.get("textures", [])
            for tex in textures:
                if isinstance(tex, str) and tex.startswith("textures/") and not _texture_exists(tex):
                    print(f"  [ОШИБКА] {fname} [{rc_id}] → текстура не найдена: {tex}")
                    errors += 1
    if errors == 0:
        print("  OK (Molang ссылки Texture.* проверяются через client_entity)")
    return errors


def check_manifest_uuids():
    """2i. manifest.json → UUID уникальность и dependency связи."""
    print("\n--- 2i. manifest.json → UUID и dependencies ---")
    errors = 0

    bp_manifest = _load_json(os.path.join(BP, "manifest.json"))
    rp_manifest = _load_json(os.path.join(RP, "manifest.json"))

    if not bp_manifest:
        print("  [ОШИБКА] Не удалось загрузить BP/manifest.json")
        return 1
    if not rp_manifest:
        print("  [ОШИБКА] Не удалось загрузить RP/manifest.json")
        return 1

    # Собираем все UUID из обоих манифестов
    all_uuids = []
    for label, manifest in [("BP", bp_manifest), ("RP", rp_manifest)]:
        header_uuid = manifest.get("header", {}).get("uuid", "")
        if header_uuid:
            all_uuids.append((label + "/header", header_uuid))
        for i, mod in enumerate(manifest.get("modules", [])):
            mod_uuid = mod.get("uuid", "")
            if mod_uuid:
                all_uuids.append((f"{label}/module[{i}]", mod_uuid))

    # Проверка уникальности UUID
    uuid_map = {}
    for source, uuid in all_uuids:
        if uuid in uuid_map:
            print(f"  [ОШИБКА] Дублирующийся UUID: {uuid}\n           → {uuid_map[uuid]} и {source}")
            errors += 1
        else:
            uuid_map[uuid] = source

    # Проверка: BP зависимость → RP header UUID
    rp_header_uuid = rp_manifest.get("header", {}).get("uuid", "")
    bp_deps = bp_manifest.get("dependencies", [])
    rp_linked = False
    for dep in bp_deps:
        dep_uuid = dep.get("uuid", "")
        if dep_uuid and dep_uuid == rp_header_uuid:
            rp_linked = True
        # Проверяем module_name зависимости (типа @minecraft/server)
        module_name = dep.get("module_name", "")
        if module_name:
            continue  # Системная зависимость, не проверяем UUID
        # Проверяем, что UUID зависимости существует в одном из манифестов
        if dep_uuid and dep_uuid not in uuid_map and dep_uuid != rp_header_uuid:
            print(f"  [ОШИБКА] BP dependency UUID не найден ни в одном манифесте: {dep_uuid}")
            errors += 1

    if not rp_linked and rp_header_uuid:
        print(f"  [ПРЕДУПРЕЖДЕНИЕ] BP не ссылается на RP header UUID ({rp_header_uuid}) в dependencies")

    # Проверка: script entry point существует
    for mod in bp_manifest.get("modules", []):
        if mod.get("type") == "script":
            entry = mod.get("entry", "")
            if entry:
                entry_path = os.path.join(BP, entry)
                if not os.path.exists(entry_path):
                    print(f"  [ОШИБКА] Script entry point не найден: {entry}")
                    errors += 1

    if errors == 0:
        print("  OK")
    return errors


def check_loot_tables(known_items, known_entities):
    """2j. loot_table → item/entity существование."""
    print("\n--- 2j. loot_tables → items/entities ---")
    errors = 0

    # Известные ванильные предметы (неполный список, но покрывает частые)
    vanilla_items = {
        "minecraft:iron_sword", "minecraft:diamond_sword", "minecraft:golden_sword",
        "minecraft:iron_helmet", "minecraft:diamond_helmet", "minecraft:golden_helmet",
        "minecraft:iron_chestplate", "minecraft:diamond_chestplate", "minecraft:golden_chestplate",
        "minecraft:iron_leggings", "minecraft:diamond_leggings", "minecraft:golden_leggings",
        "minecraft:iron_boots", "minecraft:diamond_boots", "minecraft:golden_boots",
        "minecraft:leather_helmet", "minecraft:leather_chestplate", "minecraft:leather_leggings", "minecraft:leather_boots",
        "minecraft:chainmail_helmet", "minecraft:chainmail_chestplate", "minecraft:chainmail_leggings", "minecraft:chainmail_boots",
        "minecraft:netherite_helmet", "minecraft:netherite_chestplate", "minecraft:netherite_leggings", "minecraft:netherite_boots",
        "minecraft:netherite_sword", "minecraft:wooden_sword", "minecraft:stone_sword",
        "minecraft:wooden_axe", "minecraft:stone_axe", "minecraft:iron_axe", "minecraft:golden_axe", "minecraft:diamond_axe", "minecraft:netherite_axe",
        "minecraft:bow", "minecraft:crossbow", "minecraft:arrow", "minecraft:shield", "minecraft:trident",
        "minecraft:apple", "minecraft:golden_apple", "minecraft:enchanted_golden_apple",
        "minecraft:bone", "minecraft:rotten_flesh", "minecraft:string",
        "minecraft:gold_ingot", "minecraft:iron_ingot", "minecraft:diamond", "minecraft:emerald",
        "minecraft:gold_nugget", "minecraft:iron_nugget", "minecraft:netherite_scrap", "minecraft:netherite_ingot",
        "minecraft:potion", "minecraft:splash_potion",
        "minecraft:totem_of_undying",
    }
    all_items = known_items | vanilla_items

    for path, data in _walk_json(os.path.join(BP, "loot_tables")):
        fname = os.path.relpath(path, BP)
        for pool in data.get("pools", []):
            for entry in pool.get("entries", []):
                entry_type = entry.get("type", "")
                name = entry.get("name", "")
                if not name:
                    continue
                if entry_type == "item":
                    if name not in all_items:
                        print(f"  [ОШИБКА] {fname} → предмет не найден: {name}")
                        errors += 1
                elif entry_type == "loot_table":
                    # Ссылка на вложенный loot_table
                    lt_path = os.path.join(BP, name)
                    if not os.path.exists(lt_path):
                        print(f"  [ОШИБКА] {fname} → вложенная loot_table не найдена: {name}")
                        errors += 1

    if errors == 0:
        print("  OK")
    return errors


def check_bp_entity_loot_refs():
    """2k. BP entity → loot/equipment таблицы существуют."""
    print("\n--- 2k. BP entity → loot/equipment таблицы ---")
    errors = 0
    for path, data in _walk_json(os.path.join(BP, "entities")):
        fname = os.path.basename(path)
        components = data.get("minecraft:entity", {}).get("components", {})
        for key in ("minecraft:loot", "minecraft:equipment"):
            ref = components.get(key, {})
            table = ref.get("table", "")
            if table:
                table_path = os.path.join(BP, table)
                if not os.path.exists(table_path):
                    print(f"  [ОШИБКА] {fname} [{key}] → таблица не найдена: {table}")
                    errors += 1
    if errors == 0:
        print("  OK")
    return errors


# ─── Главная функция валидации ──────────────────────────────────────────

def validate_addon_integrity():
    """Полная валидация аддона: синтаксис + семантика."""
    total_errors = 0

    # Фаза 1: Синтаксис JSON
    total_errors += check_json_syntax()

    # Подготовка: собираем все доступные идентификаторы
    print("\n=== 2. Семантическая проверка целостности ресурсов ===")
    available_geos = _collect_geometry_ids()
    available_anims = _collect_animation_ids()
    available_acs = _collect_anim_controller_ids()
    available_rcs = _collect_render_controller_ids()
    known_items = _collect_bp_item_ids()
    known_entities = _collect_bp_entity_ids()

    print(f"  Найдено: {len(available_geos)} геометрий, {len(available_anims)} анимаций, "
          f"{len(available_acs)} контроллеров анимаций, {len(available_rcs)} рендер-контроллеров, "
          f"{len(known_items)} предметов, {len(known_entities)} сущностей")

    # Фаза 2: Все семантические проверки
    total_errors += check_item_textures()                                # 2a
    total_errors += check_client_entity_render_controllers(available_rcs) # 2b
    total_errors += check_client_entity_geometry(available_geos)          # 2c
    total_errors += check_client_entity_textures()                       # 2d
    total_errors += check_client_entity_animations(available_anims, available_acs)  # 2e
    total_errors += check_anim_controller_animations(available_anims)     # 2f
    total_errors += check_attachable_geometry(available_geos)             # 2g
    total_errors += check_render_controller_textures()                   # 2h
    total_errors += check_manifest_uuids()                               # 2i
    total_errors += check_loot_tables(known_items, known_entities)       # 2j
    total_errors += check_bp_entity_loot_refs()                          # 2k

    print(f"\n{'='*50}")
    if total_errors == 0:
        print(f"✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ (0 ошибок)")
    else:
        print(f"❌ НАЙДЕНО ОШИБОК: {total_errors}")
    print(f"{'='*50}")

    return total_errors == 0


def create_zip(source_dir, output_filename, prefix=""):
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, source_dir)
                archive_path = os.path.join(prefix, rel_path) if prefix else rel_path
                zipf.write(file_path, archive_path)
    print(f"Создан пакет: {output_filename}")

def build_mcaddon():
    if not validate_addon_integrity():
        print("[ОТМЕНА] Сборка остановлена из-за ошибок валидации!")
        sys.exit(1)

    print("\n=== 3. Сборка пакетов для Minecraft Bedrock ===")
    
    # 1. Colosseum_BP.mcpack (содержимое папки в корне)
    bp_mcpack = "Colosseum_BP.mcpack"
    create_zip("Colosseum_BP", bp_mcpack)
    
    # 2. Colosseum_RP.mcpack (содержимое папки в корне)
    rp_mcpack = "Colosseum_RP.mcpack"
    create_zip("Colosseum_RP", rp_mcpack)
    
    # 3. Colosseum.mcaddon (по стандарту Microsoft: ZIP, содержащий .mcpack файлы!)
    mcaddon_path = "Colosseum.mcaddon"
    with zipfile.ZipFile(mcaddon_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        zipf.write(bp_mcpack, arcname=os.path.basename(bp_mcpack))
        zipf.write(rp_mcpack, arcname=os.path.basename(rp_mcpack))
                    
    size_kb = os.path.getsize(mcaddon_path) / 1024
    print(f"\n[УСПЕХ] Готовый .mcaddon сформирован по спецификации: {mcaddon_path} ({size_kb:.1f} KB)")
    print("Содержимое архива:")
    with zipfile.ZipFile(mcaddon_path, 'r') as z:
        for name in z.namelist():
            print(f" - {name}")

if __name__ == "__main__":
    build_mcaddon()
