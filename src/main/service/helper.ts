import fs from 'fs'
import fsAsync from 'fs/promises'
import Crypto from 'crypto'
import zlib from 'zlib'
import os from 'os'
import { fileTypeFromBuffer } from 'file-type'

import { BrowserWindow, dialog, IpcMainInvokeEvent } from 'electron'

import { IPayload } from '../interface/payload.interface'
import { EStep } from '../enum/step.enum'
import { EError } from '../enum/error.enum'
import path from 'path'

export default class Helper {
  private event: IpcMainInvokeEvent
  private browser: BrowserWindow
  private uuid: string
  private payload: IPayload
  private chunks: Buffer | null = null
  private rawSize: number = 0
  // Config
  private CHUNK_SIZE = 1024 * 256
  private IV_KEY = Buffer.from('9G2RgCPP0z9w0ZP+5MNVaw==', 'base64')

  // Debug
  private benchmark: Record<EStep, { start: number; end: number }> = {
    [EStep.FILE]: {
      start: 0,
      end: 0
    },
    [EStep.AES]: {
      start: 0,
      end: 0
    },
    [EStep.XOR]: {
      start: 0,
      end: 0
    },
    [EStep.ZIP]: {
      start: 0,
      end: 0
    },
    [EStep.CHECKSUM]: {
      start: 0,
      end: 0
    }
  }

  constructor(event: IpcMainInvokeEvent, browser: BrowserWindow, uuid: string, payload: IPayload) {
    this.event = event
    this.browser = browser
    this.uuid = uuid
    this.payload = payload
  }

  async encrypt() {
    try {
      // Load file
      await this.loadFile()
      // Create checksum
      const checksum = await this.createChecksum()
      // Compress file
      await this.compressFile()
      // AES Encrypt
      this.encryptAES(
        Buffer.concat([
          // Checksum
          checksum,
          // Content
          this.chunks!
        ])
      )
      // XOR Cipher
      await this.toggleXOR()
      // Save file
      const filename = this.getFilename()
      const path = await this.saveFile(`${filename.filename}.enc`)
      if (path) {
        // Send to IPC
        this.sendCompleted(path)
      }
      // Clear memory
      this.clearGC()
    } catch (e) {
      console.error(e)
    }
  }

  async decrypt() {
    try {
      // Load file
      await this.loadFile()
      // XOR Cipher
      await this.toggleXOR()
      // Decrypt
      await this.decryptAES()
      // Get checksum
      const checksum = this.chunks!.subarray(0, 20)
      // Decompress
      await this.decompressFile(this.chunks!.subarray(20))
      // Checksum
      if (Crypto.timingSafeEqual(this.createChecksum(this.chunks!), checksum)) {
        // Get extension type
        const ext = await fileTypeFromBuffer(this.chunks!)
        const filename = this.getFilename()
        // Save file
        const path = await this.saveFile(
          `${filename.filnameWithDot || filename.filename}${ext ? `.${ext.ext}` : ''}`
        )
        if (path) {
          // Send to IPC
          this.sendCompleted(path)
        }
      } else {
        this.sendError(EError.CHECKSUM_FAILED, 'Checksum failed.')
        return
      }

      // Clear GC
      this.clearGC()
    } catch (e) {
      console.error(e)
    }
  }

  private async saveFile(filename: string) {
    const saved = await dialog.showSaveDialog(this.browser, {
      buttonLabel: 'Save',
      title: 'Save file',
      defaultPath: os.homedir() + '/' + filename
    })
    if (saved.filePath) {
      console.log(`Saved path: ${saved.filePath}`)
      fs.writeFileSync(saved.filePath, this.chunks!)
      return saved.filePath
    }

    return null
  }

  private clearGC() {
    this.chunks = null
  }

  private getFilename() {
    // Get filename
    const sepPath = this.payload.path.split('/')
    const filenameSep = sepPath[sepPath.length - 1].split('.')

    return {
      filename: filenameSep[0],
      filnameWithDot: filenameSep.slice(1, filenameSep.length - 2).join('.'),
      ext: filenameSep[filenameSep.length - 1]
    }
  }

  private async loadFile() {
    return new Promise((res, rej) => {
      ;(async () => {
        // Start benchmark timestamp
        this.benchmark[EStep.FILE].start = Date.now()
        // Get Stat
        const fileInfo = await fsAsync.stat(this.payload.path)
        // Get current size
        let loaded = 0
        const completed: Buffer[] = []

        const fileStream = fs
          .createReadStream(this.payload.path, {
            highWaterMark: this.CHUNK_SIZE
          })
          .on('open', () => {
            this.sendProcess(EStep.FILE, fileInfo.size, 0)
          })
          .on('data', (ch: Buffer) => {
            completed.push(ch)
            loaded += ch.length
            this.sendProcess(EStep.FILE, fileInfo.size, loaded)
          })
          .on('error', (err) => {
            this.sendError(EError.FILE_ERROR, err.message)
            rej(err)
          })
          .on('end', () => {
            this.benchmark[EStep.FILE].end = Date.now()
            // Store raw
            this.rawSize = loaded
            this.chunks = Buffer.concat(completed)
            fileStream.removeAllListeners()
            res(1)
          })
      })()
    })
  }

