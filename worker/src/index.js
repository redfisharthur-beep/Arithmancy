export class Lobby {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const rooms = (await this.state.storage.get("rooms")) || {};

    // remove stale waiting rooms after 30 minutes
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, room] of Object.entries(rooms)) {
      if ((room.updatedAt || 0) < cutoff || room.started) delete rooms[id];
    }

    if (request.method === "GET") {
      await this.state.storage.put("rooms", rooms);
      return Response.json({ rooms: Object.values(rooms).sort((a,b)=>b.createdAt-a.createdAt) });
    }

    if (request.method === "POST" && url.pathname.endsWith("/upsert")) {
      const room = await request.json();
      if (room?.id) {
        rooms[room.id] = { ...room, updatedAt: Date.now() };
        if (room.started) delete rooms[room.id];
        await this.state.storage.put("rooms", rooms);
      }
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname.endsWith("/remove")) {
      const { id } = await request.json();
      if (id) delete rooms[id];
      await this.state.storage.put("rooms", rooms);
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade");

    if (upgrade === "websocket") {
      return this.handleSocket();
    }

    if (request.method === "GET" && url.pathname.endsWith("/state")) {
      const room = await this.getRoom();
      return Response.json({ room });
    }

    if (request.method === "POST" && url.pathname.endsWith("/create")) {
      const body = await request.json();
      const room = {
        id: body.id,
        ownerId: body.playerId,
        owner: body.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        started: false,
        max: 6,
        players: [{
          id: body.playerId,
          name: String(body.name || "Player").slice(0,12),
          classId: body.classId || "warrior"
        }]
      };
      await this.state.storage.put("room", room);
      await this.publish(room);
      return Response.json({ room });
    }

    if (request.method === "POST" && url.pathname.endsWith("/join")) {
      const body = await request.json();
      const room = await this.getRoom();
      if (!room || room.started) return Response.json({ error: "ROOM_UNAVAILABLE" }, { status: 409 });

      const existing = room.players.find(p => p.id === body.playerId);
      if (!existing && room.players.length >= room.max) return Response.json({ error: "ROOM_FULL" }, { status: 409 });

      if (existing) {
        existing.name = String(body.name || existing.name).slice(0,12);
        existing.classId = body.classId || existing.classId;
      } else {
        room.players.push({
          id: body.playerId,
          name: String(body.name || "Player").slice(0,12),
          classId: body.classId || "warrior"
        });
      }

      room.updatedAt = Date.now();
      await this.state.storage.put("room", room);
      await this.publish(room);
      this.broadcast({ type: "roomState", room });
      return Response.json({ room });
    }

    if (request.method === "POST" && url.pathname.endsWith("/start")) {
      const body = await request.json();
      const room = await this.getRoom();
      if (!room || room.ownerId !== body.playerId) return Response.json({ error: "NOT_HOST" }, { status: 403 });
      if (room.players.length < 2 || room.players.length > 6) return Response.json({ error: "PLAYER_COUNT" }, { status: 409 });
      room.started = true;
      room.updatedAt = Date.now();
      await this.state.storage.put("room", room);
      await this.publish(room);
      this.broadcast({ type: "started", room });
      return Response.json({ room });
    }

    return new Response("Arithmancy room", { status: 200 });
  }

  async getRoom() {
    return (await this.state.storage.get("room")) || null;
  }

  async publish(room) {
    const lobbyId = this.env.LOBBY.idFromName("global");
    const lobby = this.env.LOBBY.get(lobbyId);
    await lobby.fetch("https://lobby.internal/upsert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: room.id,
        owner: room.owner,
        players: room.players.length,
        max: room.max,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        started: room.started
      })
    });
  }

  handleSocket() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, server);

    server.addEventListener("close", () => this.sessions.delete(sessionId));
    server.send(JSON.stringify({ type: "connected", sessionId }));
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(payload) {
    const body = JSON.stringify(payload);
    for (const ws of this.sessions.values()) {
      try { ws.send(body); } catch {}
    }
  }
}

function jsonBody(data, status=200) {
  return Response.json(data, { status });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") return jsonBody({ ok: true, service: "arithmancy" });

    if (url.pathname === "/api/rooms" && request.method === "GET") {
      const id = env.LOBBY.idFromName("global");
      return env.LOBBY.get(id).fetch("https://lobby.internal/list");
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await request.json();
      const roomId = body.id;
      if (!roomId) return jsonBody({ error: "ROOM_ID_REQUIRED" }, 400);
      const id = env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch("https://room.internal/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
    }

    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(state|join|start)$/);
    if (match) {
      const [, roomId, action] = match;
      const id = env.ROOMS.idFromName(roomId);
      const init = action === "state"
        ? { method: "GET" }
        : { method: "POST", headers: { "content-type": "application/json" }, body: await request.text() };
      return env.ROOMS.get(id).fetch(`https://room.internal/${action}`, init);
    }

    if (url.pathname.startsWith("/room/")) {
      const roomId = url.pathname.split("/")[2] || "default";
      const id = env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};