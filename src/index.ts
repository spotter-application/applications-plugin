#!/usr/bin/env node

import util from 'util';
import { exec } from 'child_process';
import os from 'os';
const asyncExec = util.promisify(exec);
// import { SpotterPlugin, Option } from '@spotter-app/core';


import WebSocket from 'websocket';

async function asyncFindAndMap<T>(
  array: T[],
  asyncCallback: (item: T) => Promise<T>,
) {
  const promises = array.map(asyncCallback);
  const results = await Promise.all(promises);
  const index = results.findIndex(result => result);
  return results[index];
}

export interface Option {
  name: string;
  hint?: string;
  action?: Action;
  onQuery?: OnQuery;
  icon?: string;
  isHovered?: boolean,
  priority?: number,
  important?: boolean,
}

export type OnQuery = (query: string) => Promise<Option[]> | Option[];

export type Action = () => Promise<Option[] | boolean> | Option[] | boolean;

interface MappedOption {
  name: string;
  hint?: string;
  actionId?: string;
  onQueryId?: string;
  icon?: string;
  isHovered?: boolean,
  priority?: number,
  important?: boolean,
};

enum RequestFromSpotterType {
  onQuery = 'onQuery',
  onOptionQuery = 'onOptionQuery',
  execAction = 'execAction',
};

interface RequestFromSpotter {
  id: string,
  type: RequestFromSpotterType,
  query: string,
  actionId: string,
  onQueryId: string,
};

interface RequestFromPlugin {
  id: string,
  options: MappedOption[],
  complete: boolean,
};

const generateId = () => Math.random().toString(16).slice(2);

export class SpotterPlugin {
  private actionsMap: {[actionId: string]: Action} = {};
  private onQueryMap: {[onQueryId: string]: OnQuery} = {};

  constructor() {
    this.spotterInitServer();
  }

  private async spotterInitServer() {
    const client = new WebSocket.client();
    client.connect('ws://0.0.0.0:4040');

    client.on('connect', (cl) => {
      console.log('----------------- contected');
      // cl.send(JSON.stringify(response));

      cl.on('message', async (msg: any) => {
        const request: RequestFromSpotter = JSON.parse(msg.utf8Data);
        
        if (request.type === RequestFromSpotterType.onQuery) {
          const nextOptions: Option[] = this.onQuery(request.query);
          const mappedOptions = this.spotterMapOptions(nextOptions);
          const response: RequestFromPlugin = {
            id: request.id,
            options: mappedOptions,
            complete: false,
          };
          cl.send(JSON.stringify(response));
          return;
        }

        if (request.type === RequestFromSpotterType.execAction) {
          const result = await this.actionsMap[request.actionId]();

          // TODO: move to function
          if (typeof result === 'boolean') {
            const response: RequestFromPlugin = {
              id: request.id,
              options: [],
              complete: result,
            };
            cl.send(JSON.stringify(response));
            return;
          };

          const mappedOptions = this.spotterMapOptions(result as Option[]);
          const response: RequestFromPlugin = {
            id: request.id,
            options: mappedOptions,
            complete: false,
          };
          cl.send(JSON.stringify(response));
          return;
        }

        if (request.type === RequestFromSpotterType.onOptionQuery) {
          const nextOptions = await this.onQueryMap[request.onQueryId](request.query);

          console.log(nextOptions);

          if (typeof nextOptions === 'boolean') {
            const response: RequestFromPlugin = {
              id: request.id,
              options: [],
              complete: nextOptions,
            };
            cl.send(JSON.stringify(response));
            return;
          };

          const mappedOptions = this.spotterMapOptions(nextOptions as Option[]);
          const response: RequestFromPlugin = {
            id: request.id,
            options: mappedOptions,
            complete: false,
          };
          cl.send(JSON.stringify(response));
          return;
        }
      });
    });

    client.on('connectFailed', (reason) => {
      console.log('connectFailed: ', reason);
    });
  }

  private spotterMapOptions(options: Option[]): MappedOption[] {
    // TODO: optimize
    // this.actionsMap = {};
    // this.onQueryMap = {};

    return options.map(({
      name,
      hint,
      icon,
      action,
      onQuery,
      isHovered,
      priority,
      important,
    }) => {
      const mappedOption: MappedOption = {
        name: `${name}`,
        hint,
        icon,
        isHovered,
        priority,
        important,
      };

      if (action) {
        const actionId = generateId();
        this.actionsMap[actionId] = action;
        mappedOption.actionId = actionId;
      }

      if (onQuery) {
        const onQueryId = generateId();
        this.onQueryMap[onQueryId] = onQuery;
        mappedOption.onQueryId = onQueryId;
      }

      return mappedOption;
    });
  }

  public onQuery(_: string): Option[] {
    return [];
  }
}



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

      const iconLine = stdout.split('\n').find(line => line.startsWith('Icon='));
      const iconName = iconLine?.replace('Icon=', '') ?? '';
      const icon = (await this.findIconPath(iconName)) ?? undefined;

      return {
        name,
        icon,
        action: () => this.openApplication(execCommand),
      }
    }));
  }

  public onQuery(query: string): Option[] {
    return this.options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()));
  }

  private async findIconPath(icon: string): Promise<string | null> {
    if (icon.split('/').length > 1) {
      return icon;
    }

    const paths: string[] = [
      '/usr/share/icons/hicolor/64x64/apps',
      '/usr/share/icons/Papirus/64x64/apps',
      '/usr/share/icons/Adwaita/64x64/places',
      '/usr/share/icons/Adwaita/22x22/places',
      '/usr/share/pixmaps',
    ];

    const formats: string[] = [
      '.svg',
      '.png',
    ];

    const path = await asyncFindAndMap<string | null>(paths, async (path) => {
      const format = await asyncFindAndMap<string | null>(formats, async (format) => {
        const result = (await asyncExec(`
          if [ -e "${path}/${icon}${format}" ]; then echo '1'; else echo '0'; fi
        `)).stdout === '1\n';
        return result ? format : null;
      });
      return format ? `${path}/${icon}${format}` : null;
    });

    if (!path) {
      return null;
    }
    
    return path;
  }

  private async openApplication(app: string) {
    try {
      const appPathArr = app.split('/');
      const appName = appPathArr[appPathArr.length - 1];
      
      // TODO: implement focus app on tab hotkey instead
      const appsToReopen = ['alacritty'];
      const { stdout } = await asyncExec(`pgrep -f ${appName} | head -n 1`);

      if (!stdout || appsToReopen.includes(appName)) {
        await asyncExec(`nohup ${app} </dev/null >/dev/null 2>&1 &`);
        return true;
      }

      await asyncExec(`swaymsg "[pid=${stdout.replace('\n', '')}] focus";`).catch(async () => {
        await asyncExec(`nohup ${app} </dev/null >/dev/null 2>&1 &`);
        return null;
      });
      


      return true;
    } catch (error) {
      console.log(error);
      return true;
    }
  }

}