  private async compressFile() {
    this.benchmark[EStep.ZIP].start = Date.now()
    this.sendProcess(EStep.ZIP, -1, -1)
    this.chunks = zlib.deflateSync(this.chunks!)
    this.benchmark[EStep.ZIP].end = Date.now()
  }

  private async decompressFile(content?: Buffer) {
    // Start benchmark timestamp
    this.benchmark[EStep.ZIP].start = Date.now()
    this.sendProcess(EStep.ZIP, -1, -1)
    this.chunks = zlib.inflateSync(content!)
    this.benchmark[EStep.ZIP].end = Date.now()
  }

  private async toggleXOR() {
    this.benchmark[EStep.XOR].start = Date.now()

    const filename = `${this.uuid}.tmp`
    const fullPath = path.join(os.tmpdir(), filename)

    // Temp write file
    fs.writeFileSync(fullPath, this.chunks!)
    // Store size
    const size = this.chunks!.length || 0
    let loaded = 0
    // Clear memory
    this.chunks = null
    const completed: Buffer[] = []

    this.sendProcess(EStep.XOR, size, loaded)

    return new Promise((res) => {
      // Read file
      fs.createReadStream(fullPath, {
        highWaterMark: this.CHUNK_SIZE
      })
        .on('data', (ch: Buffer) => {
          for (let i = 0; i < ch.length; i += 16) {
            ch[i + 0] = this.xor(ch[i + 0])
            ch[i + 1] = this.xor(ch[i + 1])
            ch[i + 2] = this.xor(ch[i + 2])
            ch[i + 3] = this.xor(ch[i + 3])
            ch[i + 4] = this.xor(ch[i + 4])
            ch[i + 5] = this.xor(ch[i + 5])
            ch[i + 6] = this.xor(ch[i + 6])
            ch[i + 7] = this.xor(ch[i + 7])
            ch[i + 8] = this.xor(ch[i + 8])
            ch[i + 9] = this.xor(ch[i + 9])
            ch[i + 10] = this.xor(ch[i + 10])
            ch[i + 11] = this.xor(ch[i + 11])
            ch[i + 12] = this.xor(ch[i + 12])
            ch[i + 13] = this.xor(ch[i + 13])
            ch[i + 14] = this.xor(ch[i + 14])
            ch[i + 15] = this.xor(ch[i + 15])
            ch[i + 16] = this.xor(ch[i + 16])
          }
          // Add size
          loaded += ch.length
          completed.push(ch)
          this.sendProcess(EStep.XOR, size, loaded)
        })
        .on('end', () => {
          this.benchmark[EStep.XOR].end = Date.now()
          // Remove temp file
          fs.rmSync(fullPath)
          // Append to chunk
          this.chunks = Buffer.concat(completed)
          res(1)
        })
    })
  }

  private xor(a: number) {
    return a ^ this.payload.bit
  }

  private encryptAES(payload: Buffer) {
    this.benchmark[EStep.AES].start = Date.now()
    this.sendProcess(EStep.AES, 1, 0)

    try {
      const cipher = Crypto.createCipheriv(
        'aes-256-cbc',
        this.createSecretKey(), // SHA256
        this.IV_KEY
      )

      this.chunks = Buffer.concat([cipher.update(payload), cipher.final()])
      this.sendProcess(EStep.AES, 1, 1)
    } catch (e) {
      this.sendError(EError.AES_ENCRYPT_FAIL, 'Encrypt failed')
      throw e
    }
    this.benchmark[EStep.AES].end = Date.now()
  }

  private decryptAES() {
    this.benchmark[EStep.AES].start = Date.now()
    this.sendProcess(EStep.AES, 1, 0)

    try {
      const cipher = Crypto.createDecipheriv(
        'aes-256-cbc',
        this.createSecretKey(), // SHA256
        this.IV_KEY
      )

      this.chunks = Buffer.concat([cipher.update(this.chunks!), cipher.final()])
    } catch (e) {
      this.sendError(EError.AES_DECRYPT_FAIL, 'Decrypt failed')
      throw e
    }
    this.sendProcess(EStep.AES, 1, 1)
    this.benchmark[EStep.AES].end = Date.now()
  }

  private createChecksum(ch?: Buffer) {
    this.benchmark[EStep.CHECKSUM].start = Date.now()
    const result = Buffer.from(
      Crypto.createHash('sha1')
        .update(ch || this.chunks!)
        .digest('hex'),
      'hex'
    )
    this.benchmark[EStep.CHECKSUM].end = Date.now()
    return result
  }

  private createSecretKey() {
    return Buffer.from(Crypto.createHash('sha256').update(this.payload.secret).digest('hex'), 'hex')
  }

  private sendProcess(step: EStep, total: number, current: number) {
    this.event.sender.send('encrypt.process', step, {
      uuid: this.uuid,
      message: null,
      data: {
        total,
        current
      }
    })
  }

  private sendError(step: EError, message: string) {
    this.event.sender.send('encrypt.error', step, {
      uuid: this.uuid,
      message: message,
      data: null
    })
  }

  private sendCompleted(path: string) {
    this.event.sender.send('global.finish', {
      uuid: this.uuid,
      message: null,
      data: {
        path,
        size: {
          before: this.rawSize,
          after: this.chunks!.length
        },
        debug: this.benchmark
      }
    })
  }
}
