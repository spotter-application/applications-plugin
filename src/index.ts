import { SpotterPlugin, Option } from '@spotter-app/core';

import { getApplications } from './helpers';

new class Applications extends SpotterPlugin {
  private options: Option[] = [];

  public async spotterInitPlugin() {
    this.options = await getApplications();
  }

  public spotterOnQuery(query: string): Option[] {
    return this.options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()));
  }
}
