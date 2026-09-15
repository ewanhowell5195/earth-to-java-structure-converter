#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { writeNbt, Byte, Int, Float, Double, List, IntArray } from "./lib/nbt.js"
import { makeMapper, EARTH_BLOCKS, applyBlockEntity, javaEntity } from "./lib/blocks.js"
import { connectCells } from "./lib/connect.js"

const HELP = `
convert minecraft earth buildplates to java structure (.nbt) files

  earth-to-java-structure-converter <input> [output] [options]

  <input>    a plate json, or a directory searched recursively
  [output]   directory to write into, default "converted"

options
  --placeholder <block>  stands in for anything with no java equivalent,
                         default dirt
  --constraint <block>   earth's containment shell, left out by default. it was
                         a solid floor and wall that hid anything behind it,
                         "barrier" is the closest java has
`.trim()

const args = process.argv.slice(2)
if (!args.length || args.includes("-h") || args.includes("--help")) {
  console.log(HELP)
  process.exit(args.length ? 0 : 1)
}

const VALUED = ["--placeholder", "--constraint"]
const opt = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i < 0 ? fallback : args[i + 1]
}
const positional = args.filter((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]))

const input = positional[0]
const outDir = positional[1] ?? "converted"
const placeholder = opt("--placeholder", "dirt")
const constraint = opt("--constraint", "none")
// 26.2, newer versions auto convert on load
const DATA_VERSION = 4903

if (!input || !fs.existsSync(input)) {
  console.error("input not found: " + input)
  process.exit(1)
}

const earth = { ...EARTH_BLOCKS }
for (const k of ["invisible_constraint", "border_constraint", "blend_constraint"]) {
  earth[k] = constraint === "none" || constraint === "air" ? null : constraint
}

const mapper = makeMapper({ placeholder, earth })

// java's Facing byte uses the legacy direction ids
const FRAME_FACING = [5, 4, 3, 2]

function listInputs(p) {
  if (fs.statSync(p).isFile()) return [p]
  return fs.readdirSync(p, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? listInputs(path.join(p, e.name))
      : e.name.endsWith(".json") ? [path.join(p, e.name)] : [])
}

// some dumps repeat a fragment of the object after it, so only the first value
// is read and the rest of the text ignored
function readPlate(file) {
  const text = fs.readFileSync(file, "utf8")
  try {
    return JSON.parse(text)
  } catch {
    let depth = 0, inStr = false, esc = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === "\\") esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === "{") depth++
      else if (c === "}" && --depth === 0) return JSON.parse(text.slice(0, i + 1))
    }
    throw new Error("not json")
  }
}

