/**
 * Calculator (calc.exe): Windows 11 Calculator, Standard mode, with Memory and
 * History panes and the keyboard shortcuts it has. The arithmetic is
 * core/calculator.ts; this window only draws the state and turns clicks and
 * keys into presses.
 */
import { clear, h } from '../dom.ts';
import { calcInit, displayText, press, type CalcKey, type CalcState } from '../../core/calculator.ts';
import type { AppDef } from '../wm.ts';

const KEYS: CalcKey[][] = [
  ['%', 'CE', 'C', '⌫'],
  ['1/x', 'x²', '√', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['±', '0', '.', '='],
];
const LABEL: Partial<Record<CalcKey, string>> = { '1/x': '¹⁄ₓ', 'x²': 'x²', '√': '²√x', '⌫': '⌫', '±': '+/−' };
const KEYBOARD: Record<string, CalcKey> = {
  '+': '+', '-': '−', '*': '×', 'x': '×', '/': '÷', '=': '=', Enter: '=', '%': '%', '.': '.', ',': '.',
  Backspace: '⌫', Escape: 'C', Delete: 'CE', '@': '√', q: 'x²', r: '1/x', F9: '±',
};

export const calculatorApp: AppDef = {
  id: 'calc',
  title: 'Calculator',
  icon: 'calculator',
  width: 340,
  height: 540,
  mount(host) {
    let s: CalcState = calcInit();
    let pane: 'none' | 'history' | 'memory' = 'none';
    const root = h('div', { class: 'calc', tabindex: '0', 'aria-label': 'Calculator' });
    host.appendChild(root);
    const go = (k: CalcKey): void => { s = press(s, k); draw(); };

    function sidePane(): HTMLElement | null {
      if (pane === 'none') return null;
      const items = pane === 'history' ? s.history.map((x) => h('button', { class: 'calc-hist', type: 'button', onClick: () => { s = { ...s, entry: x.result.replace(/,/g, ''), fresh: true, provided: true, expression: x.expression }; draw(); } }, h('span', null, x.expression), h('strong', null, x.result)))
        : s.memory === null ? [] : [h('div', { class: 'calc-hist' }, h('strong', null, displayText({ ...s, entry: String(s.memory), error: null })))];
      return h('div', { class: 'calc-pane' },
        h('div', { class: 'calc-pane-head' }, h('strong', null, pane === 'history' ? 'History' : 'Memory'),
          h('button', { class: 'calc-mini', type: 'button', onClick: () => { if (pane === 'history') s = { ...s, history: [] }; else go('MC'); pane = 'none'; draw(); } }, pane === 'history' ? 'Clear history' : 'Clear memory')),
        items.length ? items : h('p', { class: 'calc-empty' }, pane === 'history' ? 'There’s no history yet' : 'There’s nothing saved in memory'));
    }

    function draw(): void {
      clear(root);
      const err = !!s.error;
      const text = displayText(s);
      root.append(
        h('div', { class: 'calc-head' }, h('span', { class: 'calc-mode' }, 'Standard'),
          h('button', { class: `calc-mini ${pane === 'history' ? 'on' : ''}`, type: 'button', title: 'History (Ctrl+H)', onClick: () => { pane = pane === 'history' ? 'none' : 'history'; draw(); } }, '⏲')),
        h('div', { class: 'calc-expr', 'aria-live': 'polite' }, s.expression),
        h('div', { class: `calc-display ${text.length > 12 ? 'small' : ''}`, 'aria-live': 'polite' }, text),
        h('div', { class: 'calc-mem' }, (['MC', 'MR', 'M+', 'M-', 'MS'] as CalcKey[]).map((k) =>
          h('button', { class: 'calc-mkey', type: 'button', disabled: err || ((k === 'MC' || k === 'MR') && s.memory === null), onClick: () => go(k) }, k)),
          h('button', { class: `calc-mkey ${pane === 'memory' ? 'on' : ''}`, type: 'button', disabled: s.memory === null, title: 'Memory', onClick: () => { pane = pane === 'memory' ? 'none' : 'memory'; draw(); } }, 'M˅')),
        sidePane() ?? h('div', { class: 'calc-keys' }, KEYS.flat().map((k) => {
          const digit = /^[0-9.]$/.test(k);
          const disabled = err && !digit && k !== 'C' && k !== 'CE' && k !== '⌫';
          return h('button', { class: `calc-key ${digit || k === '±' ? 'num' : ''} ${k === '=' ? 'eq' : ''}`, type: 'button', disabled, 'aria-label': k, onClick: () => go(k) }, LABEL[k] ?? k);
        })));
    }

    root.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'h') { e.preventDefault(); pane = pane === 'history' ? 'none' : 'history'; draw(); return; }
      if (e.ctrlKey && /^[mprlq]$/i.test(e.key)) {
        const k = ({ m: 'MS', p: 'M+', q: 'M-', r: 'MR', l: 'MC' } as Record<string, CalcKey>)[e.key.toLowerCase()];
        if (k) { e.preventDefault(); go(k); }
        return;
      }
      const k = /^[0-9]$/.test(e.key) ? (e.key as CalcKey) : KEYBOARD[e.key];
      if (k) { e.preventDefault(); go(k); }
    });
    draw();
    setTimeout(() => root.focus(), 30);
    return { dispose: () => root.remove() };
  },
};
