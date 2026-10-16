// Just enough of jsdom's shape for dashboardGrid.script.test.ts. Not
// @types/jsdom on purpose: it pulls the browser's DOM types into the whole
// server's typecheck, which changes what fetch/Response accept and breaks
// server code that is correct for Node (found in SYC-396 PR 1.3.4).
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; runScripts?: "dangerously" | "outside-only" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly window: any;
  }
}
