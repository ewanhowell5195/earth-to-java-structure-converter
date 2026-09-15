# earth-to-java-structure-converter

Converts Minecraft Earth buildplates into Java Edition structure files.

Takes the buildplate JSON files and turns them into structure (`.nbt`) files that can be loaded in Java Edition 26.2+.

## Usage

```
node index.js <input> [output] [options]
```

`<input>` is a plate JSON or a directory, searched recursively. `[output]` defaults to `converted`.

| Option | Description |
|---|---|
| `--placeholder <block>` | stands in for anything with no Java equivalent, default dirt |
| `--constraint <block>` | Earth's containment shell, left out by default |

For example:

```
node index.js path/to/plates path/to/output --placeholder stone --constraint barrier
```

## Earth-only blocks

| Earth | becomes |
|---|---|
| `invisible_constraint`, `border_constraint`, `blend_constraint` | left out |
| `rainbow_wool`, `rainbow_carpet`, `rainbow_bed` | red wool, red carpet, red bed |
| `buttercup` | dandelion |
| `adventure_chest*` | chest |
| anything else with no Java form | `--placeholder`, default dirt |

The constraints were the plate's containment shell, a solid floor beneath it and walls around its sides that also hid anything behind them from rendering. Java has no block that does that, so they are left out by default. Pass `--constraint barrier` for the closest thing.

## Entities

Mobs that exist in Java map straight across. Earth-only mobs become the closest thing Java has, and keep their real name on a nametag, so a `bone_spider` becomes a spider called "Bone Spider". `persona_mob`, the player avatar posed on the plate, becomes a `mannequin` called "Mob of Me".

Only the id, position and rotation survive. Variants, colours, ages and skins are stored completely differently between editions and are not converted, so a `rainbow_sheep` arrives as a plain white sheep called "Rainbow Sheep".

The `frame` block becomes an item frame entity, since Java's item frames are entities rather than blocks.

## Known limits

- Structures will convert no matter their size, so some can be too large to actually load in game.
