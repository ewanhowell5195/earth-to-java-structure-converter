import fs from "node:fs"

const read = f => fs.readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8")

// mojang's own 1.13 flattening map, keyed by legacy id * 16 + data. bedrock
// still writes the pre-flattening name and data, so resolving a name to its
// legacy id makes that map do the rest
const legacyStates = JSON.parse(read("legacy-states.json"))
const LEGACY_ID = JSON.parse(read("legacy-ids.json"))
const javaBlocks = new Set(JSON.parse(read("java-blocks.json")))
const javaEntities = new Set(JSON.parse(read("java-entities.json")))

const values = JSON.parse(read("state-values.json"))
const STAIR_FACING = values.stairFacing
const TRAPDOOR_FACING = values.trapdoorFacing
const BUTTON_FACE = values.buttonFace
const WOOD = values.wood
const DOUBLE_PLANT = values.doublePlant
const DOOR_FACING = values.doorFacing
const DIRECTION = values.direction
const AXIS = values.axis
const SLAB_TYPES = values.slabTypes
const FACING_4 = values.facing
const WALL_TYPES = values.wallTypes
const SANDSTONE_TYPES = values.sandstoneTypes
const RED_FLOWER = values.redFlower
const RAIL_SHAPE = values.railShape
const QUARTZ = values.quartz

const RENAMED = JSON.parse(read("renamed-blocks.json"))
const BEDROCK_NAME = JSON.parse(read("bedrock-names.json"))
export const EARTH_BLOCKS = JSON.parse(read("earth-blocks.json"))

const blockEntities = JSON.parse(read("block-entities.json"))
const BED_COLOURS = blockEntities.bedColours
const POTTED = blockEntities.potted

const mobs = JSON.parse(read("entities.json"))
const ENTITY_NEAR = mobs.near
const LABEL = mobs.labels
const RENAMED_MOB = new Set(mobs.sameMob)

const strip = n => (n ?? "").replace(/^minecraft:/, "")

