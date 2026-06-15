#!/bin/bash
# Sync understand-query skill from repo to momo knowledge-base
# Usage: ./scripts/sync-understand-query.sh [--dry-run]

REPO_DIR="/Users/earthchen/.understand-anything/repo/understand-anything-plugin/skills/understand-query"
MOMO_DIR="/Users/earthchen/work/momo/amar/amar_ai/knowledge-base/skills/understand-query"

DRY_RUN=""
if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN="--dry-run"
    echo "=== Dry run (no files will be changed) ==="
fi

rsync -av $DRY_RUN \
    --delete \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='test_*.py' \
    "$REPO_DIR/" "$MOMO_DIR/"

echo ""
echo "Done. Synced: $REPO_DIR → $MOMO_DIR"
