const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const GameBoyAdvance = require('gbajs');

const ROM_PATH = __dirname + '/rom';
const SAVES_PATH = __dirname + '/saves';
const IMAGE_PATH = __dirname + '/temp.png';
const HEIGHTMAP_BIN = __dirname + '/heightmap';
const TEMP_SAVE_FILE = 'gba_temp_';

const SCREEN_WIDTH = 240;
const SCREEN_HEIGHT = 160;
const PIXEL_SIZE = 1;
const FRAME_TIME = 200;

const OWNERS = [{
  id: 'c4f9159c-2a1a-3131-b10e-296e950fe7f6',
  name: 'GBA EMU',
}, {
  id: 'c4f9159c-2a1a-3131-b10e-296e950fe7f7',
  name: 'GBA EMU B',
}];

const KEYS = {
  A: 0,
  B: 1,
  SELECT: 2,
  START: 3,
  RIGHT: 4,
  LEFT: 5,
  UP: 6,
  DOWN: 7,
  R: 8,
  L: 9,
};

// distance between two colors
function colorDifference([r1, g1, b1], [r2, g2, b2]) {
  return (
    (r1 - r2) * (r1 - r2) +
    (g1 - g2) * (g1 - g2) +
    (b1 - b2) * (b1 - b2)
  );
}

let palette = [[255,255,255]];
const cache = {};
function snapColors(pixels) {
  // iterate through pixels
  for (let y = 0, i = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++, i+=4) {
      // get the currnet color
      const color = [pixels[i], pixels[i+1], pixels[i+2]];
      // use a cached color if we haven't calculated the closest color for this pixel yet
      if (!cache[color]) {
        // find the closest color to the selected one
        let closest = palette[0];
        let dist = colorDifference(closest, color);
        for (let j = 0; j < palette.length; j++) {
          const dist2 = colorDifference(palette[j], color);
          if (dist > dist2) {
            closest = palette[j];
            dist = dist2;
          }
        }
        cache[color] = closest;
      }

      // update the image data for the canvas
      pixels[i] = cache[color][0];
      pixels[i+1] = cache[color][1];
      pixels[i+2] = cache[color][2];
    }
  }
}

const sRGB = linear =>
  linear.map((c, i) => i === 3
    ? c
    : Math.round(((c/255) > 0.0031308
      ? 1.055 * Math.pow((c/255), 1/2.4) - 0.055
      : c / 255 * 12.92)*255)
  );

