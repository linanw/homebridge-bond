"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BondMatter = void 0;
exports.endpoints = endpoints;
const matterLabel_1 = require("./matterLabel");
const loadMetadata = require("../lib/load.cjs");
const Device_1 = require("./interface/Device");
const DeviceType_1 = require("./enum/DeviceType");
const settings_1 = require("./settings");
function endpoints(api, d, initial, send, read) {
    const result = [];
    const has = (action) => d.actions.includes(action);
    function add(key, suffix, deviceType, state, handlers) {
        const serial = d.uniqueId + '-' + key;
        result.push({ state, accessory: { UUID: api.uuid.generate(serial), displayName: (0, matterLabel_1.matterLabel)(Device_1.Device.displayName(d).trim() + suffix),
                deviceType, serialNumber: serial, manufacturer: 'Bond', model: d.type, context: { bondId: d.bondId },
                clusters: state(initial), handlers } });
    }
    function binary(key, suffix, prefix, light) {
        const on = 'Turn' + prefix + 'On', off = 'Turn' + prefix + 'Off';
        if (!has(on) || !has(off)) {
            return;
        }
        add(key, suffix, light ? api.deviceTypes.OnOffLight : api.deviceTypes.OnOffOutlet, (s) => s[key] === undefined ? {} : { onOff: { onOff: s[key] === 1 } }, { onOff: { on: () => send(on), off: () => send(off), toggle: async () => {
                    const value = (await read())[key];
                    if (value !== 0 && value !== 1) {
                        throw new Error('Unknown Bond power state');
                    }
                    await send(value ? off : on);
                } } });
    }
    if (d.type === DeviceType_1.DeviceType.CeilingFan && Device_1.Device.hasOffOn(d)) {
        const max = d.properties.max_speed || 0;
        if (max > 0 && has('SetSpeed')) {
            const percent = (s) => s.power === 0 ? 0 : Math.round(100 * (s.speed || 1) / max);
            const mode = (s) => Math.ceil(percent(s) * 3 / 100);
            const setPercent = async (value) => {
                if (!Number.isFinite(value) || value < 0 || value > 100) {
                    throw new Error('Invalid fan percentage');
                }
                const s = await read();
                if (!value) {
                    if (s.power !== 0) {
                        await send('TurnOff');
                    }
                    return;
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
                        }
                        else if (mode(s) !== fanMode) {
                            await setPercent(fanMode * 100 / 3);
                        }
                    },
                } });
        }
        else {
            binary('power', '', '', false);
        }
        if (has('TurnUpLightOn') || has('TurnDownLightOn')) {
            binary('up_light', ' Up Light', 'UpLight', true);
            binary('down_light', ' Down Light', 'DownLight', true);
        }
        else {
            binary('light', ' Light', 'Light', true);
        }
    }
    else if (d.type === DeviceType_1.DeviceType.Generic) {
        binary('power', '', '', false);
    }
    else if (d.type === DeviceType_1.DeviceType.Light) {
        binary('light', '', 'Light', true);
    }
    else if (d.type === DeviceType_1.DeviceType.Shades && has('Open') && has('Close') && has('Stop')) {
        const positional = has('SetPosition');
        const server = api.deviceRequirements.WindowCovering.WindowCoveringServer;
        const type = api.deviceTypes.WindowCovering.with(positional ? server.with('Lift', 'PositionAwareLift') : server.with('Lift'));
        add('shade', '', type, s => {
            const pos = s.position === undefined ? undefined : Device_1.Device.MSisAwning(d) ? 100 - s.position : s.position;
            return { windowCovering: { type: 0, ...(positional && pos !== undefined ?
                        { currentPositionLiftPercent100ths: pos * 100, targetPositionLiftPercent100ths: pos * 100 } : {}) } };
        }, { windowCovering: { upOrOpen: () => send('Open'), downOrClose: () => send('Close'), stopMotion: () => send('Stop'),
                ...(positional ? { goToLiftPercentage: async ({ liftPercent100thsValue }) => {
                        const pos = Math.round(liftPercent100thsValue / 100);
                        await send('SetPosition', Device_1.Device.MSisAwning(d) ? 100 - pos : pos);
                    } } : {}) } });
    }
    return result;
}
class BondMatter {
    constructor(platform) {
        this.platform = platform;
        this.cached = new Map();
        this.listeners = new Map();
    }
    restore(a) {
        this.cached.set(a.UUID, a);
    }
    changed(bond, id, patch) {
        var _a;
        (_a = this.listeners.get(bond.uniqueDeviceId(id))) === null || _a === void 0 ? void 0 : _a(patch);
    }
    async discover(bond) {
        var _a, _b;
        const api = this.platform.api.matter;
        if (!api || !((_a = bond.version) === null || _a === void 0 ? void 0 : _a.bondid)) {
            return;
        }
        // Only prune after a successful authoritative inventory, including across restarts.
        const ids = (await bond.api.getDeviceIds()).filter(id => { var _a; return !((_a = bond.config.hide_device_ids) === null || _a === void 0 ? void 0 : _a.includes(id)); });
        const devices = await bond.api.getDevices(ids);
        const keep = new Set();
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
            const list = endpoints(api, d, state, (a, value) => bond.api.action(d, a, value === undefined ? {} : { argument: value }), read);
            if (!list.length) {
                continue;
            }
            // One HAP accessory and one Bond metadata record can back several Matter
            // controls. Expose the editor on the primary endpoint only.
            const primary = list[0].accessory;
            const { attachFanControl, attachMetadata, preserveBridgedIdentity } = await loadMetadata();
            for (const { accessory } of list) {
                attachFanControl(accessory);
                // Composed endpoints can be rebuilt when reattached to the restored
                // cache. Carry over the previous bridged identity through the rebuild.
                const restored = await api.getAccessoryState(accessory.UUID, 'bridgedDeviceBasicInformation');
                preserveBridgedIdentity(accessory, restored === null || restored === void 0 ? void 0 : restored.uniqueId);
            }
            const metadata = await attachMetadata(primary, {
                directory: this.platform.api.user.storagePath(), identity: d.uniqueId,
                initial: { name: d.name, location: d.location }, locations: devices.map(row => row.location),
                read: () => bond.api.readMetadata(d.id),
                write: (patch) => bond.api.writeMetadata(d.id, patch),
                observed: (name, location) => this.platform.updateCachedMetadata(d.uniqueId, name, location),
                update: (key, attrs) => api.updateAccessoryState(primary.UUID, key, attrs),
                label: matterLabel_1.matterLabel,
                warn: () => this.platform.log.warn('Bond metadata refresh failed for %s', d.uniqueId),
            });
            await api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, list.map(e => e.accessory));
            await metadata.start();
            this.platform.api.on('shutdown', () => metadata.stop());
            let serial = Promise.resolve();
            const publishState = (patch) => {
                state = { ...state, ...patch };
                const snapshot = state;
                serial = serial.then(async () => {
                    for (const e of list) {
                        for (const [cluster, attrs] of Object.entries(e.state(snapshot))) {
                            await api.updateAccessoryState(e.accessory.UUID, cluster, attrs);
                        }
                    }
                }).catch(() => this.platform.log.warn('Could not sync a Bond Matter state update'));
            };
            this.listeners.set(d.uniqueId, publishState);
            if ((_b = primary.clusters) === null || _b === void 0 ? void 0 : _b.fanControl) {
                // Homebridge restores cached cluster values during registration.
                publishState(state);
            }
            for (const e of list) {
                keep.add(e.accessory.UUID);
            }
        }
        const stale = [...this.cached.values()].filter(a => a.context.bondId === bond.version.bondid && !keep.has(a.UUID));
        if (stale.length) {
            await api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
        }
        this.platform.log.info('Registered %d Bond Matter endpoints', keep.size);
    }
}
exports.BondMatter = BondMatter;
