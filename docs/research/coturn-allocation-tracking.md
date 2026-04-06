# Coturn relay allocation tracking and lifecycle integration with a Go control plane

## Executive recommendation

For "clean" (non–log-scraping) allocation lifecycle + byte accounting, the closest thing to a first-class integration point in **coturn** is **Redis stats/status DB** via `--redis-statsdb` / `redis-statsdb=...`. Coturn's own documentation explicitly positions this Redis database as the place that "keeps allocations status information" and can be used for "publishing and delivering traffic and allocation event notifications".

A pragmatic control-plane architecture that meets your goals is:

- **Use `redis-statsdb` for push events** (start/refresh/delete + periodic traffic + final total traffic on delete), and **persist/aggregate in PostgreSQL** in your own schema for audit/billing/metrics.
- **Use the telnet CLI only for "active control" actions** (especially forced termination), because coturn exposes a documented telnet CLI management interface with commands including session listing (`ps`) and force-cancel (`cs <session-id>`).
- **Treat `redis-userdb` / `psql-userdb` strictly as authentication/authorisation backing stores**, not telemetry stores: the schemas exposed for Redis userdb and SQL userdb are about user keys/secrets/realm options/admin users, not allocation/session rows.
- If you want standard monitoring, **enable coturn's Prometheus exporter** (`--prometheus`), but do **not** rely on it as your allocation event stream; and be cautious with per-username labels because coturn warns that ephemeral usernames can cause memory issues.

This combination (Redis statsdb + optional Prometheus + telnet CLI for "kill") is the most direct path to all five of your control-plane requirements without parsing text logs as the primary mechanism.

## Coturn management interfaces and what they can realistically give you

### REST or gRPC admin API

Coturn's upstream docs and manpages describe **two** built-in management interfaces:

- an **HTTPS "Web admin"** interface ("statistics and basic management interface"), gated by admin accounts in an `admin_user` database table;
- a **telnet CLI** interface ("statistics and basic management interface") on `127.0.0.1:5766` by default, configurable via `--cli-ip` / `--cli-port` / `--cli-password`.

In the same official documents, I did **not** find a documented **HTTP REST** or **gRPC** admin API for allocation/session querying comparable to "list allocations, peers, bytes per allocation" endpoints. The explicit, documented control surfaces are the web UI and telnet CLI.

Practical implication: if you need a programmatic control plane, you should plan around **(a)** Redis statsdb pub/sub and **(b)** telnet CLI automation for the few "control" operations you can't do via Redis.

### Telnet CLI capabilities (querying and control)

The telnet CLI is explicitly designed for runtime statistics and "basic management".

From coturn's CLI help strings in source, the CLI includes (among others):

- `ps [username]` and `psp <usernamestr>` to print sessions (exact or partial match),
- `pu [udp|tcp|dtls|tls]` to print current users,
- `cs <session-id>` to cancel a session forcefully,
- `drain`, `stop|shutdown|halt` for draining/shutdown flows.

The `ps` output is rich: an example issue report shows per-session fields including session id, realm, started/expiry timing, client/server/relay addresses, protocol choice, and traffic counters (`usage: rp=…, rb=…, sp=…, sb=…`), plus a list of peers.

For your requirements, this means:

- "Allocation starts/ends" can be inferred by `ps` appearance/disappearance, but **polling** the CLI is typically inferior to Redis statsdb eventing.
- "Force-terminate" is directly supported via `cs <session-id>`, but you will typically need an initial `ps <username>` to discover session ids to cancel.

### HTTPS web-admin capabilities

Coturn describes an HTTPS management interface as "basic and self-explanatory" and indicates it depends on the `admin_user` table being populated.

It is useful for human ops, but because coturn does not document it as a stable machine API, most control planes treat it as a UI rather than an integration layer.

Configuration knobs for the web-admin endpoint are present in the example config (`web-admin`, `web-admin-ip`, `web-admin-port`), with a note that it's HTTPS and not supported if `no-tls` is used.

## Redis integration split-brain: userdb versus statsdb

Coturn's Redis support is commonly misunderstood because there are **two separate roles**:

- `--redis-userdb` / `redis-userdb=...`: authentication / realm / policy data
- `--redis-statsdb` / `redis-statsdb=...`: allocation status + traffic stats + event notifications

### Redis userdb: what keys exist and what they are for

The upstream `schema.userdb.redis` document describes how Redis userdb is structured for long-term credentials and related policy:

