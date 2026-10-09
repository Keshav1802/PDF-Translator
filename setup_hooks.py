"""
Git Hook Installer
Configures local git pre-push hooks to automatically run integrity tests
and package verification before pushing code to GitHub.
"""

import os
import stat
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOOKS_DIR = os.path.join(BASE_DIR, '.git', 'hooks')
PRE_PUSH_PATH = os.path.join(HOOKS_DIR, 'pre-push')

HOOK_CONTENT = """#!/bin/sh
# Local Pre-Push Git Hook
# Automatically verifies extension integrity and rebuilds package before any git push

echo "🔍 [Local CI] Running extension integrity test suite..."
python tests/test_extension.py

if [ $? -ne 0 ]; then
  echo "❌ [Local CI Error] Integrity tests failed! Push aborted to prevent breaking remote builds."
  exit 1
fi

echo "📦 [Local CI] Rebuilding production package..."
python package.py

if [ $? -ne 0 ]; then
  echo "❌ [Local CI Error] Packaging failed! Push aborted."
  exit 1
fi

echo "✅ [Local CI] All tests passed! Proceeding with push."
exit 0
"""

def install_hooks():
    if not os.path.exists(HOOKS_DIR):
        print("❌ Error: .git directory not found. Please run within a Git repository.")
        sys.exit(1)

    with open(PRE_PUSH_PATH, 'w', encoding='utf-8') as f:
        f.write(HOOK_CONTENT)

    # Ensure executable permissions on Unix/macOS/Linux
    try:
        st = os.stat(PRE_PUSH_PATH)
        os.chmod(PRE_PUSH_PATH, st.st_mode | stat.S_IEXEC)
    except Exception:
        pass

    print("[SUCCESS] Local pre-push hook installed successfully in .git/hooks/pre-push")
    print("Now whenever you run 'git push', your test suite and packaging will run automatically!")

if __name__ == '__main__':
    install_hooks()
