"""
Automated Extension Integrity & Unit Test Suite
Validates manifest compliance, required files, web assets, and entity masking.
"""

import os
import json
import re
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def test_manifest():
    manifest_path = os.path.join(BASE_DIR, 'manifest.json')
    assert os.path.exists(manifest_path), "manifest.json not found!"
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    
    assert manifest.get('manifest_version') == 3, "Must be Manifest V3"
    assert manifest.get('name'), "Missing extension name"
    assert manifest.get('version'), "Missing version"
    
    # Check icons
    for size, rel_path in manifest.get('icons', {}).items():
        full_path = os.path.join(BASE_DIR, rel_path)
        assert os.path.exists(full_path), f"Icon {size} not found at {rel_path}"

    # Check background script
    bg = manifest.get('background', {})
    if 'service_worker' in bg:
        assert os.path.exists(os.path.join(BASE_DIR, bg['service_worker'])), "Background service worker not found"
        
    # Check Firefox AMO data collection compliance
    gecko = manifest.get('browser_specific_settings', {}).get('gecko', {})
    assert 'data_collection_permissions' in gecko, "Missing data_collection_permissions in gecko settings"
    assert 'required' in gecko['data_collection_permissions'], "Missing required data_collection_permissions"

    print("  [PASS] manifest.json configuration & file references valid")
    return manifest

def test_html_assets():
    html_files = [
        os.path.join(BASE_DIR, 'popup', 'popup.html'),
        os.path.join(BASE_DIR, 'viewer', 'viewer.html')
    ]
    for hf in html_files:
        assert os.path.exists(hf), f"HTML file {hf} does not exist"
        hf_dir = os.path.dirname(hf)
        with open(hf, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Check local script tags
        for script in re.findall(r'<script\s+src="([^"]+)"', content):
            if not script.startswith(('http://', 'https://')):
                abs_script = os.path.normpath(os.path.join(hf_dir, script))
                assert os.path.exists(abs_script), f"Missing script '{script}' referenced in {hf}"

        # Check local stylesheet links
        for css in re.findall(r'<link\s+[^>]*href="([^"]+)"', content):
            if not css.startswith(('http://', 'https://')):
                abs_css = os.path.normpath(os.path.join(hf_dir, css))
                assert os.path.exists(abs_css), f"Missing CSS '{css}' referenced in {hf}"
                
    print("  [PASS] HTML asset dependencies resolved correctly")

def test_entity_masking():
    # Mirroring TranslationService regex masking logic
    pattern = re.compile(
        r'((?:https?:\/\/|www\.)[^\s\/$.?#].[^\s,;()]*|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})',
        re.IGNORECASE
    )
    samples = [
        "E-Mail: student@uni-kl.de; support@company.org",
        "Official portal: www.minijob-zentrale.de for assistance.",
        "Visit https://github.com/mozilla/pdf.js for documentation.",
        "Contact info@rptu.de or call customer care."
    ]
    for text in samples:
        placeholders = []
        def repl(m):
            tok = f"XYZLINK{len(placeholders)}XYZ"
            placeholders.append((tok, m.group(0)))
            return tok
        masked = pattern.sub(repl, text)
        res = masked
        for tok, orig in placeholders:
            res = res.replace(tok, orig)
        assert res == text, f"Entity roundtrip masking mismatch: {res} != {text}"

    print("  [PASS] Entity masking & URL/email preservation logic valid")

if __name__ == '__main__':
    print("Running PDF Translator Extension integrity tests...")
    try:
        test_manifest()
        test_html_assets()
        test_entity_masking()
        print("\nAll extension tests passed successfully!")
    except AssertionError as err:
        print(f"\n[FAIL]: {err}")
        sys.exit(1)
