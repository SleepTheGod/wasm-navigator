# wasm-navigator

**JavaScriptCore arbitrary read/write primitive using NaN-boxing type confusion + dual WebAssembly instance global corruption**

This is a consolidated, self-contained implementation of a JSC memory access primitive originally inspired by various WebKit exploit techniques (circa 2023–2025 era). It combines:

- NaN-boxing / structure ID confusion to leak structure IDs and compute NaN offset correction
- Fake object injection via butterfly transplantation
- Dual WebAssembly instance trick to corrupt global storage pointers for arb r/w without array bounds
- Comprehensive memory API (32/64-bit r/w, addrof, backing store leak, string readers, bulk copy, forged call primitive, etc.)
- PAC-aware pointer handling for arm64e platforms (iOS/macOS)

**⚠️ For educational and security research purposes only. Do not run against production browsers or systems without explicit authorization.**

## Features

- 32-bit & 64-bit arbitrary read/write
- `addrof()` via reference cell
- TypedArray backing store pointer leak
- Null-terminated & wide-char string reading
- Memory fill/copy/hexdump helpers
- Temporary forged-argument function calling (`Pr()`)
- Persistent read/write channel via fakeobj + WASM globals

## Usage

```js
// 1. You still need a working NaN-boxing trigger + structureID leak
//    (not included here — plug your own confusion primitive)

// 2. Instantiate
const p = new P();

// 3. Perform cross-instance corruption (redirects navigator globals → executor)
p.corruptCrossInstance();

// 4. Use the API
console.log("Reading 32-bit at 0x10000000:", p.rr(0x10000000));
p.sr(0x10000000, 0x41414141);

const objAddr = p.ne({a:1, b:2});
console.log("Object address:", objAddr.toString(16));

const str = p.lr({toString: () => "hello from memory"}, 100);
console.log("Leaked string:", str);
```

## Important Notes

- The WASM binary bytes are **placeholder** — you must replace `wasmBytes` with a real module that exports `a,b,c,d` with the exact behavior described (globals manipulation).
- Offsets (`FSCw9f`, `VMMcyp`, backing store offset `0x20`, etc.) are **symbolic/example values**. They change per WebKit build. You need runtime offset discovery or per-version hardcoding.
- `this.ne()` (addrof) is **fake** — it assumes a reference cell at `this.Ur`. Replace with your real addrof primitive.
- NaN offset correction (`T.Dn.Mn`) is set via `parseConfusion()` — call it after your confusion trigger.
- This exact WASM global corruption technique was nerfed/hardened in late 2025 WebKit builds. For latest Safari/iOS you may need to pivot to TypedArray backing store confusion or WASM linear memory corruption.

## Legal / Ethical Warning

This code demonstrates techniques that can be used to achieve memory read/write in WebKit browsers.  
Use **only** in controlled research environments, CTF challenges, or when you have explicit permission to test target systems.  
Misuse may violate laws (CFAA, DMCA, local computer fraud/abuse statutes, etc.).

## Credits / Inspiration

Updated Logic From https://github.com/rationalpsyche/Talks/
- Various public WebKit exploit write-ups (2022–2025)
- Techniques seen in Pwn2Own / real-world WebKit chains
- The legendary "navigator + executor" dual-instance pattern

Stay dangerous.  
— SleepTheGod & friends

```
