// envguard — tests. free forever from vøiddo. https://voiddo.com/tools/envguard/

const fs = require('fs');
const {
  parseEnvFile,
  parseSchema,
  validate,
  diff,
  generateSchema,
  validateValue,
  detectType,
  detectSecrets,
  looksLikeSecret,
  maskValue,
  parseDurationMs,
} = require('./src/validator');

console.log('running tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// Setup test files
const testEnv = `
# Test env file
DATABASE_URL=postgres://localhost/test
PORT=3000
DEBUG=true
API_KEY=secret123
OPTIONAL_VAR=
`;

const testSchema = `
# Test schema
DATABASE_URL=url
PORT=port
DEBUG=boolean
API_KEY
OPTIONAL_VAR?
MISSING_VAR
`;

fs.writeFileSync('/tmp/test.env', testEnv);
fs.writeFileSync('/tmp/test.schema', testSchema);

// parseEnvFile tests
test('parseEnvFile: parses key=value pairs', () => {
  const result = parseEnvFile('/tmp/test.env');
  assert(result.DATABASE_URL === 'postgres://localhost/test');
  assert(result.PORT === '3000');
});

test('parseEnvFile: handles empty values', () => {
  const result = parseEnvFile('/tmp/test.env');
  assert(result.OPTIONAL_VAR === '');
});

test('parseEnvFile: returns null for missing file', () => {
  const result = parseEnvFile('/tmp/nonexistent.env');
  assert(result === null);
});

// parseSchema tests
test('parseSchema: parses types', () => {
  const result = parseSchema('/tmp/test.schema');
  assert(result.DATABASE_URL.type === 'url');
  assert(result.PORT.type === 'port');
  assert(result.DEBUG.type === 'boolean');
});

test('parseSchema: handles optional marker', () => {
  const result = parseSchema('/tmp/test.schema');
  assert(result.OPTIONAL_VAR.optional === true);
  assert(result.DATABASE_URL.optional === false);
});

// validateValue tests
test('validateValue: validates numbers', () => {
  assert(validateValue('123', 'number') === true);
  assert(validateValue('abc', 'number') === false);
});

test('validateValue: validates booleans', () => {
  assert(validateValue('true', 'boolean') === true);
  assert(validateValue('false', 'boolean') === true);
  assert(validateValue('maybe', 'boolean') === false);
});

test('validateValue: validates urls', () => {
  assert(validateValue('https://example.com', 'url') === true);
  assert(validateValue('not-a-url', 'url') === false);
});

test('validateValue: validates emails', () => {
  assert(validateValue('test@example.com', 'email') === true);
  assert(validateValue('not-an-email', 'email') === false);
});

test('validateValue: validates ports', () => {
  assert(validateValue('3000', 'port') === true);
  assert(validateValue('80', 'port') === true);
  assert(validateValue('99999', 'port') === false);
  assert(validateValue('abc', 'port') === false);
});

// validate tests
test('validate: detects missing required vars', () => {
  const envVars = parseEnvFile('/tmp/test.env');
  const schema = parseSchema('/tmp/test.schema');
  const result = validate(envVars, schema);
  assert(result.missing.includes('MISSING_VAR'));
});

test('validate: passes valid env', () => {
  const envVars = { PORT: '3000', DEBUG: 'true' };
  const schema = { PORT: { type: 'port', optional: false }, DEBUG: { type: 'boolean', optional: false } };
  const result = validate(envVars, schema);
  assert(result.valid === true);
});

test('validate: detects invalid types', () => {
  const envVars = { PORT: 'not-a-number' };
  const schema = { PORT: { type: 'port', optional: false } };
  const result = validate(envVars, schema);
  assert(result.valid === false);
  assert(result.invalid.includes('PORT'));
});

// diff tests
test('diff: finds variables only in first file', () => {
  const env1 = { A: '1', B: '2' };
  const env2 = { B: '2' };
  const result = diff(env1, env2);
  assert(result.onlyIn1.includes('A'));
});

test('diff: finds variables only in second file', () => {
  const env1 = { A: '1' };
  const env2 = { A: '1', B: '2' };
  const result = diff(env1, env2);
  assert(result.onlyIn2.includes('B'));
});

test('diff: finds different values', () => {
  const env1 = { A: '1' };
  const env2 = { A: '2' };
  const result = diff(env1, env2);
  assert(result.different.includes('A'));
});

// generateSchema tests
test('generateSchema: detects port type', () => {
  const schema = generateSchema({ PORT: '3000' });
  assert(schema.includes('PORT=port'));
});

test('generateSchema: detects url type', () => {
  const schema = generateSchema({ API: 'https://api.example.com' });
  assert(schema.includes('API=url'));
});

test('generateSchema: detects boolean type', () => {
  const schema = generateSchema({ DEBUG: 'true' });
  assert(schema.includes('DEBUG=boolean'));
});

// New type tests
test('validateValue: uuid', () => {
  assert(validateValue('550e8400-e29b-41d4-a716-446655440000', 'uuid') === true);
  assert(validateValue('not-a-uuid', 'uuid') === false);
});

test('validateValue: semver', () => {
  assert(validateValue('1.2.3', 'semver') === true);
  assert(validateValue('2.0.0-beta.1', 'semver') === true);
  assert(validateValue('1.2', 'semver') === false);
});

test('validateValue: ipv4', () => {
  assert(validateValue('192.168.1.1', 'ipv4') === true);
  assert(validateValue('256.0.0.0', 'ipv4') === false);
  assert(validateValue('::1', 'ipv4') === false);
});

test('validateValue: duration', () => {
  assert(validateValue('15m', 'duration') === true);
  assert(validateValue('2h', 'duration') === true);
  assert(validateValue('500ms', 'duration') === true);
  assert(validateValue('forever', 'duration') === false);
});

test('validateValue: json', () => {
  assert(validateValue('{"a":1}', 'json') === true);
  assert(validateValue('[1,2,3]', 'json') === true);
  assert(validateValue('not json', 'json') === false);
});

test('validateValue: enum constraint', () => {
  assert(validateValue('production', 'enum', { values: ['development', 'staging', 'production'] }) === true);
  assert(validateValue('broken', 'enum', { values: ['development', 'staging', 'production'] }) === false);
});

test('validateValue: regex constraint', () => {
  assert(validateValue('ABC123', 'regex', { pattern: /^[A-Z]{3}\d{3}$/ }) === true);
  assert(validateValue('abc', 'regex', { pattern: /^[A-Z]{3}\d{3}$/ }) === false);
});

test('validateValue: integer with min/max', () => {
  assert(validateValue('50', 'integer', { min: 1, max: 100 }) === true);
  assert(validateValue('500', 'integer', { min: 1, max: 100 }) === false);
});

test('parseSchema: enum constraint', () => {
  fs.writeFileSync('/tmp/test-enum.schema', 'LOG=enum(debug|info|warn|error)\n');
  const result = parseSchema('/tmp/test-enum.schema');
  assert(Array.isArray(result.LOG.constraints.values));
  assert(result.LOG.constraints.values.length === 4);
  fs.unlinkSync('/tmp/test-enum.schema');
});

test('parseSchema: port min/max', () => {
  fs.writeFileSync('/tmp/test-port.schema', 'APP_PORT=port:min=1024,max=65535\n');
  const result = parseSchema('/tmp/test-port.schema');
  assert(result.APP_PORT.constraints.min === 1024);
  assert(result.APP_PORT.constraints.max === 65535);
  fs.unlinkSync('/tmp/test-port.schema');
});

test('parseDurationMs: converts units', () => {
  assert(parseDurationMs('1s') === 1000);
  assert(parseDurationMs('1m') === 60000);
  assert(parseDurationMs('1h') === 3600000);
  assert(parseDurationMs('garbage') === null);
});

test('detectType: auto-detects', () => {
  assert(detectType('550e8400-e29b-41d4-a716-446655440000') === 'uuid');
  assert(detectType('1.2.3') === 'semver');
  assert(detectType('192.168.1.1') === 'ipv4');
  assert(detectType('15m') === 'duration');
  assert(detectType('3000') === 'port');
  assert(detectType('https://x.com') === 'url');
  assert(detectType('hello') === 'string');
});

test('looksLikeSecret: by key name', () => {
  assert(looksLikeSecret('API_KEY', 'sk_xxxxxxxx') === true);
  assert(looksLikeSecret('JWT_SECRET', 'short1') === false);
  assert(looksLikeSecret('NODE_ENV', 'development') === false);
});

test('looksLikeSecret: by value shape', () => {
  assert(looksLikeSecret('WHATEVER', 'FAKE_TEST_AbCdEf123456789012345678') === true);
  assert(looksLikeSecret('NAME', 'Jane Doe') === false);
});

test('detectSecrets: reports hits', () => {
  const hits = detectSecrets({
    API_KEY: 'FAKE_TEST_xxxxxxxxxxxxxxxx',
    NODE_ENV: 'development',
    JWT_SECRET: 'longsecretvaluehere',
  });
  assert(hits.length === 2);
});

test('maskValue: redacts', () => {
  const masked = maskValue('supersecretvalue');
  assert(masked.startsWith('su'));
  assert(masked.endsWith('ue'));
  assert(masked.includes('*'));
});

test('generateSchema: marks secrets', () => {
  const schema = generateSchema({ API_KEY: 'FAKE_TEST_12345678', DEBUG: 'true' });
  assert(schema.includes('API_KEY=secret'));
  assert(schema.includes('DEBUG=boolean'));
});

// Cleanup
fs.unlinkSync('/tmp/test.env');
fs.unlinkSync('/tmp/test.schema');

console.log(`\n${passed}/${passed + failed} tests passed`);
process.exit(failed > 0 ? 1 : 0);
