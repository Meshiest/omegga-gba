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
const FRAME_BUFFER = 3;

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
    this.downscaleAmount = 4;
    this.lastPixels = Array(SCREEN_WIDTH * SCREEN_HEIGHT * 3).fill(0);
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
        ` -o "${destpath}" --cull --owner_id "${owner.id}" --owner "${owner.name}" -s ${PIXEL_SIZE} -v 1 --img "${filename}"${
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

  async screenshot() {
    this.frames = this.frames % FRAME_BUFFER;
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
    const frameSave = TEMP_SAVE_FILE + this.frame + '.brs';
    await this.runHeightmap(IMAGE_PATH, path.join(this.omegga.savePath, frameSave), {micro: true, owner: OWNERS[this.frames >= FRAME_BUFFER/2 ? 1 : 0]});
    await this.omegga.loadBricks(frameSave, {offX: 0, offY: 0, offZ: this.frames * PIXEL_SIZE * 2, quiet: true});

    // if half of the buffer used, clear the other half
    if (this.frames > FRAME_BUFFER/2)
      Omegga.clearBricks(OWNERS[0], true);
    else if(this.frames === 0)
      Omegga.clearBricks(OWNERS[1], true);

    // increment the frames
    this.frames ++;
    this.totalFrames ++;
  }


  async init() {
    let host = '', go = false;
    const yesNo = async () => (await this.prompt(/^(y(es)?|no?)$/i)).toLowerCase().startsWith('y');
    const prefix = '<color=\\"999999\\">[<color=\\"99ff99\\">gba</>]</>';
    const send = msg => Omegga.broadcast(`"${prefix} ${msg}"`);
    Omegga.clearBricks(OWNERS[0], true);
    Omegga.clearBricks(OWNERS[1], true);

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

    Omegga
      .on('chatcmd:gba', async name => {
        if (!Omegga.getPlayer(name).isHost() || go) return;
        host = name;
        go = true;
        if (this.gba) return send('Emulator already created');
        // attempt to load rom
        for(;;) {
          send('Enter rom name or \\"stop\\"');
          const name = await this.prompt(/.*/);
          if (name === 'stop') {
            send('Cancel? yes/no');
            if (await yesNo()) {
              go = false;
              this.gba = undefined;
              return;
            }
            else
              continue;
          }
          try {
            this.createEmulator();
            await this.loadRom(name);
            send('Created emulator');
            break;
          } catch (err) {
            go = false;
            send('Error: ' + err);
          }
        }

        /*send('Load save?');
        if(await yesNo()) {
          // load save.. not implemented yet
        }*/

        this.gba.runStable();
        this.rendering = true;
      })
      // individual frames
      .on('chatcmd:shot', async name => {
        if (name !== host) return;
        try {
          await this.screenshot();
        } catch (err) {
          console.error(err);
        }
      })
      .on('chatcmd:pause', name => {
        if (name !== host) return;
        this.rendering = !this.rendering;
        send('Rendering ' + (this.rendering ? 'enabled' : 'disabled'));
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
