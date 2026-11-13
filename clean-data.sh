#!/bin/bash
set -eu

# Start at the directory containing this script.
script_dir="$(cd "$(dirname "$0")" && pwd)"
tournament_dir="$script_dir/data/tournaments"
question_sets_dir="$script_dir/data/question_sets"
printf 'This will recursively delete all .DS_Store, *.qbj, *.yft, and *.html files under:\n%s\n' "$script_dir"
printf 'It will also delete JSON files under %s and %s, except index.json.\n' "$tournament_dir" "$question_sets_dir"
printf 'Continue? [y/N] '
read -r response
case "$response" in
    [yY]|[yY][eE][sS])
        find "$script_dir" -type f \( -name '.DS_Store' -o -name '*.qbj' -o -name '*.yft' -o -name '*.html' \) -delete
        if [ -d "$tournament_dir" ]; then
            find "$tournament_dir" -type f -name '*.json' ! -name 'index.json' -delete
        fi
        if [ -d "$question_sets_dir" ]; then
            find "$question_sets_dir" -type f -name '*.json' ! -name 'index.json' -delete
        fi
        printf 'Cleanup complete.\n'
        ;;
    *)
        printf 'Cancelled; no files were deleted.\n'
        exit 0
        ;;
esac
