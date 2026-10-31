using Microsoft.AspNetCore.SignalR;
using Sailing.Server.World;

namespace Sailing.Server.Hubs;

/// <summary>
/// Real-time channel between clients and the server. Right now it only tracks presence and answers
/// pings; boat state replication, wind and race events will be added here once the simulation exists.
/// </summary>
public sealed class GameHub(SessionRegistry sessions, ILogger<GameHub> logger) : Hub<IGameClient>
{
    public override async Task OnConnectedAsync()
    {
        var session = sessions.Add(Context.ConnectionId);
        logger.LogInformation("Player {PlayerId} connected ({Count} online)", session.PlayerId, sessions.Count);

        await Clients.Caller.Welcome(new WelcomeMessage(session.PlayerId, DateTimeOffset.UtcNow, sessions.Count));
        await Clients.Others.PlayerJoined(session.PlayerId, sessions.Count);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (sessions.Remove(Context.ConnectionId, out var session))
        {
            logger.LogInformation("Player {PlayerId} disconnected ({Count} online)", session.PlayerId, sessions.Count);
            await Clients.Others.PlayerLeft(session.PlayerId, sessions.Count);
        }
        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>Round-trip latency probe. The client sends its own timestamp and gets it back with server time.</summary>
    public PongMessage Ping(long clientSentAt) => new(clientSentAt, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

    /// <summary>Lets a player pick a display name; broadcast so other clients can label boats later.</summary>
    public async Task SetName(string name)
    {
        var trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length is 0 or > 24) return;
        if (sessions.TryGet(Context.ConnectionId, out var session))
        {
            session.Name = trimmed;
            await Clients.All.PlayerRenamed(session.PlayerId, trimmed);
        }
    }
}

/// <summary>Strongly-typed client methods the server can invoke.</summary>
public interface IGameClient
{
    Task Welcome(WelcomeMessage message);
    Task PlayerJoined(string playerId, int online);
    Task PlayerLeft(string playerId, int online);
    Task PlayerRenamed(string playerId, string name);
}

public sealed record WelcomeMessage(string PlayerId, DateTimeOffset ServerTime, int Online);
public sealed record PongMessage(long ClientSentAt, long ServerTime);
