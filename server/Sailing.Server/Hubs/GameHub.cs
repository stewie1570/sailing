using System.Text;
using Microsoft.AspNetCore.SignalR;

namespace Sailing.Server.Hubs;

/// <summary>
/// Fan-out for a room, and nothing else. There is no sailor list, no room directory, and no boat
/// state on the server. The only memory is on this socket: which code it asked to join, and whether
/// it claimed the host seat, so a disconnect can be announced and a guest cannot publish the room.
/// That dies with the connection. SignalR groups are the transport fan-out, not a roster.
///
/// The host's browser keeps the room. Each sailor's browser is the authority for their own boat.
/// </summary>
public sealed class GameHub(ILogger<GameHub> logger) : Hub<IGameClient>
{
    public const int MaxSailors = 8;
    public const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private const string RoomKey = "room";
    private const string PlayerKey = "player";
    private const string NameKey = "name";
    private const string HostKey = "host";

    /// <summary>Open a room. The caller becomes the host of this socket only; the roster lives on their machine.</summary>
    public async Task Host(string code, string playerId, string name)
    {
        var room = NormalizeCode(code) ?? throw new HubException("Use a 4-character room code.");
        var id = NormalizeId(playerId) ?? throw new HubException("Bad sailor id.");
        var sailor = NormalizeName(name);
        await LeaveCurrent();
        Remember(room, id, sailor, host: true);
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(room));
        logger.LogInformation("Host {PlayerId} opened room {Room}", id, room);
        // Guests already waiting, and a second host of this code, hear both.
        await Clients.OthersInGroup(Group(room)).PeerArrived(id, sailor, host: true);
        await Clients.OthersInGroup(Group(room)).HostReady();
    }

    /// <summary>Enter a room someone else is hosting. Membership is announced; the host decides whether to keep them.</summary>
    public async Task Join(string code, string playerId, string name)
    {
        var room = NormalizeCode(code) ?? throw new HubException("Use a 4-character room code.");
        var id = NormalizeId(playerId) ?? throw new HubException("Bad sailor id.");
        var sailor = NormalizeName(name);
        await LeaveCurrent();
        Remember(room, id, sailor, host: false);
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(room));
        logger.LogInformation("Sailor {PlayerId} joined room {Room}", id, room);
        await Clients.OthersInGroup(Group(room)).PeerArrived(id, sailor, host: false);
    }

    /// <summary>After the host reconnects they have forgotten who is still here. Guests answer this by presenting again.</summary>
    public Task Present()
    {
        if (TooSoon("presentAt", 200)) return Task.CompletedTask;
        var room = RoomCode;
        var id = PlayerId;
        var sailor = SailorName;
        if (room is null || id is null || sailor is null || IsHost) return Task.CompletedTask;
        return Clients.OthersInGroup(Group(room)).PeerArrived(id, sailor, host: false);
    }

    /// <summary>The host is closing the room on purpose. A dropped socket uses <see cref="PeerLeft"/> instead.</summary>
    public async Task CloseRoom()
    {
        if (!IsHost) return;
        var room = RoomCode;
        if (room is null) return;
        logger.LogInformation("Host closed room {Room}", room);
        await Clients.OthersInGroup(Group(room)).RoomClosed();
        await LeaveCurrent();
    }

    public Task Leave() => LeaveCurrent();

    /// <summary>Host tells one sailor the room will not take them. The server does not decide capacity.</summary>
    public Task Dismiss(string playerId, string reason)
    {
        if (!IsHost) return Task.CompletedTask;
        if (reason is not ("full" or "taken")) return Task.CompletedTask;
        var id = NormalizeId(playerId);
        var room = RoomCode;
        if (id is null || room is null) return Task.CompletedTask;
        return Clients.OthersInGroup(Group(room)).Dismissed(id, reason);
    }

    /// <summary>Relay the host's roster and breeze. Guests cannot publish this.</summary>
    public Task Room(RoomRelay room)
    {
        if (!IsHost || TooSoon("roomAt", 40)) return Task.CompletedTask;
        var code = RoomCode;
        if (code is null || room.Seats is null || room.Seats.Length is < 1 or > MaxSailors) return Task.CompletedTask;
        if (!string.Equals(NormalizeCode(room.Code), code, StringComparison.Ordinal)) return Task.CompletedTask;
        if (!SaneWind(room.Wind)) return Task.CompletedTask;

        var seats = new RoomSeat[room.Seats.Length];
        for (var i = 0; i < room.Seats.Length; i++)
        {
            var seat = room.Seats[i];
            var id = NormalizeId(seat.PlayerId);
            if (id is null || seat.Slot is < 0 or > 64) return Task.CompletedTask;
            seats[i] = new RoomSeat(id, NormalizeName(seat.Name), seat.Host, seat.Slot);
        }

        return Clients.OthersInGroup(Group(code)).Room(new RoomRelay(code, seats, room.Wind));
    }

    /// <summary>Relay this socket's own boat. The player id is taken from the connection, not the payload.</summary>
    public Task Ship(ShipRelay ship)
    {
        if (TooSoon("shipAt", 45)) return Task.CompletedTask;
        var id = PlayerId;
        var room = RoomCode;
        var sailor = SailorName;
        if (id is null || room is null || sailor is null) return Task.CompletedTask;
        if (!Plausible(ship)) return Task.CompletedTask;
        var stamped = ship with { PlayerId = id, Name = sailor };
        return Clients.OthersInGroup(Group(room)).Ship(stamped);
    }

    /// <summary>Relay the host's breeze. Guests follow it; they do not publish their own.</summary>
    public Task Wind(WindRelay wind)
    {
        if (!IsHost || TooSoon("windAt", 80) || !SaneWind(wind)) return Task.CompletedTask;
        var room = RoomCode;
        if (room is null) return Task.CompletedTask;
        return Clients.OthersInGroup(Group(room)).Wind(wind);
    }

    /// <summary>
    /// Relay one AIS text to the room. The sender's id and name come from this socket.
    /// Every other helm hears it and opens the note only if it is addressed to them.
    /// </summary>
    public Task Hail(string toPlayerId, string text)
    {
        var id = PlayerId;
        var room = RoomCode;
        var sailor = SailorName;
        if (id is null || room is null || sailor is null) return Task.CompletedTask;
        var to = NormalizeId(toPlayerId);
        if (to is null || to == id) throw new HubException("Choose another boat.");
        var body = NormalizeHail(text);
        if (body.Length == 0) throw new HubException("Write a message.");
        if (TooSoon("hailAt", 500)) throw new HubException("Wait a moment.");
        return Clients.OthersInGroup(Group(room)).Hail(id, sailor, to, body);
    }

    /// <summary>Round-trip latency probe. The client sends its own timestamp and gets it back.</summary>
    public PongMessage Ping(long clientSentAt) => new(clientSentAt, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        try
        {
            await LeaveCurrent();
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Could not announce a disconnect");
        }
        await base.OnDisconnectedAsync(exception);
    }

    private void Remember(string room, string playerId, string name, bool host)
    {
        Context.Items[RoomKey] = room;
        Context.Items[PlayerKey] = playerId;
        Context.Items[NameKey] = name;
        Context.Items[HostKey] = host;
    }

    private async Task LeaveCurrent()
    {
        if (Context.Items[RoomKey] is not string room) return;
        var id = PlayerId;
        Context.Items.Remove(RoomKey);
        Context.Items.Remove(PlayerKey);
        Context.Items.Remove(NameKey);
        Context.Items.Remove(HostKey);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(room));
        if (id is not null)
        {
            logger.LogInformation("Sailor {PlayerId} left room {Room}", id, room);
            await Clients.Group(Group(room)).PeerLeft(id);
        }
    }

    private bool TooSoon(string key, int minMs)
    {
        var now = Environment.TickCount64;
        if (Context.Items[key] is long last && now - last < minMs) return true;
        Context.Items[key] = now;
        return false;
    }

    private bool IsHost => Context.Items.TryGetValue(HostKey, out var value) && value is true;
    private string? RoomCode => Context.Items.TryGetValue(RoomKey, out var value) ? value as string : null;
    private string? PlayerId => Context.Items.TryGetValue(PlayerKey, out var value) ? value as string : null;
    private string? SailorName => Context.Items.TryGetValue(NameKey, out var value) ? value as string : null;

    private static string Group(string code) => "room:" + code;

    private static bool SaneWind(WindRelay? wind)
        => wind is not null && double.IsFinite(wind.BlowYaw) && Finite(wind.Speed, 0, 40);

    private static bool Plausible(ShipRelay ship)
        => Finite(ship.X, -20000, 20000)
        && Finite(ship.Z, -20000, 20000)
        // Heading is not wrapped, so a long turn walks well past one circle.
        && Finite(ship.Yaw, -100000, 100000)
        && Finite(ship.Rudder, -1.5, 1.5)
        && Finite(ship.Port, -1.5, 1.5)
        && Finite(ship.Starboard, -1.5, 1.5)
        && Finite(ship.Bow, -1.5, 1.5)
        && Finite(ship.Stern, -1.5, 1.5)
        && Finite(ship.Hoist, -0.1, 1.1)
        && Finite(ship.Boom, -4, 4)
        && Finite(ship.JibHoist, -0.1, 1.1)
        && Finite(ship.Clew, -4, 4)
        && Finite(ship.Vane, -8, 8)
        && Finite(ship.Luff, -0.1, 1.1)
        && Finite(ship.JibLuff, -0.1, 1.1)
        && Finite(ship.Speed, -40, 40)
        && Finite(ship.Sway, -40, 40);

    private static bool Finite(double value, double min, double max)
        => double.IsFinite(value) && value >= min && value <= max;

    internal static string? NormalizeCode(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var code = raw.Trim().ToUpperInvariant();
        if (code.Length != 4) return null;
        foreach (var c in code)
        {
            if (Alphabet.IndexOf(c) < 0) return null;
        }
        return code;
    }

    internal static string? NormalizeId(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var id = raw.Trim().ToUpperInvariant();
        if (id.Length != 8) return null;
        foreach (var c in id)
        {
            if (Alphabet.IndexOf(c) < 0) return null;
        }
        return id;
    }

    internal static string NormalizeName(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "Sailor";
        var sb = new StringBuilder();
        foreach (var c in raw.Trim())
        {
            if (char.IsControl(c)) continue;
            sb.Append(c);
            if (sb.Length == 16) break;
        }
        var name = sb.ToString().Trim();
        return name.Length == 0 ? "Sailor" : name;
    }

    /// <summary>One line, no control characters, capped at the same length the helm allows.</summary>
    internal static string NormalizeHail(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var sb = new StringBuilder();
        foreach (var c in raw.Trim())
        {
            if (char.IsControl(c)) continue;
            sb.Append(c);
            if (sb.Length == 160) break;
        }
        return sb.ToString().Trim();
    }
}

/// <summary>Strongly-typed client methods. Every one of these is a relay, not server state.</summary>
public interface IGameClient
{
    Task HostReady();
    Task PeerArrived(string playerId, string name, bool host);
    Task PeerLeft(string playerId);
    Task Room(RoomRelay room);
    Task Ship(ShipRelay ship);
    Task Wind(WindRelay wind);
    Task Hail(string fromId, string fromName, string toId, string text);
    Task Dismissed(string playerId, string reason);
    Task RoomClosed();
}

public sealed record RoomSeat(string PlayerId, string Name, bool Host, int Slot);

public sealed record WindRelay(double BlowYaw, double Speed, bool Shifting);

public sealed record RoomRelay(string Code, RoomSeat[] Seats, WindRelay Wind);

public sealed record ShipRelay(
    string PlayerId,
    string Name,
    double X,
    double Z,
    double Yaw,
    double Rudder,
    double Port,
    double Starboard,
    double Hoist,
    double Boom,
    double JibHoist,
    double Clew,
    double Vane,
    double Luff,
    double JibLuff,
    double Speed,
    double Sway,
    double Bow,
    double Stern);

public sealed record PongMessage(long ClientSentAt, long ServerTime);
