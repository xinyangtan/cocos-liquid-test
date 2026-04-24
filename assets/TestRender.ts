import { _decorator, Color, UIRenderer, UITransform, InstanceMaterialType, RenderData, IAssembler, builtinResMgr, BaseRenderData, Material, SpriteFrame } from 'cc';

const { ccclass, property, executeInEditMode, requireComponent, menu } = _decorator;

// ======================== Assembler ========================
// 仿照 sprite simple assembler，渲染一个纯色矩形 quad（4顶点 + 6索引）

const QUAD_INDICES = Uint16Array.from([0, 1, 2, 1, 3, 2]);

const simpleQuadAssembler: IAssembler = {
    createData (comp: UIRenderer): BaseRenderData {
        const renderData = (comp as TestRender).requestRenderData();
        renderData.dataLength = 4;
        renderData.resize(4, 6);
        renderData.chunk.setIndexBuffer(QUAD_INDICES);
        return renderData;
    },

    updateRenderData (comp: UIRenderer): void {
        const self = comp as TestRender;
        const renderData = self.renderData;
        if (!renderData) return;

        if (renderData.vertDirty) {
            updateVertexData(self);
        }

        // 纯色渲染不需要 texture/frame
        renderData.textureDirty = false;
        renderData.updateRenderData(comp, null as any);
    },

    updateColor (comp: UIRenderer): void {
        const self = comp as TestRender;
        const renderData = self.renderData;
        if (!renderData) return;

        const vData = renderData.chunk.vb;
        const stride = renderData.floatStride;
        const color = comp.color;
        const colorR = color.r / 255;
        const colorG = color.g / 255;
        const colorB = color.b / 255;
        const colorA = color.a / 255;

        let colorOffset = 5; // vfmt: x(0) y(1) z(2) u(3) v(4) r(5) g(6) b(7) a(8)
        for (let i = 0; i < 4; i++, colorOffset += stride) {
            vData[colorOffset]     = colorR;
            vData[colorOffset + 1] = colorG;
            vData[colorOffset + 2] = colorB;
            vData[colorOffset + 3] = colorA;
        }
    },

    fillBuffers (comp: UIRenderer, renderer: any): void {
        if (comp === null) return;
        const self = comp as TestRender;
        const renderData = self.renderData;
        if (!renderData) return;

        const chunk = renderData.chunk;

        // 变换脏时重新计算世界坐标顶点
        const node = comp.node as any;
        if (self._flagChangedVersion !== node.flagChangedVersion || renderData.vertDirty) {
            updateWorldVerts(self, chunk);
            renderData.vertDirty = false;
            self._flagChangedVersion = node.flagChangedVersion;
        }

        // 写入索引缓冲
        const vidOrigin = chunk.vertexOffset;
        const meshBuffer = chunk.meshBuffer;
        const ib = meshBuffer.iData;
        let indexOffset = meshBuffer.indexOffset;
        const vid = vidOrigin;

        // 两个三角形组成一个矩形
        ib[indexOffset++] = vid;
        ib[indexOffset++] = vid + 1;
        ib[indexOffset++] = vid + 2;

        ib[indexOffset++] = vid + 1;
        ib[indexOffset++] = vid + 3;
        ib[indexOffset++] = vid + 2;

        meshBuffer.indexOffset += 6;
    },
};

function updateVertexData (comp: TestRender): void {
    const renderData = comp.renderData;
    if (!renderData) return;

    const uiTrans = (comp.node as any)._getUITransformComp()! as UITransform;
    const dataList = renderData.data;
    const cw = uiTrans.width;
    const ch = uiTrans.height;
    const appX = uiTrans.anchorX * cw;
    const appY = uiTrans.anchorY * ch;

    const l = -appX;
    const b = -appY;
    const r = cw - appX;
    const t = ch - appY;

    // left-bottom
    dataList[0].x = l;
    dataList[0].y = b;

    // right-bottom
    dataList[1].x = r;
    dataList[1].y = b;

    // left-top
    dataList[2].x = l;
    dataList[2].y = t;

    // right-top
    dataList[3].x = r;
    dataList[3].y = t;

    renderData.vertDirty = true;
}

function updateWorldVerts (comp: TestRender, chunk: any): void {
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
    let offset = 0;
    const length = dataList.length;

    for (let i = 0; i < length; ++i) {
        const curData = dataList[i];
        const x = curData.x;
        const y = curData.y;
        let rhw = m03 * x + m07 * y + m15;
        rhw = rhw ? 1 / rhw : 1;

        offset = i * stride;
        vData[offset + 0] = (m00 * x + m04 * y + m12) * rhw;
        vData[offset + 1] = (m01 * x + m05 * y + m13) * rhw;
        vData[offset + 2] = (m02 * x + m06 * y + m14) * rhw;
    }
}

// ======================== Component ========================

@ccclass('TestRender')
@requireComponent(UITransform)
@executeInEditMode
@menu('Test/TestRender')
export class TestRender extends UIRenderer {


    @property({type: SpriteFrame, visible: true})
    spriteFrame: SpriteFrame | null = null;
    
    @property
    get testColor (): Readonly<Color> {
        return this._testColor;
    }
    set testColor (value: Color) {
        if (this._testColor.equals(value)) return;
        this._testColor.set(value);
        this.color = value;
    }

    @property
    protected _testColor: Color = new Color(255, 0, 0, 255);

    // 暴露给 assembler 使用（不在 d.ts 中声明，用 any 绕过）
    public declare _flagChangedVersion: number;

    constructor () {
        super();
        // 使用只有颜色的材质，不需要纹理
        this._instanceMaterialType = InstanceMaterialType.ADD_COLOR;
    }

    // ---- lifecycle ----

    public __preload (): void {
        super.__preload();
    }

    public onEnable (): void {
        super.onEnable();
        this._activateMaterial();
    }

    // ---- render ----

    protected _render (render: any): void {
        // 纯色不需要 spriteFrame，传 null
        render.commitComp(this, this.renderData, this.spriteFrame, this._assembler!, null);
    }

    protected _canRender (): boolean {
        if (!super._canRender()) return false;
        return true;
    }

    protected _flushAssembler (): void {
        const assembler = simpleQuadAssembler;

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

    protected _updateBuiltinMaterial (): Material {
        // 使用 ui-base-material（纯色材质，无纹理）
        return builtinResMgr.get('ui-base-material');
    }

    private _activateMaterial (): void {
        const material = this.getRenderMaterial(0);
        if (material) {
            this.markForUpdateRenderData();
        }
        if (this.renderData) {
            this.renderData.material = material;
        }
    }
}
