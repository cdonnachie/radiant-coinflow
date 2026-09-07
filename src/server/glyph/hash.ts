import { createHash } from 'node:crypto';

/** Single SHA-256 (remote-media digests use this). */
export function sha256Once(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

/** Double SHA-256 (txids, payload commitments, merkle nodes). */
export function sha256d(data: Uint8Array): Uint8Array {
  return sha256Once(sha256Once(data));
}
