# Multiplayer guide

Redline Garage multiplayer is a small Node.js server (`server/server.js`) that relays car positions and chat between players. Your garage, money and saves stay in each player's own browser. The server only sees names, the car being driven and its position.

Everyone who joins the **same room code** on the **same map** shares one world and sees each other drive. Rooms hold up to 16 players. Other players' cars are not solid: you drive through each other, which avoids lag-related crash bugs.

## 1. Try it on your own computer or Wi-Fi (2 minutes)

```bash
npm install          # installs the only dependency, ws
node build.js        # builds dist/index.html
npm start            # starts the server on port 8080
```

1. Open `http://localhost:8080` in two browser windows.
2. In each one press **Multiplayer**. The server address is already filled in as `ws://localhost:8080`. Pick a room code such as `friends` and press **Connect**, then **Drive**.
3. Both windows now show each other's car with a name tag. Press **T** (or the **Chat** button on a phone) to chat.

Friends on the same Wi-Fi: find your computer's local IP (for example `192.168.1.20`), have them open `http://192.168.1.20:8080` and connect to `ws://192.168.1.20:8080`.

## 2. Put it online so anyone can join

The server serves the game page and the multiplayer socket from one address, so you deploy one small app. Any host that runs Node.js works. Use these settings:

| Setting | Value |
|---|---|
| Build command | `npm install && node build.js` |
| Start command | `node server/server.js` |
| Port | the host's `PORT` variable is read automatically |
| Health check | `/health` |

**Render (free tier works):** New > Web Service > connect your GitHub repo with this project > use the settings above. You get an address like `https://redline.onrender.com`. Free instances sleep after idle time, so the first connection can take about 30 seconds.

**Railway / Fly.io / any VPS:** the included `Dockerfile` works as is (`docker build -t redline . && docker run -p 8080:8080 redline`).

After it is deployed:
1. Open your site's `https://` address on any device (phones included).
2. Press **Multiplayer**. The server address is filled in as `wss://your-site` automatically. Choose a room code, press **Connect**, then **Drive**.
3. Send friends the site address and the room code.

## 3. Things to know

- **Use the https address of your own server.** A page served over `https://` can only connect to `wss://` (secure) sockets, and hosts like Render give you that for free. Do not open the game from the old Claude artifact link for multiplayer: it cannot reach your server. Open the game from your server's address instead.
- **Settings you can change** (environment variables): `PORT`, `MAX_PLAYERS` (default 16), `ALLOWED_ORIGINS` (comma-separated list such as `https://redline.onrender.com`; default allows any site).
- **Not secure against cheaters.** Each player's game reports its own position, so a modified client could teleport. That is fine for friends. A competitive game with prizes would need server-side physics, which is a much bigger project.
- **No accounts or saved rooms.** Rooms exist while someone is in them. Names are whatever the player set in the garage (Driver tab).
- **Chat** is limited to 120 characters and about one message per 1.5 seconds per player, and the server strips `<`, `>`, `&` and quotes.
- **Events (races) are still single-player** against AI. Other players just appear on the same roads.
- **Server cost:** each player sends about 15 small messages per second. A free 512 MB instance comfortably handles several rooms of 16.

## 4. How it works (for changes)

| Part | File |
|---|---|
| Relay server (rooms, validation, rate limits, serves the page) | `server/server.js` |
| Client (connect, remote cars, name tags, chat, menu hooks) | `src/net.js` |
| Hooks into the game | `Game.buildWorld` (join), `Game.disposeWorld` (leave), `Game.refreshPlayer` (car change), `Game.worldFrame` (update) |
| Test (starts the server, two real browsers, checks they see each other) | `test/mp-test.js` |

Messages are JSON. Client to server: `join {room,map,name,car,mods,driver}`, `s {x,z,h,vf,st,b,vx,vz}` (state, about 15 per second), `car`, `chat {m}`, `leave`. Server to client: `welcome`, `join`, `leave`, `car`, `chat`, `S` (batched states of the other players), `err`.
