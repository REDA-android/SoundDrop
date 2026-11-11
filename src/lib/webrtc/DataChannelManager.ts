import { StreamSaverSession, SavedFileResult } from '../storage/stream-saver';
import { computeSHA256 } from '../storage/crypto';
import { gzipSync, gunzipSync } from 'fflate';

/**
 * 16 KB (16,384 bytes) is the universal WebRTC SCTP safe MTU across iOS Safari (WebKit),
 * Android Chrome, Desktop Chrome, Edge, and Firefox.
 * (Previously 64 KB + 5-byte header = 65,541 bytes exceeded the 65,536-byte SCTP limit on WebKit).
 */
export const CHUNK_SIZE = 16 * 1024; // 16 KB
export const BUFFER_THRESHOLD = 1024 * 1024; // 1 MB Backpressure limit for low-latency mobile & desktop
export const ACK_WINDOW_CHUNKS = 64; // ACK every 64 chunks (1 MB)
const DIRECT_RAM_LIMIT_BYTES = 150 * 1024 * 1024; // 150 MB direct typed-array assembly

export enum PacketType {
  METADATA_HEADER = 0x01,
  DATA_CHUNK = 0x02,
  TRANSFER_ACK = 0x03,
  CHECKSUM_VERIFY = 0x04,
  CLIPBOARD_MSG = 0x05,
  RECEIVER_READY = 0x06,
  SENDER_PING = 0x07,
  METADATA_ACK = 0x08,
}

export interface FileMetadata {
  fileName: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  sha256: string;
  compressedHeader?: boolean;
  isDirectoryBundle?: boolean;
  totalFilesInBundle?: number;
}

export interface TransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  currentChunk: number;
  totalChunks: number;
  bufferedAmount: number;
  speedBps: number;
}

export class DataChannelStreamer {
  private channels: RTCDataChannel[] = [];
  private activeSendChannel: RTCDataChannel;
  private isRemoteReceiverReady = false;
  private isMetadataAcked = false;
  private receiverAttachCallback: ((ch: RTCDataChannel) => void) | null = null;
  private senderAttachCallback: ((ch: RTCDataChannel) => void) | null = null;

  constructor(primaryChannel: RTCDataChannel) {
    primaryChannel.binaryType = 'arraybuffer';
    this.channels = [primaryChannel];
    this.activeSendChannel = primaryChannel;
  }

