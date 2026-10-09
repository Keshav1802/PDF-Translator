"""
Extension Packaging Script
Generates a single, unified .zip file for both Google Chrome Web Store and Mozilla Firefox AMO:
pdf-translator-extension.zip
Ensures 100% POSIX forward slashes ('/') in all archive headers.
"""

import os
import zipfile

OUTPUT_ZIP = 'pdf-translator-extension.zip'

INCLUDE_ITEMS = [
    'manifest.json',
    'background',
    'popup',
    'viewer',
    'services',
    'lib',
    'icons',
    'sample_french_article.pdf'
]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def build_package():
    # Clean up any old browser-specific zips so only one package exists
    for old_zip in ['pdf-translator-firefox.zip', 'pdf-translator-chrome.zip', OUTPUT_ZIP]:
        old_path = os.path.join(BASE_DIR, old_zip)
        if os.path.exists(old_path):
            os.remove(old_path)
            print(f"Removed old file: {old_zip}")

    zip_path = os.path.join(BASE_DIR, OUTPUT_ZIP)
    print(f"\nBuilding single unified package: {OUTPUT_ZIP}...")

    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zipf:
        for item in INCLUDE_ITEMS:
            item_path = os.path.join(BASE_DIR, item)
            if not os.path.exists(item_path):
                print(f"  [WARN] Skipping missing item: {item}")
                continue

            if os.path.isfile(item_path):
                arcname = item.replace('\\', '/')
                zipf.write(item_path, arcname)
                print(f"  + Added file: {arcname}")
            elif os.path.isdir(item_path):
                for root, _, files in os.walk(item_path):
                    for file in files:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, BASE_DIR)
                        arcname = rel_path.replace('\\', '/')
                        zipf.write(full_path, arcname)
                        print(f"  + Added file: {arcname}")

    # Verify all entries strictly use forward slashes
    with zipfile.ZipFile(zip_path, 'r') as verify_zip:
        for entry in verify_zip.infolist():
            if '\\' in entry.filename:
                raise ValueError(f"Found illegal backslash in zip entry: {entry.filename}")

    size_kb = os.path.getsize(zip_path) / 1024
    print(f"\n[SUCCESS] Single archive created: {OUTPUT_ZIP} ({size_kb:.1f} KB)")
    print("Ready for upload to BOTH Google Chrome Web Store and Mozilla Firefox Add-ons (AMO).")

if __name__ == '__main__':
    build_package()
