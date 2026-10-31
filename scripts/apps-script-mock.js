'use strict';

/*
 * Apps Script runtime mock (ใช้ในเทสต์และ mock server)
 * รองรับ API ที่ Code.gs เรียกใช้: SpreadsheetApp, DriveApp, Utilities,
 * ContentService, PropertiesService, LockService, Logger
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const line = [];
      for (let c = 0; c < this.numCols; c += 1) {
        const source = this.sheet.data[this.row - 1 + r] || [];
        const value = source[this.col - 1 + c];
        line.push(value === undefined ? '' : value);
      }
      out.push(line);
    }
    return out;
  }

  setValues(values) {
    for (let r = 0; r < values.length; r += 1) {
      const targetRow = this.row - 1 + r;
      while (this.sheet.data.length <= targetRow) this.sheet.data.push([]);
      const line = this.sheet.data[targetRow];
      for (let c = 0; c < values[r].length; c += 1) {
        line[this.col - 1 + c] = values[r][c];
      }
    }
  }
}

class Sheet {
  constructor(name) {
    this.name = name;
    this.data = [];
  }

  getName() {
    return this.name;
  }

  setName(name) {
    this.name = name;
  }

  getId() {
    return 1;
  }

  getLastRow() {
    return this.data.length;
  }

  getDataRange() {
    let cols = 1;
    for (const row of this.data) cols = Math.max(cols, row.length);
    return new Range(this, 1, 1, Math.max(this.data.length, 1), cols);
  }

  getRange(row, col, numRows, numCols) {
    return new Range(
      this,
      row,
      col,
      numRows === undefined ? 1 : numRows,
      numCols === undefined ? 1 : numCols
    );
  }

  clearContents() {
    this.data = [];
  }
}

class Spreadsheet {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.sheets = [new Sheet('Sheet1')];
  }

  getId() {
    return this.id;
  }

  getUrl() {
    return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit';
  }

  getSheets() {
    return this.sheets;
  }

  getSheetByName(name) {
    return this.sheets.find((sheet) => sheet.name === name) || null;
  }

  insertSheet(name) {
    const sheet = new Sheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
}

class DriveFile {
  constructor(id, name, blob) {
    this.id = id;
    this.name = name;
    this.blob = blob;
    this.trashed = false;
  }

  getId() {
    return this.id;
  }

  getName() {
    return this.name;
  }

  getBlob() {
    return this.blob;
  }

  setTrashed(value) {
    this.trashed = !!value;
  }
}

class DriveFolder {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.files = new Map();
  }

  getId() {
    return this.id;
  }

  getName() {
    return this.name;
  }

  createFile(blob) {
    const file = new DriveFile(crypto.randomUUID(), blob.getName(), blob);
    this.files.set(file.getId(), file);
    return file;
  }
}

function buildSandbox() {
  const properties = new Map();
  const spreadsheets = new Map();
  const folders = new Map();
  const files = new Map();

  const SpreadsheetApp = {
    create(name) {
      const spreadsheet = new Spreadsheet(crypto.randomUUID(), name);
      spreadsheets.set(spreadsheet.getId(), spreadsheet);
      return spreadsheet;
    },
    openById(id) {
      const found = spreadsheets.get(id);
      if (!found) throw new Error('Spreadsheet not found: ' + id);
      return found;
    },
  };

  const DriveApp = {
    createFolder(name) {
      const folder = new DriveFolder(crypto.randomUUID(), name);
      folders.set(folder.getId(), folder);
      return folder;
    },
    getFoldersByName(name) {
      const list = [...folders.values()].filter((folder) => folder.name === name);
      let index = 0;
      return {
        hasNext: () => index < list.length,
        next: () => list[index++],
      };
    },
    getFolderById(id) {
      const folder = folders.get(id);
      if (!folder) throw new Error('Folder not found: ' + id);
      return folder;
    },
    getFileById(id) {
      for (const folder of folders.values()) {
        if (folder.files.has(id)) return folder.files.get(id);
      }
      const file = files.get(id);
      if (!file) throw new Error('File not found: ' + id);
      return file;
    },
    createFile(blob) {
      const file = new DriveFile(crypto.randomUUID(), blob.getName(), blob);
      files.set(file.getId(), file);
      return file;
    },
  };

  const Utilities = {
    Charset: { UTF_8: 'UTF-8' },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (_algorithm, input) => {
      const buffer =
        typeof input === 'string'
          ? Buffer.from(input, 'utf8')
          : Buffer.from(input.map((b) => b & 0xff));
      const digest = crypto.createHash('sha256').update(buffer).digest();
      return Array.from(digest, (byte) => (byte > 127 ? byte - 256 : byte));
    },
    base64Encode: (input) => {
      if (typeof input === 'string') return Buffer.from(input, 'utf8').toString('base64');
      return Buffer.from(input.map((b) => b & 0xff)).toString('base64');
    },
    base64Decode: (value) => Uint8Array.from(Buffer.from(String(value), 'base64')),
    newBlob: (bytes, mimeType, name) => ({
      getBytes: () => bytes,
      getContentType: () => mimeType,
      getName: () => name,
    }),
  };

  const ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput(content) {
      return {
        content,
        mimeType: 'text/plain',
        setMimeType(mimeType) {
          this.mimeType = mimeType;
          return this;
        },
      };
    },
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => (properties.has(key) ? properties.get(key) : null),
      setProperty: (key, value) => properties.set(key, value),
    }),
  };

  const LockService = {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
  };

  const Logger = { log() {} };

  return {
    SpreadsheetApp,
    DriveApp,
    Utilities,
    ContentService,
    PropertiesService,
    LockService,
    Logger,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    __state: { spreadsheets, folders, files, properties },
  };
}

function loadScript(sandbox) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const context = vm.createContext(sandbox);
  vm.runInContext(code, context, { filename: 'Code.gs' });
  return context;
}

function createMockContext() {
  const sandbox = buildSandbox();
  const context = loadScript(sandbox);
  context.setup();
  return { context, state: sandbox.__state };
}

module.exports = { createMockContext };
