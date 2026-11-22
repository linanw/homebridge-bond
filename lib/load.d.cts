import type {MatterAccessory} from 'homebridge';
type Metadata = {name:string; location:string};
type Options = {
  directory:string; identity:string; initial:Metadata; locations:string[];
  read:()=>Promise<Metadata>; write:(patch:Partial<Metadata>)=>Promise<void>;
  observed:(name:string,location:string)=>void; update:(cluster:string,attrs:Record<string,unknown>)=>Promise<unknown>;
  label:(name:string)=>string; warn:()=>void;
};
declare function load():Promise<{attachFanControl:(accessory:MatterAccessory)=>void;
  preserveBridgedIdentity:(accessory:MatterAccessory, uniqueId:unknown)=>void; attachMetadata:(accessory:MatterAccessory, options:Options)=>Promise<{
  start:()=>Promise<void>; stop:()=>void;
}>}>;
export = load;
