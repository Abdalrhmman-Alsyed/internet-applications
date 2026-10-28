#!/bin/sh
set -e

# Apply this service's database migrations (the gateway has no database).
SCHEMA="apps/$APP/prisma/schema.prisma"
if [ -f "$SCHEMA" ]; then
  npx prisma migrate deploy --schema "$SCHEMA"
fi

exec node "dist/apps/$APP/apps/$APP/src/main.js"
