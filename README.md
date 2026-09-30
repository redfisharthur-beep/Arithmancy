# Arithmancy

數學運算 × 即時策略卡牌對戰的前端原型。

## 目前骨架

- 首頁：名字輸入 + 圖片化 Fight 按鈕
- 大廳：6 職業、建立房間、房間列表
- 戰鬥：30 秒回合、共享 3 數字 + 2 運算符號、拖曳排序、括號模式、答案條件與送出
- 結算：輸出傷害、恢復量、終極絕招次數
- 全站字體：Noto Sans TC
- 所有背景與操作按鈕皆放在 `assets/images/`

## 括號操作

1. 按「括號」圖示
2. 點數字
3. 點相鄰運算符
4. 點同方向相鄰數字
5. 系統完成一組括號

再次按括號可取消既有括號。

## Cloudflare 架構預留

目前是純前端，可以直接部署 Cloudflare Pages。

正式多人版建議：

- Pages：前端
- Worker：HTTP / WebSocket API
- Durable Objects：每個房間一個即時狀態實體
- D1（可選）：排行榜與歷史戰績

### 房間共享狀態建議

```js
{
  roomId,
  round,
  seed,
  cards: [3 numbers, 2 operators],
  targetNumber,
  roundEndsAt,
  players: {},
  submissions: []
}
```

伺服器必須統一產生每回合牌組與倒數時間，確保所有玩家拿到相同卡牌；`submissions` 以伺服器收到答案的時間決定行動順位。

## 圖片

- `assets/images/backgrounds/`：頁面背景
- `assets/images/buttons/`：Fight、括號、重置、送出
- `assets/images/classes/`：預留職業圖示 / 角色插畫


## 第二階段：戰鬥系統

目前前端原型已實作：

- 100 HP
- 護盾
- 破防（增加後續承傷）
- 恢復
- 詛咒
- 攻擊血量最高目標
- 尾刀血量最低目標
- 六職業專屬終極絕招
- 依送出時間排序行動
- 30 秒未送出視同放棄
- 回合循環直到剩餘 1 人
- 戰後排行榜統計傷害、恢復、絕招次數
- 本地 AI 玩家會使用相同五張牌尋找可行算式

### 六職業終極絕招

- 戰士：絕對壁壘 — 大幅護盾並降低破防
- 法師：元素風暴 — 全體傷害
- 牧師：神聖回響 — 大量恢復並附加護盾
- 弓手：穿心連矢 — 對低血量目標連續攻擊
- 刺客：暗影處決 — 清除護盾、施加大量破防後重擊
- 術士：命運逆轉 — 對高血量目標施加破防、傷害並獲得護盾

## Worker / Durable Objects

已新增：

- `worker/src/index.js`
- `wrangler.toml`
- `docs/multiplayer-protocol.md`

目前 Worker 是多人同步骨架，尚未取代前端本地模擬。正式上線多人版時，房間牌組、倒數、答案驗證、送出順位與戰鬥結算都應移到 Durable Object。
