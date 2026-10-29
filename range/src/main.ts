import './styles.css';
import './shell.css';
import './azure.css';
import './servicenow.css';
import './outlook.css';
import './calculator.css';
import { buildDesktop, firstRun, lockScreen } from './ui/desktop.ts';
import { refreshAi } from './ui/aiState.ts';
import { startSchedulers } from './ui/store.ts';
import { applyAppearance } from './ui/theme.ts';
import { installContextMenus } from './ui/ctxmenu.ts';
import { installUpdateWatcher } from './ui/updates.ts';
import { installSystem } from './ui/system.ts';

applyAppearance();
installContextMenus();
installUpdateWatcher();
installSystem();
const root = document.getElementById('app')!;
lockScreen(root, () => {
  buildDesktop(root);
  firstRun();
});
startSchedulers();
void refreshAi();
