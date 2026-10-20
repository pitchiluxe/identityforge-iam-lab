import './styles.css';
import './shell.css';
import { buildDesktop, firstRun, lockScreen } from './ui/desktop.ts';
import { refreshAi } from './ui/aiState.ts';
import { startSchedulers } from './ui/store.ts';
import { applyAppearance } from './ui/theme.ts';
import { installContextMenus } from './ui/ctxmenu.ts';
import { installUpdateWatcher } from './ui/updates.ts';

applyAppearance();
installContextMenus();
installUpdateWatcher();
const root = document.getElementById('app')!;
lockScreen(root, () => {
  buildDesktop(root);
  firstRun();
});
startSchedulers();
void refreshAi();
