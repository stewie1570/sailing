# One image: the Vite client is built into the server's wwwroot, then the ASP.NET host is published.
# The container listens on $PORT when the platform sets it, otherwise 8080.

FROM node:22-bookworm-slim AS client
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS server
WORKDIR /src
COPY server/Sailing.Server/Sailing.Server.csproj server/Sailing.Server/
RUN dotnet restore server/Sailing.Server/Sailing.Server.csproj
COPY server/ server/
COPY --from=client /src/server/Sailing.Server/wwwroot server/Sailing.Server/wwwroot
RUN dotnet publish server/Sailing.Server/Sailing.Server.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=server /app/publish .
COPY docker/entrypoint.sh /entrypoint.sh
USER root
RUN chmod +x /entrypoint.sh \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
USER $APP_UID
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1'
ENTRYPOINT ["/entrypoint.sh"]
