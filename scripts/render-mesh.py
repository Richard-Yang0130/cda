"""
把雕刻网格渲染成四视图，用于和参考图对比。

不依赖浏览器 / GPU：用 numpy 做软件光栅化（z-buffer + Lambert 着色）。
这样能纯粹地评判**网格本身的质量**，不受渲染管线影响。

用法：
  python3 scripts/render-mesh.py <input.obj> <output.png>
"""
import sys
import numpy as np
from PIL import Image

W, H = 460, 760


def load_obj(path):
    verts = []
    faces = []
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith("v "):
                p = line.split()
                verts.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith("f "):
                idx = []
                for tok in line.split()[1:]:
                    # 兼容 v/vt/vn 形式，只取顶点索引
                    idx.append(int(tok.split("/")[0]) - 1)
                # 扇形三角化（四边形 → 两个三角形）
                for i in range(1, len(idx) - 1):
                    faces.append((idx[0], idx[i], idx[i + 1]))
    return np.array(verts, dtype=np.float64), np.array(faces, dtype=np.int32)


def compute_normals(v, f):
    """面积加权的顶点法线"""
    n = np.zeros_like(v)
    tri = v[f]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    ln[ln == 0] = 1
    return n / ln, fn


def render(v, f, vn, yaw_deg, pitch_deg=0.0):
    """正交投影 + z-buffer 光栅化。返回灰度图。"""
    yaw = np.radians(yaw_deg)
    pitch = np.radians(pitch_deg)
    cy, sy = np.cos(yaw), np.sin(yaw)
    cp, sp = np.cos(pitch), np.sin(pitch)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    v2 = v @ Ry.T @ Rx.T
    n2 = vn @ Ry.T @ Rx.T

    # 以身体中心为屏幕中心，按高度归一化
    lo, hi = v2.min(axis=0), v2.max(axis=0)
    ctr = (lo + hi) / 2
    size = (hi - lo).max()
    scale = 0.92 * min(W, H) / size
    # 屏幕坐标：x 向右，y 向上 → 图像 y 向下
    sx = (v2[:, 0] - ctr[0]) * scale + W / 2
    sy = H / 2 - (v2[:, 1] - ctr[1]) * scale
    sz = v2[:, 2]

    img = np.full((H, W), 1.0)
    zbuf = np.full((H, W), -1e9)

    # 光照：左上前方的主光 + 环境
    light = np.array([-0.4, 0.45, 0.8])
    light = light / np.linalg.norm(light)

    # axis=2 → (面, 顶点, 坐标)；用 axis=1 会变成 (面, 坐标, 顶点) 的转置，
    # 导致下面所有 p[j] 的索引全部错位（曾经因此渲染出几乎空白的图）
    tri = np.stack([sx[f], sy[f], sz[f]], axis=2)
    nrm = n2

    for i in range(len(f)):
        p = tri[i]
        x0, x1 = int(np.floor(p[:, 0].min())), int(np.ceil(p[:, 0].max()))
        y0, y1 = int(np.floor(p[:, 1].min())), int(np.ceil(p[:, 1].max()))
        x0, x1 = max(x0, 0), min(x1, W - 1)
        y0, y1 = max(y0, 0), min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        ax, ay = p[0, 0], p[0, 1]
        bx, by = p[1, 0], p[1, 1]
        cx, cy2 = p[2, 0], p[2, 1]
        den = (by - cy2) * (ax - cx) + (cx - bx) * (ay - cy2)
        if abs(den) < 1e-9:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        l0 = ((by - cy2) * (gx - cx) + (cx - bx) * (gy - cy2)) / den
        l1 = ((cy2 - ay) * (gx - cx) + (ax - cx) * (gy - cy2)) / den
        l2 = 1 - l0 - l1
        mask = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        if not mask.any():
            continue
        z = l0 * p[0, 2] + l1 * p[1, 2] + l2 * p[2, 2]
        sub = zbuf[y0:y1 + 1, x0:x1 + 1]
        upd = mask & (z > sub)
        if not upd.any():
            continue
        # 按重心坐标插值顶点法线（平滑着色）。
        # 注意：f 是三角化后的数组，长度是四边形数的两倍，
        # 不能用三角形序号去索引顶点法线数组 —— 那会越界。
        i0, i1, i2 = f[i]
        a0, a1, a2 = l0[upd], l1[upd], l2[upd]
        nx = a0 * nrm[i0, 0] + a1 * nrm[i1, 0] + a2 * nrm[i2, 0]
        ny = a0 * nrm[i0, 1] + a1 * nrm[i1, 1] + a2 * nrm[i2, 1]
        nz = a0 * nrm[i0, 2] + a1 * nrm[i1, 2] + a2 * nrm[i2, 2]
        ln = np.sqrt(nx * nx + ny * ny + nz * nz)
        ln[ln == 0] = 1
        # 双面着色（闭合网格，取朝向观察者的一面）
        lam = np.abs((nx * light[0] + ny * light[1] + nz * light[2]) / ln)
        shade = 0.26 + 0.74 * lam
        # z-buffer 更新
        sub[upd] = z[upd]
        # 颜色必须写进 img —— 之前误写进了 zbuf 的视图，结果图全白
        csub = img[y0:y1 + 1, x0:x1 + 1]
        ctmp = csub.copy()
        ctmp[upd] = shade
        csub[:] = ctmp
        ztmp = zbuf[y0:y1 + 1, x0:x1 + 1].copy()
        ztmp[upd] = z[upd]
        zbuf[y0:y1 + 1, x0:x1 + 1] = ztmp

    return img


def main():
    src = sys.argv[1]
    dst = sys.argv[2]
    v, f = load_obj(src)
    vn, _ = compute_normals(v, f)
    print(f"顶点 {len(v)}  三角面 {len(f)}")

    views = [("正面", 0), ("3/4", 35), ("侧面", 90), ("背面", 180)]
    tiles = [render(v, f, vn, yaw) for _, yaw in views]

    sheet = np.full((H, W * len(tiles) + 12 * (len(tiles) - 1)), 1.0)
    for i, t in enumerate(tiles):
        x = i * (W + 12)
        sheet[:, x:x + W] = t
    img = Image.fromarray((np.clip(sheet, 0, 1) * 255).astype(np.uint8))
    img.save(dst)
    print(f"已写出 {dst}  ({img.width}×{img.height})")


main()
