// SYC-231: runs the mail drain every 10 minutes (wrangler.jsonc `triggers`).
// GitHub's own schedule, asked for every 10 minutes, really ran every 3-7
// hours, which made the "over an hour late" alarm for cat-report alerts
// (SYC-42 layer 3) arrive hours late. The logic lives in drain.js.
import { runTick } from "./drain.js";

const FROM = { email: "mail-drain@catspotters.com", name: "Syros Cat Spotter mail drain" };

export default {
  async scheduled(controller, env, ctx) {
    await runTick({
      env,
      fetchImpl: (url, init) => fetch(url, init),
      sleep: (ms) => scheduler.wait(ms),
      kv: env.ALARM_STATE,
      // The binding's destination_address (wrangler.jsonc) is the only
      // address it can send to.
      sendAlarm: ({ subject, text }) => env.ALARM_EMAIL.send({ from: FROM, subject, text }),
      log: (fields) => console.log(JSON.stringify(fields)),
      nowMs: controller.scheduledTime,
    });
  },

  // No public endpoint: workers_dev and preview URLs are off, and anything
  // that reaches this anyway gets a 404. It can't trigger a drain.
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
