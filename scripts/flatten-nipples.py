"""
去除网格上的乳头凸点（合规要求）。

做法：先定位乳房顶点（胸高一带最靠前的点，左右各一），
然后在这些点周围的一小块区域做**局部拉普拉斯平滑**。

为什么用局部平滑而不是直接压平：
  直接压平会连乳房形态一起破坏；拉普拉斯平滑只削掉高频的小凸起，
  低频的整体形状保留。迭代次数与半径都可控。

用法：python3 scripts/flatten-nipples.py <in.obj> <out.obj> [radius] [iters]
"""
import sys
import numpy as np


def load(path):
    verts, faces = [], []
    for line in open(path, encoding="utf-8", errors="ignore"):
        if line.startswith("v "):
            q = line.split()
            verts.append((float(q[1]), float(q[2]), float(q[3])))
        elif line.startswith("f "):
            idx = [int(t.split("/")[0]) - 1 for t in line.split()[1:]]
            for k in range(1, len(idx) - 1):
                faces.append((idx[0], idx[k], idx[k + 1]))
    return np.array(verts), np.array(faces, dtype=np.int32)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    radius = float(sys.argv[3]) if len(sys.argv) > 3 else 0.05
    iters = int(sys.argv[4]) if len(sys.argv) > 4 else 12

    v, f = load(src)
    lo, hi = v.min(axis=0), v.max(axis=0)
    H = hi[1] - lo[1]
    # 归一化，便于用解剖比例定位
    n = v.copy()
    n[:, 0] -= (lo[0] + hi[0]) / 2
    n[:, 1] -= lo[1]
    n[:, 2] -= np.median(v[:, 2])
    n /= H
    radius_n = radius / H if radius > 0.5 else radius  # 允许传归一化半径

    # 乳房顶点：胸高一带最靠前的点（z 最大），左右分开找
    band = (n[:, 1] > 0.66) & (n[:, 1] < 0.80)
    apexes = []
    for side in (1, -1):
        m = band & (np.sign(n[:, 0]) == side)
        if m.sum() == 0:
            continue
        idx = np.where(m)[0]
        apexes.append(idx[np.argmax(n[idx, 2])])
    if not apexes:
        print("⚠️ 未找到乳房顶点，原样输出")
        np.savetxt(dst, v, fmt="%.6f")
        return

    # 顶点邻接（只用面，够用）
    adj = [[] for _ in range(len(v))]
    for a, b, c in f:
        adj[a].extend((b, c))
        adj[b].extend((a, c))
        adj[c].extend((a, b))
    adj = [np.array(sorted(set(x)), dtype=np.int32) for x in adj]

    for ai, apex in enumerate(apexes):
        d = np.linalg.norm(n - n[apex], axis=1)
        sel = np.where(d < radius_n)[0]
        print(f"  侧 {ai+1}: 顶点 {apex}  y={n[apex,1]:.3f}  选中 {len(sel)} 个顶点"
              f"（半径 {radius_n:.4f} 归一化 ≈ {radius_n*H*100:.1f}cm）")
        work = n.copy()
        for _ in range(iters):
            new = work.copy()
            for i in sel:
                nb = adj[i]
                if len(nb):
                    new[i] = work[nb].mean(axis=0)
            work = new
        n[sel] = work[sel]

    # 还原到原始尺度与坐标系
    out = v.copy()
    out[:, 0] = n[:, 0] * H + (lo[0] + hi[0]) / 2
    out[:, 1] = n[:, 1] * H + lo[1]
    out[:, 2] = n[:, 2] * H + np.median(v[:, 2])

    with open(dst, "w", encoding="utf-8") as fh:
        fh.write("# nipples flattened by scripts/flatten-nipples.py\n")
        for p in out:
            fh.write(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")
        for a, b, c in f:
            fh.write(f"f {a+1} {b+1} {c+1}\n")
    print(f"写出 {dst}")


main()
