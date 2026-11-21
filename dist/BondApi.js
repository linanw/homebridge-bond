"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BondApi = void 0;
const Action_1 = require("./enum/Action");
const BondUri_1 = require("./BondUri");
const axios_1 = __importDefault(require("axios"));
const axios_retry_1 = __importDefault(require("axios-retry"));
const flake_idgen_1 = __importDefault(require("flake-idgen"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const intformat = require('biguint-format');
var HTTPMethod;
(function (HTTPMethod) {
    HTTPMethod["GET"] = "get";
    HTTPMethod["PUT"] = "put";
    HTTPMethod["PATCH"] = "patch";
})(HTTPMethod || (HTTPMethod = {}));
const flakeIdGen = new flake_idgen_1.default();
class BondApi {
    constructor(platform, bondToken, ipAddress, ms_between_actions) {
        this.platform = platform;
        this.nextAction = Promise.resolve();
        this.bondToken = bondToken;
        this.uri = new BondUri_1.BondUri(ipAddress);
        this.ms_between_actions = ms_between_actions;
        (0, axios_retry_1.default)(axios_1.default, {
            retries: 10,
            retryDelay: axios_retry_1.default.exponentialDelay,
            shouldResetTimeout: true,
            retryCondition: (error) => {
                var _a, _b, _c;
                const shouldRetry = axios_retry_1.default.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED';
                this.platform.log.debug(`Retrying: ${shouldRetry ? 'YES' : 'NO'}`, {
                    url: (_a = error.config) === null || _a === void 0 ? void 0 : _a.url,
                    method: (_b = error.config) === null || _b === void 0 ? void 0 : _b.method,
                    errorCode: error.code,
                    responseStatus: (_c = error.response) === null || _c === void 0 ? void 0 : _c.status,
                });
                return shouldRetry;
            },
        });
    }
    // Bond / Device Info
    getVersion() {
        return this.request(HTTPMethod.GET, this.uri.version());
    }
    getState(id) {
        return this.request(HTTPMethod.GET, this.uri.state(id));
    }
    getDeviceIds() {
        const req = this.request(HTTPMethod.GET, this.uri.deviceIds());
        return req.then(json => Object.keys(json).filter(x => {
            // Ignore anything that is an empty string or starts with underscores
            return x.length > 0 && !/^_+/.test(x);
        }));
    }
    getDevices(ids) {
        const ps = [];
        ids.forEach(id => {
            ps.push(this.getDevice(id));
        });
        return Promise.all(ps);
    }
    getDevice(id) {
        const req = this.request(HTTPMethod.GET, this.uri.device(id));
        return req.then(json => {
            // Set the id since it's not included in the response
            json.id = id;
            // get the properties of the device
            return this.getProperties(id).then(properties => {
                json.properties = properties;
                if (json.commands) {
                    // commands are only present on Bridge devices.
                    return this.getCommands(id).then(commands => {
                        json.commands = commands;
                        return json;
                    });
                }
                else {
                    return json;
                }
            });
        });
    }
    async readMetadata(id) {
        const row = await this.request(HTTPMethod.GET, this.uri.device(id));
        if (typeof (row === null || row === void 0 ? void 0 : row.name) !== 'string' || typeof row.location !== 'string') {
            throw new Error('Bond metadata unavailable');
        }
        return { name: row.name, location: row.location };
    }
    async writeMetadata(id, patch) {
        await this.request(HTTPMethod.PATCH, this.uri.device(id), patch);
    }
    // Actions
    action(device, action, body = {}) {
        const send = () => this.request(HTTPMethod.PUT, this.uri.action(device.id, action), body);
        if (!this.ms_between_actions) {
            return send();
        }
        const result = this.nextAction.then(send);
        const pause = () => new Promise(resolve => setTimeout(resolve, this.ms_between_actions));
        this.nextAction = result.then(pause, pause);
        return result;
    }
    toggleLight(device) {
        return this.action(device, Action_1.Action.ToggleLight);
    }
    toggleUpLight(device) {
        return this.action(device, Action_1.Action.ToggleUpLight);
    }
    toggleDownLight(device) {
        return this.action(device, Action_1.Action.ToggleDownLight);
    }
    startDimmer(device) {
        return this.action(device, Action_1.Action.StartDimmer);
    }
    startUpLightDimmer(device) {
        return this.action(device, Action_1.Action.StartUpLightDimmer);
    }
    startDownLightDimmer(device) {
        return this.action(device, Action_1.Action.StartDownLightDimmer);
    }
    startIncreasingBrightness(device) {
        return this.action(device, Action_1.Action.StartIncreasingBrightness);
    }
    startDecreasingBrightness(device) {
        return this.action(device, Action_1.Action.StartDecreasingBrightness);
    }
    setBrightness(device, value) {
        return this.action(device, Action_1.Action.SetBrightness, { argument: value });
    }
    setFlame(device, value) {
        return this.action(device, Action_1.Action.SetFlame, { argument: value });
    }
    turnLightOff(device) {
        return this.action(device, Action_1.Action.TurnLightOff);
    }
    toggleFan(device, on) {
        const action = on ? Action_1.Action.TurnOn : Action_1.Action.TurnOff;
        return this.action(device, action);
    }
    toggleDirection(device) {
        return this.action(device, Action_1.Action.ToggleDirection);
    }
    togglePower(device) {
        return this.action(device, Action_1.Action.TogglePower);
    }
    toggleOpen(device) {
        return this.action(device, Action_1.Action.ToggleOpen);
    }
    preset(device) {
        return this.action(device, Action_1.Action.Preset);
    }
    stop(device) {
        return this.request(HTTPMethod.PUT, this.uri.action(device.id, Action_1.Action.Stop));
    }
    setPosition(device, position) {
        return this.request(HTTPMethod.PUT, this.uri.action(device.id, Action_1.Action.SetPosition), { argument: position });
    }
    setFanSpeed(device, speed) {
        return this.action(device, Action_1.Action.SetSpeed, { argument: speed });
    }
    increaseSpeed(device) {
        return this.action(device, Action_1.Action.IncreaseSpeed, { argument: 1 });
    }
    decreaseSpeed(device) {
        return this.action(device, Action_1.Action.DecreaseSpeed, { argument: 1 });
    }
    // State
    updateState(device, state) {
        return this.request(HTTPMethod.PATCH, this.uri.state(device.id), state);
    }
    // PATCH: Toggle state property for a device
    toggleState(device, property) {
        return this.getState(device.id)
            .then(state => {
            if (property !== 'open' && property !== 'power' && property !== 'light') {
                throw Error(`This device does not have ${property} in it's Bond state`);
            }
            if (state[property] !== undefined) {
                const newState = {};
                newState[property] = state[property] === 1 ? 0 : 1;
                return this.updateState(device, newState);
            }
            else {
                throw Error(`This device does not have ${property} in it's Bond state`);
            }
        });
    }
    // Commands
    getCommands(deviceId) {
        return this.getCommandIds(deviceId).then(ids => {
            const ps = [];
            ids.forEach(id => {
                ps.push(this.getCommand(deviceId, id));
            });
            return Promise.all(ps);
        });
    }
    getCommandIds(id) {
        const req = this.request(HTTPMethod.GET, this.uri.commands(id));
        return req.then(json => Object.keys(json).filter(x => {
            // Ignore anything that is an empty string or starts with underscores
            return x.length > 0 && !/^_+/.test(x);
        }));
    }
    getCommand(deviceId, commandId) {
        return this.request(HTTPMethod.GET, this.uri.command(deviceId, commandId));
    }
    // Properties
    getProperties(id) {
        return this.request(HTTPMethod.GET, this.uri.properties(id));
    }
    // Helpers
    ping() {
        const uuid = intformat(flakeIdGen.next(), 'hex', { prefix: '18', padstr: '0', size: 16 }); // avoid duplicate action
        const bondUuid = uuid.substring(0, 13) + uuid.substring(15); // remove '00' used for datacenter/worker in flakeIdGen
        return (0, axios_1.default)({
            method: HTTPMethod.GET,
            url: this.uri.deviceIds(),
            headers: {
                'BOND-Token': this.bondToken,
                'Bond-UUID': bondUuid,
            },
            timeout: 2000,
        });
    }
    request(method, uri, body = {}) {
        const bodyStr = JSON.stringify(body);
        const uuid = intformat(flakeIdGen.next(), 'hex', { prefix: '18', padstr: '0', size: 16 }); // avoid duplicate action
        const bondUuid = uuid.substring(0, 13) + uuid.substring(15); // remove '00' used for datacenter/worker in flakeIdGen
        if (bodyStr !== '{}') {
            this.platform.log.debug(`Request (${bondUuid}) [${method} ${uri}] - body: ${bodyStr}`);
        }
        else {
            this.platform.log.debug(`Request (${bondUuid}) [${method} ${uri}]`);
        }
        return (0, axios_1.default)({
            method,
            url: uri,
            headers: {
                'BOND-Token': this.bondToken,
                'Bond-UUID': bondUuid,
            },
            data: body,
            timeout: 10000,
        })
            .then(response => {
            this.platform.log.debug(`Response (${bondUuid}) [${method} ${uri}] - ${JSON.stringify(response.data)}`);
            return response.data;
        })
            .catch((error) => {
            var _a;
            const status = axios_1.default.isAxiosError(error) ? (_a = error.response) === null || _a === void 0 ? void 0 : _a.status : undefined;
            const message = status ? `Bond returned HTTP ${status}` : 'Bond request failed';
            this.platform.log.error(message);
            if (method !== HTTPMethod.GET) {
                throw new Error(message);
            }
        });
    }
}
exports.BondApi = BondApi;
