#!/bin/sh
# Cloud hosts (Render, Railway, Fly, Cloud Run, and others) inject PORT. Kestrel otherwise
# listens on ASPNETCORE_HTTP_PORTS, which the image defaults to 8080.
if [ -n "${PORT:-}" ]; then
  export ASPNETCORE_HTTP_PORTS="$PORT"
fi
exec dotnet Sailing.Server.dll
