namespace Sailing.Server.World;

/// <summary>
/// Static description of the world the server hosts. The heavy map assets (heightmap, textures) are plain
/// static files under /map; this just tells clients which world to load and the shared conventions.
/// </summary>
public sealed class WorldInfo
{
    public string Name { get; } = "Lake Windermere";
    public string MapBasePath { get; } = "/map";
    public double WaterLevel { get; } = 0;
    /// <summary>
    /// Hint only. The server does not simulate: each sailor ticks their own boat, and the host keeps the room.
    /// </summary>
    public int TickRateHz { get; } = 20;
}
