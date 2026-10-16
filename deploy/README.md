# deploy/ —— 服务器上的运维配置

这些文件是**线上实际生效的版本**，收进仓库以便复现与修改。
`scripts/deploy.sh --first` 会自动安装它们。

| 文件 | 装到哪 | 作用 |
|---|---|---|
| `backup.mjs` | `/opt/cda/backup.mjs` | 每日备份数据库 |
| `cda-backup.service` | `/etc/systemd/system/` | 备份任务 |
| `cda-backup.timer` | `/etc/systemd/system/` | 每天 04:00 触发，错过的会补跑 |
| `logrotate-cda` | `/etc/logrotate.d/cda` | 日志轮转，保留 7 天 |

## 备份为什么不能直接 cp

SQLite 开着 WAL 模式，**运行时磁盘上的 `.db` 可能只包含部分已提交的数据**，
`cp` 出来的副本可能是坏的，而且坏得很隐蔽（要恢复时才发现）。

`VACUUM INTO` 会生成一个**一致且已整理**的新库，是官方推荐的在线备份方式。
它还会顺带把碎片整理掉，所以备份文件通常比原库更小。

## 手动操作

```bash
# 立刻备份一次
sudo systemctl start cda-backup.service && sudo tail -3 /opt/cda/backup.log

# 看下次何时备份
systemctl list-timers cda-backup.timer

# 取回备份到本地
scp ubuntu@<SERVER_IP>:/opt/cda/backups/cda-*.db ./
```

> ⚠️ 备份文件在**同一台服务器**上。服务器整机故障（如磁盘损坏）时备份也一起没了。
> 建议定期 `scp` 一份到本地或对象存储。
