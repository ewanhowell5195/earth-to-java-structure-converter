import fs from "node:fs"
import { doorState } from "./blocks.js"

const read = f => fs.readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8")

const solid = new Set(JSON.parse(read("solid-blocks.json")))
const connections = JSON.parse(read("connections.json"))
const SIDES = connections.sides
const REDSTONE = new Set(connections.redstone)

const strip = n => (n ?? "").replace(/^minecraft:/, "")

// java refuses to let fences, walls and panes attach to these even though they are full cubes
const NO_CONNECT = /(_leaves|_shulker_box)$|^(barrier|carved_pumpkin|jack_o_lantern|melon|pumpkin|shulker_box)$/
const attachable = id => solid.has(id) && !NO_CONNECT.test(id)

const isFence = id => id.endsWith("_fence")
const isGate = id => id.endsWith("_fence_gate")
const isWall = id => id.endsWith("_wall") && !id.endsWith("_wall_sign") && !id.endsWith("_wall_banner")
const isPane = id => id.endsWith("_pane") || id === "iron_bars"
const isStairs = c => !!c && strip(c.st[0]).endsWith("_stairs")
const isLog = id => id.endsWith("_log") || id.endsWith("_wood") || id.endsWith("_hyphae")
  || id === "crimson_stem" || id === "warped_stem"
const fenceKind = id => id === "nether_brick_fence" ? "nether" : "wood"

