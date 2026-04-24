import {
    _decorator, UIRenderer, Color, UITransform, Vec3, PHYSICS_2D_PTM_RATIO,
    Material, EffectAsset, RenderData, IAssembler, BaseRenderData,
    SpriteFrame,
} from 'cc';
import { SoftBody2D } from './SoftBody2D';

const { ccclass, property, requireComponent } = _decorator;
const PPM = PHYSICS_2D_PTM_RATIO;

// b2ParticleTriad struct size in WASM (32-bit, no padding):
// indexA(4) + indexB(4) + indexC(4) + flags(4) + strength(4) +
// pa(8) + pb(8) + pc(8) + ka(4) + kb(4) + kc(4) + s(4) = 60
const TRIAD_STRUCT_SIZE = 60;

// ======================== Assembler ========================

const dynamicTriadAssembler: IAssembler = {
    createData(comp: UIRenderer): BaseRenderData {
        const renderData = (comp as SoftBody2DPolygonRender).requestRenderData();
        renderData.dataLength = 0;
        renderData.resize(0, 0);
        return renderData;
    },

    updateRenderData(comp: UIRenderer): void {
        const self = comp as SoftBody2DPolygonRender;
        const renderData = self.renderData;
        if (!renderData) return;

        if (self._dataDirty) {
            self._dataDirty = false;

            const vertCount = self._vertCount;
            const triCount = self._triCount;
            const indexCount = triCount * 3;

            if (vertCount < 3 || triCount === 0) {
                renderData.dataLength = 0;
                renderData.resize(0, 0);
                renderData.textureDirty = false;
                renderData.updateRenderData(comp, null as any);
                return;
            }

            renderData.dataLength = vertCount;
            renderData.resize(vertCount, indexCount);

            updateVertexData(self);
            dynamicTriadAssembler.updateColor!(comp);

            renderData.vertDirty = true;
        }

        renderData.updateRenderData(comp, self.spriteFrame);
    },

    updateColor(comp: UIRenderer): void {
        const self = comp as SoftBody2DPolygonRender;
        const renderData = self.renderData;
        if (!renderData) return;

        const colors = self._colors;
        if (!colors) return;

        const vData = renderData.chunk.vb;
        const stride = renderData.floatStride;

        let colorOffset = 5; // vfmt: x y z u v r g b a
        for (let i = 0; i < self._vertCount; i++, colorOffset += stride) {
            vData[colorOffset]     = colors[i * 4]     / 255;
            vData[colorOffset + 1] = colors[i * 4 + 1] / 255;
            vData[colorOffset + 2] = colors[i * 4 + 2] / 255;
            vData[colorOffset + 3] = colors[i * 4 + 3] / 255;
        }
    },

    fillBuffers(comp: UIRenderer, renderer: any): void {
        if (comp === null) return;
        const self = comp as SoftBody2DPolygonRender;
        const renderData = self.renderData;
        if (!renderData) return;

        const chunk = renderData.chunk;
        const node = comp.node as any;
        if (self._flagChangedVersion !== node.flagChangedVersion || renderData.vertDirty) {
            updateWorldVerts(self, chunk);
            renderData.vertDirty = false;
            self._flagChangedVersion = node.flagChangedVersion;
        }

        const vidOrigin = chunk.vertexOffset;
        const triCount = self._triCount;
        const indexCount = triCount * 3;

        // // Expand iData if the cumulative index offset exceeds buffer capacity
        // const meshBuffer = chunk.meshBuffer;
        // const needLength = meshBuffer.indexOffset + indexCount;
        // if (needLength > meshBuffer.iData.length) {
        //     const expansionLength = Math.max(Math.floor(needLength * 1.25), needLength);
        //     const newIData = new Uint16Array(expansionLength);
        //     newIData.set(meshBuffer.iData);
        //     meshBuffer.iData = newIData;
        // }
        // const ib = meshBuffer.iData;
        // let indexOffset = meshBuffer.indexOffset;
        // const indices = self._triadIndices;
        // for (let i = 0; i < triCount; i++) {
        //     const base = i * 3;
        //     ib[indexOffset++] = vidOrigin + indices[base];
        //     ib[indexOffset++] = vidOrigin + indices[base + 1];
        //     ib[indexOffset++] = vidOrigin + indices[base + 2];
        // }
        // meshBuffer.indexOffset += indexCount;

        // Use accessor.appendIndices (same pattern as skeleton.ts)
        if (!self._finalIndexBuf || self._finalIndexBuf.length < indexCount) {
            self._finalIndexBuf = new Uint16Array(indexCount);
        }
        const finalIndices = self._finalIndexBuf;
        const indices = self._triadIndices;
        for (let i = 0; i < triCount; i++) {
            const base = i * 3;
            finalIndices[base]     = vidOrigin + indices[base];
            finalIndices[base + 1] = vidOrigin + indices[base + 1];
            finalIndices[base + 2] = vidOrigin + indices[base + 2];
        }
        chunk.vertexAccessor.appendIndices(chunk.bufferId, new Uint16Array(finalIndices.buffer, 0, indexCount));
    },
};

