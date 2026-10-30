/** Small local vector illustrations for the Azure service shortcuts. No remote assets. */
export type ServiceIcon = 'create' | 'entra' | 'vm' | 'rg' | 'monitor' | 'rocket' | 'foundry' | 'kubernetes' | 'app' | 'arrow' | 'key' | 'resources' | 'dashboard' | 'learn' | 'defender' | 'cost';
export function serviceIcon(kind: ServiceIcon): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('az-service-icon');
  const add = (name: string, attrs: Record<string, string>): void => { const el = document.createElementNS(ns, name); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); svg.append(el); };
  const path = (d: string, fill: string): void => add('path', { d, fill });
  const rect = (x: number, y: number, width: number, height: number, fill: string): void => add('rect', { x: String(x), y: String(y), width: String(width), height: String(height), rx: '1', fill });
  const circle = (cx: number, cy: number, r: number, fill: string): void => add('circle', { cx: String(cx), cy: String(cy), r: String(r), fill });
  switch (kind) {
    case 'create': add('path', { d: 'M20 3V37M3 20H37', fill: 'none', stroke: '#0078ff', 'stroke-width': '1.7' }); break;
    case 'entra': path('M20 2 38 22 20 37 2 26Z', '#32bedd'); path('M20 2 38 22 21 29 13 19Z', '#0078d4'); path('M13 19 21 29 20 37 2 26Z', '#50e6ff'); path('M21 12 31 23 21 29 15 23Z', '#004578'); break;
    case 'vm': rect(2, 3, 36, 24, '#50a2ef'); rect(6, 7, 28, 16, '#83d4f3'); path('M16 28H24V34H30V37H10V34H16Z', '#969da3'); path('m20 9 7 4v8l-7 4-7-4v-8Z', '#fff'); path('m20 9 7 4-7 4-7-4Z', '#c6f5ff'); path('m20 17 7-4v8l-7 4Z', '#50e6ff'); break;
    case 'rg': path('M10 3 3 7v26l7 4v-4l-3-2V9l3-2ZM30 3v4l3 2v22l-3 2v4l7-4V7Z', '#98a5a7'); path('m20 8 11 6v13l-11 6-11-6V14Z', '#50e6ff'); path('m20 8 11 6-11 6-11-6Z', '#c4f5ff'); path('m20 20 11-6v13l-11 6Z', '#32bedd'); break;
    case 'monitor': circle(20, 20, 17, '#fff'); add('circle', { cx: '20', cy: '20', r: '16', fill: 'none', stroke: '#1598ed', 'stroke-width': '2.5' }); path('M8 24a13 13 0 0 1 24-11L20 21Z', '#a8e5ef'); add('path', { d: 'M20 20 29 11M10 13l2 2M20 7v3M7 21h3', stroke: '#008ed4', 'stroke-width': '2' }); circle(20, 20, 3, '#536a70'); break;
    case 'rocket': path('m13 23-8 1-3 12 12-4Z', '#ff9800'); path('m15 29 8 8 3-13Z', '#f6bd16'); path('m11 16-9 7 12 1Z', '#f6bd16'); path('M12 24 17 12Q28 1 38 2q0 13-10 21l-10 6Z', '#f9b233'); path('m18 29 10-6Q38 15 38 2L14 27Z', '#ff8c00'); circle(27, 12, 5, '#d9f6fa'); circle(27, 12, 3.4, '#2698db'); break;
    case 'foundry': path('M11 4H24L15 36H2Z', '#3928d7'); path('M25 4q10 0 10 8v7q0 6-11 6H18Z', '#8d83ef'); path('M25 4 20 23h5q8-1 8-8V9Z', '#c1bbfa'); break;
    case 'kubernetes': for (const [x, y] of [[20, 6], [8, 14], [31, 14], [20, 22], [8, 31], [31, 31]]) { path(`m${x} ${y-5} 6 3v7l-6 3-6-3v-7Z`, '#773adc'); path(`m${x} ${y-5} 6 3-6 3-6-3Z`, '#b69aed'); } break;
    case 'app': circle(20, 20, 18, '#178eea'); add('ellipse', { cx: '20', cy: '20', rx: '9', ry: '17', fill: 'none', stroke: '#8cddff', 'stroke-width': '2' }); add('path', { d: 'M3 20H37M7 9l26 22M7 31 33 9', stroke: '#79caff', 'stroke-width': '2' }); circle(11, 10, 4, '#e5f8ff'); circle(28, 13, 4, '#e5f8ff'); circle(16, 28, 4, '#e5f8ff'); break;
    case 'arrow': add('path', { d: 'M3 20H36L24 8M36 20 24 32', fill: 'none', stroke: '#0078ff', 'stroke-width': '2' }); break;
    case 'key': circle(18, 12, 10, '#ffca00'); circle(18, 10, 3, '#fff3a0'); path('M14 21h8v6l-3 3 3 3-5 6-3-3Z', '#ffb900'); break;
    case 'resources': for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) rect(3 + x * 12, 3 + y * 12, 10, 10, x === 2 ? '#5e9e19' : '#79b52c'); break;
    case 'dashboard': rect(2, 8, 36, 25, '#65bfb3'); rect(7, 12, 2, 16, '#dcfff8'); rect(7, 27, 27, 2, '#dcfff8'); add('path', { d: 'm11 23 5-8 5 6 7-9', fill: 'none', stroke: '#fff', 'stroke-width': '2' }); break;
    case 'learn': rect(6, 2, 28, 33, '#168bdf'); rect(9, 2, 2, 33, '#63c8f3'); path('M11 35h8v5l-4-2-4 2Z', '#7dbd35'); add('text', { x: '13', y: '24', fill: '#fff', 'font-size': '12', 'font-family': 'Segoe UI' }); svg.lastChild!.textContent = '101'; break;
    case 'defender': path('M20 2 36 9v13q-3 12-16 18Q7 33 4 22V9Z', '#76b82a'); path('M20 2v38q13-6 16-18V9Z', '#5b991c'); rect(14, 18, 13, 11, '#fff'); add('path', { d: 'M16 18v-5a4 4 0 0 1 8 0v5', fill: 'none', stroke: '#fff', 'stroke-width': '2.5' }); break;
    case 'cost': path('m20 1 17 10v19L20 40 3 30V11Z', '#83bc00'); add('text', { x: '11', y: '30', fill: '#fff', 'font-size': '29', 'font-family': 'Segoe UI', 'font-weight': '600' }); svg.lastChild!.textContent = '$'; break;
  }
  return svg;
}
