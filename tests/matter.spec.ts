import { strict as assert } from 'assert';
import type { MatterAPI } from 'homebridge';
import { endpoints } from '../src/matter';
import { Device } from '../src/interface/Device';
import { DeviceType } from '../src/enum/DeviceType';
import { Action } from '../src/enum/Action';

const api = { uuid: { generate: (s: string) => s }, deviceTypes: {
  Fan: {}, OnOffLight: {}, OnOffOutlet: {}, WindowCovering: { with: () => ({}) },
}, deviceRequirements: { WindowCovering: { WindowCoveringServer: { with: () => ({}) } } } } as unknown as MatterAPI;
function fixture(type: DeviceType, actions: string[]) {
  const d: Device = { name: 'Test', type, actions: actions as Action[], id: '1', bondId: 'bridge',
    uniqueId: 'bridge1', location: '', commands: undefined, properties: { max_speed: 4, trust_state: true } };
  const calls: unknown[] = [];
  const read = async () => ({ power: 1, speed: 2 });
  const list = endpoints(api, d, { power: 1, speed: 2 }, async (action, value) => { calls.push([action, value]); }, read);
  return { list, calls };
}
describe('Bond Matter', () => {
  it('maps fan speed and independent upper and lower lights', async () => {
    const { list, calls } = fixture(DeviceType.CeilingFan,
      ['TurnOn','TurnOff','SetSpeed','TurnUpLightOn','TurnUpLightOff','TurnDownLightOn','TurnDownLightOff']);
    assert.equal(new Set(list.map(e => e.accessory.UUID)).size, 3);
    assert.equal(list[0].accessory.clusters?.fanControl?.percentCurrent, 50);
    await list[0].accessory.handlers!.fanControl!.percentSettingChange!({ percentSetting: 50, oldPercentSetting: 0 });
    assert.equal(calls.length, 0);
    await list[0].accessory.handlers!.fanControl!.percentSettingChange!({ percentSetting: 100, oldPercentSetting: 50 });
    await list[2].accessory.handlers!.onOff!.off!({});
    assert.deepEqual(calls, [['SetSpeed',4], ['TurnDownLightOff',undefined]]);
  });
  it('uses directional shade commands and only advertises positioning if supported', async () => {
    const { list, calls } = fixture(DeviceType.Shades,['Open','Close','Stop','ToggleOpen']);
    const handlers = list[0].accessory.handlers!.windowCovering!;
    await handlers.downOrClose!({});
    await handlers.stopMotion!({});
    assert.equal(handlers.goToLiftPercentage, undefined);
    assert.deepEqual(calls, [['Close',undefined],['Stop',undefined]]);
  });
  it('exposes absolute power commands and excludes toggle-only devices', async () => {
    assert.equal(fixture(DeviceType.Generic,['TogglePower']).list.length, 0);
    const { list, calls } = fixture(DeviceType.Generic,['TurnOn','TurnOff']);
    await list[0].accessory.handlers!.onOff!.on!({});
    assert.deepEqual(calls, [['TurnOn',undefined]]);
  });
});
