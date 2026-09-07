/**
 * Script opcodes needed by Canon. Byte values confirmed against
 * radiant-node/src/script/script.h (Phase 1 report §2).
 */
export const OP_0 = 0x00;
export const OP_PUSHDATA1 = 0x4c;
export const OP_PUSHDATA2 = 0x4d;
export const OP_PUSHDATA4 = 0x4e;
export const OP_1NEGATE = 0x4f;
export const OP_1 = 0x51;
export const OP_2 = 0x52;
export const OP_RETURN = 0x6a;
export const OP_DROP = 0x75;
export const OP_2DROP = 0x6d;
export const OP_DUP = 0x76;
export const OP_EQUAL = 0x87;
export const OP_EQUALVERIFY = 0x88;
export const OP_NUMEQUALVERIFY = 0x9d;
export const OP_HASH160 = 0xa9;
export const OP_HASH256 = 0xaa;
export const OP_CHECKSIG = 0xac;

export const OP_STATESEPARATOR = 0xbd;

// Reference opcodes — each consumes a 36-byte operand with NO length prefix.
export const OP_PUSHINPUTREF = 0xd0;
export const OP_REQUIREINPUTREF = 0xd1;
export const OP_DISALLOWPUSHINPUTREF = 0xd2;
export const OP_DISALLOWPUSHINPUTREFSIBLING = 0xd3;
export const OP_PUSHINPUTREFSINGLETON = 0xd8;

export const OP_REFHASHDATASUMMARY_UTXO = 0xd4;
export const OP_REFHASHVALUESUM_UTXOS = 0xd5;
export const OP_REFHASHDATASUMMARY_OUTPUT = 0xd6;
export const OP_REFHASHVALUESUM_OUTPUTS = 0xd7;
export const OP_REFTYPE_UTXO = 0xd9;
export const OP_REFTYPE_OUTPUT = 0xda;
export const OP_REFOUTPUTCOUNT_OUTPUTS = 0xde;
export const OP_CODESCRIPTHASHOUTPUTCOUNT_OUTPUTS = 0xe6;

/** The five opcodes whose operand is 36 raw bytes appended directly. */
export const REF_OPCODES: ReadonlySet<number> = new Set([
  OP_PUSHINPUTREF,
  OP_REQUIREINPUTREF,
  OP_DISALLOWPUSHINPUTREF,
  OP_DISALLOWPUSHINPUTREFSIBLING,
  OP_PUSHINPUTREFSINGLETON,
]);

/** Highest defined opcode on Radiant mainnet (OP_PUSH_TX_STATE). */
export const MAX_OPCODE = 0xed;
