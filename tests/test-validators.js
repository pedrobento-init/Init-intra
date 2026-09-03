// test-validators.js — Unit tests for Validators module
// Run: node tests/test-validators.js
// IMPORTANT: Keep the inline Validators and validate* functions
// in sync with the real implementations in js/storage.js.

const assert = require('assert');

// Inline Validators for testing (mirrors js/storage.js)
const Validators = {
  cpf(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
    let rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(d[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
    rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    return rev === parseInt(d[10]);
  },
  cnpj(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    const weights1 = [5,4,3,2,9,8,7,6,5,4,3,2];
    const weights2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(d[i]) * weights1[i];
    let rem = sum % 11;
    const digit1 = rem < 2 ? 0 : 11 - rem;
    if (parseInt(d[12]) !== digit1) return false;
    sum = 0;
    for (let i = 0; i < 13; i++) sum += parseInt(d[i]) * weights2[i];
    rem = sum % 11;
    const digit2 = rem < 2 ? 0 : 11 - rem;
    return parseInt(d[13]) === digit2;
  },
  email(v) {
    if (!v) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  },
  phone(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    return d.length >= 10 && d.length <= 11;
  },
  required(v) {
    return v && v.trim().length > 0;
  }
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

console.log('\n=== Validators Tests ===\n');

// Required
console.log('required:');
test('empty string returns falsy', () => assert.ok(!Validators.required('')));
test('whitespace only returns falsy', () => assert.ok(!Validators.required('   ')));
test('non-empty returns true', () => assert.strictEqual(Validators.required('hello'), true));
test('null returns falsy', () => assert.ok(!Validators.required(null)));

// Email
console.log('\nemail:');
test('empty returns true (optional)', () => assert.strictEqual(Validators.email(''), true));
test('null returns true (optional)', () => assert.strictEqual(Validators.email(null), true));
test('valid email returns true', () => assert.strictEqual(Validators.email('test@example.com'), true));
test('invalid email returns false', () => assert.strictEqual(Validators.email('not-an-email'), false));
test('missing @ returns false', () => assert.strictEqual(Validators.email('testexample.com'), false));
test('missing domain returns false', () => assert.strictEqual(Validators.email('test@'), false));

// Phone
console.log('\nphone:');
test('empty returns true (optional)', () => assert.strictEqual(Validators.phone(''), true));
test('valid 10 digits returns true', () => assert.strictEqual(Validators.phone('1199998888'), true));
test('valid 11 digits returns true', () => assert.strictEqual(Validators.phone('11999998888'), true));
test('9 digits returns false', () => assert.strictEqual(Validators.phone('119999888'), false));
test('12 digits returns false', () => assert.strictEqual(Validators.phone('119999988888'), false));

// CPF
console.log('\ncpf:');
test('empty returns true (optional)', () => assert.strictEqual(Validators.cpf(''), true));
test('valid CPF returns true', () => assert.strictEqual(Validators.cpf('529.982.247-25'), true));
test('invalid CPF returns false', () => assert.strictEqual(Validators.cpf('111.111.111-11'), false));
test('all same digits returns false', () => assert.strictEqual(Validators.cpf('000.000.000-00'), false));
test('wrong check digit returns false', () => assert.strictEqual(Validators.cpf('529.982.247-26'), false));

// CNPJ
console.log('\ncnpj:');
test('empty returns true (optional)', () => assert.strictEqual(Validators.cnpj(''), true));
test('valid CNPJ returns true', () => assert.strictEqual(Validators.cnpj('11.222.333/0001-81'), true));
test('invalid CNPJ returns false', () => assert.strictEqual(Validators.cnpj('11.111.111/1111-11'), false));

// ── High-level validation functions (mirrors js/storage.js) ──

function validateClient(data) {
  const errors = [];
  if (!Validators.required(data.name)) errors.push('Nome é obrigatório.');
  // CNPJ/CPF é opcional e aceita qualquer valor (não validamos dígitos verificadores)
  if (data.ownerPhone && !Validators.phone(data.ownerPhone)) errors.push('Telefone do proprietário inválido.');
  if (data.responsiblePhone && !Validators.phone(data.responsiblePhone)) errors.push('Telefone do responsável inválido.');
  return errors;
}

function validatePendencia(data) {
  const errors = [];
  if (!Validators.required(data.assunto)) errors.push('Assunto é obrigatório.');
  if (!Validators.required(data.descricao)) errors.push('Descrição é obrigatória.');
  if (data.linkUtil && !Validators.email(data.linkUtil) && !/^https?:\/\//.test(data.linkUtil)) errors.push('Link inválido (use https://...).');
  return errors;
}

function validateOperator(data) {
  const errors = [];
  if (!Validators.required(data.name)) errors.push('Nome é obrigatório.');
  if (data.email && !Validators.email(data.email)) errors.push('E-mail inválido.');
  if (data.phone && !Validators.phone(data.phone)) errors.push('Telefone inválido.');
  if (data.initials && data.initials.length > 3) errors.push('Iniciais devem ter no máximo 3 caracteres.');
  return errors;
}

function validateTemplate(data) {
  const errors = [];
  if (!Validators.required(data.title)) errors.push('Título é obrigatório.');
  if (!Validators.required(data.content)) errors.push('Conteúdo é obrigatório.');
  return errors;
}

// ── validateOperator ──
console.log('\nvalidateOperator:');
test('no errors with valid data', () => assert.strictEqual(validateOperator({ name: 'Joao', email: 'joao@test.com' }).length, 0));
test('missing name returns error', () => assert.strictEqual(validateOperator({ name: '' }).length, 1));
test('invalid email returns error', () => assert.strictEqual(validateOperator({ name: 'X', email: 'bad' }).length, 1));
test('initials too long returns error', () => assert.strictEqual(validateOperator({ name: 'X', initials: 'ABCD' }).length, 1));
test('initials length 3 passes', () => assert.strictEqual(validateOperator({ name: 'X', initials: 'ABC' }).length, 0));

// ── validateTemplate ──
console.log('\nvalidateTemplate:');
test('no errors with valid data', () => assert.strictEqual(validateTemplate({ title: 'TPL', content: 'Steps' }).length, 0));
test('missing title returns error', () => assert.strictEqual(validateTemplate({ title: '', content: 'X' }).length, 1));
test('missing content returns error', () => assert.strictEqual(validateTemplate({ title: 'X', content: '' }).length, 1));

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