- Long-term user keys: `turn/realm/<realm-name>/user/<username>/key` → value is the HMAC key (MD5 of `username:realm:password`).
- Shared secrets ("TURN REST API" secrets): set `turn/realm/<realm-name>/secret` containing one or more secrets.
- Allowed/denied peer IP ranges: sets `turn/realm/<realm>/allowed-peer-ip` and `turn/realm/<realm>/denied-peer-ip`, described as dynamically changeable and "almost immediately 'seen'" by turnserver.
- OAuth KID data, origin→realm mapping, and admin users (`turn/admin_user/<username>` hash with members such as `password` and optionally `realm`).

Crucially for your tracking problem: this schema is about **auth and policy**, not runtime allocations. Nothing in this userdb schema is described as holding per-allocation lifecycle or byte counters.

### Redis statsdb: the closest thing coturn has to lifecycle hooks

The upstream `schema.stats.redis` document is explicitly about "allocation statuses and event notifications" and defines both **stored key schema** and **pub/sub channels** (coturn uses Redis `PUBLISH`).

Key points from this schema:

- **Allocation status** keys are stored as
  `turn/user/<username>/allocation/<id>/status`
  with values like `new lifetime=...` or `refreshed lifetime=...`.
- The same information is also delivered via Redis publish/subscribe; consumers can subscribe with a pattern like:
  `psubscribe turn/realm/*/user/*/allocation/*/status`
- **Traffic** is delivered via publish/subscribe with keys like:
  `turn/user/<username>/allocation/<id>/traffic` and subscription pattern
  `psubscribe turn/realm/*/user/*/allocation/*/traffic`
- **Peer traffic**:
  `.../traffic/peer` and subscribe via
  `psubscribe turn/realm/*/user/*/allocation/*/traffic/peer`
- **Final totals on delete**:
  `.../total_traffic` (and `/total_traffic/peer`) are "reported when the allocation is deleted."

This is, in practice, your event stream:

- Allocation start: first `status` message `new lifetime=…`
- Allocation refresh heartbeats: `status` message `refreshed lifetime=…`
- Allocation end: `status` message `deleted` and/or `total_traffic` event (the schema explicitly calls out totals on delete).

### What do the traffic counters look like?

A historical but concrete example from the project mailing list shows traffic pub/sub messages of the form:

- channel/key: `turn/user/<username>/allocation/<id>/traffic`
- payload: `rcvp=..., rcvb=..., sentp=..., sentb=...`

So you can implement byte accounting as:

- `bytes_up` (client → TURN): `rcvb`
- `bytes_down` (TURN → client): `sentb`

This interpretation (sent bytes are bytes sent to the client; received bytes are bytes received from the client) is consistent with community analysis of coturn's traffic counters.

### Operational gotcha: Redis connection must not expire

`schema.stats.redis` warns that turnserver keeps one Redis connection for its lifetime and that it "must NOT expire", giving Redis configuration hints (`timeout 0`, `tcp-keepalive 60`).

That matters for a control plane because:

- if Redis drops idle TCP connections and coturn doesn't reconnect quickly, you can lose event continuity;
- if your subscriber restarts and misses pub/sub messages, you should have a reconciliation strategy (see the integration design section).

## PostgreSQL integration: what tables exist and what they do not contain

Coturn's SQL schema (`schema.sql`) is small and oriented around **credentials, secrets, and realm policies**:

- `turnusers_lt` (realm, name, hmackey) for long-term user keys,
- `turn_secret` for shared secret values by realm,
- `allowed_peer_ip`, `denied_peer_ip`,
- `turn_origin_to_realm`, `turn_realm_option`,
- `oauth_key`,
- `admin_user`.

There is no allocation/session/event table in this schema, and coturn's docs describe PostgreSQL in the context of *user credentials checks* (and secret storage), not session telemetry.

Two implications that directly answer your questions:

- Coturn's PostgreSQL support is for **auth** (and related policy) and does **not** serve as an "active sessions database" you can query for live allocations.
- Even in long-term credential mode, changing/removing a user credential in the DB does not automatically terminate an existing session: coturn explicitly documents that the "original password becomes the session parameter" and can persist until disconnection.

So: PostgreSQL is a good home for **your own** allocation/audit tables and summaries, but not a direct tap into coturn's runtime state.

## Telemetry options: Prometheus, logs, and their limitations

### Prometheus exporter

Coturn documents a Prometheus exporter:

- `--prometheus` enables metrics, default port `9641`, path `/metrics`; `/` on that port can be used as a health check; and it is "Unavailable on apt installations."
- `--prometheus-username-labels` enables labelling traffic metrics with client usernames, but coturn warns this is disabled by default because it "may cause memory leaks when using authentication with ephemeral usernames (e.g. TURN REST API)."

Concrete metric names seen in issue reports include counters such as:

