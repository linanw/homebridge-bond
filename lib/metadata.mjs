import {createHash, randomUUID} from 'node:crypto';
import {chownSync, mkdirSync, readFileSync, statSync, renameSync, writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';

const uuid = s => typeof s === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const label = s => typeof s === 'string' && !!s.trim() && !/[\p{C}]/u.test(s) && Buffer.byteLength(s) <= 160;
const roomKey = s => s ? createHash('sha256').update(s).digest('hex') : '';
function read(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; return null; }
}
function save(file, data) {
  const next = file + '.' + randomUUID();
  writeFileSync(next, JSON.stringify(data), {mode:0o600, flag:'wx'});
  // A DSM user may own just the dedicated exchange directory while
  // Homebridge runs as root. A replacement must retain that user's access.
  if (process.getuid?.() === 0) {
    const owner = statSync(dirname(file));
    chownSync(next,owner.uid,owner.gid);
  }
  renameSync(next,file);
}
const outcome = checks => checks.every(Boolean) ? 2 : checks.some(Boolean) ? 5 : 4;
const MINUTE = 60000;

export class BondMetadata {
  constructor(options) {
    this.options = options;
    const {directory, identity, initial, locations} = options;
    if (!/^[a-z0-9_-]{1,96}$/i.test(identity) || !label(initial.name)) throw Error('Invalid Bond metadata');
    this.exchange = join(directory,'bond-homekit',identity);
    const privateDir = join(directory,'bond-metadata');
    for (const dir of [privateDir,this.exchange]) mkdirSync(dir,{recursive:true,mode:0o700});
    this.file = join(privateDir,identity+'.json');
    this.data = read(this.file) || {state:{identity,version:randomUUID(),name:initial.name,roomKey:roomKey(initial.location),
      writeMask:3,lastRequest:'',appleStatus:0,sourceStatus:0}, history:[], mapping:''};
    this.rooms = [...new Set(locations.filter(label))].sort().slice(0,256).map(location => ({key:roomKey(location),label:location}));
    this.tail = Promise.resolve();
    this.binding();
    save(this.file,this.data);
    save(join(this.exchange,'inventory.json'),{identity,name:initial.name,rooms:this.rooms});
  }
  binding() {
    const raw = read(join(this.exchange,'binding.json'));
    const valid = raw?.identity === this.options.identity && uuid(raw.home) && uuid(raw.accessory) &&
      raw.rooms && typeof raw.rooms === 'object' && !Array.isArray(raw.rooms) &&
      Object.values(raw.rooms).every(uuid);
    const binding = valid ? raw : null;
    this.activeBinding = binding;
    const mapping = JSON.stringify([this.rooms,binding]);
    if (mapping !== this.data.mapping) {
      this.data.mapping = mapping;
      this.data.state.version = randomUUID();
      save(this.file,this.data);
    }
    return binding;
  }
  projection() {
    const binding = this.activeBinding;
    const rooms = binding ? this.rooms.filter(r => binding.rooms[r.key]) : this.rooms;
    return {state:{...this.data.state,writeMask:rooms.length ? 3 : 1},rooms};
  }
  serial(work) {
    const job = this.tail.then(work);
    this.tail = job.catch(() => {});
    return job;
  }
  observe(row) {
    if (!label(row.name) || typeof row.location !== 'string') throw Error('Invalid Bond readback');
    const state = this.data.state;
    if (row.name !== state.name || roomKey(row.location) !== state.roomKey) {
      state.name = row.name; state.roomKey = roomKey(row.location); state.version = randomUUID();
      this.options.observed(row.name,row.location);
    }
  }
  accept(fabric, request) {
    return this.serial(async () => {
      const {identity,expectedVersion,requestKey,name,roomKey:key} = request;
      const state = this.data.state;
      if (!fabric || identity !== state.identity || !uuid(requestKey) || (!name && !key)) throw Error('Invalid metadata request');
      const fingerprint = JSON.stringify([identity,expectedVersion,name,key]);
      const prior = this.data.history.find(r => r.fabric === fabric && r.id === requestKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw Error('Request key already used');
        return;
      }
      if (state.sourceStatus === 1 || state.appleStatus === 1) throw Error('Metadata change already pending');
      const binding = this.binding();
      const before = await this.options.read();
      this.observe(before);
      save(this.file,this.data);
      if (expectedVersion !== state.version) throw Error('Stale metadata version');
      const patch = {};
      if (name !== undefined) {
        if (!label(name) || name === before.name) throw Error('Invalid or unchanged name');
        patch.name = name;
      }
      if (key !== undefined) {
        const room = this.rooms.find(r => r.key === key);
        if (!room || key === state.roomKey || (binding && !binding.rooms[key])) throw Error('Room has no confirmed mapping');
        patch.location = room.label;
      }
      const apple = binding && {home:binding.home,accessory:binding.accessory,room:key === undefined ? undefined : binding.rooms[key]};
      this.data.work = {id:requestKey,identity,patch,before,apple,expires:Date.now()+5*MINUTE};
      this.data.history.push({fabric,id:requestKey,fingerprint});
      Object.assign(state,{lastRequest:requestKey,version:randomUUID(),appleStatus:apple ? 1 : 4,sourceStatus:1});
      save(this.file,this.data);
      this.kick?.();
    });
  }
  async reconcile() {
    const previous = JSON.stringify(this.data);
    const binding = this.binding();
    const w = this.data.work, s = this.data.state;
    if (w && s.sourceStatus === 1) {
      try {
        let row = await this.options.read();
        const pending = Object.fromEntries(Object.entries(w.patch).filter(([k,v]) => row[k] !== v && row[k] === w.before[k]));
        if (Object.keys(pending).length && Date.now() < w.expires) {
          try { await this.options.write(pending); } catch { /* A lost reply still requires readback. */ }
          row = await this.options.read();
        }
        s.sourceStatus = outcome(Object.entries(w.patch).map(([k,v]) => row[k] === v));
        this.observe(row);
        this.options.observed(row.name,row.location);
      } catch {
        if (Date.now() >= w.expires) s.sourceStatus = 4;
      }
    }
    if (w && s.appleStatus === 1) {
      const receipt = read(join(this.exchange,'receipt.json'));
      const current = binding && binding.home === w.apple.home && binding.accessory === w.apple.accessory &&
        (!w.apple.room || binding.rooms[roomKey(w.patch.location)] === w.apple.room);
      if (!current) s.appleStatus = 4;
      else if (uuid(receipt?.id) && receipt.id.toLowerCase() === w.id.toLowerCase() && receipt.identity === w.identity && receipt.home === w.apple.home &&
        receipt.accessory === w.apple.accessory) {
        s.appleStatus = outcome([...(w.patch.name ? [receipt.name === w.patch.name] : []),
          ...(w.apple.room ? [receipt.room === w.apple.room] : [])]);
      } else if (Date.now() >= w.expires) s.appleStatus = 4;
      else save(join(this.exchange,'request.json'),{id:w.id,identity:w.identity,...w.apple,name:w.patch.name,expires:w.expires});
    }
    if (w && s.appleStatus !== 1 && s.sourceStatus !== 1) {
      this.data.work = null;
      s.version = randomUUID();
      save(join(this.exchange,'request.json'),{});
    } else if (!w) this.observe(await this.options.read());
    if (JSON.stringify(this.data) !== previous) save(this.file,this.data);
  }
  publisher(publish) {
    let stopped=false, running=false, timer, previous='';
    const tick = async () => {
      if (stopped || running) return;
      running=true;
      try {
        await this.serial(() => this.reconcile());
        const data=this.projection(), serial=JSON.stringify(data);
        if (serial !== previous) { await publish(data); previous=serial; }
      } catch { this.options.warn(); }
      finally {
        running=false;
        if (!stopped) { clearTimeout(timer); timer=setTimeout(tick,this.data.work ? 2000 : MINUTE); timer.unref(); }
      }
    };
    this.kick = () => { clearTimeout(timer); timer=setTimeout(tick,10); timer.unref(); };
    return {start:tick,stop:() => { stopped=true; clearTimeout(timer); }};
  }
}
