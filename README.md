## omegga-gba

This [omegga](https://github.com/brickadia-community/omegga) plugin runs GBA roms with [gbajs](https://github.com/endrift/gbajs) and translates frames to in-game saves with [heightmap2brs](https://github.com/Meshiest/heightmap2brs).

To use:

Install: `omegga install gh:Meshiest/gba`

1. Copy some gba roms to the `rom` folder
2. Type `!gba romName` in chat
2. Play
  * Type the buttons you want to press (a, b, select, start, right, left, up, down, r, l) in chat.
  * Build a physical gamepad and crouch on buttons locations set with `!setbutton`
3. Enjoy!

The only way to stop it is to restart the plugin at the moment. Autosave occurs every 30 seconds.

Not every rom works, be sure to check console for errors.

## Commands

* `!gba romName saveName` - start emu, saveName is optional and will use the last autosave.
* `!downscale` - toggle downscaling
* `!downscale 2|4|8` - set downscale amount to 2x, 4x, or 8x
* `!pause` - toggle rendering, doesn't pause the game
* `!slow` - toggle render at 2fps
* `!snap` - toggle color palette snapping
* `!setbutton a|b|l|r|up|down|left|right|select|start` - Set a button to be located where the clipboard selection is located
* `!physical` - toggle access to physical gamepad
* `!gbasave saveName` - create a save file
