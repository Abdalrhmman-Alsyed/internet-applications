#!/bin/sh
# Read replica: on first start, copy the whole primary (pg_basebackup), then run as a
# hot standby that keeps replaying the primary's WAL. Reads only; writes are refused.
set -e
PGDATA=/var/lib/postgresql/data

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "replica: waiting for the primary ($PRIMARY_HOST)..."
  until pg_isready -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -q; do sleep 1; done
  echo "replica: cloning the primary"
  rm -rf "${PGDATA:?}"/*
  PGPASSWORD="$POSTGRES_PASSWORD" pg_basebackup -h "$PRIMARY_HOST" -U "$POSTGRES_USER" -D "$PGDATA" -X stream
  touch "$PGDATA/standby.signal" # start as a standby (read-only, follows the primary)
  chown -R postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
fi

# Connection to the primary, and an optional artificial delay to demonstrate replica lag.
cat > "$PGDATA/conf.d.replica" <<EOF
primary_conninfo = 'host=$PRIMARY_HOST port=5432 user=$POSTGRES_USER password=$POSTGRES_PASSWORD application_name=replica'
recovery_min_apply_delay = '${REPLICA_DELAY_MS:-0}ms'
hot_standby = on
EOF
chown postgres:postgres "$PGDATA/conf.d.replica"
grep -q "conf.d.replica" "$PGDATA/postgresql.conf" || echo "include_if_exists = 'conf.d.replica'" >> "$PGDATA/postgresql.conf"

echo "replica: starting (artificial delay ${REPLICA_DELAY_MS:-0} ms)"
exec su-exec postgres postgres
