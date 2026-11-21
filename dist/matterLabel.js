"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matterLabel = matterLabel;
// Matter's bridged node label has a 32-byte UTF-8 limit.
function matterLabel(name) {
    let text = '';
    for (const point of name) {
        if (Buffer.byteLength(text + point) > 32) {
            break;
        }
        text += point;
    }
    return text;
}
