import type { MatterAccessory, MatterAPI } from 'homebridge';
import type { BondPlatform } from './platform';
import type { Bond, BondState } from './interface/Bond';
import { Device } from './interface/Device';
import { Action } from './enum/Action';
import { DeviceType } from './enum/DeviceType';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

type Clusters = NonNullable<MatterAccessory['clusters']>;
type Send = (action: string, argumentValue?: number) => Promise<void>;
interface Endpoint {
  accessory: MatterAccessory;
  state: (state: BondState) => Clusters;
}

export function endpoints(api: MatterAPI, d: Device, initial: BondState, send: Send,
  read: () => Promise<BondState>): Endpoint[] {
  const result: Endpoint[] = [];
  const has = (action: string) => (d.actions as string[]).includes(action);
  function add(key: string, suffix: string, deviceType: MatterAccessory['deviceType'],
    state: Endpoint['state'], handlers: MatterAccessory['handlers']) {
    const serial = d.uniqueId + '-' + key;
    result.push({ state, accessory: { UUID: api.uuid.generate(serial), displayName: (Device.displayName(d).trim() + suffix),
      deviceType, serialNumber: serial, manufacturer: 'Bond', model: d.type, context: { bondId: d.bondId },
      clusters: state(initial), handlers } });
  }
  function binary(key: keyof BondState, suffix: string, prefix: string, light: boolean) {
    const on = 'Turn' + prefix + 'On', off = 'Turn' + prefix + 'Off';
    if (!has(on) || !has(off)) {
      return;
    }
    add(key, suffix, light ? api.deviceTypes.OnOffLight : api.deviceTypes.OnOffOutlet,
      (s): Clusters => s[key] === undefined ? {} : { onOff: { onOff: s[key] === 1 } },
      { onOff: { on: () => send(on), off: () => send(off), toggle: async () => {
        const value = (await read())[key];
        if (value !== 0 && value !== 1) {
          throw new Error('Unknown Bond power state');
        }
        await send(value ? off : on);
      } } });
  }
  if (d.type === DeviceType.CeilingFan && Device.hasOffOn(d)) {
    const max = d.properties.max_speed || 0;
    if (max > 0 && has('SetSpeed')) {
      const percent = (s: BondState) => s.power === 0 ? 0 : Math.round(100 * (s.speed || 1) / max);
      const mode = (s: BondState) => Math.ceil(percent(s) * 3 / 100);
      const setPercent = async (value: number) => {
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          throw new Error('Invalid fan percentage');
        }
        const s = await read();
        if (!value) {
          if (s.power !== 0) {
            await send('TurnOff');
          } return;
        }
        const speed = Math.max(1, Math.round(max * value / 100));
        if (!s.power || s.speed !== speed) {
          await send('SetSpeed', speed);
        }
      };
      add('fan', '', api.deviceTypes.Fan, s => ({ fanControl: { fanModeSequence: 0, fanMode: mode(s),
        percentCurrent: percent(s), percentSetting: percent(s) } }), { fanControl: {
        percentSettingChange: async ({ percentSetting }) => {
          if (percentSetting !== null) {
            await setPercent(percentSetting);
          }
        },
        fanModeChange: async ({ fanMode }) => {
          if (fanMode < 0 || fanMode > 4) {
            throw new Error('Unsupported fan mode');
          }
          const s = await read();
          if (fanMode === 4) {
            if (!s.power) {
              await send('TurnOn');
            }
          } else if (mode(s) !== fanMode) {
            await setPercent(fanMode * 100 / 3);
          }
        },
      } });
    } else {
      binary('power', '', '', false);
    }
    if (has('TurnUpLightOn') || has('TurnDownLightOn')) {
      binary('up_light', ' Up Light', 'UpLight', true);
      binary('down_light', ' Down Light', 'DownLight', true);
    } else {
      binary('light', ' Light', 'Light', true);
    }
  } else if (d.type === DeviceType.Generic) {
    binary('power', '', '', false);
  } else if (d.type === DeviceType.Light) {
    binary('light', '', 'Light', true);
  } else if (d.type === DeviceType.Shades && has('Open') && has('Close') && has('Stop')) {
    const positional = has('SetPosition');
    const server = api.deviceRequirements.WindowCovering.WindowCoveringServer;
    const type = api.deviceTypes.WindowCovering.with(positional ? server.with('Lift', 'PositionAwareLift') : server.with('Lift'));
    add('shade', '', type, s => {
      const pos = s.position === undefined ? undefined : Device.MSisAwning(d) ? 100 - s.position : s.position;
      return { windowCovering: { type: 0, ...(positional && pos !== undefined ?
        { currentPositionLiftPercent100ths: pos * 100, targetPositionLiftPercent100ths: pos * 100 } : {}) } };
    }, { windowCovering: { upOrOpen: () => send('Open'), downOrClose: () => send('Close'), stopMotion: () => send('Stop'),
      ...(positional ? { goToLiftPercentage: async ({ liftPercent100thsValue }: { liftPercent100thsValue: number }) => {
        const pos = Math.round(liftPercent100thsValue / 100);
        await send('SetPosition', Device.MSisAwning(d) ? 100 - pos : pos);
      } } : {}) } });
  }
  return result;
}

export class BondMatter {
  private cached = new Map<string, MatterAccessory>();
  private listeners = new Map<string, (patch: BondState) => void>();
  constructor(private platform: BondPlatform) {}
  restore(a: MatterAccessory) {
    this.cached.set(a.UUID, a);
  }

  changed(bond: Bond, id: string, patch: BondState) {
    this.listeners.get(bond.uniqueDeviceId(id))?.(patch);
  }

  async discover(bond: Bond) {
    const api = this.platform.api.matter;
    if (!api || !bond.version?.bondid) {
      return;
    }
    // Only prune after a successful authoritative inventory, including across restarts.
    const ids = (await bond.api.getDeviceIds()).filter(id => !bond.config.hide_device_ids?.includes(id));
    const devices = await bond.api.getDevices(ids);
    const keep = new Set<string>();
    for (const d of devices) {
      d.bondId = bond.version.bondid;
      d.uniqueId = bond.uniqueDeviceId(d.id);
      const read = async () => {
        const s = await bond.api.getState(d.id);
        if (!s) {
          throw new Error('Bond state unavailable');
        }
        return s;
      };
      let state = await read();
      const list = endpoints(api, d, state, (a, value) => bond.api.action(d, a as Action,
        value === undefined ? {} : { argument: value }), read);
      if (!list.length) {
        continue;
      }
      await api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, list.map(e => e.accessory));
      let serial = Promise.resolve();
      this.listeners.set(d.uniqueId, patch => {
        state = { ...state, ...patch };
        const snapshot = state;
        serial = serial.then(async () => {
          for (const e of list) {
            for (const [cluster, attrs] of Object.entries(e.state(snapshot))) {
              await api.updateAccessoryState(e.accessory.UUID, cluster, attrs);
            }
          }
        }).catch(() => this.platform.log.warn('Could not sync a Bond Matter state update'));
      });
      for (const e of list) {
        keep.add(e.accessory.UUID);
      }
    }
    const stale = [...this.cached.values()].filter(a => a.context.bondId === bond.version.bondid && !keep.has(a.UUID));
    if (stale.length) {
      await api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
    this.platform.log.info('Registered %d Bond Matter endpoints', keep.size);
  }
}
