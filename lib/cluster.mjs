import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { BondMetadata } from './metadata.mjs';

// Homebridge installs plugins and its own pinned Matter runtime in separate trees.
const fromBridge = createRequire(createRequire(import.meta.url).resolve('homebridge'));
const hostImport = name => import(pathToFileURL(fromBridge.resolve(name).replace('/dist/cjs/', '/dist/esm/')).href);
const {ClusterModel} = await hostImport('@matter/main/model');
const {ClusterType, Status, StatusResponseError} = await hostImport('@matter/main/types');
const {ClusterBehavior} = await hostImport('@matter/main');

export const PLUGIN_METADATA_ID = 0xfff1fc03;
const field = (name, id, type, extra = {}) => ({ tag: 'field', name, id, type, conformance: 'M', ...extra });
const text = (name, id, limit, extra = {}) => field(name, id, 'string', { constraint: 'max ' + limit, ...extra });
const attr = (name, id, type, extra = {}) => ({ tag: 'attribute', name, id, type, access: 'R V', conformance: 'M', ...extra });

export const PluginMetadata = new ClusterModel({
  name: 'MatterDeskPluginMetadata', id: PLUGIN_METADATA_ID, classification: 'application',
  children: [
    { tag: 'attribute', name: 'ClusterRevision', id: 0xfffd, type: 'ClusterRevision', default: 1 },
    attr('State', 0, 'StateStruct'),
    attr('Rooms', 1, 'list', { constraint: 'max 256', children: [field('entry', 0, 'RoomStruct')] }),
    { tag: 'datatype', name: 'StateStruct', type: 'struct', children: [
      text('Identity', 0, 96), text('Version', 1, 64), text('Name', 2, 160), text('RoomKey', 3, 96),
      field('WriteMask', 4, 'uint8'), text('LastRequest', 5, 36),
      field('AppleStatus', 6, 'uint8'), field('SourceStatus', 7, 'uint8'),
    ] },
    { tag: 'datatype', name: 'RoomStruct', type: 'struct', children: [text('Key', 0, 96), text('Label', 1, 160)] },
    { tag: 'command', name: 'SetMetadata', id: 0, access: 'M', conformance: 'M', direction: 'request', response: 'status',
      children: [text('Identity', 0, 96), text('ExpectedVersion', 1, 64), text('RequestKey', 2, 36),
        text('Name', 3, 160, {conformance: 'O'}), text('RoomKey', 4, 96, {conformance: 'O'})] },
  ],
});

const Base = ClusterBehavior.for(ClusterType(PluginMetadata));
export async function attachMetadata(accessory, options) {
  const record = new BondMetadata(options);
  const cluster = Base.id;
  const projection = record.projection();
  class BondMetadataServer extends Base {
    async setMetadata(request) {
      const fabric = this.context.session?.associatedFabric;
      if (!fabric) throw new StatusResponseError('Authenticated fabric required', Status.UnsupportedAccess);
      try {
        await record.accept(String(fabric.globalId), request);
        // Update within the invoking transaction. A separate endpoint.set()
        // cannot acquire this endpoint's lock until the invocation returns.
        this.state.state = record.projection().state;
      } catch (error) {
        throw new StatusResponseError(error.message, Status.InvalidAction);
      }
    }
  }
  accessory.deviceType = accessory.deviceType.with(BondMetadataServer);
  accessory.clusters[cluster] = projection;
  return record.publisher(async value => {
    await options.update(cluster, value);
    const label = options.label(value.state.name);
    await options.update('bridgedDeviceBasicInformation', {nodeLabel:label});
  });
}