function convert(file) {
  const plate = readPlate(file)
  if (typeof plate.model !== "string") return null
  const model = JSON.parse(Buffer.from(plate.model, "base64").toString("utf8"))
  const chunks = model.sub_chunks ?? []
  if (!chunks.length) return null

  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (const sc of chunks) {
    const px = sc.position.x * 16, py = sc.position.y * 16, pz = sc.position.z * 16
    if (px < x0) x0 = px
    if (py < y0) y0 = py
    if (pz < z0) z0 = pz
    if (px + 15 > x1) x1 = px + 15
    if (py + 15 > y1) y1 = py + 15
    if (pz + 15 > z1) z1 = pz + 15
  }

  const beAt = new Map()
  for (const be of model.blockEntities ?? []) {
    const q = be.position
    if (q) beAt.set(`${q.x},${q.y},${q.z}`, be)
  }

  const cells = []
  const airCells = []
  const frames = []
  let beUsed = 0
  let tx0 = Infinity, ty0 = Infinity, tz0 = Infinity, tx1 = -Infinity, ty1 = -Infinity, tz1 = -Infinity
  for (const sc of chunks) {
    const rawData = sc.block_palette.map(p => p.data ?? 0)
    const isFrame = sc.block_palette.map(p => p.name.replace(/^minecraft:/, "") === "frame")
    const resolved = sc.block_palette.map((p, i) => isFrame[i] ? null : mapper.get(p.name, p.data ?? 0))
    const px = sc.position.x * 16 - x0, py = sc.position.y * 16 - y0, pz = sc.position.z * 16 - z0
    const raw = sc.blocks
    // a sub chunk runs x, then y, then z, with z varying fastest
    for (let i = 0; i < raw.length; i++) {
      let st = resolved[raw[i]]
      if (st === null && !isFrame[raw[i]]) continue
      const x = (i >> 8) + px, y = ((i >> 4) & 15) + py, z = (i & 15) + pz
      if (isFrame[raw[i]]) {
        frames.push({ x, y, z, facing: FRAME_FACING[rawData[raw[i]] & 3] })
        airCells.push({ x, y, z })
        continue
      }
      if (st[0] === "minecraft:air") {
        airCells.push({ x, y, z })
        continue
      }
      const be = beAt.get(`${x + x0},${y + y0},${z + z0}`)
      if (be) {
        const swapped = applyBlockEntity(st, be)
        if (swapped !== st) { st = swapped; beUsed++ }
      }
      if (x < tx0) tx0 = x
      if (y < ty0) ty0 = y
      if (z < tz0) tz0 = z
      if (x > tx1) tx1 = x
      if (y > ty1) ty1 = y
      if (z > tz1) tz1 = z
      cells.push({ x, y, z, st, data: rawData[raw[i]] })
    }
  }

  connectCells(cells)

  const palette = []
  const paletteIndex = new Map()
  const stateFor = st => {
    const key = st[0] + "|" + (st[1] ? JSON.stringify(st[1]) : "")
    let i = paletteIndex.get(key)
    if (i === undefined) {
      i = palette.length
      paletteIndex.set(key, i)
      palette.push(st[1] ? { Name: st[0], Properties: st[1] } : { Name: st[0] })
    }
    return i
  }

  const shift = cells.length > 0
  const ox = shift ? tx0 : 0, oy = shift ? ty0 : 0, oz = shift ? tz0 : 0
  const sx = shift ? tx1 - tx0 + 1 : x1 - x0 + 1
  const sy = shift ? ty1 - ty0 + 1 : y1 - y0 + 1
  const sz = shift ? tz1 - tz0 + 1 : z1 - z0 + 1

  const entities = []
  let entDropped = 0
  for (const e of model.entities ?? []) {
    const mob = javaEntity(e.name ?? "")
    if (!mob || !e.position) { entDropped++; continue }
    const ex = e.position.x - x0 - ox, ey = e.position.y - y0 - oy, ez = e.position.z - z0 - oz
    const pos = List(6, [Double(ex), Double(ey), Double(ez)])
    entities.push({
      pos,
      blockPos: List(3, [Int(Math.floor(ex)), Int(Math.floor(ey)), Int(Math.floor(ez))]),
      nbt: {
        id: mob.id,
        Pos: pos,
        Rotation: List(5, [Float(e.rotation?.y ?? 0), Float(e.rotation?.x ?? 0)]),
        CustomName: mob.label ?? undefined,
        CustomNameVisible: mob.label ? Byte(1) : undefined
      }
    })
  }

  for (const f of frames) {
    const fx = f.x - ox, fy = f.y - oy, fz = f.z - oz
    const pos = List(6, [Double(fx + 0.5), Double(fy + 0.5), Double(fz + 0.5)])
    entities.push({
      pos,
      blockPos: List(3, [Int(fx), Int(fy), Int(fz)]),
      nbt: {
        id: "minecraft:item_frame",
        Pos: pos,
        Facing: Byte(f.facing),
        block_pos: IntArray([fx, fy, fz])
      }
    })
  }

  const blockList = cells.map(c => ({
    pos: List(3, [Int(c.x - ox), Int(c.y - oy), Int(c.z - oz)]),
    state: Int(stateFor(c.st))
  }))
  for (const a of airCells) {
    if (a.x < ox || a.y < oy || a.z < oz || a.x >= ox + sx || a.y >= oy + sy || a.z >= oz + sz) continue
    blockList.push({
      pos: List(3, [Int(a.x - ox), Int(a.y - oy), Int(a.z - oz)]),
      state: Int(stateFor(["minecraft:air"]))
    })
  }

  return {
    nbt: writeNbt({
      DataVersion: Int(DATA_VERSION),
      size: List(3, [Int(sx), Int(sy), Int(sz)]),
      palette,
      blocks: blockList,
      entities: List(10, entities)
    }),
    name: model.name ?? null,
    size: [sx, sy, sz],
    blocks: cells.length,
    states: palette.length,
    entities: entities.length,
    entDropped,
    beUsed
  }
}

const files = listInputs(input)
if (!files.length) {
  console.error("no json files found in " + input)
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })

let ok = 0, failed = 0, blocks = 0, ents = 0, entDropped = 0, beUsed = 0
for (const file of files) {
  let res
  try {
    res = convert(file)
  } catch (err) {
    failed++
    console.error(`  failed  ${path.basename(file)}: ${err.message}`)
    continue
  }
  if (!res) {
    failed++
    console.error(`  skipped ${path.basename(file)}: no sub_chunks`)
    continue
  }
  fs.writeFileSync(path.join(outDir, path.basename(file, ".json") + ".nbt"), res.nbt)
  ok++
  blocks += res.blocks
  ents += res.entities
  entDropped += res.entDropped
  beUsed += res.beUsed
  const label = res.name ? ` "${res.name}"` : ""
  console.log(`  ${path.basename(file, ".json")}${label}  ${res.size.join("x")}  `
    + `${res.blocks.toLocaleString()} blocks  ${res.states} states  ${res.entities} entities`)
}

console.log(`\nconverted ${ok} of ${files.length} plates into ${outDir}`)
console.log(`  ${blocks.toLocaleString()} blocks`)
console.log(`  ${ents.toLocaleString()} entities`)
if (beUsed) console.log(`  ${beUsed.toLocaleString()} blocks taken from block entities`)
if (entDropped) console.log(`  ${entDropped} entities dropped`)
if (failed) console.log(`  ${failed} failed`)

const earthSeen = Array.from(mapper.stats.earth.entries()).sort((a, b) => b[1].states - a[1].states)
if (earthSeen.length) {
  console.log("\nearth blocks replaced:")
  for (const [name, { states, to }] of earthSeen) {
    const shown = Array.from(to, t => t ?? "left out").join(", ")
    console.log(`  ${name} -> ${shown}  (${states} states)`)
  }
}

const unknown = Array.from(mapper.stats.unknown.entries()).sort((a, b) => b[1] - a[1])
if (unknown.length) {
  console.log(`\nno java equivalent, replaced with ${placeholder}:`)
  for (const [name, n] of unknown) console.log(`  ${name}  (${n})`)
} else {
  console.log("\nevery block mapped to a real java block")
}
