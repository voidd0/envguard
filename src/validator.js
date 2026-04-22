// envguard — .env validator. Free forever from vøiddo. https://voiddo.com/tools/envguard/

const fs = require('fs');
const path = require('path');

const TYPES = [
  'string', 'number', 'integer', 'boolean', 'url', 'email', 'port',
  'ip', 'ipv4', 'ipv6', 'uuid', 'semver', 'duration', 'json',
  'path', 'dir', 'file', 'regex', 'enum', 'hex', 'secret',
];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const vars = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
  }
  return vars;
}

function parseSchema(schemaPath) {
  if (!fs.existsSync(schemaPath)) return null;
  const content = fs.readFileSync(schemaPath, 'utf8');
  const schema = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([^=?]+)(\?)?(?:=(.*))?$/);
    if (!match) continue;
    const key = match[1].trim();
    const optional = match[2] === '?';
    const definition = match[3] ? match[3].trim() : '';

    let type = 'string';
    let defaultValue;
    let constraints = {};

    if (definition) {
      const shorthand = definition.match(/^(enum|regex)(\(.+|\/.+)$/);
      if (shorthand && TYPES.includes(shorthand[1])) {
        type = shorthand[1];
        const parsed = parseConstraints(type, shorthand[2]);
        constraints = parsed.constraints;
        defaultValue = parsed.defaultValue;
      } else {
        const [first, ...rest] = definition.split(':');
        if (TYPES.includes(first)) {
          type = first;
          const tail = rest.join(':');
          const parsed = parseConstraints(type, tail);
          constraints = parsed.constraints;
          defaultValue = parsed.defaultValue;
        } else {
          defaultValue = definition;
        }
      }
    }

    schema[key] = { type, optional, default: defaultValue, constraints };
  }
  return schema;
}

function parseConstraints(type, tail) {
  const constraints = {};
  let defaultValue;

  if (!tail) return { constraints, defaultValue };

  if (type === 'enum') {
    const enumMatch = tail.match(/^\(([^)]+)\)(?::(.*))?$/);
    if (enumMatch) {
      constraints.values = enumMatch[1].split('|').map((s) => s.trim());
      defaultValue = enumMatch[2] ? enumMatch[2].trim() : undefined;
    } else {
      constraints.values = tail.split('|').map((s) => s.trim());
    }
    return { constraints, defaultValue };
  }

  if (type === 'regex') {
    const regexMatch = tail.match(/^\/(.+)\/([gimsuy]*)(?::(.*))?$/);
    if (regexMatch) {
      constraints.pattern = new RegExp(regexMatch[1], regexMatch[2]);
      defaultValue = regexMatch[3] ? regexMatch[3].trim() : undefined;
    }
    return { constraints, defaultValue };
  }

  const parts = tail.split(',');
  const kwargs = {};
  const positionals = [];
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) {
      kwargs[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
    } else if (p.trim()) {
      positionals.push(p.trim());
    }
  }
  if (kwargs.min !== undefined) constraints.min = Number(kwargs.min);
  if (kwargs.max !== undefined) constraints.max = Number(kwargs.max);
  if (positionals.length) defaultValue = positionals.join(',');
  return { constraints, defaultValue };
}

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/i;

function parseDurationMs(value) {
  const m = DURATION_RE.exec(String(value).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return n * mult[unit];
}

function validateValue(value, type, constraints = {}) {
  if (value === undefined || value === null) return false;
  const v = String(value);

  switch (type) {
    case 'number': {
      const n = Number(v);
      if (Number.isNaN(n) || v === '') return false;
      if (constraints.min !== undefined && n < constraints.min) return false;
      if (constraints.max !== undefined && n > constraints.max) return false;
      return true;
    }
    case 'integer': {
      const n = Number(v);
      if (!Number.isInteger(n)) return false;
      if (constraints.min !== undefined && n < constraints.min) return false;
      if (constraints.max !== undefined && n > constraints.max) return false;
      return true;
    }
    case 'boolean':
      return ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(v.toLowerCase());
    case 'url':
      try { new URL(v); return true; } catch { return false; }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    case 'port': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return false;
      if (constraints.min !== undefined && n < constraints.min) return false;
      if (constraints.max !== undefined && n > constraints.max) return false;
      return true;
    }
    case 'ipv4':
      return /^(\d{1,3}\.){3}\d{1,3}$/.test(v)
        && v.split('.').every((oct) => {
          const n = parseInt(oct, 10);
          return n >= 0 && n <= 255 && String(n) === oct;
        });
    case 'ipv6':
      return /^(::ffff:)?([a-fA-F0-9:]+)$/.test(v) && v.includes(':');
    case 'ip':
      return validateValue(v, 'ipv4') || validateValue(v, 'ipv6');
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
    case 'semver':
      return /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/.test(v);
    case 'duration':
      return parseDurationMs(v) !== null;
    case 'json':
      try { JSON.parse(v); return true; } catch { return false; }
    case 'path':
      return v.length > 0;
    case 'dir':
      try { return fs.existsSync(v) && fs.statSync(v).isDirectory(); } catch { return false; }
    case 'file':
      try { return fs.existsSync(v) && fs.statSync(v).isFile(); } catch { return false; }
    case 'regex':
      return constraints.pattern ? constraints.pattern.test(v) : true;
    case 'enum':
      return Array.isArray(constraints.values) ? constraints.values.includes(v) : true;
    case 'hex':
      return /^[0-9a-fA-F]+$/.test(v);
    case 'secret':
      return v.length >= (constraints.min || 16);
    case 'string':
    default: {
      const minLen = constraints.min !== undefined ? Number(constraints.min) : null;
      const maxLen = constraints.max !== undefined ? Number(constraints.max) : null;
      if (minLen !== null && v.length < minLen) return false;
      if (maxLen !== null && v.length > maxLen) return false;
      return true;
    }
  }
}