// java never gave these a legacy id, so they resolve straight to a state.
// null means the block has no java form at all
const DIRECT = {
  grass: () => ["minecraft:grass_block", { snowy: "false" }],
  grass_path: () => ["minecraft:dirt_path"],
  podzol: () => ["minecraft:podzol", { snowy: "false" }],
  beetroot: d => ["minecraft:beetroots", { age: String([0, 0, 1, 1, 2, 2, 3, 3][d & 7]) }],
  flowing_mud: () => ["minecraft:mud"],
  mud: () => ["minecraft:mud"],
  web: () => ["minecraft:cobweb"],
  waterlily: () => ["minecraft:lily_pad"],
  melon_block: () => ["minecraft:melon"],
  brick_block: () => ["minecraft:bricks"],
  hardened_clay: () => ["minecraft:terracotta"],
  noteblock: () => ["minecraft:note_block", { note: "0", instrument: "harp", powered: "false" }],
  lit_redstone_lamp: () => ["minecraft:redstone_lamp", { lit: "true" }],
  lit_redstone_ore: () => ["minecraft:redstone_ore", { lit: "true" }],
  reeds: d => ["minecraft:sugar_cane", { age: String(d & 15) }],
  deadbush: () => ["minecraft:dead_bush"],
  tripWire: d => ["minecraft:tripwire", {
    powered: d & 1 ? "true" : "false", attached: d & 4 ? "true" : "false",
    disarmed: d & 8 ? "true" : "false",
    north: "false", south: "false", east: "false", west: "false"
  }],
  stonecutter: () => ["minecraft:stonecutter", { facing: "north" }],
  skull: () => ["minecraft:skeleton_skull", { rotation: "0" }],
  buttercup: () => ["minecraft:dandelion"],
  // bedrock's pumpkin is the uncarved one, java's legacy pumpkin was carved
  pumpkin: () => ["minecraft:pumpkin"],
  carved_pumpkin: d => ["minecraft:carved_pumpkin", { facing: DIRECTION[d & 3] }],
  bed: d => ["minecraft:red_bed", {
    facing: DIRECTION[d & 3], part: d & 8 ? "head" : "foot", occupied: d & 4 ? "true" : "false"
  }],
  // bedrock keeps persistent on bit 8 where java's legacy layout had it on 4
  leaves: d => ["minecraft:" + WOOD[d & 3] + "_leaves", {
    persistent: d & 8 ? "true" : "false", distance: "7", waterlogged: "false"
  }],
  leaves2: d => ["minecraft:" + ((d & 3) === 1 ? "dark_oak" : "acacia") + "_leaves", {
    persistent: d & 8 ? "true" : "false", distance: "7", waterlogged: "false"
  }],
  // earth's own bed keeps the head on bit 4 rather than bedrock's bit 8
  rainbow_bed: d => ["minecraft:red_bed", {
    facing: DIRECTION[d & 3], part: d & 4 ? "head" : "foot", occupied: "false"
  }],
  // java gave each of these its own legacy id, bedrock kept one id and put the
  // variant in the data, so the flattening map only ever returns the first one
  fence: d => [`minecraft:${WOOD[d & 7] ?? "oak"}_fence`, {
    north: "false", south: "false", east: "false", west: "false"
  }],
  cobblestone_wall: d => [`minecraft:${WALL_TYPES[d & 15] ?? "cobblestone"}_wall`, {
    north: "none", south: "none", east: "none", west: "none", up: "false"
  }],
  sandstone: d => [`minecraft:${SANDSTONE_TYPES[d & 3] ?? ""}sandstone`],
  red_sandstone: d => [`minecraft:${SANDSTONE_TYPES[d & 3] ?? ""}red_sandstone`],
  // bedrock added two flowers past the end of the map's range
  red_flower: d => [`minecraft:${RED_FLOWER[d] ?? "poppy"}`],
  // the height is the low three bits, the fourth is a covered_bit java has no equivalent for
  snow_layer: d => ["minecraft:snow", { layers: String((d & 7) + 1) }],
  // bedrock fills a cauldron in sixths and puts lava on bit 8
  cauldron: d => d & 8 ? ["minecraft:lava_cauldron"] : (d & 7)
    ? ["minecraft:water_cauldron", { level: (d & 7) >= 6 ? "3" : (d & 7) >= 4 ? "2" : "1" }]
    : ["minecraft:cauldron"],
  log: d => logState(WOOD[d & 3], d),
  log2: d => logState((d & 3) === 1 ? "dark_oak" : "acacia", d),
  quartz_block: d => (d & 3) === 2
    ? ["minecraft:quartz_pillar", { axis: AXIS[d >> 2] ?? "y" }]
    : [`minecraft:${QUARTZ[d & 3]}`],
  golden_rail: d => poweredRail("powered_rail", d),
  detector_rail: d => poweredRail("detector_rail", d),
  activator_rail: d => poweredRail("activator_rail", d),
  // the flattening map hangs every vine from the ceiling
  vine: d => ["minecraft:vine", {
    south: d & 1 ? "true" : "false",
    west: d & 2 ? "true" : "false",
    north: d & 4 ? "true" : "false",
    east: d & 8 ? "true" : "false",
    up: d === 0 ? "true" : "false"
  }],
  flower_pink_daisy: () => ["minecraft:pink_tulip"],
  flower_pot: () => ["minecraft:flower_pot"],
  double_plant: d => [
    `minecraft:${DOUBLE_PLANT[d & 7] ?? "sunflower"}`,
    { half: d & 8 ? "upper" : "lower" }
  ],
  prismarine_bricks_stairs: d => stairState("prismarine_brick_stairs", d),
  normal_stone_stairs: d => stairState("stone_stairs", d),
  wood: d => [`minecraft:${d & 8 ? "stripped_" : ""}${WOOD[d & 7] ?? "oak"}_wood`, { axis: "y" }],
  birch_standing_sign: d => ["minecraft:birch_sign", { rotation: String(d & 15), waterlogged: "false" }],
  wall_banner: d => ["minecraft:white_wall_banner", { facing: FACING_4[d & 7] ?? "north" }],
  pistonArmCollision: d => ["minecraft:piston_head", { facing: FACING_4[d & 7] ?? "up", type: "normal", short: "false" }],
  glowingobsidian: null,
  netherreactor: null,
  info_update: null,
  info_update2: null,
  movingBlock: null,
  reserved6: null,
  chemical_heat: null,
  hard_glass: null,
  hard_glass_pane: null,
  hard_stained_glass: null,
  hard_stained_glass_pane: null
}

