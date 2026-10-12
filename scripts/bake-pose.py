"""
把 MakeHuman 雕刻网格从 A 字站姿改成双手自然下垂，并覆盖原文件。

为什么放在离线做（而不是运行时）：
  这是一个**一次性的资产变换**。放运行时既增加每次加载的开销，
  又因为看不到中间数据而极难调试 —— 我在运行时反复出错了好几轮，
  而这里可以直接打印每个顶点的分类结果。

用法：
  python3 scripts/bake-pose.py <mesh.obj> [--out <out.obj>] [--angle 8] [--forward 6]
"""
import sys
import numpy as np

# 归一化高度上的关键位置（与 mesh-rig.ts 一致）
SHOULDER_Y = 0.80
CROTCH = 0.50
TRUNK_X_LIMIT = 0.13
HAND_X_MIN = 0.20
HAND_Y_MAX = 0.65


def load_obj(path):
    verts, faces = [], []
    for line in open(path, encoding="utf-8", errors="ignore"):
        if line.startswith("v "):
            q = line.split()
            verts.append((float(q[1]), float(q[2]), float(q[3])))
        elif line.startswith("f "):
            faces.append(line.rstrip("\n"))
    return np.array(verts, dtype=np.float64), faces


def write_obj(path, verts, faces, header):
    with open(path, "w", encoding="utf-8") as f:
        f.write(header)
        for v in verts:
            f.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
        for line in faces:
            f.write(line + "\n")


