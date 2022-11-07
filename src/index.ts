#!/usr/bin/env node

import util from 'util';
import { exec } from 'child_process';
const asyncExec = util.promisify(exec);
import { SpotterPlugin, Option } from '@spotter-app/core';

new class Applications extends SpotterPlugin {
  options: Option[] = [];

  constructor() {
    super();
    this.init();
  }
  
  public async init() {
    const { stdout } = await asyncExec('ls /usr/share/applications | awk -F ".desktop" " { print \$1}" -');
    this.options = await Promise.all(stdout.split('\n').filter(a => !!a).map(async a => {
      const { stdout } = await asyncExec(`cat /usr/share/applications/${a}`);
      const execCommandLine = stdout.split('\n').find(line => line.startsWith('Exec='));
      const execCommand = execCommandLine?.replace('Exec=', '').split(' ')[0] ?? '';

      const nameLine = stdout.split('\n').find(line => line.startsWith('Name='));
      const name = nameLine?.replace('Name=', '') ?? '';

      return {
        name,
        action: () => this.openApplication(execCommand),
      }
    }));
  }

  public onQuery(query: string): Option[] {
    return this.options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()));
  }

  private async openApplication(app: string) {
    try {
      await asyncExec(app);
      // TODO: focus app if opened
      // await asyncExec(`
      //   if [[ -n $(pidof -x ${appName}) ]]; then 
      //     swaymsg "[app_id=${appName}] focus";
      //   else swaymsg "exec ${app};";
      //   fi
      // `);
    } catch (error) {
      console.log(error);
    }

    return true;
  }

}

