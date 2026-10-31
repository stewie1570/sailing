using Sailing.Server.Hubs;
using Sailing.Server.World;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
    // Tuned for a real-time game: generous enough for slow tablets on Wi-Fi, short enough to drop dead peers quickly.
    options.KeepAliveInterval = TimeSpan.FromSeconds(10);
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(30);
});

builder.Services.AddSingleton<WorldInfo>();
builder.Services.AddSingleton<SessionRegistry>();

// The Vite dev server runs on a different origin; allow it in development. SignalR with WebSockets needs
// credentials allowed for the negotiate step.
const string DevCors = "DevClient";
builder.Services.AddCors(options =>
{
    options.AddPolicy(DevCors, policy => policy
        .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseCors(DevCors);
}

// Production: serve the built client from wwwroot.
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", time = DateTimeOffset.UtcNow }));
app.MapGet("/api/world", (WorldInfo world) => Results.Ok(world));
app.MapGet("/api/sessions", (SessionRegistry sessions) => Results.Ok(new { count = sessions.Count }));

app.MapHub<GameHub>("/hubs/game");

// SPA fallback for client-side routes (only when a built client exists).
app.MapFallbackToFile("index.html");

app.Run();