def rodrigues(axis, angle):
    """轴角 → 旋转矩阵"""
    axis = axis / (np.linalg.norm(axis) + 1e-12)
    K = np.array([[0, -axis[2], axis[1]],
                  [axis[2], 0, -axis[0]],
                  [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(angle) * K + (1 - np.cos(angle)) * (K @ K)


def main():
    src = sys.argv[1]
    out = src
    angle_deg, fwd_deg = 8.0, 6.0
    for i, a in enumerate(sys.argv):
        if a == "--out":
            out = sys.argv[i + 1]
        elif a == "--angle":
            angle_deg = float(sys.argv[i + 1])
        elif a == "--forward":
            fwd_deg = float(sys.argv[i + 1])

    verts, faces = load_obj(src)
    print(f"读入 {len(verts)} 顶点 / {len(faces)} 面")

    lo, hi = verts.min(axis=0), verts.max(axis=0)
    center_x = (lo[0] + hi[0]) / 2
    height = hi[1] - lo[1]

    # 归一化副本（身高 1.0、脚底 y=0、中轴 x=0），姿势计算全在归一化空间里做
    n = verts.copy()
    n[:, 0] = (n[:, 0] - center_x) / height
    n[:, 1] = (n[:, 1] - lo[1]) / height
    n[:, 2] = (n[:, 2] - np.median(n[:, 2])) / height

    result = n.copy()

    for side in (1, -1):
        m = np.sign(n[:, 0]) == side

        # 肩高处躯干半宽
        band = np.abs(n[:, 1] - SHOULDER_Y) < 0.02
        trunk = n[band & (np.abs(n[:, 0]) < TRUNK_X_LIMIT)]
        half_w = np.median(np.abs(trunk[:, 0])) if len(trunk) else 0.10
        joint = np.array([side * half_w * 0.8, SHOULDER_Y, 0.0])

        # 手部质心
        hm = m & (np.abs(n[:, 0]) > HAND_X_MIN) & (n[:, 1] < HAND_Y_MAX)
        if hm.sum() == 0:
            print(f"  side={side:+d}  ⚠️ 找不到手部顶点，跳过")
            continue
        hand = n[hm].mean(axis=0)

        frm = hand - joint
        frm /= np.linalg.norm(frm)
        # ── 自适应角度：让手落在「该高度的身体半宽 + 手厚 + 余量」之外 ──
        #
        # 固定 8° 是不够的：算出 手质心 x=0.104，而大腿表面 x≈0.114 ——
        # 手整个陷进腿里，这正是「手指穿进身体」的成因。
        arm_len = np.linalg.norm(hand - joint)
        body_idx = (np.abs(n[:, 1] - 0.47) < 0.05) & ~m
        body_half = np.percentile(np.abs(n[body_idx, 0]), 98) if body_idx.sum() else 0.12

        def hand_x(deg):
            return abs(joint[0]) + arm_len * np.sin(np.radians(deg))

        need = body_half + 0.035          # 手自身厚度 + 余量
        auto = np.degrees(np.arcsin(np.clip((need - abs(joint[0])) / arm_len, 0, 0.9)))
        use_deg = max(angle_deg, auto)
        ang = np.radians(use_deg)
        fw = np.radians(fwd_deg)
        tgt = np.array([side * np.sin(ang), -np.cos(ang), np.sin(fw)])
        tgt /= np.linalg.norm(tgt)
        print(f"  side={side:+d}  该高度身体半宽 {body_half:.3f}  需要手到 {need:.3f}"
              f"  → 角度 max({angle_deg:.0f}, 自适应 {auto:.1f}) = {use_deg:.1f}°")

        axis = np.cross(frm, tgt)
        if np.linalg.norm(axis) < 1e-9:
            print(f"  side={side:+d}  ⚠️ 无需旋转")
            continue
        total = np.arccos(np.clip(np.dot(frm, tgt), -1, 1))

        # 手臂轴（肩→手），用于「离哪条轴更近」的分类
        arm_axis = hand - joint
        arm_axis /= np.linalg.norm(arm_axis)

        d = n - joint
        along = d @ arm_axis
        perp_arm = np.where(
            along <= 0,
            np.linalg.norm(d, axis=1),
            np.linalg.norm(d - np.outer(along, arm_axis), axis=1),
        )
        perp_torso = np.hypot(n[:, 0], n[:, 2])

        # 归属权重：离手臂轴近 = 手臂
        force = np.abs(n[:, 0]) > 0.19
        t = (perp_torso - perp_arm) / 0.05
        w = np.clip(t * 0.5 + 0.5, 0, 1)
        w = np.where(force, 1.0, w)
        # 肩附近收拢，避免腋下撕裂
        dist_joint = np.linalg.norm(d, axis=1)
        near = np.clip((dist_joint - 0.01) / (0.08 - 0.01), 0, 1)
        near = near * near * (3 - 2 * near)
        w = w * near
        # 裆以下不是手臂
        w = np.where(n[:, 1] < CROTCH - 0.02, 0.0, w)
        w = np.where(m, w, 0.0)

        idx = np.where(w > 0.001)[0]
        moved = np.zeros_like(n)
        for i in idx:
            R = rodrigues(axis, total * w[i])
            moved[i] = joint + R @ (n[i] - joint)
        result[idx] = moved[idx]

        after = result[hm].mean(axis=0)
        print(f"  side={side:+d}  关节 x={joint[0]:+.3f}  手质心 {np.round(hand,3)} → {np.round(after,3)}"
              f"  旋转 {np.degrees(total):.1f}°  受影响顶点 {len(idx)}")

    # 还原到原始尺度
    out_v = verts.copy()
    out_v[:, 0] = result[:, 0] * height + center_x
    out_v[:, 1] = result[:, 1] * height + lo[1]
    out_v[:, 2] = result[:, 2] * height + np.median(verts[:, 2])

    write_obj(out, out_v, faces, f"# posed by scripts/bake-pose.py (angle={angle_deg}, forward={fwd_deg})\n")
    lo2, hi2 = out_v.min(axis=0), out_v.max(axis=0)
    print(f"写出 {out}")
    print(f"  包围盒 X[{lo2[0]:.2f},{hi2[0]:.2f}] Y[{lo2[1]:.2f},{hi2[1]:.2f}] Z[{lo2[2]:.2f},{hi2[2]:.2f}]")
    print(f"  宽 {hi2[0]-lo2[0]:.2f}（A 字站姿时约 11.37 —— 应明显变小）")


main()
