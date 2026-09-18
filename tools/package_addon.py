import json
import os
import sys
import zipfile

def validate_addon_integrity():
    print("=== 1. Проверка синтаксиса JSON ===")
    errors = 0
    checked = 0
    for root, dirs, files in os.walk("."):
        if ".git" in root or "tools" in root or "brain" in root or "Запчасти" in root:
            continue
        for file in files:
            if file.endswith(".json"):
                path = os.path.join(root, file)
                checked += 1
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        json.load(f)
                except Exception as e:
                    print(f"[ОШИБКА] Некорректный JSON в {path}: {e}")
                    errors += 1
    print(f"Проверено JSON файлов: {checked}, Синтаксических ошибок: {errors}")

    print("\n=== 2. Семантическая проверка целостности ресурсов ===")
    semantic_errors = 0

    # Проверка существования текстур, на которые ссылается item_texture.json
    item_tex_path = "Colosseum_RP/textures/item_texture.json"
    if os.path.exists(item_tex_path):
        with open(item_tex_path, "r", encoding="utf-8") as f:
            item_tex_data = json.load(f).get("texture_data", {})
            for key, val in item_tex_data.items():
                tex_ref = val.get("textures")
                if isinstance(tex_ref, str):
                    # Bedrock пути могут быть без расширения .png
                    cand1 = os.path.join("Colosseum_RP", tex_ref + ".png")
                    cand2 = os.path.join("Colosseum_RP", tex_ref)
                    if not (os.path.exists(cand1) or os.path.exists(cand2)):
                        print(f"[ОШИБКА РЕСУРСОВ] item_texture.json ссылается на отсутствующую текстуру: {tex_ref}")
                        semantic_errors += 1

    # Проверка client_entity на render_controllers
    entity_dir = "Colosseum_RP/entity"
    rc_dir = "Colosseum_RP/render_controllers"
    available_rcs = set()
    if os.path.exists(rc_dir):
        for f in os.listdir(rc_dir):
            if f.endswith(".json"):
                with open(os.path.join(rc_dir, f), "r", encoding="utf-8") as rcf:
                    rc_json = json.load(rcf)
                    available_rcs.update(rc_json.get("render_controllers", {}).keys())

    if os.path.exists(entity_dir):
        for f in os.listdir(entity_dir):
            if f.endswith(".json"):
                with open(os.path.join(entity_dir, f), "r", encoding="utf-8") as ef:
                    edata = json.load(ef).get("minecraft:client_entity", {}).get("description", {})
                    for rc in edata.get("render_controllers", []):
                        if rc not in available_rcs and not rc.startswith("controller.render.item"):
                            print(f"[ОШИБКА РЕСУРСОВ] {f} ссылается на несуществующий render_controller: {rc}")
                            semantic_errors += 1

    print(f"Семантических ошибок: {semantic_errors}")
    return (errors + semantic_errors) == 0

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
