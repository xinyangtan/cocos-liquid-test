declare namespace Box2DWasm {
    // HEAPF32 access — must be a getter because WASM memory can grow (reallocate),
    // which detaches the old ArrayBuffer. Reading from the module each time ensures
    // we always get the current view.
    const HEAP8: Int8Array
    const HEAP16: Int16Array
    const HEAP32: Int32Array
    const HEAPF32: Float32Array
    const HEAPF64: Float64Array
    const HEAPU8: Uint8Array
    const HEAPU16: Uint16Array
    const HEAPU32: Uint32Array
}
