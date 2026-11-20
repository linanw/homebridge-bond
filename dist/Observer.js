"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Observer = void 0;
class Observer {
    static set(characteristic, set) {
        characteristic
            .onSet(async (value) => {
            // Avoid doing anything when the device is in the requested state
            if (value === characteristic.value) {
                return;
            }
            await set(value);
        });
    }
}
exports.Observer = Observer;
