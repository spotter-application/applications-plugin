import util from 'util';
import { exec } from 'child_process';
import os from 'os';
import fs from 'node:fs';
import { fileIconToBuffer } from 'file-icon';

const asyncExec: (command: string) => Promise<string> = (command) => {
  return new Promise(async (resolve) => {
    const { stdout } = await util.promisify(exec)(command);
    resolve(stdout);
  });
};

async function asyncFindAndMap<T>(
  array: T[],
  asyncCallback: (item: T) => Promise<T>,
) {
  const promises = array.map(asyncCallback);
  const results = await Promise.all(promises);
  const index = results.findIndex(result => result);
  return results[index];
}

export interface Application {
  name: string,
  icon?: string,
  action: () => Promise<boolean>,
  fullPath?: string,
}

export const getApplications = async (): Promise<Application[]> => {
  if (os.type() === 'Darwin') {
    return await getMacOSApplications();
  }

  return await getLinuxApplications();
}

const getLinuxApplications = async (): Promise<Application[]> => {
  const result = await asyncExec('ls /usr/share/applications | awk -F ".desktop" " { print \$1}" -');
  return await Promise.all(result.split('\n').filter(a => !!a).map(async a => {
    const res = await asyncExec(`cat /usr/share/applications/${a}`);
    const execCommandLine = res.split('\n').find(line => line.startsWith('Exec=')) ?? '';
    const execCommand = execCommandLine
      .replace('Exec=', '')
      .replace(/ *\%[^)]*\ */g, '') // %args
      .replace(/ *\ -[^)]*\ */g, '') // -args
      .replace(/"/g, '')
      .trim();

    const nameLine = res.split('\n').find(line => line.startsWith('Name='));
    const name = nameLine?.replace('Name=', '') ?? '';

    const iconLine = res.split('\n').find(line => line.startsWith('Icon='));
    const iconName = iconLine?.replace('Icon=', '') ?? '';
    const icon = (await findLinuxIconPath(iconName)) ?? undefined;

    return {
      name,
      action: () => openLinuxApplication(execCommand),
      icon: icon,
    }
  }));
};

const openLinuxApplication = async (app: string) => {
  console.log(`nohup "${app}" </dev/null >/dev/null 2>&1 &`);
  try {
    // const appPathArr = app.split('/');
    // const appName = appPathArr[appPathArr.length - 1];

    await asyncExec(`nohup "${app}" </dev/null >/dev/null 2>&1 &`);

    // TODO: implement focus app on tab hotkey instead
    // const appsToReopen = ['alacritty'];
    // const res = await asyncExec(`pgrep -f ${appName} | head -n 1`);

    // if (!res || appsToReopen.includes(appName)) {
    //   await asyncExec(`nohup ${app} </dev/null >/dev/null 2>&1 &`);
    //   return true;
    // }

    // await asyncExec(`swaymsg "[pid=${res.replace('\n', '')}] focus";`).catch(async () => {
    //   await asyncExec(`nohup ${app} </dev/null >/dev/null 2>&1 &`);
    //   return null;
    // });

    return true;
  } catch (error) {
    console.log(error);
    return true;
  }
};

const findLinuxIconPath = async (icon: string): Promise<string | null> => {
  if (icon.split('/').length > 1) {
    return Promise.resolve(icon);
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
      `)) === '1\n';
      return result ? format : null;
    });
    return format ? `${path}/${icon}${format}` : null;
  });

  if (!path) {
    return null;
  }

  return path;
}

export const getMacOSApplications = async (): Promise<Application[]> => {
  const paths = [
    '/System/Applications',
    '/System/Applications/Utilities',
    '/Applications',
    '~/Applications',
    '~/Applications/Chrome Apps.localized',
  ];

  // TODO: check
  // @ts-ignore
  const applications: Application[] = await paths.reduce(
    // @ts-ignore
    async (asyncAcc, path) => {
      return [
        ...(await asyncAcc),
        ...(await getDeepMacOSApplications(path)),
      ];
    },
    Promise.resolve([]),
  );

  const allApps = [
    ...applications.filter(a => a.name !== 'System Preferences'),
    {
      name: 'Finder',
      fullPath: '/System/Library/CoreServices/Finder.app',
      action: () => openMacOsApplication('/System/Library/CoreServices/Finder.app'),
    }
  ];

  const appPaths = allApps.map(a => a.fullPath?.replace('\n', '') as string);
  const buffers4 = await fileIconToBuffer(appPaths, { size: 64 });

  const iconsDir = `${__dirname}/mac-icons`;
  if (!fs.existsSync(iconsDir)){
    fs.mkdirSync(iconsDir);
  }
  buffers4.map((buffer: any, index: any) => fs.writeFileSync(`${iconsDir}/${allApps[index].name.replace(/\s+/g, '-')}.png`, buffer));
  
  return allApps.map((app) => ({
    ...app,
    icon: `${iconsDir}/${app.name.replace(/\s+/g, '-')}.png`,
  }));
}

const openMacOsApplication = (app: string): Promise<boolean> => {
  exec(`open "${app}"`);
  return Promise.resolve(true);
}

async function getDeepMacOSApplications(path: string): Promise<Application[]> {
  if (!path) {
    return [];
  }

  if (path.startsWith('~')) {
    const user = await asyncExec('echo $USER');
    path = path.replace('~', `/Users/${user}`);
  }

  const applicationsStrings = await asyncExec(
    `cd ${path.replace(/(\s+)/g, '\\$1')} && ls || echo ''`
  )
    .then((res: string) => res.split('\n')
    // @ts-ignore
    .reduce(async (acc, title) => {
      const resolvedAcc = await acc;

      if (title.endsWith('.app')) {
        return [
          ...resolvedAcc,
          {
            name: title.replace('.app', ''),
            fullPath: `${path}/${title}`,
            action: () => openMacOsApplication(`${path}/${title}`),
          },
        ];
      }

      if (path.split('/').length > 2) {
        return resolvedAcc;
      }

      if (!title) {
        return resolvedAcc;
      }

      const deepApplicationsStrings =
        await getDeepMacOSApplications(`${path}/${title}`);
      return [...resolvedAcc, ...deepApplicationsStrings];
    }, Promise.resolve([])));

  // @ts-ignore
  return applicationsStrings;
}
