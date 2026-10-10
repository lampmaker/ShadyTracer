/* THE RULES HERE ARE ONLY THE ONES THAT ARE ALWAYS BUGS.
   This is not a style pass and must never become one: a checker that reports things a person
   is entitled to disagree with is a checker people learn to skip, which is exactly how the
   backtick scan failed when it did not cover the scenes directory.

   no-undef is the one that earned this file. `perIterUniforms` was a const scoped to one
   iteration of the sample loop and the guide rebuild, outside that loop, reached for it -- a
   ReferenceError that fired only once guiding was switched on, which is the third bug in a row
   in this feature to hide behind a flag nothing exercised. It is valid syntax, so `node --check`
   and the import pass in check-shaders.mjs both see nothing wrong with it.

   The globals list is browser plus the few Node ones the .mjs tools use. Add to it rather than
   silencing a file: an unknown global is usually a typo, which is the whole point. */
export default [{
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: Object.fromEntries([
            // browser
            'window', 'document', 'navigator', 'console', 'performance', 'location', 'fetch',
            'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'structuredClone',
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'localStorage',
            'URL', 'Blob', 'Image', 'ImageData', 'OffscreenCanvas', 'HTMLCanvasElement',
            'ResizeObserver', 'Event', 'CustomEvent', 'AbortController', 'TextEncoder', 'TextDecoder', 'alert',
            // webgpu
            'GPUBufferUsage', 'GPUTextureUsage', 'GPUShaderStage', 'GPUMapMode', 'GPUColorWrite',
            // node, for the .mjs tools in core/test and core/check-shaders.mjs
            'process', 'globalThis',
        ].map(k => [k, 'readonly'])),
    },
    rules: {
        'no-undef': 'error',
        'no-const-assign': 'error',
        'no-dupe-keys': 'error',          // a uniform bag with the same key twice silently drops one
        'no-dupe-args': 'error',
        'no-unreachable': 'error',
        'no-self-assign': 'error',
        'no-dupe-else-if': 'error',
        'no-duplicate-case': 'error',
        'no-compare-neg-zero': 'error',
        'use-isnan': 'error',
    },
}]