function updateVertexData(comp: SoftBody2DPolygonRender): void {
    const renderData = comp.renderData;
    if (!renderData) return;

    const dataList = renderData.data;
    const positions = comp._positions;
    const vertCount = comp._vertCount;
    const node = comp.node;
    const wp = comp._worldPos;
    const lp = comp._localPos;

    for (let i = 0; i < vertCount; i++) {
        Vec3.set(wp, positions[i * 2] * PPM, positions[i * 2 + 1] * PPM, 0);
        node.inverseTransformPoint(lp, wp);
        dataList[i].x = lp.x;
        dataList[i].y = lp.y;
    }
}

function updateWorldVerts(comp: SoftBody2DPolygonRender, chunk: any): void {
    const renderData = comp.renderData;
    if (!renderData) return;

    const vData = chunk.vb;
    const dataList = renderData.data;
    const node = comp.node;
    const m = node.worldMatrix;

    const m00 = m.m00; const m01 = m.m01; const m02 = m.m02; const m03 = m.m03;
    const m04 = m.m04; const m05 = m.m05; const m06 = m.m06; const m07 = m.m07;
    const m12 = m.m12; const m13 = m.m13; const m14 = m.m14; const m15 = m.m15;

    const stride = renderData.floatStride;
    const length = comp._vertCount;
    const uvs = comp._uvs;

    for (let i = 0; i < length; ++i) {
        const curData = dataList[i];
        const x = curData.x;
        const y = curData.y;
        let rhw = m03 * x + m07 * y + m15;
        rhw = rhw ? 1 / rhw : 1;

        const offset = i * stride;
        vData[offset + 0] = (m00 * x + m04 * y + m12) * rhw;
        vData[offset + 1] = (m01 * x + m05 * y + m13) * rhw;
        vData[offset + 2] = (m02 * x + m06 * y + m14) * rhw;
        vData[offset + 3] = uvs[i * 2];
        vData[offset + 4] = uvs[i * 2 + 1];
    }
}

// ======================== Component ========================

@ccclass('SoftBody2DPolygonRender')
@requireComponent(UITransform)
export class SoftBody2DPolygonRender extends UIRenderer {

    @property({ type: SoftBody2D })
    softBody: SoftBody2D = null;

    @property({type: SpriteFrame, visible: true})
    get spriteFrame(): SpriteFrame | null { return this._spriteFrame; }
    set spriteFrame(val: SpriteFrame | null) {
        if (this._spriteFrame === val) return;
        this._spriteFrame = val;
    }
    @property({type: SpriteFrame})
    private _spriteFrame: SpriteFrame | null = null;
    
    _worldPos = new Vec3();
    _localPos = new Vec3();
    _dataDirty = false;
    _positions: Float32Array = null;
    _colors: Uint8Array = null;
    _triadIndices: Uint32Array = null;
    _finalIndexBuf: Uint16Array = null;
    _vertCount = 0;
    _triCount = 0;
    // 预分配缓冲区容量，只扩不缩
    private _vertCap = 0;
    private _triCap = 0;
    // UV 参考框：用第一帧的粒子包围盒归一化到 [0,1]
    _uvMinX = 0;
    _uvMinY = 0;
    _uvRangeX = 1;
    _uvRangeY = 1;
    _uvBoundsReady = false;
    _uvs: Float32Array = null;
    public declare _flagChangedVersion: number;

    protected _render(render: any): void {
        render.commitComp(this, this.renderData, this.spriteFrame, this._assembler, null);
    }

    protected _canRender(): boolean {
        return this._vertCount >= 3 && this._triCount > 0 && !!this.renderData && !!this._customMaterial;
    }

