import { gzipSync } from "node:zlib"

const TAG = {
  END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6,
  BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12
}

class Writer {
  constructor() {
    this.buf = Buffer.alloc(1 << 16)
    this.n = 0
  }
  room(k) {
    if (this.n + k <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < this.n + k) cap *= 2
    const next = Buffer.alloc(cap)
    this.buf.copy(next, 0, 0, this.n)
    this.buf = next
  }
  u8(v) { this.room(1); this.buf.writeUInt8(v & 0xff, this.n); this.n += 1 }
  i16(v) { this.room(2); this.buf.writeInt16BE(v, this.n); this.n += 2 }
  i32(v) { this.room(4); this.buf.writeInt32BE(v, this.n); this.n += 4 }
  i64(v) { this.room(8); this.buf.writeBigInt64BE(BigInt(v), this.n); this.n += 8 }
  f32(v) { this.room(4); this.buf.writeFloatBE(v, this.n); this.n += 4 }
  f64(v) { this.room(8); this.buf.writeDoubleBE(v, this.n); this.n += 8 }
  str(s) {
    const b = Buffer.from(s, "utf8")
    this.i16(b.length)
    this.room(b.length)
    b.copy(this.buf, this.n)
    this.n += b.length
  }
  done() { return this.buf.subarray(0, this.n) }
}

// a plain js number cannot say whether it is an int or a double, so the
// wrappers carry the tag the file needs
export const Byte = v => ({ __tag: TAG.BYTE, v })
export const Int = v => ({ __tag: TAG.INT, v })
export const Float = v => ({ __tag: TAG.FLOAT, v })
export const Double = v => ({ __tag: TAG.DOUBLE, v })
export const List = (of, v) => ({ __tag: TAG.LIST, of, v })
export const IntArray = v => ({ __tag: TAG.INT_ARRAY, v })

function tagOf(value) {
  if (value === null || value === undefined) return null
  if (typeof value === "object" && value.__tag !== undefined) return value.__tag
  if (typeof value === "string") return TAG.STRING
  if (typeof value === "boolean") return TAG.BYTE
  if (Array.isArray(value)) return TAG.LIST
  if (typeof value === "object") return TAG.COMPOUND
  if (typeof value === "number") return Number.isInteger(value) ? TAG.INT : TAG.DOUBLE
  throw new Error("cannot write a value of type " + typeof value)
}

function payload(w, tag, value) {
  const raw = value && typeof value === "object" && value.__tag !== undefined ? value.v : value
  switch (tag) {
    case TAG.BYTE: return w.u8(typeof raw === "boolean" ? (raw ? 1 : 0) : raw)
    case TAG.SHORT: return w.i16(raw)
    case TAG.INT: return w.i32(raw)
    case TAG.LONG: return w.i64(raw)
    case TAG.FLOAT: return w.f32(raw)
    case TAG.DOUBLE: return w.f64(raw)
    case TAG.STRING: return w.str(raw)
    case TAG.BYTE_ARRAY:
      w.i32(raw.length)
      for (const b of raw) w.u8(b)
      return
    case TAG.INT_ARRAY:
      w.i32(raw.length)
      for (const i of raw) w.i32(i)
      return
    case TAG.LIST: {
      const of = value?.of ?? (raw.length ? tagOf(raw[0]) : TAG.END)
      w.u8(of)
      w.i32(raw.length)
      for (const it of raw) payload(w, of, it)
      return
    }
    case TAG.COMPOUND:
      for (const [k, v] of Object.entries(raw)) {
        if (v === undefined || v === null) continue
        const t = tagOf(v)
        w.u8(t)
        w.str(k)
        payload(w, t, v)
      }
      w.u8(TAG.END)
      return
    default: throw new Error("unsupported tag " + tag)
  }
}

export function writeNbt(root, { name = "", gzip = true } = {}) {
  const w = new Writer()
  w.u8(TAG.COMPOUND)
  w.str(name)
  payload(w, TAG.COMPOUND, root)
  const out = Buffer.from(w.done())
  return gzip ? gzipSync(out, { level: 9 }) : out
}
