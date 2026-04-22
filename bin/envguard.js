#!/usr/bin/env node
// envguard — .env validator, schema generator, secret scanner. Free forever from vøiddo.
// https://voiddo.com/tools/envguard/

const fs = require('fs');
const path = require('path');
const {
  parseEnvFile,
  parseSchema,
  validate,
  diff,
  generateSchema,
  detectSecrets,
  isGitIgnored,
  maskValue,
} = require('../src/validator');
const { maybeShowPromo, getHelpFooter } = require('../src/promo');

const pkg = require('../package.json');
const args = process.argv.slice(2);

const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function printHelp() {
  console.log(`
${YELLOW}envguard${RESET} ${DIM}v${pkg.version}${RESET}
${DIM}validate .env files against a schema — free forever from vøiddo${RESET}

${CYAN}Usage:${RESET}
  envguard [command] [options]

${CYAN}Commands:${RESET}
  check, c        Validate .env against schema (default)
  diff, d         Compare two .env files
  init, i         Generate schema from existing .env
  list, l         List variables in .env
  scan, s         Secret-leak scan (is .env git-ignored? any bare secrets?)

${CYAN}Options:${RESET}
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

${CYAN}Schema format (.env.schema):${RESET}
  # Required
  DATABASE_URL=url
  PORT=port:min=1024,max=65535
  DEBUG=boolean
  LOG_LEVEL=enum(debug|info|warn|error):info
  NODE_ENV=enum(development|staging|production)
  API_KEY=secret:min=32
  SESSION_TIMEOUT=duration            ${DIM}# e.g. 15m, 1h, 2d${RESET}
  ALLOW_LIST=json                     ${DIM}# must parse as JSON${RESET}
  USER_ID=uuid
  APP_VERSION=semver
  BIND_IP=ip
  DATA_DIR=dir                        ${DIM}# directory must exist${RESET}
  CONFIG_FILE?=file                   ${DIM}# optional file${RESET}
  TRACE_ID=regex:/^[a-z0-9]{16}$/

  Types: string, number, integer, boolean, url, email, port,
         ip, ipv4, ipv6, uuid, semver, duration, json,
         path, dir, file, regex, enum, hex, secret.

${CYAN}Examples:${RESET}
  envguard                              ${DIM}# check .env vs .env.schema${RESET}
  envguard check -e .env.local          ${DIM}# specific env file${RESET}
  envguard check --json | jq .valid     ${DIM}# CI-friendly${RESET}
  envguard diff .env .env.prod          ${DIM}# compare two env files${RESET}
  envguard init -e .env -o .env.schema  ${DIM}# auto-generate schema${RESET}
  envguard scan --fail-if-leaked        ${DIM}# pre-commit gate${RESET}
  envguard list --mask-secrets          ${DIM}# list with secrets redacted${RESET}

${DIM}docs: https://voiddo.com/tools/envguard/${RESET}${getHelpFooter()}
`);
}

function parseArgs() {
  const result = {
    command: 'check',
    envFile: '.env',
    schemaFile: '.env.schema',
    output: null,
    strict: false,
    quiet: false,
    help: false,
    version: false,
    json: false,
    maskSecrets: false,
    failIfLeaked: false,
    files: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') { result.help = true; continue; }
    if (arg === '--version') { result.version = true; continue; }
    if (arg === '-e' || arg === '--env') { result.envFile = args[++i]; continue; }
    if (arg === '-s' || arg === '--schema') { result.schemaFile = args[++i]; continue; }
    if (arg === '-o' || arg === '--output') { result.output = args[++i]; continue; }
    if (arg === '--strict') { result.strict = true; continue; }
    if (arg === '--quiet') { result.quiet = true; continue; }
    if (arg === '--json') { result.json = true; continue; }
    if (arg === '--mask-secrets') { result.maskSecrets = true; continue; }
    if (arg === '--fail-if-leaked') { result.failIfLeaked = true; continue; }
    if (!arg.startsWith('-')) {
      const cmd = arg.toLowerCase();
      if (['check', 'c', 'diff', 'd', 'init', 'i', 'list', 'l', 'scan', 's'].includes(cmd) && result.files.length === 0 && result.command === 'check') {
        result.command = cmd;
      } else {
        result.files.push(arg);
      }
    }
  }

  return result;
}

