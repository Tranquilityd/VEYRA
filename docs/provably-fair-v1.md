# Veyra Provably Fair v1

Algorithm identifier: `veyra-provably-fair-v1`  
Primitive: HMAC-SHA256

For every new casino session, the server generates a 32-byte cryptographically secure random server seed and stores its SHA-256 hash before resolving an outcome. The client seed is supplied by the player. The casino session UUID is the unique round nonce.

Each deterministic draw uses:

```
HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:${game}:draw:${drawIndex}`)
```

The first 13 hexadecimal characters (52 bits) are interpreted as an unsigned integer and reduced modulo the requested range. Draw indices begin at zero and increment in the exact order below.

- Plinko: for each ball, nine left/right draws (`range=2`), then one weighted multiplier draw (`range=100`). Balls are processed from index 0 upward. The existing Low, Medium, and High weighted tables remain unchanged.
- Dice: two draws (`range=6`), each plus one.
- Coin: one draw (`range=2`): zero is heads, one is tails.
- Slots: three draws (`range=5`), one per reel, mapped through the existing symbol array.

After resolution, the result JSON replaces the private pending commitment with the revealed server seed and public fairness inputs. The browser verifier hashes the reveal, checks the commitment, reproduces every draw locally, and compares the reproduced game result with the recorded result. It does not call a server verification endpoint.