const OPPOSITE = { north: "south", south: "north", west: "east", east: "west" }
const CLOCKWISE = { north: "east", east: "south", south: "west", west: "north" }
const COUNTER = { north: "west", west: "south", south: "east", east: "north" }
const OFFSET = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] }
const AROUND = [[0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]
const axisOf = f => f === "north" || f === "south" ? "z" : "x"

const SNOW = new Set(["snow", "snow_block", "powder_snow"])
const SNOWY = new Set(["grass_block", "podzol", "mycelium"])

// a gate only joins a fence line when it faces across it
const gateAcross = (props, axis) => {
  const f = props?.facing
  return axis === "x" ? f === "north" || f === "south" : f === "east" || f === "west"
}

const redstoneSide = id => REDSTONE.has(id) || id.endsWith("_button") || id.endsWith("_pressure_plate")

// legacy data never stored which way these blocks join up, java works it out from the neighbours instead
export function connectCells(cells) {
  const at = new Map()
  for (const c of cells) at.set(`${c.x},${c.y},${c.z}`, c)
  const nb = (c, dx, dy, dz) => at.get(`${c.x + dx},${c.y + dy},${c.z + dz}`)
  const rel = (c, dir) => nb(c, ...OFFSET[dir])

  // java's own rule from StairBlock.getStairsShape
  function stairShape(c) {
    const { facing, half } = c.st[1]
    const same = n => isStairs(n) && n.st[1].half === half
    const canTake = dir => {
      const n = rel(c, dir)
      return !isStairs(n) || n.st[1].facing !== facing || n.st[1].half !== half
    }
    const behind = rel(c, facing)
    if (same(behind)) {
      const f = behind.st[1].facing
      if (axisOf(f) !== axisOf(facing) && canTake(OPPOSITE[f])) return f === COUNTER[facing] ? "outer_left" : "outer_right"
    }
    const front = rel(c, OPPOSITE[facing])
    if (same(front)) {
      const f = front.st[1].facing
      if (axisOf(f) !== axisOf(facing) && canTake(f)) return f === COUNTER[facing] ? "inner_left" : "inner_right"
    }
    return "straight"
  }

  let changed = 0
  for (const c of cells) {
    const id = strip(c.st[0])
    const props = c.st[1]

    if (isFence(id)) {
      const kind = fenceKind(id)
      const next = { ...(props ?? {}) }
      for (const [side, dx, dy, dz] of SIDES) {
        const n = nb(c, dx, dy, dz)
        if (!n) { next[side] = "false"; continue }
        const nid = strip(n.st[0])
        const axis = dx ? "x" : "z"
        next[side] = String(
          attachable(nid)
          || (isFence(nid) && fenceKind(nid) === kind)
          || (isGate(nid) && gateAcross(n.st[1], axis))
          || isWall(nid))
      }
      c.st = [c.st[0], next]
      changed++
      continue
    }

    if (isWall(id)) {
      const next = { ...(props ?? {}) }
      let joins = 0
      const on = {}
      for (const [side, dx, dy, dz] of SIDES) {
        const n = nb(c, dx, dy, dz)
        const nid = n ? strip(n.st[0]) : null
        const axis = dx ? "x" : "z"
        const touch = !!nid && (attachable(nid) || isWall(nid) || isPane(nid)
          || isFence(nid) || (isGate(nid) && gateAcross(n.st[1], axis)))
        on[side] = touch
        if (touch) joins++
        next[side] = touch ? "low" : "none"
      }
      const above = nb(c, 0, 1, 0)
      const straight = joins === 2 && ((on.north && on.south) || (on.east && on.west))
      next.up = String(!straight || (!!above && !isWall(strip(above.st[0]))))
      c.st = [c.st[0], next]
      changed++
      continue
    }

    if (isPane(id)) {
      const next = { ...(props ?? {}) }
      for (const [side, dx, dy, dz] of SIDES) {
        const n = nb(c, dx, dy, dz)
        const nid = n ? strip(n.st[0]) : null
        next[side] = String(!!nid && (attachable(nid) || isPane(nid) || isWall(nid)))
      }
      c.st = [c.st[0], next]
      changed++
      continue
    }

    if (isStairs(c)) {
      c.st = [c.st[0], { ...props, shape: stairShape(c) }]
      changed++
      continue
    }

    // java pairs a chest with the neighbour on its clockwise side as the left
    // half, the other one becomes the right
    if (id === "chest" || id === "trapped_chest") {
      const single = n => (n.st[1]?.type ?? "single") === "single"
      if (!single(c)) continue
      const facing = props?.facing ?? "north"
      c.st = [c.st[0], { ...props, facing, type: "single" }]
      for (const [dir, type, other] of [[CLOCKWISE[facing], "left", "right"], [COUNTER[facing], "right", "left"]]) {
        const n = rel(c, dir)
        if (!n || strip(n.st[0]) !== id || (n.st[1]?.facing ?? "north") !== facing || !single(n)) continue
        c.st = [c.st[0], { ...props, facing, type }]
        n.st = [n.st[0], { ...n.st[1], facing, type: other }]
        break
      }
      changed++
      continue
    }

    if (SNOWY.has(id)) {
      const above = nb(c, 0, 1, 0)
      c.st = [c.st[0], { ...props, snowy: String(!!above && SNOW.has(strip(above.st[0]))) }]
      changed++
      continue
    }

    if (id === "tripwire") {
      const next = { ...props }
      for (const [side, dx, dy, dz] of SIDES) {
        const n = nb(c, dx, dy, dz)
        const nid = n ? strip(n.st[0]) : null
        next[side] = String(nid === "tripwire" || (nid === "tripwire_hook" && n.st[1]?.facing === OPPOSITE[side]))
      }
      c.st = [c.st[0], next]
      changed++
      continue
    }

    if (id === "redstone_wire") {
      const next = { ...(props ?? {}) }
      const overhead = nb(c, 0, 1, 0)
      const covered = !!overhead && solid.has(strip(overhead.st[0]))
      for (const [side, dx, dy, dz] of SIDES) {
        const n = nb(c, dx, dy, dz)
        const nid = n ? strip(n.st[0]) : null
        if (nid && redstoneSide(nid)) { next[side] = "side"; continue }
        // wire climbs a solid neighbour, or drops down the side of a gap
        const up = nb(c, dx, 1, dz)
        if (nid && solid.has(nid) && up && strip(up.st[0]) === "redstone_wire" && !covered) {
          next[side] = "up"
          continue
        }
        const down = nb(c, dx, -1, dz)
        if ((!nid || !solid.has(nid)) && down && strip(down.st[0]) === "redstone_wire") {
          next[side] = "side"
          continue
        }
        next[side] = "none"
      }
      c.st = [c.st[0], next]
      changed++
      continue
    }

    if (id.endsWith("_door") && c.data !== undefined) {
      const [half, own] = doorState(c.data)
      const other = nb(c, 0, half === "upper" ? -1 : 1, 0)
      const paired = other && strip(other.st[0]) === id && other.data !== undefined
        ? doorState(other.data)[1]
        : {}
      c.st = [c.st[0], {
        facing: (half === "upper" ? paired.facing : own.facing) ?? "north",
        half,
        hinge: (half === "upper" ? own.hinge : paired.hinge) ?? "left",
        open: (half === "upper" ? paired.open : own.open) ?? "false",
        powered: "false"
      }]
      changed++
      continue
    }

    if (id === "vine") {
      // a vine above is what it hangs from, not a ceiling
      const above = nb(c, 0, 1, 0)
      const aid = above ? strip(above.st[0]) : null
      const sides = ["north", "south", "east", "west"].some(s => props?.[s] === "true")
      c.st = [c.st[0], { ...props, up: String((!!aid && solid.has(aid)) || !sides) }]
      changed++
    }
  }

  // java counts each leaf's distance from the nearest log, 7 means none
  const leaves = cells.filter(c => strip(c.st[0]).endsWith("_leaves"))
  if (leaves.length) {
    const dist = new Map()
    let frontier = cells.filter(c => isLog(strip(c.st[0])))
    for (let d = 1; d < 7 && frontier.length; d++) {
      const next = []
      for (const c of frontier) for (const [dx, dy, dz] of AROUND) {
        const n = nb(c, dx, dy, dz)
        if (n && !dist.has(n) && strip(n.st[0]).endsWith("_leaves")) {
          dist.set(n, d)
          next.push(n)
        }
      }
      frontier = next
    }
    for (const c of leaves) {
      c.st = [c.st[0], { ...c.st[1], distance: String(dist.get(c) ?? 7) }]
      changed++
    }
  }
  return changed
}
