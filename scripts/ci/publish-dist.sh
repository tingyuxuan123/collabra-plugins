#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY 未设置}"
: "${GH_TOKEN:?GH_TOKEN 未设置}"
: "${SOURCE_V1:?SOURCE_V1 未设置}"
: "${SEQUENCE:?SEQUENCE 未设置}"

case "$SEQUENCE" in
  ''|*[!0-9]*)
    echo "SEQUENCE 必须是整数" >&2
    exit 1
    ;;
esac

SOURCE_V1="${SOURCE_V1%/}"
source_v1="$(cd "$(dirname "$SOURCE_V1")" && pwd)/$(basename "$SOURCE_V1")"
test -d "$source_v1"

work="${DIST_WORK_DIR:-.dist-work}"
if [ -z "$work" ] || [ "$work" = "/" ] || [ "$work" = "." ]; then
  echo "DIST_WORK_DIR 不安全" >&2
  exit 1
fi
rm -rf "$work"
mkdir -p "$work"
cd "$work"

git init -q
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
remote="https://github.com/${GITHUB_REPOSITORY}.git"
git remote add origin "$remote"
auth_header="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"

if git -c http.extraheader="$auth_header" fetch --depth=1 origin dist >/dev/null 2>&1; then
  git checkout -q -B dist FETCH_HEAD
else
  git checkout -q --orphan dist
fi

current_sequence="$(
  node -e "const fs=require('fs');try{process.stdout.write(String(JSON.parse(fs.readFileSync('v1/index.json','utf8')).sequence))}catch{process.stdout.write('0')}"
)"
if [ "$current_sequence" -eq "$SEQUENCE" ]; then
  if diff -r v1 "$source_v1" >/dev/null 2>&1; then
    echo "dist 已包含 sequence=${SEQUENCE}，跳过重复提交"
    exit 0
  fi
  echo "dist 的 sequence=${SEQUENCE} 内容与待发布产物不一致" >&2
  exit 1
fi
if [ "$current_sequence" -gt "$SEQUENCE" ]; then
  echo "拒绝回滚：dist 当前 sequence=${current_sequence}，待发布 sequence=${SEQUENCE}" >&2
  exit 1
fi

rm -rf v1
cp -R "$source_v1" v1
git add -A

if git diff --cached --quiet; then
  echo "dist 分支无变化"
  exit 0
fi

git commit -q -m "market: publish sequence ${SEQUENCE}"
git -c http.extraheader="$auth_header" push origin dist