const stairState = (id, d) => [`minecraft:${id}`, {
  facing: STAIR_FACING[d & 3], half: d & 4 ? "top" : "bottom",
  shape: "straight", waterlogged: "false"
}]

// axis 3 is bark on every side, which java made its own block
const logState = (wood, d) => (d >> 2) === 3
  ? [`minecraft:${wood}_wood`, { axis: "y" }]
  : [`minecraft:${wood}_log`, { axis: AXIS[d >> 2] ?? "y" }]

const poweredRail = (id, d) => [`minecraft:${id}`, {
  shape: RAIL_SHAPE[d & 7] ?? "north_south", powered: d & 8 ? "true" : "false", waterlogged: "false"
}]

function slabState(name, data) {
  const types = SLAB_TYPES[name.replace("double_", "")]
  if (!types) return null
  const type = types[data & 7] ?? types[0]
  return [`minecraft:${type}_slab`, {
    type: name.startsWith("double_") ? "double" : data & 8 ? "top" : "bottom",
    waterlogged: "false"
  }]
}

// bedrock lays these bits out differently from java's legacy format
function bySuffix(id, d) {
  if (id.endsWith("_stairs")) return stairState(id, d)
  if (id.endsWith("_trapdoor")) return [`minecraft:${id}`, {
    facing: TRAPDOOR_FACING[d & 3],
    open: d & 8 ? "true" : "false",
    half: d & 4 ? "top" : "bottom",
    powered: "false", waterlogged: "false"
  }]
  if (id.endsWith("_button")) {
    const [face, facing] = BUTTON_FACE[d & 7] ?? BUTTON_FACE[0]
    return [`minecraft:${id}`, { face, facing, powered: d & 8 ? "true" : "false" }]
  }
  if (id.endsWith("_fence_gate")) return [`minecraft:${id}`, {
    facing: DIRECTION[d & 3],
    open: d & 4 ? "true" : "false",
    in_wall: d & 8 ? "true" : "false",
    powered: "false"
  }]
  if (id.endsWith("_log") || id.endsWith("_wood") || id.endsWith("_hyphae"))
    return [`minecraft:${id}`, { axis: AXIS[d & 3] ?? "y" }]
  if (id === "seagrass" && (d === 1 || d === 2)) return ["minecraft:tall_seagrass", { half: d === 1 ? "upper" : "lower" }]
  if (id.endsWith("_weighted_pressure_plate")) return [`minecraft:${id}`, { power: String(d & 15) }]
  if (id.endsWith("_pressure_plate")) return [`minecraft:${id}`, { powered: d ? "true" : "false" }]
  return null
}

// walls went from booleans to none/low/tall in 1.16, and a filled cauldron became its own block
function modernise(name, props) {
  if (!props) return [name, props]
  const p = { ...props }
  const id = strip(name)
  if (id.endsWith("_wall")) {
    for (const d of ["north", "south", "east", "west"]) {
      if (p[d] === "true") p[d] = "low"
      else if (p[d] === "false") p[d] = "none"
    }
  }
  if (id === "cauldron") {
    const level = p.level
    delete p.level
    if (level && level !== "0") return ["minecraft:water_cauldron", { ...p, level }]
  }
  return [name, p]
}

