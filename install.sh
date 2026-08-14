#!/usr/bin/env bash
# dsh-usage-trends — 接收方安装脚本(profile patch 层方式)
#
# 用法:
#   ./install.sh                      使用默认 DSH_HOME=~/.dsh、profile=web
#   ./install.sh --profile <名称>     指定 profile 名称(默认 web)
#   ./install.sh --home <目录>        指定 DSH_HOME(默认 $HOME/.dsh)
set -euo pipefail

PROFILE="web"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --home) DSH_HOME="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
if [ ! -d "$PROFILE_DIR" ]; then
  echo "错误:找不到 profile 目录 $PROFILE_DIR" >&2
  echo "请用 --profile <名称> 指定(默认 web),或用 --home <目录> 指定 DSH_HOME。" >&2
  exit 1
fi

for f in package.json cordis.patch.yml lib/index.js lib/client.js; do
  if [ ! -f "$SCRIPT_DIR/$f" ]; then
    echo "错误:发行包缺少文件 $f(请保持 install.sh 与发行目录同层)。" >&2
    exit 1
  fi
done

# 1) 插件包 → profile 的 node_modules
PKG_TARGET="$PROFILE_DIR/node_modules/@local/usage-trends"
echo "==> 安装插件包到 $PKG_TARGET"
mkdir -p "$PROFILE_DIR/node_modules"
rm -rf "$PKG_TARGET"
mkdir -p "$PKG_TARGET"
cp "$SCRIPT_DIR/package.json" "$PKG_TARGET/package.json"
cp "$SCRIPT_DIR/cordis.patch.yml" "$PKG_TARGET/cordis.patch.yml"
cp -R "$SCRIPT_DIR/lib" "$PKG_TARGET/lib"

# 2) 把 bundle patch 合并进 profile 的 cordis.patch.yml(幂等)
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
echo "==> 合并 patch 到 $PATCH_FILE"
if [ -f "$PATCH_FILE" ] && grep -q "@local/usage-trends" "$PATCH_FILE"; then
  echo "    patch 已存在,跳过"
else
  touch "$PATCH_FILE"
  cat >> "$PATCH_FILE" <<'PATCH_EOF'

# 用量趋势视图(用户插件 @local/usage-trends):
# 会话「聊天/轨迹」旁新增「趋势」标签页:逐请求 Token 流量/累计曲线/耗时图表 + 聚合统计。
- insert:
    - id: usage-trends
      name: '@local/usage-trends'
PATCH_EOF
  echo "    patch 已写入"
fi

echo
echo "安装完成。接下来:"
echo "  1. 重启 DSH 服务器(patch 层在启动时应用)"
echo "  2. 打开网页刷新 —— 会话头部出现「趋势」标签页,与「聊天/轨迹」并列"
