import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('a fan report stays read-only even while a controller command is running', {timeout:6000}, async () => {
  const storage = await mkdtemp(join(tmpdir(), 'bond-fan-report-'));
  process.env.MATTER_STORAGE_PATH = storage;
  await import('@matter/nodejs');
  const { Endpoint, ServerNode } = await import('@matter/main');
  const { FanDevice } = await import('@matter/main/devices/fan');
  const { FanControlServer } = await import('@matter/main/behaviors/fan-control');
  const packageDir = process.env.BOND_TEST_INSTALLED_PACKAGE;
  const { attachFanControl } = await import(packageDir
    ? pathToFileURL(join(packageDir, 'lib/cluster.mjs')).href
    : '../lib/cluster.mjs');

  const actions = [];
  let unblock;
  let beginSpeed;
  const speedStarted = new Promise(resolve => { beginSpeed = resolve; });
  const speedInFlight = new Promise(resolve => { unblock = resolve; });
  const accessory = { deviceType: FanDevice, handlers: { fanControl: {
    async fanModeChange({fanMode}) { actions.push(['mode', fanMode]); },
    async percentSettingChange({percentSetting}) {
      actions.push(['percent', percentSetting]);
      beginSpeed();
      await speedInFlight;
    },
  } } };
  attachFanControl(accessory);
  assert.equal(accessory.handlers.fanControl, undefined);

  const server = await ServerNode.create({ id:'bond-fan-fixture', network:{port:0} });
  try {
    const fan = await server.add(new Endpoint(accessory.deviceType, { id:'fan', fanControl:{
      fanMode:0, fanModeSequence:0, percentCurrent:0, percentSetting:0,
    } }));
    await fan.set({fanControl:{fanMode:1, percentCurrent:33, percentSetting:33}});
    assert.deepEqual(actions, [], 'local startup/state reconciliation cannot actuate the fan');

    // Exercise the real event reactor with the subject carried by a remote write.
    const events = fan.eventsOf(FanControlServer);
    const origin = {subject:{nodeId:1n}};
    const speed = events.percentSetting$Changed.emit(67, 33, origin);
    await speedStarted;
    const report = fan.set({fanControl:{fanMode:2, percentCurrent:67, percentSetting:50}});
    unblock();
    await Promise.all([speed, report]);
    assert.deepEqual(actions, [['percent',67]]);
    assert.equal(fan.stateOf(FanControlServer).percentCurrent, 67);

    await events.fanMode$Changed.emit(0, 2, origin);
    assert.deepEqual(actions, [['percent',67],['mode',0]]);
  } finally {
    unblock();
    await server.close();
    await rm(storage, {recursive:true,force:true});
  }
});
