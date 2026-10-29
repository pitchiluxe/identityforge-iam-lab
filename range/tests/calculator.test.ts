import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcInit, press, displayText, type CalcKey, type CalcState } from '../src/core/calculator.ts';

const run = (keys: string, s: CalcState = calcInit()): CalcState => {
  for (const k of keys.split(' ').filter(Boolean)) s = press(s, k as CalcKey);
  return s;
};

test('calculator: standard mode evaluates left to right like Windows', () => {
  assert.equal(displayText(run('2 + 3 × 4 =')), '20');
  assert.equal(run('2 + 3 × 4 =').expression, '5 × 4 =');
  assert.equal(displayText(run('1 0 ÷ 4 =')), '2.5');
});

test('calculator: pressing = again repeats the last operation', () => {
  assert.equal(displayText(run('2 + 3 = =')), '8');
  assert.equal(displayText(run('5 × 2 = = =')), '40');
});

test('calculator: percent follows Windows rules', () => {
  assert.equal(displayText(run('2 0 0 + 1 0 %')), '20', '200 + 10% shows 20 (10% of 200)');
  assert.equal(displayText(run('2 0 0 + 1 0 % =')), '220');
  assert.equal(displayText(run('5 0 × 1 0 % =')), '5', 'with × the percent is x/100');
});

test('calculator: unary keys, sign, decimals, backspace, CE and C', () => {
  assert.equal(displayText(run('9 √')), '3');
  assert.equal(displayText(run('4 x²')), '16');
  assert.equal(displayText(run('4 1/x')), '0.25');
  assert.equal(displayText(run('5 ±')), '-5');
  assert.equal(displayText(run('1 . 5 + . 5 =')), '2');
  assert.equal(displayText(run('1 2 3 ⌫')), '12');
  assert.equal(displayText(run('2 + 9 CE 3 =')), '5', 'CE clears only the entry');
  assert.equal(displayText(run('2 + 9 C')), '0');
  assert.equal(displayText(run('0 . 1 + 0 . 2 =')), '0.3', 'no floating-point noise');
});

test('calculator: errors read like Windows and lock until cleared', () => {
  assert.equal(displayText(run('5 ÷ 0 =')), 'Cannot divide by zero');
  assert.equal(displayText(run('0 1/x')), 'Cannot divide by zero');
  assert.equal(displayText(run('9 ± √')), 'Invalid input');
  const s = run('5 ÷ 0 = + 3');
  assert.equal(displayText(s), '3', 'typing a digit starts fresh');
});

test('calculator: thousands separators, memory and history', () => {
  assert.equal(displayText(run('1 2 3 4 5 6 7')), '1,234,567');
  const m = run('7 MS C 3 + MR =');
  assert.equal(displayText(m), '10');
  assert.equal(displayText(run('5 M+ 2 M+ C MR', m)), '14', 'memory 7 + 5 + 2');
  const h = run('2 + 3 = 4 × 5 =');
  assert.deepEqual(h.history.map((x) => `${x.expression} ${x.result}`), ['4 × 5 = 20', '2 + 3 = 5']);
});
