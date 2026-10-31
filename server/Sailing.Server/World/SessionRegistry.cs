using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;

namespace Sailing.Server.World;

public sealed class PlayerSession(string connectionId, string playerId)
{
    public string ConnectionId { get; } = connectionId;
    public string PlayerId { get; } = playerId;
    public string Name { get; set; } = "Sailor";
    public DateTimeOffset ConnectedAt { get; } = DateTimeOffset.UtcNow;
}

/// <summary>In-memory list of connected players. Will become the authoritative world state later.</summary>
public sealed class SessionRegistry
{
    private readonly ConcurrentDictionary<string, PlayerSession> _byConnection = new();

    public int Count => _byConnection.Count;

    public PlayerSession Add(string connectionId)
    {
        var session = new PlayerSession(connectionId, Guid.NewGuid().ToString("N")[..8]);
        _byConnection[connectionId] = session;
        return session;
    }

    public bool Remove(string connectionId, [NotNullWhen(true)] out PlayerSession? session)
        => _byConnection.TryRemove(connectionId, out session);

    public bool TryGet(string connectionId, [NotNullWhen(true)] out PlayerSession? session)
        => _byConnection.TryGetValue(connectionId, out session);
}
