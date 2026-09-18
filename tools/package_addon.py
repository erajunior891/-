import json
import os
import sys
import zipfile

def validate_json_files():
    print("=== Проверка JSON файлов ===")
    errors = 0
    checked = 0
    for root, dirs, files in os.walk("."):
        if ".git" in root or "tools" in root or "brain" in root:
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
    print(f"Проверено JSON файлов: {checked}, Ошибок: {errors}")
    return errors == 0

def create_zip(source_dir, output_filename, prefix=""):
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, source_dir)
                archive_path = os.path.join(prefix, rel_path) if prefix else rel_path
                zipf.write(file_path, archive_path)
    print(f"Создан архив: {output_filename}")

def build_mcaddon():
    if not validate_json_files():
        print("Сборка остановлена из-за ошибок в JSON!")
        sys.exit(1)

    print("\n=== Сборка пакетов для Minecraft Bedrock ===")
    
    # 1. Отдельный Colosseum_BP.mcpack
    create_zip("Colosseum_BP", "Colosseum_BP.mcpack")
    
    # 2. Отдельный Colosseum_RP.mcpack
    create_zip("Colosseum_RP", "Colosseum_RP.mcpack")
    
    # 3. Полный Colosseum.mcaddon для Android и ПК
    mcaddon_path = "Colosseum.mcaddon"
    with zipfile.ZipFile(mcaddon_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # Добавляем папки BP и RP внутрь .mcaddon
        for pack_name in ["Colosseum_BP", "Colosseum_RP"]:
            for root, dirs, files in os.walk(pack_name):
                for file in files:
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, ".")
                    zipf.write(file_path, rel_path)
                    
    size_kb = os.path.getsize(mcaddon_path) / 1024
    print(f"\n[УСПЕХ] Готовый файл аддона: {mcaddon_path} ({size_kb:.1f} KB)")
    print("На Android этот файл можно сразу открыть через любой проводник, и Minecraft автоматически установит оба пакета!")

if __name__ == "__main__":
    build_mcaddon()
