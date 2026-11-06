// MQTT device layer: talks the monaid_net protocol the Watcher firmware speaks.
// (Topic prefix stays "monaid/" so the Mumbai broker's per-device credentials
// and ACLs keep working — see firmware/common/monaid_net.)
//
//   monaid/<dev>/status  retained online/offline (last-will ~8s death beat)
//   monaid/<dev>/evt     device -> us: {dev, kind, seq, ts, data, sig}
//   monaid/<dev>/cmd     us -> device: {cmd, ...}
import { EventEmitter } from 'node:events';
import mqtt from 'mqtt';

export interface DeviceEvent {
  dev: string;
  kind: string; // crash | recover | power | heartbeat | knob | click | ...
  seq: number;
  ts: number;
  data: Record<string, unknown>;
}

export class Devices extends EventEmitter {
  private client: mqtt.MqttClient;

  constructor(url: string, username: string, password: string) {
    super();
    this.client = mqtt.connect(url, { username, password, reconnectPeriod: 2000 });
    this.client.on('connect', () => {
      this.client.subscribe(['monaid/+/evt', 'monaid/+/status']);
      this.emit('connect');
    });
    this.client.on('error', (e) => this.emit('log', `mqtt error: ${e.message}`));
    this.client.on('message', (topic, buf) => {
      const [, dev, leaf] = topic.split('/');
      if (leaf === 'status') return this.emit('status', dev, buf.toString() === 'online');
      try {
        const evt = JSON.parse(buf.toString()) as DeviceEvent;
        this.emit('evt', evt);
      } catch { /* ignore malformed */ }
    });
  }

  /** Send a command to a device, e.g. {cmd:'state', state:'JOB OPEN'} or {cmd:'job', id, payout, url}. */
  cmd(dev: string, obj: Record<string, unknown>) {
    this.client.publish(`monaid/${dev}/cmd`, JSON.stringify(obj), { qos: 1 });
  }
}
