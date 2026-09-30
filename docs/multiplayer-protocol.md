# Multiplayer protocol

Cloudflare Worker / Durable Object 預留訊息格式。

## Client → room

```json
{ "type": "join", "name": "Arthur", "classId": "warrior" }
```

```json
{
  "type": "submit",
  "formula": "(8 - 3) × 2",
  "result": 10
}
```

## Room → client

- `connected`
- `presence`
- `roomState`
- `submitted`

正式版下一步要由 Durable Object 統一負責：

1. 每回合產生同一組 3 數字 + 2 運算符號
2. 設定伺服器端 `roundEndsAt`
3. 驗證玩家送出的算式是否真的只使用本回合五張牌
4. 以伺服器收到時間排序
5. 依序執行技能
6. 廣播 HP / 護盾 / 破防 / 淘汰狀態
7. 剩 1 人時結束房間
