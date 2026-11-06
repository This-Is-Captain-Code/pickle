// One-off ops tool: clear stale RETAINED cmd messages left on the broker by
// the Mumbai demo (an empty retained publish deletes the retained message).
// Usage: npx tsx --env-file=.env src/tools/clear-retained.ts [dev ...]
import mqtt from 'mqtt';

const devs = process.argv.slice(2).length ? process.argv.slice(2) : ['watcher-01', 'tdeck-01'];
const client = mqtt.connect(process.env.BROKER_URL!, {
  username: process.env.BROKER_USER || 'bridge', password: process.env.BROKER_PASS,
});
client.on('connect', () => {
  let n = 0;
  for (const d of devs) client.publish(`monaid/${d}/cmd`, '', { retain: true, qos: 1 }, () => {
    console.log(`cleared retained cmd for ${d}`);
    if (++n === devs.length) client.end();
  });
});
