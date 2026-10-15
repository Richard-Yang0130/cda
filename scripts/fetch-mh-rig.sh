#!/usr/bin/env bash
# 下载 MakeHuman 官方骨架资产（全部 CC0，可商用）。
#
# 为什么不入库：这是可再生成的第三方数据（约 3MB 上游），
# 且许可条款会漂移 —— 按需下载 + 记录出处更稳妥。
# 详见 .assets/mh_rig/LICENSE-NOTES.md
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=".assets/mh_rig"
BASE="https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data"
mkdir -p "$DEST/targets"

get() { # get <相对路径> <目标文件>
  local url="$BASE/$1" out="$DEST/$2"
  if [ -s "$out" ]; then printf "  跳过（已存在） %-56s %8s B\n" "$2" "$(stat -f%z "$out")"; return; fi
  printf "  下载 %-56s " "$2"
  curl -fsS --max-time 300 -o "$out" "$url" && printf "%8s B\n" "$(stat -f%z "$out")" \
    || { echo "失败"; rm -f "$out"; return 1; }
}

echo "MakeHuman 官方资产（CC0）→ $DEST"
get "3dobjs/base.obj"                                  "base.obj"
get "rigs/default.mhskel"                              "default.mhskel"
get "rigs/default_weights.mhw"                         "default_weights.mhw"

# 体型主驱动：性别 × 肌肉 × 体重。中性组合的文件是空的（它就是参考态）
for g in female male; do
  for m in minmuscle averagemuscle maxmuscle; do
    for w in minweight averageweight maxweight; do
      get "targets/macrodetails/universal-$g-young-$m-$w.target" "targets/universal-$g-young-$m-$w.target" || true
    done
  done
done

# 按围度/长度精确调整（incr / decr 成对，权重可取负）。
# 名称取自上游目录的实际文件名（不要凭猜，之前猜错过三个）。
# 这套目标几乎与 BodyProfile 的字段一一对应：
#   chestCm→bust-circ  waistCm→waist-circ  hipCm→hips-circ
#   shoulderWidthCm→shoulder-dist          torsoLengthCm→napetowaist-dist
#   neckLengthCm→neck-height               thighCircCm→thigh-circ
#   upperArmCm→upperarm-length             forearmCm→lowerarm-length
#   thighCm→upperleg-height                calfCm→lowerleg-height
MEASURE="ankle-circ calf-circ bust-circ frontchest-dist hips-circ knee-circ
  lowerarm-length lowerleg-height napetowaist-dist neck-circ neck-height
  shoulder-dist thigh-circ underbust-circ upperarm-circ upperarm-length
  upperleg-height waist-circ waisttohip-dist wrist-circ"
for t in $MEASURE; do
  for d in incr decr; do
    get "targets/measure/measure-$t-$d.target" "targets/measure-$t-$d.target" || true
  done
done

echo
echo "  合计 $(du -sh "$DEST" | cut -f1)"
echo "  许可出处见 $DEST/LICENSE-NOTES.md（CC0 1.0，可商用）"
