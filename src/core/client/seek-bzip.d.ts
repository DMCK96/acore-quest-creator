declare module 'seek-bzip' {
  const Bunzip: { decode(input: Uint8Array, output?: Uint8Array): Uint8Array };
  export default Bunzip;
}