export function makeMapper({ placeholder = "dirt", earth = {} } = {}) {
  const stats = { unknown: new Map(), earth: new Map() }
  const cache = new Map()
  const note = (bucket, key) => bucket.set(key, (bucket.get(key) ?? 0) + 1)

  function resolve(rawName, data, asVanilla = false) {
    const name = strip(rawName)
    const over = asVanilla ? undefined : name in earth ? earth[name] : EARTH_BLOCKS[name]
    if (over !== undefined) {
      const st = over === null ? null
        : over.startsWith("@") ? resolve(over.slice(1), data, true)
        : [`minecraft:${strip(over)}`, undefined]
      const seen = stats.earth.get(name) ?? { states: 0, to: new Set() }
      seen.states++
      seen.to.add(st ? st[0] : null)
      stats.earth.set(name, seen)
      return st
    }
    const slab = slabState(name, data)
    if (slab) return slab
    if (name in DIRECT) {
      const direct = DIRECT[name]
      if (direct === null) {
        note(stats.unknown, name)
        return [`minecraft:${strip(placeholder)}`, undefined]
      }
      return direct(data)
    }
    const bedrock = bySuffix(BEDROCK_NAME[name] ?? name, data)
    if (bedrock) return bedrock
    // the map rotates these onto a facing of its own, which lands two of
    // bedrock's four directions on the same one
    if (name.endsWith("_glazed_terracotta")) {
      const mapped = legacyStates[LEGACY_ID[name] * 16]?.[0] ?? `minecraft:${name}`
      return [mapped, { facing: FACING_4[data & 7] ?? "north" }]
    }
    const id = LEGACY_ID[name]
    if (id !== undefined) {
      const st = legacyStates[id * 16 + (data & 15)] ?? legacyStates[id * 16]
      if (st) {
        const renamed = RENAMED[strip(st[0])]
        return [renamed ? `minecraft:${renamed}` : st[0], st[1]]
      }
    }
    if (javaBlocks.has(name)) return [`minecraft:${name}`, undefined]
    note(stats.unknown, `${name}${data ? ":" + data : ""}`)
    return [`minecraft:${strip(placeholder)}`, undefined]
  }

  return {
    stats,
    get(rawName, data) {
      const key = rawName + ":" + data
      if (cache.has(key)) return cache.get(key)
      let st = resolve(rawName, data)
      if (st) st = modernise(st[0], st[1])
      if (st && !javaBlocks.has(strip(st[0]))) {
        note(stats.unknown, `${strip(rawName)} -> ${st[0]} (not a java block)`)
        st = [`minecraft:${strip(placeholder)}`, undefined]
      }
      cache.set(key, st)
      return st
    }
  }
}

// java keeps a bed's colour, a pot's plant and a note block's pitch in the block itself
export function applyBlockEntity(state, be) {
  if (!state) return state
  const id = strip(state[0])
  const v = be?.data?.value ?? {}
  const kind = v.id?.value
  if (kind === "Bed" && id.endsWith("_bed")) {
    return [`minecraft:${BED_COLOURS[v.color?.value ?? 14] ?? "red"}_bed`, state[1]]
  }
  if (kind === "FlowerPot" && (id === "flower_pot" || id.startsWith("potted_"))) {
    const potted = POTTED[strip(v.PlantBlock?.value?.name?.value ?? "")]
    if (potted) return [`minecraft:${potted}`, undefined]
  }
  if (kind === "Music" && id === "note_block") {
    return [state[0], { ...(state[1] ?? {}), note: String(v.note?.value ?? 0) }]
  }
  return state
}

const titleCase = s => s.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")

// the lower block holds the facing and whether it is open, the upper one holds the hinge
export function doorState(data) {
  const upper = !!(data & 8)
  return upper
    ? ["upper", { hinge: data & 1 ? "right" : "left" }]
    : ["lower", { facing: DOOR_FACING[data & 3], open: data & 4 ? "true" : "false" }]
}

export function javaEntity(name) {
  const short = strip(name).replace(/^genoa:/, "")
  const near = ENTITY_NEAR[short]
  if (near) {
    const same = near === short || RENAMED_MOB.has(short)
    return { id: `minecraft:${near}`, label: same ? null : LABEL[short] ?? titleCase(short) }
  }
  if (javaEntities.has(short)) return { id: `minecraft:${short}`, label: null }
  return null
}
