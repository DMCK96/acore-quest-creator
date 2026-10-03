// @ts-nocheck
// From @wowserhq/format 0.28.0 (MIT, Wowser Contributors); see ../../LICENSE.
import { IoMode, openStream } from '@wowserhq/io';
import { indexChunks } from '../util.js';
import * as groupIo from './io/group.js';
import { MAP_OBJ_FLAG, MAP_OBJ_GROUP_FLAG } from './const.js';
class MapObjGroup {
    #version = 17;
    #objFlags = 0x0;
    #batches = [];
    #indices;
    #normals;
    #textureCoords;
    #colors;
    #vertices;
    constructor(objFlags) {
        this.#objFlags = objFlags;
    }
    get batches() {
        return this.#batches;
    }
    get colors() {
        return this.#colors;
    }
    get indices() {
        return this.#indices;
    }
    get normals() {
        return this.#normals;
    }
    get textureCoords() {
        return this.#textureCoords;
    }
    get version() {
        return this.#version;
    }
    get vertices() {
        return this.#vertices;
    }
    load(source) {
        const stream = openStream(source, IoMode.Read);
        const group = groupIo.group.read(stream);
        stream.close();
        const data = indexChunks(group);
        const versionChunk = data.get('MVER');
        if (versionChunk) {
            if (versionChunk.version !== 17) {
                throw new Error(`Unsupported WMO version: ${versionChunk.version}`);
            }
            this.#version = versionChunk.version;
        }
        const { header: groupHeader, data: groupChunks } = data.get('MOGP');
        const groupData = indexChunks(groupChunks);
        const batchesChunk = groupData.get('MOBA');
        if (batchesChunk) {
            this.#batches = batchesChunk;
        }
        const indicesChunk = groupData.get('MOVI');
        if (indicesChunk) {
            this.#indices = indicesChunk;
        }
        const normalsChunk = groupData.get('MONR');
        if (normalsChunk) {
            this.#normals = normalsChunk;
        }
        const textureCoordsChunk = groupData.get('MOTV');
        if (textureCoordsChunk) {
            this.#textureCoords = textureCoordsChunk;
        }
        const colorsChunk = groupData.get('MOCV');
        if (colorsChunk) {
            this.#colors = colorsChunk;
            if (!(this.#objFlags & MAP_OBJ_FLAG.FLAG_CVERTS_FIXED)) {
                this.#fixColors(groupHeader);
            }
        }
        const verticesChunk = groupData.get('MOVT');
        if (verticesChunk) {
            this.#vertices = verticesChunk;
        }
        return this;
    }
    #fixColors(header) {
        const intBatchStart = header.transBatchCount > 0 ? this.#batches[header.transBatchCount].lastVertex + 1 : 0;
        for (let i = 0; i < this.#colors.length / 4; i++) {
            const colorOfs = i * 4;
            if (i >= intBatchStart) {
                // Int / ext batches
                let r = this.#colors[colorOfs + 2];
                let g = this.#colors[colorOfs + 1];
                let b = this.#colors[colorOfs + 0];
                let a = this.#colors[colorOfs + 3];
                r += ((r * a) / 64) | 0;
                g += ((g * a) / 64) | 0;
                b += ((b * a) / 64) | 0;
                r = Math.min((r / 2) | 0, 255);
                g = Math.min((g / 2) | 0, 255);
                b = Math.min((b / 2) | 0, 255);
                a = 255;
                this.#colors[colorOfs + 2] = r;
                this.#colors[colorOfs + 1] = g;
                this.#colors[colorOfs + 0] = b;
                this.#colors[colorOfs + 3] = a;
            }
            else {
                // Trans batches
                let r = this.#colors[colorOfs + 2];
                let g = this.#colors[colorOfs + 1];
                let b = this.#colors[colorOfs + 0];
                r = (r / 2) | 0;
                g = (g / 2) | 0;
                b = (b / 2) | 0;
                this.#colors[colorOfs + 2] = r;
                this.#colors[colorOfs + 1] = g;
                this.#colors[colorOfs + 0] = b;
            }
        }
    }
}
export default MapObjGroup;
export { MapObjGroup, MAP_OBJ_GROUP_FLAG };