- `turn_traffic_rcvb`, `turn_traffic_sentb` and their `peer` variants, and totals like `turn_total_traffic_*`.

Two practical notes:

- While Prometheus is valuable for aggregate monitoring, your desire to "correlate allocations back to connect sessions" is at odds with Prometheus label cardinality: coturn itself warns about ephemeral username labels for REST-style auth.
- Prometheus is scrape-based and not an event stream; it will not naturally deliver "created/refreshed/deleted" lifecycle events with full metadata like a pub/sub bus does.

### Log-based approach

Coturn provides multiple runtime log controls (not JSON-structured logging in the docs, but time formatting and routing controls):

- `--new-log-timestamp` enables ISO-8601-style timestamps and `--new-log-timestamp-format` customises formatting;
- `--syslog`, `--no-stdout-log`, `--simple-log` affect where and how logs are written.

In practice, coturn logs can include per-session traffic counters, and an issue comparing CLI to Redis shows lines like:

`session <id>: usage: realm=<...>, username=<...>, rp=..., rb=..., sp=..., sb=...`

as well as a peer usage line.

If you *must* log-parse, you can often reach "allocation create/delete + bytes" at higher verbosity, but Redis statsdb is explicitly designed to deliver those events and totals.

## A Go control-plane integration design that satisfies your ten questions

### Mapping your requirements to coturn's real hooks

Your five control-plane goals map cleanly onto `redis-statsdb` plus a small amount of telnet CLI automation:

- **Know when an allocation starts and ends**: subscribe to `.../status` and treat `new lifetime=...` as start and `deleted`/`total_traffic` as end.
- **Track bytes_up / bytes_down per allocation**: consume `.../traffic` updates and/or `.../total_traffic` on deletion; count `rcvb` as up and `sentb` as down.
- **Correlate allocations back to connect sessions**: embed your session id in the TURN username; coturn's REST-style username format is explicitly `timestamp + ":" + username`, and real published keys show the full username embedded in the Redis channel/key.
- **Revoke/expire allocations from the control plane side**:
  - "expire credentials" blocks **new** usage, but does not terminate an already-established allocation/session (coturn documents long-lived sessions and a user report confirms TTL does not kill an active session).
  - for immediate termination, use telnet CLI `cs <session-id>` after discovering session ids via `ps <username>`.
- **Emit audit events and metrics**: treat Redis statsdb pub/sub as your raw event stream; persist to PostgreSQL; then emit your own Prometheus/OTel metrics from the Go control plane without high-cardinality coturn labels.

### Configuration flags you'll actually use

A minimal coturn configuration set for your goals (expressed as "what to look for" in `turnserver.conf`) is:

- TURN REST / auth-secret credentials:
  - `use-auth-secret` / `static-auth-secret` (your existing approach),
  - `realm=...`,
  - optionally `rest-api-separator=:` if you keep the default.

- Redis statsdb (core of tracking):
  - `redis-statsdb="ip=... dbname=... password=... port=... connect_timeout=..."`

- Telnet CLI (for kill/revocation and ad-hoc introspection):
  - `cli-ip=127.0.0.1`
  - `cli-port=5766`
  - `cli-password=...` (encrypted form recommended)

- Prometheus (optional, for server-level monitoring):
  - `prometheus` (or `--prometheus`)
  - avoid `prometheus-username-labels` for ephemeral usernames unless you have tested memory/cardinality impact.

- Logging quality-of-life:
  - `new-log-timestamp`, `simple-log`, `syslog` as needed for your ops tooling.

### Redis subscription patterns and parsing strategy

From `schema.stats.redis`, use pattern subscriptions such as:

- `turn/realm/*/user/*/allocation/*/status`
- `turn/realm/*/user/*/allocation/*/traffic`
- `turn/realm/*/user/*/allocation/*/traffic/peer`
- `turn/realm/*/user/*/allocation/*/total_traffic`
- `turn/realm/*/user/*/allocation/*/total_traffic/peer`

Then parse payloads like `new lifetime=1800` / `refreshed lifetime=600` and `rcvp=1025, rcvb=224660, sentp=1023, sentb=281136`.

A robust control-plane approach is:

- Treat pub/sub as the **primary** event source.
- Persist an **idempotent** event log or current-state row in PostgreSQL keyed by `(realm, username, allocation_id)`.
- On startup, optionally reconcile by scanning for existing `.../status` keys (using `SCAN` patterns) *if* you can tolerate the overhead; pub/sub alone can miss events during restarts. (The schema describes status being stored as keys in Redis, not only published.)

### Suggested PostgreSQL schema for control-plane accounting

