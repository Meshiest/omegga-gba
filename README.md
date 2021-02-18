## omegga-gba

This [omegga](https://github.com/brickadia-community/omegga) plugin runs GBA roms with [gbajs](https://github.com/endrift/gbajs) and translates frames to in-game saves with [heightmap2brs](https://github.com/Meshiest/heightmap2brs).

To use:

Install: `omegga install gh:Meshiest/gba`

1. Copy some gba roms to the `rom` folder
2. Type `!gba` in chat
3. Type the name of the rom (without extension) into chat
4. Type the buttons you want to press (a, b, select, start, right, left, up, down, r, l) in chat.
5. Enjoy!

The only way to stop it is to restart the plugin at the moment.

Not every rom works, be sure to check console for errors.

## Commands

* `!gba` - start wizard (it will ask you to type the game, idk why i didn't just make that an argument)
* `!downscale` - toggle downscaling
* `!downscale 2|4|8` - set downscale amount to 2x, 4x, or 8x
* `!pause` - toggle rendering, doesn't pause the game
* `!slow` - render at 0.5fps
