# envguard

Check a .env file against a typed schema, so a missing or malformed variable fails in CI or a pre-commit hook instead of in production. It can also scan a .env for likely secrets and check that it is git-ignored.

[![npm](https://img.shields.io/npm/v/@v0idd0/envguard?color=00f6d0&labelColor=050914)](https://www.npmjs.com/package/@v0idd0/envguard)
[![test](https://github.com/voidd0/envguard/actions/workflows/test.yml/badge.svg)](https://github.com/voidd0/envguard/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-00f6d0?labelColor=050914)](LICENSE)

## Install

```bash
npm install -g @v0idd0/envguard
```

Or run it once without installing: `npx @v0idd0/envguard --help`. Needs Node.js 18 or newer. No dependencies.

## Example

Given this `.env.schema`:

```text
DATABASE_URL=url
PORT=port:min=1024,max=65535
DEBUG=boolean
LOG_LEVEL=enum(debug|info|warn|error):info
API_KEY=secret:min=16
```

and this `.env`:

```text
DATABASE_URL=not-a-url
PORT=80
DEBUG=maybe
LOG_LEVEL=info
```

the check fails and the exit code is 1. Output from a real run on 2026-11-26:

```console
$ envguard check
checking .env against .env.schema

errors:
  ✗ DATABASE_URL: invalid url: "not-a-url"
  ✗ PORT: invalid port: "80"
  ✗ DEBUG: invalid boolean: "maybe"
  ✗ API_KEY: required but missing

✗ failed. 4 error(s).
```

With this valid `.env` (all values are made up) and a `.gitignore` that lists `.env`, the check passes and the scan reports the key by name only:

```text
DATABASE_URL=postgres://demo:demo@localhost:5432/app
PORT=8080
DEBUG=false
LOG_LEVEL=info
API_KEY=demo-key-0123456789abcdef
```

```console
$ envguard check
checking .env against .env.schema

✓ valid. 5 variables checked.

$ envguard scan
scanning .env

  ✓ .env is in .gitignore

  likely secrets (1):
    ⚠ API_KEY  (key-name, len=25)
```

## Usage

```text
envguard v2.0.5
validate .env files against a schema

Usage:
  envguard [command] [options]

Commands:
  check, c        Validate .env against schema (default)
  diff, d         Compare two .env files
  init, i         Generate schema from existing .env
  list, l         List variables in .env
  scan, s         Secret-leak scan (is .env git-ignored? any bare secrets?)

Options:
  -e, --env <path>      Path to .env file (default: .env)
  -s, --schema <path>   Path to schema file (default: .env.schema)
  -o, --output <path>   Output file (for init / diff)
  --strict              Fail on extra variables not in schema
  --quiet               Only output errors
  --json                Emit JSON envelope (for CI)
  --mask-secrets        Redact likely-secret values in output
  --fail-if-leaked      Exit 2 if .env is not git-ignored
  -h, --help            Show this help
  --version             Show version

Schema format (.env.schema):
  # Required
  DATABASE_URL=url
  PORT=port:min=1024,max=65535
  DEBUG=boolean
  LOG_LEVEL=enum(debug|info|warn|error):info
  NODE_ENV=enum(development|staging|production)
  API_KEY=secret:min=32
  SESSION_TIMEOUT=duration            # e.g. 15m, 1h, 2d
  ALLOW_LIST=json                     # must parse as JSON
  USER_ID=uuid
  APP_VERSION=semver
  BIND_IP=ip
  DATA_DIR=dir                        # directory must exist
  CONFIG_FILE?=file                   # optional file
  TRACE_ID=regex:/^[a-z0-9]{16}$/

  Types: string, number, integer, boolean, url, email, port,
         ip, ipv4, ipv6, uuid, semver, duration, json,
         path, dir, file, regex, enum, hex, secret.

Examples:
  envguard                              # check .env vs .env.schema
  envguard check -e .env.local          # specific env file
  envguard check --json | jq .valid     # CI-friendly
  envguard diff .env .env.prod          # compare two env files
  envguard init -e .env -o .env.schema  # auto-generate schema
  envguard scan --fail-if-leaked        # pre-commit gate
  envguard list --mask-secrets          # list with secrets redacted

Docs and issues: https://github.com/voidd0/envguard
```

## Notes

Exit codes: 0 when everything is valid, 1 on validation errors, 2 for `--fail-if-leaked` when .env is not git-ignored.

## License

MIT, see [LICENSE](LICENSE).

---

Made by [vøiddo](https://voiddo.com/?src=gh). More command line tools: [voiddo.com/packages](https://voiddo.com/packages/?src=gh).
We also run data scrapers for job boards, shops and ad libraries: [voiddo.com/scrapers](https://voiddo.com/scrapers/?src=gh).