Coturn won't create session telemetry tables for you, so create your own, for example:

- `turn_allocation` keyed by `(realm, username, allocation_id)` storing timestamps (`first_seen`, `last_refresh`, `ended_at`), last known lifetime, and byte counters.
- Optional `turn_allocation_peer` keyed by `(realm, username, allocation_id, peer_addr)` if you subscribe to peer traffic.
- An append-only `turn_allocation_event` table if you need full auditability and post-hoc reconstruction.

This fits your "emit audit events and metrics" requirement while keeping coturn's runtime footprint and interfaces simple.

### Forced termination and revocation: what works and what does not

This is the most important "gotcha" area.

**Credential TTL does not imply allocation TTL.** A user report with `static-auth-secret` shows that after the credential TTL elapses, an existing session can keep flowing traffic; only reconnection fails with 401.

Coturn's own documentation explains why in long-term style sessions: the original password becomes a per-session parameter and can persist "forever" until disconnection; changing the password in the DB won't affect the live session.

Therefore, deleting a credential from Redis/PostgreSQL userdb will, at best, prevent *new* authentication, but it will not be a reliable "kill switch" for allocations that are already established.

**Immediate revocation path** inside coturn is operationally the telnet CLI's force-cancel:

- `ps <username>` to list sessions for that user
- `cs <session-id>` to cancel a session forcefully

If you need "one API call from the control plane kills relay now", in practice you build a small internal component that can speak to the telnet CLI locally (sidecar pattern) and perform `ps`+`cs` automatically.

### Production deployment patterns: what most projects do

Mainstream deployments in open-source comms stacks overwhelmingly focus on **issuing time-limited TURN credentials** via a shared secret (TURN REST–style), and operational monitoring, rather than deep allocation tracking:

- Matrix Synapse documentation describes generating credentials valid for use on the TURN server "through the use of a secret shared between the homeserver and the TURN server" (i.e., credential issuance), without presenting allocation-tracking integration as a standard part of the setup.
- Nextcloud Talk documentation similarly instructs configuring coturn with an "authentication secret" and standard TURN ports, again focusing on connectivity rather than allocation accounting.

Based on the emphasis of these widely used docs, the common path is: **rely on credential TTL + server quotas/caps + aggregate monitoring**, and do not build a first-party allocation ledger unless you have a billing/audit requirement. That said, coturn *does* provide `redis-statsdb` explicitly for allocation status + traffic notifications, so if your product needs audit-grade relay usage records, you're not forced into pure log parsing.

### Direct answers to your ten specific questions

Coturn does not document a REST/gRPC allocation admin API. The documented management interfaces are the HTTPS web admin and the telnet CLI.

Coturn does not document "webhooks" for lifecycle events, but it does document Redis `--redis-statsdb` as a way to publish allocation lifecycle and traffic events via Redis pub/sub patterns.

With `redis-userdb`, coturn expects the user/policy key schema described in `schema.userdb.redis` (user keys, secrets sets, allow/deny peer sets, admin users, etc.). Allocation tracking is instead described under `redis-statsdb` with keys/channels like `.../allocation/<id>/status` and `.../traffic`.

With `psql-userdb`, coturn uses the SQL schema in `schema.sql` (turnusers_lt, turn_secret, allowed/denied peer ip, origin mapping, realm options, oauth_key, admin_user). This is for credentials/secrets/policy; it is not an allocation/session telemetry schema.

`turnadmin` is a database admin tool for managing user accounts/keys/secrets/realm options etc, not for runtime allocation querying; runtime session querying is via telnet CLI (`ps`, etc.).

Coturn supports Prometheus metrics export (`--prometheus`, port 9641, `/metrics`) subject to build/package limitations; it also provides Redis statsdb as a monitoring/notification mechanism; SNMP is not described in the upstream docs cited here.

Logs can include session usage counters and you can improve log timestamps/rollover behaviour with flags like `--new-log-timestamp` and `--simple-log`, but Redis statsdb is the explicitly documented structured event mechanism.

Yes: the REST-style username format is `timestamp + ":" + username`, and published Redis keys include the provided username, so embedding `timestamp:session_id` gives a straightforward join key back to your connect-session id.

For revocation: deleting credentials from userdb does not reliably kill an established session (coturn documents that the session may persist with the original password; user reports confirm TTL doesn't end the session). Immediate termination is via telnet CLI `cs <session-id>`.

Many deployments (e.g., Synapse and Nextcloud Talk) focus on issuing time-limited credentials with a shared secret and standard monitoring; allocation-by-allocation tracking is not presented as a common default pattern in their setup docs. If you need it, `redis-statsdb` is coturn's intended mechanism.
