export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Arithmancy room", { status: 200 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const playerId = crypto.randomUUID();
    this.sessions.set(playerId, server);

    server.addEventListener("message", event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      this.handleMessage(playerId, message);
    });

    server.addEventListener("close", () => {
      this.sessions.delete(playerId);
      this.broadcast({ type: "presence", playerId, online: false });
    });

    server.send(JSON.stringify({ type: "connected", playerId }));
    this.broadcast({ type: "presence", playerId, online: true });

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(playerId, message) {
    if (message.type === "join") {
      const room = (await this.state.storage.get("room")) || this.createRoomState();
      room.players[playerId] = {
        id: playerId,
        name: String(message.name || "Player").slice(0, 12),
        classId: message.classId || "warrior",
        hp: 100,
        shield: 0,
        armor: 0,
        alive: true
      };
      await this.state.storage.put("room", room);
      this.broadcast({ type: "roomState", room });
      return;
    }

    if (message.type === "submit") {
      const room = (await this.state.storage.get("room")) || this.createRoomState();
      if (!room.players[playerId]?.alive || room.submissions[playerId]) return;
      room.submissions[playerId] = {
        formula: message.formula,
        result: message.result,
        submittedAt: Date.now()
      };
      await this.state.storage.put("room", room);
      this.broadcast({
        type: "submitted",
        playerId,
        submittedAt: room.submissions[playerId].submittedAt
      });
    }
  }

  createRoomState() {
    return {
      round: 1,
      roundEndsAt: null,
      seed: crypto.randomUUID(),
      cards: [],
      targetNumber: null,
      players: {},
      submissions: {}
    };
  }

  broadcast(payload) {
    const body = JSON.stringify(payload);
    for (const ws of this.sessions.values()) {
      try { ws.send(body); } catch {}
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "arithmancy" });
    }

    if (url.pathname.startsWith("/room/")) {
      const roomId = url.pathname.split("/")[2] || "default";
      const id = env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch(request);
    }

    return new Response("Arithmancy API", { status: 200 });
  }
};