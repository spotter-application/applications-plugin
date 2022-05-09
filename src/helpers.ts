import { promisedExec } from '@spotter-app/plugin';
import { Application } from './interfaces';

export const getAllApplications = async (): Promise<Application[]> => {
  const paths = [
    '/System/Applications',
    '/System/Applications/Utilities',
    '/Applications',
    '~/Applications',
    '~/Applications/Chrome Apps.localized',
  ];

  // @ts-ignore
  const applications: Application[] = await paths.reduce(
    // @ts-ignore
    async (asyncAcc, path) => {
      return [
        ...(await asyncAcc),
        ...(await getDeepApplications(path)),
      ];
    },
    Promise.resolve([]),
  );

  return [
    ...applications.filter(a => a.title !== 'System Preferences'),
    {
      title: 'Finder',
      path: '/System/Library/CoreServices/Finder.app',
    }
  ];
}

async function getDeepApplications(path: string): Promise<Application[]> {
  if (!path) {
    return [];
  }

  if (path.startsWith('~')) {
    const user = await promisedExec('echo $USER');
    path = path.replace('~', `/Users/${user}`);
  }

  const applicationsStrings = await promisedExec(
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
            title: title.replace('.app', ''),
            path: `${path}/${title}`,
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
        await getDeepApplications(`${path}/${title}`);
      return [...resolvedAcc, ...deepApplicationsStrings];
    }, Promise.resolve([])));

  // @ts-ignore
  return applicationsStrings;
}
