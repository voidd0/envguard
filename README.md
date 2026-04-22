# envguard

**Validate `.env` files against a typed schema.** Catch `undefined`, `PORT=not-a-number`, missing secrets, and "`.env` leaked into git" — before your server tries to boot.

Free forever gift from [vøiddo](https://voiddo.com).

```
$ envguard check
checking .env against .env.schema

errors:
  ✗ PORT: invalid port: "hello"
  ✗ DATABASE_URL: required but missing
warnings:
  ⚠ LOG_LEVEL: missing, using default: info

✗ failed. 2 error(s).
```

## Why envguard

`dotenv` loads your `.env` into `process.env` without complaining about missing keys or bad types. You find out at runtime, usually at 2 AM. envguard fails at boot time — or better yet, at `pre-commit` time — so nothing that can't parse `PORT=3000` ever reaches production.

- **21 typed validators** (url, uuid, semver, duration, json, ip, enum, regex, secret, ...)
- **Constraints**: `port:min=1024,max=65535`, `string:min=8,max=64`
- **Auto-schema** from existing `.env` (`envguard init`)
- **Secret-leak scanner**: is `.env` in `.gitignore`? do keys/values smell like secrets?
- **CI-ready**: `--json` envelope, proper exit codes, `--fail-if-leaked`

## Install

```bash
npm install -g @v0idd0/envguard
```

Or run ad-hoc with `npx`:

```bash
npx -y @v0idd0/envguard check
```

## Quickstart

```bash
# Validate .env against .env.schema
envguard

# First-time setup: auto-generate a schema from an existing .env
envguard init

# Secret-leak scan (pre-commit gate)
envguard scan --fail-if-leaked

# Diff two env files (e.g., dev vs prod)
envguard diff .env .env.prod

# List variables with secrets masked
envguard list --mask-secrets

# CI mode — JSON envelope, exit code 0/1
envguard check --json | jq .valid
```

## Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `check` | `c` | Validate `.env` against `.env.schema` (default) |
| `diff`  | `d` | Compare two `.env` files — what's only in one, what differs |
| `init`  | `i` | Auto-generate schema from an existing `.env` |
| `list`  | `l` | List variables in `.env` |
| `scan`  | `s` | Secret-leak scan: gitignore check + secret shape detection |

## Schema format

One line per var: `KEY=type[:constraints]` — or `KEY?` for optional, `KEY=default` for a plain default.

```env
# Required, typed
DATABASE_URL=url
PORT=port:min=1024,max=65535
NODE_ENV=enum(development|staging|production)
LOG_LEVEL=enum(debug|info|warn|error):info
SESSION_TIMEOUT=duration               # 15m, 1h, 2d, 500ms
USER_ID=uuid
APP_VERSION=semver
BIND_IP=ip
API_KEY=secret:min=32
ALLOW_LIST=json
TRACE_ID=regex:/^[a-z0-9]{16}$/
DATA_DIR=dir                           # directory must exist
CONFIG_FILE=file                       # file must exist

# Optional (with ?)
TELEMETRY_URL?=url

# Plain default (no type)
MAX_RETRIES=3
```

## Types (21)

| Type | What it accepts |
|------|-----------------|
| `string` | any string; supports `min`/`max` length |
| `number` | any numeric; supports `min`/`max` |
| `integer` | whole numbers; supports `min`/`max` |
| `boolean` | `true`/`false`/`1`/`0`/`yes`/`no`/`on`/`off` |
| `url` | anything `new URL()` accepts |
| `email` | `user@host.tld` |
| `port` | 1–65535 (supports `min`/`max`) |
| `ip` | IPv4 or IPv6 |
| `ipv4` / `ipv6` | specific address family |
| `uuid` | RFC 4122 UUID v1–v5 |
| `semver` | `1.2.3`, `2.0.0-beta.1`, `1.0.0+build` |
| `duration` | `15m`, `2h`, `500ms`, `1d`, `1w` |
| `json` | parseable JSON |
| `path` | any non-empty path string |
| `dir` | path that resolves to a directory on disk |
| `file` | path that resolves to a file on disk |
| `regex` | `regex:/pattern/flags` |
| `enum` | `enum(a\|b\|c)` |
| `hex` | `[0-9a-fA-F]+` |
| `secret` | any string ≥16 chars (overridable with `min=`) |

## Options

| Flag | Description |
|------|-------------|
| `-e, --env <path>` | Path to `.env` file (default `.env`) |
| `-s, --schema <path>` | Path to schema file (default `.env.schema`) |
| `-o, --output <path>` | Output file (for `init`) |
| `--strict` | Fail on extra variables not in the schema |
| `--quiet` | Only print errors |
| `--json` | Emit a JSON envelope (for CI) |
| `--mask-secrets` | Redact likely-secret values in output |
| `--fail-if-leaked` | `scan` exits with code `2` if `.env` is not git-ignored |
| `-h, --help` | Show help |
| `--version` | Show version |

## Secret-leak scanner

`envguard scan` walks your `.env` and reports:
1. Whether `.env` is listed in `.gitignore` (green ✓ / red ✗).
2. Every variable whose *name* looks like a secret (`SECRET`, `TOKEN`, `KEY`, `PASS`, `PRIVATE`, `CRED`, `AUTH`, `APIKEY`) or whose *value* looks like one (24+ high-entropy chars).

Wire it into `.git/hooks/pre-commit` or CI:

```bash
envguard scan --fail-if-leaked || exit 1
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | Validation passed / scan clean |
| `1`  | Validation failed, file missing, or unknown command |
| `2`  | `scan --fail-if-leaked` and `.env` is not in `.gitignore` |

## Programmatic use

```js
const {
  parseEnvFile, parseSchema, validate, diff,
  generateSchema, detectType, detectSecrets, looksLikeSecret,
  validateValue, maskValue, parseDurationMs, isGitIgnored,
} = require('@v0idd0/envguard/src/validator');

const envVars = parseEnvFile('.env');
const schema  = parseSchema('.env.schema');
const result  = validate(envVars, schema);

if (!result.valid) {
  console.error('bad env:', result.errors);
  process.exit(1);
}

// Custom validators
validateValue('15m', 'duration');                       // true
validateValue('50', 'integer', { min: 1, max: 100 });   // true
validateValue('prod', 'enum', { values: ['dev', 'prod'] }); // true

// Secret scan
detectSecrets(envVars);        // [{ key, reason, length }, ...]
isGitIgnored('.env');          // true / false / null
```

## From the same studio

vøiddo builds sharp, free-forever CLIs for devs who are tired of paywalls:

- [`@v0idd0/jsonyo`](https://voiddo.com/tools/jsonyo/) — JSON that yells at you when it's broken
- [`@v0idd0/tokcount`](https://voiddo.com/tools/tokcount/) — token counter for 60+ LLMs
- [`@v0idd0/ctxstuff`](https://voiddo.com/tools/ctxstuff/) — stuff a repo into an LLM context window
- [`@v0idd0/promptdiff`](https://voiddo.com/tools/promptdiff/) — diff two prompts with token impact
- [`@v0idd0/httpwut`](https://voiddo.com/tools/httpwut/) — HTTP debugger with DNS/TCP/TLS phase timing
- [`@v0idd0/gitstats`](https://voiddo.com/tools/gitstats/) — local git analytics (hotspots, bus-factor)
- [`@v0idd0/licenseme`](https://voiddo.com/tools/licenseme/) — LICENSE generator + detector (18 licenses)

Full catalog: [voiddo.com/tools](https://voiddo.com/tools/).

## License

MIT © [vøiddo](https://voiddo.com) — free forever, no asterisks.

## Links

- Docs: https://voiddo.com/tools/envguard/
- Source: https://github.com/voidd0/envguard
- npm: https://npmjs.com/package/@v0idd0/envguard
- Studio: https://voiddo.com
- Issues: https://github.com/voidd0/envguard/issues
- Support: support@voiddo.com