  /**
   * Attaches an additional candidate RTCDataChannel (e.g. if both Direct WebRTC and PeerJS Mesh open)
   * so whichever pipe the remote peer responds on becomes the active streaming pipe.
   */
  public addCandidateChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';
    if (!this.channels.includes(channel)) {
      this.channels.push(channel);
      if (this.receiverAttachCallback) {
        this.receiverAttachCallback(channel);
      }
      if (this.senderAttachCallback) {
        this.senderAttachCallback(channel);
      }
    }
  }

  private broadcastControlPacket(packet: Uint8Array): void {
    for (const ch of this.channels) {
      if (ch.readyState === 'open') {
        try {
          ch.send(packet.buffer as ArrayBuffer);
        } catch {
          // Ignored
        }
      }
    }
  }

  public sendClipboardMessage(senderName: string, text: string): boolean {
    const openCh = this.channels.find((c) => c.readyState === 'open');
    if (!openCh) return false;
    const json = JSON.stringify({
      senderName,
      payload: text,
      timestamp: Date.now(),
    });
    const encoded = new TextEncoder().encode(json);
    const packet = new Uint8Array(1 + encoded.length);
    packet[0] = PacketType.CLIPBOARD_MSG;
    packet.set(encoded, 1);
    openCh.send(packet.buffer);
    return true;
  }

  private async waitForReceiverReady(): Promise<void> {
    if (this.isRemoteReceiverReady) return;

    return new Promise<void>((resolve) => {
      let settled = false;
      const cleanup: Array<() => void> = [];

      const finish = (winningChannel?: RTCDataChannel) => {
        if (settled) return;
        settled = true;
        if (winningChannel && winningChannel.readyState === 'open') {
          this.activeSendChannel = winningChannel;
        }
        this.isRemoteReceiverReady = true;
        clearInterval(pingTimer);
        clearTimeout(maxWaitTimer);
        cleanup.forEach((fn) => fn());
        resolve();
      };

      const bindChannel = (ch: RTCDataChannel) => {
        const onMsg = (event: MessageEvent) => {
          if (event.data instanceof ArrayBuffer) {
            const view = new Uint8Array(event.data);
            if (view[0] === PacketType.RECEIVER_READY || view[0] === PacketType.METADATA_ACK) {
              finish(ch);
            }
          }
        };
        ch.addEventListener('message', onMsg);
        cleanup.push(() => ch.removeEventListener('message', onMsg));
      };

      this.channels.forEach(bindChannel);

      const sendPing = () => {
        const ping = new Uint8Array([PacketType.SENDER_PING]);
        this.broadcastControlPacket(ping);
      };

      sendPing();
      const pingTimer = setInterval(sendPing, 80);
      const maxWaitTimer = setTimeout(() => {
        const openCh = this.channels.find((c) => c.readyState === 'open');
        finish(openCh);
      }, 650);
    });
  }

  public async sendFile(
    file: File,
    onProgress: (progress: TransferProgress) => void,
    onVerified?: (isValid: boolean) => void,
    extraMeta?: Partial<FileMetadata>
  ): Promise<void> {
    // For files <= 150 MB (photos, PDFs, audio, ZIPs), snapshot the entire file into a Uint8Array
    // once up front so iOS Safari temporary Photo Library handles never expire mid-transfer.
    let preloadedBytes: Uint8Array | null = null;
    if (file.size <= DIRECT_RAM_LIMIT_BYTES) {
      const ab = await file.arrayBuffer();
      preloadedBytes = new Uint8Array(ab);
    }

    const actualByteSize = preloadedBytes ? preloadedBytes.byteLength : file.size;
    const totalChunks = Math.max(1, Math.ceil(actualByteSize / CHUNK_SIZE));

    // Compute SHA-256 and wait for Receiver readiness in parallel
    const [sha256] = await Promise.all([
      preloadedBytes ? computeSHA256(preloadedBytes) : computeSHA256(file),
      this.waitForReceiverReady(),
    ]);

    const metadata: FileMetadata = {
      fileName: file.name,
      fileSize: actualByteSize,
      fileType: file.type || 'application/octet-stream',
      totalChunks,
      sha256,
      compressedHeader: true,
      ...extraMeta,
    };

    const metaJson = JSON.stringify(metadata);
    const rawMetaBytes = new TextEncoder().encode(metaJson);
    const compressedMeta = gzipSync(rawMetaBytes);
    const metaPacket = new Uint8Array(1 + compressedMeta.length);
    metaPacket[0] = PacketType.METADATA_HEADER;
    metaPacket.set(compressedMeta, 1);

    // Setup listener for remote METADATA_ACK and CHECKSUM_VERIFY across all candidate channels
    const cleanupVerifyListeners: Array<() => void> = [];
    const ackPromise = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        cleanupVerifyListeners.forEach((fn) => fn());
        if (onVerified) onVerified(true);
        resolve(true);
      }, 60000);

      for (const ch of this.channels) {
        const handleMessage = (event: MessageEvent) => {
          if (event.data instanceof ArrayBuffer) {
            const view = new Uint8Array(event.data);
            const type = view[0];

            if (type === PacketType.METADATA_ACK) {
              this.isMetadataAcked = true;
              this.activeSendChannel = ch;
            } else if (type === PacketType.CHECKSUM_VERIFY) {
              clearTimeout(timeout);
              cleanupVerifyListeners.forEach((fn) => fn());
              try {
                const payload = JSON.parse(new TextDecoder().decode(view.slice(1)));
                if (onVerified) onVerified(Boolean(payload.verified));
                resolve(Boolean(payload.verified));
              } catch {
                if (onVerified) onVerified(true);
                resolve(true);
              }
            }
          }
        };
        ch.addEventListener('message', handleMessage);
        cleanupVerifyListeners.push(() => ch.removeEventListener('message', handleMessage));
      }
    });

    // 1. Send METADATA_HEADER and wait briefly (up to 350ms) for METADATA_ACK so Receiver has allocated its buffer
    this.isMetadataAcked = false;
    this.broadcastControlPacket(metaPacket);

    await new Promise<void>((resolve) => {
      let tries = 0;
      const checkAck = setInterval(() => {
        tries++;
        if (this.isMetadataAcked || tries >= 4) {
          clearInterval(checkAck);
          resolve();
        } else {
          this.broadcastControlPacket(metaPacket);
        }
      }, 80);
    });

    const sendChannel =
      this.activeSendChannel.readyState === 'open'
        ? this.activeSendChannel
        : this.channels.find((c) => c.readyState === 'open') || this.activeSendChannel;

    // Handle 0-byte file edge case cleanly
    if (actualByteSize === 0) {
      const emptyPacket = new Uint8Array(5);
      emptyPacket[0] = PacketType.DATA_CHUNK;
      sendChannel.send(emptyPacket.buffer);
      onProgress({
        bytesTransferred: 0,
        totalBytes: 0,
        currentChunk: 1,
        totalChunks: 1,
        bufferedAmount: 0,
        speedBps: 0,
      });
      await ackPromise;
      return;
    }

    // 2. Stream 16 KB DATA_CHUNK packets (0x02) with backpressure management
    let offset = 0;
    let chunkIndex = 0;
    let lastProgressTime = performance.now();
    let bytesSentSinceLastCheck = 0;
    let currentSpeed = 0;

    while (offset < actualByteSize) {
      if (sendChannel.readyState !== 'open') {
        throw new Error('Le canal de données WebRTC a été interrompu pendant le transfert.');
      }

      if (sendChannel.bufferedAmount > BUFFER_THRESHOLD) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (
              sendChannel.readyState !== 'open' ||
              sendChannel.bufferedAmount <= BUFFER_THRESHOLD / 2
            ) {
              resolve();
            } else {
              setTimeout(check, 6);
            }
          };
          check();
        });
      }

      let chunkBytes: Uint8Array;
      if (preloadedBytes) {
        chunkBytes = preloadedBytes.subarray(
          offset,
          Math.min(actualByteSize, offset + CHUNK_SIZE)
        );
      } else {
        const chunkSlice = file.slice(offset, offset + CHUNK_SIZE);
        const chunkBuffer = await chunkSlice.arrayBuffer();
        chunkBytes = new Uint8Array(chunkBuffer);
      }

      // Packet format: [1 byte Type (0x02)] + [4 bytes Chunk Index Uint32] + [Payload (<= 16,384 B)]
      const packet = new Uint8Array(5 + chunkBytes.byteLength);
      packet[0] = PacketType.DATA_CHUNK;
      const dataView = new DataView(packet.buffer);
      dataView.setUint32(1, chunkIndex, false);
      packet.set(chunkBytes, 5);

      sendChannel.send(packet.buffer);

      offset += chunkBytes.byteLength;
      chunkIndex++;
      bytesSentSinceLastCheck += chunkBytes.byteLength;

      const now = performance.now();
      const elapsed = (now - lastProgressTime) / 1000;
      if (elapsed >= 0.15 || offset >= actualByteSize) {
        currentSpeed = elapsed > 0 ? bytesSentSinceLastCheck / elapsed : 0;
        lastProgressTime = now;
        bytesSentSinceLastCheck = 0;

        onProgress({
          bytesTransferred: offset,
          totalBytes: actualByteSize,
          currentChunk: chunkIndex,
          totalChunks,
          bufferedAmount: sendChannel.bufferedAmount,
          speedBps: currentSpeed,
        });
      }
    }

    await ackPromise;
  }

  public setupReceiver(
    onMetadata: (meta: FileMetadata) => void,
    onProgress: (progress: TransferProgress) => void,
    onComplete: (result: SavedFileResult, meta: FileMetadata, checksumValid: boolean) => void,
    onClipboardMessage?: (msg: { senderName: string; payload: string; timestamp: number }) => void
  ): void {
    let currentMeta: FileMetadata | null = null;
    // Direct synchronous RAM assembly buffer for files <= 150 MB (immune to OPFS/async race bugs)
    let directFileBuffer: Uint8Array | null = null;
    let seenChunksBitset: Uint8Array | null = null;
    let uniqueChunksReceived = 0;
    // Fallback session for huge files > 150 MB
    let largeStreamSession: StreamSaverSession | null = null;

    let receivedBytes = 0;
    let hasFinalized = false;
    let lastProgressTime = performance.now();
    let bytesSinceLastCheck = 0;
    let currentSpeed = 0;

    let messageQueue: Promise<void> = Promise.resolve();

    const sendReadySignal = (targetCh?: RTCDataChannel) => {
      const readyPkt = new Uint8Array([PacketType.RECEIVER_READY]);
      if (targetCh && targetCh.readyState === 'open') {
        try {
          targetCh.send(readyPkt.buffer);
        } catch {
          // Ignored
        }
      } else {
        this.broadcastControlPacket(readyPkt);
      }
    };

    const sendMetadataAck = (targetCh: RTCDataChannel) => {
      if (targetCh.readyState === 'open') {
        try {
          const ack = new Uint8Array([PacketType.METADATA_ACK]);
          targetCh.send(ack.buffer);
        } catch {
          // Ignored
        }
      }
    };

    const handlePacketSequential = async (rawEventData: unknown, sourceChannel: RTCDataChannel) => {
      let buffer: ArrayBuffer;
      if (rawEventData instanceof ArrayBuffer) {
        buffer = rawEventData;
      } else if (ArrayBuffer.isView(rawEventData)) {
        buffer = rawEventData.buffer.slice(
          rawEventData.byteOffset,
          rawEventData.byteOffset + rawEventData.byteLength
        ) as ArrayBuffer;
      } else if (rawEventData instanceof Blob) {
        buffer = await rawEventData.arrayBuffer();
      } else {
        return;
      }

      if (buffer.byteLength === 0) return;
      const view = new Uint8Array(buffer);
      const packetType = view[0];

      if (packetType === PacketType.SENDER_PING) {
        sendReadySignal(sourceChannel);
        return;
      }

      if (packetType === PacketType.RECEIVER_READY) {
        this.isRemoteReceiverReady = true;
        return;
      }

      if (packetType === PacketType.CLIPBOARD_MSG) {
        try {
          const msg = JSON.parse(new TextDecoder().decode(view.slice(1)));
          if (onClipboardMessage) {
            onClipboardMessage(msg);
          }
        } catch {
          // Ignored
        }
        return;
      }

      // 1. Handle METADATA_HEADER (0x01)
      if (packetType === PacketType.METADATA_HEADER) {
        sendMetadataAck(sourceChannel);

        // Ignore duplicate METADATA_HEADER re-transmissions if already initialized for the same file
        if (currentMeta && !hasFinalized) {
          return;
        }

        const headerSlice = view.slice(1);
        let jsonStr: string;
        try {
          const decompressed = gunzipSync(headerSlice);
          jsonStr = new TextDecoder().decode(decompressed);
        } catch {
          jsonStr = new TextDecoder().decode(headerSlice);
        }

        currentMeta = JSON.parse(jsonStr) as FileMetadata;
        receivedBytes = 0;
        uniqueChunksReceived = 0;
        hasFinalized = false;
        lastProgressTime = performance.now();
        bytesSinceLastCheck = 0;

        if (currentMeta.fileSize <= DIRECT_RAM_LIMIT_BYTES) {
          // Pre-allocate exact byte array in RAM — 0ms synchronous writes, 100% immune to 0-byte bugs
          directFileBuffer = new Uint8Array(currentMeta.fileSize);
          seenChunksBitset = new Uint8Array(Math.max(1, currentMeta.totalChunks));
          largeStreamSession = null;
        } else {
          directFileBuffer = null;
          seenChunksBitset = null;
          largeStreamSession = new StreamSaverSession(
            currentMeta.fileName,
            currentMeta.fileType,
            currentMeta.fileSize
          );
          await largeStreamSession.initialize();
        }

        onMetadata(currentMeta);
        return;
      }

      // 2. Handle DATA_CHUNK (0x02)
      if (packetType === PacketType.DATA_CHUNK && currentMeta && !hasFinalized) {
        const dataView = new DataView(buffer);
        const chunkIndex = dataView.getUint32(1, false);
        const chunkPayload = view.subarray(5);

        if (directFileBuffer && seenChunksBitset) {
          // Direct synchronous write at exact byte offset `chunkIndex * CHUNK_SIZE`
          const writeOffset = chunkIndex * CHUNK_SIZE;
          if (chunkPayload.byteLength > 0 && writeOffset < directFileBuffer.byteLength) {
            const safeSlice =
              writeOffset + chunkPayload.byteLength <= directFileBuffer.byteLength
                ? chunkPayload
                : chunkPayload.subarray(0, directFileBuffer.byteLength - writeOffset);
            directFileBuffer.set(safeSlice, writeOffset);
          }

          if (chunkIndex < seenChunksBitset.length && seenChunksBitset[chunkIndex] === 0) {
            seenChunksBitset[chunkIndex] = 1;
            uniqueChunksReceived++;
            receivedBytes += chunkPayload.byteLength;
            bytesSinceLastCheck += chunkPayload.byteLength;
          } else if (currentMeta.fileSize === 0) {
            uniqueChunksReceived = 1;
          }
        } else if (largeStreamSession) {
          if (chunkPayload.byteLength > 0) {
            await largeStreamSession.writeChunk(chunkPayload);
          }
          uniqueChunksReceived++;
          receivedBytes += chunkPayload.byteLength;
          bytesSinceLastCheck += chunkPayload.byteLength;
        }

        if (
          chunkIndex % ACK_WINDOW_CHUNKS === 0 ||
          receivedBytes >= currentMeta.fileSize ||
          uniqueChunksReceived >= currentMeta.totalChunks
        ) {
          const ackPacket = new Uint8Array(5);
          ackPacket[0] = PacketType.TRANSFER_ACK;
          const ackView = new DataView(ackPacket.buffer);
          ackView.setUint32(1, chunkIndex, false);
          try {
            sourceChannel.send(ackPacket.buffer);
          } catch {
            // Ignored
          }
        }

        const now = performance.now();
        const elapsed = (now - lastProgressTime) / 1000;
        if (
          elapsed >= 0.12 ||
          receivedBytes >= currentMeta.fileSize ||
          uniqueChunksReceived >= currentMeta.totalChunks
        ) {
          currentSpeed = elapsed > 0 ? bytesSinceLastCheck / elapsed : 0;
          lastProgressTime = now;
          bytesSinceLastCheck = 0;

          onProgress({
            bytesTransferred: Math.min(currentMeta.fileSize, receivedBytes),
            totalBytes: currentMeta.fileSize,
            currentChunk: uniqueChunksReceived,
            totalChunks: currentMeta.totalChunks,
            bufferedAmount: sourceChannel.bufferedAmount,
            speedBps: currentSpeed,
          });
        }

        // Complete when all expected bytes/chunks have arrived
        const isTransferComplete =
          (currentMeta.fileSize === 0 && uniqueChunksReceived >= 1) ||
          (currentMeta.fileSize > 0 &&
            receivedBytes >= currentMeta.fileSize &&
            uniqueChunksReceived >= currentMeta.totalChunks);

        if (isTransferComplete && !hasFinalized) {
          hasFinalized = true;

          let result: SavedFileResult;
          if (directFileBuffer) {
            const computedSha256 = await computeSHA256(directFileBuffer);
            const mime = currentMeta.fileType || 'application/octet-stream';
            // Construct Blob from a dedicated ArrayBuffer copy so it always has exact byteLength
            const exactCopy = new Uint8Array(directFileBuffer.byteLength);
            exactCopy.set(directFileBuffer);
            const blob = new Blob([exactCopy.buffer], { type: mime });
            const url = URL.createObjectURL(blob);

            result = {
              blob,
              url,
              name: currentMeta.fileName,
              size: blob.size,
              mimeType: mime,
              usingOpfs: false,
              storageEngine: 'MemoryBlob',
              computedSha256,
            };
            directFileBuffer = null;
            seenChunksBitset = null;
          } else if (largeStreamSession) {
            result = await largeStreamSession.finalize();
          } else {
            return;
          }

          const isChecksumValid =
            result.computedSha256.toLowerCase() === currentMeta.sha256.toLowerCase();

          const verifyPayload = JSON.stringify({
            verified: isChecksumValid,
            actualSha256: result.computedSha256,
          });
          const verifyBytes = new TextEncoder().encode(verifyPayload);
          const verifyPacket = new Uint8Array(1 + verifyBytes.length);
          verifyPacket[0] = PacketType.CHECKSUM_VERIFY;
          verifyPacket.set(verifyBytes, 1);

          try {
            sourceChannel.send(verifyPacket.buffer);
          } catch {
            // Ignored
          }

          onComplete(result, currentMeta, isChecksumValid);
        }
      }
    };

    const attachToChannel = (ch: RTCDataChannel) => {
      ch.binaryType = 'arraybuffer';
      ch.onmessage = (event: MessageEvent) => {
        const eventData = event.data;
        messageQueue = messageQueue
          .then(() => handlePacketSequential(eventData, ch))
          .catch((err) => {
            console.error('DataChannel packet error:', err);
          });
      };
      sendReadySignal(ch);
    };

    this.receiverAttachCallback = attachToChannel;
    this.channels.forEach(attachToChannel);
  }
}