function emitJson(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

function runCheck(opts) {
  const envFile = opts.files[0] || opts.envFile;
  const envVars = parseEnvFile(envFile);

  if (!envVars) {
    const err = { command: 'check', ok: false, error: `${envFile} not found` };
    if (opts.json) { emitJson(err); return 1; }
    console.error(`error: ${envFile} not found`);
    return 1;
  }

  const schema = parseSchema(opts.schemaFile);

  if (!schema) {
    const err = { command: 'check', ok: false, error: `${opts.schemaFile} not found`, hint: 'run "envguard init" to generate a schema' };
    if (opts.json) { emitJson(err); return 1; }
    console.error(`error: ${opts.schemaFile} not found`);
    console.error('hint: run "envguard init" to generate a schema');
    return 1;
  }

  const result = validate(envVars, schema);

  if (opts.json) {
    emitJson({
      command: 'check',
      ok: result.valid && (!opts.strict || result.extra.length === 0),
      envFile,
      schemaFile: opts.schemaFile,
      ...result,
    });
    return result.valid && (!opts.strict || result.extra.length === 0) ? 0 : 1;
  }

  if (!opts.quiet) {
    console.log(`checking ${envFile} against ${opts.schemaFile}\n`);
  }

  if (result.errors.length > 0) {
    console.log(`${RED}errors:${RESET}`);
    for (const err of result.errors) {
      console.log(`  ${RED}✗${RESET} ${err.key}: ${err.message}`);
    }
    console.log('');
  }

  if (result.warnings.length > 0 && !opts.quiet) {
    console.log(`${YELLOW}warnings:${RESET}`);
    for (const warn of result.warnings) {
      console.log(`  ${YELLOW}⚠${RESET} ${warn.key}: ${warn.message}`);
    }
    console.log('');
  }

  if (result.extra.length > 0 && !opts.quiet) {
    console.log(`${DIM}extra variables (not in schema):${RESET}`);
    for (const key of result.extra) {
      console.log(`  ${DIM}? ${key}${RESET}`);
    }
    console.log('');
  }

  const ok = result.valid && (!opts.strict || result.extra.length === 0);
  if (ok) {
    if (!opts.quiet) console.log(`${GREEN}✓ valid.${RESET} ${result.defined} variables checked.`);
    return 0;
  }
  if (opts.strict && result.extra.length > 0) {
    console.log(`${RED}✗ failed.${RESET} ${result.extra.length} extra variable(s) in strict mode.`);
  } else {
    console.log(`${RED}✗ failed.${RESET} ${result.errors.length} error(s).`);
  }
  return 1;
}

function runDiff(opts) {
  if (opts.files.length < 2) {
    if (opts.json) emitJson({ command: 'diff', ok: false, error: 'need two files' });
    else console.error('error: need two files to diff\nusage: envguard diff .env .env.prod');
    return 1;
  }

  const env1 = parseEnvFile(opts.files[0]);
  const env2 = parseEnvFile(opts.files[1]);
  if (!env1 || !env2) {
    const missing = !env1 ? opts.files[0] : opts.files[1];
    if (opts.json) emitJson({ command: 'diff', ok: false, error: `${missing} not found` });
    else console.error(`error: ${missing} not found`);
    return 1;
  }

  const result = diff(env1, env2);

  if (opts.json) {
    emitJson({ command: 'diff', ok: true, files: opts.files.slice(0, 2), ...result });
    return 0;
  }

  console.log(`comparing ${opts.files[0]} vs ${opts.files[1]}\n`);
  if (result.onlyIn1.length) {
    console.log(`${DIM}only in ${opts.files[0]}:${RESET}`);
    for (const key of result.onlyIn1) console.log(`  - ${key}`);
    console.log('');
  }
  if (result.onlyIn2.length) {
    console.log(`${DIM}only in ${opts.files[1]}:${RESET}`);
    for (const key of result.onlyIn2) console.log(`  + ${key}`);
    console.log('');
  }
  if (result.different.length) {
    console.log(`${YELLOW}different values:${RESET}`);
    for (const key of result.different) {
      const v1 = opts.maskSecrets ? maskValue(env1[key]) : env1[key];
      const v2 = opts.maskSecrets ? maskValue(env2[key]) : env2[key];
      console.log(`  ~ ${key}`);
      console.log(`    ${opts.files[0]}: ${v1}`);
      console.log(`    ${opts.files[1]}: ${v2}`);
    }
    console.log('');
  }
  console.log(`summary: ${result.same} same, ${result.different.length} different, ${result.onlyIn1.length + result.onlyIn2.length} unique`);
  return 0;
}

function runInit(opts) {
  const envFile = opts.files[0] || opts.envFile;
  const envVars = parseEnvFile(envFile);

  if (!envVars) {
    if (opts.json) emitJson({ command: 'init', ok: false, error: `${envFile} not found` });
    else console.error(`error: ${envFile} not found`);
    return 1;
  }

  const schema = generateSchema(envVars);
  const outputFile = opts.output || '.env.schema';

  fs.writeFileSync(outputFile, schema);
  if (opts.json) {
    emitJson({ command: 'init', ok: true, output: outputFile, variables: Object.keys(envVars).length });
  } else {
    console.log(`${GREEN}✓${RESET} schema generated: ${outputFile}`);
    console.log(`  ${Object.keys(envVars).length} variables detected`);
  }
  return 0;
}

function runList(opts) {
  const envFile = opts.files[0] || opts.envFile;
  const envVars = parseEnvFile(envFile);

  if (!envVars) {
    if (opts.json) emitJson({ command: 'list', ok: false, error: `${envFile} not found` });
    else console.error(`error: ${envFile} not found`);
    return 1;
  }

  const secretsSet = new Set(detectSecrets(envVars).map((s) => s.key));

  if (opts.json) {
    const rows = Object.entries(envVars).map(([key, value]) => ({
      key,
      value: secretsSet.has(key) && opts.maskSecrets ? maskValue(value) : value,
      secret: secretsSet.has(key),
    }));
    emitJson({ command: 'list', ok: true, envFile, count: rows.length, variables: rows });
    return 0;
  }

  console.log(`variables in ${envFile}:\n`);
  for (const [key, value] of Object.entries(envVars)) {
    const display = secretsSet.has(key) && opts.maskSecrets
      ? maskValue(value)
      : (value.length > 40 ? value.slice(0, 37) + '...' : value);
    const tag = secretsSet.has(key) ? ` ${DIM}[secret]${RESET}` : '';
    console.log(`  ${key}=${display}${tag}`);
  }
  console.log(`\ntotal: ${Object.keys(envVars).length}`);
  return 0;
}

function runScan(opts) {
  const envFile = opts.files[0] || opts.envFile;
  const envVars = parseEnvFile(envFile);

  if (!envVars) {
    if (opts.json) emitJson({ command: 'scan', ok: false, error: `${envFile} not found` });
    else console.error(`error: ${envFile} not found`);
    return 1;
  }

  const cwd = path.dirname(path.resolve(envFile));
  const ignored = isGitIgnored(path.basename(envFile), cwd);
  const secrets = detectSecrets(envVars);

  const payload = {
    command: 'scan',
    ok: (ignored !== false) && secrets.length >= 0,
    envFile,
    gitignored: ignored,
    secretsDetected: secrets.length,
    secrets,
  };

  if (opts.json) {
    emitJson(payload);
  } else {
    console.log(`scanning ${envFile}\n`);
    if (ignored === true) {
      console.log(`  ${GREEN}✓${RESET} ${envFile} is in .gitignore`);
    } else if (ignored === false) {
      console.log(`  ${RED}✗ ${envFile} is NOT in .gitignore${RESET}  ${DIM}(secrets could leak!)${RESET}`);
    } else {
      console.log(`  ${DIM}? no .gitignore found in ${cwd}${RESET}`);
    }
    console.log();
    if (secrets.length) {
      console.log(`  ${YELLOW}likely secrets (${secrets.length}):${RESET}`);
      for (const s of secrets) {
        console.log(`    ${YELLOW}⚠${RESET} ${s.key}  ${DIM}(${s.reason}, len=${s.length})${RESET}`);
      }
    } else {
      console.log(`  ${GREEN}✓${RESET} no obvious secrets detected`);
    }
    console.log();
  }

  if (opts.failIfLeaked && ignored === false) return 2;
  return 0;
}

function main() {
  const opts = parseArgs();

  if (opts.help) { printHelp(); return 0; }
  if (opts.version) { console.log(pkg.version); return 0; }

  let code = 0;
  switch (opts.command) {
    case 'check':
    case 'c':
      code = runCheck(opts); break;
    case 'diff':
    case 'd':
      code = runDiff(opts); break;
    case 'init':
    case 'i':
      code = runInit(opts); break;
    case 'list':
    case 'l':
      code = runList(opts); break;
    case 'scan':
    case 's':
      code = runScan(opts); break;
    default:
      if (opts.json) emitJson({ ok: false, error: `unknown command "${opts.command}"` });
      else console.error(`error: unknown command "${opts.command}"`);
      code = 1;
  }

  maybeShowPromo();
  return code;
}

process.exit(main() || 0);
