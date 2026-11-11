declare module 'ggwave' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factory: () => Promise<any>;
  export default factory;
}

declare module 'streamsaver' {
  export interface CreateWriteStreamOptions {
    size?: number;
    pathname?: string;
    writableStrategy?: QueuingStrategy;
    readableStrategy?: QueuingStrategy;
  }
  const streamSaver: {
    createWriteStream(
      filename: string,
      options?: CreateWriteStreamOptions
    ): WritableStream<Uint8Array>;
    mitm: string;
  };
  export default streamSaver;
}
