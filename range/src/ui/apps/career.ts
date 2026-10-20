/**
 * Career tracker.
 */
import { fmt } from '../../core/time.ts';
import { readiness } from '../../core/career.ts';
import { TEMPLATES } from '../../scenarios/engine.ts';
import { badge, button, clear, h, table } from '../dom.ts';
import { store } from '../store.ts';
import { download } from './coach.ts';
import type { AppDef } from '../wm.ts';

function summaryMarkdown(): string {
  const c = store.career;
  const passed = c.attempts.filter((a) => a.passed);
  const r = readiness(c);
  return [
    '# IAM practice record (IdentityForge Range)',
    '',
    '> All work below was done in a simulated environment (fictional company Meridian Health System). It demonstrates practice and reasoning, not production experience.',
    '',
    `- Labs attempted: ${c.attempts.length}; passed: ${passed.length}`,
    `- Scenario types passed: ${new Set(passed.map((a) => a.templateId)).size} of ${TEMPLATES.length}`,
    '',
    '## Coverage against IAM job descriptions',
    '| Area | What employers ask | Level | Passed labs |',
    '| --- | --- | --- | --- |',
    ...r.map((x) => `| ${x.area} | ${x.ask} | ${x.level} | ${x.passes} |`),
    '',
    '## Passed labs',
    ...passed.map((a) => `- ${fmt(a.time).slice(0, 10)}: ${a.title} (${a.category}, ${a.score}%${a.hintsUsed ? `, ${a.hintsUsed} hint(s)` : ', no hints'}${a.interviewScore ? `, interview ${a.interviewScore}/5` : ''})`),
    '',
  ].join('\n');
}

export const careerApp: AppDef = {
  id: 'career',
  title: 'Career Tracker',
  icon: 'career',
  width: 960,
  height: 640,
  mount(host) {
    const draw = (): void => {
      clear(host);
      const c = store.career;
      const r = readiness(c);
      const passed = c.attempts.filter((a) => a.passed);
      const kinds = new Set(passed.map((a) => a.templateId)).size;
      const levelKind: Record<string, string> = { Strong: 'ok', Demonstrated: 'info', Practising: 'warn', 'Not started': '' };
      host.appendChild(h('div', { class: 'career' },
        h('div', { class: 'row-between' },
          h('div', null, h('h2', null, 'Job readiness'), h('p', { class: 'muted' }, `${passed.length} labs passed out of ${c.attempts.length} attempted. ${kinds} of ${TEMPLATES.length} scenario types passed at least once.`)),
          button('Export practice record (.md)', () => download('identityforge-practice-record.md', summaryMarkdown()), 'btn primary')),
        table(['Area', 'What job descriptions ask', 'Level', 'Skills shown', 'Passes'], r.map((x) => [h('strong', null, x.area), x.ask, badge(x.level, levelKind[x.level]), `${x.passedSkills} of ${x.totalSkills}`, String(x.passes)])),
        h('p', { class: 'muted' }, 'Demonstrated means at least one pass. Strong means three or more passes covering at least half the skills. Aim for Strong in lifecycle, governance and authentication before applying; those come up in almost every IAM interview.'),
        h('h3', null, 'History'),
        c.attempts.length
          ? table(['When', 'Lab', 'Category', 'Score', 'Result', 'Hints', 'Interview'], [...c.attempts].reverse().map((a) => [fmt(a.time), a.title, a.category, `${a.score}%`, badge(a.passed ? 'Passed' : 'Not passed', a.passed ? 'ok' : 'bad'), String(a.hintsUsed), a.interviewScore ? `${a.interviewScore}/5` : '—']))
          : h('p', { class: 'empty' }, 'No attempts yet. Open IAM Coach and start a lab.')));
    };
    draw();
    return { redraw: draw };
  },
};
