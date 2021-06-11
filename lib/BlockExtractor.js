const glob = require('glob');
const but = require('but');
const fs = require('fs');
const _ = require('lodash');

const Parser = but.encoding.BufferReader;
const BLOCK_DOWNLOAD_WINDOW = 1024;

class BlockExtractor {
  constructor(dataDir, network) {
    const path = dataDir + 'blocks/blk*.dat';
    this.dataDir = dataDir;
    this.files   = glob.sync(path);
    this.nfiles  = this.files.length;
    if (this.nfiles === 0) throw new Error('Could not find block files at: ' + path);
    this.currentFileIndex = 0;
    this.isCurrentRead = false;
    this.currentBuffer = null;
    this.currentParser = null;
    this.network = network === 'testnet' ? but.Networks.testnet: but.Networks.livenet;
    this.magic = this.network.networkMagic.toString('hex');
    this.prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    this.blocks = [];
  }

  currentFile () {
    return this.files[this.currentFileIndex];
  }

  nextFile () {
    if (this.currentFileIndex < 0) return false;
    let ret = true;
    this.isCurrentRead = false;
    this.currentBuffer = null;
    this.currentParser = null;
    if (this.currentFileIndex < this.nfiles - 1) {
      this.currentFileIndex++;
    } else {
      this.currentFileIndex=-1;
      ret = false;      
    }
    return ret;
  }

  readCurrentFileSync () {
    if (this.currentFileIndex < 0 || this.isCurrentRead) return;
    this.isCurrentRead = true;
    const fname = this.currentFile();
    if (!fname) return;
    const stats = fs.statSync(fname);
    const size = stats.size; 
    console.log(`Reading Blockfile ${fname} [${parseInt(size/1024/1024)} MB]`);
    const fd = fs.openSync(fname, 'r');
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, 0);
    this.currentBuffer = buffer;
    this.currentParser = new Parser(buffer);
  }

  _getMagic () {
    if (!this.currentParser) return null;

    // Grab 3 bytes from block without removing them
    const p = this.currentParser.pos;
    let magic;
    try {
      magic = this.currentParser.readUInt32BE().toString(16);
    } catch(e) {
    }
    if (magic !=='00000000' && magic !== this.magic) {
      if(this.errorCount++ > 4) throw new Error('CRITICAL ERROR: Magic number mismatch: ' + magic + '!=' + this.magic);
      magic = null;
    }
    
    if (magic==='00000000') {
      magic = null;
    }
    return magic;
  }

  async getNextBlock () {
    let magic;
    let isFinished = 0;
    while(!magic && !isFinished)  {
      this.readCurrentFileSync();
      magic = this._getMagic();
      if (!this.currentParser || this.currentParser.eof() ) {
        if (this.nextFile()) {
          console.log(`Moving forward to file: ${this.currentFile()}`);
          magic = null;
        } else {
          console.log('Finished all files');
          isFinished = 1;
        }
      }
    }
    if (isFinished) return;
    const blockSize = this.currentParser.readUInt32LE();
    const b = but.Block.fromBufferReader(this.currentParser);
    if(this.blocks.length <= BLOCK_DOWNLOAD_WINDOW) {
      this.blocks.push(b.toObject());
    }
    const nextBlock = this.blocks.find((o) => o.header.prevHash === this.prevHash);
    if(!nextBlock) {
      return await this.getNextBlock();
    }
    _.remove(this.blocks, (o) => o.header.hash === nextBlock.header.hash);
    /*this.blocks = this.blocks.filter((o) => {
      return o.header.hash !== nextBlock.header.hash; 
    });*/
    this.errorCount=0;
    this.prevHash = nextBlock.header.hash;
    return new but.Block(nextBlock);
  }
}

module.exports = BlockExtractor;