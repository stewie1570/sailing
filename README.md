# Lake Windermere — Sailing & Docking Simulator

Browser-based 3D sailing game targeting older tablets (≈5-year-old iPad) as the performance floor.
Multiplayer-ready from the start: ASP.NET Core + SignalR on the server, Vite + React + three.js on the client.

```
Sailing.sln
server/Sailing.Server/     ASP.NET Core 9 host: SignalR hub, REST, serves the built client
client/                    Vite + React + TypeScript, three.js via @react-three/fiber
tools/mapgen/              Builds the runtime map assets from the painted chart (source-map.jpg)
```

## Running

Two terminals in development (API + hub calls are proxied from Vite to the .NET server):

```bash
# terminal 1 — server on http://localhost:5000
cd server/Sailing.Server && dotnet run

# terminal 2 — client on http://localhost:5173
cd client && npm install && npm run dev
```

Production is one container. The image builds the client into `wwwroot` and runs the server, which
listens on `$PORT` when the host sets it and on 8080 otherwise. SignalR needs WebSockets enabled on
the platform; the health check is `GET /api/health`.

```bash
docker build -t sailing .
docker run --rm -p 8080:8080 sailing
# or: docker compose up --build
```

Regenerate map assets after editing `tools/mapgen/mapgen.mjs` or the source chart:

```bash
cd tools/mapgen && npm install && npm run build   # writes client/public/map/*
```

## Engine choice: three.js (via react-three-fiber)

The goal is "looks realistic, runs on a 5-year-old iPad". three.js was chosen over Babylon.js / PlayCanvas /
Unity-WebGL because:

- Smallest runtime and no engine-level systems running that we don't use. Every draw call and shader is ours,
  which matters on fill-rate-limited mobile GPUs.
- Full control over materials: the terrain, water and sky are small hand-written shaders rather than PBR
  materials, so the per-pixel cost is a fraction of a stock engine look.
- react-three-fiber lets the scene graph be declared alongside React UI (HUD, on-screen controls later)
  without a second component model.

## Rendering budget and techniques

| Element | Technique | Cost |
| --- | --- | --- |
| Terrain | One static mesh displaced on the CPU from a 16-bit heightmap; Lambert + hemisphere lighting; painted colour texture + tiling detail noise; slope-based rock tint | 1 draw, 100k–400k tris by quality |
| Water | One plane with gentle vertex swell. Fragment: 3 scrolling normal-map taps + 2 directional sine waves, Schlick Fresnel, analytic sky reflection (no render target), sun glitter with distance-dependent roughness, depth-driven colour/transparency and shoreline foam from an 8-bit depth texture | 1 draw |
| Sky | Analytic gradient dome shared with the water reflection + a 2-tap cloud layer | 1 draw |
| Trees | Single `InstancedMesh`, 28 tris per tree, ~7k instances concentrated along shorelines | 1 draw |
| Buoys / harbours | Instanced primitives; buoys bob with the swell | 5 draws |

Other decisions aimed at old hardware:

- No MSAA; device pixel ratio capped per quality level (1 / 1.5 / 2) — the biggest lever on tile-based GPUs.
- No shadow maps, no post-processing, no reflection/refraction render targets.
- Exponential fog hides distant detail and gives the haze that a 24 km lake actually has.
- Three quality presets (`client/src/scene/quality.ts`). The HUD exposes them; sustained < 24 fps steps the
  level down automatically.

## Map pipeline (`tools/mapgen`)

The chart image is classified per pixel (deep water / shoal / land; chart UI, buoy glyphs and channel lines
are detected and inpainted). From the classification:

- `heightmap.png` — land rises with distance from shore plus fractal noise; lakebed deepens with distance
  from shore, with shoals held to ~3 m. Encoded 16-bit in R/G, class in B.
- `waterdepth.png` — 8-bit depth for the water shader (GPU-filterable).
- `landcolor.jpg` — the painting itself, cleaned of overlays, with beach/lakebed colouring.
- `waternormal.png`, `detail.png` — tileable procedural textures.
- `mapdata.json` — scale (23.3 m/px from the chart's scale bar), 26 detected lateral buoys, harbours.
- `trees.json` — tree instances sampled from forest pixels, weighted toward the shoreline.

World units are metres; origin at the map centre, +x east, +z south, water at y = 0.

## Server

- `GET /api/health`, `GET /api/world`, `GET /api/sessions`
- SignalR hub at `/hubs/game` (`GameHub`): presence (`Welcome`, `PlayerJoined`, `PlayerLeft`), `Ping`
  for latency, `SetName`. Boat state replication and wind will be added here with the simulation.
