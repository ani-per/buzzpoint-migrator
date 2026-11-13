#!/usr/bin/env bash
set -euo pipefail

# Optional defaults: set these here, or pass --name, --date, and --difficulty when running.
DEFAULT_NAME="2026 ACF Winter"
DEFAULT_DATE="2026-11-14"
DEFAULT_DIFFICULTY="Medium (●●)"

NAME="$DEFAULT_NAME"
DATE="$DEFAULT_DATE"
DIFFICULTY="$DEFAULT_DIFFICULTY"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage: ./update_index_metadata.sh --name "2026 John Smith" --date YYYY-MM-DD --difficulty STRING [--repo PATH]

Updates every data/tournaments/**/index.json: set, start_date, end_date, and level.
Updates every data/question_sets/**/index.json: name, slug (derived from name), and difficulty.
Renames the single folder immediately under data/question_sets to the supplied name's slug.
If there is more than one immediate subfolder, prints a warning and stops without renaming.
For index.json files beneath an editions folder, uses the containing folder's title-cased name
and appends its slug to the supplied name's slug (for example, 2026-john-smith-main).
You can set DEFAULT_NAME, DEFAULT_DATE, and DEFAULT_DIFFICULTY in the script instead of passing them.
EOF
}

while (($#)); do
  case "$1" in
    --name)  (($# >= 2)) || { usage >&2; exit 2; }; NAME="$2"; shift 2 ;;
    --date)  (($# >= 2)) || { usage >&2; exit 2; }; DATE="$2"; shift 2 ;;
    --difficulty) (($# >= 2)) || { usage >&2; exit 2; }; DIFFICULTY="$2"; shift 2 ;;
    --repo)  (($# >= 2)) || { usage >&2; exit 2; }; REPO_ROOT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$NAME" || -z "$DATE" || -z "$DIFFICULTY" ]]; then
  echo 'Provide --name, --date, and --difficulty, or set DEFAULT_NAME, DEFAULT_DATE, and DEFAULT_DIFFICULTY in the script.' >&2
  usage >&2
  exit 2
fi

REPO_ROOT="$(cd -- "$REPO_ROOT" && pwd)"
python3 - "$REPO_ROOT" "$NAME" "$DATE" "$DIFFICULTY" <<'PY'
import datetime
import json
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path

root = Path(sys.argv[1])
name = sys.argv[2]
date = sys.argv[3]
difficulty = sys.argv[4]
normalized_name = unicodedata.normalize('NFKD', name)
slug = re.sub(r'[^a-z0-9]+', '-', normalized_name.encode('ascii', 'ignore').decode('ascii').lower()).strip('-')
try:
    datetime.date.fromisoformat(date)
except ValueError:
    raise SystemExit('Date must be a valid date in YYYY-MM-DD format.')
if len(date) != 10:
    raise SystemExit('Date must be a valid date in YYYY-MM-DD format.')

tournament_folder = root / 'data' / 'tournaments'
question_set_folder = root / 'data' / 'question_sets'
for folder in (tournament_folder, question_set_folder):
    if not folder.is_dir():
        raise SystemExit(f'Required folder not found: {folder}')

main_folders = sorted(path for path in question_set_folder.iterdir() if path.is_dir())
if len(main_folders) > 1:
    raise SystemExit(
        f'Warning: found {len(main_folders)} folders immediately under {question_set_folder}. '
        'Expected only one; no folders were renamed. Move or remove the extra folders and rerun.'
    )
if len(main_folders) == 0:
    raise SystemExit(f'No immediate subfolder found under {question_set_folder}; expected one folder to rename.')
main_folder = main_folders[0]
if not slug:
    raise SystemExit('The supplied name does not produce a valid folder slug.')
renamed_folder = question_set_folder / slug
if main_folder != renamed_folder:
    if renamed_folder.exists():
        raise SystemExit(f'Cannot rename {main_folder} to {renamed_folder}: target already exists.')
    main_folder.rename(renamed_folder)
    print(f'Renamed {main_folder.relative_to(root)} to {renamed_folder.relative_to(root)}')

changed = 0
for folder in (tournament_folder, question_set_folder):
    for path in sorted(folder.rglob('index.json')):
        with path.open(encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise SystemExit(f'Expected a JSON object in {path}')

        if folder == tournament_folder:
            data.update({'set': name, 'start_date': date, 'end_date': date, 'level': difficulty})
        else:
            under_editions = 'editions' in path.relative_to(folder).parts[:-1]
            data['difficulty'] = difficulty
            if under_editions:
                edition_name = path.parent.name
                edition_slug = re.sub(
                    r'[^a-z0-9]+', '-',
                    unicodedata.normalize('NFKD', edition_name).encode('ascii', 'ignore').decode('ascii').lower()
                ).strip('-')
                data.update({'name': edition_name.title(), 'slug': f'{slug}-{edition_slug}'})
            else:
                data.update({'name': name, 'slug': slug})

        fd, temp_name = tempfile.mkstemp(dir=path.parent, prefix='.index.', suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write('\n')
            os.replace(temp_name, path)
        except Exception:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
            raise
        changed += 1
        print(f'Updated {path.relative_to(root)}')
print(f'Done. Updated {changed} index.json file(s).')
PY