const SECRET_KEY_RE = /(SECRET|TOKEN|KEY|PASS|PRIVATE|CRED|AUTH|APIKEY)/i;
const SECRET_VALUE_RE = /^[A-Za-z0-9+\/_\-.=]{20,}$/;

function looksLikeSecret(key, value) {
  if (!value) return false;
  if (SECRET_KEY_RE.test(key) && value.length >= 8) return true;
  if (SECRET_VALUE_RE.test(value) && value.length >= 24) return true;
  return false;
}

function detectSecrets(envVars) {
  const hits = [];
  for (const [k, v] of Object.entries(envVars || {})) {
    if (looksLikeSecret(k, v)) {
      hits.push({
        key: k,
        reason: SECRET_KEY_RE.test(k) ? 'key-name' : 'value-shape',
        length: v.length,
      });
    }
  }
  return hits;
}

function isGitIgnored(filePath, cwd = process.cwd()) {
  const abs = path.resolve(cwd, filePath);
  const name = path.basename(abs);
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return null;
  const rules = fs.readFileSync(gitignorePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  for (const rule of rules) {
    if (rule === name || rule === filePath) return true;
    if (rule === '.env' && name === '.env') return true;
    if (rule.endsWith('*') && name.startsWith(rule.slice(0, -1))) return true;
    if (rule.startsWith('.env') && name.startsWith('.env')) return true;
  }
  return false;
}

function validate(envVars, schema) {
  const errors = [];
  const warnings = [];
  const missing = [];
  const invalid = [];

  for (const [key, def] of Object.entries(schema)) {
    const value = envVars[key];

    if (value === undefined || value === '') {
      if (def.default !== undefined) {
        warnings.push({ key, message: `missing, using default: ${def.default}` });
      } else if (!def.optional) {
        missing.push(key);
        errors.push({ key, message: 'required but missing' });
      }
    } else {
      if (!validateValue(value, def.type, def.constraints)) {
        invalid.push(key);
        const extra = def.constraints && def.constraints.values
          ? ` (allowed: ${def.constraints.values.join('|')})`
          : '';
        errors.push({ key, message: `invalid ${def.type}${extra}: "${value}"` });
      }
    }
  }

  const extra = [];
  for (const key of Object.keys(envVars)) {
    if (!schema[key]) extra.push(key);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missing,
    invalid,
    extra,
    defined: Object.keys(envVars).length,
    required: Object.keys(schema).filter((k) => !schema[k].optional).length,
  };
}

function diff(env1, env2) {
  const keys1 = new Set(Object.keys(env1));
  const keys2 = new Set(Object.keys(env2));
  const onlyIn1 = [...keys1].filter((k) => !keys2.has(k));
  const onlyIn2 = [...keys2].filter((k) => !keys1.has(k));
  const inBoth = [...keys1].filter((k) => keys2.has(k));
  const different = inBoth.filter((k) => env1[k] !== env2[k]);
  return { onlyIn1, onlyIn2, different, same: inBoth.length - different.length };
}

function detectType(value) {
  const v = String(value);
  if (v === '') return 'string';
  if (validateValue(v, 'boolean')) return 'boolean';
  if (validateValue(v, 'uuid')) return 'uuid';
  if (validateValue(v, 'ipv4')) return 'ipv4';
  if (validateValue(v, 'semver')) return 'semver';
  if (validateValue(v, 'duration')) return 'duration';
  if (validateValue(v, 'url')) return 'url';
  if (validateValue(v, 'email')) return 'email';
  if (!Number.isNaN(Number(v)) && Number.isInteger(Number(v))) {
    const n = Number(v);
    if (n >= 1 && n <= 65535) return 'port';
    return 'integer';
  }
  if (!Number.isNaN(Number(v))) return 'number';
  if (validateValue(v, 'json')) return 'json';
  return 'string';
}

function generateSchema(envVars, options = {}) {
  const lines = [
    '# Generated schema for envguard',
    '# https://voiddo.com/tools/envguard/',
    '',
  ];

  for (const [key, value] of Object.entries(envVars)) {
    const type = detectType(value);
    const secret = options.markSecrets !== false && looksLikeSecret(key, value);
    const finalType = secret ? 'secret' : type;
    lines.push(`${key}=${finalType}`);
  }

  return lines.join('\n');
}

function maskValue(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '*'.repeat(s.length);
  return s.slice(0, 2) + '*'.repeat(Math.max(3, s.length - 4)) + s.slice(-2);
}

module.exports = {
  parseEnvFile,
  parseSchema,
  validate,
  diff,
  generateSchema,
  validateValue,
  detectType,
  detectSecrets,
  looksLikeSecret,
  isGitIgnored,
  maskValue,
  parseDurationMs,
  TYPES,
};
