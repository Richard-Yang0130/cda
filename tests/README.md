# 测试体系

按级别组织、**可按影响点选择**的测试套件。
改完代码后，用影响点标签跑受影响的用例，而不是盲目全跑或凭感觉抽查。

---

## 快速开始

```bash
# 改完某个 bug / 加完功能后 —— 最常用
node tests/run.mjs --impact auth,api

# 只想快速确认没砸（约 1 分钟）
node tests/run.mjs --smoke

# 只跑某一级
node tests/run.mjs --level L0,L1

# 只跑某个模块
node tests/run.mjs --module 注册

# 先看会跑哪些，不执行
node tests/run.mjs --impact post --list

# 全跑（约 5 分钟）
node tests/run.mjs
```

运行器会**自动**：
- 起后端（用干净的测试库）
- **每个用例文件跑之前都重置数据库并重启后端**
- 托管前端产物（不够新会自动构建）
- 汇总各级别的通过情况

---

## 级别定义

| 级别 | 名称 | 含义 | 何时跑 |
|---|---|---|---|
| **L0** | 基础功能 | 页面能打开、接口能通、字段有值 | **每次改完都跑**，快 |
| **L1** | 核心功能 | 注册、发帖、私聊等主流程端到端走通 | 改了核心链路 |
| **L2** | 安全设计 | 越权、限流、隐私、会话失效 | 改了鉴权、权限、数据可见性 |
| **L3** | 性能体验 | 耗时、分页、体积、边界值 | 改了查询、分页、静态资源 |
| **L4** | 复杂场景 | 多状态转换、级联、并发、一致性 | 改了状态机、关联数据、事务 |

---

## 影响点映射表

**这是这套体系的核心。** 改了左边的东西，就跑右边对应的用例。

| 影响点标签 | 覆盖的用例 |
|---|---|
| `page` `ui` `frontend` | test-pages, test-ui-fixes, test-e2e-register, test-full-register, test-round3, test-v1-features, test-auth-and-register |
| `api` `backend` | test-api, test-perf, test-scenarios, test-admin, test-e2e-register |
| `db` | test-api, test-perf, test-scenarios, test-admin |
| `auth` `security` | test-admin, test-auth-and-register, test-scenarios, test-api, test-e2e-register |
| `register` | test-full-register, test-e2e-register, test-auth-and-register, test-round3 |
| `post` | test-api, test-e2e-register, test-perf, test-scenarios |
| `message` | test-api, test-v1-features, test-e2e-register |
| `admin` | test-admin, test-scenarios |
| `address` `wardrobe` | test-api |
| `body` `tryon` | test-round3 |
| `version` | test-v1-features |
| `perf` | test-perf |

> 用法：`node tests/run.mjs --impact <标签>`

---

## 目录结构

```
tests/
  manifest.mjs   测试登记表（级别、模块、覆盖点、影响点标签）
  run.mjs        运行器
  README.md      本文件
scripts/
  test-*.mjs     各个测试脚本（也能单独手动跑）
```

**测试脚本本身不依赖运行器** —— 每个都是独立的 node 脚本，
通过退出码与「通过 X/Y」汇总行表示结果。所以：

```bash
# 也能这样单独跑（需要自己先起服务）
CDA_API=http://127.0.0.1:8899 node scripts/test-api.mjs
```

---

## 新增一个测试

1. 在 `scripts/` 下写 `test-xxx.mjs`，约定：
   - 用 `console.log('✅ 说明')` / `console.log('❌ 说明')` 输出断言
   - 结尾打印 `通过 N/M`
   - 结尾 `process.exit(R.every(Boolean) ? 0 : 1)`
2. 在 `tests/manifest.mjs` 的 `TESTS` 里登记：级别、模块、覆盖点、**影响点标签**
3. 跑 `node tests/run.mjs --module <你的模块>` 确认能跑通

---

## 踩过的坑（写下来避免重犯）

### 1. 测试必须自己准备前置条件

`test-ui-fixes` 原版依赖消息页里的**本地示例会话**。
后来消息改走后端，示例数据没了，用例就挂了。
**教训：测试不能依赖实现细节（示例数据），要自己造。**

### 2. 不要硬编码会变的东西

`test-v1-features` 原版硬编码了版本号 `1.0.0-beta`。
版本升到 `1.0.0` 后断言全部失效，看起来像功能坏了。
**教训：版本号、文案这类会变的东西，从页面读或匹配模式，别写死。**

### 3. 断言要读控件的真实值

验证码那个 bug：我原本用「页面文本里有没有这些数字」判断输入成功，
而**手机号里也含这些数字**，于是假阳性通过。
**教训：验证输入用 `element.value`，不要用文本内容猜。**

### 4. 用例之间必须隔离

一开始整套只起一次服务，结果「单跑全过、全跑全挂」——
邀请码是一次性的，第一个用例用掉 `CDA-BETA-01` 后后面的全挂。
**教训：运行器现在每个用例文件都重置数据库。**

### 5. 运行器不能只看退出码

有些测试文件没写 `process.exit`，断言失败了也返回 0，
于是明细里明明有 ❌、汇总却显示「全部通过」。
**运行器现在同时解析「通过 X/Y」汇总行，且任何 ❌ 都判失败。**

### 6. 测试自身的错误也要当回事

多次出现「测试挂了但其实功能是好的」：
- 用同一个人的 token 搜自己（接口正确地排除了自己）
- 等待时间不足就断言（聊天还没渲染完）
- `evaluateOnNewDocument` 每次导航都重跑，把刚注入的 token 清掉了

**判断「接口坏了」还是「测试写错了」的方法：单独用 curl 调一次接口。**

---

## 已知未通过（2026-10 状态）

| 用例 | 情况 |
|---|---|
| `test-pages` | 部分断言待适配后端架构 |
| `test-e2e-register` | 15/16 |
| `test-full-register` | 12/16 —— 注册第 6 步新增了密码与邀请码输入，用例还没补 |
| `test-auth-and-register` | 5/8 |

**当前通过：L3 1/1、L4 3/3、L2 1/2、L0 1/2、L1 1/3（8/12 个文件）**

这些失败都是**断言没跟上功能变化**，不是功能缺陷 —— 但要修，
否则套件会失去可信度，最后没人看。
