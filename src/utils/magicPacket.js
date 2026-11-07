import dgram from 'node:dgram';

/**
 * Normalises a MAC address (`aa:bb:..`, `aa-bb-..`, `aabb..`) to 6 bytes.
 * Throws on anything that is not 12 hex digits.
 * @param mac - MAC address string
 */
export function parseMac(mac) {
  const hex = String(mac).replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 12) throw new Error(`Invalid MAC address: ${mac}`);
  return Buffer.from(hex, 'hex');
}

/**
 * Builds a Wake-on-LAN magic packet: 6 bytes of 0xFF followed by the target MAC repeated 16 times (102 bytes).
 * @param mac - MAC address of the machine to wake
 */
export function buildMagicPacket(mac) {
  const macBytes = parseMac(mac);
  const packet = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) macBytes.copy(packet, 6 + i * 6);
  return packet;
}

/**
 * Sends one magic packet per (mac, address, port) combination over UDP broadcast.
 * Resolves with the number of packets sent; individual send failures are logged and skipped.
 * @param macs - MAC addresses to wake
 * @param addresses - broadcast (or unicast) destination addresses
 * @param ports - UDP ports, conventionally 9 and 7
 */
export async function sendMagicPackets(macs, addresses, ports = [9, 7]) {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve) => socket.bind(0, resolve));
  socket.setBroadcast(true);
  let sent = 0;
  try {
    for (const mac of macs) {
      const packet = buildMagicPacket(mac);
      for (const address of addresses) {
        for (const port of ports) {
          sent += await sendOne(socket, packet, address, port);
        }
      }
    }
  } finally {
    socket.close();
  }
  return sent;
}

/**
 * Sends a single datagram, resolving 1 on success and 0 on failure (never rejects).
 * @param socket - bound UDP socket
 * @param packet - payload
 * @param address - destination address
 * @param port - destination port
 */
function sendOne(socket, packet, address, port) {
  return new Promise((resolve) => {
    socket.send(packet, port, address, (err) => {
      if (err) console.warn(`[wol] magic packet to ${address}:${port} failed: ${err.message}`);
      resolve(err ? 0 : 1);
    });
  });
}
