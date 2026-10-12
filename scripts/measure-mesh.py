"""
测量 MakeHuman 雕刻网格的关节位置与半径剖面。

MakeHuman 的 proxy OBJ 没有顶点组（g 行数为 0），拿不到现成骨架，
所以关节只能从几何本身逐层分析得出。

用法：python3 scripts/measure-mesh.py <mesh.obj>
"""
import sys
import numpy as np


def main():
    path = sys.argv[1]
    vs = []
    for line in open(path, encoding="utf-8", errors="ignore"):
        if line.startswith("v "):
            q = line.split()
            vs.append((float(q[1]), float(q[2]), float(q[3])))
    v = np.array(vs)
    lo, hi = v.min(axis=0), v.max(axis=0)
    print(f"原始包围盒 X[{lo[0]:.2f},{hi[0]:.2f}] Y[{lo[1]:.2f},{hi[1]:.2f}] Z[{lo[2]:.2f},{hi[2]:.2f}]")

    # 以身体中轴为中心（AC 网格本来就是对称的，不要用 min 平移 —— 会把中轴推歪）
    v[:, 0] -= (lo[0] + hi[0]) / 2
    v[:, 2] -= np.median(v[:, 2])
    v[:, 1] -= lo[1]
    H = hi[1] - lo[1]
    v /= H
    print(f"归一化：身高 1.0，脚底 y=0，中轴 x=0（原始身高 {H:.2f}）\n")

    print(" y     顶点   躯干半径          四肢X跨度")
    for yy in np.arange(0.03, 1.0, 0.045):
        sl = v[(v[:, 1] > yy - 0.012) & (v[:, 1] < yy + 0.012)]
        if len(sl) < 5:
            continue
        ax = np.median(sl[:, 0])
        torso = sl[np.abs(sl[:, 0] - ax) < np.percentile(np.abs(sl[:, 0] - ax), 45)]
        tr = np.hypot(torso[:, 0] - ax, torso[:, 2] - np.median(torso[:, 2]))
        print(f" {yy:.3f} {len(sl):5d}   {tr.min():.3f}..{tr.max():.3f}      [{sl[:, 0].min():+.3f},{sl[:, 0].max():+.3f}]")


main()