module.exports = class GBA {
  constructor(omegga, config, store) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;
    this.frames = 0;
    this.totalFrames = 0;
    this.side = 0;
    this.rendering = false;
    this.downscale = false;
    this.snap = false;
    this.downscaleAmount = 4;
    this.lastPixels = Array(SCREEN_WIDTH * SCREEN_HEIGHT * 3).fill(0);
    this.gamepad = {};
    this.physicalGamepad = true;
  }

  // create a gameboy
  createEmulator() {
    const gba = new GameBoyAdvance();
    const biosBuf = fs.readFileSync(__dirname + '/node_modules/gbajs/resources/bios.bin');
    gba.setBios(biosBuf);
    gba.setCanvasMemory();
    this.gba = gba;
  }

  // check if a rom exists
  static romExists(name) {
    const path = `${ROM_PATH}/${name}.gba`;
    return fs.existsSync(path) ? path : null;
  }

  // load a rom into the emulator
  loadRom(name) {
    return new Promise((resolve, reject) => {
      if (!this.gba) return reject('gba not setup');
      const path = GBA.romExists(name);
      if (!path) return reject('rom not found');

      this.gba.loadRomFromFile(path, err => {
        if (err) {
          console.error('could not load rom', err);
          return reject('err loading rom');
        }
        resolve();
      });
    });
  }

  // load a save from file
  loadSave(name) {
    const path = `${SAVES_PATH}/${name}.sav`;
    if (!fs.existsSync(path)) throw 'save not found';
    this.gba.loadSavedataFromFile(path);
  }

  // prompt chat for a thing
  async prompt(pattern) {
    this.chatPattern = pattern;
    this.waiting = true;
    return await new Promise(resolve => this.chatPromise = resolve);
  }

  // run the heightmap binary given an input file
  async runHeightmap(filename, destpath, {tile=false,micro=false,owner}={}) {
    try {
      const command = HEIGHTMAP_BIN +
        ` -o "${destpath}" --nocollide --cull --owner_id "${owner.id}" --owner "${owner.name}" -s ${PIXEL_SIZE} -v 1 --img "${filename}"${
          tile?' --tile':micro?' --micro':''
        }`;
      if (Omegga.verbose) console.info(command);
      const { stdout } = await exec(command, {});
      if (Omegga.verbose) console.log(stdout);

      const result = stdout.match(/Reduced (\d+) to (\d+) /);
      if (!stdout.match(/Done!/) || !result) {
        console.log(stdout);
        throw 'could not finish conversion';
      }

      return true;
    } catch (err) {
      console.error('command:', err);
      throw 'conversion software failed';
    }
  }

  // create a save
  save(sav) {
    const sram = this.gba.mmu.save;
    if (!sram) return false;
    try {
      fs.writeFileSync(path.join(SAVES_PATH, sav + '.sav'), Buffer.from(sram.buffer));
      return true;
    } catch (err) {
      return false;
    }
  }

  async screenshot() {
    const owner = OWNERS[this.frames % 2];
    // save the screenshot to file
    let change = false;
    await new Promise(resolve => {
      const png = this.gba.screenshot();
      if (this.downscale) {

        // downscale the image
        for (let x = 0; x < SCREEN_WIDTH; x+=this.downscaleAmount) {
          for (let y = 0; y < SCREEN_HEIGHT; y+=this.downscaleAmount) {
            const firstIndex = (x + y * SCREEN_WIDTH)*4;
            for (let sx = 0; sx < this.downscaleAmount; sx++) {
              for (let sy = 0; sy < this.downscaleAmount; sy++) {
                if (sx + x >= SCREEN_WIDTH || sy + y >= SCREEN_HEIGHT) continue;
                const index = (x + sx + (y + sy) * SCREEN_WIDTH) * 4;
                png.data[index] = png.data[firstIndex];
                png.data[index+1] = png.data[firstIndex+1];
                png.data[index+2] = png.data[firstIndex+2];
              }
            }
          }
        }
      }

      if (this.snap)
        snapColors(png.data);

      for (let i = 0; i < SCREEN_WIDTH * SCREEN_HEIGHT; i++) {
        if (this.frame !== 0 && this.lastPixels[i * 3] === png.data[i * 4] &&
          this.lastPixels[i * 3 + 1] === png.data[i * 4 + 1] &&
          this.lastPixels[i * 3 + 2] === png.data[i * 4 + 2]) {
          // this was used to detect repeated pixels
          // but it turns out this doesn't work very well with stacked frames
          // maybe it would be better to count how many times this pixel was repeated
          // and just render it as a background and clear what's above it instead.
        } else {
          this.lastPixels[i * 3] = png.data[i * 4];
          this.lastPixels[i * 3 + 1] = png.data[i * 4 + 1];
          this.lastPixels[i * 3 + 2] = png.data[i * 4 + 2];
          change = true;
        }
      }
      png.pack().pipe(fs.createWriteStream(IMAGE_PATH)).on('finish', resolve);
    });

    if (!change) return;

    // generate and lad the save
    const frameSave = TEMP_SAVE_FILE + (this.frame % 2) + '.brs';
    await this.runHeightmap(IMAGE_PATH, path.join(this.omegga.savePath, frameSave), {micro: true, owner});
    //await this.omegga.loadBricks(frameSave, {offX: 0, offY: 0, offZ: this.frames * PIXEL_SIZE * 2, quiet: true});
    this.omegga.writeln(`Bricks.Load "${frameSave}" 0 0 ${(this.frames % 2) * PIXEL_SIZE * 2} 1 ${this.snap ? '1 1' : ''}`);

    // if half of the buffer used, clear the other half
    Omegga.clearBricks(OWNERS[1 - this.frames % 2], true);

    // increment the frames
    this.frames ++;
    this.totalFrames ++;
  }


  async init() {
    const settingsPath = path.join(Omegga.path, 'data/Saved/Config/LinuxServer/ServerSettings.ini');
    const serverSettings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath).toString() : '';
    const match = serverSettings.match(/SavedServerPalettes=\(Groups=\((.+)\),Description=.*\)\n\n/);
    if (match) {
      palette = match[1]
        .match(/B=(\d+),G=(\d+),R=(\d+)/g)
        .map(s =>{
          const [,b,g,r]=s.match(/B=(\d+),G=(\d+),R=(\d+)/);return sRGB([+r,+g,+b]);
        });
      console.log('Scanned', palette.length, 'colors from server palette');
    }
    let host = Omegga.host && Omegga.host.name, go = false;
    const prefix = '<color=\\"999999\\">[<color=\\"99ff99\\">gba</>]</>';
    const send = msg => Omegga.broadcast(`"${prefix} ${msg}"`);
    Omegga.clearBricks(OWNERS[0], true);
    Omegga.clearBricks(OWNERS[1], true);
    this.gamepad = (await this.store.get('buttons')) || {};
    console.info('Physical gamepad has', Object.keys(this.gamepad).length, 'buttons');

    // render as fast as possible
    let renderLoop;
    renderLoop = async () => {
      try {
        if (this.rendering)
          await this.screenshot();
      } catch (err) {
        console.log('frame err');
      }

      this.renderTimeout = setTimeout(renderLoop, this.slowMode ? 500 : FRAME_TIME);
    };
    this.renderTimeout = setTimeout(renderLoop, this.slowMode ? 500 : FRAME_TIME);


    const crouchedRegExp = /(?<index>\d+)\) BP_FigureV2_C .+?PersistentLevel\.(?<pawn>BP_FigureV2_C_\d+)\.bIsCrouched = (?<crouched>(True|False))$/;

    // handle physical input
    setInterval(async () => {
      try {

        if (!this.gba || !this.physicalGamepad) return;
        // set of pressed buttons
        let pressed = new Set();
        if (this.rendering && Object.keys(this.gamepad).length > 4) {
          // get player positions
          const [positions, crouched] = await Promise.all([
            Omegga.getAllPlayerPositions(),
            Omegga.watchLogChunk('GetAll BP_FigureV2_C bIsCrouched', crouchedRegExp, {first: 'index'}),
          ]);


          for (const p of positions) {
            const isCrouched = crouched.find(r => r.groups.pawn === p.pawn);
            p.isCrouched = isCrouched && isCrouched.groups.crouched === 'True';
          }


          // determine if any buttons are pressed
          for (const key in this.gamepad) {
            const {minBound, maxBound} = this.gamepad[key];
            if (positions.some(({pos, isCrouched}) =>
              minBound[0] < pos[0] && maxBound[0] > pos[0] &&
              minBound[1] < pos[1] && maxBound[1] > pos[1] &&
              maxBound[2] + 50 > pos[2] && isCrouched)) {
              pressed.add(key);
            }
          }
        }
        for (const key in KEYS) {
          if (pressed.has(key))
            this.gba.keypad.keydown(KEYS[key]);
          else
            this.gba.keypad.keyup(KEYS[key]);
        }
      } catch (err) {
        console.error('error getting positions', err);
      }
    }, 200);

    // autosave every 30 seconds
    setInterval(() => {
      if (go) {
        this.save('_autosave');
      }
    }, 30000);

    Omegga
      .on('chatcmd:gba', async (name, rom, save) => {
        if (!Omegga.getPlayer(name).isHost()) return;
        host = name;
        try {
          if (this.gba)
            this.gba.reset();
          else
            this.createEmulator();
          await this.loadRom(rom);
          send('Created emulator');
        } catch (err) {
          send('Error creating emulator: ' + err);
          return;
        }

        try {
          const saveFile = path.join(SAVES_PATH, (save || '_autosave') + '.sav');
          if (fs.existsSync(saveFile))
            this.gba.loadSavedataFromFile(saveFile);
        } catch (err) {
          send('Error loading save: ' + err.message);
          console.error('Error loading save', err);
          return;
        }

        this.gba.runStable();
        go = true;
        this.rendering = true;
      })
      // set the position of a button to be located at template bounds
      .on('chatcmd:setbutton', async (name, btn) => {
        if (name !== host) return;
        const bounds = await Omegga.getPlayer(name).getTemplateBounds();
        if (!bounds) return send('No bricks in clipboard');
        if (!btn) return send('Invalid button');
        btn = btn.toUpperCase();
        if (typeof KEYS[btn] === 'undefined') return send('Invalid button');
        send(`${btn}: ${bounds.maxBound[0] - bounds.minBound[0]}x${bounds.maxBound[1] - bounds.minBound[1]}`);
        this.gamepad[btn] = bounds;
        await this.store.set('buttons', this.gamepad);
      })
      // save game to a file
      .on('chatcmd:gbasave', (name, sav) => {
        if (name !== host) return;
        if (!sav || !sav.length) return send ('Invalid save name');
        const sram = this.gba.mmu.save;
        if (!sram) return send('No save data available');
        try {
          fs.writeFileSync(path.join(SAVES_PATH, sav + '.sav'), Buffer.from(sram.buffer));
        } catch (err) {
          send('Error: ' + err.message);
          console.error('error saving', err);
          return;
        }
        send('Saved data to ' + sav);
      })
      .on('chatcmd:pause', name => {
        if (name !== host) return;
        this.rendering = !this.rendering;
        send('Rendering ' + (this.rendering ? 'enabled' : 'disabled'));
      })
      .on('chatcmd:snap', name => {
        if (name !== host) return;
        this.snap = !this.snap;
        send('Palette snapping ' + (this.snap ? 'enabled' : 'disabled'));
      })
      .on('chatcmd:physical', name => {
        if (name !== host) return;
        this.physicalGamepad = !this.physicalGamepad;
        send('Physical Gamepad ' + (this.physicalGamepad ? 'enabled' : 'disabled'));
      })
      .on('chatcmd:slow', name => {
        if (name !== host) return;
        this.slowMode = !this.slowMode;
        send('Slow Mode ' + (this.slowMode ? 'enabled' : 'disabled'));
      })
      .on('chatcmd:downscale', (name, arg) => {
        if (name !== host) return;
        if (arg && arg.length > 0 && arg.match(/^(2|4|8)$/)) {
          this.downscaleAmount = parseInt(arg);
          this.downscale = true;
        } else {
          this.downscale = !this.downscale;
          send('Downscale ' + (this.downscale ? 'enabled' : 'disabled'));
        }
      })
      // chat messages parsed for keys and prompts
      .on('chat', async (name, message) => {
        try {
          // if the gba is running, interpret keys
          if (this.gba) {
            const key = KEYS[message.trim().toUpperCase()];
            if (typeof key !== 'undefined') {
              this.gba.keypad.press(key);
              return;
            }
          }

          // otherwise let host make decisions and resolve the promise
          if (name !== host || !this.waiting) return;
          const match = message.match(this.chatPattern);
          if (match) {
            this.chatPromise(match[0]);
            this.waiting = false;
          }
        } catch (err) {
          console.error(err);
        }
      });
  }

  async stop() {
    clearTimeout(this.renderTimeout);
  }
};