    update(): void {
        if (!this.softBody || !this.softBody.particleSystem) return;

        const ps = this.softBody.particleSystem;
        const globalTc = ps.GetTriadCount();

        // 用本组的粒子范围过滤，而非整个粒子系统
        const startIdx = this.softBody.groupStartIndex;
        const pc = this.softBody.groupParticleCount;

        if (pc === 0 || globalTc === 0) {
            if (this._vertCount !== 0) {
                this._vertCount = 0;
                this._triCount = 0;
                this._dataDirty = true;
                this.markForUpdateRenderData();
            }
            return;
        }

        // 容量不足时才扩容，避免每帧 new
        if (pc > this._vertCap) {
            this._positions = new Float32Array(pc * 2);
            this._colors = new Uint8Array(pc * 4);
            this._vertCap = pc;
        }
        if (globalTc > this._triCap) {
            this._triadIndices = new Uint32Array(globalTc * 3);
            this._triCap = globalTc;
        }

        // 只读本组粒子的位置和颜色
        const posPtr = Box2DWasm.getPointer(ps.GetPositionBuffer());
        const srcPositions = new Float32Array(Box2DWasm.HEAPF32.buffer, posPtr + startIdx * 2 * 4, pc * 2);
        this._positions.set(srcPositions);

        const colorPtr = Box2DWasm.getPointer(ps.GetColorBuffer());
        const srcColors = new Uint8Array(Box2DWasm.HEAPU8.buffer, colorPtr + startIdx * 4, pc * 4);
        this._colors.set(srcColors);

        // 过滤 triads：只保留三个索引都在本组范围内的，并重映射为 0-based
        const triPtr = Box2DWasm.getPointer(ps.GetTriads());
        const heap32 = Box2DWasm.HEAP32;
        const triadIndices = this._triadIndices;
        const triadStride = TRIAD_STRUCT_SIZE >>> 2;
        const baseIdx = triPtr >>> 2;
        const endIdx = startIdx + pc;
        let myTriCount = 0;

        for (let i = 0; i < globalTc; i++) {
            const base = baseIdx + i * triadStride;
            const a = heap32[base];
            const b = heap32[base + 1];
            const c = heap32[base + 2];
            if (a >= startIdx && a < endIdx &&
                b >= startIdx && b < endIdx &&
                c >= startIdx && c < endIdx) {
                const out = myTriCount * 3;
                triadIndices[out]     = a - startIdx;
                triadIndices[out + 1] = b - startIdx;
                triadIndices[out + 2] = c - startIdx;
                myTriCount++;
            }
        }

        this._vertCount = pc;
        this._triCount = myTriCount;

        // 第一帧计算粒子包围盒，作为 UV 归一化参考框
        if (!this._uvBoundsReady) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < pc; i++) {
                const px = this._positions[i * 2];
                const py = this._positions[i * 2 + 1];
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
            }
            this._uvMinX = minX;
            this._uvMinY = minY;
            this._uvRangeX = (maxX - minX) || 1;
            this._uvRangeY = (maxY - minY) || 1;
            // 用初始位置一次性计算 UV，后续不再重算
            const invX = 1 / this._uvRangeX;
            const invY = 1 / this._uvRangeY;
            const uvs = new Float32Array(pc * 2);

            // spriteFrame 在合图中的 UV 区域（无 spriteFrame 时回退到 0-1）
            const frame = this._spriteFrame;
            const fuvs = frame ? frame.uv : null;
            const minU = fuvs ? fuvs[0] : 0; // left
            const maxU = fuvs ? fuvs[2] : 1; // right
            const minV = fuvs ? fuvs[1] : 0; // bottom
            const maxV = fuvs ? fuvs[5] : 1; // top
            const rangeU = maxU - minU;
            const rangeV = maxV - minV;

            for (let i = 0; i < pc; i++) {
                const nu = (this._positions[i * 2] - minX) * invX;
                const nv = (this._positions[i * 2 + 1] - minY) * invY;
                uvs[i * 2]     = minU + nu * rangeU;
                uvs[i * 2 + 1] = minV + nv * rangeV;
            }
            this._uvs = uvs;
            this._uvBoundsReady = true;
        }
        this._dataDirty = true;
        this.markForUpdateRenderData();
    }

    protected _flushAssembler(): void {
        const assembler = dynamicTriadAssembler;

        if (this._assembler !== assembler) {
            this.destroyRenderData();
            this._assembler = assembler;
        }

        if (!this._renderData) {
            if (assembler.createData) {
                const rd = this._renderData = assembler.createData(this) as RenderData;
                rd.material = this.getRenderMaterial(0);
                this.markForUpdateRenderData();
                this._updateColor();
            }
        }
    }
}
